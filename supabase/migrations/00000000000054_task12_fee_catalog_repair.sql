-- Task 12 (fix-task-production-readiness-v3): Stage 4's fee lookup needs to
-- move from the flat per-woreda woreda_settings.credential_issuance_fee to
-- Task 11's per-service-type fee_schedule table. Before wiring that up, the
-- live catalog itself has gaps that would make a fail-closed resolver
-- immediately break payment recording for most tenants:
--
--   - 5 of 6 woredas have 'Lost ID Replacement' stuck at
--     status = 'review_required', not 'active'.
--   - 5 of 6 woredas have no 'Internal Re-Print' row at all.
--   - No woreda has a row for a brand-new ID (request_type = 'new_issue').
--
-- This is seed drift, the same class of bug as the role_permission F-05
-- fix -- the catalog is missing/stale data, not a schema problem. Owner
-- decision: repair the DATA (this migration), keep the resolver strictly
-- fail-closed (no woreda_settings fallback, no resolving from a
-- review_required row), and add a completeness check so this can't drift
-- again silently.
--
-- Mapping (recorded again in docs/erd.md):
--   new_issue                                -> 'New ID Issuance'
--   renewal                                  -> 'ID Renewal'
--   reissue_lost/damaged/stolen/correction    -> 'Lost ID Replacement'
--   (the reprint exception flow, separately)  -> 'Internal Re-Print'
--
-- Pre-production (D2: nothing issued yet), so activating the
-- review_required rows changes no resident-facing history -- and their
-- amounts (150 for every woreda but one already-active row) already match
-- what woreda_settings.credential_issuance_fee charges today, so no fee
-- actually changes for any tenant. New rows default to that same flat fee
-- so this migration is a repair, not a policy change.

BEGIN;

-- 1. Activate the existing 'Lost ID Replacement' rows -- preserve amounts.
UPDATE public.fee_schedule
   SET status = 'active', updated_at = now()
 WHERE service_type = 'Lost ID Replacement'
   AND status = 'review_required';

-- 2. Fill in 'Internal Re-Print' wherever it's missing, at the woreda's
-- current flat fee.
INSERT INTO public.fee_schedule (woreda_id, service_type, standard_fee, penalty_rate, status, effective_from)
SELECT w.woreda_id, 'Internal Re-Print', COALESCE(ws.credential_issuance_fee, 0), 0, 'active', current_date
  FROM public.woreda w
  LEFT JOIN public.woreda_settings ws ON ws.woreda_id = w.woreda_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.fee_schedule fs
    WHERE fs.woreda_id = w.woreda_id AND fs.service_type = 'Internal Re-Print'
 );

-- 3. Fill in 'New ID Issuance' wherever it's missing (every woreda, today).
INSERT INTO public.fee_schedule (woreda_id, service_type, standard_fee, penalty_rate, status, effective_from)
SELECT w.woreda_id, 'New ID Issuance', COALESCE(ws.credential_issuance_fee, 0), 0, 'active', current_date
  FROM public.woreda w
  LEFT JOIN public.woreda_settings ws ON ws.woreda_id = w.woreda_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.fee_schedule fs
    WHERE fs.woreda_id = w.woreda_id AND fs.service_type = 'New ID Issuance'
 );

-- 4. Fee resolver. Strictly fail-closed: an active row must exist for the
-- caller's OWN woreda (get_user_woreda_id(), never a client-supplied
-- woreda_id -- there is nothing to validate against tenancy-wise, since
-- there is no tenancy parameter at all) and the mapped service_type, or the
-- function raises with a message naming the missing service_type. No
-- fallback to woreda_settings, no resolving a review_required/inactive row.
CREATE OR REPLACE FUNCTION public.resolve_credential_fee(_request_type text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_service_type text;
  v_amount numeric;
BEGIN
  v_service_type := CASE _request_type
    WHEN 'new_issue' THEN 'New ID Issuance'
    WHEN 'renewal' THEN 'ID Renewal'
    WHEN 'reissue_lost' THEN 'Lost ID Replacement'
    WHEN 'reissue_damaged' THEN 'Lost ID Replacement'
    WHEN 'reissue_stolen' THEN 'Lost ID Replacement'
    WHEN 'reissue_correction' THEN 'Lost ID Replacement'
    ELSE NULL
  END;

  IF v_service_type IS NULL THEN
    RAISE EXCEPTION 'resolve_credential_fee: unknown request_type %', _request_type
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT fs.standard_fee INTO v_amount
    FROM public.fee_schedule fs
   WHERE fs.woreda_id = v_woreda_id
     AND fs.service_type = v_service_type
     AND fs.status = 'active'
     AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
   ORDER BY fs.effective_from DESC NULLS LAST
   LIMIT 1;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = format(
        'ክፍያ መርሃ ግብር አልተገኘም ለ "%s" / No active fee schedule found for "%s" — an administrator must add or activate it in Settings.',
        v_service_type, v_service_type
      ),
      DETAIL = v_service_type;
  END IF;

  RETURN v_amount;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_credential_fee(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_credential_fee(text) TO authenticated, service_role;

COMMIT;
