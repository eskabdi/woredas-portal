-- ============================================================================
-- Fix: migration 00000000000069's resident-eligibility check on
-- generate_residence_credential_on_payment() tested `active_flag = true` but
-- not `residency_status <> 'deceased'`. Found by /code-review on this PR's
-- own diff before merge.
--
-- apply_death_on_approval() (baseline migration) sets a resident's
-- residency_status to 'deceased' on an approved death event but never
-- touches active_flag -- so a deceased resident's active_flag stays `true`.
-- Every sibling precondition check that implements "resident is eligible"
-- elsewhere in this codebase tests both conditions together:
-- enforce_service_request_preconditions() (migrations 65:243, 66:448) uses
-- `r.active_flag = true AND r.residency_status <> 'deceased'`. Migration 69
-- only ported the first half, so a credential_request for a deceased
-- resident driven to 'paid' -- via a direct PostgREST call or the
-- offline-sync replay in src/lib/offlineSync.ts, neither of which re-checks
-- residency_status client-side -- could still mint a fresh
-- residence_credential (an ID card) for someone recorded as deceased.
--
-- ADDITIVE. CREATE OR REPLACE only, no DROP. Strict tightening: nothing that
-- should be rejected is now accepted, and every case migration 69 already
-- allowed correctly (18+, active, phone/photo on file, resident not
-- deceased) still succeeds.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_residence_credential_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expiry            DATE;
  v_new_credential_id UUID;
  v_receipted         BOOLEAN;
  v_dob               DATE;
  v_phone             TEXT;
  v_photo             TEXT;
  v_active            BOOLEAN;
  v_residency_status  TEXT;
  v_age_years         INTEGER;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN

    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a credential request may only be paid from awaiting_payment (was %)',
        OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = NEW.payment_id
         AND p.credential_request_id = NEW.credential_request_id
         AND p.woreda_id = NEW.woreda_id
         AND p.payment_type = 'credential_fee'
         AND p.status = 'confirmed'
    ) INTO v_receipted;

    IF NEW.payment_id IS NULL OR NOT v_receipted THEN
      RAISE EXCEPTION
        'payment: a confirmed payment with a receipt is required before a credential is generated'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Age + identity-completeness gate (migration 68), requiring the
    -- resident be active AND not deceased (this migration) -- matching
    -- enforce_service_request_preconditions()'s own eligibility check.
    SELECT date_of_birth, phone_number, photo_url, active_flag, residency_status
      INTO v_dob, v_phone, v_photo, v_active, v_residency_status
      FROM public.resident
     WHERE resident_id = NEW.resident_id
       AND woreda_id = NEW.woreda_id;

    IF NOT FOUND OR v_dob IS NULL THEN
      RAISE EXCEPTION
        'credential: resident record or date of birth not found -- cannot verify age / የነዋሪ መዝገብ ወይም የትውልድ ቀን አልተገኘም'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_active OR v_residency_status = 'deceased' THEN
      RAISE EXCEPTION
        'credential: resident is not active -- a residence credential cannot be issued / ነዋሪው ንቁ አይደለም፣ መታወቂያ ሊሰጠው አይችልም'
        USING ERRCODE = 'check_violation';
    END IF;

    v_age_years := date_part('year', age(CURRENT_DATE, v_dob))::INTEGER;
    IF v_age_years < 18 THEN
      RAISE EXCEPTION
        'credential: resident is under 18 -- a residence credential cannot be issued / ነዋሪው ከ18 ዓመት በታች ነው፣ መታወቂያ ሊሰጠው አይችልም'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_phone IS NULL OR btrim(v_phone) = '' THEN
      RAISE EXCEPTION
        'credential: resident has no phone number on file -- a residence credential cannot be issued / ነዋሪው ስልክ ቁጥር የለውም፣ መታወቂያ ሊሰጠው አይችልም'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_photo IS NULL OR btrim(v_photo) = '' THEN
      RAISE EXCEPTION
        'credential: resident has no photo on file -- a residence credential cannot be issued / ነዋሪው ፎቶ የለውም፣ መታወቂያ ሊሰጠው አይችልም'
        USING ERRCODE = 'check_violation';
    END IF;

    v_expiry := (CURRENT_DATE + INTERVAL '1 year')::DATE;

    PERFORM set_config('app.minting_credential', 'on', true);

    INSERT INTO public.residence_credential (
      woreda_id, resident_id, issuing_kebele_id,
      credential_type, status, issue_date, expiry_date,
      reason_for_issue, credential_request_id
    ) VALUES (
      NEW.woreda_id, NEW.resident_id, NEW.issuing_kebele_id,
      NEW.credential_type, 'ready_to_print', CURRENT_DATE, v_expiry,
      NEW.request_type, NEW.credential_request_id
    )
    RETURNING credential_id INTO v_new_credential_id;

    PERFORM set_config('app.minting_credential', '', true);

    NEW.credential_id := v_new_credential_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
