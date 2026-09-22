-- Kebele Rental Houses Management -- sixth round of pre-merge fixes, from the
-- round-6 dispatch of tenant-isolation, rbac-escalation, workflow-fsm and
-- rental-financial-integrity review over the diff through 00088. Three of
-- the four reviewers independently found the same regression in 00088's own
-- fix (locking verified_by_user_id broke legitimate re-verification), plus a
-- handful of narrower gaps each reviewer found on its own.
--
-- 1. HIGH, confirmed independently by 3 of 4 reviewers: 00088 locked
--    verified_by_user_id immutable the moment it is first set, with no
--    exemption for the legitimate paths back into 'verified'
--    (approval_returned -> verified, approval_returned -> returned ->
--    verified, approval_returned -> under_review -> verified, all seeded in
--    00058/00072/00075/00085). Only the original verifier could ever
--    re-verify a returned request again -- if that person is suspended,
--    reassigned, or has left, the request is permanently stuck. The same
--    unconditional lock also let anyone with rental.create/approve/vacate
--    pre-claim verified_by_user_id on a still-submitted row with a bare
--    PATCH, before any real verification happened, which the OLD-IS-NOT-
--    NULL gate didn't catch. Narrowing the lock to skip exactly the UPDATE
--    that legitimately re-enters 'verified' (where the existing pin below
--    already rebinds the column to the real caller) closes both: a
--    pre-claim attempt on a submitted row is simply overwritten by whoever
--    actually verifies it next, the same as before 00088.
--
-- 2. LOW: requested_by_user_id could still be left NULL at INSERT and
--    claimed later by any updater's PATCH before the row was ever verified
--    -- the round-5 lock only takes effect once the column is non-NULL.
--    Requiring a non-NULL requester at INSERT (mirroring what 00087 already
--    required before allowing entry into 'verified') closes the window
--    entirely, since force_actor_columns already pins it to the real
--    inserter.
--
-- 3. LOW: unlike verified_by_user_id, nothing stopped approved_by_user_id
--    from being reassigned after a request reached 'approved' or
--    'rejected' -- both are terminal for this table (no workflow_transition
--    row has either as a from_status, unlike arrears_repayment_plan, which
--    deliberately allows its own approved_by_user_id to change across a
--    real return-and-redecide cycle and is intentionally left alone here).
--    Locking it the same way, exempted only for the transition into
--    'approved'.
--
-- 4. MEDIUM: settle_arrears_installments() read the plan row without
--    locking it before checking whether every installment was now paid --
--    two concurrent settlements against the last two due installments of
--    the same plan could each see the other's installment as still unpaid
--    and neither would mark the plan 'completed', permanently stranding it
--    'active' with nothing due and blocking any future plan on that
--    account (arrears_repayment_plan_one_active_per_account). Locking the
--    plan row FOR UPDATE up front serializes the two calls, so the second
--    one re-checks against the first one's already-committed installment.
--
-- 5. MEDIUM: reverse_rental_payment() checked only the rental.reverse
--    permission, never that the reverser differs from the original
--    collector (payment.posted_by_user_id) -- the same collect-then-
--    reverse-yourself skimming pattern 00086 already closed for
--    reconciliation-exception resolution (resolver must differ from
--    creator). A tenant_admin holds both rental.collect and rental.reverse
--    by default. Requiring a different actor when one is known.
--
-- Not fixed here (need a product decision, not a review-fix migration):
--   - 00081's one-time UPDATE that flipped every tenant's finance_clerk/
--     rental.view to true wrote no audit_log row and can't be distinguished
--     after the fact from a tenant_admin who had deliberately set it false
--     -- rbac-escalation review flagged this as a real audit-trail gap, but
--     fixing it now means guessing at which tenants actually made that
--     deliberate choice, which risks doing more damage than the gap itself.
--   - seed.sql is still missing 7 of the newer rental.*/service.
--     checkpoint_override permission keys (backfilled into existing
--     woredas by 00078/00080/00083, and into any new woreda by the
--     woreda-insert trigger's seed_role_permission_for_new_woreda() call
--     into default_role_perms()) -- the same class of seed/default drift
--     already present on main for the civil.*/credential.*/service.* FSM
--     keys, not something this PR introduced or should silently patch.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1-3. enforce_rental_request_integrity_guards(): narrow the verified_by_
--    user_id lock to exempt the legitimate re-verify transition, require a
--    non-NULL requester at INSERT, and lock approved_by_user_id the same
--    way (exempted only for the transition into 'approved').
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_rental_request_integrity_guards()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_status := OLD.status;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION
      'አዲስ ጥያቄ በ''ረቂቅ'' ወይም ''ገብቷል'' ሁኔታ ብቻ መጀመር አለበት / A new request must start as draft or submitted'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Round-6 fix: a requester left NULL at INSERT could otherwise be claimed
  -- by anyone's later PATCH, before the round-5 immutability lock below
  -- ever takes effect (it only fires once the column is already non-NULL).
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.requested_by_user_id IS NULL THEN
    RAISE EXCEPTION
      'ጥያቄውን ያቀረበው ሠራተኛ መመዝገብ አለበት / requested_by_user_id must be recorded when a request is created'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.request_type = 'new_registration'
     AND NEW.status IN ('submitted', 'under_review', 'verified', 'approved')
     AND (NEW.rent_amount IS NULL OR NEW.rent_amount <= 0) THEN
    RAISE EXCEPTION
      'ትክክለኛ የቤት ኪራይ ዋጋ ያስፈልጋል / A valid rent amount is required to submit this request';
  END IF;

  -- Round-5 fix, narrowed in round 6: requested_by_user_id stays immutable
  -- once set (nothing legitimately reassigns who originally submitted a
  -- request). verified_by_user_id and approved_by_user_id are each
  -- immutable EXCEPT during the specific UPDATE that legitimately sets
  -- them (entering 'verified' / entering 'approved', both pinned to the
  -- real caller just below) -- the round-5 version locked verified_by_
  -- user_id unconditionally, which broke every legitimate re-verification
  -- after a return.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.requested_by_user_id IS NOT NULL
       AND NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያቀረበው ሠራተኛ ከተመዘገበ በኋላ መቀየር አይቻልም / requested_by_user_id cannot change once recorded'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.verified_by_user_id IS NOT NULL
       AND NEW.verified_by_user_id IS DISTINCT FROM OLD.verified_by_user_id
       AND NOT (NEW.status = 'verified' AND v_old_status IS DISTINCT FROM 'verified')
    THEN
      RAISE EXCEPTION
        'ያረጋገጠው ሠራተኛ ከተመዘገበ በኋላ መቀየር አይቻልም / verified_by_user_id cannot change once recorded'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.approved_by_user_id IS NOT NULL
       AND NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
       AND NOT (NEW.status = 'approved' AND v_old_status IS DISTINCT FROM 'approved')
    THEN
      RAISE EXCEPTION
        'ያጸደቀው ሠራተኛ ከተመዘገበ በኋላ መቀየር አይቻልም / approved_by_user_id cannot change once recorded'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_old_status NOT IN ('draft', 'submitted', 'under_review', 'returned') THEN
    IF NEW.rent_amount IS DISTINCT FROM OLD.rent_amount
       OR NEW.rental_house_id IS DISTINCT FROM OLD.rental_house_id
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.household_id IS DISTINCT FROM OLD.household_id
       OR NEW.rent_start_date IS DISTINCT FROM OLD.rent_start_date
       OR NEW.request_type IS DISTINCT FROM OLD.request_type
       OR NEW.existing_occupancy_id IS DISTINCT FROM OLD.existing_occupancy_id
       OR NEW.termination_date IS DISTINCT FROM OLD.termination_date
       OR NEW.termination_reason IS DISTINCT FROM OLD.termination_reason
    THEN
      RAISE EXCEPTION
        'ተረጋግጦ ከተላለፈ በኋላ የቤት ኪራይ ዋጋ ወይም ተያያዥ መረጃ መቀየር አይቻልም / Rent amount and linked house/resident/type/start-date/termination fields cannot change once this request has been verified'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'verified') THEN
    IF auth.uid() IS NOT NULL AND NEW.verified_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'ማረጋገጫውን የፈጸመው ተጠቃሚ በትክክል መመዝገብ አለበት / verified_by_user_id must be the user actually performing this verification';
    END IF;

    IF NEW.requested_by_user_id IS NULL THEN
      RAISE EXCEPTION
        'ጥያቄውን ያቀረበው ሠራተኛ መመዝገብ አለበት / requested_by_user_id must be recorded before this request can be verified';
    END IF;

    IF NEW.verified_by_user_id IS NOT NULL
       AND NEW.verified_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያቀረበው ሠራተኛ ራሱ ማረጋገጥ አይችልም / The clerk who submitted this request cannot also verify it';
    END IF;

    IF NOT (COALESCE(NEW.verification_checklist, '{}'::jsonb) @> '{
      "identity_verified": true, "house_available": true,
      "rent_amount_confirmed": true, "documents_complete": true
    }'::jsonb) THEN
      RAISE EXCEPTION
        'ሁሉንም የማረጋገጫ ዝርዝሮች ማጠናቀቅ ያስፈልጋል / All verification checklist items must be completed';
    END IF;
  END IF;

  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'approved') THEN
    IF NEW.verified_by_user_id IS NULL THEN
      RAISE EXCEPTION
        'ያልተረጋገጠ ጥያቄ ማጽደቅ አይቻልም / An approval requires a recorded verifier'
        USING ERRCODE = 'check_violation';
    END IF;

    IF auth.uid() IS NOT NULL AND NEW.approved_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'ማጽደቁን የፈጸመው ተጠቃሚ በትክክል መመዝገብ አለበት / approved_by_user_id must be the user actually performing this approval';
    END IF;

    IF NEW.approved_by_user_id IS NOT NULL
       AND NEW.approved_by_user_id = NEW.verified_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያረጋገጠው ሠራተኛ ራሱ ማጽደቅ አይችልም / The clerk who verified this request cannot also approve it';
    END IF;

    IF NEW.approved_by_user_id IS NOT NULL
       AND NEW.approved_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያቀረበው ሠራተኛ ራሱ ማጽደቅ አይችልም / The clerk who submitted this request cannot also approve it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 4. settle_arrears_installments(): lock the plan row FOR UPDATE up front so
--    two concurrent last-installment settlements on the same plan serialize
--    instead of both missing the completion flip.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_arrears_installments(
  _plan_id uuid,
  _installment_ids uuid[],
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
  v_prev_system_transition text := current_setting('app.system_transition', true);
  v_plan RECORD;
  v_existing_payment_id uuid;
  v_existing_exception_id uuid;
  v_expected numeric(14, 2);
  v_installment_count int;
  v_locked_count int;
  v_payment_id uuid;
  v_installment_id uuid;
  v_exception_id uuid;
  v_all_paid boolean;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'settle_arrears_installments: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.collect'])) THEN
    RAISE EXCEPTION 'settle_arrears_installments: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _installment_ids IS NULL OR array_length(_installment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ቢያንስ አንድ የተሟላ ክፍያ ክፍል መምረጥ ያስፈልጋል / At least one complete installment must be selected'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _payment_amount IS NULL OR _payment_amount <= 0 THEN
    RAISE EXCEPTION 'settle_arrears_installments: payment amount must be positive' USING ERRCODE = 'check_violation';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT rp.payment_id INTO v_existing_payment_id
      FROM public.rental_payment rp
     WHERE rp.woreda_id = v_woreda_id AND rp.idempotency_key = _idempotency_key;
    IF v_existing_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'idempotent_replay', 'payment_id', v_existing_payment_id);
    END IF;

    SELECT exception_id INTO v_existing_exception_id
      FROM public.payment_reconciliation_exception
     WHERE woreda_id = v_woreda_id AND idempotency_key = _idempotency_key;
    IF v_existing_exception_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'mismatch', 'exception_id', v_existing_exception_id);
    END IF;
  END IF;

  -- Round-6 fix: lock the plan row itself so a concurrent settlement of the
  -- plan's other installments can't slip past the completion check below
  -- with a stale view of which installments are already paid.
  SELECT * INTO v_plan FROM public.arrears_repayment_plan WHERE plan_id = _plan_id FOR UPDATE;
  IF NOT FOUND OR v_plan.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'settle_arrears_installments: plan not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_plan.status <> 'active' THEN
    RAISE EXCEPTION 'settle_arrears_installments: plan is not active' USING ERRCODE = 'check_violation';
  END IF;

  IF _payer_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.resident WHERE resident_id = _payer_resident_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'settle_arrears_installments: payer resident not found in this woreda'
      USING ERRCODE = 'no_data_found';
  END IF;

  CREATE TEMP TABLE _locked_installments ON COMMIT DROP AS
  SELECT installment_id, amount
    FROM public.arrears_repayment_installment
   WHERE installment_id = ANY (_installment_ids)
     AND plan_id = _plan_id
     AND woreda_id = v_woreda_id
     AND status IN ('due', 'overdue')
   ORDER BY installment_id
     FOR UPDATE;

  SELECT count(*) INTO v_locked_count FROM _locked_installments;
  SELECT array_length(_installment_ids, 1) INTO v_installment_count;

  IF v_locked_count <> v_installment_count THEN
    RAISE EXCEPTION
      'ከመረጡት ክፍሎች ውስጥ አንዳንዶቹ ቀድሞ ተከፍለዋል ወይም አይገኙም -- ገጹን ያድሱ / One or more selected installments are already settled or unavailable -- refresh and try again'
      USING ERRCODE = 'check_violation';
  END IF;

  CREATE TEMP TABLE _locked_arrears_charges ON COMMIT DROP AS
  SELECT rc.rent_charge_id, rc.total_amount, rc.status, aic.installment_id
    FROM public.arrears_installment_charge aic
    JOIN public.rent_charge rc ON rc.rent_charge_id = aic.rent_charge_id
   WHERE aic.installment_id IN (SELECT installment_id FROM _locked_installments)
     AND aic.status = 'active'
   ORDER BY rc.rent_charge_id
     FOR UPDATE OF rc;

  IF EXISTS (SELECT 1 FROM _locked_arrears_charges WHERE status NOT IN ('due', 'overdue')) THEN
    RAISE EXCEPTION
      'ካርታ የተደረገ ክፍያ ቀድሞ ተከፍሏል ወይም አይገኝም -- ገጹን ያድሱ / A mapped charge is already settled or unavailable -- refresh and try again'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sum(amount) INTO v_expected FROM _locked_installments;

  IF _payment_amount <> v_expected THEN
    INSERT INTO public.payment_reconciliation_exception (
      woreda_id, rent_account_id, external_reference, received_amount,
      expected_settlement_amount, exception_type, created_by, idempotency_key
    ) VALUES (
      v_woreda_id, v_plan.rent_account_id, _reference_number, _payment_amount,
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

  PERFORM set_config('app.system_transition', 'on', true);
  INSERT INTO public.payment (
    woreda_id, resident_id, payment_type, amount, payment_date, channel,
    reference_no, status, posted_by_user_id
  ) VALUES (
    v_woreda_id, _payer_resident_id, 'rental_rent', _payment_amount, _payment_date,
    _channel, _reference_number, 'confirmed', v_actor
  )
  RETURNING payment_id INTO v_payment_id;
  PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);

  INSERT INTO public.rental_payment (
    payment_id, woreda_id, rent_account_id, payer_resident_id, reference_number, idempotency_key
  ) VALUES (
    v_payment_id, v_woreda_id, v_plan.rent_account_id, _payer_resident_id, _reference_number, _idempotency_key
  );

  FOR v_installment_id IN SELECT installment_id FROM _locked_installments LOOP
    INSERT INTO public.rent_payment_settlement (
      woreda_id, payment_id, rent_charge_id, settlement_amount, status, created_by
    )
    SELECT v_woreda_id, v_payment_id, lac.rent_charge_id, lac.total_amount, 'active', v_actor
      FROM _locked_arrears_charges lac
     WHERE lac.installment_id = v_installment_id;

    UPDATE public.rent_charge
       SET status = 'paid', settled_at = now(), settled_by_payment_id = v_payment_id
     WHERE rent_charge_id IN (
       SELECT rent_charge_id FROM _locked_arrears_charges WHERE installment_id = v_installment_id
     );

    UPDATE public.arrears_repayment_installment
       SET status = 'paid', settled_at = now(), settled_by_payment_id = v_payment_id
     WHERE installment_id = v_installment_id;
  END LOOP;

  INSERT INTO public.receipt (woreda_id, payment_id, receipt_date, total_amount, cash_bank_channel)
  VALUES (v_woreda_id, v_payment_id, _payment_date, _payment_amount, _channel);

  SELECT NOT EXISTS (
    SELECT 1 FROM public.arrears_repayment_installment
     WHERE plan_id = _plan_id AND status <> 'paid'
  ) INTO v_all_paid;

  IF v_all_paid THEN
    PERFORM set_config('app.system_transition', 'on', true);
    UPDATE public.arrears_repayment_plan SET status = 'completed' WHERE plan_id = _plan_id;
    PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);
  END IF;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rental_payment', v_payment_id::text, 'ARREARS_INSTALLMENT_SETTLED',
    jsonb_build_object('plan_id', _plan_id, 'amount', _payment_amount, 'installment_ids', _installment_ids));

  RETURN jsonb_build_object('status', 'settled', 'payment_id', v_payment_id);
END;
$function$;

-- ============================================================================
-- 5. reverse_rental_payment(): require a different actor than the original
--    collector, mirroring the resolver<>creator rule 00086 already applies
--    to reconciliation exceptions.
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
  v_prev_system_transition text := current_setting('app.system_transition', true);
  v_rp RECORD;
  v_payment_status text;
  v_posted_by uuid;
  v_reopened_count int;
  v_installments_reopened int := 0;
  v_affected_plan_ids uuid[];
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

  SELECT status, posted_by_user_id INTO v_payment_status, v_posted_by
    FROM public.payment WHERE payment_id = _payment_id AND woreda_id = v_woreda_id
    FOR UPDATE;

  IF v_payment_status = 'reversed' THEN
    RAISE EXCEPTION 'ይህ ክፍያ ቀደም ብሎ ተመላሽ ተደርጓል / This payment has already been reversed'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Round-6 fix: the same collector cannot reverse their own payment,
  -- mirroring the resolver<>creator rule already enforced for
  -- payment_reconciliation_exception (00086).
  IF v_actor IS NOT NULL AND v_posted_by IS NOT NULL AND v_actor = v_posted_by THEN
    RAISE EXCEPTION
      'ክፍያውን የሰበሰበው ሠራተኛ ራሱ ተመላሽ ማድረግ አይችልም / The clerk who collected this payment cannot also reverse it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM public.rent_charge
   WHERE rent_charge_id IN (
     SELECT rent_charge_id FROM public.rent_payment_settlement
      WHERE payment_id = _payment_id AND status = 'active'
   )
   ORDER BY rent_charge_id
     FOR UPDATE;

  PERFORM 1 FROM public.arrears_repayment_installment ai
   WHERE ai.installment_id IN (
     SELECT aic.installment_id
       FROM public.arrears_installment_charge aic
      WHERE aic.status = 'active'
        AND aic.rent_charge_id IN (
          SELECT rent_charge_id FROM public.rent_payment_settlement
           WHERE payment_id = _payment_id AND status = 'active'
        )
   )
   ORDER BY ai.installment_id
     FOR UPDATE;

  UPDATE public.rent_payment_settlement
     SET status = 'reversed'
   WHERE payment_id = _payment_id AND status = 'active';

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

  WITH reopened_installments AS (
    UPDATE public.arrears_repayment_installment ai
       SET status = CASE WHEN ai.due_date < current_date THEN 'overdue' ELSE 'due' END,
           settled_at = NULL, settled_by_payment_id = NULL
      FROM public.arrears_installment_charge aic
     WHERE aic.status = 'active'
       AND aic.rent_charge_id IN (
         SELECT rent_charge_id FROM public.rent_payment_settlement
          WHERE payment_id = _payment_id AND status = 'reversed'
       )
       AND aic.installment_id = ai.installment_id
       AND ai.status = 'paid'
    RETURNING ai.plan_id
  )
  SELECT count(*), array_agg(DISTINCT plan_id) INTO v_installments_reopened, v_affected_plan_ids
    FROM reopened_installments;

  IF v_affected_plan_ids IS NOT NULL AND array_length(v_affected_plan_ids, 1) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.arrears_repayment_plan
       WHERE rent_account_id = v_rp.rent_account_id
         AND status = 'active'
         AND plan_id <> ALL (v_affected_plan_ids)
    ) THEN
      RAISE EXCEPTION
        'ይህ ተመላሽ ቀደም ሲል የተጠናቀቀ የክፍያ ዕቅድ እንደገና ንቁ ማድረግ ይፈልጋል፣ ነገር ግን ይህ ሂሳብ ቀድሞውኑ ሌላ ንቁ ዕቅድ አለው -- በመጀመሪያ ያንን ዕቅድ ይያዙ / This reversal needs to reactivate a completed repayment plan, but this account already has a different active plan -- resolve that plan first'
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM set_config('app.system_transition', 'on', true);
    UPDATE public.arrears_repayment_plan
       SET status = 'active'
     WHERE plan_id = ANY (v_affected_plan_ids) AND status = 'completed';
    PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);
  END IF;

  PERFORM set_config('app.system_transition', 'on', true);
  UPDATE public.payment SET status = 'reversed' WHERE payment_id = _payment_id;
  PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rental_payment', _payment_id::text, 'RENTAL_PAYMENT_REVERSED',
    jsonb_build_object(
      'reason', _reason, 'charges_reopened', v_reopened_count,
      'arrears_installments_reopened', v_installments_reopened
    ));

  RETURN jsonb_build_object(
    'status', 'reversed', 'charges_reopened', v_reopened_count,
    'arrears_installments_reopened', v_installments_reopened
  );
END;
$function$;

COMMIT;
