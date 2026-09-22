-- Kebele Rental Houses Management -- Phase 4 (arrears and repayment plans).
--
-- Grounded in Kebele_Rental_Houses_Management_Implementation_Plan.md Part B
-- section 16 (arrears_repayment_plan / arrears_repayment_installment /
-- arrears_installment_charge), Part C section 22 (arrears/overdue
-- calculation), section 23 (repayment-plan settlement rules), section 24
-- (current rent vs. plan separation), and section 25 (reminder engine).
-- Phases 2-3 (rent_account/rent_rate_history/rent_charge/generate_rent_charges,
-- rental_payment/rent_payment_settlement/payment_reconciliation_exception/
-- settle_rent_payment/reverse_rental_payment, migrations 76-79) are already
-- live.
--
-- ---------------------------------------------------------------------------
-- Design notes worth reading before the SQL:
--
-- 1. "Arrears is calculated, never stored truth" (BR-12) governs this whole
--    migration. rent_charge.status stays the only stored fact; nothing here
--    adds an editable arrears_amount column anywhere.
--
-- 2. No cron exists in this repo (AF-12/PD-10: manual-first, idempotent
--    RPCs). Phase 2's generate_rent_charges() never advances a charge past
--    'due' -- nothing in this codebase has ever transitioned 'due' to
--    'overdue' on its own. refresh_rent_ledger_statuses() below is that
--    missing idempotent, manually-invoked ager, in the same spirit as
--    generate_rent_charges(): it only ever moves state forward
--    (due->overdue, installment due->overdue), never backward, and a
--    second call in the same minute changes nothing.
--
-- 3. arrears_repayment_plan is put on the shared workflow engine
--    (workflow_transition / enforce_workflow_transition(), migration 25) as
--    the plan directs ("runs on the shared workflow engine"), but WITHOUT a
--    verified_by_user_id column. enforce_workflow_transition()'s maker!=
--    checker block only activates when both approved_by_user_id AND
--    verified_by_user_id exist as columns on the row -- with no verify
--    stage in this plan's approval flow (just "prepare vs approve"), adding
--    a verified_by_user_id column that never gets populated would make that
--    block permanently reject every approval (verifier always NULL). A
--    dedicated guard_arrears_plan_maker_checker() trigger below enforces
--    requested_by_user_id <> approved_by_user_id directly instead, the same
--    two-column comparison the shared engine would do, without the third
--    column the engine's generic version assumes.
--
-- 4. 'draft', 'approved' and 'under_review' are CHECK-legal but unreachable
--    in this phase -- documented as reserved, the same AF-18 pattern this
--    plan's own Phase 1 (rental_occupancy_request) already uses for exactly
--    this reason. create_arrears_repayment_plan() inserts directly at
--    'submitted' (mirroring how the intake form for rental_occupancy_request
--    never starts at 'draft' either), and 'submitted' transitions straight
--    to 'active' on approval: "approval activates the schedule," not a
--    separate resting state, so a real 'approved' step would be a distinction
--    without a use today. Widening the CHECK later to make it reachable is
--    additive and cheap; removing it now would not be.
--
-- 5. Every EC period/due-date value a caller passes in is still validated,
--    never derived, by this migration's own SQL -- same "zero new calendar
--    logic" discipline migration 76's header explains at length. Installment
--    due dates come from the client (which already holds the shared
--    ethiopianCalendar.ts utility); the RPCs below only check format/range
--    and business ordering (each due date on/after the previous one).
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. Permissions: rental.plan.create (ordinary), rental.plan.approve
--    (ordinary), rental.plan.manage (ordinary -- defaulting/cancelling an
--    active plan is a supervisory action but not money-moving on its own,
--    so it is not reserved the way rental.reverse is).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete','rental.policy.configure','rental.billing','rental.collect','rental.settle','rental.reverse','rental.plan.create','rental.plan.approve','rental.plan.manage']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject','rental.plan.approve','rental.plan.manage']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','rental.collect','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment','rental.view','rental.collect','rental.settle','rental.plan.create']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;$function$;

-- Backfill in this same migration (Phase 2's own review found rental.billing
-- shipped without this and was ungrantable via the matrix until a follow-up
-- migration; Phase 3 landed it correctly the first time -- same discipline
-- here).
INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, p.permission_key, p.permission_key = ANY (public.default_role_perms(r.role_name))
  FROM public.woreda w
 CROSS JOIN (VALUES
    ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
    ('supervisor'), ('auditor'), ('viewer')
  ) AS r(role_name)
 CROSS JOIN (VALUES ('rental.plan.create'), ('rental.plan.approve'), ('rental.plan.manage')) AS p(permission_key)
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

-- ============================================================================
-- 2. Register arrears_repayment_plan on the shared workflow engine (additive
--    superset -- every value legal today stays legal).
-- ============================================================================

ALTER TABLE public.workflow_transition
  DROP CONSTRAINT workflow_transition_entity_check;
ALTER TABLE public.workflow_transition
  ADD CONSTRAINT workflow_transition_entity_check CHECK (entity = ANY (ARRAY[
    'credential_request', 'residence_credential',
    'vital_event', 'service_request', 'rental_occupancy_request',
    'arrears_repayment_plan'
  ]));

-- ============================================================================
-- 3. refresh_rent_ledger_statuses() -- the missing overdue ager (design
--    note 2 above). Manual-first, idempotent, woreda-scoped: advances
--    rent_charge 'due'->'overdue' and arrears_repayment_installment
--    'due'->'overdue' wherever due_date has passed without full settlement.
--    Never touches a charge or installment that is already paid/waived/
--    cancelled -- BR-13 (historical immutability) applies to status here
--    exactly as it does to amount.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_rent_ledger_statuses()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_charges_aged int;
  v_installments_aged int;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'refresh_rent_ledger_statuses: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.view'])) THEN
    RAISE EXCEPTION 'refresh_rent_ledger_statuses: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH aged AS (
    UPDATE public.rent_charge
       SET status = 'overdue'
     WHERE woreda_id = v_woreda_id
       AND status = 'due'
       AND due_date < current_date
    RETURNING rent_charge_id
  )
  SELECT count(*) INTO v_charges_aged FROM aged;

  WITH aged AS (
    UPDATE public.arrears_repayment_installment
       SET status = 'overdue'
     WHERE woreda_id = v_woreda_id
       AND status = 'due'
       AND due_date < current_date
    RETURNING installment_id
  )
  SELECT count(*) INTO v_installments_aged FROM aged;

  RETURN jsonb_build_object('charges_aged', v_charges_aged, 'installments_aged', v_installments_aged);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_rent_ledger_statuses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_rent_ledger_statuses() TO authenticated, service_role;

-- ============================================================================
-- 4. arrears_repayment_plan.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.arrears_plan_sequence (
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  seq_year smallint NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (woreda_id, seq_year)
);

ALTER TABLE public.arrears_plan_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY arrears_plan_sequence_tenant ON public.arrears_plan_sequence
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id())
  WITH CHECK (is_super_admin() OR woreda_id = get_user_woreda_id());

CREATE TABLE IF NOT EXISTS public.arrears_repayment_plan (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rent_account_id uuid NOT NULL REFERENCES public.rent_account(rent_account_id),
  resident_id uuid NOT NULL REFERENCES public.resident(resident_id),
  plan_number text NOT NULL,
  original_arrears_amount numeric(14, 2) NOT NULL CHECK (original_arrears_amount > 0),
  original_arrears_amount_enc bytea,
  assigned_arrears_amount numeric(14, 2) NOT NULL CHECK (assigned_arrears_amount > 0),
  assigned_arrears_amount_enc bytea,
  installment_count integer NOT NULL CHECK (installment_count >= 1),
  -- Design note 4: 'draft', 'approved', 'under_review' are reserved/unreachable.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'returned', 'approved', 'active', 'completed', 'defaulted', 'cancelled')),
  reason text,
  return_reason text,
  requested_by_user_id uuid REFERENCES public.app_user(user_id),
  approved_by_user_id uuid REFERENCES public.app_user(user_id),
  approval_decision_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (woreda_id, plan_number)
);

-- One active plan per account at a time -- BR-11/§24's "current rent stays
-- separate" presumes a single governing schedule, not competing ones.
CREATE UNIQUE INDEX IF NOT EXISTS arrears_repayment_plan_one_active_per_account
  ON public.arrears_repayment_plan (rent_account_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS arrears_repayment_plan_woreda_status_idx
  ON public.arrears_repayment_plan (woreda_id, status);

DROP TRIGGER IF EXISTS arrears_repayment_plan_set_updated_at ON public.arrears_repayment_plan;
CREATE TRIGGER arrears_repayment_plan_set_updated_at
  BEFORE UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.assign_arrears_plan_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
BEGIN
  IF NEW.plan_number IS NOT NULL AND NEW.plan_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  INSERT INTO public.arrears_plan_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = arrears_plan_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.plan_number := v_woreda_code || '-ARP-' || LPAD(v_year::TEXT, 2, '0') || '-' || LPAD(v_next::TEXT, 5, '0');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_assign_arrears_plan_number ON public.arrears_repayment_plan;
CREATE TRIGGER zz_assign_arrears_plan_number
  BEFORE INSERT ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.assign_arrears_plan_number();

-- Actor pinning, matching every other workflow entity's own trigger set.
DROP TRIGGER IF EXISTS trg_force_actor ON public.arrears_repayment_plan;
CREATE TRIGGER trg_force_actor
  BEFORE INSERT OR UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('requested_by_user_id', 'approved_by_user_id');

-- Design note 3: maker != checker without a verified_by_user_id column.
CREATE OR REPLACE FUNCTION public.guard_arrears_plan_maker_checker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'submitted' THEN
    IF NEW.approved_by_user_id IS NULL THEN
      RAISE EXCEPTION 'guard_arrears_plan_maker_checker: an approval must record the approver'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያዘጋጀው ሠራተኛ ራሱ ማፅደቅ አይችልም / The clerk who prepared this plan cannot also approve it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- BEFORE UPDATE, named to fire after trg_force_actor and before the shared
-- engine's own zz_enforce_workflow_transition (alphabetical: trg_ < yy_ < zz_).
DROP TRIGGER IF EXISTS yy_guard_arrears_plan_maker_checker ON public.arrears_repayment_plan;
CREATE TRIGGER yy_guard_arrears_plan_maker_checker
  BEFORE UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.guard_arrears_plan_maker_checker();

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.arrears_repayment_plan;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_log_workflow_transition ON public.arrears_repayment_plan;
CREATE TRIGGER zz_log_workflow_transition
  AFTER UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_transition('plan_id');

-- Activation side-effect: submitted -> active flips every 'scheduled'
-- installment to 'due' (all installments payable from activation per plan
-- section 21: "early settlement of >= 2 complete installments allowed").
-- Deliberately touches NO rent_charge row -- "approval activates the
-- schedule; approval != payment" (plan section 16) -- the mapped charges
-- stay exactly as overdue as they were.
CREATE OR REPLACE FUNCTION public.activate_arrears_repayment_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'submitted' THEN
    UPDATE public.arrears_repayment_installment
       SET status = 'due'
     WHERE plan_id = NEW.plan_id AND status = 'scheduled';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_activate_arrears_repayment_plan ON public.arrears_repayment_plan;
CREATE TRIGGER zzz_activate_arrears_repayment_plan
  AFTER UPDATE ON public.arrears_repayment_plan
  FOR EACH ROW EXECUTE FUNCTION public.activate_arrears_repayment_plan();

ALTER TABLE public.arrears_repayment_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY arrears_repayment_plan_select ON public.arrears_repayment_plan
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- Rows are only ever created by create_arrears_repayment_plan() (SECURITY
-- DEFINER). Status transitions (submit-adjacent actions never apply here
-- since creation lands directly at 'submitted' -- approve/return/cancel/
-- default) go through ordinary client .update() calls, gated here and
-- policed by the workflow engine above.
CREATE POLICY arrears_repayment_plan_update ON public.arrears_repayment_plan
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.plan.create,rental.plan.approve,rental.plan.manage}'::text[])))
  WITH CHECK (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.plan.create,rental.plan.approve,rental.plan.manage}'::text[])));

-- ============================================================================
-- 5. arrears_repayment_installment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.arrears_repayment_installment (
  installment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  plan_id uuid NOT NULL REFERENCES public.arrears_repayment_plan(plan_id),
  installment_number integer NOT NULL CHECK (installment_number >= 1),
  due_date date NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  amount_enc bytea,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'due', 'paid', 'overdue', 'cancelled')),
  settled_by_payment_id uuid REFERENCES public.rental_payment(payment_id),
  settled_at timestamptz,
  UNIQUE (plan_id, installment_number)
);

CREATE INDEX IF NOT EXISTS arrears_repayment_installment_plan_idx
  ON public.arrears_repayment_installment (plan_id, installment_number);
CREATE INDEX IF NOT EXISTS arrears_repayment_installment_woreda_status_idx
  ON public.arrears_repayment_installment (woreda_id, status);

CREATE OR REPLACE FUNCTION public.arrears_repayment_installment_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.amount_enc := public.encrypt_pii_numeric(NEW.amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS arrears_repayment_installment_amount_sync_trg ON public.arrears_repayment_installment;
CREATE TRIGGER arrears_repayment_installment_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.arrears_repayment_installment
  FOR EACH ROW EXECUTE FUNCTION public.arrears_repayment_installment_amount_sync();

DROP VIEW IF EXISTS public.arrears_repayment_installment_decrypted;
CREATE VIEW public.arrears_repayment_installment_decrypted
  WITH (security_invoker = on) AS
  SELECT i.*,
         public.decrypt_pii_numeric(i.amount_enc, i.woreda_id) AS amount_decrypted
  FROM public.arrears_repayment_installment i;

REVOKE ALL ON public.arrears_repayment_installment_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.arrears_repayment_installment_decrypted TO authenticated, service_role;

ALTER TABLE public.arrears_repayment_installment ENABLE ROW LEVEL SECURITY;

-- SELECT only. Every write is through create_arrears_repayment_plan()
-- (creation, 'scheduled'), the activation trigger above (scheduled->due),
-- refresh_rent_ledger_statuses() (due->overdue), and
-- settle_arrears_installments() below (->paid) -- no direct client
-- INSERT/UPDATE/DELETE policy, same reasoning as rent_charge in Phase 2.
CREATE POLICY arrears_repayment_installment_select ON public.arrears_repayment_installment
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 6. arrears_installment_charge -- the mapping. A charge sits in at most one
--    active installment (plan section 16).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.arrears_installment_charge (
  mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  installment_id uuid NOT NULL REFERENCES public.arrears_repayment_installment(installment_id),
  rent_charge_id uuid NOT NULL REFERENCES public.rent_charge(rent_charge_id),
  charge_amount_snapshot numeric(14, 2) NOT NULL CHECK (charge_amount_snapshot > 0),
  charge_amount_snapshot_enc bytea,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installment_id, rent_charge_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS arrears_installment_charge_one_active_per_charge
  ON public.arrears_installment_charge (rent_charge_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.arrears_installment_charge_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.charge_amount_snapshot_enc := public.encrypt_pii_numeric(NEW.charge_amount_snapshot, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS arrears_installment_charge_amount_sync_trg ON public.arrears_installment_charge;
CREATE TRIGGER arrears_installment_charge_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.arrears_installment_charge
  FOR EACH ROW EXECUTE FUNCTION public.arrears_installment_charge_amount_sync();

DROP VIEW IF EXISTS public.arrears_installment_charge_decrypted;
CREATE VIEW public.arrears_installment_charge_decrypted
  WITH (security_invoker = on) AS
  SELECT m.*,
         public.decrypt_pii_numeric(m.charge_amount_snapshot_enc, m.woreda_id) AS charge_amount_snapshot_decrypted
  FROM public.arrears_installment_charge m;

REVOKE ALL ON public.arrears_installment_charge_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.arrears_installment_charge_decrypted TO authenticated, service_role;

ALTER TABLE public.arrears_installment_charge ENABLE ROW LEVEL SECURITY;

CREATE POLICY arrears_installment_charge_select ON public.arrears_installment_charge
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 7. create_arrears_repayment_plan() -- groups the account's overdue charges
--    into _installment_count nearly-equal, chronologically-contiguous
--    groups (NTILE over ethiopian_period_key), assigns every overdue charge
--    in full (plan section 16: "assignment always in full"), and inserts the
--    plan directly at 'submitted' (design note 4).
--
--    _installment_due_dates is an array of exactly _installment_count dates,
--    strictly increasing, supplied by the caller -- see design note 5.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_arrears_repayment_plan(
  _rent_account_id uuid,
  _installment_count integer,
  _installment_due_dates date[],
  _reason text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_account RECORD;
  v_max_installments integer;
  v_total numeric(14, 2);
  v_plan_id uuid;
  v_prev_date date;
  d date;
  r RECORD;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.plan.create'])) THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _installment_count IS NULL OR _installment_count < 1 THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: installment_count must be at least 1'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _installment_due_dates IS NULL OR array_length(_installment_due_dates, 1) <> _installment_count THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: exactly one due date is required per installment'
      USING ERRCODE = 'check_violation';
  END IF;

  v_prev_date := NULL;
  FOREACH d IN ARRAY _installment_due_dates LOOP
    IF v_prev_date IS NOT NULL AND d <= v_prev_date THEN
      RAISE EXCEPTION 'create_arrears_repayment_plan: installment due dates must strictly increase'
        USING ERRCODE = 'check_violation';
    END IF;
    v_prev_date := d;
  END LOOP;

  SELECT * INTO v_account FROM public.rent_account WHERE rent_account_id = _rent_account_id;
  IF NOT FOUND OR v_account.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arrears_repayment_plan WHERE rent_account_id = _rent_account_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ይህ ሂሳብ ቀድሞ ንቁ የክፍያ ዕቅድ አለው / This account already has an active repayment plan'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT plan_max_installments INTO v_max_installments
    FROM public.rental_policy WHERE woreda_id = v_woreda_id;
  IF v_max_installments IS NOT NULL AND _installment_count > v_max_installments THEN
    RAISE EXCEPTION 'create_arrears_repayment_plan: installment_count exceeds this tenant''s plan_max_installments (%)', v_max_installments
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only overdue, unassigned charges enter a plan (plan section 16). Locked
  -- first (FOR UPDATE cannot combine with a window function in the same
  -- query), then bucketed into installment_count groups in a second pass
  -- over the already-locked rows.
  CREATE TEMP TABLE _locked_overdue_charges ON COMMIT DROP AS
  SELECT rc.rent_charge_id, rc.total_amount, rc.ethiopian_period_key
    FROM public.rent_charge rc
   WHERE rc.rent_account_id = _rent_account_id
     AND rc.woreda_id = v_woreda_id
     AND rc.status = 'overdue'
     AND NOT EXISTS (
       SELECT 1 FROM public.arrears_installment_charge aic
        WHERE aic.rent_charge_id = rc.rent_charge_id AND aic.status = 'active'
     )
   ORDER BY rc.ethiopian_period_key
     FOR UPDATE OF rc;

  CREATE TEMP TABLE _plan_charges ON COMMIT DROP AS
  SELECT rent_charge_id, total_amount,
         NTILE(_installment_count) OVER (ORDER BY ethiopian_period_key) AS bucket
    FROM _locked_overdue_charges;

  SELECT sum(total_amount) INTO v_total FROM _plan_charges;

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'ይህ ሂሳብ ወደ ዕቅድ የሚገባ ያለፈ ጊዜ ክፍያ የለውም / This account has no unassigned overdue charges to place on a plan'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.arrears_repayment_plan (
    woreda_id, rent_account_id, resident_id, original_arrears_amount,
    assigned_arrears_amount, installment_count, status, reason, requested_by_user_id
  ) VALUES (
    v_woreda_id, _rent_account_id, v_account.resident_id, v_total,
    v_total, _installment_count, 'submitted', _reason, v_actor
  )
  RETURNING plan_id INTO v_plan_id;

  FOR r IN
    SELECT bucket, sum(total_amount) AS bucket_amount
      FROM _plan_charges
     GROUP BY bucket
     ORDER BY bucket
  LOOP
    INSERT INTO public.arrears_repayment_installment (
      woreda_id, plan_id, installment_number, due_date, amount, status
    ) VALUES (
      v_woreda_id, v_plan_id, r.bucket, _installment_due_dates[r.bucket], r.bucket_amount, 'scheduled'
    );

    INSERT INTO public.arrears_installment_charge (
      woreda_id, installment_id, rent_charge_id, charge_amount_snapshot, status
    )
    SELECT v_woreda_id,
           (SELECT installment_id FROM public.arrears_repayment_installment
             WHERE plan_id = v_plan_id AND installment_number = r.bucket),
           pc.rent_charge_id, pc.total_amount, 'active'
      FROM _plan_charges pc
     WHERE pc.bucket = r.bucket;
  END LOOP;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'arrears_repayment_plan', v_plan_id::text, 'ARREARS_PLAN_CREATED',
    jsonb_build_object('rent_account_id', _rent_account_id, 'total_arrears', v_total, 'installment_count', _installment_count));

  RETURN v_plan_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_arrears_repayment_plan(uuid, integer, date[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_arrears_repayment_plan(uuid, integer, date[], text) TO authenticated, service_role;

-- ============================================================================
-- 8. settle_arrears_installments() -- mirrors settle_rent_payment()'s exact-
--    sum-or-exception discipline (plan section 23: "installment amount is
--    fixed ... a payment settles the complete installment or doesn't").
--    Settling an installment settles every rent_charge it maps, through the
--    exact same rent_payment_settlement/rent_charge.status path Phase 3
--    established -- an arrears payment is not a second money pipeline
--    (BR-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_arrears_installments(
  _plan_id uuid,
  _installment_ids uuid[],
  _payment_amount numeric,
  _payment_date date,
  _channel text,
  _reference_number text,
  _payer_resident_id uuid,
  _idempotency_key text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_plan RECORD;
  v_existing_payment_id uuid;
  v_existing_exception_id uuid;
  v_expected numeric(14, 2);
  v_installment_count int;
  v_locked_count int;
  v_payment_id uuid;
  v_installment_id uuid;
  v_exception_id uuid;
  v_all_paid boolean;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'settle_arrears_installments: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.collect'])) THEN
    RAISE EXCEPTION 'settle_arrears_installments: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _installment_ids IS NULL OR array_length(_installment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ቢያንስ አንድ የተሟላ ክፍያ ክፍል መምረጥ ያስፈልጋል / At least one complete installment must be selected'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _payment_amount IS NULL OR _payment_amount <= 0 THEN
    RAISE EXCEPTION 'settle_arrears_installments: payment amount must be positive' USING ERRCODE = 'check_violation';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT rp.payment_id INTO v_existing_payment_id
      FROM public.rental_payment rp
     WHERE rp.woreda_id = v_woreda_id AND rp.idempotency_key = _idempotency_key;
    IF v_existing_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'idempotent_replay', 'payment_id', v_existing_payment_id);
    END IF;

    SELECT exception_id INTO v_existing_exception_id
      FROM public.payment_reconciliation_exception
     WHERE woreda_id = v_woreda_id AND idempotency_key = _idempotency_key;
    IF v_existing_exception_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'mismatch', 'exception_id', v_existing_exception_id);
    END IF;
  END IF;

  SELECT * INTO v_plan FROM public.arrears_repayment_plan WHERE plan_id = _plan_id;
  IF NOT FOUND OR v_plan.woreda_id <> v_woreda_id THEN
    RAISE EXCEPTION 'settle_arrears_installments: plan not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_plan.status <> 'active' THEN
    RAISE EXCEPTION 'settle_arrears_installments: plan is not active' USING ERRCODE = 'check_violation';
  END IF;

  IF _payer_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.resident WHERE resident_id = _payer_resident_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'settle_arrears_installments: payer resident not found in this woreda'
      USING ERRCODE = 'no_data_found';
  END IF;

  CREATE TEMP TABLE _locked_installments ON COMMIT DROP AS
  SELECT installment_id, amount
    FROM public.arrears_repayment_installment
   WHERE installment_id = ANY (_installment_ids)
     AND plan_id = _plan_id
     AND woreda_id = v_woreda_id
     AND status IN ('due', 'overdue')
   ORDER BY installment_id
     FOR UPDATE;

  SELECT count(*) INTO v_locked_count FROM _locked_installments;
  SELECT array_length(_installment_ids, 1) INTO v_installment_count;

  IF v_locked_count <> v_installment_count THEN
    RAISE EXCEPTION
      'ከመረጡት ክፍሎች ውስጥ አንዳንዶቹ ቀድሞ ተከፍለዋል ወይም አይገኙም -- ገጹን ያድሱ / One or more selected installments are already settled or unavailable -- refresh and try again'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sum(amount) INTO v_expected FROM _locked_installments;

  IF _payment_amount <> v_expected THEN
    INSERT INTO public.payment_reconciliation_exception (
      woreda_id, rent_account_id, external_reference, received_amount,
      expected_settlement_amount, exception_type, created_by, idempotency_key
    ) VALUES (
      v_woreda_id, v_plan.rent_account_id, _reference_number, _payment_amount,
      v_expected, 'amount_mismatch', v_actor, _idempotency_key
    )
    RETURNING exception_id INTO v_exception_id;

    RETURN jsonb_build_object(
      'status', 'mismatch',
      'exception_id', v_exception_id,
      'expected_amount', v_expected,
      'received_amount', _payment_amount
    );
  END IF;

  INSERT INTO public.payment (
    woreda_id, resident_id, payment_type, amount, payment_date, channel,
    reference_no, status, posted_by_user_id
  ) VALUES (
    v_woreda_id, _payer_resident_id, 'rental_rent', _payment_amount, _payment_date,
    _channel, _reference_number, 'confirmed', v_actor
  )
  RETURNING payment_id INTO v_payment_id;

  INSERT INTO public.rental_payment (
    payment_id, woreda_id, rent_account_id, payer_resident_id, reference_number, idempotency_key
  ) VALUES (
    v_payment_id, v_woreda_id, v_plan.rent_account_id, _payer_resident_id, _reference_number, _idempotency_key
  );

  FOR v_installment_id IN SELECT installment_id FROM _locked_installments LOOP
    -- Settle every rent_charge this installment maps, through the same
    -- rent_payment_settlement path Phase 3 established.
    INSERT INTO public.rent_payment_settlement (
      woreda_id, payment_id, rent_charge_id, settlement_amount, status, created_by
    )
    SELECT v_woreda_id, v_payment_id, aic.rent_charge_id, rc.total_amount, 'active', v_actor
      FROM public.arrears_installment_charge aic
      JOIN public.rent_charge rc ON rc.rent_charge_id = aic.rent_charge_id
     WHERE aic.installment_id = v_installment_id AND aic.status = 'active';

    UPDATE public.rent_charge
       SET status = 'paid', settled_at = now(), settled_by_payment_id = v_payment_id
     WHERE rent_charge_id IN (
       SELECT rent_charge_id FROM public.arrears_installment_charge
        WHERE installment_id = v_installment_id AND status = 'active'
     );

    UPDATE public.arrears_repayment_installment
       SET status = 'paid', settled_at = now(), settled_by_payment_id = v_payment_id
     WHERE installment_id = v_installment_id;
  END LOOP;

  INSERT INTO public.receipt (woreda_id, payment_id, receipt_date, total_amount, cash_bank_channel)
  VALUES (v_woreda_id, v_payment_id, _payment_date, _payment_amount, _channel);

  -- Plan completion is a system consequence of every installment being
  -- paid, never a client-driven transition.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.arrears_repayment_installment
     WHERE plan_id = _plan_id AND status <> 'paid'
  ) INTO v_all_paid;

  IF v_all_paid THEN
    PERFORM set_config('app.system_transition', 'on', true);
    UPDATE public.arrears_repayment_plan SET status = 'completed' WHERE plan_id = _plan_id;
    PERFORM set_config('app.system_transition', '', true);
  END IF;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'rental_payment', v_payment_id::text, 'ARREARS_INSTALLMENT_SETTLED',
    jsonb_build_object('plan_id', _plan_id, 'amount', _payment_amount, 'installment_ids', _installment_ids));

  RETURN jsonb_build_object('status', 'settled', 'payment_id', v_payment_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.settle_arrears_installments(uuid, uuid[], numeric, date, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_arrears_installments(uuid, uuid[], numeric, date, text, text, uuid, text) TO authenticated, service_role;

-- plan->completed is a system transition (driven only by the function
-- above, under the app.system_transition GUC already used elsewhere in
-- this module).
INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system)
VALUES
  ('arrears_repayment_plan', 'submitted', 'returned', 'rental.plan.approve', false),
  ('arrears_repayment_plan', 'returned', 'submitted', 'rental.plan.create', false),
  ('arrears_repayment_plan', 'submitted', 'cancelled', 'rental.plan.create', false),
  ('arrears_repayment_plan', 'submitted', 'active', 'rental.plan.approve', false),
  ('arrears_repayment_plan', 'active', 'completed', NULL, true),
  ('arrears_repayment_plan', 'active', 'defaulted', 'rental.plan.manage', false),
  ('arrears_repayment_plan', 'active', 'cancelled', 'rental.plan.manage', false)
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- enforce_workflow_transition() must see the system GUC for the completion
-- row above -- but that row's is_system=true only bypasses the permission
-- check, not the GUC gate itself, so completion driven from inside
-- settle_arrears_installments() (which sets the GUC) passes, while a plain
-- client PATCH to 'completed' (GUC unset) is rejected as "cannot be driven
-- directly" -- exactly the same protection Phase 1's occupancy-status
-- system transitions rely on.

-- ============================================================================
-- 9. get_rent_account_ledger_summary() -- plan section 22's derived metrics,
--    computed fresh on every call. No column here is ever written; this is
--    read-only aggregation over rent_charge/arrears_repayment_plan/
--    arrears_repayment_installment/rental_payment.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_rent_account_ledger_summary(_rent_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_result jsonb;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rent_account_ledger_summary: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.view'])) THEN
    RAISE EXCEPTION 'get_rent_account_ledger_summary: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rent_account WHERE rent_account_id = _rent_account_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'get_rent_account_ledger_summary: rent account not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT jsonb_build_object(
    'billed_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge WHERE rent_account_id = _rent_account_id
    ),
    'paid_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status = 'paid'
    ),
    'unpaid_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status IN ('due', 'overdue')
    ),
    'overdue_total', (
      SELECT COALESCE(sum(total_amount), 0) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status = 'overdue'
    ),
    'overdue_month_count', (
      SELECT count(*) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status = 'overdue'
    ),
    'oldest_overdue_period', (
      SELECT min(ethiopian_period_key) FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id AND status = 'overdue'
    ),
    'current_month_status', (
      SELECT status FROM public.rent_charge
       WHERE rent_account_id = _rent_account_id
       ORDER BY ethiopian_period_key DESC LIMIT 1
    ),
    'active_plan', (
      SELECT jsonb_build_object(
               'plan_id', p.plan_id, 'plan_number', p.plan_number, 'status', p.status,
               'installments_due', (
                 SELECT count(*) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status = 'due'
               ),
               'installments_overdue', (
                 SELECT count(*) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status = 'overdue'
               ),
               'installments_paid', (
                 SELECT count(*) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status = 'paid'
               ),
               'next_installment_due_date', (
                 SELECT min(due_date) FROM public.arrears_repayment_installment
                  WHERE plan_id = p.plan_id AND status IN ('due', 'overdue')
               )
             )
        FROM public.arrears_repayment_plan p
       WHERE p.rent_account_id = _rent_account_id AND p.status = 'active'
    ),
    'last_payment_date', (
      SELECT max(pay.payment_date)
        FROM public.rental_payment rp
        JOIN public.payment pay ON pay.payment_id = rp.payment_id
       WHERE rp.rent_account_id = _rent_account_id AND pay.status = 'confirmed'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_rent_account_ledger_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rent_account_ledger_summary(uuid) TO authenticated, service_role;

-- ============================================================================
-- 10. rent_reminder + generate_rent_reminders() -- plan sections 17/25,
--     narrowed for this phase to the two actionable, already-true states
--     (an account with overdue charges; an active plan with an overdue
--     installment). rent_due/plan_due (upcoming, not yet due) and
--     escalation are legal reminder_type values -- the column accepts them
--     -- but this migration's generator does not produce them yet; nothing
--     in the plan requires every type to ship in the same phase, and
--     reminders "snapshot but never mutate the ledger" either way.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rent_reminder (
  reminder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rent_account_id uuid NOT NULL REFERENCES public.rent_account(rent_account_id),
  reminder_type text NOT NULL
    CHECK (reminder_type IN ('rent_due', 'rent_overdue', 'plan_due', 'plan_overdue', 'escalation')),
  snapshot_month_count integer,
  snapshot_amount numeric(14, 2),
  snapshot_amount_enc bytea,
  snapshot_oldest_overdue_period text,
  delivery_channel text NOT NULL DEFAULT 'erp' CHECK (delivery_channel IN ('erp', 'sms', 'print')),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent per account/type/day -- re-running the generator the same day
-- creates nothing new.
CREATE UNIQUE INDEX IF NOT EXISTS rent_reminder_one_per_account_type_day
  ON public.rent_reminder (rent_account_id, reminder_type, ((created_at AT TIME ZONE 'UTC')::date));

CREATE OR REPLACE FUNCTION public.rent_reminder_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.snapshot_amount_enc := public.encrypt_pii_numeric(NEW.snapshot_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rent_reminder_amount_sync_trg ON public.rent_reminder;
CREATE TRIGGER rent_reminder_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.rent_reminder
  FOR EACH ROW EXECUTE FUNCTION public.rent_reminder_amount_sync();

DROP VIEW IF EXISTS public.rent_reminder_decrypted;
CREATE VIEW public.rent_reminder_decrypted
  WITH (security_invoker = on) AS
  SELECT rr.*,
         public.decrypt_pii_numeric(rr.snapshot_amount_enc, rr.woreda_id) AS snapshot_amount_decrypted
  FROM public.rent_reminder rr;

REVOKE ALL ON public.rent_reminder_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rent_reminder_decrypted TO authenticated, service_role;

ALTER TABLE public.rent_reminder ENABLE ROW LEVEL SECURITY;

CREATE POLICY rent_reminder_select ON public.rent_reminder
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

CREATE OR REPLACE FUNCTION public.generate_rent_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_rent_overdue_created int := 0;
  v_plan_overdue_created int := 0;
  r RECORD;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'generate_rent_reminders: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.billing'])) THEN
    RAISE EXCEPTION 'generate_rent_reminders: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR r IN
    SELECT rent_account_id, count(*) AS month_count, sum(total_amount) AS amount, min(ethiopian_period_key) AS oldest
      FROM public.rent_charge
     WHERE woreda_id = v_woreda_id AND status = 'overdue'
     GROUP BY rent_account_id
  LOOP
    INSERT INTO public.rent_reminder (
      woreda_id, rent_account_id, reminder_type, snapshot_month_count,
      snapshot_amount, snapshot_oldest_overdue_period
    ) VALUES (
      v_woreda_id, r.rent_account_id, 'rent_overdue', r.month_count, r.amount, r.oldest
    )
    ON CONFLICT (rent_account_id, reminder_type, ((created_at AT TIME ZONE 'UTC')::date)) DO NOTHING;
    IF FOUND THEN v_rent_overdue_created := v_rent_overdue_created + 1; END IF;
  END LOOP;

  FOR r IN
    SELECT p.rent_account_id, count(i.*) AS month_count, sum(i.amount) AS amount
      FROM public.arrears_repayment_plan p
      JOIN public.arrears_repayment_installment i ON i.plan_id = p.plan_id AND i.status = 'overdue'
     WHERE p.woreda_id = v_woreda_id AND p.status = 'active'
     GROUP BY p.rent_account_id
  LOOP
    INSERT INTO public.rent_reminder (
      woreda_id, rent_account_id, reminder_type, snapshot_month_count, snapshot_amount
    ) VALUES (
      v_woreda_id, r.rent_account_id, 'plan_overdue', r.month_count, r.amount
    )
    ON CONFLICT (rent_account_id, reminder_type, ((created_at AT TIME ZONE 'UTC')::date)) DO NOTHING;
    IF FOUND THEN v_plan_overdue_created := v_plan_overdue_created + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'rent_overdue_reminders_created', v_rent_overdue_created,
    'plan_overdue_reminders_created', v_plan_overdue_created
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_rent_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_rent_reminders() TO authenticated, service_role;

-- ============================================================================
-- 11. Extend the security_invoker regression assertion (Phase 3 review
--     finding, migration 79) to this migration's four new decrypted views.
-- ============================================================================

DO $sec$
DECLARE
  v_name text;
  v_opts text[];
  v_missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'approval_queue_v', 'household_member_roster', 'resident_decrypted',
    'household_decrypted', 'payment_decrypted', 'service_request_decrypted',
    'rental_occupancy_decrypted', 'rental_occupancy_request_decrypted',
    'rent_charge_decrypted', 'rent_rate_history_decrypted',
    'rent_payment_settlement_decrypted', 'payment_reconciliation_exception_decrypted',
    'arrears_repayment_installment_decrypted', 'arrears_installment_charge_decrypted',
    'rent_reminder_decrypted'
  ] LOOP
    SELECT c.reloptions INTO v_opts
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_name AND c.relkind = 'v';
    IF FOUND AND (v_opts IS NULL OR NOT ('security_invoker=on' = ANY (v_opts))) THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'These views lost security_invoker: %. They are owned by a rolbypassrls role, so without it they stop applying the underlying tables'' RLS and return every tenant''s rows. Restore WITH (security_invoker = on).',
      array_to_string(v_missing, ', ');
  END IF;
END $sec$;

COMMIT;
