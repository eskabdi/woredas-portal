-- Kebele Rental Houses Management -- Phase 3 (settlement and payments).
--
-- Grounded in Kebele_Rental_Houses_Management_Implementation_Plan.md Part B
-- section 15 (rental_payment / rent_payment_settlement /
-- payment_reconciliation_exception), Part C section 21 (settlement API,
-- idempotency AF-05) and section 29 (payment reversal, AF-09). Phase 2
-- (rent_account/rent_rate_history/rent_charge/generate_rent_charges(),
-- migrations 76-77) is already live.
--
-- The non-negotiable rule this migration exists to enforce end-to-end
-- (plan section 2, BR-01..BR-07): a monthly rent charge is indivisible.
-- settle_rent_payment() below is the ONLY write path onto rent_charge.status
-- (besides generate_rent_charges()'s own INSERT) and it accepts complete
-- charges or nothing -- there is no partial-amount parameter anywhere in
-- this file.
--
-- ADDITIVE. No DROP of any table, column, or constraint. The reserved-key
-- exclusion-list edits below use the same DROP POLICY + CREATE POLICY /
-- DROP CONSTRAINT + ADD CONSTRAINT superset pattern 00000000000071 already
-- used for rental.policy.configure -- every value legal today stays legal.

BEGIN;

-- ============================================================================
-- 1. Permissions: rental.collect, rental.settle (ordinary, grantable -- same
--    category as rental.billing from Phase 2), rental.reverse (RESERVED --
--    reverses money already collected, the same risk class as
--    credential.revoke, which is also tenant_admin-only and reserved).
--
--    Learned from Phase 2's own review findings: rental.billing shipped
--    without its role_permission backfill and was ungrantable via the
--    Settings matrix for every woreda that existed before that migration
--    until 00000000000077 fixed it. rental.collect/rental.settle get their
--    backfill in THIS migration, not a follow-up.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete','rental.policy.configure','rental.billing','rental.collect','rental.settle','rental.reverse']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','rental.collect','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment','rental.view','rental.collect','rental.settle']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;$function$;

-- role_permission backfill: rental.collect/rental.settle (ordinary,
-- grantable) get a false-default row for every non-admin role across every
-- existing woreda, mirroring 00000000000077's fix and
-- 00000000000015/35/63's own established pattern -- so the Settings matrix
-- shows a toggle for a tenant to grant either to a role beyond its compiled
-- default, on day one, not after a follow-up migration.
INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, p.permission_key, p.permission_key = ANY (public.default_role_perms(r.role_name))
  FROM public.woreda w
 CROSS JOIN (VALUES
    ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
    ('supervisor'), ('auditor'), ('viewer')
  ) AS r(role_name)
 CROSS JOIN (VALUES ('rental.collect'), ('rental.settle')) AS p(permission_key)
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

-- rental.reverse is RESERVED (tenant_admin only, like credential.revoke) --
-- no role_permission backfill: role_permission_role_name_check only allows
-- the six non-admin roles as rows at all, and a reserved key must never
-- become a row a tenant_admin could grant elsewhere via the matrix, an
-- override, or a custom tenant_role -- so it is excluded from all three
-- surfaces below instead.
DROP POLICY role_permission_insert_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure', 'rental.reverse'
    ])
  );

DROP POLICY role_permission_update_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_update_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure', 'rental.reverse'
    ])
  )
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure', 'rental.reverse'
    ])
  );

ALTER TABLE public.user_permission_override
  DROP CONSTRAINT user_permission_override_no_locked_keys;
ALTER TABLE public.user_permission_override
  ADD CONSTRAINT user_permission_override_no_locked_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure', 'rental.reverse'
    ]));

ALTER TABLE public.tenant_role_permission
  DROP CONSTRAINT tenant_role_permission_no_reserved_keys;
ALTER TABLE public.tenant_role_permission
  ADD CONSTRAINT tenant_role_permission_no_reserved_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure', 'rental.reverse'
    ]));

-- ============================================================================
-- 2. rental_payment -- 1:1 extension of the shared `payment` entity (plan
--    section 15.1: "the official money record is the existing entity-typed
--    payment/receipt foundation ... rental context extends it 1:1").
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rental_payment (
  payment_id uuid PRIMARY KEY REFERENCES public.payment(payment_id),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rent_account_id uuid NOT NULL REFERENCES public.rent_account(rent_account_id),
  payer_resident_id uuid REFERENCES public.resident(resident_id),
  reference_number text,
  -- AF-05 / BR-22: idempotent payment submission. NULL is legal (a
  -- server-side reversal or backfill never carries a client idempotency
  -- key) but two rows in the same woreda can never share a non-null one.
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (woreda_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS rental_payment_account_idx ON public.rental_payment (rent_account_id);

ALTER TABLE public.rental_payment ENABLE ROW LEVEL SECURITY;

-- SELECT only. Every write goes through settle_rent_payment() (SECURITY
-- DEFINER, bypasses RLS) -- no direct client INSERT/UPDATE/DELETE policy,
-- same reasoning as rent_account/rent_charge in Phase 2.
CREATE POLICY rental_payment_select ON public.rental_payment
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 3. rent_payment_settlement -- links a payment to the complete charges it
--    settles (plan section 15.2). Never an allocation fraction: the CHECK
--    below ties settlement_amount to the settled charge's own total, and
--    settle_rent_payment() is the only writer.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rent_payment_settlement (
  settlement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  payment_id uuid NOT NULL REFERENCES public.rental_payment(payment_id),
  rent_charge_id uuid NOT NULL REFERENCES public.rent_charge(rent_charge_id),
  settlement_amount numeric(14, 2) NOT NULL CHECK (settlement_amount > 0),
  settlement_amount_enc bytea,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  settled_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_user(user_id),
  UNIQUE (payment_id, rent_charge_id)
);

-- One active settlement per charge (plan section 15.2, BR-05).
CREATE UNIQUE INDEX IF NOT EXISTS rent_payment_settlement_one_active_per_charge
  ON public.rent_payment_settlement (rent_charge_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS rent_payment_settlement_payment_idx
  ON public.rent_payment_settlement (payment_id);

CREATE OR REPLACE FUNCTION public.rent_payment_settlement_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.settlement_amount_enc := public.encrypt_pii_numeric(NEW.settlement_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rent_payment_settlement_amount_sync_trg ON public.rent_payment_settlement;
CREATE TRIGGER rent_payment_settlement_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.rent_payment_settlement
  FOR EACH ROW EXECUTE FUNCTION public.rent_payment_settlement_amount_sync();

DROP VIEW IF EXISTS public.rent_payment_settlement_decrypted;
CREATE VIEW public.rent_payment_settlement_decrypted
  WITH (security_invoker = on) AS
  SELECT s.*,
         public.decrypt_pii_numeric(s.settlement_amount_enc, s.woreda_id) AS settlement_amount_decrypted
  FROM public.rent_payment_settlement s;

REVOKE ALL ON public.rent_payment_settlement_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rent_payment_settlement_decrypted TO authenticated, service_role;

ALTER TABLE public.rent_payment_settlement ENABLE ROW LEVEL SECURITY;

-- SELECT only -- settlements are never deleted; reversal marks status
-- 'reversed' via reverse_rental_payment() (SECURITY DEFINER), never a
-- direct client UPDATE.
CREATE POLICY rent_payment_settlement_select ON public.rent_payment_settlement
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 4. payment_reconciliation_exception (plan section 15.5) -- an operational
--    exception mechanism, never a payment method. A mismatch never becomes
--    a partial posting; it lands here for the finance process instead.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_exception (
  exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rent_account_id uuid REFERENCES public.rent_account(rent_account_id),
  external_reference text,
  received_amount numeric(14, 2) NOT NULL CHECK (received_amount >= 0),
  received_amount_enc bytea,
  expected_settlement_amount numeric(14, 2) CHECK (expected_settlement_amount IS NULL OR expected_settlement_amount >= 0),
  expected_settlement_amount_enc bytea,
  exception_type text NOT NULL
    CHECK (exception_type IN ('amount_mismatch', 'duplicate', 'unknown_month', 'other')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'resolved', 'rejected')),
  resolution_note text,
  resolved_by uuid REFERENCES public.app_user(user_id),
  resolved_at timestamptz,
  created_by uuid REFERENCES public.app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_reconciliation_exception_woreda_status_idx
  ON public.payment_reconciliation_exception (woreda_id, status);

CREATE OR REPLACE FUNCTION public.payment_reconciliation_exception_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.received_amount_enc := public.encrypt_pii_numeric(NEW.received_amount, NEW.woreda_id);
  NEW.expected_settlement_amount_enc := public.encrypt_pii_numeric(NEW.expected_settlement_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payment_reconciliation_exception_amount_sync_trg ON public.payment_reconciliation_exception;
CREATE TRIGGER payment_reconciliation_exception_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.payment_reconciliation_exception
  FOR EACH ROW EXECUTE FUNCTION public.payment_reconciliation_exception_amount_sync();

DROP VIEW IF EXISTS public.payment_reconciliation_exception_decrypted;
CREATE VIEW public.payment_reconciliation_exception_decrypted
  WITH (security_invoker = on) AS
  SELECT e.*,
         public.decrypt_pii_numeric(e.received_amount_enc, e.woreda_id) AS received_amount_decrypted,
         public.decrypt_pii_numeric(e.expected_settlement_amount_enc, e.woreda_id) AS expected_settlement_amount_decrypted
  FROM public.payment_reconciliation_exception e;

REVOKE ALL ON public.payment_reconciliation_exception_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_reconciliation_exception_decrypted TO authenticated, service_role;

ALTER TABLE public.payment_reconciliation_exception ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_reconciliation_exception_select ON public.payment_reconciliation_exception
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- Rows are only ever created by settle_rent_payment() (SECURITY DEFINER).
-- Resolution (status/resolution_note/resolved_by/resolved_at) is the one
-- legitimate client-facing write on this table, done through
-- resolve_reconciliation_exception() below rather than a raw UPDATE policy
-- -- so "resolved" always carries a real actor and a real timestamp instead
-- of trusting whatever a client PATCH claims.

-- ============================================================================
-- 5. settle_rent_payment() -- the settlement RPC (plan section 21).
--    Woreda-scoped, exact-sum-or-nothing, idempotent, row-locked in
--    ascending rent_charge_id order (deadlock-free per section 15.2).
-- ============================================================================

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

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.collect', 'rental.settle'])) THEN
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

  -- BR-22 / AF-05: idempotent replay. A retried submission with the same
  -- key returns the payment already created instead of creating a second
  -- one -- checked before any lock is taken.
  IF _idempotency_key IS NOT NULL THEN
    SELECT rp.payment_id INTO v_existing_payment_id
      FROM public.rental_payment rp
     WHERE rp.woreda_id = v_woreda_id AND rp.idempotency_key = _idempotency_key;
    IF v_existing_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'idempotent_replay', 'payment_id', v_existing_payment_id);
    END IF;
  END IF;

  SELECT * INTO v_account FROM public.rent_account WHERE rent_account_id = _rent_account_id;
  IF NOT FOUND OR v_account.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'settle_rent_payment: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Lock the selected charges FOR UPDATE, ordered by rent_charge_id --
  -- deadlock-free under concurrent settlement attempts on overlapping
  -- charge sets (plan section 15.2). A charge already settled by a
  -- concurrent transaction is excluded by the status filter, so "exactly
  -- one wins" falls out of the lock + eligibility check rather than a
  -- separate advisory lock.
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
    -- Some requested charge is not eligible (already settled by a
    -- concurrent request, belongs to a different account, or does not
    -- exist) -- reject the whole batch rather than silently settling a
    -- subset. No exception row: this is a stale-selection error, not an
    -- amount mismatch.
    RAISE EXCEPTION
      'ከመረጡት ወራት ውስጥ አንዳንዶቹ ቀድሞ ተከፍለዋል ወይም አይገኙም -- ገጹን ያድሱ / One or more selected months are already settled or unavailable -- refresh and try again'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sum(total_amount) INTO v_expected FROM _locked_charges;

  -- BR-03/BR-07: exact decimal equality, or a reconciliation exception --
  -- never a partial posting. The exception row is returned to the caller
  -- normally (no RAISE) so it commits even though no payment/settlement is
  -- created; the ledger itself is untouched (the temp table's FOR UPDATE
  -- lock is released at COMMIT either way, without a status change).
  IF _payment_amount <> v_expected THEN
    INSERT INTO public.payment_reconciliation_exception (
      woreda_id, rent_account_id, external_reference, received_amount,
      expected_settlement_amount, exception_type, created_by
    ) VALUES (
      v_woreda_id, _rent_account_id, _reference_number, _payment_amount,
      v_expected, 'amount_mismatch', v_actor
    )
    RETURNING exception_id INTO v_exception_id;

    RETURN jsonb_build_object(
      'status', 'mismatch',
      'exception_id', v_exception_id,
      'expected_amount', v_expected,
      'received_amount', _payment_amount
    );
  END IF;

  -- Payment + settlements + status flips: one transaction (BR-06).
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

REVOKE EXECUTE ON FUNCTION public.settle_rent_payment(uuid, uuid[], numeric, date, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_rent_payment(uuid, uuid[], numeric, date, text, text, uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 6. reverse_rental_payment() -- closes AF-09 (plan section 29). Reopens
--    exactly the charges the payment settled, in full -- no partial
--    balances are ever created by a reversal, same as a settlement.
-- ============================================================================

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

  IF EXISTS (
    SELECT 1 FROM public.payment WHERE payment_id = _payment_id AND status = 'reversed'
  ) THEN
    RAISE EXCEPTION 'ይህ ክፍያ ቀደም ብሎ ተመላሽ ተደርጓል / This payment has already been reversed'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the affected charges in a stable order before touching anything,
  -- same deadlock-avoidance discipline as settle_rent_payment().
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

  WITH reopened AS (
    UPDATE public.rent_charge rc
       SET status = 'overdue', settled_at = NULL, settled_by_payment_id = NULL
      FROM public.rent_payment_settlement s
     WHERE s.payment_id = _payment_id
       AND s.rent_charge_id = rc.rent_charge_id
       AND rc.status = 'paid'
    RETURNING rc.rent_charge_id
  )
  SELECT count(*) INTO v_reopened_count FROM reopened;

  UPDATE public.payment SET status = 'reversed' WHERE payment_id = _payment_id;

  INSERT INTO public.payment_reconciliation_exception (
    woreda_id, rent_account_id, external_reference, received_amount,
    expected_settlement_amount, exception_type, status, resolution_note,
    resolved_by, resolved_at, created_by
  )
  SELECT v_woreda_id, v_rp.rent_account_id, v_rp.reference_number, p.amount, p.amount,
         'other', 'resolved', 'Payment reversed: ' || COALESCE(_reason, '(no reason given)'),
         v_actor, now(), v_actor
    FROM public.payment p WHERE p.payment_id = _payment_id;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rental_payment', _payment_id::text, 'RENTAL_PAYMENT_REVERSED',
    jsonb_build_object('reason', _reason, 'charges_reopened', v_reopened_count));

  RETURN jsonb_build_object('status', 'reversed', 'charges_reopened', v_reopened_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reverse_rental_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_rental_payment(uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 7. resolve_reconciliation_exception() -- the one legitimate client write
--    on payment_reconciliation_exception, so "resolved" always carries a
--    real actor/timestamp rather than trusting a client-supplied one.
-- ============================================================================

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

  SELECT woreda_id INTO v_owner_woreda
    FROM public.payment_reconciliation_exception WHERE exception_id = _exception_id;
  IF NOT FOUND OR v_owner_woreda <> v_woreda_id THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: exception not found' USING ERRCODE = 'no_data_found';
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

REVOKE EXECUTE ON FUNCTION public.resolve_reconciliation_exception(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_reconciliation_exception(uuid, text, text) TO authenticated, service_role;

COMMIT;
