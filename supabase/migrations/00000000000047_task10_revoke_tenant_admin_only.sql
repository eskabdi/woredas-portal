-- Task 10 (fix-task-production-readiness-v3): "Revocation (tenant_admin
-- only, reason required)". The reason half is enforced in
-- 00000000000046 (revoked_reason NOT NULL/non-empty on the transition into
-- `revoked`). This migration closes the tenant_admin-only half: supervisor
-- previously held credential.revoke in the compiled default (migration 25
-- onward) and RESERVED_PERMISSION_KEYS (00000000000037) already stops a
-- tenant_admin from re-granting it to anyone via the matrix or an
-- override, but that lock only protects the matrix path -- it does nothing
-- about the compiled DEFAULT itself still including supervisor. src/config/
-- permissions.ts had P.CREDENTIAL_REVOKE removed from supervisor's array in
-- the same commit as this migration; this file is the SQL half of that
-- change (default_role_perms(), generated the same way every prior
-- reconciliation migration in this series was, directly from
-- ROLE_PERMISSIONS -- see the regenerate command in
-- 00000000000035_task4_permission_reconciliation.sql's own header) plus the
-- one-time fix-up every already-provisioned tenant's role_permission table
-- needs: default_role_perms() only governs what a MISSING cell resolves to,
-- so the 6 woredas that already had an explicit supervisor/credential.revoke
-- = true row (materialized by migration 15's seeding trigger, back when
-- that was the correct default) would otherwise keep granting it forever.
--
-- ADDITIVE in the schema sense (no DROP), but this IS a real narrowing of
-- who can revoke a credential in a live tenant -- confirmed via query before
-- writing this that exactly 6 woredas hold that row as `true` today, and
-- that flipping it does not touch tenant_admin's own resolution (which
-- never reads role_permission at all -- tenant_admin/super_admin are
-- excluded from role_permission_role_name_check and always resolve
-- straight from default_role_perms()).

BEGIN;

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.return','service.issue_letter']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.return','service.issue_letter']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;
$function$;

-- One-time fix-up for tenants provisioned before this change: flip the
-- already-materialized supervisor/credential.revoke cell to match the new
-- default, everywhere it was still true. supabase/seed.sql's own
-- supervisor/credential.revoke rows were changed to 'false' in the same
-- commit -- without that, a reseed would silently re-grant this cell right
-- back to `true` on every one of the 6 already-provisioned woredas, since
-- seed.sql's INSERT ... ON CONFLICT DO UPDATE always overwrites is_granted
-- unconditionally (rbac-escalation-review caught this: the compiled
-- default and seed.sql are two different sources and only the default was
-- fixed at first).
--
-- Writes its own audit_log row per affected woreda, matching the shape
-- RolesPermissionsTab.tsx's toggle() already uses for a matrix edit
-- (ROLE_PERMISSION_UPDATED, no actor -- this one is system-driven, not a
-- specific admin's click) so the change isn't invisible in /woreda/audit.
-- role_permission has no surrogate id (its key is the woreda_id/role_name/
-- permission_key triple), so entity_id carries the woreda_id -- the same
-- thing a row-level RLS check on this table already scopes by.
WITH revoked AS (
  UPDATE public.role_permission
     SET is_granted = false, updated_at = now()
   WHERE role_name = 'supervisor'
     AND permission_key = 'credential.revoke'
     AND is_granted = true
  RETURNING woreda_id, role_name, permission_key
)
INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, new_value_json)
SELECT woreda_id, 'role_permission', woreda_id::text, 'ROLE_PERMISSION_UPDATED',
       jsonb_build_object(
         'role_name', role_name,
         'permission_key', permission_key,
         'is_granted', false,
         'reason', 'Task 10: credential.revoke narrowed to tenant_admin only'
       )
  FROM revoked;

COMMIT;
