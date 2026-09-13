-- Task 14-B, part 2: payment gate, letter-issuance gate (the core security
-- fix this task names), event-type preconditions, fee resolution, and the
-- services KPI RPC. See docs/task14b-mapping-memo.md sections 2, 3, 6, 7.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Payment gate. Mirrors enforce_vital_event_payment_gate() exactly,
--    including the vital_event_id-binding lesson from Task 14-A's own HIGH
--    security finding: the confirmed payment/receipt must belong to THIS
--    service_request, not just exist somewhere in the tenant.
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

DROP TRIGGER IF EXISTS zzz_enforce_service_request_payment_gate ON public.service_request;
CREATE TRIGGER zzz_enforce_service_request_payment_gate
  BEFORE UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_request_payment_gate();

-- ---------------------------------------------------------------------------
-- 2. Letter-issuance gate -- the core security fix this task names.
--    issueLetter() has always been a plain client-side UPDATE with no
--    server-side check that the request was actually paid first (see
--    mapping memo §2). This closes it: a transition INTO 'issued' is
--    rejected unless the request is coming from 'paid'.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_service_request_issuance_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'issued' AND (OLD.status IS DISTINCT FROM 'issued') THEN
    IF OLD.status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ደብዳቤው ሊሰጥ የሚችለው ክፍያ ከተጠናቀቀ በኋላ ብቻ ነው / A letter can only be issued after payment is complete.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_enforce_service_request_issuance_gate ON public.service_request;
CREATE TRIGGER zzz_enforce_service_request_issuance_gate
  BEFORE UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_request_issuance_gate();

-- ---------------------------------------------------------------------------
-- 3. Pre-conditions, fail-closed, tenant-scoped, bilingual, category='letter'
--    scope per the mapping memo §0.1/§3. Only validates resident/household
--    when actually supplied -- the exact lesson Task 14-A's own birth
--    precondition had to learn live in production (see that task's
--    remediation-report.md §10.5). Complaints are untouched (§0.1).
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

DROP TRIGGER IF EXISTS trg_enforce_service_request_preconditions ON public.service_request;
CREATE TRIGGER trg_enforce_service_request_preconditions
  BEFORE INSERT OR UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_request_preconditions();

-- ---------------------------------------------------------------------------
-- 4. Fee resolution. Mirrors resolve_credential_fee()/resolve_civil_fee()'s
--    fail-closed/tenant-scoped/permission-checked shape, but the source of
--    truth stays service_type.fee_amount (mapping memo §0.4) -- no
--    fee_schedule duplication.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_service_fee(_service_type_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_amount numeric;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'resolve_service_fee: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['service.read', 'service.record_payment'])) THEN
    RAISE EXCEPTION 'resolve_service_fee: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT st.fee_amount INTO v_amount
    FROM public.service_type st
   WHERE st.service_type_id = _service_type_id
     AND st.woreda_id = v_woreda_id
     AND st.is_active = true;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'የአገልግሎት ዓይነቱ ንቁ አይደለም ወይም አልተገኘም / The selected service type is inactive or does not belong to this woreda.';
  END IF;

  RETURN v_amount;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_service_fee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_service_fee(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Services KPI RPC, mirroring get_credential_kpis()'s exact pattern:
--    SECURITY DEFINER, internally woreda_id-scoped (never a client
--    parameter), gated on service.read so a pending/suspended user or one
--    lacking service.read doesn't get the operational picture their own
--    table reads would correctly return empty for. Scoped to
--    category='letter' (the module this task's FSM actually covers).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_service_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_result jsonb;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_service_kpis: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['service.read'])) THEN
    RAISE EXCEPTION 'get_service_kpis: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'new_today', (
      SELECT count(*) FROM public.service_request
       WHERE woreda_id = v_woreda_id AND category = 'letter'
         AND submitted_at::date = current_date
    ),
    'pending_verification', (
      SELECT count(*) FROM public.service_request
       WHERE woreda_id = v_woreda_id AND category = 'letter'
         AND status IN ('submitted', 'under_review')
    ),
    'pending_approval', (
      SELECT count(*) FROM public.service_request
       WHERE woreda_id = v_woreda_id AND category = 'letter'
         AND status IN ('verified', 'pending_approval')
    ),
    'awaiting_payment', (
      SELECT count(*) FROM public.service_request
       WHERE woreda_id = v_woreda_id AND category = 'letter'
         AND status = 'awaiting_payment'
    ),
    'issued_this_month', (
      SELECT count(*) FROM public.service_request
       WHERE woreda_id = v_woreda_id AND category = 'letter'
         AND status IN ('issued', 'completed')
         AND date_trunc('month', issued_at) = date_trunc('month', current_date)
    ),
    'rejected_this_month', (
      SELECT count(*) FROM public.service_request
       WHERE woreda_id = v_woreda_id AND category = 'letter'
         AND status = 'rejected'
         AND date_trunc('month', updated_at) = date_trunc('month', current_date)
    ),
    'avg_turnaround_days', (
      SELECT round(avg(EXTRACT(EPOCH FROM (sr.issued_at - sr.submitted_at)) / 86400.0)::numeric, 1)
        FROM public.service_request sr
       WHERE sr.woreda_id = v_woreda_id AND sr.category = 'letter'
         AND sr.issued_at IS NOT NULL
         AND sr.submitted_at IS NOT NULL
         AND sr.issued_at >= now() - interval '90 days'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_service_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_service_kpis() TO authenticated, service_role;

COMMIT;
