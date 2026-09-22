-- Kebele Rental Houses Management -- Phase 4 follow-up: fixes from the six
-- review agents dispatched on 00000000000080 (tenant-isolation-review,
-- rbac-escalation-review, rental-financial-integrity-review,
-- workflow-fsm-review, portal-conventions-review, secret-sweep).
--
-- 1. guard_arrears_plan_maker_checker(): the equality check
--    `NEW.approved_by_user_id = NEW.requested_by_user_id` evaluates to NULL
--    (not TRUE) when either side is NULL, and force_actor_columns() never
--    re-pins a column whose incoming value is NULL -- so a client could PATCH
--    {status:'active', approved_by_user_id:<self>, requested_by_user_id:null}
--    and slip past the maker!=checker guard entirely (rbac-escalation-review
--    F1, workflow-fsm-review #3). Both actor columns are now required
--    non-NULL before the comparison runs.
--
-- 2. New guard_arrears_plan_immutable_fields() trigger: the UPDATE RLS policy
--    is column-blind (any of the three rental.plan.* permissions may write
--    any column), and enforce_workflow_transition() only polices status
--    changes -- so a finance_clerk holding only rental.plan.create could
--    rewrite original_arrears_amount/assigned_arrears_amount/
--    installment_count/rent_account_id/resident_id on an active plan with no
--    audit trail (financial-integrity-review #1, tenant-isolation-review #1,
--    rbac-escalation-review F3). Also protects requested_by_user_id once set,
--    closing the same hole finding 1 fixes from the other direction.
--
-- 3. create_arrears_repayment_plan(): validate installment_count against the
--    actual number of unassigned overdue charges before NTILE-bucketing --
--    requesting more installments than there are charges previously produced
--    a plan whose installment_count overstated its own schedule
--    (financial-integrity-review, minor finding).
--
-- 4. settle_arrears_installments(): the mapped rent_charge rows were updated
--    by a bare `WHERE rent_charge_id IN (...)`, never locked and never
--    re-checked for status -- unlike Phase 3's settle_rent_payment(), which
--    locks rent_charge FOR UPDATE. A charge inside an active installment
--    could still be offered (and settled) through the plain per-charge
--    settlement path on the same ledger page, risking a double-settlement
--    race (financial-integrity-review #2). Now locks every mapped charge
--    FOR UPDATE ORDER BY rent_charge_id and rejects if any is no longer
--    due/overdue. Also restores app.system_transition to whatever it was on
--    entry, matching the pattern migration 74 already established, instead
--    of unconditionally blanking it.
--
-- 5. refresh_rent_ledger_statuses(): was gated on rental.view (a read
--    permission held by auditor/viewer) despite mutating rent_charge and
--    installment status tenant-wide -- every sibling generator in this
--    module gates on rental.billing (tenant-isolation-review #2,
--    workflow-fsm-review #5, financial-integrity-review #5). Now gated on
--    rental.billing, and logs an audit_log row like every other mutating RPC
--    in this module.
--
-- 6. workflow_transition: added returned -> cancelled (rental.plan.create).
--    A plan sent back for revision had no way to be abandoned -- the UI's
--    own Cancel button on a returned plan raised "may not move from returned
--    to cancelled" (tenant-isolation-review #4, workflow-fsm-review #2,
--    portal-conventions-review). The maker's Cancel action on their own
--    still-submitted plan (submitted -> cancelled, already seeded in 080) was
--    also never exposed in the UI -- fixed there, not here.
--
-- 7. New release_arrears_plan_charges() trigger: leaving 'active' for
--    'defaulted' or 'cancelled' (or 'submitted' -> 'cancelled') never
--    released the plan's arrears_installment_charge mappings, so those
--    charges stayed permanently excluded from any future plan --
--    create_arrears_repayment_plan() would then refuse with "no unassigned
--    overdue charges" even though the arrears were fully outstanding
--    (financial-integrity-review #6, workflow-fsm-review #4). Now cancels
--    the plan's still-active mappings and non-paid installments alongside
--    the plan itself.
--
-- 8. arrears_repayment_plan was missing the encryption pattern its own
--    _enc columns implied -- both original_arrears_amount_enc and
--    assigned_arrears_amount_enc were declared but never synced, no
--    decrypted view existed, and the table was absent from the
--    security_invoker regression assertion (financial-integrity-review #3).
--    Added the sync trigger, the view, and the assertion entry, matching the
--    other three new tables in 080.
--
-- 9. Data fix: role_permission had finance_clerk/rental.view = false in
--    every existing woreda (a pre-existing override that predates this
--    phase), silently defeating the rental.view finance_clerk has held in
--    default_role_perms() since Phase 3 -- rent_account/rent_charge SELECT
--    is gated on rental.view alone, so a finance_clerk could already not see
--    the rent ledger page at all despite holding rental.collect/settle, and
--    Phase 4's new rental.plan.create grant would have been equally
--    unreachable (tenant-isolation-review #3). Flipped to match the
--    compiled/SQL default; supabase/seed.sql updated in the same change.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. Maker != checker: require both actor columns non-NULL before comparing.
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
    IF NEW.approved_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያዘጋጀው ሠራተኛ ራሱ ማፅደቅ አይችልም / The clerk who prepared this plan cannot also approve it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 2. Immutable-fields guard: money, counts and identity columns cannot be
--    edited after creation; requested_by_user_id cannot be cleared/changed
--    once recorded (belt-and-suspenders alongside fix 1). Fires between
--    trg_force_actor and yy_guard_arrears_plan_maker_checker (alphabetical:
--    trg_ < uu_ < yy_ < zz_), so a nulled requested_by_user_id is rejected
--    here before the maker-checker comparison ever sees it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_arrears_plan_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rent_account_id IS DISTINCT FROM OLD.rent_account_id
     OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
     OR NEW.plan_number IS DISTINCT FROM OLD.plan_number
     OR NEW.original_arrears_amount IS DISTINCT FROM OLD.original_arrears_amount
     OR NEW.assigned_arrears_amount IS DISTINCT FROM OLD.assigned_arrears_amount
     OR NEW.installment_count IS DISTINCT FROM OLD.installment_count
  THEN
    RAISE EXCEPTION
      'የክፍያ ዕቅድ የገንዘብ መጠን ወይም ተያያዥ መስኮች ከተፈጠሩ በኋላ ሊቀየሩ አይችሉም / A plan''s amount, installment count and account/resident linkage cannot be changed after creation'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.requested_by_user_id IS NOT NULL AND NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id THEN
    RAISE EXCEPTION 'guard_arrears_plan_immutable_fields: requested_by_user_id cannot be changed once recorded'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS uu_guard_arrears_plan_immutable_fields ON public.arrears_repayment_plan;
CREATE TRIGGER uu_guard_arrears_plan_immutable_fields
  BEFORE UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.guard_arrears_plan_immutable_fields();

-- ============================================================================
-- 3 & 4. create_arrears_repayment_plan() / settle_arrears_installments():
--    full redefinitions with the fixes described above.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_arrears_repayment_plan(
  _rent_account_id uuid,
  _installment_count integer,
  _installment_due_dates date[],
  _reason text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_account RECORD;
  v_max_installments integer;
  v_total numeric(14, 2);
  v_available_count integer;
  v_plan_id uuid;
  v_prev_date date;
  d date;
  r RECORD;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.plan.create'])) THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _installment_count IS NULL OR _installment_count < 1 THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: installment_count must be at least 1'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _installment_due_dates IS NULL OR array_length(_installment_due_dates, 1) <> _installment_count THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: exactly one due date is required per installment'
      USING ERRCODE = 'check_violation';
  END IF;

  v_prev_date := NULL;
  FOREACH d IN ARRAY _installment_due_dates LOOP
    IF v_prev_date IS NOT NULL AND d <= v_prev_date THEN
      RAISE EXCEPTION 'create_arrears_repayment_plan: installment due dates must strictly increase'
        USING ERRCODE = 'check_violation';
    END IF;
    v_prev_date := d;
  END LOOP;

  SELECT * INTO v_account FROM public.rent_account WHERE rent_account_id = _rent_account_id;
  IF NOT FOUND OR v_account.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arrears_repayment_plan WHERE rent_account_id = _rent_account_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ይህ ሂሳብ ቀድሞ ንቁ የክፍያ ዕቅድ አለው / This account already has an active repayment plan'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT plan_max_installments INTO v_max_installments
    FROM public.rental_policy WHERE woreda_id = v_woreda_id;
  IF v_max_installments IS NOT NULL AND _installment_count > v_max_installments THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: installment_count exceeds this tenant''s plan_max_installments (%)', v_max_installments
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only overdue, unassigned charges enter a plan (plan section 16). Locked
  -- first (FOR UPDATE cannot combine with a window function in the same
  -- query), then bucketed into installment_count groups in a second pass
  -- over the already-locked rows.
  CREATE TEMP TABLE _locked_overdue_charges ON COMMIT DROP AS
  SELECT rc.rent_charge_id, rc.total_amount, rc.ethiopian_period_key
    FROM public.rent_charge rc
   WHERE rc.rent_account_id = _rent_account_id
     AND rc.woreda_id = v_woreda_id
     AND rc.status = 'overdue'
     AND NOT EXISTS (
       SELECT 1 FROM public.arrears_installment_charge aic
        WHERE aic.rent_charge_id = rc.rent_charge_id AND aic.status = 'active'
     )
   ORDER BY rc.ethiopian_period_key
     FOR UPDATE OF rc;

  SELECT count(*) INTO v_available_count FROM _locked_overdue_charges;

  IF v_available_count = 0 THEN
    RAISE EXCEPTION 'ይህ ሂሳብ ወደ ዕቅድ የሚገባ ያለፈ ጊዜ ክፍያ የለውም / This account has no unassigned overdue charges to place on a plan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _installment_count > v_available_count THEN
    RAISE EXCEPTION
      'create_arrears_repayment_plan: installment_count (%) exceeds the number of unassigned overdue charges (%)',
      _installment_count, v_available_count
      USING ERRCODE = 'check_violation';
  END IF;

  CREATE TEMP TABLE _plan_charges ON COMMIT DROP AS
  SELECT rent_charge_id, total_amount,
         NTILE(_installment_count) OVER (ORDER BY ethiopian_period_key) AS bucket
    FROM _locked_overdue_charges;

  SELECT sum(total_amount) INTO v_total FROM _plan_charges;

  INSERT INTO public.arrears_repayment_plan (
    woreda_id, rent_account_id, resident_id, original_arrears_amount,
    assigned_arrears_amount, installment_count, status, reason, requested_by_user_id
  ) VALUES (
    v_woreda_id, _rent_account_id, v_account.resident_id, v_total,
    v_total, _installment_count, 'submitted', _reason, v_actor
  )
  RETURNING plan_id INTO v_plan_id;

  FOR r IN
    SELECT bucket, sum(total_amount) AS bucket_amount
      FROM _plan_charges
     GROUP BY bucket
     ORDER BY bucket
  LOOP
    INSERT INTO public.arrears_repayment_installment (
      woreda_id, plan_id, installment_number, due_date, amount, status
    ) VALUES (
      v_woreda_id, v_plan_id, r.bucket, _installment_due_dates[r.bucket], r.bucket_amount, 'scheduled'
    );

    INSERT INTO public.arrears_installment_charge (
      woreda_id, installment_id, rent_charge_id, charge_amount_snapshot, status
    )
    SELECT v_woreda_id,
           (SELECT installment_id FROM public.arrears_repayment_installment
             WHERE plan_id = v_plan_id AND installment_number = r.bucket),
           pc.rent_charge_id, pc.total_amount, 'active'
      FROM _plan_charges pc
     WHERE pc.bucket = r.bucket;
  END LOOP;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'arrears_repayment_plan', v_plan_id::text, 'ARREARS_PLAN_CREATED',
    jsonb_build_object('rent_account_id', _rent_account_id, 'total_arrears', v_total, 'installment_count', _installment_count));

  RETURN v_plan_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_arrears_repayment_plan(uuid, integer, date[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_arrears_repayment_plan(uuid, integer, date[], text) TO authenticated, service_role;

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

  -- Lock every rent_charge this batch of installments maps and re-check its
  -- status -- the same discipline settle_rent_payment() already applies to
  -- direct charge settlement, closing the race where a plan-mapped charge
  -- could be settled a second time through the direct-charge path.
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

  -- Plan completion is a system consequence of every installment being
  -- paid, never a client-driven transition. Restore whatever
  -- app.system_transition was set to on entry rather than unconditionally
  -- blanking it (the same fix migration 74 already made for
  -- apply_rental_occupancy_on_approval()).
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

REVOKE EXECUTE ON FUNCTION public.settle_arrears_installments(uuid, uuid[], numeric, date, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_arrears_installments(uuid, uuid[], numeric, date, text, text, uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 5. refresh_rent_ledger_statuses(): gate on rental.billing, not rental.view;
--    log an audit_log row like every other mutating RPC in this module.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_rent_ledger_statuses()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_charges_aged int;
  v_installments_aged int;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'refresh_rent_ledger_statuses: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.billing'])) THEN
    RAISE EXCEPTION 'refresh_rent_ledger_statuses: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH aged AS (
    UPDATE public.rent_charge
       SET status = 'overdue'
     WHERE woreda_id = v_woreda_id AND status = 'due' AND due_date < current_date
     RETURNING rent_charge_id
  )
  SELECT count(*) INTO v_charges_aged FROM aged;

  WITH aged AS (
    UPDATE public.arrears_repayment_installment
       SET status = 'overdue'
     WHERE woreda_id = v_woreda_id AND status = 'due' AND due_date < current_date
     RETURNING installment_id
  )
  SELECT count(*) INTO v_installments_aged FROM aged;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rent_charge', 'RENT_LEDGER_STATUSES_REFRESHED',
    jsonb_build_object('charges_aged', v_charges_aged, 'installments_aged', v_installments_aged));

  RETURN jsonb_build_object('charges_aged', v_charges_aged, 'installments_aged', v_installments_aged);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_rent_ledger_statuses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_rent_ledger_statuses() TO authenticated, service_role;

-- ============================================================================
-- 6. A returned plan had no way to be abandoned.
-- ============================================================================

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system)
VALUES
  ('arrears_repayment_plan', 'returned', 'cancelled', 'rental.plan.create', false)
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ============================================================================
-- 7. Release a plan's charge mappings and non-paid installments when it
--    leaves 'active' for 'defaulted'/'cancelled', or is cancelled straight
--    from 'submitted' -- otherwise those charges are permanently excluded
--    from any future plan.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.release_arrears_plan_charges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('cancelled', 'defaulted') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.arrears_installment_charge
       SET status = 'cancelled'
     WHERE status = 'active'
       AND installment_id IN (
         SELECT installment_id FROM public.arrears_repayment_installment WHERE plan_id = NEW.plan_id
       );

    UPDATE public.arrears_repayment_installment
       SET status = 'cancelled'
     WHERE plan_id = NEW.plan_id
       AND status IN ('scheduled', 'due', 'overdue');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzz_release_arrears_plan_charges ON public.arrears_repayment_plan;
CREATE TRIGGER zzzz_release_arrears_plan_charges
  AFTER UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.release_arrears_plan_charges();

-- ============================================================================
-- 8. Encryption pattern for arrears_repayment_plan, matching the other three
--    new tables in 080.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.arrears_repayment_plan_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.original_arrears_amount_enc := public.encrypt_pii_numeric(NEW.original_arrears_amount, NEW.woreda_id);
  NEW.assigned_arrears_amount_enc := public.encrypt_pii_numeric(NEW.assigned_arrears_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS arrears_repayment_plan_amount_sync_trg ON public.arrears_repayment_plan;
CREATE TRIGGER arrears_repayment_plan_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.arrears_repayment_plan_amount_sync();

-- One-time backfill for the plan rows created before this trigger existed.
UPDATE public.arrears_repayment_plan
   SET original_arrears_amount = original_arrears_amount
 WHERE original_arrears_amount_enc IS NULL;

DROP VIEW IF EXISTS public.arrears_repayment_plan_decrypted;
CREATE VIEW public.arrears_repayment_plan_decrypted
  WITH (security_invoker = on) AS
  SELECT p.*,
         public.decrypt_pii_numeric(p.original_arrears_amount_enc, p.woreda_id) AS original_arrears_amount_decrypted,
         public.decrypt_pii_numeric(p.assigned_arrears_amount_enc, p.woreda_id) AS assigned_arrears_amount_decrypted
  FROM public.arrears_repayment_plan p;

REVOKE ALL ON public.arrears_repayment_plan_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.arrears_repayment_plan_decrypted TO authenticated, service_role;

-- ============================================================================
-- 9. Data fix: finance_clerk's per-tenant rental.view override predates this
--    phase and disagreed with default_role_perms() -- flip to match.
-- ============================================================================

UPDATE public.role_permission
   SET is_granted = true, updated_at = now()
 WHERE role_name = 'finance_clerk' AND permission_key = 'rental.view' AND is_granted = false;

-- ============================================================================
-- 10. Extend the security_invoker regression assertion to this migration's
--     one new decrypted view.
-- ============================================================================

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
    'rent_payment_settlement_decrypted', 'payment_reconciliation_exception_decrypted',
    'arrears_repayment_installment_decrypted', 'arrears_installment_charge_decrypted',
    'rent_reminder_decrypted', 'arrears_repayment_plan_decrypted'
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
