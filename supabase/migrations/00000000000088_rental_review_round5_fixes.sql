-- Kebele Rental Houses Management -- fifth round of pre-merge fixes, from the
-- round-5 dispatch of tenant-isolation, rbac-escalation, workflow-fsm and
-- rental-financial-integrity review over the diff through 00087. All four
-- agents independently found the same HIGH regression from 00087 itself;
-- workflow-fsm and rbac-escalation also found real gaps in 00087's own two
-- round-4 fixes.
--
-- 1. HIGH, confirmed by all 4 reviewers: 00087's new guard_rental_payment_
--    insert() trigger requires app.system_transition='on' for any
--    payment_type='rental_rent' INSERT, but only settle_rent_payment() was
--    updated to set that flag around its own insert. settle_arrears_
--    installments() (00081) also inserts a 'rental_rent' payment and never
--    sets the flag -- every arrears installment payment has been failing
--    outright since 00087 deployed. Restating it with the same set/restore
--    wrap settle_rent_payment() already got.
--
-- 2. HIGH (round-4 fix #1 was incomplete): 00087's approved_by_user_id pin
--    compares against the row's *current* verified_by_user_id, but nothing
--    made that column immutable once set -- a second PATCH (any rental.
--    create/approve/vacate holder) that merely reassigns it lets force_
--    actor_columns silently rewrite it to the new caller, defeating the
--    approver<>verifier comparison entirely: the verifier "reassigns"
--    verified_by_user_id to themselves (already themselves, a no-op value
--    that still counts as a fresh UPDATE) is not even needed -- a second
--    person edits it, then the *original* verifier approves and passes the
--    check against the now-wrong recorded verifier. Locking verified_by_
--    user_id and requested_by_user_id once set, in the same field-lock
--    block already added for rent_amount/rental_house_id/etc.
--
-- 3. MEDIUM (round-4 fix #1 gap): a request can be INSERTed directly at
--    status='approved' (or 'rejected') with no verifier at all -- 00087's
--    approver<>verifier check only fires when verified_by_user_id IS NOT
--    NULL, so a bare INSERT with it left NULL sails through and produces a
--    forged "approved by me, verified by nobody" row. Requiring INSERT to
--    land only in 'draft' or 'submitted', matching how every other request
--    actually enters the system.
--
-- 4. MEDIUM (round-4 fix #1 gap): the post-verification field lock covered
--    rent_amount/rental_house_id/resident_id/household_id/rent_start_date
--    but not request_type, existing_occupancy_id, termination_date or
--    termination_reason -- all four are read by apply_rental_occupancy_
--    on_approval() (00084), so a verified new_registration could still be
--    switched to a termination pointed at the house's own active occupancy
--    before approval, which the same-house consistency check alone doesn't
--    catch. Locking these into the same block.
--
-- 5. LOW: unlike arrears_repayment_plan (guard_arrears_plan_maker_checker),
--    nothing stopped the same person from being both requester and
--    approver of a rental_occupancy_request -- only requester<>verifier and
--    verifier<>approver were enforced. docs/rental-policy-decisions.md
--    documents three distinct actors. Adding the same requester<>approver
--    check already used for arrears plans.
--
-- 6. LOW: reverse_rental_payment()'s round-4 collision check (00087) only
--    catches the case where the *other* plan is already 'active' -- if it
--    is still 'submitted' when the reversal reopens the completed plan, the
--    later approval of that submitted plan hits the same
--    arrears_repayment_plan_one_active_per_account collision as a raw,
--    unreadable unique_violation instead. Adding the same clear-exception
--    check to guard_arrears_plan_maker_checker()'s own submitted->active
--    transition, so both directions of this same collision get an
--    actionable bilingual message instead of a raw constraint error.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. settle_arrears_installments(): wrap the payment insert in the same
--    system-transition GUC settle_rent_payment() already uses, so 00087's
--    guard_rental_payment_insert() trigger allows it. Restated verbatim from
--    00081 with only that one addition.
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

  SELECT * INTO v_plan FROM public.arrears_repayment_plan WHERE plan_id = _plan_id;
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

  -- Round-5 fix: wrap in the system-transition GUC so 00087's
  -- guard_rental_payment_insert() trigger allows this insert.
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
-- 2. enforce_rental_request_integrity_guards(): lock verified_by_user_id and
--    requested_by_user_id once set, widen the post-verification field lock,
--    require INSERT to land only in draft/submitted, and add
--    requester<>approver to the existing requester<>verifier /
--    verifier<>approver checks.
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

  -- Round-5 fix: every request enters the system as draft or submitted --
  -- nothing legitimately creates one already verified/approved/rejected.
  -- Without this, 00087's approver<>verifier check could be sidestepped by
  -- INSERTing straight into 'approved' with verified_by_user_id left NULL.
  IF TG_OP = 'INSERT' AND NEW.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION
      'አዲስ ጥያቄ በ''ረቂቅ'' ወይም ''ገብቷል'' ሁኔታ ብቻ መጀመር አለበት / A new request must start as draft or submitted'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.request_type = 'new_registration'
     AND NEW.status IN ('submitted', 'under_review', 'verified', 'approved')
     AND (NEW.rent_amount IS NULL OR NEW.rent_amount <= 0) THEN
    RAISE EXCEPTION
      'ትክክለኛ የቤት ኪራይ ዋጋ ያስፈልጋል / A valid rent amount is required to submit this request';
  END IF;

  -- Round-5 fix: requested_by_user_id and verified_by_user_id are each
  -- immutable once set -- otherwise a second PATCH from any rental.create/
  -- approve/vacate holder can reassign either one and desync it from who
  -- actually performed that step, defeating every maker-checker comparison
  -- that reads them later (requester<>verifier, verifier<>approver, and
  -- 00087's approved_by_user_id<>verified_by_user_id pin).
  IF TG_OP = 'UPDATE' THEN
    IF OLD.requested_by_user_id IS NOT NULL
       AND NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያቀረበው ሠራተኛ ከተመዘገበ በኋላ መቀየር አይቻልም / requested_by_user_id cannot change once recorded'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.verified_by_user_id IS NOT NULL
       AND NEW.verified_by_user_id IS DISTINCT FROM OLD.verified_by_user_id THEN
      RAISE EXCEPTION
        'ያረጋገጠው ሠራተኛ ከተመዘገበ በኋላ መቀየር አይቻልም / verified_by_user_id cannot change once recorded'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Round-4 fix, widened in round 5: once a request has been verified (or
  -- moved past it), every field the verification checklist and the
  -- approval trigger actually act on is locked -- request_type,
  -- existing_occupancy_id, termination_date and termination_reason are all
  -- read by apply_rental_occupancy_on_approval() (00084) and were missing
  -- from the original round-4 lock.
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
        'ተረጋግጦ ከተላለፈ በኋላ የቤት ኪራይ ዋጋ ወይም ተያያዥ መረጃ መቀየር አይቻልም / Rent amount and linked house/resident/start date cannot change once this request has been verified'
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

  -- Round-4 fix, hardened in round 5: approved_by_user_id is pinned to the
  -- real caller, the approver may not also be the verifier, and (round 5)
  -- may not also be the requester -- mirroring guard_arrears_plan_maker_
  -- checker()'s requester<>approver check. A NULL verifier is now also
  -- rejected outright: combined with the INSERT restriction above, this
  -- closes the direct-INSERT-into-approved forged-approval path.
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
-- 3. guard_arrears_plan_maker_checker(): raise a clear exception on the
--    submitted->active transition too, mirroring reverse_rental_payment()'s
--    round-4 check, for the case where the OTHER plan on this account is
--    still 'submitted' (not yet 'active') when this one is approved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_arrears_plan_maker_checker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'submitted' THEN
    IF NEW.approved_by_user_id IS NULL THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: an approval must record the approver'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.requested_by_user_id IS NULL THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: a plan missing its preparer cannot be activated'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.approved_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: approved_by_user_id must be the caller'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያዘጋጀው ሠራተኛ ራሱ ማፅደቅ አይችልም / The clerk who prepared this plan cannot also approve it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Round-5 fix: the same arrears_repayment_plan_one_active_per_account
    -- collision reverse_rental_payment() now guards against (00087) can
    -- also happen here, the other direction -- this plan approving to
    -- 'active' while a different, earlier-completed plan on the same
    -- account is currently 'active' because a reversal already reopened
    -- it. Surface the same clear, actionable message instead of a raw
    -- unique_violation.
    IF EXISTS (
      SELECT 1 FROM public.arrears_repayment_plan
       WHERE rent_account_id = NEW.rent_account_id
         AND status = 'active'
         AND plan_id <> NEW.plan_id
    ) THEN
      RAISE EXCEPTION
        'ይህ ሂሳብ ቀድሞውኑ ሌላ ንቁ የክፍያ ዕቅድ አለው -- በመጀመሪያ ያንን ዕቅድ ይያዙ / This account already has a different active repayment plan -- resolve that plan first'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
