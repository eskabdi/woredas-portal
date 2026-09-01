-- Hardening pass from the tenant-isolation-review of migrations 15-18 (per-user
-- permission overrides, F3/F5/F8). Four independent findings, all touching
-- role_permission and/or user_permission_override, folded into one migration:
--
--   Finding 2: role_permission_insert_tenant_admin (baseline.sql) never
--   excluded the three system-locked keys, unlike the UPDATE policy right
--   below it. F5's upsertRolePermission() can route through INSERT when no
--   row exists yet for a (woreda, role, key) triple, so this was a live path
--   around the lock, not a theoretical one.
--
--   Finding 3: user_permission_override had no restriction on the TARGET
--   user's role, so a tenant admin could grant/deny an override on another
--   tenant_admin or a super_admin -- app_user_tenant_admin_write already
--   excludes `role <> 'tenant_admin'` for exactly this reason; this table's
--   write policies never mirrored it. The CHECK constraint's locked-key list
--   also didn't cover platform.manage/tenant.create, which no role_permission
--   row ever grants at the tenant level but an override, being a separate
--   table, could have.
--
--   Finding 4: user_permission_override.woreda_id is set once by the
--   BEFORE INSERT/UPDATE trigger from migration 17, but nothing re-runs it
--   when app_user.woreda_id changes later (a person moving tenants). The
--   override rows go stale, pointing at the old tenant. Deleting them on a
--   tenant move is the safe default -- a person moving tenants should not
--   carry the previous tenant's per-user grants forward silently.
--
--   Finding 5 (schema half): role_permission.updated_by and
--   user_permission_override.updated_by are plain client-writable columns
--   with no enforcement, same as every other actor column this codebase has
--   -- force_actor_columns() is the existing fix for that, already used on
--   14 other tables (baseline.sql).
--
-- The client already sends updated_by explicitly (rolePermissions.ts,
-- userPermissionOverrides.ts); force_actor_columns() overwrites it
-- server-side regardless, so the client value becomes redundant rather than
-- required -- left as-is rather than removed, to avoid a churn-only diff.

-- Finding 2
DROP POLICY role_permission_insert_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY['credential.approve', 'civil.approve', 'tenant.manage'])
  );

-- Finding 3: CHECK constraint gains the two platform-level keys.
ALTER TABLE public.user_permission_override
  DROP CONSTRAINT user_permission_override_no_locked_keys;
ALTER TABLE public.user_permission_override
  ADD CONSTRAINT user_permission_override_no_locked_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create'
    ]));

-- Finding 3: write policies gain the same target-role exclusion
-- app_user_tenant_admin_write already applies when editing the user directly.
-- A super admin is unrestricted, matching every other policy on this table.
CREATE OR REPLACE FUNCTION public.user_permission_override_target_role_ok(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = _user_id AND au.role IN ('tenant_admin', 'super_admin')
  );
$function$;

DROP POLICY user_permission_override_write_tenant_admin ON public.user_permission_override;
CREATE POLICY user_permission_override_write_tenant_admin ON public.user_permission_override
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()
        AND public.user_permission_override_target_role_ok(user_id))
  );

DROP POLICY user_permission_override_update_tenant_admin ON public.user_permission_override;
CREATE POLICY user_permission_override_update_tenant_admin ON public.user_permission_override
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()
        AND public.user_permission_override_target_role_ok(user_id))
  )
  WITH CHECK (
    is_super_admin()
    OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()
        AND public.user_permission_override_target_role_ok(user_id))
  );

DROP POLICY user_permission_override_delete_tenant_admin ON public.user_permission_override;
CREATE POLICY user_permission_override_delete_tenant_admin ON public.user_permission_override
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()
        AND public.user_permission_override_target_role_ok(user_id))
  );

-- Lower-severity note from the same review: SELECT was open to any
-- authenticated user in the same tenant. Narrow it to the two roles that can
-- act on it plus the affected user themselves.
DROP POLICY user_permission_override_select_same_woreda ON public.user_permission_override;
CREATE POLICY user_permission_override_select_same_woreda ON public.user_permission_override
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_admin() OR user_id = auth.uid());

-- Finding 4
CREATE OR REPLACE FUNCTION public.clear_overrides_on_woreda_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.user_permission_override WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER app_user_clear_overrides_on_woreda_change
  AFTER UPDATE OF woreda_id ON public.app_user
  FOR EACH ROW
  WHEN (OLD.woreda_id IS DISTINCT FROM NEW.woreda_id)
  EXECUTE FUNCTION public.clear_overrides_on_woreda_change();

-- Finding 5 (schema half)
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.role_permission
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('updated_by');

CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.user_permission_override
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('updated_by');
