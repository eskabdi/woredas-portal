-- Kebele Rental Houses Management -- Phase 1 review fixes.
--
-- 00000000000072 landed AF-01..AF-11 + PD-07/PD-09. The tenant-isolation-review
-- agent then found one real gap in it and two low-priority hardening items;
-- this migration closes all three. ADDITIVE. No DROP of any table, column,
-- policy or CHECK constraint -- 00072 is never edited in place, per this
-- repo's forward-only migration rule.

BEGIN;

-- ----------------------------------------------------------------------
-- 1. (medium) apply_rental_occupancy_on_approval()'s termination branch
-- updated rental_occupancy filtered by occupancy_id/status/woreda_id (all
-- correct, fails closed), but never checked whether that UPDATE actually
-- matched a row before unconditionally flipping the house to 'vacant' --
-- inside the app.system_transition GUC that bypasses the AF-01 guard. A
-- termination request whose existing_occupancy_id pointed at nothing live
-- (wrong tenant, already terminated by a concurrent approval, or simply
-- stale) would still vacate the house, leaving occupancy_status='vacant'
-- next to a still-active rental_occupancy row -- the exact house/occupancy
-- divergence AF-01 exists to prevent, routed around by the one bypass this
-- module introduces. Fixed with a row-count check, the SQL-side analogue
-- of the .select().maybeSingle() sweep 00072's own frontend half already
-- did.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_occupancy_id UUID;
  v_terminated_count INT;
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

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'occupied'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', '', true);

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

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', '', true);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------
-- 2. (low, hardening) assert_rental_request_woreda_consistency() checked
-- rental_house_id, resident_id and household_id (00000000000032/33) but
-- never existing_occupancy_id, the one reference a termination request
-- actually acts on. Extended so a termination request cannot name an
-- occupancy belonging to a different tenant or a different house than the
-- request's own -- closing the gap the review found before it could ever
-- be exercised, on top of the row-count check above.
-- ----------------------------------------------------------------------

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

  IF NOT EXISTS (
    SELECT 1 FROM public.resident
    WHERE resident_id = NEW.resident_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'rental_occupancy_request: resident_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.household_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.household
    WHERE household_id = NEW.household_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION
      'rental_occupancy_request: household_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.existing_occupancy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rental_occupancy
    WHERE occupancy_id = NEW.existing_occupancy_id
      AND woreda_id = NEW.woreda_id
      AND rental_house_id = NEW.rental_house_id
  ) THEN
    RAISE EXCEPTION
      'rental_occupancy_request: existing_occupancy_id does not belong to this woreda/house'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------
-- 3. (nit) enforce_rental_request_integrity_guards() touches no table --
-- it only inspects NEW's own columns -- so SECURITY DEFINER was never
-- needed. SECURITY INVOKER (the default; omitting the clause) is the
-- accurate declaration, matching the precedent pin_vital_event_resident()
-- (00000000000033) already sets for a column-only guard.
-- ----------------------------------------------------------------------

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

  IF NEW.request_type = 'new_registration' AND NEW.status <> 'draft'
     AND (NEW.rent_amount IS NULL OR NEW.rent_amount <= 0) THEN
    RAISE EXCEPTION
      'ትክክለኛ የቤት ኪራይ ዋጋ ያስፈልጋል / A valid rent amount is required to submit this request';
  END IF;

  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'verified') THEN
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

COMMIT;
