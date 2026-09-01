-- F7 (docs/rbac-security-forensic-review.md): authStore.hasPermission() was
-- computed purely from ROLE_PERMISSIONS, a map hardcoded at build time -- it
-- never asked the database what a tenant admin's Settings customization
-- (role_permission) actually granted or revoked. The client and the database
-- only agreed by coincidence, and F4 already shows they've diverged for five
-- permission keys on every tenant.
--
-- Mirrors current_console_permissions() (00000000000012_enforce_console_rbac.sql),
-- which already solves the identical problem for the admin console: resolve
-- the caller's effective permission list server-side, using the exact same
-- COALESCE precedence user_has_perm() enforces, so what the interface shows
-- and what the database allows are the same query. This does not change the
-- database's authorization boundary in any way -- user_has_perm() stays the
-- enforcement point either way; this only fixes what the client displays.
CREATE OR REPLACE FUNCTION public.current_permissions()
 RETURNS text[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT key), ARRAY[]::text[])
  FROM public.app_user au
  CROSS JOIN LATERAL unnest(
    ARRAY(
      SELECT rp.permission_key FROM public.role_permission rp
      WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
    ) || public.default_role_perms(au.role)
  ) AS key
  WHERE au.user_id = auth.uid()
    AND au.status = 'active'
    AND COALESCE(
          (SELECT rp.is_granted FROM public.role_permission rp
            WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
              AND rp.permission_key = key),
          key = ANY (public.default_role_perms(au.role))
        )
$function$;

REVOKE EXECUTE ON FUNCTION public.current_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_permissions() TO authenticated, service_role;
