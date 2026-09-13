-- Task 12-B (fix-task-production-readiness-v3): the 10 credential-module KPI
-- widgets (12.3). Server-side counting only -- the client never derives a
-- total from a list page's own (paginated, filtered) query result, since
-- that would silently undercount past the first page.
--
-- get_credential_kpis() is a single SECURITY DEFINER RPC, following
-- resolve_credential_fee()'s own established pattern (00000000000054):
-- woreda_id is resolved from get_user_woreda_id() internally, never a
-- client-supplied parameter, so there is nothing for a client to spoof.
-- Returns one jsonb object with all 10 counts rather than 10 separate
-- queries -- one round trip, one consistent read snapshot.
--
-- Metric definitions (recorded again in docs/task12-mapping-memo.md):
--   new_today            credential_request submitted today (this woreda)
--   pending_verification status in (submitted, under_review)
--   pending_approval     status = pending_approval
--   awaiting_payment     status = awaiting_payment
--   ready_or_printing    residence_credential status in (ready_to_print, printing)
--   issued_this_month    residence_credential status in (printed, active),
--                        issue_date in the current calendar month
--   returned_rate_pct    % of requests submitted this month that were ever
--                        returned (returned or approval_returned) this month,
--                        from credential_request_status_history -- NULL (not
--                        zero) when nothing was submitted this month, so the
--                        UI can render "—" instead of a misleading 0%.
--   rejected_this_month  credential_request status = rejected, updated this
--                        calendar month
--   blocked              residence_credential status in (suspended, revoked)
--   avg_turnaround_days  avg(activated_at - submitted_at) in days, for
--                        credentials activated in the last 90 days -- uses
--                        the credential_request/residence_credential columns
--                        directly (both already atomically written -- Task 10)
--                        rather than re-deriving from the two separate status
--                        history tables, which would need an entity join
--                        across credential_request_status_history and
--                        credential_status_history for no additional
--                        accuracy. NULL when nothing activated in that window.

CREATE OR REPLACE FUNCTION public.get_credential_kpis()
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
    RAISE EXCEPTION 'get_credential_kpis: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- get_user_woreda_id() only reads app_user.woreda_id -- unlike
  -- user_has_perm(), it does not check status='active' or any permission.
  -- Being SECURITY DEFINER, this function bypasses RLS on credential_request/
  -- residence_credential entirely, so without this check a pending/suspended
  -- user, or an active one whose role lacks credential.read (viewer,
  -- finance_clerk), would get the full operational picture of the woreda's
  -- credential pipeline even though every equivalent table read returns
  -- empty for them. Matches the same gate entity_read_perm_ok() already
  -- applies to credential_request reads (00000000000053).
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['credential.read'])) THEN
    RAISE EXCEPTION 'get_credential_kpis: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'new_today', (
      SELECT count(*) FROM public.credential_request
       WHERE woreda_id = v_woreda_id
         AND submitted_at::date = current_date
    ),
    'pending_verification', (
      SELECT count(*) FROM public.credential_request
       WHERE woreda_id = v_woreda_id
         AND status IN ('submitted', 'under_review')
    ),
    'pending_approval', (
      SELECT count(*) FROM public.credential_request
       WHERE woreda_id = v_woreda_id
         AND status = 'pending_approval'
    ),
    'awaiting_payment', (
      SELECT count(*) FROM public.credential_request
       WHERE woreda_id = v_woreda_id
         AND status = 'awaiting_payment'
    ),
    'ready_or_printing', (
      SELECT count(*) FROM public.residence_credential
       WHERE woreda_id = v_woreda_id
         AND status IN ('ready_to_print', 'printing')
    ),
    'issued_this_month', (
      SELECT count(*) FROM public.residence_credential
       WHERE woreda_id = v_woreda_id
         AND status IN ('printed', 'active')
         AND date_trunc('month', issue_date) = date_trunc('month', current_date)
    ),
    'returned_rate_pct', (
      SELECT CASE WHEN total = 0 THEN NULL
                  ELSE round(100.0 * returned / total, 1)
             END
        FROM (
          SELECT
            count(*) FILTER (
              WHERE date_trunc('month', cr.submitted_at) = date_trunc('month', current_date)
            ) AS total,
            count(*) FILTER (
              WHERE date_trunc('month', cr.submitted_at) = date_trunc('month', current_date)
                AND EXISTS (
                  SELECT 1 FROM public.credential_request_status_history h
                   WHERE h.credential_request_id = cr.credential_request_id
                     AND h.new_status IN ('returned', 'approval_returned')
                     AND date_trunc('month', h.changed_at) = date_trunc('month', current_date)
                )
            ) AS returned
          FROM public.credential_request cr
         WHERE cr.woreda_id = v_woreda_id
        ) t
    ),
    'rejected_this_month', (
      SELECT count(*) FROM public.credential_request
       WHERE woreda_id = v_woreda_id
         AND status = 'rejected'
         AND date_trunc('month', updated_at) = date_trunc('month', current_date)
    ),
    'blocked', (
      SELECT count(*) FROM public.residence_credential
       WHERE woreda_id = v_woreda_id
         AND status IN ('suspended', 'revoked')
    ),
    'avg_turnaround_days', (
      SELECT round(avg(EXTRACT(EPOCH FROM (rc.activated_at - cr.submitted_at)) / 86400.0)::numeric, 1)
        FROM public.residence_credential rc
        JOIN public.credential_request cr ON cr.credential_request_id = rc.credential_request_id
       WHERE rc.woreda_id = v_woreda_id
         AND rc.activated_at IS NOT NULL
         AND cr.submitted_at IS NOT NULL
         AND rc.activated_at >= now() - interval '90 days'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_credential_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credential_kpis() TO authenticated, service_role;
