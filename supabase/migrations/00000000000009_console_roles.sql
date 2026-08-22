-- ============================================================================
-- Console Users and Role: a new, second permission dimension scoped to the
-- Super Admin Console itself.
--
-- role_permission (the existing customizable-permission table) cannot be
-- reused for this: its role_name CHECK excludes 'super_admin'/'tenant_admin'
-- entirely, and its woreda_id NOT NULL FK hard-scopes every row to a single
-- tenant. There is no platform-level row shape it can hold. Today any
-- app_user with role='super_admin' can do literally everything under /admin
-- -- console_role introduces named, admin-defined roles ("Tenant Manager",
-- "Template Editor") each carrying its own subset of console permissions,
-- assignable per super_admin.
-- ============================================================================

CREATE TABLE public.console_role (
  console_role_id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  -- Lets a role be taken out of use without deleting it (and losing its
  -- permission grid / breaking the FK from any app_user row still assigned
  -- to it). A disabled role's holders keep their console_role_id but
  -- user_has_console_perm() below treats a disabled role as granting
  -- nothing -- see the is_active check in that function.
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid REFERENCES public.app_user(user_id)
);

-- The fixed set of console-specific permission keys. Deliberately a CHECK
-- constraint, not a lookup table -- matches how the tenant-side P.* keys in
-- src/config/permissions.ts are plain string literals with no catalog table.
CREATE TABLE public.console_role_permission (
  console_role_id uuid NOT NULL REFERENCES public.console_role(console_role_id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  is_granted boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (console_role_id, permission_key),
  CONSTRAINT console_role_permission_key_check CHECK (permission_key = ANY (ARRAY[
    'console.tenants.manage',
    'console.users.manage',
    'console.audit.view',
    'console.credential_template.manage',
    'console.console_users.manage'
  ]::text[]))
);

-- console_role_id is NULL for every existing row after this ALTER (no
-- explicit UPDATE needed) -- and NULL means "unrestricted full access", the
-- load-bearing backward-compat property that keeps every current
-- super_admin, including whoever runs this migration, working exactly as
-- before. A non-null console_role_id narrows a super_admin down to that
-- role's granted permissions only. Never give this column a DEFAULT other
-- than NULL.
ALTER TABLE public.app_user
  ADD COLUMN console_role_id uuid REFERENCES public.console_role(console_role_id),
  ADD CONSTRAINT app_user_console_role_scope_check
    CHECK (console_role_id IS NULL OR role = 'super_admin');

CREATE OR REPLACE FUNCTION public.user_has_console_perm(_perm text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = auth.uid()
      AND au.role = 'super_admin'
      AND au.status = 'active'
      AND (
        au.console_role_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.console_role_permission crp
          JOIN public.console_role cr ON cr.console_role_id = crp.console_role_id
          WHERE crp.console_role_id = au.console_role_id
            AND crp.permission_key = _perm
            AND crp.is_granted = true
            AND cr.is_active = true
        )
      )
  )
$function$;

-- Same closure discipline as 00000000000008_close_definer_helpers.sql:
-- Postgres grants EXECUTE to PUBLIC by default, so anon inherits it unless
-- explicitly revoked; the re-grant to authenticated is required since this
-- runs inside RLS-adjacent app logic evaluated as the querying role.
REVOKE EXECUTE ON FUNCTION public.user_has_console_perm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_console_perm(text) TO authenticated, service_role;

ALTER TABLE public.console_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.console_role_permission ENABLE ROW LEVEL SECURITY;

-- Writes gated on plain is_super_admin(), not user_has_console_perm() itself,
-- for v1: simpler to reason about, and there is no bootstrapping hazard
-- either way since console_role_id defaults to NULL (unrestricted) for every
-- existing admin. Tightening this table's own write policy to
-- 'console.console_users.manage' is a safe, isolated follow-up once the
-- feature has shipped and at least one admin has assigned themselves that
-- permission.
CREATE POLICY console_role_read_super_admin ON public.console_role
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY console_role_write_super_admin ON public.console_role
  AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY console_role_permission_read_super_admin ON public.console_role_permission
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY console_role_permission_write_super_admin ON public.console_role_permission
  AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE TRIGGER set_console_role_updated_at BEFORE UPDATE ON public.console_role
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
