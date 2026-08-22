-- ============================================================================
-- Closes a gap the console-roles RBAC review surfaced after the client
-- actually started using it: 00000000000009_console_roles.sql deliberately
-- gated console_role/console_role_permission's RLS on plain is_super_admin(),
-- not user_has_console_perm('console.console_users.manage'), calling it "a
-- safe, isolated follow-up" for later. That reasoning held while nothing
-- consumed it; it stopped holding the moment a UI shipped that presents
-- console_role as an access boundary. Today ANY super_admin -- including one
-- deliberately scoped away from console.console_users.manage -- can grant
-- themselves every console permission with a raw PostgREST call, or flip
-- their own console_role_id back to NULL (unrestricted) the same way.
--
-- This migration makes user_has_console_perm() the actual backstop for the
-- tables and column it governs, matching the "RLS is the real backstop, the
-- UI gate is just UX" discipline already documented elsewhere in this repo.
-- ============================================================================

DROP POLICY IF EXISTS console_role_read_super_admin ON public.console_role;
DROP POLICY IF EXISTS console_role_write_super_admin ON public.console_role;
DROP POLICY IF EXISTS console_role_permission_read_super_admin ON public.console_role_permission;
DROP POLICY IF EXISTS console_role_permission_write_super_admin ON public.console_role_permission;

-- user_has_console_perm() already returns true unconditionally for an
-- unrestricted (console_role_id IS NULL) super_admin, so this is not a
-- narrower grant for the common case today -- it only starts denying once an
-- admin has actually been scoped to a role that lacks this permission.
CREATE POLICY console_role_read_console_admin ON public.console_role
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.user_has_console_perm('console.console_users.manage'));
CREATE POLICY console_role_write_console_admin ON public.console_role
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.user_has_console_perm('console.console_users.manage'))
  WITH CHECK (public.user_has_console_perm('console.console_users.manage'));

CREATE POLICY console_role_permission_read_console_admin ON public.console_role_permission
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.user_has_console_perm('console.console_users.manage'));
CREATE POLICY console_role_permission_write_console_admin ON public.console_role_permission
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.user_has_console_perm('console.console_users.manage'))
  WITH CHECK (public.user_has_console_perm('console.console_users.manage'));

-- app_user_super_admin_write already lets any super_admin write any column
-- on any app_user row, including console_role_id -- RLS is row-level and
-- can't single out one column. A trigger is the only way to require
-- console.console_users.manage specifically for *this* column, without
-- weakening every other super_admin write app_user_super_admin_write already
-- covers (role, woreda_id, status, full_name, ...).
CREATE OR REPLACE FUNCTION public.guard_console_role_assignment()
 RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.console_role_id IS DISTINCT FROM OLD.console_role_id
     AND NOT public.user_has_console_perm('console.console_users.manage') THEN
    RAISE EXCEPTION 'Only an admin with console.console_users.manage may change console_role_id';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_console_role_assignment
  BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.guard_console_role_assignment();

-- Same idea, different feature: PlatformUsersTab.tsx's UI already refuses to
-- suspend or demote the only active super_admin, computed client-side from
-- the currently-loaded row list. That is advisory only -- nothing stopped a
-- raw PATCH from doing it anyway, which is exactly the kind of lockout
-- recoverable only with the service_role key. This is the DB-level backstop
-- for that same rule.
CREATE OR REPLACE FUNCTION public.prevent_last_super_admin_lockout()
 RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  remaining_active_super_admins integer;
BEGIN
  IF OLD.role = 'super_admin' AND OLD.status = 'active'
     AND (NEW.role IS DISTINCT FROM 'super_admin' OR NEW.status IS DISTINCT FROM 'active') THEN
    SELECT count(*) INTO remaining_active_super_admins
    FROM public.app_user
    WHERE role = 'super_admin' AND status = 'active' AND user_id <> OLD.user_id;
    IF remaining_active_super_admins = 0 THEN
      RAISE EXCEPTION 'Cannot suspend or demote the last active super_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_prevent_last_super_admin_lockout
  BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_super_admin_lockout();
