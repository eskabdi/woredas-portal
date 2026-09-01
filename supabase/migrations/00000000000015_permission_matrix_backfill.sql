-- F4 (docs/rbac-security-forensic-review.md): role_permission's seed data is
-- a one-time snapshot dated 2026-07-11 that predates five permission-key
-- groups added since (service.*, rental.*, revenue.*, complaint.manage,
-- approval.queue.view). Any tenant is missing every row for those keys, and
-- any tenant provisioned after the snapshot has zero role_permission rows at
-- all -- the Settings screen renders those keys, or the whole matrix, as
-- simply absent rather than shown-and-editable.
--
-- Backfilling does not change what the database actually allows: user_has_perm()
-- already COALESCEs a missing row to default_role_perms(role), so every
-- affected tenant has been running the shipped defaults all along. This only
-- restores the ability to customize away from those defaults.

-- Backfill: derive the full permission-key catalog from default_role_perms()
-- itself -- across every role, not just the six editable ones, since
-- tenant_admin's and super_admin's arrays are what actually enumerate every
-- key that exists -- and insert whatever a given (woreda, editable role) pair
-- is still missing. ON CONFLICT DO NOTHING leaves every existing row
-- untouched, including any that predate this migration and might otherwise
-- disagree with the role's current default.
INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, p.permission_key,
       p.permission_key = ANY (public.default_role_perms(r.role_name))
FROM public.woreda w
CROSS JOIN (VALUES
  ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
  ('supervisor'), ('auditor'), ('viewer')
) AS r(role_name)
CROSS JOIN (
  SELECT DISTINCT unnest(public.default_role_perms(all_roles.role_name)) AS permission_key
  FROM (VALUES
    ('super_admin'), ('tenant_admin'), ('registry_clerk'), ('civil_registrar'),
    ('finance_clerk'), ('supervisor'), ('auditor'), ('viewer')
  ) AS all_roles(role_name)
) p
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

-- New-tenant seeding: a trigger on woreda insert, not an explicit insert
-- added to today's provisioning wizard. Per the report's §3.1
-- recommendation this is the durable option -- it cannot be forgotten by a
-- future second provisioning entry point the way an application-layer
-- insert could be. Recorded in docs/rbac-remediation-tracker.md as the
-- choice made and why.
CREATE OR REPLACE FUNCTION public.seed_role_permission_for_new_woreda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
  SELECT NEW.woreda_id, r.role_name, p.permission_key,
         p.permission_key = ANY (public.default_role_perms(r.role_name))
  FROM (VALUES
    ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
    ('supervisor'), ('auditor'), ('viewer')
  ) AS r(role_name)
  CROSS JOIN (
    SELECT DISTINCT unnest(public.default_role_perms(all_roles.role_name)) AS permission_key
    FROM (VALUES
      ('super_admin'), ('tenant_admin'), ('registry_clerk'), ('civil_registrar'),
      ('finance_clerk'), ('supervisor'), ('auditor'), ('viewer')
    ) AS all_roles(role_name)
  ) p
  ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_role_permission_after_woreda_insert ON public.woreda;
CREATE TRIGGER seed_role_permission_after_woreda_insert
  AFTER INSERT ON public.woreda
  FOR EACH ROW EXECUTE FUNCTION public.seed_role_permission_for_new_woreda();
