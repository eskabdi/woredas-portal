-- Payment hardening checkpoint 2: fixes from workflow-fsm-review and
-- tenant-isolation-review on migration 00000000000065. Both reviews found
-- the same root problem from two angles -- the fee guard trusted context it
-- should have verified itself -- plus independent findings each caught.
--
--   H1 (workflow-fsm-review): the fee guard skips any payment_type outside
--       its three names, and none of the three payment-terminal gates check
--       payment_type at all -- a payment inserted as 'penalty'/'house_rent'/
--       'rental_rent' with any amount, linked to a service_request/
--       vital_event/credential_request, sails through both the guard (wrong
--       type, early return) and the gate (type never checked) to reach
--       'paid'. Fixed by having each payment-terminal gate itself assert
--       the confirmed payment's payment_type, not just its link/status.
--   H2 (both reviews, independently): the guard trigger's `OF` column list
--       omitted service_request_id/vital_event_id/credential_request_id/
--       woreda_id -- a payment validated against one request could be
--       re-pointed at a pricier one afterward with no re-check. Fixed by
--       widening the trigger's column list.
--   M1/M2 (workflow-fsm-review): the guard called resolve_service_fee()/
--       resolve_civil_fee(), which resolve against the CALLER's session
--       woreda (get_user_woreda_id()), not the payment row's own woreda_id
--       or the linked request's woreda_id -- wrong for a super_admin (NULL
--       session woreda, hard error) and, for civil/credential (whose
--       resolver argument is a bare enum, not a tenant-scoped id), silently
--       resolves against the caller's own catalog instead of raising for a
--       cross-tenant link. Fixed by resolving the fee directly against the
--       LINKED REQUEST's own woreda_id inline, with an explicit woreda-match
--       assertion, instead of delegating to the session-scoped RPCs.
--   Waiver authorization (tenant-isolation-review): the pre-existing
--       supervisor-authorization requirement on a fee deviation
--       ("waivers or adjustments require supervisor authorization",
--       baseline validate_credential_fee_amount()) was dropped by
--       00000000000065 -- any payment.collect holder (finance_clerk) could
--       waive. Restored, generalized across all three modules' approve
--       permission.
--   Marriage precondition recheck (workflow-fsm-review): the vital_event
--       precondition skip condition didn't include event_details, so an
--       UPDATE that only edits the marriage spouse ids inside that JSONB
--       column (the actual location of the cross-tenant check) skipped
--       re-validation. Fixed by adding it to the skip condition, alongside
--       woreda_id on both precondition triggers (tenant-isolation-review's
--       item 5).
--   payment_decrypted view (tenant-isolation-review item 7): a plain
--       `SELECT p.*` view's column list is fixed at CREATE time -- it does
--       not pick up columns added to the base table afterward. Recreated so
--       waived/waiver_reason are visible through it like every other column.
--
-- Additive: no DROP of a table, function signature, or CHECK constraint.
-- The view is dropped and recreated (data-free object, same pattern already
-- used for payment_decrypted/rental_occupancy_decrypted in
-- 00000000000023); trigger column lists are widened via DROP TRIGGER +
-- CREATE TRIGGER (same trigger name, same table); every function body
-- changes only via CREATE OR REPLACE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fee guard rewrite: resolve the fee against the LINKED REQUEST's own
--    woreda_id, not the caller's session, and require that woreda_id match
--    the payment row's own woreda_id. Waiver now requires supervisor
--    authorization, same shape as the function this migration series
--    replaced (baseline validate_credential_fee_amount()), generalized to
--    all three modules' own approve permission.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_credential_fee_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expected numeric;
  v_entity_woreda uuid;
BEGIN
  IF NEW.payment_type NOT IN ('service_fee', 'civil_registration_fee', 'credential_fee') THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_type = 'service_fee' THEN
    SELECT sr.woreda_id, st.fee_amount INTO v_entity_woreda, v_expected
      FROM public.service_request sr
      JOIN public.service_type st
        ON st.service_type_id = sr.service_type_id AND st.woreda_id = sr.woreda_id
     WHERE sr.service_request_id = NEW.service_request_id;

  ELSIF NEW.payment_type = 'civil_registration_fee' THEN
    SELECT ve.woreda_id INTO v_entity_woreda
      FROM public.vital_event ve
     WHERE ve.vital_event_id = NEW.vital_event_id;

    IF v_entity_woreda IS NOT NULL THEN
      SELECT fs.standard_fee INTO v_expected
        FROM public.vital_event ve
        JOIN public.fee_schedule fs
          ON fs.woreda_id = ve.woreda_id
         AND fs.service_type = CASE ve.event_type
               WHEN 'birth' THEN 'Civil Registration - Birth'
               WHEN 'death' THEN 'Civil Registration - Death'
               WHEN 'marriage' THEN 'Civil Registration - Marriage'
             END
         AND fs.status = 'active'
         AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
       WHERE ve.vital_event_id = NEW.vital_event_id
       ORDER BY fs.effective_from DESC NULLS LAST
       LIMIT 1;
    END IF;

  ELSIF NEW.payment_type = 'credential_fee' THEN
    SELECT cr.woreda_id INTO v_entity_woreda
      FROM public.credential_request cr
     WHERE cr.credential_request_id = NEW.credential_request_id;

    IF v_entity_woreda IS NOT NULL THEN
      SELECT fs.standard_fee INTO v_expected
        FROM public.credential_request cr
        JOIN public.fee_schedule fs
          ON fs.woreda_id = cr.woreda_id
         AND fs.service_type = CASE cr.request_type
               WHEN 'new_issue' THEN 'New ID Issuance'
               WHEN 'renewal' THEN 'ID Renewal'
               WHEN 'reissue_lost' THEN 'Lost ID Replacement'
               WHEN 'reissue_damaged' THEN 'Lost ID Replacement'
               WHEN 'reissue_stolen' THEN 'Lost ID Replacement'
               WHEN 'reissue_correction' THEN 'Lost ID Replacement'
             END
         AND fs.status = 'active'
         AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
       WHERE cr.credential_request_id = NEW.credential_request_id
       ORDER BY fs.effective_from DESC NULLS LAST
       LIMIT 1;
    END IF;
  END IF;

  -- A fee-bearing payment_type with no resolvable link is a bug, not a
  -- benign case -- fail closed rather than silently accepting (the old
  -- comment claiming payment_source_exclusive_check "requires exactly one"
  -- link was wrong; the constraint permits zero).
  IF v_entity_woreda IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ክፍያው ከየትኛውም ጥያቄ ጋር አልተገናኘም / A fee-bearing payment must resolve to a real, linked request.';
  END IF;

  IF v_entity_woreda <> NEW.woreda_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ክፍያው ካለው ጥያቄ ወረዳ ጋር አይዛመድም / This payment''s woreda does not match its linked request''s woreda.';
  END IF;

  IF v_expected IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'ክፍያ መርሃ ግብር ወይም የአገልግሎት ዓይነት አልተገኘም / No active fee schedule or service type found for this request — an administrator must add or activate it in Settings.';
  END IF;

  IF NEW.waived THEN
    IF NEW.waiver_reason IS NULL OR length(trim(NEW.waiver_reason)) < 5 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'የስረዛ ምክንያት ያስፈልጋል / A waived payment requires a reason of at least 5 characters.';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR public.user_has_any_perm(ARRAY['credential.approve', 'service.approve', 'civil.approve', 'tenant.manage'])
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'insufficient_privilege',
        MESSAGE = 'ክፍያ ስረዛ የበላይ ፈቃድ ያስፈልገዋል / A fee waiver requires supervisor authorization.';
    END IF;
    IF NEW.amount <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = format(
          'የተነሳ ክፍያ 0 መሆን አለበት / A waived payment must be recorded as 0, not %s.',
          NEW.amount
        );
    END IF;
  ELSIF NEW.amount <> v_expected THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'የሚጠበቀው ክፍያ %s ብር ነው፣ የተመዘገበው ግን %s ብር ነው / Expected fee is %s ETB; recorded amount is %s ETB. Use the waiver option (requires supervisor authorization) to record a different amount, with a reason.',
        v_expected, NEW.amount, v_expected, NEW.amount
      );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_credential_fee ON public.payment;
CREATE TRIGGER trg_validate_credential_fee
  BEFORE INSERT OR UPDATE OF
    amount, payment_type, waived, waiver_reason,
    service_request_id, vital_event_id, credential_request_id, woreda_id
  ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.validate_credential_fee_amount();

-- ---------------------------------------------------------------------------
-- 2. Payment-terminal gates now assert payment_type, closing the
--    wrong-payment_type bypass (H1). Same shape, same tables, same trigger
--    names as 00000000000059/00000000000062 -- only the EXISTS clause's
--    payment_type predicate is new.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_service_request_payment_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipted BOOLEAN;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a service request may only be paid from awaiting_payment (was %)', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = NEW.payment_id
         AND p.service_request_id = NEW.service_request_id
         AND p.woreda_id = NEW.woreda_id
         AND p.payment_type = 'service_fee'
         AND p.status = 'confirmed'
    ) INTO v_receipted;

    IF NEW.payment_id IS NULL OR NOT v_receipted THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ክፍያ ወይም ደረሰኝ አልተገኘም / A confirmed payment with a receipt is required before payment can be finalized -- even a free request must write a zero-value payment and receipt.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_vital_event_payment_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipted BOOLEAN;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a vital event may only be paid from awaiting_payment (was %)', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = NEW.payment_id
         AND p.vital_event_id = NEW.vital_event_id
         AND p.woreda_id = NEW.woreda_id
         AND p.payment_type = 'civil_registration_fee'
         AND p.status = 'confirmed'
    ) INTO v_receipted;

    IF NEW.payment_id IS NULL OR NOT v_receipted THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ክፍያ ወይም ደረሰኝ አልተገኘም / A confirmed payment with a receipt is required before registration can be finalized -- even a free registration must write a zero-value payment and receipt.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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

    v_expiry := (CURRENT_DATE + INTERVAL '1 year')::DATE;

    INSERT INTO public.residence_credential (
      resident_id, woreda_id, credential_request_id, issue_date, expiry_date, status
    ) VALUES (
      NEW.resident_id, NEW.woreda_id, NEW.credential_request_id, CURRENT_DATE, v_expiry, 'active'
    )
    RETURNING credential_id INTO v_new_credential_id;

    NEW.credential_id := v_new_credential_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Precondition skip conditions: add woreda_id (both tables) and
--    event_details (vital_event's marriage spouse ids live there, not in a
--    column already watched).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_service_request_preconditions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category <> 'letter' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    TG_OP = 'INSERT'
    OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.service_type_id IS DISTINCT FROM OLD.service_type_id
    OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id
    OR (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.resident r
     WHERE r.resident_id = NEW.resident_id AND r.woreda_id = NEW.woreda_id
       AND r.active_flag = true
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ነዋሪው በዚህ ወረዳ ንቁ ሆኖ አልተገኘም / The linked resident is not an active resident of this woreda.';
  END IF;

  IF NEW.household_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.household h
     WHERE h.household_id = NEW.household_id AND h.woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ቤተሰቡ በዚህ ወረዳ አልተገኘም / The linked household does not belong to this woreda.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_type st
     WHERE st.service_type_id = NEW.service_type_id
       AND st.woreda_id = NEW.woreda_id
       AND st.is_active = true
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'የአገልግሎት ዓይነቱ ንቁ አይደለም ወይም አልተገኘም / The selected service type is inactive or does not belong to this woreda.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_module_config tmc
     WHERE tmc.woreda_id = NEW.woreda_id
       AND tmc.module_key = 'services'
       AND tmc.is_enabled = false
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'የአገልግሎት ጥያቄ ሞጁል ለዚህ ወረዳ ቆሟል / The Services module is disabled for this woreda.';
  END IF;

  RETURN NEW;
END;
$function$;

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
  IF current_setting('app.system_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    TG_OP = 'INSERT'
    OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id
    OR NEW.event_details IS DISTINCT FROM OLD.event_details
    OR (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  ) THEN
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

-- ---------------------------------------------------------------------------
-- 4. payment_decrypted: a plain `SELECT p.*` view's column list is fixed at
--    CREATE time in pg_rewrite -- ALTER TABLE ADD COLUMN on payment did not
--    retroactively add waived/waiver_reason to it. Recreated (data-free
--    object; same DROP+CREATE pattern the view already used in
--    00000000000023) so both columns are visible through it like every
--    other payment column.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.payment_decrypted;
CREATE VIEW public.payment_decrypted
  WITH (security_invoker = on) AS
  SELECT p.*,
         public.decrypt_pii_numeric(p.amount_enc, p.woreda_id) AS amount_decrypted
  FROM public.payment p;

-- DROP VIEW removes grants along with the object -- re-grant exactly what
-- 00000000000023 originally granted (anon gets nothing; this view carries
-- money).
REVOKE ALL ON public.payment_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_decrypted TO authenticated, service_role;

COMMIT;
