-- ============================================================================
-- Task 4 (fix-task-production-readiness-v3): permission model reconciliation.
--
-- Reconciles the default_role_perms()/permissions.ts pair: permissions.ts
-- (ROLE_PERMISSIONS) is the source of truth, default_role_perms() had
-- drifted from it (missing the granular workflow verbs materialized here,
-- and never had a print_officer branch at all since that role didn't exist
-- in the DB yet). This migration makes default_role_perms() match
-- permissions.ts exactly -- the WHEN body below was generated directly from
-- ROLE_PERMISSIONS, not hand-transcribed, specifically to avoid the KD-5
-- failure mode (a permission added to one source but not the others) this
-- whole task exists to close.
--
-- Does NOT close F-05 outright: F-05 is a seed.sql bug (docs/system-review-
-- 2026-09.md), and supabase/seed.sql's explicit `credential.verify = false`
-- rows for auditor/finance_clerk/viewer are untouched here and still win
-- over the default via their own ON CONFLICT DO UPDATE. Left for a follow-up
-- that also extends check:role-perms-drift to compare seed.sql, per F-05's
-- own prescribed remedy.
--
-- Three changes:
--   1. print_officer (A2) added as a built-in role: both role CHECK
--      constraints widened to a superset (additive -- every previously legal
--      value stays legal), default_role_perms() gets a print_officer branch.
--   2. default_role_perms() rewritten for every role to include the granular
--      workflow permission constants Task 1/4/14 materialize in
--      permissions.ts (credential.create_request, .authorize_reprint,
--      .configure_policy, .view; civil.create_event/.submit/.resubmit/
--      .verify/.return/.reject/.record_payment/.view; service.submit/
--      .resubmit/.return/.reject/.record_payment/.issue_letter/.complete).
--      Coarse permissions (credential.issue, civil.register, service.create,
--      etc.) are unchanged and keep gating everything until Tasks 10/14 wire
--      the granular enforcement -- this migration only makes the constants
--      resolvable, it does not change what currently gates any route.
--   3. seed_role_permission_for_new_woreda() (00000000000015) gains
--      print_officer in its role list, and the full permission-key catalog
--      subquery both there and in this migration's one-time backfill gains
--      print_officer's own keys -- otherwise the Settings matrix would never
--      show print_officer-only permissions as columns for the OTHER
--      editable roles. A one-time backfill inserts print_officer's
--      role_permission rows for the 6 woredas that already exist (the
--      trigger only fires on future woreda INSERTs).
--
-- ADDITIVE. No DROP of any table or column. Both role CHECK constraints are
-- superset extensions (DROP + ADD CONSTRAINT with the same values plus one
-- more, not a narrowing) -- Task 13 replaces them with validation triggers
-- next; widening them here first keeps this migration's own diff reviewable
-- against F-05 alone.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. print_officer as a built-in role.
-- ---------------------------------------------------------------------------

ALTER TABLE public.app_user DROP CONSTRAINT IF EXISTS app_user_role_check;
ALTER TABLE public.app_user ADD CONSTRAINT app_user_role_check
  CHECK ((role = ANY (ARRAY[
    'super_admin'::text, 'tenant_admin'::text, 'civil_registrar'::text,
    'registry_clerk'::text, 'finance_clerk'::text, 'supervisor'::text,
    'auditor'::text, 'viewer'::text, 'print_officer'::text
  ])));

ALTER TABLE public.role_permission DROP CONSTRAINT IF EXISTS role_permission_role_name_check;
ALTER TABLE public.role_permission ADD CONSTRAINT role_permission_role_name_check
  CHECK ((role_name = ANY (ARRAY[
    'registry_clerk'::text, 'civil_registrar'::text, 'finance_clerk'::text,
    'supervisor'::text, 'auditor'::text, 'viewer'::text, 'print_officer'::text
  ])));

-- ---------------------------------------------------------------------------
-- 2. default_role_perms() -- generated from permissions.ts's ROLE_PERMISSIONS,
-- not hand-written. Regenerate with:
--   bun -e "import{ROLE_PERMISSIONS}from './src/config/permissions';for(const r of Object.keys(ROLE_PERMISSIONS))console.log(r,ROLE_PERMISSIONS[r])"
-- and diff against this WHEN body before ever changing either side alone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.revoke','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.return','service.issue_letter']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.return','service.issue_letter']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    ELSE ARRAY[]::text[]
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. print_officer in the per-woreda seeding: the future-tenant trigger, and
-- a one-time backfill for the 6 woredas that already exist.
-- ---------------------------------------------------------------------------

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
    ('supervisor'), ('auditor'), ('viewer'), ('print_officer')
  ) AS r(role_name)
  CROSS JOIN (
    SELECT DISTINCT unnest(public.default_role_perms(all_roles.role_name)) AS permission_key
    FROM (VALUES
      ('super_admin'), ('tenant_admin'), ('registry_clerk'), ('civil_registrar'),
      ('finance_clerk'), ('supervisor'), ('auditor'), ('viewer'), ('print_officer')
    ) AS all_roles(role_name)
  ) p
  ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- One-time backfill, same shape as 00000000000015's own: for EVERY editable
-- role (the 6 that predate this migration, plus print_officer) and every key
-- in the full catalog (every key any role's default_role_perms() returns,
-- including the granular ones this migration just added), insert whatever a
-- given (woreda, role, key) triple is still missing. ON CONFLICT DO NOTHING
-- leaves every existing row untouched -- a tenant that already customized a
-- key away from its default keeps that customization; this only makes the
-- NEW keys (credential.create_request/.authorize_reprint/.configure_policy/
-- .view, civil.create_event/.submit/.resubmit/.verify/.return/.reject/
-- .record_payment/.view, service.submit/.resubmit/.return/.reject/
-- .record_payment/.issue_letter/.complete) visible and editable in the
-- Settings matrix for tenants provisioned before this migration, exactly
-- the way 00000000000015 did for its own five-key-group gap.
INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, p.permission_key,
       p.permission_key = ANY (public.default_role_perms(r.role_name))
FROM public.woreda w
CROSS JOIN (VALUES
  ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
  ('supervisor'), ('auditor'), ('viewer'), ('print_officer')
) AS r(role_name)
CROSS JOIN (
  SELECT DISTINCT unnest(public.default_role_perms(all_roles.role_name)) AS permission_key
  FROM (VALUES
    ('super_admin'), ('tenant_admin'), ('registry_clerk'), ('civil_registrar'),
    ('finance_clerk'), ('supervisor'), ('auditor'), ('viewer'), ('print_officer')
  ) AS all_roles(role_name)
) p
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

COMMIT;
