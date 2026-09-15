-- ============================================================================
-- Fix: migration 00000000000068 was written against a stale copy of
-- generate_residence_credential_on_payment() (migration 25's original body)
-- instead of the current head (migration 66's, which itself had regressed
-- from migration 29's). Caught by workflow-fsm-review before this branch
-- merged. Two of the four things this corrects are CRITICAL:
--
--   1. Migration 66 tightened the payment-match predicate to also require
--      `p.credential_request_id = NEW.credential_request_id` and
--      `p.payment_type = 'credential_fee'` (closing finding H1 from the
--      payment-hardening review: without these, ANY confirmed+receipted
--      payment in the caller's own woreda -- any type, any amount, linked
--      to any request or none -- satisfied the "a payment exists" check).
--      Migration 68's CREATE OR REPLACE was based on migration 25's
--      pre-hardening body and silently dropped both conditions, reopening
--      H1. Restored here.
--   2. Migration 29 added a BEFORE INSERT guard on `residence_credential`
--      (`enforce_workflow_insert()`) that requires
--      `current_setting('app.minting_credential', true) = 'on'` and
--      `status = 'ready_to_print'` at the moment of insert -- and taught
--      this function to set that flag immediately before its own INSERT
--      and clear it immediately after (transaction-scoped `set_config`,
--      so it can never leak across a pooled connection). Migration 66's
--      rewrite dropped both `set_config` calls AND changed the inserted
--      status to `'active'` -- neither of which the insert guard accepts,
--      so EVERY mint since migration 66 was applied would raise
--      `insufficient_privilege` and never actually issue a credential.
--      Migration 68 (this branch) restored `'ready_to_print'` by accident
--      (it was rebased from migration 25, which still had the correct
--      value) but still had no `set_config` calls, so mints remained
--      broken. Both restored here, verified against migration 29's exact
--      wording.
--   3. Also restores the full column list migration 29/25 both used
--      (`issuing_kebele_id`, `credential_type`, `reason_for_issue`) --
--      migration 66's rewrite silently dropped these three columns from
--      the INSERT, leaving them NULL/default on every newly minted
--      credential.
--   4. Adds `resident.active_flag = true` to the age/identity guard's own
--      resident lookup (workflow-fsm-review F6): a resident deactivated
--      between approval and payment should not still mint, matching the
--      same check `enforce_service_request_preconditions()` already makes
--      for the equivalent service-request link.
--
-- The three age/phone/photo checks added by migration 68 are unchanged and
-- carried forward as-is (already independently confirmed correct: exact-date
-- age boundary, fail-closed on not-found/NULL/blank).
--
-- ADDITIVE. CREATE OR REPLACE only, no DROP. Net effect vs. the intended
-- state (66's security predicate + 29's insert-guard satisfaction + 68's
-- age/identity checks, all at once) is a strict tightening: nothing that
-- should be rejected is now accepted, and mints that should succeed
-- (confirmed credential_fee payment, linked to the right request, resident
-- 18+/active/phone/photo on file) now actually complete instead of raising
-- `insufficient_privilege` on every attempt.
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
  v_age_years         INTEGER;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN

    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a credential request may only be paid from awaiting_payment (was %)',
        OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    -- Migration 66's hardened predicate: the payment must be linked to
    -- THIS request and be a credential fee specifically -- restored after
    -- migration 68 accidentally dropped both conditions.
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

    -- Age + identity-completeness gate (migration 68), now also requiring
    -- the resident still be active (F6).
    SELECT date_of_birth, phone_number, photo_url, active_flag
      INTO v_dob, v_phone, v_photo, v_active
      FROM public.resident
     WHERE resident_id = NEW.resident_id
       AND woreda_id = NEW.woreda_id;

    IF NOT FOUND OR v_dob IS NULL THEN
      RAISE EXCEPTION
        'credential: resident record or date of birth not found -- cannot verify age / የነዋሪ መዝገብ ወይም የትውልድ ቀን አልተገኘም'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_active THEN
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

    -- Migration 29's flag: authorizes exactly one INSERT into
    -- residence_credential past its own BEFORE INSERT guard
    -- (enforce_workflow_insert(), zz_enforce_workflow_insert trigger).
    -- Transaction-scoped (`true`) so it can never leak across a pooled
    -- connection. Restored after migration 66 silently dropped it.
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

    -- Clear it immediately: the flag authorizes exactly one INSERT, not the
    -- remainder of the transaction.
    PERFORM set_config('app.minting_credential', '', true);

    NEW.credential_id := v_new_credential_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
