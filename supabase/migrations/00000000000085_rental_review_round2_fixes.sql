-- Kebele Rental Houses Management -- second round of pre-merge fixes from a
-- final full-PR review (PR #83), after the first round (00084) landed.
--
-- 1. 00084's own guard_arrears_plan_maker_checker() rewrite over-widened its
--    condition (HIGH, self-inflicted). It changed
--    `OLD.status = 'submitted'` to `OLD.status IS DISTINCT FROM 'active'`,
--    which now also fires when reverse_rental_payment() (00082) flips a
--    completed plan back to 'active' as a system transition -- the reverser
--    is essentially never the plan's original approver, so every such
--    reversal now aborts on this guard. It also dropped 00081's
--    `requested_by_user_id IS NULL` check and its Amharic message/error
--    code. Restoring 00081's body verbatim.
--
-- 2. Separately, that same reversal was already broken before 00084: no
--    ('arrears_repayment_plan','completed','active') row has ever existed
--    in workflow_transition, so enforce_workflow_transition() rejects the
--    UPDATE outright regardless of the maker-checker guard or the
--    app.system_transition bypass (the bypass only affects whether a
--    *found* is_system row may be driven by a non-system caller -- it does
--    not stand in for a missing row). Seeding it as is_system=true, since
--    it must only ever happen via reverse_rental_payment()'s own GUC-guarded
--    system transition, never directly.
--
-- 3. rental_occupancy has no consistency guard on rental_house_id/
--    resident_id/household_id -- only woreda_id is checked by RLS
--    (baseline). rental_occupancy_request already gets this via
--    assert_rental_request_woreda_consistency() (00073); rental_occupancy
--    never did, and Phase 2+ now copies its ids into rent_account and (via
--    that) arrears_repayment_plan, so a direct insert with mismatched
--    ids (available to any rental.create/rental.approve holder, not only
--    the approval trigger) would let one woreda's financial records
--    permanently reference another woreda's house/resident/household rows.
--    Adding the same style of guard.
--
-- 4. provision_rent_account()'s kebele lookup has no woreda filter,
--    inheriting whatever cross-tenant kebele_id a bad rental_occupancy row
--    might carry once (3) is closed for new rows -- filtering it directly
--    removes the dependency on (3) holding forever.
--
-- 5. settle_rent_payment() lets a charge that is actively mapped into an
--    arrears_repayment_installment be settled directly, bypassing the
--    dedicated settle_arrears_installments() path entirely. That charge can
--    then never be settled through its installment (081's own immutability
--    guard rejects it), and the two functions lock rent_charge and
--    arrears_repayment_installment in opposite order, so the gap is also a
--    latent deadlock, not just a data-integrity issue. Excluding
--    plan-mapped charges from the direct-settlement lock set.
--
-- 6. payment.status for a rental_rent payment can be flipped directly by
--    any payment.collect/revenue.collect holder (finance_clerk) via a
--    bare PostgREST PATCH -- the baseline payment_update RLS policy checks
--    only woreda_id and that permission pair, with no column or value
--    restriction, and no trigger on payment ever guarded `status`. Before
--    this module, a payment's status carried no other side effects; now
--    reverse_rental_payment()'s entire reopen cascade (rent_charge,
--    settlement, installment, plan) hinges on payment.status actually
--    reflecting reality. A direct PATCH desyncs it: a payment PATCHed to
--    'reversed' still shows its charges as 'paid' and its settlements as
--    'active', and reverse_rental_payment() itself becomes unusable
--    (v_payment_status = 'reversed' is checked and rejected). Restricting
--    status changes on a rental_rent payment to the system-transition
--    context reverse_rental_payment() already runs under.
--
-- 7. A rental_occupancy_request can be INSERTed directly at status
--    'verified' with requested_by_user_id left NULL, defeating PD-07's
--    self-verification comparison (NEW.verified_by_user_id =
--    NEW.requested_by_user_id evaluates to NULL, not true, against a NULL
--    operand) -- the same class of gap 00074 closed for a stale/omitted
--    verifier, just reached through the requester side instead. Requiring
--    a non-NULL requester whenever a row enters 'verified'.
--
-- 8. The "Return to Submitter" action of a request in approval_returned
--    (src/routes/woreda.rental-houses.requests.$requestId.index.tsx) has no
--    corresponding workflow_transition row -- only submitted/under_review
--    -> returned were seeded (00058), never approval_returned -> returned.
--    A working UI button currently always raises. Seeding it.
--
-- 9. record_rental_checkpoint()'s AFTER trigger fires on `UPDATE OF`
--    service_type_id/resident_id/checkpoint_override/checkpoint_override_reason,
--    which Postgres triggers on the column being *assigned* in the SET
--    list, not on its value actually changing -- unlike the BEFORE
--    trigger's own explicit OLD/NEW comparison. A PATCH that resends the
--    same values (or is otherwise a no-op) still overwrites the checkpoint
--    snapshot with a fresh resolve, and if checkpoint_override was already
--    true, re-inserts a duplicate RENTAL_CHECKPOINT_OVERRIDE audit row.
--    Matching the BEFORE trigger's own actual-change guard.
--
-- 10. resolve_reconciliation_exception() only treats 'resolved' as
--    terminal; 'rejected' is a CHECK-legal status but was never made
--    terminal, so a rental.settle holder could still move a rejected
--    exception to under_review or resolved afterward. Matching 'resolved'.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1 & 2. Restore the narrow maker-checker guard and seed the missing edge.
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
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system)
VALUES ('arrears_repayment_plan', 'completed', 'active', NULL, true)
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ============================================================================
-- 3. rental_occupancy tenant-consistency guard, mirroring
--    assert_rental_request_woreda_consistency() (00073).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_rental_occupancy_woreda_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kebele_rental_house
    WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'rental_occupancy: rental_house_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.resident
    WHERE resident_id = NEW.resident_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'rental_occupancy: resident_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.household_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.household
    WHERE household_id = NEW.household_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'rental_occupancy: household_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assert_rental_occupancy_woreda_consistency ON public.rental_occupancy;
CREATE TRIGGER trg_assert_rental_occupancy_woreda_consistency
  BEFORE INSERT OR UPDATE ON public.rental_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.assert_rental_occupancy_woreda_consistency();

-- ============================================================================
-- 4. provision_rent_account(): scope the kebele lookup to the occupancy's
--    own woreda.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_rent_account(
  _occupancy_id uuid,
  _billing_start_period_key text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_occ RECORD;
  v_kebele_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.approve', 'rental.billing'])) THEN
    RAISE EXCEPTION 'provision_rent_account: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _billing_start_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION
      'ልክ ያልሆነ የክፍያ ወቅት / Invalid billing period'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_occ FROM public.rental_occupancy WHERE occupancy_id = _occupancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provision_rent_account: occupancy not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_super_admin() AND v_occ.woreda_id <> get_user_woreda_id() THEN
    RAISE EXCEPTION 'provision_rent_account: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_occ.status <> 'active' THEN
    RAISE EXCEPTION 'provision_rent_account: occupancy is not active' USING ERRCODE = 'check_violation';
  END IF;

  SELECT rent_account_id INTO v_existing_id
    FROM public.rent_account
   WHERE occupancy_id = _occupancy_id AND status = 'active';
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  SELECT kebele_id INTO v_kebele_id
    FROM public.kebele_rental_house
   WHERE rental_house_id = v_occ.rental_house_id AND woreda_id = v_occ.woreda_id;

  INSERT INTO public.rent_account (
    woreda_id, occupancy_id, rental_house_id, kebele_id, resident_id, household_id,
    status, billing_start_period_key, created_by
  ) VALUES (
    v_occ.woreda_id, v_occ.occupancy_id, v_occ.rental_house_id, v_kebele_id,
    v_occ.resident_id, v_occ.household_id,
    'active', _billing_start_period_key, v_actor
  )
  RETURNING rent_account_id INTO v_new_id;

  INSERT INTO public.rent_rate_history (
    woreda_id, rent_account_id, effective_period_key, monthly_amount,
    change_reason, status, approved_by, approved_at
  ) VALUES (
    v_occ.woreda_id, v_new_id, _billing_start_period_key, v_occ.rent_amount,
    'initial_rate', 'active', v_actor, now()
  );

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_occ.woreda_id, v_actor, 'rent_account', v_new_id::text, 'RENT_ACCOUNT_PROVISIONED',
    jsonb_build_object(
      'occupancy_id', _occupancy_id,
      'billing_start_period_key', _billing_start_period_key,
      'monthly_amount', v_occ.rent_amount
    ));

  RETURN v_new_id;
END;
$function$;

-- ============================================================================
-- 5. settle_rent_payment(): exclude charges already mapped into an active
--    arrears repayment installment -- those settle only through
--    settle_arrears_installments().
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

  SELECT * INTO v_account FROM public.rent_account WHERE rent_account_id = _rent_account_id;
  IF NOT FOUND OR v_account.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'settle_rent_payment: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF _payer_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.resident WHERE resident_id = _payer_resident_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'settle_rent_payment: payer resident not found in this woreda'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Fix (round 2): a charge already mapped into an active arrears
  -- installment is excluded here -- it only settles via
  -- settle_arrears_installments(), which is the only writer allowed to
  -- close an arrears_installment_charge mapping. Without this, a direct
  -- settlement here could pay a month a repayment plan still expects to
  -- collect, which then can never be marked settled through its own
  -- installment (081's immutability guard rejects it), and the two
  -- functions lock rent_charge and arrears_repayment_installment in
  -- opposite order.
  CREATE TEMP TABLE _locked_charges ON COMMIT DROP AS
  SELECT rent_charge_id, total_amount
    FROM public.rent_charge
   WHERE rent_charge_id = ANY (_rent_charge_ids)
     AND rent_account_id = _rent_account_id
     AND woreda_id = v_woreda_id
     AND status IN ('due', 'overdue')
     AND NOT EXISTS (
       SELECT 1 FROM public.arrears_installment_charge aic
        WHERE aic.rent_charge_id = rent_charge.rent_charge_id AND aic.status = 'active'
     )
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

-- ============================================================================
-- 6. Restrict payment.status changes on a rental_rent payment to the
--    system-transition context reverse_rental_payment() already runs
--    under. Direct client writes to payment for a rental_rent row still
--    go through, but never at all for the status column (nothing in this
--    module's own client code needs to write it -- only the definer RPC
--    does).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_rental_payment_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_type = 'rental_rent'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('app.system_transition', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'guard_rental_payment_status_change: a rental payment''s status can only change through reverse_rental_payment()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS yy_guard_rental_payment_status_change ON public.payment;
CREATE TRIGGER yy_guard_rental_payment_status_change
  BEFORE UPDATE OF status ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.guard_rental_payment_status_change();

-- reverse_rental_payment() restated only to wrap its own payment.status
-- update in the same system-transition GUC the guard above now requires --
-- by the time this line runs, the plan-reopen block earlier in the
-- function has already reset the GUC back to its entry value, so without
-- this the guard just added would block reverse_rental_payment() itself.
-- Everything else in this function is unchanged from 00082.
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

  -- Lock any arrears installment this payment settled, so a concurrent
  -- settle_arrears_installments() call can't interleave with the reopen
  -- below (mutually exclusive in practice -- one requires 'paid', the other
  -- 'due'/'overdue' -- but locked for the same discipline as the rest of
  -- this module).
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

  -- Reopen any arrears installment this payment had settled (BR-12/§16: a
  -- reversal is not a partial event -- the whole installment, and every
  -- charge it maps, goes back to outstanding together).
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

-- ============================================================================
-- 7. PD-07: require a non-NULL requester whenever a rental_occupancy_request
--    row enters 'verified' -- closes the requested_by_user_id = NULL bypass
--    of the self-verification comparison.
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

  IF NEW.request_type = 'new_registration'
     AND NEW.status IN ('submitted', 'under_review', 'verified', 'approved')
     AND (NEW.rent_amount IS NULL OR NEW.rent_amount <= 0) THEN
    RAISE EXCEPTION
      'ትክክለኛ የቤት ኪራይ ዋጋ ያስፈልጋል / A valid rent amount is required to submit this request';
  END IF;

  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'verified') THEN
    IF auth.uid() IS NOT NULL AND NEW.verified_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'ማረጋገጫውን የፈጸመው ተጠቃሚ በትክክል መመዝገብ አለበት / verified_by_user_id must be the user actually performing this verification';
    END IF;

    -- Round-2 fix: a NULL requester previously defeated the maker<>checker
    -- comparison below (verifier = NULL is NULL, never true), which an
    -- INSERT directly at status='verified' could set up on purpose.
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

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 8. Seed the missing approval_returned -> returned edge ("Return to
--    Submitter" on a request the approver already sent back once).
-- ============================================================================

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system)
VALUES ('rental_occupancy_request', 'approval_returned', 'returned', 'rental.create', false)
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ============================================================================
-- 9. record_rental_checkpoint(): skip on a column-list UPDATE that didn't
--    actually change any of the four columns it cares about, matching the
--    BEFORE trigger's own actual-change guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_rental_checkpoint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gated boolean;
  v_checkpoint jsonb;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.service_type_id IS NOT DISTINCT FROM OLD.service_type_id
     AND NEW.resident_id IS NOT DISTINCT FROM OLD.resident_id
     AND NEW.checkpoint_override IS NOT DISTINCT FROM OLD.checkpoint_override
     AND NEW.checkpoint_override_reason IS NOT DISTINCT FROM OLD.checkpoint_override_reason
  THEN
    RETURN NEW;
  END IF;

  SELECT rental_checkpoint_gated INTO v_gated
    FROM public.service_type WHERE service_type_id = NEW.service_type_id AND woreda_id = NEW.woreda_id;

  IF NOT COALESCE(v_gated, false) OR NEW.resident_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_checkpoint := public.resolve_rental_checkpoint_core(NEW.resident_id);

  INSERT INTO public.service_request_checkpoint (
    woreda_id, service_request_id, resident_id, rental_house_id, rent_account_id,
    has_active_occupancy, overdue_month_count, overdue_total, oldest_overdue_period,
    has_active_plan, active_plan_id, would_block, override_used, override_reason
  ) VALUES (
    NEW.woreda_id, NEW.service_request_id, NEW.resident_id,
    (v_checkpoint ->> 'rental_house_id')::uuid, (v_checkpoint ->> 'rent_account_id')::uuid,
    COALESCE((v_checkpoint ->> 'has_active_occupancy')::boolean, false),
    COALESCE((v_checkpoint ->> 'overdue_month_count')::int, 0),
    COALESCE((v_checkpoint ->> 'overdue_total')::numeric, 0),
    v_checkpoint ->> 'oldest_overdue_period',
    COALESCE((v_checkpoint ->> 'has_active_plan')::boolean, false),
    (v_checkpoint ->> 'active_plan_id')::uuid,
    COALESCE((v_checkpoint ->> 'would_block')::boolean, false),
    NEW.checkpoint_override,
    NEW.checkpoint_override_reason
  )
  ON CONFLICT (service_request_id) DO UPDATE SET
    rental_house_id = EXCLUDED.rental_house_id,
    rent_account_id = EXCLUDED.rent_account_id,
    has_active_occupancy = EXCLUDED.has_active_occupancy,
    overdue_month_count = EXCLUDED.overdue_month_count,
    overdue_total = EXCLUDED.overdue_total,
    oldest_overdue_period = EXCLUDED.oldest_overdue_period,
    has_active_plan = EXCLUDED.has_active_plan,
    active_plan_id = EXCLUDED.active_plan_id,
    would_block = EXCLUDED.would_block,
    override_used = EXCLUDED.override_used,
    override_reason = EXCLUDED.override_reason,
    resolved_at = now();

  IF NEW.checkpoint_override THEN
    INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
    VALUES (NEW.woreda_id, v_actor, 'service_request', NEW.service_request_id::text, 'RENTAL_CHECKPOINT_OVERRIDE',
      jsonb_build_object('reason', NEW.checkpoint_override_reason,
        'overdue_month_count', v_checkpoint ->> 'overdue_month_count',
        'overdue_total', v_checkpoint ->> 'overdue_total'));
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 10. resolve_reconciliation_exception(): 'rejected' is terminal too, same
--     as 'resolved'.
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

  IF v_current_status IN ('resolved', 'rejected') THEN
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

COMMIT;
