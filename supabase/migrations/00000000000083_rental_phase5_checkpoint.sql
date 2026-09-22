-- Kebele Rental Houses Management -- Phase 5: cross-module checkpoint
-- (plan section 18) and reporting (plan section 34).
--
-- 1. Checkpoint mechanism. A service request whose service_type is marked
--    rental_checkpoint_gated (catalog-configurable data -- CLAUDE.md's own
--    "service catalog is configurable, not hardcoded" note -- not every
--    letter type needs this, so it is opt-in per type, default off) is
--    checked at submission against the applicant's *household's* rental
--    standing: Resident -> current_household_id -> active rental_occupancy
--    (matched on either the requester's own resident_id or their
--    household_id, so a household member who isn't the signer still
--    resolves correctly -- plan section 18's "any member of their active
--    household") -> its active rent_account -> live overdue aggregation.
--    Blocking is governed entirely by rental_policy (PD-03/04, already
--    seeded in Phase 0): block_on_rental_arrears (default false -- visible,
--    non-blocking), plan_compliance_effect ('reduce_severity' by default --
--    an active repayment plan un-blocks even with arrears outstanding, it
--    is never hidden), and emergency_exemption (whether an override is
--    possible at all). The override itself is a new permission
--    (service.checkpoint_override, ordinary, supervisor/tenant_admin by
--    default) plus a mandatory reason -- both enforced in the same trigger
--    that would otherwise reject the insert, and both recorded.
--
--    resolve_rental_checkpoint() is the single source of this logic,
--    callable directly (for a live pre-submission banner, and for the
--    "refreshable after payments" requirement) and reused by both the
--    BEFORE INSERT trigger that decides (enforce_rental_checkpoint) and the
--    AFTER INSERT trigger that records the decision
--    (record_rental_checkpoint) into the new service_request_checkpoint
--    table -- one row per gated request, an audit trail per plan section
--    33, never a second copy of rental truth (plan section 18's own
--    closing line: "the checkpoint consumes rental truth, it never becomes
--    a second ledger" -- every figure on the row is a snapshot of what the
--    live ledger said at that moment, not a value anything else reads
--    from).
--
--    Deliberately NOT gated on rental.view/rental.report: a civil_registrar
--    or registry_clerk submitting a routine letter has neither permission
--    and must not be blocked from the checkpoint mechanism itself by a
--    module permission unrelated to what they are actually doing --
--    resolve_rental_checkpoint() is gated on the same service.create/
--    service.submit/complaint.manage/tenant.manage permissions
--    service_request's own INSERT policy (00000000000061) requires -- and,
--    deliberately, returns the same full arrears detail (overdue amount,
--    month count, oldest period) to those callers even though they lack
--    rental.view/rental.report. This is PD-03's own "visible, non-blocking"
--    default, not an RLS gap: the whole point is that the front-desk staff
--    who submit these letters see the arrears context, not just a yes/no.
--    resolve_rental_checkpoint_core() is the real computation
--    (SECURITY DEFINER, never granted to authenticated/anon directly); the
--    public resolve_rental_checkpoint() wrapper exists only so both
--    triggers below call the core once each, on their own already-
--    authorized path, rather than re-checking the same permission twice.
--
--    The gate is enforced on INSERT and on UPDATE alike (BEFORE INSERT OR
--    UPDATE): an UPDATE that changes service_type_id or resident_id
--    re-runs the same decision, and an UPDATE that touches
--    checkpoint_override/checkpoint_override_reason re-runs the same
--    override authorization (policy exemption + permission + reason) --
--    otherwise a plain service.create UPDATE could retarget a request at a
--    gated type after insert, or self-attest an override, with neither
--    ever evaluated.
--
-- 2. Reporting. Five new server-counted, woreda-scoped, STABLE RPCs
--    covering the plan-section-34 categories this project's Phases 2-4
--    actually introduced (billing/collection by EC period, arrears aging by
--    EC-period-derived buckets, plan compliance, checkpoint activity,
--    charges-vs-settlements-vs-exceptions reconciliation) -- vacancy,
--    occupancy, applications and active-tenant counts already exist
--    (woreda.rental-houses.*, the Reports page's own "rental" tab) and are
--    out of this migration's scope. Gated on rental.report, per the plan's
--    own line ("`rental.report` permission").
--
--    get_rental_arrears_aging_report() takes the current EC period key as
--    a parameter rather than deriving it from current_date in SQL --
--    "zero new calendar logic" (BR-28): every EC-period computation in this
--    module happens client-side via ethiopianCalendar.ts, and month-bucket
--    arithmetic over an already-validated `ethiopian_period_key` (the
--    CHECK constraint enforces `YYYY-MM`, 01-12 only, Pagume excluded from
--    billing since Phase 2) is plain integer subtraction, not a calendar
--    conversion -- rental_period_month_index() below does exactly that and
--    nothing more.
--
-- ADDITIVE. No DROP of any table, column, or constraint.
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. Permission: service.checkpoint_override (ordinary -- an override of a
--    policy-configurable block is a supervisory judgment call, not itself
--    money-moving, so it sits with rental.plan.manage's risk class, not
--    rental.reverse's).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete','rental.policy.configure','rental.billing','rental.collect','rental.settle','rental.reverse','rental.plan.create','rental.plan.approve','rental.plan.manage','service.checkpoint_override']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject','rental.plan.approve','rental.plan.manage','service.checkpoint_override']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','rental.collect','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment','rental.view','rental.collect','rental.settle','rental.plan.create']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;$function$;

INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, p.permission_key, p.permission_key = ANY (public.default_role_perms(r.role_name))
  FROM public.woreda w
 CROSS JOIN (VALUES
    ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
    ('supervisor'), ('auditor'), ('viewer')
  ) AS r(role_name)
 CROSS JOIN (VALUES ('service.checkpoint_override')) AS p(permission_key)
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

-- ============================================================================
-- 2. Catalog + request columns.
-- ============================================================================

ALTER TABLE public.service_type
  ADD COLUMN IF NOT EXISTS rental_checkpoint_gated boolean NOT NULL DEFAULT false;

ALTER TABLE public.service_request
  ADD COLUMN IF NOT EXISTS checkpoint_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkpoint_override_reason text;

-- ============================================================================
-- 3. service_request_checkpoint -- one row per gated request, written only
--    by the SECURITY DEFINER trigger below (no INSERT/UPDATE/DELETE policy
--    -- a client cannot fabricate or edit its own checkpoint history).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_request_checkpoint (
  checkpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  service_request_id uuid NOT NULL UNIQUE REFERENCES public.service_request(service_request_id),
  resident_id uuid REFERENCES public.resident(resident_id),
  rental_house_id uuid REFERENCES public.kebele_rental_house(rental_house_id),
  rent_account_id uuid REFERENCES public.rent_account(rent_account_id),
  has_active_occupancy boolean NOT NULL DEFAULT false,
  overdue_month_count integer NOT NULL DEFAULT 0,
  overdue_total numeric(14, 2) NOT NULL DEFAULT 0,
  overdue_total_enc bytea,
  oldest_overdue_period text,
  has_active_plan boolean NOT NULL DEFAULT false,
  active_plan_id uuid REFERENCES public.arrears_repayment_plan(plan_id),
  would_block boolean NOT NULL DEFAULT false,
  override_used boolean NOT NULL DEFAULT false,
  override_reason text,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_request_checkpoint_woreda_idx
  ON public.service_request_checkpoint (woreda_id, resolved_at);

CREATE OR REPLACE FUNCTION public.service_request_checkpoint_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.overdue_total_enc := public.encrypt_pii_numeric(NEW.overdue_total, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS service_request_checkpoint_amount_sync_trg ON public.service_request_checkpoint;
CREATE TRIGGER service_request_checkpoint_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.service_request_checkpoint
  FOR EACH ROW EXECUTE FUNCTION public.service_request_checkpoint_amount_sync();

DROP VIEW IF EXISTS public.service_request_checkpoint_decrypted;
CREATE VIEW public.service_request_checkpoint_decrypted
  WITH (security_invoker = on) AS
  SELECT c.*,
         public.decrypt_pii_numeric(c.overdue_total_enc, c.woreda_id) AS overdue_total_decrypted
  FROM public.service_request_checkpoint c;

REVOKE ALL ON public.service_request_checkpoint_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_request_checkpoint_decrypted TO authenticated, service_role;

-- Table-level grants as a second barrier behind RLS, matching
-- 00000000000034's precedent: Supabase's default privileges hand
-- `authenticated` full DML at CREATE TIME, and RLS alone (SELECT-only
-- policy, no INSERT/UPDATE/DELETE policy) is what actually blocks a client
-- write here -- this narrows the table grant itself too.
REVOKE ALL ON public.service_request_checkpoint FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_request_checkpoint TO authenticated, service_role;

ALTER TABLE public.service_request_checkpoint ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_request_checkpoint_select ON public.service_request_checkpoint;
CREATE POLICY service_request_checkpoint_select ON public.service_request_checkpoint
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{service.read,rental.report}'::text[])));

-- ============================================================================
-- 4. resolve_rental_checkpoint() -- the single resolution used for the live
--    pre-submission banner, the post-payment refresh, and both triggers
--    below.
-- ============================================================================

-- resolve_rental_checkpoint_core() is the real computation, always full
-- detail, never exposed to authenticated/anon directly -- only callable by
-- functions owned by the same role (the two triggers below, and the public
-- wrapper), so the block decision and the audit snapshot are never affected
-- by the caller's own reporting permissions.
CREATE OR REPLACE FUNCTION public.resolve_rental_checkpoint_core(_resident_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_household_id uuid;
  v_occupancy RECORD;
  v_rent_account_id uuid;
  v_policy RECORD;
  v_overdue_count int;
  v_overdue_total numeric(14, 2);
  v_oldest_period text;
  v_active_plan RECORD;
  v_has_active_plan boolean := false;
  v_would_block boolean := false;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'resolve_rental_checkpoint: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['service.create', 'service.submit', 'complaint.manage', 'tenant.manage'])) THEN
    RAISE EXCEPTION 'resolve_rental_checkpoint: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _resident_id IS NULL THEN
    RETURN jsonb_build_object('has_active_occupancy', false, 'would_block', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.resident WHERE resident_id = _resident_id AND woreda_id = v_woreda_id
  ) THEN
    RAISE EXCEPTION 'resolve_rental_checkpoint: resident not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT current_household_id INTO v_household_id FROM public.resident WHERE resident_id = _resident_id;

  -- Matched on the requester's own occupancy OR their household's -- plan
  -- section 18: "any member of their active household", not only the
  -- resident who signed the rental agreement.
  SELECT * INTO v_occupancy FROM public.rental_occupancy ro
   WHERE ro.woreda_id = v_woreda_id AND ro.status = 'active'
     AND (ro.resident_id = _resident_id OR (v_household_id IS NOT NULL AND ro.household_id = v_household_id))
   ORDER BY ro.rent_start_date DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_active_occupancy', false, 'would_block', false);
  END IF;

  SELECT rent_account_id INTO v_rent_account_id
    FROM public.rent_account WHERE occupancy_id = v_occupancy.occupancy_id AND status = 'active';

  IF v_rent_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'has_active_occupancy', true, 'has_rent_account', false,
      'rental_house_id', v_occupancy.rental_house_id, 'would_block', false
    );
  END IF;

  SELECT * INTO v_policy FROM public.rental_policy WHERE woreda_id = v_woreda_id;

  -- Live, never a stored balance (rent_account has no arrears column at
  -- all). refresh_rent_ledger_statuses() -- the batch job that would flip
  -- 'due' rows to 'overdue' -- has no caller anywhere in this app, so a
  -- charge whose due_date has simply passed still reads 'due'. Treating
  -- status='due' AND due_date < current_date as overdue too (in addition to
  -- the 'overdue' status itself) is what actually makes this live rather
  -- than dependent on a batch job nothing runs; it's a plain comparison
  -- against an already-stored due_date, not a new calendar computation.
  SELECT count(*), COALESCE(sum(total_amount), 0), min(ethiopian_period_key)
    INTO v_overdue_count, v_overdue_total, v_oldest_period
    FROM public.rent_charge
   WHERE rent_account_id = v_rent_account_id
     AND (status = 'overdue' OR (status = 'due' AND due_date < current_date));

  SELECT plan_id, plan_number INTO v_active_plan
    FROM public.arrears_repayment_plan WHERE rent_account_id = v_rent_account_id AND status = 'active';
  v_has_active_plan := FOUND;

  -- PD-03/04: block only when the woreda opted in, arrears actually exist,
  -- and (an active plan doesn't already reduce severity per policy).
  IF v_policy.block_on_rental_arrears
     AND v_overdue_count > 0
     AND NOT (v_has_active_plan AND v_policy.plan_compliance_effect = 'reduce_severity')
  THEN
    v_would_block := true;
  END IF;

  RETURN jsonb_build_object(
    'has_active_occupancy', true,
    'has_rent_account', true,
    'rent_account_id', v_rent_account_id,
    'rental_house_id', v_occupancy.rental_house_id,
    'overdue_month_count', v_overdue_count,
    'overdue_total', v_overdue_total,
    'oldest_overdue_period', v_oldest_period,
    'has_active_plan', v_has_active_plan,
    'active_plan_id', v_active_plan.plan_id,
    'active_plan_number', v_active_plan.plan_number,
    'block_on_rental_arrears', v_policy.block_on_rental_arrears,
    'plan_compliance_effect', v_policy.plan_compliance_effect,
    'emergency_exemption', v_policy.emergency_exemption,
    'would_block', v_would_block
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_rental_checkpoint_core(uuid) FROM PUBLIC, anon, authenticated;

-- Public wrapper: same decision and same full detail. PD-03's default mode
-- is "visible, non-blocking" specifically to the front-desk staff
-- (civil_registrar/registry_clerk) who submit the routine letters this
-- gates -- the pre-submission banner shows overdue_month_count/overdue_total
-- to them by design even though they hold neither rental.view nor
-- rental.report (see woreda.services.new.tsx's non-blocking banner state).
-- The wrapper exists only so the two triggers below call the core directly
-- and never pay for a second permission check on their own already-
-- authorized SECURITY DEFINER path.
CREATE OR REPLACE FUNCTION public.resolve_rental_checkpoint(_resident_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.resolve_rental_checkpoint_core(_resident_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_rental_checkpoint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_rental_checkpoint(uuid) TO authenticated, service_role;

-- ============================================================================
-- 5. Enforcement (BEFORE INSERT -- decides) and recording (AFTER INSERT --
--    writes the audit row). Only fires for a gated service_type; every
--    other request is untouched.
-- ============================================================================

-- BEFORE INSERT OR UPDATE, not INSERT-only: an UPDATE that retargets
-- service_type_id/resident_id at a gated type/resident, or that touches
-- checkpoint_override/checkpoint_override_reason directly, re-runs the
-- exact same decision and authorization -- otherwise a plain service.create
-- UPDATE (the update policy in 00000000000061 admits it) could insert under
-- a non-gated type and then retarget past the gate, or self-attest an
-- override with neither service.checkpoint_override nor a valid reason,
-- since nothing after INSERT would ever re-check either. An UPDATE that
-- touches none of those four columns is a no-op for this trigger (skip
-- straight through -- most service_request UPDATEs are status transitions
-- with nothing to do with the checkpoint).
CREATE OR REPLACE FUNCTION public.enforce_rental_checkpoint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gated boolean;
  v_checkpoint jsonb;
  v_policy_exempt boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.service_type_id IS NOT DISTINCT FROM OLD.service_type_id
       AND NEW.resident_id IS NOT DISTINCT FROM OLD.resident_id
       AND NEW.checkpoint_override IS NOT DISTINCT FROM OLD.checkpoint_override
       AND NEW.checkpoint_override_reason IS NOT DISTINCT FROM OLD.checkpoint_override_reason
    THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT rental_checkpoint_gated INTO v_gated
    FROM public.service_type WHERE service_type_id = NEW.service_type_id AND woreda_id = NEW.woreda_id;

  IF NOT COALESCE(v_gated, false) OR NEW.resident_id IS NULL THEN
    NEW.checkpoint_override := false;
    NEW.checkpoint_override_reason := NULL;
    RETURN NEW;
  END IF;

  v_checkpoint := public.resolve_rental_checkpoint_core(NEW.resident_id);

  IF NOT COALESCE((v_checkpoint ->> 'would_block')::boolean, false) THEN
    NEW.checkpoint_override := false;
    NEW.checkpoint_override_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.checkpoint_override THEN
    SELECT emergency_exemption INTO v_policy_exempt
      FROM public.rental_policy WHERE woreda_id = NEW.woreda_id;

    IF NOT COALESCE(v_policy_exempt, false) THEN
      RAISE EXCEPTION
        'ይህ ወረዳ የአስቸኳይ ጊዜ ማለፊያ አይፈቅድም / This woreda does not allow an emergency checkpoint override'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['service.checkpoint_override'])) THEN
      RAISE EXCEPTION 'enforce_rental_checkpoint: permission denied to override'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.checkpoint_override_reason IS NULL OR length(trim(NEW.checkpoint_override_reason)) = 0 THEN
      RAISE EXCEPTION
        'ማለፊያውን ለምን እንደተጠቀሙ ምክንያት ያስፈልጋል / A reason is required to override this checkpoint'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ይህ አመልካች/ቤተሰብ ያልተከፈለ የኪራይ ዕዳ አለበት፣ ይህ ጥያቄ በፖሊሲ ታግዷል / This applicant''s household has unresolved rental arrears and this request is blocked by policy'
    USING ERRCODE = 'check_violation';
END;
$function$;

-- Named to sort after trg_enforce_service_request_preconditions
-- (00000000000062) alphabetically, so an invalid/foreign resident_id or an
-- inactive service_type is rejected by that trigger's own bilingual message
-- first, rather than this one raising the raw
-- "resolve_rental_checkpoint: resident not found" ahead of it.
DROP TRIGGER IF EXISTS trg_enforce_rental_checkpoint ON public.service_request;
DROP TRIGGER IF EXISTS trg_zzenforce_rental_checkpoint ON public.service_request;
CREATE TRIGGER trg_zzenforce_rental_checkpoint
  BEFORE INSERT OR UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rental_checkpoint();

-- AFTER INSERT OR UPDATE OF the same four columns, upserting on the table's
-- own service_request_id UNIQUE constraint -- so an UPDATE that
-- enforce_rental_checkpoint() above just re-evaluated (a retarget to a
-- gated type, or an authorized override) also gets its audit snapshot kept
-- current, rather than the checkpoint row silently going stale relative to
-- the request it describes.
CREATE OR REPLACE FUNCTION public.record_rental_checkpoint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gated boolean;
  v_checkpoint jsonb;
  v_actor uuid := auth.uid();
BEGIN
  SELECT rental_checkpoint_gated INTO v_gated
    FROM public.service_type WHERE service_type_id = NEW.service_type_id AND woreda_id = NEW.woreda_id;

  IF NOT COALESCE(v_gated, false) OR NEW.resident_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_checkpoint := public.resolve_rental_checkpoint_core(NEW.resident_id);

  INSERT INTO public.service_request_checkpoint (
    woreda_id, service_request_id, resident_id, rental_house_id, rent_account_id,
    has_active_occupancy, overdue_month_count, overdue_total, oldest_overdue_period,
    has_active_plan, active_plan_id, would_block, override_used, override_reason
  ) VALUES (
    NEW.woreda_id, NEW.service_request_id, NEW.resident_id,
    (v_checkpoint ->> 'rental_house_id')::uuid, (v_checkpoint ->> 'rent_account_id')::uuid,
    COALESCE((v_checkpoint ->> 'has_active_occupancy')::boolean, false),
    COALESCE((v_checkpoint ->> 'overdue_month_count')::int, 0),
    COALESCE((v_checkpoint ->> 'overdue_total')::numeric, 0),
    v_checkpoint ->> 'oldest_overdue_period',
    COALESCE((v_checkpoint ->> 'has_active_plan')::boolean, false),
    (v_checkpoint ->> 'active_plan_id')::uuid,
    COALESCE((v_checkpoint ->> 'would_block')::boolean, false),
    NEW.checkpoint_override,
    NEW.checkpoint_override_reason
  )
  ON CONFLICT (service_request_id) DO UPDATE SET
    rental_house_id = EXCLUDED.rental_house_id,
    rent_account_id = EXCLUDED.rent_account_id,
    has_active_occupancy = EXCLUDED.has_active_occupancy,
    overdue_month_count = EXCLUDED.overdue_month_count,
    overdue_total = EXCLUDED.overdue_total,
    oldest_overdue_period = EXCLUDED.oldest_overdue_period,
    has_active_plan = EXCLUDED.has_active_plan,
    active_plan_id = EXCLUDED.active_plan_id,
    would_block = EXCLUDED.would_block,
    override_used = EXCLUDED.override_used,
    override_reason = EXCLUDED.override_reason,
    resolved_at = now();

  IF NEW.checkpoint_override THEN
    INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
    VALUES (NEW.woreda_id, v_actor, 'service_request', NEW.service_request_id::text, 'RENTAL_CHECKPOINT_OVERRIDE',
      jsonb_build_object('reason', NEW.checkpoint_override_reason,
        'overdue_month_count', v_checkpoint ->> 'overdue_month_count',
        'overdue_total', v_checkpoint ->> 'overdue_total'));
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_record_rental_checkpoint ON public.service_request;
CREATE TRIGGER zz_record_rental_checkpoint
  AFTER INSERT OR UPDATE OF service_type_id, resident_id, checkpoint_override, checkpoint_override_reason
  ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.record_rental_checkpoint();

-- ============================================================================
-- 6. Reporting RPCs (plan section 34), gated on rental.report.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rental_period_month_index(_period_key text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (split_part(_period_key, '-', 1)::int * 12) + split_part(_period_key, '-', 2)::int;
$function$;

REVOKE EXECUTE ON FUNCTION public.rental_period_month_index(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_period_month_index(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rental_billing_collection_report()
 RETURNS TABLE(period_key text, billed_total numeric, collected_total numeric, outstanding_total numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rental_billing_collection_report: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.report'])) THEN
    RAISE EXCEPTION 'get_rental_billing_collection_report: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- outstanding_total mirrors get_rent_account_ledger_summary()'s own
  -- unpaid_total definition (00000000000080): status IN ('due','overdue')
  -- only. rc.status <> 'paid' would also count 'waived' and 'cancelled' as
  -- outstanding arrears, which they are not.
  RETURN QUERY
  SELECT rc.ethiopian_period_key,
         SUM(rc.total_amount) AS billed_total,
         SUM(CASE WHEN rc.status = 'paid' THEN rc.total_amount ELSE 0 END) AS collected_total,
         SUM(CASE WHEN rc.status IN ('due', 'overdue') THEN rc.total_amount ELSE 0 END) AS outstanding_total
    FROM public.rent_charge rc
   WHERE rc.woreda_id = v_woreda_id
   GROUP BY rc.ethiopian_period_key
   ORDER BY rc.ethiopian_period_key;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_rental_billing_collection_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rental_billing_collection_report() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rental_arrears_aging_report(_current_period_key text)
 RETURNS TABLE(bucket_label text, charge_count bigint, total_amount numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_current_idx integer;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rental_arrears_aging_report: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.report'])) THEN
    RAISE EXCEPTION 'get_rental_arrears_aging_report: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _current_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'get_rental_arrears_aging_report: invalid period key' USING ERRCODE = 'check_violation';
  END IF;

  v_current_idx := public.rental_period_month_index(_current_period_key);

  -- Same live-overdue widening as resolve_rental_checkpoint_core(): status
  -- IN ('overdue') alone under-reports, since nothing in this app ever
  -- flips 'due' to 'overdue' (refresh_rent_ledger_statuses() has no
  -- caller). A 'due' charge whose due_date has passed counts too.
  RETURN QUERY
  WITH aged AS (
    SELECT rc.total_amount,
           GREATEST(v_current_idx - public.rental_period_month_index(rc.ethiopian_period_key), 0) AS months_overdue
      FROM public.rent_charge rc
     WHERE rc.woreda_id = v_woreda_id
       AND (rc.status = 'overdue' OR (rc.status = 'due' AND rc.due_date < current_date))
  ),
  bucketed AS (
    SELECT total_amount,
           CASE
             WHEN months_overdue <= 1 THEN 1
             WHEN months_overdue BETWEEN 2 AND 3 THEN 2
             WHEN months_overdue BETWEEN 4 AND 6 THEN 3
             WHEN months_overdue BETWEEN 7 AND 12 THEN 4
             ELSE 5
           END AS bucket_ord,
           CASE
             WHEN months_overdue <= 1 THEN '0-1'
             WHEN months_overdue BETWEEN 2 AND 3 THEN '2-3'
             WHEN months_overdue BETWEEN 4 AND 6 THEN '4-6'
             WHEN months_overdue BETWEEN 7 AND 12 THEN '7-12'
             ELSE '12+'
           END AS bucket_label
      FROM aged
  )
  SELECT bucket_label, count(*)::bigint, sum(total_amount)
    FROM bucketed
   GROUP BY bucket_ord, bucket_label
   ORDER BY bucket_ord;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_rental_arrears_aging_report(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rental_arrears_aging_report(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rental_plan_compliance_report()
 RETURNS TABLE(
   status text, plan_count bigint, installments_scheduled bigint,
   installments_due bigint, installments_overdue bigint,
   installments_paid bigint, installments_cancelled bigint
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rental_plan_compliance_report: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.report'])) THEN
    RAISE EXCEPTION 'get_rental_plan_compliance_report: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.status,
         count(DISTINCT p.plan_id)::bigint,
         count(*) FILTER (WHERE i.status = 'scheduled')::bigint,
         count(*) FILTER (WHERE i.status = 'due')::bigint,
         count(*) FILTER (WHERE i.status = 'overdue')::bigint,
         count(*) FILTER (WHERE i.status = 'paid')::bigint,
         count(*) FILTER (WHERE i.status = 'cancelled')::bigint
    FROM public.arrears_repayment_plan p
    LEFT JOIN public.arrears_repayment_installment i ON i.plan_id = p.plan_id
   WHERE p.woreda_id = v_woreda_id
   GROUP BY p.status
   ORDER BY p.status;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_rental_plan_compliance_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rental_plan_compliance_report() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rental_checkpoint_activity_report(_start_date date, _end_date date)
 RETURNS TABLE(total_resolved bigint, blocked_count bigint, overridden_count bigint, passed_count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rental_checkpoint_activity_report: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.report'])) THEN
    RAISE EXCEPTION 'get_rental_checkpoint_activity_report: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _start_date IS NULL OR _end_date IS NULL OR _start_date > _end_date THEN
    RAISE EXCEPTION 'get_rental_checkpoint_activity_report: invalid date range' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE would_block)::bigint,
         count(*) FILTER (WHERE would_block AND override_used)::bigint,
         count(*) FILTER (WHERE NOT would_block)::bigint
    FROM public.service_request_checkpoint c
   WHERE c.woreda_id = v_woreda_id
     AND (c.resolved_at AT TIME ZONE 'UTC')::date BETWEEN _start_date AND _end_date;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_rental_checkpoint_activity_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rental_checkpoint_activity_report(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rental_reconciliation_report()
 RETURNS TABLE(
   billed_total numeric, settled_total numeric, reversed_total numeric,
   exception_count bigint, exception_total numeric
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'get_rental_reconciliation_report: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.report'])) THEN
    RAISE EXCEPTION 'get_rental_reconciliation_report: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Exceptions filtered to open/under_review: once resolve_reconciliation_
  -- exception() (00000000000078) closes one, the corrected settlement is
  -- re-submitted through settle_rent_payment() and already lands in
  -- settled_total above -- counting a resolved/rejected exception here too
  -- would double-report the same money and never let this KPI return to
  -- zero after a clean finance close.
  RETURN QUERY
  SELECT
    (SELECT COALESCE(SUM(total_amount), 0) FROM public.rent_charge WHERE woreda_id = v_woreda_id),
    (SELECT COALESCE(SUM(settlement_amount), 0) FROM public.rent_payment_settlement
      WHERE woreda_id = v_woreda_id AND status = 'active'),
    (SELECT COALESCE(SUM(settlement_amount), 0) FROM public.rent_payment_settlement
      WHERE woreda_id = v_woreda_id AND status = 'reversed'),
    (SELECT count(*)::bigint FROM public.payment_reconciliation_exception
      WHERE woreda_id = v_woreda_id AND status IN ('open', 'under_review')),
    (SELECT COALESCE(SUM(received_amount), 0) FROM public.payment_reconciliation_exception
      WHERE woreda_id = v_woreda_id AND status IN ('open', 'under_review'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_rental_reconciliation_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rental_reconciliation_report() TO authenticated, service_role;

-- ============================================================================
-- 7. Extend the security_invoker regression assertion to this migration's
--    one new decrypted view.
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
    'rent_reminder_decrypted', 'arrears_repayment_plan_decrypted',
    'service_request_checkpoint_decrypted'
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
