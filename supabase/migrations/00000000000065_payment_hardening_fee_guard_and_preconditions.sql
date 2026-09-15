-- Payment hardening: closes watch-list items 1 and 2 from
-- docs/task14b-mapping-memo.md §9 (deferred, not fixed, in Task 14-B):
--
--   1. Payment amount was never compared to the resolved catalog fee for
--      service_request or vital_event -- only "a confirmed payment + receipt
--      exists" was required, so any amount (including 0 for a fee-bearing
--      request) reached 'paid'. credential_request already had a guard
--      (trg_validate_credential_fee / validate_credential_fee_amount()) but
--      it checked against the flat woreda_settings.credential_issuance_fee,
--      not resolve_credential_fee()'s per-request-type fee_schedule lookup
--      -- the wrong source for a catalog that already varies by request_type
--      (new_issue vs renewal vs reissue_lost all price differently).
--   2. enforce_service_request_preconditions() / enforce_vital_event_
--      preconditions() re-ran their full resident/household/service-type
--      check on every UPDATE, not only when the referencing column actually
--      changed -- a resident or service type deactivated mid-pipeline froze
--      every further transition on that specific in-flight row, including
--      pure status moves that touch no referenced entity at all.
--
-- Additive only: two new nullable/defaulted columns on payment, CREATE OR
-- REPLACE on existing trigger functions, trigger recreation (DROP TRIGGER +
-- CREATE TRIGGER, not DROP FUNCTION/TABLE/COLUMN). No CHECK constraint is
-- narrowed -- every payment row legal today stays legal (waived defaults
-- false, matching every pre-existing row's real behavior).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Waiver columns on payment. The credential module's UI has offered a
--    waiver toggle + reason since before this migration, but only ever
--    logged it as free text in credential_request_status_history.change_reason
--    and audit_log.new_value_json -- never on the payment row itself, so
--    nothing server-side could tell a legitimate waiver from a client simply
--    posting 0 for a fee-bearing request. Structured columns let the fee
--    guard below tell the two apart.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment ADD COLUMN IF NOT EXISTS waived boolean NOT NULL DEFAULT false;
ALTER TABLE public.payment ADD COLUMN IF NOT EXISTS waiver_reason text;

-- ---------------------------------------------------------------------------
-- 2. Generic fee guard, replacing validate_credential_fee_amount() (same
--    function name kept -- only CREATE OR REPLACE, no DROP FUNCTION -- but
--    broadened to all three fee-bearing payment types and repointed at each
--    module's real resolve_*_fee() RPC instead of the stale flat setting).
--    Exact-match only, no tolerance band: every fee change is expected to
--    flow through the fee schedule / service_type.fee_amount in Settings,
--    never through cashier discretion. The one sanctioned bypass is an
--    explicit waiver (amount = 0 AND a reason of at least 5 characters,
--    the same minimum the credential UI already enforces client-side).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_credential_fee_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expected numeric;
BEGIN
  IF NEW.payment_type NOT IN ('service_fee', 'civil_registration_fee', 'credential_fee') THEN
    RETURN NEW;
  END IF;

  v_expected := CASE NEW.payment_type
    WHEN 'service_fee' THEN (
      SELECT public.resolve_service_fee(sr.service_type_id)
        FROM public.service_request sr
       WHERE sr.service_request_id = NEW.service_request_id
    )
    WHEN 'civil_registration_fee' THEN (
      SELECT public.resolve_civil_fee(ve.event_type)
        FROM public.vital_event ve
       WHERE ve.vital_event_id = NEW.vital_event_id
    )
    WHEN 'credential_fee' THEN (
      SELECT public.resolve_credential_fee(cr.request_type)
        FROM public.credential_request cr
       WHERE cr.credential_request_id = NEW.credential_request_id
    )
  END;

  -- The linking id (service_request_id/vital_event_id/credential_request_id)
  -- is always set at insert time by every real caller (payment_source_
  -- exclusive_check requires exactly one), so v_expected is only NULL here
  -- if the row genuinely does not resolve -- fail open is wrong for a fee
  -- guard, but there is nothing to compare against either; the payment gate
  -- triggers already reject a request reaching 'paid' without a linked,
  -- confirmed payment, so this case cannot reach a real transition anyway.
  IF v_expected IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.waived THEN
    IF NEW.waiver_reason IS NULL OR length(trim(NEW.waiver_reason)) < 5 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'የስረዛ ምክንያት ያስፈልጋል / A waived payment requires a reason of at least 5 characters.';
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
        'የሚጠበቀው ክፍያ %s ብር ነው፣ የተመዘገበው ግን %s ብር ነው / Expected fee is %s ETB; recorded amount is %s ETB. Use the waiver option to record a different amount, with a reason.',
        v_expected, NEW.amount, v_expected, NEW.amount
      );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_credential_fee ON public.payment;
CREATE TRIGGER trg_validate_credential_fee
  BEFORE INSERT OR UPDATE OF amount, payment_type, waived, waiver_reason ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.validate_credential_fee_amount();

-- ---------------------------------------------------------------------------
-- 3. Precondition re-validation scoped to INSERT, a change of a referenced
--    column, or the payment-terminal transition -- not every UPDATE. Mirrors
--    generate_residence_credential_on_payment()'s re-assertion-at-payment
--    pattern: the moment a request reaches 'paid' is exactly when a stale
--    reference (deactivated resident/service type since submission) must
--    not be allowed to slip through, so that transition is re-checked
--    explicitly even though its own referencing columns did not just change.
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

COMMIT;
