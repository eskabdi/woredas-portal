-- Follow-up hardening on top of 00000000000019_override_hardening.sql,
-- found during a full review of the RBAC remediation work. Three
-- independent findings:
--
--   Finding A (critical): 019's narrowed SELECT policy on
--   user_permission_override dropped the woreda scoping entirely when it
--   replaced `woreda_id = get_user_woreda_id()` with a bare `is_tenant_admin()`
--   check. is_tenant_admin() only asks "is this caller a tenant admin
--   anywhere" -- it says nothing about which woreda a given row belongs to
--   -- so any tenant admin could SELECT every override row for every tenant
--   on the platform. Only the client's own `.eq("user_id", ...)` filter
--   (src/lib/userPermissionOverrides.ts) was hiding this; RLS itself allowed
--   the cross-tenant read. Restores the same `AND woreda_id =
--   get_user_woreda_id()` the write policies already have.
--
--   Finding B: user_permission_override_target_role_ok(uuid), a callable
--   (non-trigger) SECURITY DEFINER function added in 019, was never revoked
--   from PUBLIC/anon -- unlike every other callable SECURITY DEFINER helper
--   in this codebase (00000000000008_close_definer_helpers.sql,
--   00000000000016_current_permissions_rpc.sql). An unauthenticated caller
--   with the anon key could call it directly with an arbitrary user_id and
--   use the true/false result to test whether that id belongs to a
--   tenant_admin/super_admin -- a privilege-enumeration oracle.
--
--   Finding C: role_permission's INSERT/UPDATE policies (baseline.sql) only
--   exclude the three original locked keys (credential.approve,
--   civil.approve, tenant.manage), while 019 extended
--   user_permission_override's own lock list to five keys specifically
--   because platform.manage/tenant.create must never be tenant-grantable.
--   role_permission is populated with rows for every key returned by
--   default_role_perms() (00000000000015_permission_matrix_backfill.sql),
--   which include those two platform keys for every role -- so a tenant
--   admin could flip platform.manage/tenant.create on for any role in their
--   own tenant via the ordinary Roles & Permissions UI. No policy currently
--   consumes either key, so this was latent rather than a live escalation,
--   but it's the same gap 019 explicitly closed on the sibling table and
--   should close here too.

-- Finding A
DROP POLICY user_permission_override_select_same_woreda ON public.user_permission_override;
CREATE POLICY user_permission_override_select_same_woreda ON public.user_permission_override
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (is_tenant_admin() AND woreda_id = get_user_woreda_id())
    OR user_id = auth.uid()
  );

-- Finding B
REVOKE EXECUTE ON FUNCTION public.user_permission_override_target_role_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_permission_override_target_role_ok(uuid) TO authenticated, service_role;

-- Finding C
DROP POLICY role_permission_insert_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create'
    ])
  );

DROP POLICY role_permission_update_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_update_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create'
    ])
  )
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create'
    ])
  );

-- Finding D: 019's user_permission_override_target_role_ok() blocks a
-- tenant admin from deleting an override once its target is promoted to
-- tenant_admin/super_admin (by design -- a tenant admin should not be able
-- to touch another admin's overrides). But nothing clears the override when
-- the promotion happens, unlike the woreda-change case 019 already handles
-- with clear_overrides_on_woreda_change. Left in place, the stale override
-- becomes permanent and unmanageable through any UI: user_has_perm() still
-- honors it, RolesPermissionsTab has no screen for this table at all, and
-- the DELETE policy above now excludes exactly the tenant admin who could
-- previously remove it. Auto-clear on promotion, the same way a tenant
-- move already does.
CREATE OR REPLACE FUNCTION public.clear_overrides_on_role_promotion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IN ('tenant_admin', 'super_admin') THEN
    DELETE FROM public.user_permission_override WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_user_clear_overrides_on_role_promotion ON public.app_user;
CREATE TRIGGER app_user_clear_overrides_on_role_promotion
  AFTER UPDATE OF role ON public.app_user
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.clear_overrides_on_role_promotion();
