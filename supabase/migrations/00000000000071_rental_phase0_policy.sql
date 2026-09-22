-- Kebele Rental Houses Management -- Phase 0 (policy sign-off).
--
-- Grounded in Kebele_Rental_Houses_Management_Implementation_Plan.md, Part A
-- section 9 (rental_policy) and section 39 (PD-01..PD-11 open decisions
-- register). Owner sign-off recorded in
-- docs/rental-policy-decisions.md -- read that file for the "why" behind
-- each default below; this migration only encodes the decisions already
-- made there.
--
-- Three things land together because rental_policy's own write policy
-- depends on the new permission existing first:
--
-- 1. A new permission, rental.policy.configure, added to tenant_admin's
--    default grant set (plan section 32: "tenant_admin policy configure"),
--    added to permissions.ts in the same commit (bun run
--    check:role-perms-drift enforces the two stay in sync), and added to
--    the same reserved-key exclusion lists credential.configure_policy
--    already sits in (00000000000021/00000000000036/00000000000037/
--    00000000000038) -- it is an administrative power a tenant_admin must
--    not be able to hand to a different role or user via the matrix, an
--    override, or a custom tenant_role.
-- 2. rental_policy itself: one row per woreda, RLS-gated, readable by any
--    same-woreda authenticated user (clerks need to read due-date/reminder
--    cadence to explain a charge to a resident) and writable only under
--    rental.policy.configure.
-- 3. A seed-on-woreda-insert trigger (mirroring
--    00000000000015_permission_matrix_backfill.sql's
--    seed_role_permission_for_new_woreda pattern) plus a one-time backfill
--    for the woredas that already exist, so Phase 0's "Done" criterion
--    ("policy rows live and audited") holds for every current tenant, not
--    only future ones.
--
-- The 12-month rental year (Meskerem-Nehase; Pagume never billed) is NOT a
-- column here -- plan section 9 is explicit that it is a structural rule,
-- not a per-tenant configurable, and it lands in Phase 2 as a CHECK
-- constraint on rent_charge.ethiopian_month. PD-07 (self-verification) and
-- PD-09 (the verified->returned edge) are workflow-engine decisions, not
-- rental_policy columns -- plan section 9's field table does not list them,
-- and they land in Phase 1 as a trigger guard and a workflow_transition seed
-- row respectively.
--
-- ADDITIVE. No DROP of any table, column, or constraint.

BEGIN;

-- 1a. default_role_perms(): tenant_admin gains rental.policy.configure.
-- Full function body restated (Postgres CREATE OR REPLACE semantics; the
-- drift check in scripts/check-role-perms-drift.ts concatenates every
-- migration in order and takes the last definition) -- every other role's
-- array is unchanged from 00000000000063_task14b_service_verify_complete_perms.sql.
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete','rental.policy.configure']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;$function$;

-- 1b. No role_permission backfill needed: role_permission_role_name_check
-- (00000000000035) only allows the 6 non-admin roles as rows in that table
-- at all -- tenant_admin (like super_admin) has no per-tenant override row
-- and resolves solely through the compiled default_role_perms() above, so
-- adding rental.policy.configure to tenant_admin's default is immediately
-- effective for every existing and future woreda with nothing to seed.

-- 1c. Widen the reserved-key exclusion lists (role_permission's write
-- policies, user_permission_override's CHECK, tenant_role_permission's
-- CHECK) to also exclude rental.policy.configure, exactly as
-- credential.configure_policy is excluded -- a tenant_admin must not be
-- able to reassign rental policy authority to a different role, a
-- per-user override, or a custom tenant_role.
DROP POLICY role_permission_insert_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure'
    ])
  );

DROP POLICY role_permission_update_tenant_admin ON public.role_permission;
CREATE POLICY role_permission_update_tenant_admin ON public.role_permission
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure'
    ])
  )
  WITH CHECK (
    (is_super_admin() OR (is_tenant_admin() AND woreda_id = get_user_woreda_id()))
    AND permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure'
    ])
  );

ALTER TABLE public.user_permission_override
  DROP CONSTRAINT user_permission_override_no_locked_keys;
ALTER TABLE public.user_permission_override
  ADD CONSTRAINT user_permission_override_no_locked_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure'
    ]));

ALTER TABLE public.tenant_role_permission
  DROP CONSTRAINT tenant_role_permission_no_reserved_keys;
ALTER TABLE public.tenant_role_permission
  ADD CONSTRAINT tenant_role_permission_no_reserved_keys
    CHECK (permission_key <> ALL (ARRAY[
      'credential.approve', 'civil.approve', 'tenant.manage', 'platform.manage',
      'tenant.create', 'credential.configure_policy', 'user.manage', 'credential.revoke',
      'rental.policy.configure'
    ]));

-- 2. rental_policy: one row per woreda. Every field maps to a PD-## decision
-- recorded in docs/rental-policy-decisions.md; defaults below are the
-- signed-off values, not placeholders.
CREATE TABLE IF NOT EXISTS public.rental_policy (
  rental_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL UNIQUE REFERENCES public.woreda(woreda_id),

  -- PD-01: due-date rule. due_day is the fixed Ethiopian-calendar day of the
  -- charge's period the due date falls on ("early in the period").
  due_rule text NOT NULL DEFAULT 'fixed_day_after_period_start'
    CHECK (due_rule = 'fixed_day_after_period_start'),
  due_day integer NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 30),

  -- Reminder cadence (PD-06 sets the channel set; cadence defaults are the
  -- plan's own §9 field, not separately decided in §39).
  reminder_days_before_due integer NOT NULL DEFAULT 5 CHECK (reminder_days_before_due >= 0),
  reminder_days_after_overdue integer NOT NULL DEFAULT 3 CHECK (reminder_days_after_overdue >= 0),
  escalation_after_overdue_months integer NOT NULL DEFAULT 3 CHECK (escalation_after_overdue_months >= 1),
  -- PD-06: ERP + print first; sms stays a legal value so a future gateway
  -- procurement is additive data, not a migration -- but is never selected
  -- by default until one exists.
  reminder_channels text[] NOT NULL DEFAULT ARRAY['erp', 'print']::text[]
    CHECK (reminder_channels <@ ARRAY['erp', 'sms', 'print']::text[]),

  -- Repayment-plan guardrail.
  plan_max_installments integer NOT NULL DEFAULT 12 CHECK (plan_max_installments BETWEEN 1 AND 36),

  -- PD-03/PD-04: checkpoint behaviour. Visible, non-blocking by default;
  -- an active repayment plan reduces severity rather than hiding arrears.
  block_on_rental_arrears boolean NOT NULL DEFAULT false,
  plan_compliance_effect text NOT NULL DEFAULT 'reduce_severity'
    CHECK (plan_compliance_effect IN ('reduce_severity', 'no_effect')),
  emergency_exemption boolean NOT NULL DEFAULT true,

  -- PD-02: termination during Pagume ends billing at the preceding Nehase;
  -- this is the general "which month is the last billable one" rule for
  -- every other termination timing (through the termination month itself).
  termination_final_period_rule text NOT NULL DEFAULT 'through_termination_month'
    CHECK (termination_final_period_rule = 'through_termination_month'),

  rate_change_requires_approval boolean NOT NULL DEFAULT true,

  -- PD-05: waiver/adjustment authority (Phase 6 capability; recorded now so
  -- the governance decision isn't re-litigated when the feature lands).
  waiver_requires_role text NOT NULL DEFAULT 'supervisor'
    CHECK (waiver_requires_role IN ('supervisor', 'tenant_admin')),
  waiver_max_amount numeric(14, 2) CHECK (waiver_max_amount IS NULL OR waiver_max_amount >= 0),

  -- PD-08: rental_rent is canonical; house_rent stays a legal historical
  -- value but is never written going forward (application-level, not a
  -- column here -- recorded for cross-reference with the plan's PD-08 row).

  -- PD-10: manual-first billing/reminder invocation.
  billing_invocation_mode text NOT NULL DEFAULT 'manual'
    CHECK (billing_invocation_mode IN ('manual', 'scheduled')),

  updated_by uuid REFERENCES public.app_user(user_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rental_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY rental_policy_select ON public.rental_policy
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id());

CREATE POLICY rental_policy_insert ON public.rental_policy
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.policy.configure}'::text[]))
  );

CREATE POLICY rental_policy_update ON public.rental_policy
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.policy.configure}'::text[]))
  )
  WITH CHECK (
    is_super_admin()
    OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.policy.configure}'::text[]))
  );

-- No DELETE policy: one row per woreda is a structural invariant, not a
-- user-facing lifecycle -- there is no legitimate "unconfigure" action.

DROP TRIGGER IF EXISTS rental_policy_set_updated_at ON public.rental_policy;
CREATE TRIGGER rental_policy_set_updated_at
  BEFORE UPDATE ON public.rental_policy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Seed a default-valued row for every woreda created from here on
-- (mirrors seed_role_permission_for_new_woreda's shape in
-- 00000000000015_permission_matrix_backfill.sql), plus a one-time backfill
-- for the woredas that already exist.
CREATE OR REPLACE FUNCTION public.seed_rental_policy_for_new_woreda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.rental_policy (woreda_id)
  VALUES (NEW.woreda_id)
  ON CONFLICT (woreda_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_rental_policy_after_woreda_insert ON public.woreda;
CREATE TRIGGER seed_rental_policy_after_woreda_insert
  AFTER INSERT ON public.woreda
  FOR EACH ROW EXECUTE FUNCTION public.seed_rental_policy_for_new_woreda();

INSERT INTO public.rental_policy (woreda_id)
SELECT w.woreda_id FROM public.woreda w
ON CONFLICT (woreda_id) DO NOTHING;

COMMIT;
