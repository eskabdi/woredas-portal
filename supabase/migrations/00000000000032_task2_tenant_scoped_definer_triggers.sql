-- ============================================================================
-- Scope SECURITY DEFINER triggers to their own tenant; idempotent birth
-- approval.
--
-- Closes F-03 and F-04 (both High) from docs/system-review-2026-09.md.
-- Task 2 of fix-task-production-readiness-v3.
--
-- F-03: apply_death_on_approval() and apply_rental_occupancy_on_approval()
-- run SECURITY DEFINER (RLS bypassed) and filtered their UPDATE/INSERT
-- statements only on a bare resident_id / rental_house_id / occupancy_id,
-- with no woreda_id predicate. vital_event.resident_id and
-- rental_occupancy_request.rental_house_id also carry no same-woreda
-- constraint, so nothing stopped a civil_registrar in one woreda from
-- registering a death or rental action against another woreda's resident or
-- house. On approval the trigger -- running as definer -- would mark that
-- resident deceased and revoke their credentials, or mutate another
-- tenant's rental_occupancy/kebele_rental_house rows. Mitigated in practice
-- by resident_id/rental_house_id being UUIDs an attacker must already hold
-- (RLS blocks reading another tenant's rows to discover them), which is why
-- this is High and not Critical -- but a SECURITY DEFINER trigger has no
-- business writing outside the row's own tenant regardless.
--
-- F-04: generate_resident_on_birth_approval() guards only
-- `NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'`. It
-- sets NEW.resident_id but never checks NEW.resident_id IS NULL first, so
-- approved -> returned -> approved (reachable through the UI's own return
-- path, and trivially without the Task-1 workflow gate) inserts a second
-- resident row for the same child, consuming a resident number and creating
-- a duplicate civil identity.
--
-- Three changes, additive only -- both trigger functions change via
-- CREATE OR REPLACE, and the two new checks are new triggers on existing
-- tables:
--
--   1. apply_death_on_approval() / apply_rental_occupancy_on_approval():
--      every UPDATE, and every INSERT ... SELECT that reads a row by a bare
--      foreign id, now also filters on woreda_id = NEW.woreda_id. This is
--      belt-and-suspenders with item 3 below: once the source row can no
--      longer reach `approved` with a cross-tenant reference (item 3), these
--      filters mostly cannot fail to match -- but they mean a definer
--      trigger never has a code path that writes outside its own tenant,
--      independent of what any other trigger enforces. The one INSERT with
--      no WHERE clause (the new rental_occupancy row in the new_registration
--      branch) already takes its woreda_id literally from NEW.woreda_id, so
--      there is nothing to add there.
--   2. generate_resident_on_birth_approval(): add `AND NEW.resident_id IS
--      NULL` to the guard, so the insert only ever runs once per vital_event
--      row regardless of how many times it re-enters `approved`.
--   3. Two new BEFORE INSERT OR UPDATE triggers reject the row outright,
--      before either cascade function above can run, if a foreign reference
--      does not resolve to the same woreda_id as the row itself:
--        - vital_event.resident_id -> resident.woreda_id
--        - vital_event.household_id -> household.woreda_id
--        - rental_occupancy_request.rental_house_id ->
--          kebele_rental_house.woreda_id
--      Postgres fires same-event BEFORE triggers in alphabetical order by
--      trigger name, so trg_assert_vital_event_woreda_consistency does not
--      reliably run before trg_apply_death_on_approval -- but that is fine:
--      item 1 already makes the older trigger's own writes a no-op against
--      a cross-tenant id, so which one runs first changes nothing about
--      whether cross-tenant data can be written, only whether the row is
--      also rejected outright (rather than silently accepted with the
--      cascade skipped). Rejecting outright is still worth doing on its own
--      -- this repo's house rule is that a mutation should fail loudly
--      rather than silently no-op (see CLAUDE.md, "every admin-facing
--      mutation verifies what it actually changed").
--
-- Out of scope for this task, not touched here: mother-lookup reads inside
-- generate_resident_on_birth_approval() (keyed off a client-supplied
-- mother_resident_id in event_details, with no woreda check of their own)
-- and vital_event's missing FSM gating generally, which is Task 14.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_death_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason TEXT;
BEGIN
  IF NEW.event_type = 'death' AND NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    v_reason := 'Resident deceased (event ' || NEW.event_number || ')';

    UPDATE public.resident
    SET residency_status = 'deceased'
    WHERE resident_id = NEW.resident_id AND woreda_id = NEW.woreda_id;

    UPDATE public.residence_credential
    SET status = 'revoked', revoked_at = NOW(), revoked_reason = v_reason
    WHERE resident_id = NEW.resident_id AND status = 'active' AND woreda_id = NEW.woreda_id;

    INSERT INTO public.credential_status_history (credential_id, old_status, new_status, change_reason)
    SELECT credential_id, 'active', 'revoked', v_reason
    FROM public.residence_credential
    WHERE resident_id = NEW.resident_id AND status = 'revoked' AND revoked_reason = v_reason
      AND woreda_id = NEW.woreda_id;

    INSERT INTO public.audit_log (entity_name, entity_id, action_type, new_value_json)
    SELECT 'residence_credential', credential_id, 'CREDENTIAL_REVOKED', jsonb_build_object('reason', v_reason)
    FROM public.residence_credential
    WHERE resident_id = NEW.resident_id AND revoked_reason = v_reason
      AND woreda_id = NEW.woreda_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_occupancy_id UUID;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.request_type = 'new_registration' THEN
      -- Close any existing active occupancy on this property
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(termination_date, CURRENT_DATE),
          termination_reason = COALESCE(termination_reason, 'Superseded by new occupancy ' || NEW.request_number)
      WHERE rental_house_id = NEW.rental_house_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      -- No WHERE to scope here: woreda_id is taken literally from
      -- NEW.woreda_id, not looked up by a bare foreign id.
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

      UPDATE public.kebele_rental_house
      SET occupancy_status = 'occupied'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_resident_on_birth_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d JSONB;
  v_mother_id UUID;
  v_mother_ethnicity TEXT;
  v_mother_religion TEXT;
  v_mother_household_id UUID;
  v_full_name_am TEXT;
  v_new_resident_id UUID;
BEGIN
  IF NEW.event_type = 'birth' AND NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved')
     AND NEW.resident_id IS NULL THEN
    d := NEW.event_details;
    v_mother_id := NULLIF(d->>'mother_resident_id', '')::UUID;

    IF v_mother_id IS NOT NULL THEN
      SELECT ethnicity, religion, current_household_id
      INTO v_mother_ethnicity, v_mother_religion, v_mother_household_id
      FROM public.resident WHERE resident_id = v_mother_id;
    END IF;

    v_full_name_am := trim(concat_ws(' ', d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name'));

    INSERT INTO public.resident (
      woreda_id, first_name, father_name, grandfather_name,
      full_name_am, full_name, sex, date_of_birth, mother_full_name,
      ethnicity, religion, current_household_id, active_flag, residency_status
    ) VALUES (
      NEW.woreda_id, d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name',
      v_full_name_am,
      COALESCE(NULLIF(d->>'child_full_name_en', ''), v_full_name_am),
      d->>'sex', NEW.event_date,
      COALESCE(d->>'mother_name', (SELECT full_name_am FROM public.resident WHERE resident_id = v_mother_id)),
      COALESCE(v_mother_ethnicity, d->>'ethnicity'),
      COALESCE(v_mother_religion, d->>'religion'),
      v_mother_household_id, true, 'active'
    )
    RETURNING resident_id INTO v_new_resident_id;

    NEW.resident_id := v_new_resident_id;
  END IF;
  RETURN NEW;
END;
$function$
;

-- ----------------------------------------------------------------------
-- Item 3: reject a cross-tenant reference outright, before either cascade
-- function above runs.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_vital_event_woreda_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.resident
    WHERE resident_id = NEW.resident_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'vital_event: resident_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.household_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.household
    WHERE household_id = NEW.household_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'vital_event: household_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER trg_assert_vital_event_woreda_consistency
  BEFORE INSERT OR UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION assert_vital_event_woreda_consistency();

CREATE OR REPLACE FUNCTION public.assert_rental_request_woreda_consistency()
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
      'rental_occupancy_request: rental_house_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER trg_assert_rental_request_woreda_consistency
  BEFORE INSERT OR UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION assert_rental_request_woreda_consistency();

COMMIT;
