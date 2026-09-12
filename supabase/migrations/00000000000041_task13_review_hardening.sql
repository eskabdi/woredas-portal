-- Task 13 (fix-task-production-readiness-v3, D4): hardening found by
-- rbac-escalation-review and tenant-isolation-review on
-- 00000000000038/00000000000039. Five independent fixes:
--
-- 1. (High) Every audit_log INSERT added in 00000000000040 omitted
--    actor_user_id, on the mistaken assumption that audit_log's own
--    trg_force_actor (force_actor_columns('actor_user_id')) would fill it.
--    force_actor_columns() only OVERWRITES an already-non-NULL value; it
--    never populates a NULL one (baseline.sql, force_actor_columns() body).
--    Every ROLE_CREATED/ROLE_UPDATED/ROLE_DEACTIVATED/
--    ROLE_PERMISSION_GRANTED/DENIED/USER_ROLE_ASSIGNED/CHANGED row was
--    landing with no actor -- a real regression for USER_ROLE_CHANGED, which
--    UsersRolesTab.tsx's own client-side insert used to set correctly before
--    this task removed it in favor of the trigger. Fixed by passing
--    auth.uid() explicitly, the same pattern 00000000000025's workflow
--    triggers already use for their own audit_log inserts.
-- 2. (Medium) tenant_role_permission never got force_actor_columns('updated_by')
--    or set_updated_at -- both role_permission and user_permission_override
--    (00000000000019) have the actor trigger on the equivalent column;
--    console_role_permission is the one other precedent that was missed the
--    same way and got its own fix in 00000000000011. updated_by was
--    client-supplied and unverified; added here.
-- 3. (Medium) Nothing stopped a tenant_role.name from shadowing a built-in
--    role name (e.g. a custom role literally named "tenant_admin"). Not a
--    privilege issue (resolution keys off app_user.role='custom' plus the
--    uuid, never the name) but the Settings users list renders the raw name,
--    so a shadowed name could mislead an admin reading the roster. A
--    trigger now rejects the 10 reserved names case-insensitively.
-- 4. (Medium) tenant_role_write and tenant_role_permission_write were both
--    `FOR ALL`, which silently included DELETE with no audit trail for
--    either the row disappearing or (via tenant_role's ON DELETE CASCADE)
--    every one of its grants disappearing with it. role_permission's own
--    precedent deliberately has zero DELETE policies at all (baseline.sql +
--    00000000000021/036/037 only ever add INSERT/UPDATE/SELECT) --
--    deactivate-in-place, never delete, is this codebase's established
--    convention for a role-like row. Matched here: DELETE is dropped from
--    both policies (split into explicit INSERT/UPDATE), so a client delete
--    attempt is now a plain RLS-denied 0-row no-op rather than a silent,
--    unaudited disappearance.
-- 5. (Low) A CHECK constraint is still validated under
--    session_replication_role = 'replica' (e.g. logical-replication apply,
--    pg_restore --disable-triggers), where the trigger that replaced
--    app_user_role_check in 00000000000039 would be skipped. Re-adds a
--    plain, purely-additive value-whitelist CHECK alongside the trigger --
--    it only re-checks the flat 10-value list (no cross-table lookup, so no
--    correctness loss versus a CHECK), leaving the trigger to own the
--    cross-table/same-tenant/is_active condition a CHECK still can't express.
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

-- 1. Actor on every role-management audit row.
CREATE OR REPLACE FUNCTION public.audit_tenant_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (actor_user_id, woreda_id, entity_name, entity_id, action_type, new_value_json)
    VALUES (auth.uid(), NEW.woreda_id, 'tenant_role', NEW.tenant_role_id::text, 'ROLE_CREATED',
            jsonb_build_object('name', NEW.name, 'description', NEW.description));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (actor_user_id, woreda_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
    VALUES (
      auth.uid(), NEW.woreda_id, 'tenant_role', NEW.tenant_role_id::text,
      CASE WHEN OLD.is_active = true AND NEW.is_active = false THEN 'ROLE_DEACTIVATED' ELSE 'ROLE_UPDATED' END,
      jsonb_build_object('name', OLD.name, 'description', OLD.description, 'is_active', OLD.is_active),
      jsonb_build_object('name', NEW.name, 'description', NEW.description, 'is_active', NEW.is_active)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_tenant_role_permission_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid;
BEGIN
  SELECT tr.woreda_id INTO v_woreda_id FROM public.tenant_role tr WHERE tr.tenant_role_id = NEW.tenant_role_id;
  INSERT INTO public.audit_log (actor_user_id, woreda_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (
    auth.uid(), v_woreda_id, 'tenant_role_permission', NEW.tenant_role_id::text,
    CASE WHEN NEW.is_granted THEN 'ROLE_PERMISSION_GRANTED' ELSE 'ROLE_PERMISSION_DENIED' END,
    jsonb_build_object('permission_key', NEW.permission_key, 'is_granted', NEW.is_granted)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_app_user_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (actor_user_id, woreda_id, entity_name, entity_id, action_type, new_value_json)
    VALUES (auth.uid(), NEW.woreda_id, 'app_user', NEW.user_id::text, 'USER_ROLE_ASSIGNED',
            jsonb_build_object('role', NEW.role, 'custom_role_id', NEW.custom_role_id));
  ELSIF TG_OP = 'UPDATE'
    AND (OLD.role IS DISTINCT FROM NEW.role OR OLD.custom_role_id IS DISTINCT FROM NEW.custom_role_id) THEN
    INSERT INTO public.audit_log (actor_user_id, woreda_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
    VALUES (
      auth.uid(), NEW.woreda_id, 'app_user', NEW.user_id::text, 'USER_ROLE_CHANGED',
      jsonb_build_object('role', OLD.role, 'custom_role_id', OLD.custom_role_id),
      jsonb_build_object('role', NEW.role, 'custom_role_id', NEW.custom_role_id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Actor + updated_at on tenant_role_permission.
CREATE TRIGGER tenant_role_permission_force_actor BEFORE INSERT OR UPDATE ON public.tenant_role_permission
  FOR EACH ROW EXECUTE FUNCTION force_actor_columns('updated_by');

CREATE OR REPLACE FUNCTION public.set_tenant_role_permission_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER set_tenant_role_permission_updated_at BEFORE UPDATE ON public.tenant_role_permission
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_role_permission_updated_at();

-- 3. Reject a custom role name that shadows a built-in role (or "custom"
-- itself), case-insensitively and trim-normalized.
CREATE OR REPLACE FUNCTION public.validate_tenant_role_name()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF lower(trim(NEW.name)) = ANY (ARRAY[
    'super_admin', 'tenant_admin', 'civil_registrar', 'registry_clerk',
    'finance_clerk', 'supervisor', 'auditor', 'viewer', 'print_officer', 'custom'
  ]) THEN
    RAISE EXCEPTION 'tenant_role name "%" is reserved for a built-in role', NEW.name;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenant_role_validate_name ON public.tenant_role;
CREATE TRIGGER tenant_role_validate_name BEFORE INSERT OR UPDATE OF name ON public.tenant_role
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_role_name();

-- 4. Drop DELETE from both write policies -- deactivate-in-place only,
-- matching role_permission's own convention of never allowing a client
-- DELETE on a role-shaped row.
DROP POLICY tenant_role_write ON public.tenant_role;
CREATE POLICY tenant_role_insert ON public.tenant_role
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()));
CREATE POLICY tenant_role_update ON public.tenant_role
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
  WITH CHECK (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()));

DROP POLICY tenant_role_permission_write ON public.tenant_role_permission;
CREATE POLICY tenant_role_permission_insert ON public.tenant_role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_role tr
    WHERE tr.tenant_role_id = tenant_role_permission.tenant_role_id
      AND (is_super_admin() OR (is_tenant_admin() AND tr.woreda_id = get_user_woreda_id()))
  ));
CREATE POLICY tenant_role_permission_update ON public.tenant_role_permission
  AS PERMISSIVE FOR UPDATE TO authenticated
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

-- 5. Belt-and-suspenders CHECK alongside the trigger, for the
-- session_replication_role = 'replica' case where row triggers don't fire.
ALTER TABLE public.app_user
  ADD CONSTRAINT app_user_role_check
    CHECK ((role = ANY (ARRAY[
      'super_admin'::text, 'tenant_admin'::text, 'civil_registrar'::text,
      'registry_clerk'::text, 'finance_clerk'::text, 'supervisor'::text,
      'auditor'::text, 'viewer'::text, 'print_officer'::text, 'custom'::text
    ])));

COMMIT;
