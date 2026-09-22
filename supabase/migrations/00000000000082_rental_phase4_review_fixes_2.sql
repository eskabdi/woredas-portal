-- Kebele Rental Houses Management -- Phase 4 follow-up round 2: findings from
-- re-reviewing 00000000000081 (rental-financial-integrity-review).
--
-- 1. reverse_rental_payment() (Phase 3, migration 079) had no awareness of
--    arrears installments/plans. Reversing a payment that had settled an
--    arrears installment reopened the underlying rent_charge rows but left
--    the installment 'paid', its arrears_installment_charge mapping
--    'active', and (if the plan had just completed) the plan 'completed' --
--    the reopened charges then had no path back to being collectable at all:
--    the direct per-charge settlement table excludes any charge with an
--    active plan mapping (Phase 4's own review-1 fix), and
--    create_arrears_repayment_plan() refuses "no unassigned overdue
--    charges" because the mapping is still active. Now reopens the mapped
--    installment (paid -> due/overdue by its own due_date, matching the
--    existing rent_charge reopen logic) and, if that un-completes a plan,
--    flips it back to 'active' as a system transition.
--
-- 2. create_arrears_repayment_plan() locked its charges
--    `ORDER BY ethiopian_period_key`, while every other function that locks
--    rent_charge (settle_rent_payment, reverse_rental_payment, and this
--    migration's own settle_arrears_installments) locks
--    `ORDER BY rent_charge_id`. The two lock sets genuinely overlap
--    (unassigned overdue charges are exactly what the direct settlement
--    path also offers), so two concurrent transactions could acquire the
--    same rows in different orders and deadlock. Now locks in the same
--    rent_charge_id order as everywhere else; the chronological NTILE
--    bucketing is unaffected -- it is a separate query over the
--    already-locked rows.
--
-- 3. guard_arrears_plan_immutable_fields() protected requested_by_user_id
--    but not approved_by_user_id/approval_decision_at -- a holder of any one
--    of the three rental.plan.* permissions could still PATCH
--    {approved_by_user_id: null} on an already-active plan (status
--    unchanged, so neither the maker-checker guard nor
--    enforce_workflow_transition fires) and erase the maker-checker
--    evidence fix 1 of migration 081 exists to guarantee. Now blocked from
--    being cleared to NULL (not from being reassigned -- these two columns
--    legitimately take a new non-null value at each decision point: a
--    return, then later an approval, possibly by a different actor).
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. reverse_rental_payment(): also reopen any arrears installment the
--    reversed payment had settled, and un-complete its plan if needed.
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

  UPDATE public.payment SET status = 'reversed' WHERE payment_id = _payment_id;

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

REVOKE EXECUTE ON FUNCTION public.reverse_rental_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_rental_payment(uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 2. create_arrears_repayment_plan(): lock in rent_charge_id order, matching
--    every other function that locks rent_charge.
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

  -- Locked in rent_charge_id order -- the same order settle_rent_payment(),
  -- reverse_rental_payment() and settle_arrears_installments() already use
  -- -- to avoid a deadlock against a concurrent transaction locking an
  -- overlapping set of the same (still-unassigned) overdue charges in a
  -- different order. Bucketed into installment_count groups chronologically
  -- in a second pass (FOR UPDATE cannot combine with a window function in
  -- the same query).
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
   ORDER BY rc.rent_charge_id
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

-- ============================================================================
-- 3. guard_arrears_plan_immutable_fields(): also pin approved_by_user_id and
--    approval_decision_at once recorded.
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

  -- approved_by_user_id/approval_decision_at legitimately change at each
  -- decision point (a return, then later an approval, possibly by a
  -- different actor) -- so only clearing them to NULL is blocked, matching
  -- enforce_workflow_transition()'s own semantics for approved_by_user_id
  -- (00000000000046, "cannot be cleared once recorded"). That check only
  -- runs on a status-changing update; this one runs on every update, so it
  -- also covers a status-unchanged PATCH.
  IF OLD.approved_by_user_id IS NOT NULL AND NEW.approved_by_user_id IS NULL THEN
    RAISE EXCEPTION 'guard_arrears_plan_immutable_fields: approved_by_user_id cannot be cleared once recorded'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.approval_decision_at IS NOT NULL AND NEW.approval_decision_at IS NULL THEN
    RAISE EXCEPTION 'guard_arrears_plan_immutable_fields: approval_decision_at cannot be cleared once recorded'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
