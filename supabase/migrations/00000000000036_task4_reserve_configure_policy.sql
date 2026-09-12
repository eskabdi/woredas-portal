-- Task 4 follow-up (rbac-escalation-review F2): credential.configure_policy
-- is documented in permissions.ts (A4) as "Reserved: tenant_admin only,
-- never grantable to another role or via override" -- the same status as
-- credential.approve/civil.approve/tenant.manage/platform.manage/
-- tenant.create, which 00000000000021_override_security_fixes.sql already
-- locks out of role_permission's INSERT/UPDATE policies. Migration 035
-- created this key and backfilled a role_permission row for it on every
-- editable role, but never added it to that lock list, so a tenant_admin
-- could flip it on for any role in their own tenant via the ordinary Roles
-- & Permissions UI -- the exact gap Finding C in 00000000000021 closed for
-- platform.manage/tenant.create. Closing it here rather than waiting for
-- Task 13's broader reserved-set work, since this PR is the one that
-- created the key.
--
-- Same three surfaces 00000000000021/00000000000019 touched:
--   1. role_permission INSERT/UPDATE policies (role_permission_role_name_check
--      itself doesn't enumerate keys, so nothing to widen there).
--   2. user_permission_override's no-locked-keys CHECK constraint.
-- Both replacements are ADD-only in effect (six keys instead of five); no
-- existing row can be in violation since none held this key with a granted
-- override before now (the key didn't exist).
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

DROP POLICY role_permission_insert_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create', 'credential.configure_policy'
    ])
  );

DROP POLICY role_permission_update_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_update_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create', 'credential.configure_policy'
    ])
  )
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create', 'credential.configure_policy'
    ])
  );

ALTER TABLE public.user_permission_override
  DROP CONSTRAINT user_permission_override_no_locked_keys;
ALTER TABLE public.user_permission_override
  ADD CONSTRAINT user_permission_override_no_locked_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage',
      'platform.manage', 'tenant.create', 'credential.configure_policy'
    ]));

COMMIT;
