-- ============================================================================
-- Age + identity-completeness guard at credential minting
--
-- Task 8 finding (2026-09-14): the 18+ age rule for a residence credential
-- was enforced ONLY client-side (woreda.credentials.new.tsx's hardBlocked
-- check) and failed OPEN, not closed, when a resident's date_of_birth
-- couldn't be read. A direct PostgREST call driving credential_request
-- straight to `paid`, or a future offline-sync replay, had no database-side
-- guard stopping a credential from being minted for a minor. Owner decision
-- (Task 8): fix this now, and while at it require a phone number and a photo
-- on file before a credential can be minted -- an ID card issued for someone
-- reachable by no phone number and identifiable by no photo is exactly the
-- kind of gap this guard should also close.
--
-- Enforcement point: generate_residence_credential_on_payment(), the single
-- BEFORE UPDATE trigger on credential_request that actually inserts the
-- residence_credential row (00000000000025_workflow_engine.sql). Every path
-- that can move a request to `paid` -- the UI, a direct PostgREST call, and
-- Task 12-C's offline-sync replay (src/lib/offlineSync.ts, which performs
-- this exact status transition) -- goes through this one trigger, so this is
-- the one place a check here is airtight regardless of how the row got
-- there.
--
-- Deliberately NOT a NOT NULL constraint on resident.phone_number/photo_url:
-- generate_resident_on_birth_approval() (00000000000059_task14a_civil_
-- payment_and_preconditions.sql) inserts a resident row for a newborn from
-- civil registration with neither a phone number nor a photo -- correctly,
-- since a newborn has neither. A table-wide NOT NULL would break every
-- future birth registration. A newborn is never issued a residence
-- credential in practice (nothing in this app requests one for an infant),
-- and if that were ever attempted, this trigger's age check alone already
-- fails it closed -- the phone/photo checks are additional, not instead of,
-- the age gate, and apply at the one point (minting) where "this resident is
-- about to receive a physical ID card" is actually true.
--
-- ADDITIVE. No DROP; the trigger function changes only via CREATE OR
-- REPLACE, and the new checks are additional RAISE EXCEPTION branches that
-- reject strictly more than before -- nothing legal before this migration
-- becomes illegal to reject; something illegal (minting for an
-- under-18/phoneless/photoless resident) that was previously allowed by the
-- database now correctly raises.
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
  v_age_years         INTEGER;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN

    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a credential request may only be paid from awaiting_payment (was %)',
        OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    -- A payment row AND its receipt must already exist. Zero-value waivers
    -- write both, so this holds for them too.
    SELECT EXISTS (
      SELECT 1
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = NEW.payment_id
         AND p.woreda_id = NEW.woreda_id
         AND p.status = 'confirmed'
    ) INTO v_receipted;

    IF NEW.payment_id IS NULL OR NOT v_receipted THEN
      RAISE EXCEPTION
        'payment: a confirmed payment with a receipt is required before a credential is generated'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Age + identity-completeness gate (Task 8). Fail-closed: a resident row
    -- that can't be found at all, or whose date_of_birth is somehow NULL
    -- (the column is NOT NULL today, but this defends the invariant even if
    -- that ever changes), is rejected the same as an under-18 resident --
    -- never treated as "unknown, so allow."
    SELECT date_of_birth, phone_number, photo_url
      INTO v_dob, v_phone, v_photo
      FROM public.resident
     WHERE resident_id = NEW.resident_id
       AND woreda_id = NEW.woreda_id;

    IF NOT FOUND OR v_dob IS NULL THEN
      RAISE EXCEPTION
        'credential: resident record or date of birth not found -- cannot verify age / የነዋሪ መዝገብ ወይም የትውልድ ቀን አልተገኘም'
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

    NEW.credential_id := v_new_credential_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
