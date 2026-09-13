-- Task 14-A follow-up: enforce_vital_event_preconditions()'s birth clause
-- required household_id to be PRESENT, but the real, pre-existing birth
-- intake form (src/routes/woreda.civil.birth.new.tsx, untouched by Task
-- 14-A) has never collected a household_id -- it submits NULL every time.
-- Discovered live during the two-actor go-live verification: the very
-- first real registry_clerk submission through the actual UI shape raised
-- "A birth registration requires a linked household", meaning every real
-- birth registration was completely blocked in production the moment
-- 00000000000059 landed.
--
-- Fix: bring the birth clause in line with its own death/marriage siblings
-- in the same function, which only ever validate a field when it is
-- actually supplied (see the death clause's `AND NEW.resident_id IS NOT
-- NULL` and marriage's per-spouse `IF v_spouse1_id IS NOT NULL`). The
-- household_id column is nullable at the schema level and was always meant
-- to be optional data, not a hard precondition -- this migration removes
-- the presence requirement and keeps only the tenant-ownership check for
-- when a household_id IS supplied.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_vital_event_preconditions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d JSONB := NEW.event_details;
  v_spouse1_id UUID;
  v_spouse2_id UUID;
BEGIN
  -- The system-driven paid -> registered transition (advance_vital_event_to_
  -- registered()) re-fires this BEFORE trigger on its own nested UPDATE.
  -- By that point trg_apply_death_on_approval has already run (same timing
  -- group, fires first: 'apply' < 'enforce' alphabetically) and legitimately
  -- flipped the resident to deceased -- so re-checking "resident is not
  -- already deceased" here would reject the very transition that finalizes
  -- that death. Every precondition was already enforced when this event was
  -- first submitted/reviewed; the system transition re-validates nothing.
  IF current_setting('app.system_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'birth' AND NEW.household_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.household h
       WHERE h.household_id = NEW.household_id AND h.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ቤተሰቡ በዚህ ወረዳ አልተገኘም / The linked household does not belong to this woreda.';
    END IF;
  END IF;

  IF NEW.event_type = 'death' AND NEW.resident_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.resident r
       WHERE r.resident_id = NEW.resident_id AND r.woreda_id = NEW.woreda_id
         AND r.active_flag = true AND r.residency_status <> 'deceased'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ነዋሪው ንቁ ወይም አስቀድሞ የሞተ ነው / The resident is not active, or is already recorded as deceased.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.vital_event ve
       WHERE ve.resident_id = NEW.resident_id
         AND ve.event_type = 'death'
         AND ve.vital_event_id <> NEW.vital_event_id
         AND ve.woreda_id = NEW.woreda_id
         AND ve.status NOT IN ('rejected', 'returned', 'approval_returned')
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ለዚህ ነዋሪ ቀደም ያለ የሞት ምዝገባ ክፍት ነው / An open death registration already exists for this resident.';
    END IF;
  END IF;

  IF NEW.event_type = 'marriage' THEN
    v_spouse1_id := NULLIF(d #>> '{spouse1,resident_id}', '')::UUID;
    v_spouse2_id := NULLIF(d #>> '{spouse2,resident_id}', '')::UUID;

    IF v_spouse1_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.resident r WHERE r.resident_id = v_spouse1_id AND r.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ተጋቢ 1 በዚህ ወረዳ አልተገኘም / Party 1 does not resolve to a resident of this woreda.';
    END IF;
    IF v_spouse2_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.resident r WHERE r.resident_id = v_spouse2_id AND r.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ተጋቢ 2 በዚህ ወረዳ አልተገኘም / Party 2 does not resolve to a resident of this woreda.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
