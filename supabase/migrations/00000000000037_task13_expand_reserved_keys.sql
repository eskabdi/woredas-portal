-- Task 13 (fix-task-production-readiness-v3): full A4 reserved-permission
-- enforcement. 00000000000021/00000000000036 locked 6 keys out of
-- role_permission's write policies and user_permission_override's CHECK
-- constraint (credential.approve, civil.approve, tenant.manage,
-- platform.manage, tenant.create, credential.configure_policy). A4 also
-- names user.manage and credential.revoke as reserved
-- (src/config/permissions.ts, RESERVED_PERMISSION_KEYS) -- both are already
-- granted to some non-admin role by default (supervisor holds
-- credential.revoke; nothing holds user.manage yet, it's currently
-- super_admin/tenant_admin only, but a plain lock-list entry doesn't care
-- either way): the point of "reserved" is not "no role has it by default"
-- but "a tenant_admin cannot use the matrix or an override to hand it to a
-- DIFFERENT role/user than its compiled default already covers." The default
-- value itself is set by default_role_perms() via the SECURITY DEFINER
-- seeding trigger, which is not subject to these write policies -- only the
-- ordinary client-driven UPDATE/INSERT path is.
--
-- Widens the existing 6-key exclusion lists to 8 keys. Every row already
-- inserted stays valid: this only affects future INSERT/UPDATE attempts
-- through the RLS-gated write path, not the rows the seeding trigger already
-- wrote.
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

DROP POLICY role_permission_insert_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke'
    ])
  );

DROP POLICY role_permission_update_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_update_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke'
    ])
  )
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke'
    ])
  );

ALTER TABLE public.user_permission_override
  DROP CONSTRAINT user_permission_override_no_locked_keys;
ALTER TABLE public.user_permission_override
  ADD CONSTRAINT user_permission_override_no_locked_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke'
    ]));

COMMIT;
