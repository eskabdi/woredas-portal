-- ---------------------------------------------------------------------------
-- 00000000000031_rental_eligibility.sql
--
-- Adds the eligibility check that rental occupancy requests never had.
--
-- Today `woreda.rental-houses.occupants.new.tsx:296` inserts a request at
-- `submitted` behind nothing but client-side field validation (an occupant, a
-- house, a positive amount, a start date). Nothing anywhere -- client or
-- database -- asks whether the resident is actually ELIGIBLE. The live project
-- already carries the consequence: one resident held an active occupancy and
-- two `new_registration` requests at once (ABOKER-RNT-26-00001 approved,
-- -00002 since rejected by hand).
--
-- OWNER DECISIONS encoded here, taken 2026-09-08:
--
--   Disqualifier              : an active kebele rental house registered IN THE
--                               RESIDENT'S OWN NAME. Household house_type is
--                               reported to the verifier but never blocks --
--                               a household member is not the holder, and
--                               blocking on it would have disqualified all
--                               three active residents on day one.
--   Scope                     : the acting woreda only, never cross-tenant
--   Grain                     : per RESIDENT (matches how rental_occupancy is
--                               keyed); a different household member may still
--                               register separately
--   Existing data             : left alone -- the one duplicate was already
--                               rejected by the owner before this landed
--
-- SHAPE: one function, two callers -- the repo's own "two independent gates"
-- principle. `rental_eligibility()` returns a structured verdict the UI can
-- render the moment an occupant is picked, and the trigger calls the SAME
-- function and raises. A client gate whose server half disagrees with it is the
-- failure mode this codebase keeps hitting (see CLAUDE.md on PermissionGate vs
-- user_has_perm); sharing one implementation makes disagreement impossible.
--
-- ADDITIVE. Two new functions and one new trigger. No table, column,
-- constraint, policy or existing function is altered, and no row is modified.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The verdict function
--
-- SECURITY DEFINER because it must see rental_occupancy and household rows the
-- caller may not hold a direct grant on -- but it NEVER takes a woreda from its
-- caller. The woreda is re-derived from the resident's own row, the same rule
-- user_permission_override's trigger follows: a client-supplied tenant id is
-- not evidence of anything.
--
-- Returns jsonb rather than a boolean so the UI can explain WHY, bilingually,
-- and so the trigger's message and the screen's message come from one place.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_eligibility(
  _resident_id     uuid,
  _rental_house_id uuid,
  _request_type    text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id   uuid;
  v_house_type  text;
  v_reasons     jsonb := '[]'::jsonb;
  v_active      record;
  v_inflight    record;
  v_is_head     boolean := false;
BEGIN
  -- Tenant scope comes from the resident, never from an argument.
  SELECT r.woreda_id, h.house_type
    INTO v_woreda_id, v_house_type
    FROM public.resident r
    LEFT JOIN public.household h ON h.household_id = r.current_household_id
   WHERE r.resident_id = _resident_id;

  IF v_woreda_id IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'house_type', NULL,
      'reasons', jsonb_build_array(jsonb_build_object(
        'code', 'resident_not_found',
        'am',   'ነዋሪው አልተገኘም።',
        'en',   'Resident not found.'))
    );
  END IF;

  -- =========================================================================
  -- Termination: the inverse check. There must BE something to terminate.
  -- Previously unchecked entirely, so a termination could be raised against a
  -- resident with no occupancy at all.
  -- =========================================================================
  IF _request_type = 'termination' THEN
    SELECT o.occupancy_id, o.rental_house_id
      INTO v_active
      FROM public.rental_occupancy o
     WHERE o.resident_id = _resident_id
       AND o.woreda_id   = v_woreda_id
       AND o.status      = 'active'
     LIMIT 1;

    IF NOT FOUND THEN
      v_reasons := v_reasons || jsonb_build_object(
        'code', 'no_active_occupancy',
        'am',   'ይህ ነዋሪ በአሁኑ ጊዜ የቀበሌ ቤት የለውም፤ ስለዚህ ውል ማቋረጥ አይቻልም።',
        'en',   'This resident has no active kebele house, so there is nothing to terminate.');
    END IF;

    RETURN jsonb_build_object(
      'eligible',   (jsonb_array_length(v_reasons) = 0),
      'house_type', v_house_type,
      'active_occupancy_id', (CASE WHEN v_active.occupancy_id IS NOT NULL
                                   THEN to_jsonb(v_active.occupancy_id) ELSE 'null'::jsonb END),
      'reasons',    v_reasons
    );
  END IF;

  -- =========================================================================
  -- New registration
  -- =========================================================================

  -- A. Already holds an active kebele house, in THIS woreda.
  SELECT o.occupancy_id, o.rental_house_id
    INTO v_active
    FROM public.rental_occupancy o
   WHERE o.resident_id = _resident_id
     AND o.woreda_id   = v_woreda_id
     AND o.status      = 'active'
   LIMIT 1;

  IF FOUND THEN
    v_reasons := v_reasons || jsonb_build_object(
      'code', 'active_occupancy_exists',
      'am',   'ይህ ነዋሪ አስቀድሞ የቀበሌ ቤት ተከራይቷል። ወደ ሌላ ቤት ለመዛወር በመጀመሪያ ያለውን ውል ማቋረጥ ያስፈልጋል።',
      'en',   'This resident already holds an active kebele house. To move to another house, terminate the existing occupancy first.');
  END IF;

  -- B. Another new_registration already in flight. `rejected` and `approved`
  -- are terminal and do not block; everything else means a live request.
  SELECT q.request_number, q.status
    INTO v_inflight
    FROM public.rental_occupancy_request q
   WHERE q.resident_id  = _resident_id
     AND q.woreda_id    = v_woreda_id
     AND q.request_type = 'new_registration'
     AND q.status NOT IN ('rejected', 'approved')
   ORDER BY q.created_at
   LIMIT 1;

  IF FOUND THEN
    v_reasons := v_reasons || jsonb_build_object(
      'code',  'request_already_in_flight',
      'am',    format('ለዚህ ነዋሪ በሂደት ላይ ያለ ጥያቄ አለ (%s)። መጀመሪያ ያንን ይጨርሱ።', v_inflight.request_number),
      'en',    format('A request for this resident is already in progress (%s, %s). Complete or reject it first.',
                      v_inflight.request_number, v_inflight.status));
  END IF;

  -- C. Current house type is reported, NEVER blocked on.
  --
  -- Eligibility follows the NAME ON THE OCCUPANCY, not the household. A
  -- resident who merely lives in a household that holds a kebele house has
  -- nothing in his own name and stays eligible; only the person the occupancy
  -- is registered to is disqualified, which is exactly rule A above.
  --
  -- Blocking on household.house_type was tried and rejected during design: it
  -- is a HOUSEHOLD attribute, so it punished every member for the head's
  -- house. Against the live data it would have disqualified all three active
  -- residents and stopped new registrations entirely on the day it shipped.
  --
  -- It is still returned so the verifier can see it and weigh it by hand --
  -- a household already marked `kebele` with no occupancy row for this
  -- resident is worth a human look, just not an automatic refusal.
  v_is_head := EXISTS (
    SELECT 1 FROM public.household h
     WHERE h.household_id = (SELECT current_household_id FROM public.resident WHERE resident_id = _resident_id)
       AND h.household_head_resident_id = _resident_id);

  RETURN jsonb_build_object(
    'eligible',   (jsonb_array_length(v_reasons) = 0),
    'house_type', v_house_type,
    'is_household_head', v_is_head,
    'active_occupancy_id', (CASE WHEN v_active.occupancy_id IS NOT NULL
                                 THEN to_jsonb(v_active.occupancy_id) ELSE 'null'::jsonb END),
    'reasons',    v_reasons
  );
END;
$function$;

COMMENT ON FUNCTION public.rental_eligibility(uuid, uuid, text) IS
  'Structured eligibility verdict for a rental occupancy request. Called by the UI to explain the outcome before the form is filled, and by enforce_rental_request_eligibility() to gate the write -- one implementation so the two can never disagree. Woreda is re-derived from the resident row, never taken from the caller.';

REVOKE ALL ON FUNCTION public.rental_eligibility(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rental_eligibility(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rental_eligibility(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The gate
--
-- Fires on INSERT, and on the UPDATE that moves a draft to `submitted`. Both
-- are needed: the app inserts straight at `submitted`, but a draft raised
-- earlier and submitted later must face the same check, and by then the
-- resident's circumstances may have changed.
--
-- Deliberately NOT re-checked on later transitions. Once a request is under
-- review, an eligibility change is a decision for the verifier to weigh, not a
-- reason for the row to start raising mid-workflow -- that is the trap
-- migration 27 had to undo elsewhere in this schema.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_rental_request_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_verdict jsonb;
  v_msg     text;
BEGIN
  -- Only gate the moment a request enters the workflow.
  IF TG_OP = 'UPDATE'
     AND NOT (NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  v_verdict := public.rental_eligibility(NEW.resident_id, NEW.rental_house_id, NEW.request_type);

  IF (v_verdict ->> 'eligible')::boolean THEN
    RETURN NEW;
  END IF;

  -- Amharic first, matching the woreda portal's convention, then English.
  SELECT string_agg((r ->> 'am') || ' / ' || (r ->> 'en'), '  ')
    INTO v_msg
    FROM jsonb_array_elements(v_verdict -> 'reasons') AS r;

  RAISE EXCEPTION 'rental: %', v_msg
    USING ERRCODE = 'check_violation';
END;
$function$;

COMMENT ON FUNCTION public.enforce_rental_request_eligibility() IS
  'Blocks an ineligible rental occupancy request at INSERT and at submission. Shares rental_eligibility() with the UI so the screen and the database always agree.';

DROP TRIGGER IF EXISTS zz_enforce_rental_eligibility ON public.rental_occupancy_request;
CREATE TRIGGER zz_enforce_rental_eligibility
  BEFORE INSERT OR UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rental_request_eligibility();

COMMIT;
