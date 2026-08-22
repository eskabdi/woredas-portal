-- ============================================================================
-- Closes a gap the console-roles RBAC review surfaced after the client
-- actually started using it: 00000000000009_console_roles.sql deliberately
-- gated console_role/console_role_permission's RLS on plain is_super_admin(),
-- not user_has_console_perm('console.console_users.manage'), calling it "a
-- safe, isolated follow-up" for later. That reasoning held while nothing
-- consumed it; it stopped holding the moment a UI shipped that presents
-- console_role as an access boundary. Before this migration, ANY
-- super_admin -- including one deliberately scoped away from
-- console.console_users.manage -- could grant themselves every console
-- permission with a raw PostgREST call, or flip their own console_role_id
-- back to NULL (unrestricted) the same way.
--
-- This migration makes user_has_console_perm() the actual backstop for the
-- tables and column it governs, matching the "RLS is the real backstop, the
-- UI gate is just UX" discipline already documented elsewhere in this repo.
--
-- Superseded/rewritten once already: an earlier version of this file shipped
-- with a real-Postgres review that found it made the console-role feature
-- unusable for its intended users (the new SELECT policy blocked a scoped
-- admin from reading their own granted permissions, so hasConsolePermission
-- always saw an empty list) and left the INSERT path (inviting a brand new
-- super_admin) completely uncovered, since the trigger was UPDATE-only. Both
-- are fixed below. This migration was never applied to any deployed
-- project, so it is rewritten in place rather than layered with a follow-up.
-- ============================================================================

DROP POLICY IF EXISTS console_role_read_super_admin ON public.console_role;
DROP POLICY IF EXISTS console_role_write_super_admin ON public.console_role;
DROP POLICY IF EXISTS console_role_permission_read_super_admin ON public.console_role_permission;
DROP POLICY IF EXISTS console_role_permission_write_super_admin ON public.console_role_permission;

-- Writes: user_has_console_perm() already returns true unconditionally for
-- an unrestricted (console_role_id IS NULL) super_admin, so this is not a
-- narrower grant for the common case today -- it only starts denying once an
-- admin has actually been scoped to a role that lacks this permission.
CREATE POLICY console_role_write_console_admin ON public.console_role
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.user_has_console_perm('console.console_users.manage'))
  WITH CHECK (public.user_has_console_perm('console.console_users.manage'));
CREATE POLICY console_role_permission_write_console_admin ON public.console_role_permission
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.user_has_console_perm('console.console_users.manage'))
  WITH CHECK (public.user_has_console_perm('console.console_users.manage'));

-- Reads: deliberately left open to any active super_admin, not narrowed to
-- console.console_users.manage. Narrowing it is what broke the feature the
-- first time this migration was written -- a scoped admin without that
-- permission still needs to read console_role/console_role_permission
-- themselves, via current_console_permissions() below, to know what they
-- themselves are allowed to do. Restricting SELECT here would re-introduce
-- that bug in a different shape (an RPC that can read what a direct table
-- query can't). Every *write* is still fully covered by the policies above.
CREATE POLICY console_role_read_super_admin ON public.console_role
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY console_role_permission_read_super_admin ON public.console_role_permission
  AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());

-- The client-side counterpart of the read policies above: rather than have
-- useAuthBootstrap.ts query console_role_permission directly (which, if that
-- table's SELECT were ever narrowed to console.console_users.manage, silently
-- returns zero rows for the very admin asking "what am I allowed to do"),
-- resolve the caller's own granted+active permissions server-side. Mirrors
-- user_has_console_perm()'s own join logic exactly.
CREATE OR REPLACE FUNCTION public.current_console_permissions()
 RETURNS text[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(crp.permission_key), ARRAY[]::text[])
  FROM public.app_user au
  JOIN public.console_role cr ON cr.console_role_id = au.console_role_id AND cr.is_active
  JOIN public.console_role_permission crp
    ON crp.console_role_id = au.console_role_id AND crp.is_granted
  WHERE au.user_id = auth.uid() AND au.role = 'super_admin' AND au.status = 'active'
$function$;

REVOKE EXECUTE ON FUNCTION public.current_console_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_console_permissions() TO authenticated, service_role;

-- app_user_super_admin_write already lets any super_admin write any column
-- on any app_user row, including console_role_id -- RLS is row-level and
-- can't single out one column. A trigger is the only way to require
-- console.console_users.manage specifically for *this* column, without
-- weakening every other super_admin write app_user_super_admin_write already
-- covers (role, woreda_id, status, full_name, ...). Covers INSERT as well as
-- UPDATE: an UPDATE-only guard leaves inviting a brand new, already-
-- unrestricted super_admin (via invite-platform-admin, itself hardened to
-- require this same permission for that specific case) as an uncovered way
-- to route around this table's own protection entirely -- a scoped admin who
-- can't touch an existing row's console_role_id could otherwise still mint a
-- second, unrestricted account for themselves through a different door.
CREATE OR REPLACE FUNCTION public.guard_console_role_assignment()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
BEGIN
  -- No authenticated actor (service_role, a migration, the Management API
  -- SQL console) is exempt: those paths bypass RLS by design and are the
  -- only break-glass route back in if the console ever ends up with no
  -- active admin holding console.console_users.manage. anon cannot reach
  -- app_user under RLS at all, so this does not open a client-facing hole.
  -- This is also what exempts the invite Edge Functions' own INSERTs (they
  -- run as service_role, so auth.uid() is NULL there) -- their own
  -- authorization already happens inside the function itself.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.console_role_id IS NOT DISTINCT FROM OLD.console_role_id THEN
    RETURN NEW;
  END IF;

  -- app_user_console_role_scope_check forces console_role_id to NULL
  -- whenever role <> 'super_admin' -- that clear is a mechanical side
  -- effect of a role change (see PlatformUsersTab.tsx's saveRoleChange,
  -- which sets it explicitly for exactly this reason), not a deliberate
  -- console-role decision, so it's exempt regardless of who's making it.
  -- Deliberately narrow: this does NOT exempt clearing console_role_id back
  -- to NULL while role stays 'super_admin' (i.e. "un-scope this admin, make
  -- them unrestricted again") -- that is still a real console-role decision
  -- and falls through to the self/permission checks below like any other
  -- change to this column.
  IF NEW.console_role_id IS NULL AND NEW.role <> 'super_admin' THEN
    RETURN NEW;
  END IF;

  -- Assigning yourself a console role -- including clearing your own back to
  -- unrestricted -- is never allowed regardless of permission. Without this,
  -- a scoped admin holding console.console_users.manage could self-unrestrict,
  -- and the UI's isSelf guard on the same action is advisory only.
  IF NEW.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own console_role_id';
  END IF;
  IF NOT public.user_has_console_perm('console.console_users.manage') THEN
    RAISE EXCEPTION 'Only an admin with console.console_users.manage may change console_role_id';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_console_role_assignment ON public.app_user;
CREATE TRIGGER trg_guard_console_role_assignment
  BEFORE INSERT OR UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.guard_console_role_assignment();

-- Same idea, different feature: PlatformUsersTab.tsx's UI already refuses to
-- suspend or demote the only active super_admin, computed client-side from
-- the currently-loaded row list. That is advisory only -- nothing stopped a
-- raw PATCH from doing it anyway, which is exactly the kind of lockout
-- recoverable only with the service_role key. This is the DB-level backstop
-- for that same rule.
--
-- SECURITY INVOKER, deliberately: its count(*) below reads app_user under
-- the CALLER's own RLS, which today is correct only because
-- app_user_self_read grants every super_admin the full table. If that
-- policy is ever narrowed (e.g. scoped by console permission), this count
-- would silently under-count and could false-positive-block a legitimate
-- demotion -- rescope this function to SECURITY DEFINER if that ever
-- happens.
--
-- Uses an advisory transaction lock to close a real TOCTOU race: two
-- concurrent transactions, each demoting a *different* one of exactly two
-- remaining active super_admins, would otherwise both read "1 other active
-- super_admin remains" before either commits, and both succeed -- leaving
-- zero. The lock serializes any two such checks so the second transaction
-- sees the first's completed demotion.
CREATE OR REPLACE FUNCTION public.prevent_last_super_admin_lockout()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
DECLARE
  remaining_active_super_admins integer;
BEGIN
  IF OLD.role = 'super_admin' AND OLD.status = 'active'
     AND (NEW.role IS DISTINCT FROM 'super_admin' OR NEW.status IS DISTINCT FROM 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtext('app_user:last_active_super_admin'));
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

DROP TRIGGER IF EXISTS trg_prevent_last_super_admin_lockout ON public.app_user;
CREATE TRIGGER trg_prevent_last_super_admin_lockout
  BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_super_admin_lockout();
