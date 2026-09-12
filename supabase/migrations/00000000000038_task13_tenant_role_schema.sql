-- Task 13 (fix-task-production-readiness-v3, D4): custom (tenant-defined)
-- roles. Mirrors 00000000000009_console_roles.sql's console_role /
-- console_role_permission pattern, but scoped per-woreda instead of
-- platform-wide, and gated on is_tenant_admin()+woreda_id instead of
-- is_super_admin().
--
-- role_permission cannot be reused for this: its role_name column is a
-- fixed CHECK-enumerated set of the 7 built-in editable roles
-- (role_permission_role_name_check), and a custom role has no stable name
-- to key on across woredas (two tenants could each name a role "Cashier"
-- with completely different grants). tenant_role gives each custom role its
-- own uuid identity; tenant_role_permission grants against that uuid,
-- exactly like console_role_permission grants against console_role_id.
--
-- app_user.custom_role_id is NULL for every existing row after this ALTER
-- (no explicit UPDATE needed) -- built-in-role users never set it. A5's
-- trigger-based validation (00000000000039) is what actually enforces
-- "custom_role_id set iff role = 'custom', and only to an active tenant_role
-- in the same woreda" -- a plain CHECK can't express the cross-table,
-- same-tenant, is_active condition, hence the trigger.
--
-- ADDITIVE. No DROP of any table or column.

CREATE TABLE public.tenant_role (
  tenant_role_id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  name text NOT NULL,
  description text,
  -- Same soft-disable pattern as console_role.is_active: deactivating a role
  -- keeps every app_user row's custom_role_id intact (no FK to break) but
  -- user_has_perm()/current_permissions() (00000000000039) treat an inactive
  -- role as granting nothing, and A5's trigger refuses to assign a user to
  -- an inactive role going forward.
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid REFERENCES public.app_user(user_id),
  updated_by uuid REFERENCES public.app_user(user_id),
  UNIQUE (woreda_id, name)
);

-- Same reserved-key exclusion as role_permission's write policies and
-- user_permission_override's CHECK (see RESERVED_PERMISSION_KEYS,
-- src/config/permissions.ts) -- a custom role can never be handed an
-- administrative/approval power that's locked from the ordinary matrix and
-- override paths either.
CREATE TABLE public.tenant_role_permission (
  tenant_role_id uuid NOT NULL REFERENCES public.tenant_role(tenant_role_id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  is_granted boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid REFERENCES public.app_user(user_id),
  PRIMARY KEY (tenant_role_id, permission_key),
  CONSTRAINT tenant_role_permission_no_reserved_keys CHECK (permission_key <> ALL (ARRAY[
    'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
    'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke'
  ]))
);

ALTER TABLE public.app_user
  ADD COLUMN custom_role_id uuid REFERENCES public.tenant_role(tenant_role_id);

ALTER TABLE public.tenant_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_permission ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_role_read ON public.tenant_role
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id());
CREATE POLICY tenant_role_write ON public.tenant_role
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
  WITH CHECK (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()));

CREATE POLICY tenant_role_permission_read ON public.tenant_role_permission
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_role tr
    WHERE tr.tenant_role_id = tenant_role_permission.tenant_role_id
      AND (is_super_admin() OR tr.woreda_id = get_user_woreda_id())
  ));
CREATE POLICY tenant_role_permission_write ON public.tenant_role_permission
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_role tr
    WHERE tr.tenant_role_id = tenant_role_permission.tenant_role_id
      AND (is_super_admin() OR (is_tenant_admin() AND tr.woreda_id = get_user_woreda_id()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_role tr
    WHERE tr.tenant_role_id = tenant_role_permission.tenant_role_id
      AND (is_super_admin() OR (is_tenant_admin() AND tr.woreda_id = get_user_woreda_id()))
  ));

CREATE TRIGGER set_tenant_role_updated_at BEFORE UPDATE ON public.tenant_role
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tenant_role_force_actor BEFORE INSERT OR UPDATE ON public.tenant_role
  FOR EACH ROW EXECUTE FUNCTION force_actor_columns('created_by', 'updated_by');
