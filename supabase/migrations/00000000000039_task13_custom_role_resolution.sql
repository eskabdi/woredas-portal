-- Task 13 (fix-task-production-readiness-v3, D4/A5): custom-role-aware
-- permission resolution, and the CHECK-to-trigger replacement A5 calls for.
--
-- Two parts:
--
-- 1. app_user_role_check (baseline.sql) is a plain CHECK enumerating the 9
--    built-in role strings. A custom role needs "role = 'custom' AND
--    custom_role_id references an ACTIVE tenant_role in this same woreda" --
--    a cross-table, same-tenant, is_active condition a CHECK constraint
--    cannot express (and even if written as a CHECK calling a STABLE
--    function, Postgres would never re-validate existing rows when the
--    referenced tenant_role is later deactivated or moved). This is
--    guardrail 1's one sanctioned non-additive exception: DROP the CHECK
--    entirely, replace it with a BEFORE INSERT/UPDATE trigger that enforces
--    the exact same 9-value whitelist for built-in roles, plus the new
--    cross-table rule for 'custom'. Nothing legal before this migration
--    becomes illegal after it.
--
-- 2. user_has_perm() and current_permissions() (00000000000017) both
--    resolve permissions via user_permission_override -> role_permission ->
--    default_role_perms(role). A 'custom' role has no role_permission row
--    (role_permission_role_name_check still only allows the 7 built-in
--    editable roles -- unchanged) and default_role_perms('custom') would
--    fall through to its ELSE ARRAY[]::text[] branch. Both functions gain a
--    branch: for role = 'custom', resolve from tenant_role_permission via
--    au.custom_role_id instead, still scoped to an active role in the
--    user's own woreda, with the per-user override still winning over
--    everything -- same D1(a) precedence as every other role.
--
-- ADDITIVE except for item 1's constraint replacement (the sanctioned
-- exception, per guardrail 1).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A5: CHECK -> trigger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_app_user_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = ANY (ARRAY[
    'super_admin', 'tenant_admin', 'civil_registrar', 'registry_clerk',
    'finance_clerk', 'supervisor', 'auditor', 'viewer', 'print_officer'
  ]) THEN
    IF NEW.custom_role_id IS NOT NULL THEN
      RAISE EXCEPTION 'custom_role_id must be NULL for built-in role %', NEW.role;
    END IF;
  ELSIF NEW.role = 'custom' THEN
    IF NEW.custom_role_id IS NULL THEN
      RAISE EXCEPTION 'custom_role_id is required when role = ''custom''';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_role tr
      WHERE tr.tenant_role_id = NEW.custom_role_id
        AND tr.woreda_id = NEW.woreda_id
        AND tr.is_active = true
    ) THEN
      RAISE EXCEPTION 'custom_role_id % is not an active tenant_role for this woreda', NEW.custom_role_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid app_user role: %', NEW.role;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_user_validate_role ON public.app_user;
CREATE TRIGGER app_user_validate_role
  BEFORE INSERT OR UPDATE OF role, custom_role_id, woreda_id ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.validate_app_user_role();

ALTER TABLE public.app_user DROP CONSTRAINT app_user_role_check;

-- ---------------------------------------------------------------------------
-- 2. Custom-role-aware resolution.
-- ---------------------------------------------------------------------------

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
            CASE
              WHEN au.role = 'custom' THEN
                COALESCE(
                  (SELECT trp.is_granted FROM public.tenant_role_permission trp
                    JOIN public.tenant_role tr ON tr.tenant_role_id = trp.tenant_role_id
                    WHERE trp.tenant_role_id = au.custom_role_id
                      AND trp.permission_key = _perm
                      AND tr.is_active = true
                      AND tr.woreda_id = au.woreda_id),
                  false
                )
              ELSE
                COALESCE(
                  (SELECT rp.is_granted FROM public.role_permission rp
                    WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
                      AND rp.permission_key = _perm),
                  _perm = ANY (public.default_role_perms(au.role))
                )
            END
          )
  )
$function$;

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
    ) || CASE
      WHEN au.role = 'custom' THEN
        ARRAY(
          SELECT trp.permission_key FROM public.tenant_role_permission trp
          JOIN public.tenant_role tr ON tr.tenant_role_id = trp.tenant_role_id
          WHERE trp.tenant_role_id = au.custom_role_id
            AND tr.is_active = true
            AND tr.woreda_id = au.woreda_id
        )
      ELSE
        ARRAY(
          SELECT rp.permission_key FROM public.role_permission rp
          WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
        ) || public.default_role_perms(au.role)
    END
  ) AS key
  WHERE au.user_id = auth.uid()
    AND au.status = 'active'
    AND COALESCE(
          (SELECT upo.is_granted FROM public.user_permission_override upo
            WHERE upo.user_id = au.user_id AND upo.permission_key = key),
          CASE
            WHEN au.role = 'custom' THEN
              COALESCE(
                (SELECT trp.is_granted FROM public.tenant_role_permission trp
                  JOIN public.tenant_role tr ON tr.tenant_role_id = trp.tenant_role_id
                  WHERE trp.tenant_role_id = au.custom_role_id AND trp.permission_key = key
                    AND tr.is_active = true AND tr.woreda_id = au.woreda_id),
                false
              )
            ELSE
              COALESCE(
                (SELECT rp.is_granted FROM public.role_permission rp
                  WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
                    AND rp.permission_key = key),
                key = ANY (public.default_role_perms(au.role))
              )
          END
        )
$function$;

COMMIT;
