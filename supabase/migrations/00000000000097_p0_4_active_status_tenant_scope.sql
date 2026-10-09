-- ============================================================================
-- P0-4 (2026-09-24 audit, WP-DB-001, merges WP-AUTH-002): pending, suspended
-- and inactive staff lose tenant access at the database, immediately.
--
-- Migration 11 put status = 'active' into is_super_admin()/is_tenant_admin(),
-- and user_has_perm() already had it, but get_user_woreda_id() never did. It
-- is the tenant anchor in 173 RLS policy clauses (every tenant table and every
-- tenant storage.objects policy) and in 27 functions, including
-- decrypt_pii_text(). A suspended clerk with a live session could therefore
-- still read the whole woreda -- decrypted national IDs and phone numbers
-- included -- and read or delete its scanned documents, straight through
-- PostgREST and Storage.
--
-- Returning NULL for any non-active account makes every `woreda_id =
-- get_user_woreda_id()` comparison NULL (not true), so all of those policies
-- and functions fail closed at once. The account can still read its own
-- app_user row (app_user_self_read's `user_id = auth.uid()` branch), which is
-- what lets the portal explain *why* it has no access.
--
-- The session side of the fix is the set-staff-status Edge Function, which
-- also bans the auth user on suspension so the refresh token stops working.
--
-- Additive only: CREATE OR REPLACE, same signature, same SECURITY DEFINER;
-- search_path tightened to '' (body is fully qualified).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_woreda_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT au.woreda_id
  FROM public.app_user au
  WHERE au.user_id = auth.uid()
    AND au.status = 'active';
$function$;
