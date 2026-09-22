-- Kebele Rental Houses Management -- consolidated pre-merge security fixes
-- found by a final full-PR security review (PR #83) after all five phases
-- had individually merged.
--
-- 1. apply_rental_occupancy_on_approval() regression (HIGH). Migration 00076
--    (Phase 2) restated this function with CREATE OR REPLACE to add the
--    rent_account-close step, but did so from an older draft of the
--    function's body rather than from 00074's (Phase 1's) already-fixed
--    version -- silently dropping both of 00074's fixes:
--      - the termination branch's ROW_COUNT check (a termination naming a
--        stale/already-terminated/wrong-tenant occupancy_id matched zero
--        rows and still fell through to vacate the house anyway, the exact
--        house/occupancy divergence AF-01 exists to prevent)
--      - the app.system_transition GUC being captured and restored rather
--        than unconditionally cleared to '' (clobbering a caller's own
--        in-flight system-transition state if this trigger ever fires
--        nested inside one)
--    Since CREATE OR REPLACE takes the last definition and no migration
--    after 00076 touched this function, 00076's regressed body is what has
--    been live since Phase 2. This restores 00074's body verbatim, with
--    00076's rent_account-close step folded in at the same point Phase 2
--    added it.
--
-- 2. arrears_repayment_plan maker!=checker can be defeated by a stale
--    approved_by_user_id (MEDIUM). guard_arrears_plan_maker_checker()
--    (00080) only compares NEW.approved_by_user_id against
--    NEW.requested_by_user_id -- but force_actor_columns() (baseline) only
--    overwrites a column the client's own request body actually changes.
--    A submitted -> active PATCH that omits approved_by_user_id (or that
--    fires after a returned -> submitted -> active resubmission cycle,
--    where a prior round's approver value is still sitting on the row)
--    leaves a stale value untouched, and the guard's own <> comparison
--    against requested_by_user_id can pass even though the real caller
--    driving this transition never appears anywhere in the check. This is
--    the exact class of bug 00074 already fixed for
--    rental_occupancy_request.verified_by_user_id -- applying the same
--    fix here: require approved_by_user_id = auth.uid() on every transition
--    into 'active', not just a not-equal-to-the-other-column check.
--
-- 3. rent_account_sequence / arrears_plan_sequence are fully client-writable
--    within the tenant (LOW/MEDIUM). Both got a single `FOR ALL TO
--    authenticated` policy gated only on woreda_id -- no permission
--    predicate, unlike every other new table in this module. Both are only
--    ever written by their own SECURITY DEFINER number-assigning triggers
--    (assign_rent_account_number(), assign_arrears_plan_number()), which run
--    as the table owner regardless of the caller's own RLS policy -- so
--    narrowing the client-facing policy to SELECT-only costs nothing and
--    closes a path where any authenticated tenant user (including `viewer`)
--    could reset or corrupt the account/plan numbering sequence directly
--    via PostgREST.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. Restore apply_rental_occupancy_on_approval()'s Phase 1 fixes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_occupancy_id UUID;
  v_terminated_count INT;
  v_prev_system_transition text := current_setting('app.system_transition', true);
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.request_type = 'new_registration' THEN
      IF EXISTS (
        SELECT 1 FROM public.rental_occupancy
         WHERE rental_house_id = NEW.rental_house_id AND status = 'active' AND woreda_id = NEW.woreda_id
      ) THEN
        RAISE EXCEPTION
          'ቤቱ በሌላ ተከራይ ተይዟል -- መጀመሪያ የነባሩን ኪራይ ማቋረጥ ማፅደቅ ያስፈልጋል / House is occupied by an active tenancy -- approve a termination first';
      END IF;

      INSERT INTO public.rental_occupancy (
        woreda_id, rental_house_id, resident_id, household_id,
        rent_start_date, rent_amount, status, originating_request_id
      ) VALUES (
        NEW.woreda_id, NEW.rental_house_id, NEW.resident_id, NEW.household_id,
        COALESCE(NEW.rent_start_date, CURRENT_DATE),
        COALESCE(NEW.rent_amount, 0),
        'active', NEW.rental_request_id
      )
      RETURNING occupancy_id INTO v_new_occupancy_id;

      NEW.resulting_occupancy_id := v_new_occupancy_id;

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'occupied'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      GET DIAGNOSTICS v_terminated_count = ROW_COUNT;
      IF v_terminated_count = 0 THEN
        RAISE EXCEPTION
          'ውሉ ማቋረጥ አልተቻለም -- ኪራዩ ንቁ ላይሆን ወይም ለዚህ ተከራይ ላይሆን ይችላል / Cannot terminate -- the occupancy is no longer active or does not belong to this tenant';
      END IF;

      -- Phase 2 wiring: close the billable account with the occupancy. A
      -- terminated occupancy may have no rent_account yet (it predates
      -- Phase 2 and the 6.5 backfill hasn't run, or the approving client
      -- never called provision_rent_account()) -- this UPDATE simply
      -- matches zero rows in that case, which is not an error.
      UPDATE public.rent_account
      SET status = 'terminated'
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 2. Pin arrears_repayment_plan's approver to the real caller, matching
--    00074's fix for rental_occupancy_request.verified_by_user_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_arrears_plan_maker_checker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' AND (OLD.status IS DISTINCT FROM 'active') THEN
    IF NEW.approved_by_user_id IS NULL THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: an approval must record the approver'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Require the real caller, not merely a value that differs from
    -- requested_by_user_id -- force_actor_columns() only overwrites a
    -- column the client's own request body actually changes, so a bare
    -- status PATCH that omits approved_by_user_id (or resubmits after a
    -- returned -> submitted round, leaving a prior approver value on the
    -- row) would otherwise sail past a not-equal check without ever being
    -- compared against auth.uid().
    IF auth.uid() IS NOT NULL AND NEW.approved_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: approved_by_user_id must be the caller'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.approved_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: the requester cannot approve their own plan'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 3. Sequence tables: SELECT-only for clients. Both are written only by
--    their own SECURITY DEFINER trigger functions (table-owner privileges,
--    unaffected by narrowing the client-facing policy).
-- ============================================================================

DROP POLICY IF EXISTS rent_account_sequence_tenant ON public.rent_account_sequence;
CREATE POLICY rent_account_sequence_select ON public.rent_account_sequence
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id());

DROP POLICY IF EXISTS arrears_plan_sequence_tenant ON public.arrears_plan_sequence;
CREATE POLICY arrears_plan_sequence_select ON public.arrears_plan_sequence
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id());

COMMIT;
