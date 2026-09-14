-- Task 14-C: get_civil_kpis(), mirroring get_service_kpis()'s
-- (00000000000062) and get_credential_kpis()'s (00000000000057) exact
-- pattern -- SECURITY DEFINER, tenant-scoped internally via
-- get_user_woreda_id() (never a client parameter), gated on civil.read so
-- a pending/suspended user or one lacking civil.read doesn't get the
-- operational picture their own table reads would correctly return empty
-- for. See docs/task14c-mapping-memo.md for the KPI definitions.
--
-- Additive: new function only, no schema change.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_civil_kpis()
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
    RAISE EXCEPTION 'get_civil_kpis: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['civil.read'])) THEN
    RAISE EXCEPTION 'get_civil_kpis: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'registered_this_month_birth', (
      SELECT count(*) FROM public.vital_event
       WHERE woreda_id = v_woreda_id AND event_type = 'birth' AND status = 'registered'
         AND date_trunc('month', updated_at) = date_trunc('month', current_date)
    ),
    'registered_this_month_death', (
      SELECT count(*) FROM public.vital_event
       WHERE woreda_id = v_woreda_id AND event_type = 'death' AND status = 'registered'
         AND date_trunc('month', updated_at) = date_trunc('month', current_date)
    ),
    'registered_this_month_marriage', (
      SELECT count(*) FROM public.vital_event
       WHERE woreda_id = v_woreda_id AND event_type = 'marriage' AND status = 'registered'
         AND date_trunc('month', updated_at) = date_trunc('month', current_date)
    ),
    'pending_verification', (
      SELECT count(*) FROM public.vital_event
       WHERE woreda_id = v_woreda_id AND status IN ('submitted', 'under_review')
    ),
    'pending_approval', (
      SELECT count(*) FROM public.vital_event
       WHERE woreda_id = v_woreda_id AND status IN ('verified', 'pending_approval')
    ),
    'awaiting_payment', (
      SELECT count(*) FROM public.vital_event
       WHERE woreda_id = v_woreda_id AND status = 'awaiting_payment'
    ),
    -- vital_event has no dedicated submitted_at/registered_at column (every
    -- row is inserted directly at 'submitted', same convention as
    -- service_request/credential_request); created_at is submission time,
    -- and updated_at at the moment status='registered' is registration
    -- time since 'registered' is a terminal status the row is never
    -- updated past (confirmed by the workflow engine's terminal-state
    -- lock -- no outbound transition exists from 'registered').
    'avg_turnaround_days', (
      SELECT round(avg(EXTRACT(EPOCH FROM (ve.updated_at - ve.created_at)) / 86400.0)::numeric, 1)
        FROM public.vital_event ve
       WHERE ve.woreda_id = v_woreda_id AND ve.status = 'registered'
         AND ve.updated_at >= now() - interval '90 days'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_civil_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_civil_kpis() TO authenticated, service_role;

COMMIT;
