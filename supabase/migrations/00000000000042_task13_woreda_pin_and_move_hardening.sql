-- Task 13 (fix-task-production-readiness-v3, D4): two low-severity hardening
-- items from tenant-isolation-review on 00000000000038/00000000000039.
-- Neither is exploitable today (both require super_admin/service-role
-- access no client path reaches), but both close a gap the same way an
-- existing precedent in this codebase already closes it elsewhere.
--
-- 1. tenant_role.woreda_id was never pinned once set. No tenant_admin can
--    reach it (both tenant_role RLS policies pin woreda_id to the caller's
--    own in both USING and WITH CHECK), so this is a super_admin/service-role
--    only gap -- but if it ever moved, every app_user row referencing that
--    tenant_role via custom_role_id would silently point at a different
--    tenant's role object. user_has_perm()/current_permissions() already
--    re-check tr.woreda_id = au.woreda_id at resolution time (defense in
--    depth: those users would resolve to zero permissions, not the new
--    tenant's grants), but pinning the column outright is the same
--    "immutable once assigned" pattern this codebase already uses for
--    receipt.verification_token (00000000000013_receipt_verification.sql,
--    pin_receipt_verification_token()).
-- 2. No trigger cleared app_user.custom_role_id when app_user.woreda_id
--    changed -- the precedent is clear_overrides_on_woreda_change
--    (00000000000019_override_hardening.sql), which clears
--    user_permission_override rows on exactly this transition, for exactly
--    this reason (a person moving tenants should not carry a tenant-scoped
--    reference from their old tenant forward). Today
--    validate_app_user_role() (00000000000039) already makes a bare woreda
--    move on a role='custom' user fail outright (the trigger re-validates
--    custom_role_id against the NEW woreda_id and raises if it doesn't
--    match) -- safe, but a hard, undocumented error rather than the
--    graceful auto-clear the sibling column gets. This trigger fires first
--    (BEFORE UPDATE, alphabetically before app_user_validate_role) and
--    clears custom_role_id + demotes role to 'viewer' whenever woreda_id
--    changes on a custom-role user, exactly like the override cleanup
--    already does for its own column -- so a future admin tool that moves
--    a custom-role user between woredas succeeds instead of raising, and
--    the person lands on the same safe, permission-less default a cleared
--    override would leave them at.
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

-- 1. Pin tenant_role.woreda_id once set.
CREATE OR REPLACE FUNCTION public.pin_tenant_role_woreda_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.woreda_id IS DISTINCT FROM OLD.woreda_id THEN
    RAISE EXCEPTION 'tenant_role.woreda_id cannot be changed once assigned';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenant_role_pin_woreda_id ON public.tenant_role;
CREATE TRIGGER tenant_role_pin_woreda_id
  BEFORE UPDATE OF woreda_id ON public.tenant_role
  FOR EACH ROW EXECUTE FUNCTION public.pin_tenant_role_woreda_id();

-- 2. Clear custom_role_id (and demote off 'custom') when an app_user's own
-- woreda_id changes -- mirrors clear_overrides_on_woreda_change's rationale
-- for the sibling per-user column. Named to sort alphabetically before
-- app_user_validate_role so it runs first and the validation trigger then
-- sees a consistent (role, custom_role_id, woreda_id) triple.
CREATE OR REPLACE FUNCTION public.clear_custom_role_on_woreda_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = 'custom' THEN
    NEW.role := 'viewer';
    NEW.custom_role_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_user_clear_custom_role_on_woreda_change ON public.app_user;
CREATE TRIGGER app_user_clear_custom_role_on_woreda_change
  BEFORE UPDATE OF woreda_id ON public.app_user
  FOR EACH ROW
  WHEN (OLD.woreda_id IS DISTINCT FROM NEW.woreda_id)
  EXECUTE FUNCTION public.clear_custom_role_on_woreda_change();

COMMIT;
