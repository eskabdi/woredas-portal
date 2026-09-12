-- Task 13 (fix-task-production-readiness-v3, D4): audit logging for every
-- role-management action -- ROLE_CREATED, ROLE_UPDATED, ROLE_DEACTIVATED,
-- ROLE_PERMISSION_GRANTED/DENIED, USER_ROLE_ASSIGNED/CHANGED. Follows the
-- existing audit_log insert shape used elsewhere in this codebase (e.g. the
-- CREDENTIAL_REVOKED insert in enforce_deceased_resident_credentials(),
-- baseline.sql) rather than introducing a new logging convention.
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_tenant_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, new_value_json)
    VALUES (NEW.woreda_id, 'tenant_role', NEW.tenant_role_id::text, 'ROLE_CREATED',
            jsonb_build_object('name', NEW.name, 'description', NEW.description));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
    VALUES (
      NEW.woreda_id, 'tenant_role', NEW.tenant_role_id::text,
      CASE WHEN OLD.is_active = true AND NEW.is_active = false THEN 'ROLE_DEACTIVATED' ELSE 'ROLE_UPDATED' END,
      jsonb_build_object('name', OLD.name, 'description', OLD.description, 'is_active', OLD.is_active),
      jsonb_build_object('name', NEW.name, 'description', NEW.description, 'is_active', NEW.is_active)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenant_role_audit_insert ON public.tenant_role;
CREATE TRIGGER tenant_role_audit_insert AFTER INSERT ON public.tenant_role
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_role_change();

DROP TRIGGER IF EXISTS tenant_role_audit_update ON public.tenant_role;
CREATE TRIGGER tenant_role_audit_update AFTER UPDATE OF name, description, is_active ON public.tenant_role
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_role_change();

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
  INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (
    v_woreda_id, 'tenant_role_permission', NEW.tenant_role_id::text,
    CASE WHEN NEW.is_granted THEN 'ROLE_PERMISSION_GRANTED' ELSE 'ROLE_PERMISSION_DENIED' END,
    jsonb_build_object('permission_key', NEW.permission_key, 'is_granted', NEW.is_granted)
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenant_role_permission_audit ON public.tenant_role_permission;
CREATE TRIGGER tenant_role_permission_audit
  AFTER INSERT OR UPDATE OF is_granted ON public.tenant_role_permission
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_role_permission_change();

CREATE OR REPLACE FUNCTION public.audit_app_user_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, new_value_json)
    VALUES (NEW.woreda_id, 'app_user', NEW.user_id::text, 'USER_ROLE_ASSIGNED',
            jsonb_build_object('role', NEW.role, 'custom_role_id', NEW.custom_role_id));
  ELSIF TG_OP = 'UPDATE'
    AND (OLD.role IS DISTINCT FROM NEW.role OR OLD.custom_role_id IS DISTINCT FROM NEW.custom_role_id) THEN
    INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
    VALUES (
      NEW.woreda_id, 'app_user', NEW.user_id::text, 'USER_ROLE_CHANGED',
      jsonb_build_object('role', OLD.role, 'custom_role_id', OLD.custom_role_id),
      jsonb_build_object('role', NEW.role, 'custom_role_id', NEW.custom_role_id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_user_role_audit ON public.app_user;
CREATE TRIGGER app_user_role_audit
  AFTER INSERT OR UPDATE OF role, custom_role_id ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.audit_app_user_role_change();

COMMIT;
