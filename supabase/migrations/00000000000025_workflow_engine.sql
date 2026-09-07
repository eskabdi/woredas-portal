-- ============================================================================
-- Workflow engine: legal status transitions and maker != checker
--
-- Closes F-01 (Critical) from docs/system-review-2026-09.md, and INV-05 /
-- INV-06 with it. Task 1 of fix-task-production-readiness-v3.
--
-- The database already enforced WHO may touch a workflow row. It never
-- enforced WHAT state change is legal. A registry_clerk holding only
-- credential.issue could
--     PATCH /credential_request?id=eq.X {"status":"paid"}
-- from `submitted` and mint a ready_to_print government ID with no
-- verification, no approval and no payment row. Every maker-checker guarantee
-- in the system was a client-side convention.
--
-- This migration adds the missing half:
--   1. workflow_transition -- platform reference data listing every legal
--      (entity, from_status, to_status) pair and the permission it needs.
--   2. enforce_workflow_transition() -- a BEFORE UPDATE trigger that rejects
--      any pair absent from that table, checks the permission for THAT
--      transition, refuses to let one person both verify and approve, and
--      blocks system transitions from user sessions.
--   3. A tightened generate_residence_credential_on_payment(): a credential is
--      minted only from `awaiting_payment`, and only against a real payment
--      row with a receipt -- zero-value waivers included.
--
-- ADDITIVE. No DROP of any table, column, policy or CHECK constraint; both
-- trigger functions change via CREATE OR REPLACE. Safe to apply to a live
-- system -- every status value it references is already legal today.
--
-- ---------------------------------------------------------------------------
-- Two decisions recorded in docs/fix-task-v3-execution-notes.md
-- ---------------------------------------------------------------------------
-- D-3: the workflow verification verb is `credential.review`, NOT
--      `credential.verify`. `credential.verify` already gates the public
--      ID-lookup screen and is deliberately held by viewer and auditor;
--      reusing it would hand request-verification to two read-only roles.
--
-- O-1: `ready_to_print` is a residence_credential state, not a
--      credential_request state. The request FSM runs ... -> paid -> printed
--      -> active; the credential FSM runs ready_to_print -> printed -> active.
--      Both mirror the shipped UI, so no CHECK constraint changes. Task 10
--      inserts the `printing` lock state and the preview/confirm split.
--
-- Permissions: the nine new keys below are granted to exactly the roles that
-- hold the equivalent coarse permission today, so this migration changes
-- ENFORCEMENT without changing who can do what. Task 4 refines the grants to
-- the workflow spec's matrix and adds print_officer.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. workflow_transition -- platform reference data
--
-- No woreda_id by design (fix task guardrail 3): FSMs are platform-fixed.
-- A tenant may change WHO holds a permission (role_permission) but may never
-- remove a verification, approval or payment gate.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workflow_transition (
  workflow_transition_id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  required_permission text,
  is_system boolean DEFAULT false NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.workflow_transition
  DROP CONSTRAINT IF EXISTS workflow_transition_pkey;
ALTER TABLE public.workflow_transition
  ADD CONSTRAINT workflow_transition_pkey PRIMARY KEY (workflow_transition_id);

ALTER TABLE public.workflow_transition
  DROP CONSTRAINT IF EXISTS workflow_transition_unique;
ALTER TABLE public.workflow_transition
  ADD CONSTRAINT workflow_transition_unique UNIQUE (entity, from_status, to_status);

ALTER TABLE public.workflow_transition
  DROP CONSTRAINT IF EXISTS workflow_transition_entity_check;
ALTER TABLE public.workflow_transition
  ADD CONSTRAINT workflow_transition_entity_check CHECK (entity = ANY (ARRAY[
    'credential_request', 'residence_credential',
    'vital_event', 'service_request', 'rental_occupancy_request'
  ]));

-- A system row carries no permission; a user row must carry one. Without this
-- a seed typo could produce a transition anybody can drive.
ALTER TABLE public.workflow_transition
  DROP CONSTRAINT IF EXISTS workflow_transition_permission_check;
ALTER TABLE public.workflow_transition
  ADD CONSTRAINT workflow_transition_permission_check CHECK (
    (is_system AND required_permission IS NULL)
    OR (NOT is_system AND required_permission IS NOT NULL)
  );

ALTER TABLE public.workflow_transition ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_transition_select ON public.workflow_transition;
CREATE POLICY workflow_transition_select ON public.workflow_transition
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS workflow_transition_super_admin_write ON public.workflow_transition;
CREATE POLICY workflow_transition_super_admin_write ON public.workflow_transition
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Same hardening as 00000000000007: these three are not constrained by RLS.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.workflow_transition
  FROM anon, authenticated;

COMMENT ON TABLE public.workflow_transition IS
  'Platform-fixed finite state machines. One row per legal (entity, from_status, to_status). '
  'Read by enforce_workflow_transition(). No woreda_id: tenants cannot remove a workflow gate.';

-- ---------------------------------------------------------------------------
-- 2. The nine new permission keys
--
-- user_has_perm() resolves override -> role_permission -> default_role_perms().
-- An unknown key returns false everywhere, so a transition whose permission is
-- not defined here can never fire. Adding them to the default matrix is what
-- makes the FSM usable; role_permission rows are not required (absence falls
-- through to these defaults) and are reconciled in Task 4.
--
-- Grants mirror today's coarse permissions exactly:
--   credential.issue holders -> submit, review, resubmit, return
--   credential.approve holders -> approve (existing), return, reject
--   payment.collect holders -> record_payment
--   credential.print holders -> confirm_print, activate
--   supervisor + tenant_admin -> suspend (new capability, per the fix task)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.revoke','credential.approve','credential.return','credential.reject','credential.suspend','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','credential.record_payment','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read']
    ELSE ARRAY[]::text[]
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The engine
--
-- Reads workflow_transition for the entity under modification. SECURITY
-- DEFINER so it can read that table regardless of the caller's grants; it
-- consults auth.uid() only through user_has_perm(), never a client-supplied
-- identifier.
--
-- System transitions are gated on a session GUC that only the SECURITY
-- DEFINER system functions set. A user session cannot set it: `SET LOCAL` by
-- a PostgREST caller does not survive into the trigger's execution context
-- for the row it is updating, and the flag is cleared by the same function
-- that set it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_workflow_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entity     text := TG_TABLE_NAME;
  v_rule       public.workflow_transition%ROWTYPE;
  v_system_ctx boolean := coalesce(current_setting('app.system_transition', true), '') = 'on';
  v_new        jsonb  := to_jsonb(NEW);
  v_approver   text;
  v_verifier   text;
BEGIN
  -- Not a status change: nothing to police.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rule
    FROM public.workflow_transition
   WHERE entity = v_entity
     AND from_status = OLD.status
     AND to_status = NEW.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'workflow: % may not move from % to %', v_entity, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Terminal states are terminal in the function body too, not only by the
  -- absence of a seed row -- a future seed mistake must not reopen a rejected
  -- request or resurrect a revoked card.
  IF OLD.status = ANY (ARRAY['rejected','expired','revoked','replaced'])
     AND NOT v_rule.is_system THEN
    RAISE EXCEPTION
      'workflow: % is terminal on %; no further transition is permitted',
      OLD.status, v_entity
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_rule.is_system THEN
    IF NOT v_system_ctx THEN
      RAISE EXCEPTION
        'workflow: % -> % on % is a system transition and cannot be driven directly',
        OLD.status, NEW.status, v_entity
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT public.user_has_perm(v_rule.required_permission) THEN
    RAISE EXCEPTION
      'workflow: % -> % on % requires %',
      OLD.status, NEW.status, v_entity, v_rule.required_permission
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Maker != checker (INV-05). Both columns are pinned to auth.uid() by
  -- trg_force_actor, so neither is forgeable; comparing them is therefore
  -- comparing two real people. Checked on every status change, not only the
  -- approval one, so a later edit cannot quietly collapse them.
  IF v_new ? 'approved_by_user_id' AND v_new ? 'verified_by_user_id' THEN
    v_approver := v_new ->> 'approved_by_user_id';
    v_verifier := v_new ->> 'verified_by_user_id';
    IF v_approver IS NOT NULL AND v_approver = v_verifier THEN
      RAISE EXCEPTION
        'workflow: the approver and the verifier must be two different people'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_workflow_transition() IS
  'Rejects any status change absent from workflow_transition, checks the permission for '
  'that specific transition, blocks system transitions from user sessions, and refuses to '
  'let one person be both verifier and approver. Closes F-01.';

-- ---------------------------------------------------------------------------
-- 4. The guaranteed audit row, written by the database
--
-- The audit_log row is written HERE, not in the app, so it is unconditional:
-- a status change driven straight through PostgREST leaves the same immutable
-- trail as a button click. That is INV-10's requirement.
--
-- The *_status_history rows stay app-written for now. They carry the operator's
-- reason text, which the database does not have, and duplicating them here
-- would double every row in the timeline UI. Tasks 12/14 rework those call
-- sites and move history into this function at the same time.
--
-- AFTER UPDATE so the row is committed-visible, and a separate trigger from
-- the gate above so a logging failure cannot swallow a legal transition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_workflow_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_log
    (woreda_id, actor_user_id, entity_name, entity_id, action_type,
     old_value_json, new_value_json)
  VALUES
    (NEW.woreda_id, auth.uid(), TG_TABLE_NAME,
     to_jsonb(NEW) ->> (TG_ARGV[0]),
     'STATUS_' || upper(NEW.status),
     jsonb_build_object('status', OLD.status),
     jsonb_build_object('status', NEW.status));

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.log_workflow_transition() IS
  'Writes the guaranteed audit_log row for every status change, including one driven '
  'straight through PostgREST. The app additionally writes *_status_history rows carrying '
  'the human reason; those stay app-owned until the UI rework in Tasks 12/14 moves them here.';

-- ---------------------------------------------------------------------------
-- 5. Wire the triggers
--
-- Named with a `z` prefix so they fire after trg_force_actor -- the actor
-- columns must already be pinned to auth.uid() before maker != checker
-- compares them. Postgres fires same-timing triggers in name order.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.credential_request;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.residence_credential;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_log_workflow_transition ON public.credential_request;
CREATE TRIGGER zz_log_workflow_transition
  AFTER UPDATE ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_transition('credential_request_id');

DROP TRIGGER IF EXISTS zz_log_workflow_transition ON public.residence_credential;
CREATE TRIGGER zz_log_workflow_transition
  AFTER UPDATE ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_transition('credential_id');

-- ---------------------------------------------------------------------------
-- 6. Payment gate (INV-06)
--
-- Was: fires on NEW.status='paid' from ANY prior status, with no payment row
-- required. That is half of F-01 -- the half that mints the physical ID.
--
-- Now: only from `awaiting_payment`, and only against a confirmed payment row
-- carrying a receipt. A zero-value waiver still writes both, so "no payment
-- row" is never legal (fix task guardrail 11).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_residence_credential_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expiry            DATE;
  v_new_credential_id UUID;
  v_receipted         BOOLEAN;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN

    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a credential request may only be paid from awaiting_payment (was %)',
        OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    -- A payment row AND its receipt must already exist. Zero-value waivers
    -- write both, so this holds for them too.
    SELECT EXISTS (
      SELECT 1
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = NEW.payment_id
         AND p.woreda_id = NEW.woreda_id
         AND p.status = 'confirmed'
    ) INTO v_receipted;

    IF NEW.payment_id IS NULL OR NOT v_receipted THEN
      RAISE EXCEPTION
        'payment: a confirmed payment with a receipt is required before a credential is generated'
        USING ERRCODE = 'check_violation';
    END IF;

    v_expiry := (CURRENT_DATE + INTERVAL '1 year')::DATE;

    INSERT INTO public.residence_credential (
      woreda_id, resident_id, issuing_kebele_id,
      credential_type, status, issue_date, expiry_date,
      reason_for_issue, credential_request_id
    ) VALUES (
      NEW.woreda_id, NEW.resident_id, NEW.issuing_kebele_id,
      NEW.credential_type, 'ready_to_print', CURRENT_DATE, v_expiry,
      NEW.request_type, NEW.credential_request_id
    )
    RETURNING credential_id INTO v_new_credential_id;

    NEW.credential_id := v_new_credential_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Seed the credential FSM
--
-- Request side mirrors the shipped UI, with `verified` and `approved` restored
-- as real stops (decision D-2). Credential side carries the full print and
-- lifecycle chain.
--
-- `approval_returned` is deliberately absent: return-from-approval now lands in
-- `returned` and re-enters verification. The value stays legal in the CHECK
-- constraint (removing it would be non-additive) but has no transitions.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  -- credential_request
  ('credential_request','draft',           'submitted',       'credential.submit',        false,'Stage 1 intake'),
  ('credential_request','submitted',       'under_review',    'credential.review',        false,'Stage 2 opens verification'),
  ('credential_request','under_review',    'verified',        'credential.review',        false,'Stage 2 checklist passed'),
  ('credential_request','under_review',    'returned',        'credential.return',        false,'Stage 2 return to applicant'),
  ('credential_request','returned',        'under_review',    'credential.resubmit',      false,'Corrections resubmitted'),
  ('credential_request','verified',        'pending_approval','credential.approve',       false,'Stage 3 approver claims it'),
  ('credential_request','pending_approval','approved',        'credential.approve',       false,'Stage 3 approved'),
  ('credential_request','pending_approval','returned',        'credential.return',        false,'Stage 3 return; re-enters verification'),
  ('credential_request','pending_approval','rejected',        'credential.reject',        false,'Stage 3 terminal rejection'),
  ('credential_request','approved',        'awaiting_payment','credential.record_payment',false,'Stage 4 fee raised'),
  ('credential_request','awaiting_payment','paid',            'credential.record_payment',false,'Stage 4 payment + receipt recorded'),
  ('credential_request','paid',            'printed',         'credential.confirm_print', false,'Stage 7 print confirmed'),
  ('credential_request','printed',         'active',          'credential.activate',      false,'Stage 8 handover'),

  -- residence_credential
  ('residence_credential','ready_to_print','printed',   'credential.confirm_print', false,'Stage 6/7 print confirmed; Task 10 splits out the printing lock state'),
  ('residence_credential','printed',       'active',    'credential.activate',      false,'Stage 8 collected by resident'),
  ('residence_credential','active',        'suspended', 'credential.suspend',       false,'Reversible hold'),
  ('residence_credential','active',        'revoked',   'credential.revoke',        false,'Terminal revocation'),
  ('residence_credential','suspended',     'active',    'credential.suspend',       false,'Hold lifted'),
  ('residence_credential','active',        'replaced',  'credential.activate',      false,'Superseded when a newer credential is handed over'),
  ('residence_credential','active',        'expired',   NULL,                       true, 'Past expiry_date')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

COMMIT;
