-- Kebele Rental Houses Management -- Phase 3 follow-up: fixes from the five
-- review agents dispatched on 00000000000078 (tenant-isolation-review,
-- rbac-escalation-review, rental-financial-integrity-review,
-- portal-conventions-review, secret-sweep).
--
-- 1. settle_rent_payment(): _payer_resident_id was accepted without checking
--    it belongs to the caller's own woreda (tenant-isolation-review) -- a
--    cross-tenant resident reference could be written into payment.resident_id
--    / rental_payment.payer_resident_id. Now validated like every other id.
--
-- 2. settle_rent_payment(): the permission check accepted rental.collect OR
--    rental.settle interchangeably (rbac-escalation-review) -- rental.settle
--    then carried no distinct authority on the one money-moving write path,
--    silently granting registry_clerk (collect-only by design) full
--    settlement power. Narrowed to rental.collect alone: "collect" is the
--    complete collect-and-post action a clerk performs; rental.settle is now
--    reserved for the higher-trust reconciliation-exception authority below.
--
-- 3. reverse_rental_payment():
--    a) read payment.status without locking the row first (tenant-isolation-
--       review and rental-financial-integrity-review both independently
--       flagged this as a TOCTOU allowing a duplicate reversal audit/
--       exception trail under concurrency) -- now FOR UPDATE before the check.
--    b) reopened a charge to a hardcoded 'overdue' regardless of its due_date
--       (rental-financial-integrity-review) -- a charge reversed before its
--       due date is now wrongly in arrears. Restores 'due' or 'overdue' based
--       on due_date vs current_date.
--    c) inserted a payment_reconciliation_exception row for every reversal
--       (rental-financial-integrity-review) -- that table is an operational
--       exception record (plan section 15.5: amount_mismatch/duplicate/
--       unknown_month/other during SETTLEMENT), not a reversal ledger; doing
--       so double-counts reversed amounts in any report summing
--       received_amount. The audit_log row already carries the full trail.
--       Removed.
--
-- 4. resolve_reconciliation_exception(): 'resolved' was not terminal
--    (rbac-escalation-review) -- a rental.settle holder could relabel an
--    already-resolved row, including the confusion this migration also
--    removes at its source (3c). Now rejects any further transition once
--    status = 'resolved'.
--
-- 5. rent_payment_settlement.settlement_amount had no DB-level tie to the
--    settled charge's own total_amount (rental-financial-integrity-review) --
--    the RPC enforces it, but the migration's own comment claimed a CHECK
--    that didn't exist. Added as a real trigger-enforced invariant, closing
--    the gap rather than just correcting the comment.
--
-- 6. The mismatch branch of settle_rent_payment() was not idempotency-guarded
--    (rental-financial-integrity-review) -- a retried submission with the
--    same key created a new payment_reconciliation_exception row every time.
--    idempotency_key added to that table; a retry now returns the original
--    exception instead of creating a duplicate.
--
-- 7. The four decrypted views this module has introduced (rent_charge_decrypted
--    and rent_rate_history_decrypted from 00000000000076; rent_payment_settlement_decrypted
--    and payment_reconciliation_exception_decrypted from 00000000000078) were
--    never added to 00000000000026/45's own security_invoker regression
--    assertion (rental-financial-integrity-review) -- the exact guard that
--    exists to catch this class of tenant-boundary regression didn't cover
--    them. Added here, alongside a re-assertion of the original eight.
--
-- ADDITIVE. No DROP of any table or column. Functions changed only via
-- CREATE OR REPLACE.

BEGIN;

-- ----------------------------------------------------------------------
-- 5. settlement_amount tied to its charge's own total_amount.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_settlement_amount_matches_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_charge_total numeric(14, 2);
BEGIN
  SELECT total_amount INTO v_charge_total FROM public.rent_charge WHERE rent_charge_id = NEW.rent_charge_id;
  IF v_charge_total IS NULL THEN
    RAISE EXCEPTION 'guard_settlement_amount_matches_charge: charge not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NEW.settlement_amount <> v_charge_total THEN
    RAISE EXCEPTION
      'የክፍያ ማስተካከያ መጠን ከወሩ ክፍያ ጋር መመሳሰል አለበት / A settlement amount must exactly match its charge''s total'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_guard_settlement_amount ON public.rent_payment_settlement;
CREATE TRIGGER zz_guard_settlement_amount
  BEFORE INSERT OR UPDATE ON public.rent_payment_settlement
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_amount_matches_charge();

-- ----------------------------------------------------------------------
-- 6. Idempotency for the mismatch branch.
-- ----------------------------------------------------------------------

ALTER TABLE public.payment_reconciliation_exception
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliation_exception_woreda_idempotency_key
  ON public.payment_reconciliation_exception (woreda_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------
-- 1, 2, 6: settle_rent_payment() restated.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.settle_rent_payment(
  _rent_account_id uuid,
  _rent_charge_ids uuid[],
  _payment_amount numeric,
  _payment_date date,
  _channel text,
  _reference_number text,
  _payer_resident_id uuid,
  _idempotency_key text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_existing_payment_id uuid;
  v_existing_exception_id uuid;
  v_account RECORD;
  v_expected numeric(14, 2);
  v_charge_count int;
  v_locked_count int;
  v_payment_id uuid;
  v_charge_id uuid;
  v_exception_id uuid;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'settle_rent_payment: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Narrowed to rental.collect alone (fix 2): "collect" is the complete
  -- collect-and-post action; rental.settle no longer does double duty here.
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.collect'])) THEN
    RAISE EXCEPTION 'settle_rent_payment: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _rent_charge_ids IS NULL OR array_length(_rent_charge_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ቢያንስ አንድ የተሟላ ወር ክፍያ መምረጥ ያስፈልጋል / At least one complete month must be selected'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _payment_amount IS NULL OR _payment_amount <= 0 THEN
    RAISE EXCEPTION 'settle_rent_payment: payment amount must be positive' USING ERRCODE = 'check_violation';
  END IF;

  -- BR-22 / AF-05: idempotent replay for an already-settled attempt.
  IF _idempotency_key IS NOT NULL THEN
    SELECT rp.payment_id INTO v_existing_payment_id
      FROM public.rental_payment rp
     WHERE rp.woreda_id = v_woreda_id AND rp.idempotency_key = _idempotency_key;
    IF v_existing_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'idempotent_replay', 'payment_id', v_existing_payment_id);
    END IF;

    -- Fix 6: a retried attempt that mismatched last time returns the same
    -- exception instead of logging a second one.
    SELECT exception_id INTO v_existing_exception_id
      FROM public.payment_reconciliation_exception
     WHERE woreda_id = v_woreda_id AND idempotency_key = _idempotency_key;
    IF v_existing_exception_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'mismatch', 'exception_id', v_existing_exception_id);
    END IF;
  END IF;

  SELECT * INTO v_account FROM public.rent_account WHERE rent_account_id = _rent_account_id;
  IF NOT FOUND OR v_account.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'settle_rent_payment: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Fix 1: a payer resident, when given, must belong to the caller's own
  -- woreda -- every other id in this function is already checked; this one
  -- previously wasn't, and a cross-tenant resident_id would otherwise be
  -- accepted (the FK to resident(resident_id) has no tenant awareness).
  IF _payer_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.resident WHERE resident_id = _payer_resident_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'settle_rent_payment: payer resident not found in this woreda'
      USING ERRCODE = 'no_data_found';
  END IF;

  CREATE TEMP TABLE _locked_charges ON COMMIT DROP AS
  SELECT rent_charge_id, total_amount
    FROM public.rent_charge
   WHERE rent_charge_id = ANY (_rent_charge_ids)
     AND rent_account_id = _rent_account_id
     AND woreda_id = v_woreda_id
     AND status IN ('due', 'overdue')
   ORDER BY rent_charge_id
     FOR UPDATE OF rent_charge;

  SELECT count(*) INTO v_locked_count FROM _locked_charges;
  SELECT array_length(_rent_charge_ids, 1) INTO v_charge_count;

  IF v_locked_count <> v_charge_count THEN
    RAISE EXCEPTION
      'ከመረጡት ወራት ውስጥ አንዳንዶቹ ቀድሞ ተከፍለዋል ወይም አይገኙም -- ገጹን ያድሱ / One or more selected months are already settled or unavailable -- refresh and try again'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sum(total_amount) INTO v_expected FROM _locked_charges;

  IF _payment_amount <> v_expected THEN
    INSERT INTO public.payment_reconciliation_exception (
      woreda_id, rent_account_id, external_reference, received_amount,
      expected_settlement_amount, exception_type, created_by, idempotency_key
    ) VALUES (
      v_woreda_id, _rent_account_id, _reference_number, _payment_amount,
      v_expected, 'amount_mismatch', v_actor, _idempotency_key
    )
    RETURNING exception_id INTO v_exception_id;

    RETURN jsonb_build_object(
      'status', 'mismatch',
      'exception_id', v_exception_id,
      'expected_amount', v_expected,
      'received_amount', _payment_amount
    );
  END IF;

  INSERT INTO public.payment (
    woreda_id, resident_id, payment_type, amount, payment_date, channel,
    reference_no, status, posted_by_user_id
  ) VALUES (
    v_woreda_id, _payer_resident_id, 'rental_rent', _payment_amount, _payment_date,
    _channel, _reference_number, 'confirmed', v_actor
  )
  RETURNING payment_id INTO v_payment_id;

  INSERT INTO public.rental_payment (
    payment_id, woreda_id, rent_account_id, payer_resident_id, reference_number, idempotency_key
  ) VALUES (
    v_payment_id, v_woreda_id, _rent_account_id, _payer_resident_id, _reference_number, _idempotency_key
  );

  FOR v_charge_id IN SELECT rent_charge_id FROM _locked_charges LOOP
    INSERT INTO public.rent_payment_settlement (
      woreda_id, payment_id, rent_charge_id, settlement_amount, status, created_by
    )
    SELECT v_woreda_id, v_payment_id, v_charge_id, total_amount, 'active', v_actor
      FROM public.rent_charge WHERE rent_charge_id = v_charge_id;

    UPDATE public.rent_charge
       SET status = 'paid', settled_at = now(), settled_by_payment_id = v_payment_id
     WHERE rent_charge_id = v_charge_id;
  END LOOP;

  INSERT INTO public.receipt (woreda_id, payment_id, receipt_date, total_amount, cash_bank_channel)
  VALUES (v_woreda_id, v_payment_id, _payment_date, _payment_amount, _channel);

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rental_payment', v_payment_id::text, 'RENTAL_PAYMENT_SETTLED',
    jsonb_build_object(
      'rent_account_id', _rent_account_id, 'amount', _payment_amount,
      'rent_charge_ids', _rent_charge_ids
    ));

  RETURN jsonb_build_object('status', 'settled', 'payment_id', v_payment_id);
END;
$function$;

-- ----------------------------------------------------------------------
-- 3. reverse_rental_payment() restated.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reverse_rental_payment(
  _payment_id uuid,
  _reason text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_rp RECORD;
  v_payment_status text;
  v_reopened_count int;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'reverse_rental_payment: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.reverse'])) THEN
    RAISE EXCEPTION 'reverse_rental_payment: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_rp FROM public.rental_payment WHERE payment_id = _payment_id;
  IF NOT FOUND OR v_rp.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'reverse_rental_payment: payment not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Fix 3a: lock the payment row before reading its status, so two
  -- concurrent reversal attempts can't both pass the "already reversed"
  -- check (only the second reader would previously have raced past it).
  SELECT status INTO v_payment_status
    FROM public.payment WHERE payment_id = _payment_id AND woreda_id = v_woreda_id
    FOR UPDATE;

  IF v_payment_status = 'reversed' THEN
    RAISE EXCEPTION 'ይህ ክፍያ ቀደም ብሎ ተመላሽ ተደርጓል / This payment has already been reversed'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM public.rent_charge
   WHERE rent_charge_id IN (
     SELECT rent_charge_id FROM public.rent_payment_settlement
      WHERE payment_id = _payment_id AND status = 'active'
   )
   ORDER BY rent_charge_id
     FOR UPDATE;

  UPDATE public.rent_payment_settlement
     SET status = 'reversed'
   WHERE payment_id = _payment_id AND status = 'active';

  -- Fix 3b: restore each reopened charge to 'due' or 'overdue' based on its
  -- own due_date, not a hardcoded 'overdue' -- a charge reversed before its
  -- due date must not read as in arrears.
  WITH reopened AS (
    UPDATE public.rent_charge rc
       SET status = CASE WHEN rc.due_date < current_date THEN 'overdue' ELSE 'due' END,
           settled_at = NULL, settled_by_payment_id = NULL
      FROM public.rent_payment_settlement s
     WHERE s.payment_id = _payment_id
       AND s.status = 'reversed'
       AND s.rent_charge_id = rc.rent_charge_id
       AND rc.status = 'paid'
    RETURNING rc.rent_charge_id
  )
  SELECT count(*) INTO v_reopened_count FROM reopened;

  UPDATE public.payment SET status = 'reversed' WHERE payment_id = _payment_id;

  -- Fix 3c: no payment_reconciliation_exception row for a reversal --
  -- that table is for settlement-time exceptions (amount_mismatch/
  -- duplicate/unknown_month/other), and a reversal here would double-count
  -- the reversed amount in any report summing received_amount. The
  -- audit_log entry below is this action's complete trail.
  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rental_payment', _payment_id::text, 'RENTAL_PAYMENT_REVERSED',
    jsonb_build_object('reason', _reason, 'charges_reopened', v_reopened_count));

  RETURN jsonb_build_object('status', 'reversed', 'charges_reopened', v_reopened_count);
END;
$function$;

-- ----------------------------------------------------------------------
-- 4. resolve_reconciliation_exception(): 'resolved' becomes terminal.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_reconciliation_exception(
  _exception_id uuid,
  _status text,
  _resolution_note text
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_owner_woreda uuid;
  v_current_status text;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.settle'])) THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _status NOT IN ('under_review', 'resolved', 'rejected') THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: invalid status' USING ERRCODE = 'check_violation';
  END IF;

  SELECT woreda_id, status INTO v_owner_woreda, v_current_status
    FROM public.payment_reconciliation_exception WHERE exception_id = _exception_id;
  IF NOT FOUND OR v_owner_woreda <> v_woreda_id THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: exception not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- 'resolved' is terminal -- without this, a rental.settle holder could
  -- relabel an already-resolved row's status/note/actor indefinitely.
  IF v_current_status = 'resolved' THEN
    RAISE EXCEPTION 'ይህ ጉዳይ ቀድሞ ተፈትቷል -- ተጨማሪ ለውጥ አይፈቀድም / This exception is already resolved -- no further change is allowed'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.payment_reconciliation_exception
     SET status = _status,
         resolution_note = _resolution_note,
         resolved_by = v_actor,
         resolved_at = now()
   WHERE exception_id = _exception_id;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'payment_reconciliation_exception', _exception_id::text,
    'RECONCILIATION_EXCEPTION_RESOLVED', jsonb_build_object('status', _status, 'note', _resolution_note));
END;
$function$;

-- ----------------------------------------------------------------------
-- 7. security_invoker regression assertion, extended to the four new
--    decrypted views (copies 00000000000026/45's exact pattern).
-- ----------------------------------------------------------------------

DO $sec$
DECLARE
  v_name text;
  v_opts text[];
  v_missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'approval_queue_v', 'household_member_roster', 'resident_decrypted',
    'household_decrypted', 'payment_decrypted', 'service_request_decrypted',
    'rental_occupancy_decrypted', 'rental_occupancy_request_decrypted',
    'rent_charge_decrypted', 'rent_rate_history_decrypted',
    'rent_payment_settlement_decrypted', 'payment_reconciliation_exception_decrypted'
  ] LOOP
    SELECT c.reloptions INTO v_opts
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_name AND c.relkind = 'v';
    IF FOUND AND (v_opts IS NULL OR NOT ('security_invoker=on' = ANY (v_opts))) THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'These views lost security_invoker: %. They are owned by a rolbypassrls role, so without it they stop applying the underlying tables'' RLS and return every tenant''s rows. Restore WITH (security_invoker = on).',
      array_to_string(v_missing, ', ');
  END IF;
END $sec$;

COMMIT;
