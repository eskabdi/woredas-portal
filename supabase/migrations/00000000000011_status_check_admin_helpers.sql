-- ============================================================================
-- Close a gap the console-roles review surfaced: is_super_admin() and
-- is_tenant_admin() (baseline.sql) check only `role`, never `status`, while
-- every other privileged-check function added since (user_has_perm(),
-- user_has_console_perm()) requires status = 'active'. A suspended
-- super_admin or tenant_admin therefore still passes is_super_admin()/
-- is_tenant_admin() and everything gated purely on them -- including every
-- RLS policy and RPC in 00000000000009/00000000000010 that uses
-- is_super_admin() as its write gate.
--
-- This is a single-point fix rather than patching each policy individually,
-- matching how user_has_perm() already treats status.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user
    WHERE user_id = auth.uid() AND role = 'super_admin' AND status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user
    WHERE user_id = auth.uid() AND role = 'tenant_admin' AND status = 'active'
  );
$function$;

-- console_role gets this trigger in 00000000000009_console_roles.sql;
-- console_role_permission has the same updated_at column but was missed.
CREATE TRIGGER set_console_role_permission_updated_at BEFORE UPDATE ON public.console_role_permission
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
