-- F3 (docs/rbac-security-forensic-review.md): "change one person's
-- permissions independent of their role" describes a feature this codebase
-- never had -- role_permission is keyed by (tenant, role, permission), with
-- no user column anywhere in the schema, the authorization function, or the
-- client. This adds the missing per-user layer, per the report's §3.1
-- sketch and the two owner decisions its "Open Decisions" section required
-- before this table could be built (recorded in
-- docs/rbac-remediation-tracker.md):
--
--   D1 (precedence): a user-level override wins in BOTH directions over the
--   tenant-level role_permission/default -- checked first in the COALESCE
--   chain below. Caveat, carried forward from the report: any FUTURE
--   tenant-wide "kill switch" permission must be checked unconditionally,
--   OUTSIDE this chain (e.g. a hard-coded AND before the COALESCE), never
--   modeled as a role_permission deny -- otherwise a leftover per-user
--   grant would silently bypass it. No such kill switch exists today; this
--   is a note for whoever adds the first one.
--
--   D2 (lifecycle): overrides persist across a role change by default
--   (Suspension already goes inert automatically, since user_has_perm()'s
--   outer check requires status = 'active' before any of this chain runs;
--   removal is an ordinary ON DELETE CASCADE below). The "surface existing
--   overrides in the role-change UI" half of D2(c) is implemented
--   client-side in ChangeRoleDialog.

CREATE TABLE public.user_permission_override (
  user_id uuid NOT NULL REFERENCES public.app_user(user_id) ON DELETE CASCADE,
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  is_granted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, permission_key),
  -- Mirrors role_permission_update_tenant_admin's own exclusion list exactly
  -- (baseline.sql) -- these three stay system-locked (RolesPermissionsTab's
  -- LOCKED_KEYS) regardless of role customization, so a per-user override
  -- must not be a back door around that lock.
  CONSTRAINT user_permission_override_no_locked_keys
    CHECK (permission_key <> ALL (ARRAY['credential.approve', 'civil.approve', 'tenant.manage']))
);

-- woreda_id is a denormalized copy of app_user.woreda_id, carried on this
-- table (per the report's own sketch) so RLS can scope a write without a
-- subquery on every row. A tenant admin could otherwise pass an arbitrary
-- woreda_id that happens to equal their own tenant while user_id points at
-- someone in a DIFFERENT tenant -- RLS's WITH CHECK only sees this table's
-- own column, not app_user's -- so this trigger derives it from app_user
-- itself on every write rather than trusting whatever the client sent,
-- closing exactly the kind of cross-tenant path F11 traced and closed for
-- app_user directly.
CREATE OR REPLACE FUNCTION public.enforce_user_permission_override_woreda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  SELECT woreda_id INTO NEW.woreda_id FROM public.app_user WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER user_permission_override_set_woreda
  BEFORE INSERT OR UPDATE ON public.user_permission_override
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_permission_override_woreda();

CREATE TRIGGER user_permission_override_set_updated_at
  BEFORE UPDATE ON public.user_permission_override
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_permission_override ENABLE ROW LEVEL SECURITY;

-- Read/write scope mirrors role_permission's own tenant-admin-writes-own-
-- tenant pattern exactly (role_permission_select_same_woreda /
-- role_permission_insert_tenant_admin), scoped further here by the trigger
-- above pinning woreda_id to the target user's actual tenant.
CREATE POLICY user_permission_override_select_same_woreda ON public.user_permission_override
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id()));

CREATE POLICY user_permission_override_write_tenant_admin ON public.user_permission_override
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()));

CREATE POLICY user_permission_override_update_tenant_admin ON public.user_permission_override
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
  WITH CHECK (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()));

CREATE POLICY user_permission_override_delete_tenant_admin ON public.user_permission_override
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()));

-- user_has_perm(): one more link at the front of the existing COALESCE
-- chain, per D1(a) above. Unchanged below that point.
CREATE OR REPLACE FUNCTION public.user_has_perm(_perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = auth.uid()
      AND au.status = 'active'
      AND COALESCE(
            (SELECT upo.is_granted FROM public.user_permission_override upo
              WHERE upo.user_id = au.user_id AND upo.permission_key = _perm),
            (SELECT rp.is_granted FROM public.role_permission rp
              WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
                AND rp.permission_key = _perm),
            _perm = ANY (public.default_role_perms(au.role))
          )
  )
$function$;

-- current_permissions() (00000000000016_current_permissions_rpc.sql): the
-- exact same precedence, so the client's resolved list agrees with
-- user_has_perm() -- an override the RPC didn't know about would reopen F7
-- at this new layer instead of closing F3.
CREATE OR REPLACE FUNCTION public.current_permissions()
 RETURNS text[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT key), ARRAY[]::text[])
  FROM public.app_user au
  CROSS JOIN LATERAL unnest(
    ARRAY(
      SELECT upo.permission_key FROM public.user_permission_override upo
      WHERE upo.user_id = au.user_id
    ) || ARRAY(
      SELECT rp.permission_key FROM public.role_permission rp
      WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
    ) || public.default_role_perms(au.role)
  ) AS key
  WHERE au.user_id = auth.uid()
    AND au.status = 'active'
    AND COALESCE(
          (SELECT upo.is_granted FROM public.user_permission_override upo
            WHERE upo.user_id = au.user_id AND upo.permission_key = key),
          (SELECT rp.is_granted FROM public.role_permission rp
            WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
              AND rp.permission_key = key),
          key = ANY (public.default_role_perms(au.role))
        )
$function$;
