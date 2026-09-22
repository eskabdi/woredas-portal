-- Kebele Rental Houses Management -- fourth round of pre-merge fixes, from
-- the final tenant-isolation and rental-financial-integrity passes over the
-- full accumulated diff (after 00084-00086 had already landed).
--
-- 1. provision_rent_account()'s tenant check used `<>` instead of
--    `IS DISTINCT FROM` -- `NULL <> x` is NULL, not TRUE, so a caller whose
--    own app_user.woreda_id is NULL (a malformed non-super-admin account;
--    the column has no NOT NULL constraint) would pass the check. This
--    exact idiom traces back to the function's original Phase 2 body
--    (00076) and was carried forward unchanged through every restatement
--    since -- 00053 already uses the correct IS DISTINCT FROM elsewhere in
--    this codebase. Fixing it here since this round already touches the
--    function.
--
-- 2. rental_occupancy_request's rent_amount (and the other fields the
--    verification checklist signs off on: rental_house_id, resident_id,
--    household_id, rent_start_date) could still be changed by a
--    rental.create/rental.approve/rental.vacate holder on a request that
--    had already been verified -- 00086 locked rental_occupancy itself to
--    SELECT-only for clients, but the request table one step upstream had
--    no such guard, and the approval trigger copies these fields straight
--    into the occupancy and from there into billing. Locking them once a
--    request is verified or later.
--
-- 3. create_arrears_repayment_plan() and get_rent_account_ledger_summary()
--    only counted status='overdue' charges -- but nothing in this app ever
--    calls refresh_rent_ledger_statuses() to set that status (00083's own
--    header already flagged this for the checkpoint/aging-report queries
--    it fixed; this is the same gap in the two functions that weren't
--    touched then). In practice this makes repayment-plan creation
--    unreachable: an account can be arrears-eligible by every other
--    measure and still show zero "unassigned overdue charges" to place on
--    a plan. Widening both to the same live-overdue definition already
--    established in 00083/00085/00086 (status='overdue' OR (status='due'
--    AND due_date < current_date)).
--
-- 4. Nothing stopped a direct client INSERT into payment with
--    payment_type='rental_rent' -- 00085/00086's guard only fires on
--    UPDATE. Such a row has no rental_payment/settlement record and can
--    never be reversed (reverse_rental_payment() requires a rental_payment
--    row). Restricting rental_rent creation to the system-transition
--    context settle_rent_payment() already runs under, and wrapping its
--    own payment insert in that same GUC.
--
-- 5. A race between create_arrears_repayment_plan() and settle_rent_payment()
--    on the same charge: the plan function only locks the charges it
--    assigns (FOR UPDATE), it never writes to rent_charge itself, so a
--    concurrent settle_rent_payment() blocked on the same row resumes
--    after the plan commits and evaluates its "not already plan-mapped"
--    check against a query snapshot taken before that commit (READ
--    COMMITTED takes its snapshot at statement start; FOR UPDATE's
--    row-level re-fetch on unblock does not extend to a NOT EXISTS
--    subquery against a different table in the same statement). The
--    charge then settles directly while still mapped to an active
--    installment, which can never be marked settled through that
--    installment. Splitting settle_rent_payment()'s charge selection into
--    an acquire-locks step followed by a separate existence check, so the
--    second query runs after the locks are confirmed held and sees
--    whatever committed in between.
--
-- 6. rental_occupancy_request.approved_by_user_id has no maker-checker or
--    caller-pin guard at all -- enforce_workflow_transition()'s generic
--    version of this check is wired only to credential_request and
--    residence_credential (00026's own v_policed/WHEN-clause pair), never to
--    rental_occupancy_request. A cooperating requester/verifier pair could
--    approve their own request: PATCH approved_by_user_id to any user_id, or
--    omit it and rely on force_actor_columns's INSERT-only behavior on a
--    resubmit. Adding the same pin (approved_by_user_id must equal the real
--    caller on every fresh entry into 'approved') and maker<>checker
--    (approver <> verifier) already applied to verified_by_user_id in
--    enforce_rental_request_integrity_guards() and to
--    arrears_repayment_plan in guard_arrears_plan_maker_checker().
--
-- 7. create_arrears_repayment_plan()'s "already has an active plan" check
--    only excludes status='active' -- if plan A completes (every
--    installment paid) and a new plan B is then created and made active,
--    reversing the payment that completed plan A's *last* installment
--    still tries to flip plan A back to 'active' (reverse_rental_payment(),
--    085/086), which now collides with plan B under
--    arrears_repayment_plan_one_active_per_account. The underlying
--    ambiguity (does reopening plan A also require doing something about
--    plan B?) is a product decision, so rather than silently pick one
--    (auto-suspend plan B, or block plan B's creation entirely -- both
--    change legitimate behavior for accounts that will never see a
--    reversal), reverse_rental_payment() now raises a clear, actionable
--    exception before touching anything if this specific conflict is about
--    to happen, instead of surfacing Postgres's own unique_violation.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
--
-- Known, larger gaps from this same final review round, deliberately not
-- fixed here (need a product decision, not a review-fix migration):
--   - Terminating an occupancy never sets rent_account.billing_end_period_key,
--     so the termination month (and any prior unbilled month) is never
--     charged, and a terminated account's own unpaid charges are
--     unreachable from the UI (the ledger page only loads status='active').
--   - The Reports page's rental paid/unpaid count still reads
--     payment.rental_request_id (src/hooks/useReportsAggregate.ts), which
--     the new settle_rent_payment()/rental_payment path never sets --
--     every currently-tenanted house shows as unpaid there regardless of
--     its actual rent_charge state.
--   - Direct payment.INSERT for other linkage columns
--     (household_id/channel/reference_no/service_request_id/
--     credential_request_id/rental_request_id) is still open to any
--     payment.collect/revenue.collect holder on a rental_rent row, same as
--     it always was for every other payment type in this table.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. NULL-safe tenant check in provision_rent_account().
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
  v_woreda_id uuid := get_user_woreda_id();
BEGIN
  IF NOT is_super_admin() AND v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'provision_rent_account: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  IF NOT is_super_admin() AND v_occ.woreda_id IS DISTINCT FROM v_woreda_id THEN
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

  IF v_kebele_id IS NULL THEN
    RAISE EXCEPTION 'provision_rent_account: rental house not found in this woreda' USING ERRCODE = 'no_data_found';
  END IF;

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
-- 2. Lock the checklist-signed-off fields on rental_occupancy_request once
--    verified or later.
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

  -- Round-4 fix: once a request has been verified (or moved past it), the
  -- fields the verification checklist actually signed off on
  -- (house_available, rent_amount_confirmed, and the identity/linkage the
  -- checklist implicitly covers) can no longer be changed -- otherwise the
  -- checker's sign-off no longer describes the request that gets approved,
  -- and an unvetted rent_amount would still reach provision_rent_account()
  -- via the approval trigger.
  IF TG_OP = 'UPDATE' AND v_old_status NOT IN ('draft', 'submitted', 'under_review', 'returned') THEN
    IF NEW.rent_amount IS DISTINCT FROM OLD.rent_amount
       OR NEW.rental_house_id IS DISTINCT FROM OLD.rental_house_id
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.household_id IS DISTINCT FROM OLD.household_id
       OR NEW.rent_start_date IS DISTINCT FROM OLD.rent_start_date
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

  -- Round-4 fix: mirrors the verified_by_user_id pin/maker-checker pair
  -- above -- nothing enforced this for approved_by_user_id at all, since
  -- enforce_workflow_transition()'s generic version of this guard is wired
  -- only to credential_request/residence_credential (00026), never to this
  -- table.
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'approved') THEN
    IF auth.uid() IS NOT NULL AND NEW.approved_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'ማጽደቁን የፈጸመው ተጠቃሚ በትክክል መመዝገብ አለበት / approved_by_user_id must be the user actually performing this approval';
    END IF;

    IF NEW.approved_by_user_id IS NOT NULL
       AND NEW.approved_by_user_id = NEW.verified_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያረጋገጠው ሠራተኛ ራሱ ማጽደቅ አይችልም / The clerk who verified this request cannot also approve it';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 3. Live-overdue widening for plan creation and the ledger summary,
--    matching the definition 00083 already established.
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

  -- Round-4 fix: status='overdue' alone is never actually set (nothing
  -- calls refresh_rent_ledger_statuses()) -- widened to the same live
  -- definition 00083's checkpoint/aging report already use.
  CREATE TEMP TABLE _locked_overdue_charges ON COMMIT DROP AS
  SELECT rc.rent_charge_id, rc.total_amount, rc.ethiopian_period_key
    FROM public.rent_charge rc
   WHERE rc.rent_account_id = _rent_account_id
     AND rc.woreda_id = v_woreda_id
     AND (rc.status = 'overdue' OR (rc.status = 'due' AND rc.due_date < current_date))
   ORDER BY rc.rent_charge_id
     FOR UPDATE OF rc;

  -- Round-4 fix (race with settle_rent_payment()): the plan-mapping
  -- exclusion runs as its own statement, after the FOR UPDATE locks above
  -- are confirmed held, rather than folded into the same query -- a
  -- concurrent settle_rent_payment() that was blocked on one of these rows
  -- and has since committed is now visible to this check.
  DELETE FROM _locked_overdue_charges lc
   WHERE EXISTS (
     SELECT 1 FROM public.arrears_installment_charge aic
      WHERE aic.rent_charge_id = lc.rent_charge_id AND aic.status = 'active'
   );

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

CREATE OR REPLACE FUNCTION public.get_rent_account_ledger_summary(_rent_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_result jsonb;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rent_account_ledger_summary: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.view'])) THEN
    RAISE EXCEPTION 'get_rent_account_ledger_summary: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rent_account WHERE rent_account_id = _rent_account_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'get_rent_account_ledger_summary: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT jsonb_build_object(
    'billed_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge WHERE rent_account_id = _rent_account_id
    ),
    'paid_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status = 'paid'
    ),
    'unpaid_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status IN ('due', 'overdue')
    ),
    'overdue_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id
         AND (status = 'overdue' OR (status = 'due' AND due_date < current_date))
    ),
    'overdue_month_count', (
      SELECT count(*) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id
         AND (status = 'overdue' OR (status = 'due' AND due_date < current_date))
    ),
    'oldest_overdue_period', (
      SELECT min(ethiopian_period_key) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id
         AND (status = 'overdue' OR (status = 'due' AND due_date < current_date))
    ),
    'current_month_status', (
      SELECT status FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id
       ORDER BY ethiopian_period_key DESC LIMIT 1
    ),
    'active_plan', (
      SELECT jsonb_build_object(
               'plan_id', p.plan_id, 'plan_number', p.plan_number, 'status', p.status,
               'installments_due', (
                 SELECT count(*) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status = 'due'
               ),
               'installments_overdue', (
                 SELECT count(*) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status = 'overdue'
               ),
               'installments_paid', (
                 SELECT count(*) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status = 'paid'
               ),
               'next_installment_due_date', (
                 SELECT min(due_date) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status IN ('due', 'overdue')
               )
             )
        FROM public.arrears_repayment_plan p
       WHERE p.rent_account_id = _rent_account_id AND p.status = 'active'
    ),
    'last_payment_date', (
      SELECT max(pay.payment_date)
        FROM public.rental_payment rp
        JOIN public.payment pay ON pay.payment_id = rp.payment_id
       WHERE rp.rent_account_id = _rent_account_id AND pay.status = 'confirmed'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ============================================================================
-- 4. Block a direct client INSERT of a rental_rent payment; settle_rent_
--    payment() is the only legitimate creator.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_rental_payment_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_type = 'rental_rent'
     AND coalesce(current_setting('app.system_transition', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'guard_rental_payment_insert: a rental payment can only be created through settle_rent_payment()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS yy_guard_rental_payment_insert ON public.payment;
CREATE TRIGGER yy_guard_rental_payment_insert
  BEFORE INSERT ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.guard_rental_payment_insert();

-- settle_rent_payment() restated only to wrap its own payment insert in the
-- system-transition GUC the guard above now requires. Everything else is
-- unchanged from 00079/00085.
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
  v_prev_system_transition text := current_setting('app.system_transition', true);
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

  CREATE TEMP TABLE _locked_charges ON COMMIT DROP AS
  SELECT rent_charge_id, total_amount
    FROM public.rent_charge
   WHERE rent_charge_id = ANY (_rent_charge_ids)
     AND rent_account_id = _rent_account_id
     AND woreda_id = v_woreda_id
     AND status IN ('due', 'overdue')
   ORDER BY rent_charge_id
     FOR UPDATE OF rent_charge;

  -- Round-4 fix (race with create_arrears_repayment_plan()): this
  -- exclusion runs as its own statement after the FOR UPDATE locks above
  -- are confirmed held, so a plan-creation that committed while this
  -- statement was blocked on the same row is now visible here.
  IF EXISTS (
    SELECT 1 FROM _locked_charges lc
      JOIN public.arrears_installment_charge aic ON aic.rent_charge_id = lc.rent_charge_id
     WHERE aic.status = 'active'
  ) THEN
    RAISE EXCEPTION
      'ከመረጡት ወራት ውስጥ አንዳንዶቹ ወደ ክፍያ ዕቅድ ገብተዋል -- ገጹን ያድሱ / One or more selected months are now on a repayment plan -- refresh and try again'
      USING ERRCODE = 'check_violation';
  END IF;

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
-- 5. Pin rental_occupancy_request.approved_by_user_id to the real caller and
--    require approver <> verifier, in enforce_rental_request_integrity_
--    guards() -- already restated above in section 2 (both checks live in
--    the same function). No separate CREATE here.
-- ============================================================================

-- ============================================================================
-- 6. reverse_rental_payment(): raise a clear, actionable exception instead
--    of a raw unique_violation when reopening a completed plan would
--    collide with a different plan already active on the same account.
--    Restated verbatim from 00085 with only that one guard added, right
--    before the reopen UPDATE.
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
    -- Round-4 fix: a plan created and made active *after* one of these
    -- plans completed would otherwise collide with the reopen below under
    -- arrears_repayment_plan_one_active_per_account. Surface a clear,
    -- actionable message instead of a raw unique_violation, before anything
    -- else in this function has committed.
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
