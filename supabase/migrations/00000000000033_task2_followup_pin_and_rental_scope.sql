-- ============================================================================
-- Task 2 follow-up: close two gaps a tenant-isolation-review pass and an
-- independent code-review both found in 00000000000032.
--
-- 1. F-04 was not actually closed. `generate_resident_on_birth_approval()`'s
--    `AND NEW.resident_id IS NULL` guard only stops the INSERT from running a
--    second time in the same statement -- nothing stops a later, ordinary
--    UPDATE from nulling `resident_id` back out first. `vital_event_update`
--    (baseline) lets any in-tenant civil.register/civil.approve holder write
--    any column on their own woreda's rows, including this one:
--
--      approve  -> resident_id := R1
--      return   -> UPDATE ... SET status='returned', resident_id = NULL   (allowed)
--      approve  -> guard sees NULL -> inserts R2
--
--    Same duplicate-resident harm F-04 describes, one step later. The fix is
--    the same pattern this repo already uses for exactly this shape --
--    pin_receipt_verification_token() / trg_pin_receipt_verification_token
--    (00000000000013_receipt_verification.sql): once a value is set, a plain
--    UPDATE cannot change or clear it. SECURITY INVOKER is correct here, same
--    as that precedent -- this only compares OLD/NEW on a row the caller
--    already has UPDATE privilege on via RLS, no elevation required.
--
-- 2. assert_rental_request_woreda_consistency() (00000000000032) checked only
--    rental_house_id. apply_rental_occupancy_on_approval()'s new_registration
--    branch copies NEW.resident_id and NEW.household_id verbatim into a new
--    rental_occupancy row with a literal INSERT (no WHERE, so item 1's
--    woreda_id filters in that migration never touch it) -- so a request
--    whose resident_id/household_id belong to a different tenant than the
--    request's own woreda_id still produces a persistent cross-tenant
--    reference on approval. Extended to check both, matching what the
--    vital_event assertion already does for its two nullable references.
--
-- 3. Both 00000000000032 triggers used bare CREATE TRIGGER. Every migration
--    since 00000000000025 uses DROP TRIGGER IF EXISTS first specifically so a
--    re-run is idempotent; retrofitted here so a future replay of 032's
--    intent (or of this file) doesn't fail on "trigger already exists".
--
-- ADDITIVE. No DROP of any table, column, policy or CHECK constraint.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------
-- 1. Pin vital_event.resident_id once set.
--
-- Only blocks changing an ALREADY-assigned resident_id (OLD IS NOT NULL),
-- not the NULL -> value transition -- generate_resident_on_birth_approval()
-- performs exactly that transition inside the same BEFORE UPDATE event, and
-- must still be able to. Trigger name sorts alphabetically after
-- trg_generate_resident_on_birth_approval, so by the time this one runs,
-- NEW.resident_id already reflects whatever that trigger assigned.
--
-- No legitimate UI path sets vital_event.resident_id outside creation and
-- the birth-approval trigger itself (checked woreda.civil.$eventId.tsx and
-- the three .new.tsx creation forms: resident_id is only ever set at
-- INSERT), so this does not block any real workflow.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pin_vital_event_resident()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.resident_id IS NOT NULL
     AND NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN
    RAISE EXCEPTION 'vital_event.resident_id cannot be changed once assigned'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$
;

DROP TRIGGER IF EXISTS trg_pin_vital_event_resident ON public.vital_event;
CREATE TRIGGER trg_pin_vital_event_resident
  BEFORE UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.pin_vital_event_resident();

-- ----------------------------------------------------------------------
-- 2. Extend the rental assertion to resident_id and household_id.
-- household_id is nullable on rental_occupancy_request (baseline), so it is
-- NULL-guarded the same way vital_event.household_id already is;
-- resident_id is NOT NULL on this table, so it is checked unconditionally,
-- matching how rental_house_id itself is checked.
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

  RETURN NEW;
END;
$function$
;

-- ----------------------------------------------------------------------
-- 3. Idempotent re-creation of 00000000000032's two triggers, so this
-- migration (and any future replay) is safe to re-run.
-- ----------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_assert_rental_request_woreda_consistency ON public.rental_occupancy_request;
CREATE TRIGGER trg_assert_rental_request_woreda_consistency
  BEFORE INSERT OR UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION assert_rental_request_woreda_consistency();

DROP TRIGGER IF EXISTS trg_assert_vital_event_woreda_consistency ON public.vital_event;
CREATE TRIGGER trg_assert_vital_event_woreda_consistency
  BEFORE INSERT OR UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION assert_vital_event_woreda_consistency();

COMMIT;
