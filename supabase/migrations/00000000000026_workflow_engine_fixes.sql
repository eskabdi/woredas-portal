-- ---------------------------------------------------------------------------
-- 00000000000026_workflow_engine_fixes.sql
--
-- Follow-up to 00000000000025_workflow_engine.sql, closing findings raised by
-- the post-merge code review of Task 1. Migration 25 was merged to main but had
-- NOT been applied to any database when these were found, so this corrects it
-- forward rather than editing an applied migration.
--
--   1. approval_queue_v never learned about the two resting stops the new FSM
--      introduces. handlePass parks a request at `verified` and handleApprove
--      at `approved`; neither was in the view's credential-arm filter, so both
--      work items vanished from /woreda/approvals -- the single inbox the
--      approver and the finance clerk actually work from.
--
--   2. enforce_workflow_transition()'s append-only actor guard covered
--      verified_by_user_id and approved_by_user_id but NOT revoked_by_user_id,
--      the column migration 25 itself newly pinned with trg_force_actor.
--      force_actor_columns() only overwrites a non-NULL incoming value, so a
--      status-preserving PATCH sending an explicit null erased the record of
--      who ordered a revocation while the revocation stayed in force.
--
--   3. default_role_perms() listed 'credential.preview_print' twice for
--      tenant_admin, civil_registrar and registry_clerk. Harmless at runtime
--      but invisible to scripts/check-role-perms-drift.ts, which compares Sets.
--
--   4. The transition trigger ran on EVERY update of both tables, serializing
--      both row versions to jsonb before its own early return. It now carries a
--      WHEN clause so non-status writes skip it entirely.
--
--   5. `approval_returned` was retired with no exit, so a row reaching it would
--      be frozen with no path out for any role, super_admin included. Nothing
--      writes it any more and the live project holds zero such rows; this seeds
--      one recovery transition so the value cannot become a trap.
--
-- Corrects the record on migration 25's own header, which claimed "No DROP of
-- any table, column, policy or CHECK constraint" while its section 2 does drop
-- and re-add residence_credential_status_check and drops two policies before
-- recreating them. That was safe (the new CHECK is a strict superset, so
-- revalidation cannot fail) but the blanket claim was not accurate, and a
-- later author trusting the same header pattern for a narrowing change would
-- be misled.
--
-- This file is ADDITIVE with three deliberate, stateless exceptions:
-- CREATE OR REPLACE VIEW on approval_queue_v (a view holds no data),
-- DROP/CREATE of the two zz_ triggers to attach a WHEN clause (a trigger
-- definition holds no state), and CREATE OR REPLACE of two functions. No
-- table, column or CHECK constraint is dropped.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. approval_queue_v -- add `verified` and `approved` to the credential arm
--
-- The body below is the baseline definition copied verbatim; ONLY the
-- credential arm's WHERE array differs. All four arms (service, credential,
-- civil, rental) are reproduced because CREATE OR REPLACE VIEW replaces the
-- whole definition -- dropping an arm here would silently empty that module's
-- half of the unified approval inbox.
--
-- `WITH (security_invoker = on)` is LOAD-BEARING and must never be dropped from
-- this statement. CREATE OR REPLACE VIEW does not preserve the option: replacing
-- the view without restating it resets reloptions to NULL (verified against this
-- project). This view is owned by `postgres`, which carries rolbypassrls, and is
-- GRANTed to `anon` -- so without security_invoker it stops applying the
-- underlying tables' RLS and every woreda's service requests, credential
-- requests, vital events and rental occupancy requests become readable by an
-- unauthenticated caller. 00000000000006_view_security_invoker.sql exists
-- because this project already lost the option once, the same way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.approval_queue_v WITH (security_invoker = on) AS
 SELECT 'service'::text AS work_type,
    sr.service_request_id AS item_id,
    sr.request_number AS reference_number,
    sr.status AS stage,
    sr.woreda_id,
    sr.kebele_id,
    sr.resident_id,
    sr.priority,
    st.name_am AS subtype_am,
    st.name_en AS subtype_en,
    sr.requested_by_user_id,
    sr.created_at,
    sr.updated_at
   FROM service_request sr
     JOIN service_type st ON st.service_type_id = sr.service_type_id
  WHERE sr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'awaiting_payment'::text, 'returned'::text, 'approval_returned'::text, 'in_progress'::text])
UNION ALL
 SELECT 'credential'::text AS work_type,
    cr.credential_request_id AS item_id,
    cr.request_number AS reference_number,
    cr.status AS stage,
    cr.woreda_id,
    cr.issuing_kebele_id AS kebele_id,
    cr.resident_id,
    'normal'::text AS priority,
    cr.credential_type AS subtype_am,
    cr.credential_type AS subtype_en,
    cr.requested_by_user_id,
    cr.created_at,
    cr.updated_at
   FROM credential_request cr
  WHERE cr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'approved'::text, 'awaiting_payment'::text, 'returned'::text, 'approval_returned'::text, 'ready_to_print'::text])
UNION ALL
 SELECT 'civil'::text AS work_type,
    ve.vital_event_id AS item_id,
    ve.event_number AS reference_number,
    ve.status AS stage,
    ve.woreda_id,
    NULL::uuid AS kebele_id,
    ve.resident_id,
    'normal'::text AS priority,
    ve.event_type AS subtype_am,
    ve.event_type AS subtype_en,
    ve.requested_by_user_id,
    ve.created_at,
    ve.updated_at
   FROM vital_event ve
  WHERE ve.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'returned'::text, 'approval_returned'::text])
UNION ALL
 SELECT 'rental'::text AS work_type,
    ror.rental_request_id AS item_id,
    ror.request_number AS reference_number,
    ror.status AS stage,
    ror.woreda_id,
    krh.kebele_id,
    ror.resident_id,
    'normal'::text AS priority,
    ror.request_type AS subtype_am,
    ror.request_type AS subtype_en,
    ror.requested_by_user_id,
    ror.created_at,
    ror.updated_at
   FROM rental_occupancy_request ror
     LEFT JOIN kebele_rental_house krh ON krh.rental_house_id = ror.rental_house_id
  WHERE ror.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'returned'::text, 'awaiting_payment'::text]);

-- Fail the migration rather than commit a view that silently stopped applying
-- RLS. This assertion is cheap and it is the only thing standing between a
-- future CREATE OR REPLACE that forgets the WITH clause and a full cross-tenant
-- disclosure through a view that anon can read.
DO $sec$
DECLARE opts text[];
BEGIN
  SELECT c.reloptions INTO opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'approval_queue_v';
  IF opts IS NULL OR NOT ('security_invoker=on' = ANY (opts)) THEN
    RAISE EXCEPTION
      'approval_queue_v lost security_invoker -- it is owned by a rolbypassrls role and granted to anon, so this would expose every tenant''s rows. Restore WITH (security_invoker = on).';
  END IF;
END $sec$;

GRANT SELECT ON public.approval_queue_v TO anon;
GRANT SELECT ON public.approval_queue_v TO authenticated;
GRANT SELECT ON public.approval_queue_v TO service_role;

-- ---------------------------------------------------------------------------
-- 2. enforce_workflow_transition() -- revoked_by_user_id is append-only too
--
-- Reproduced from migration 25 with one added guard (marked in the body).
-- CREATE OR REPLACE, so no trigger needs re-pointing.
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
  v_old        jsonb  := to_jsonb(OLD);
  v_approver   text;
  v_verifier   text;
BEGIN
  -- ----------------------------------------------------------------------
  -- Actor columns are append-only. Checked BEFORE the status-change guard
  -- below, because the bypass this closes is a status-PRESERVING update that
  -- nulls verified_by_user_id and then approves cleanly on a second call.
  -- force_actor_columns() only overwrites a non-null incoming value, so a
  -- caller omitting or nulling the column is not otherwise policed.
  -- ----------------------------------------------------------------------
  IF v_new ? 'verified_by_user_id'
     AND (v_old ->> 'verified_by_user_id') IS NOT NULL
     AND (v_new ->> 'verified_by_user_id') IS NULL THEN
    RAISE EXCEPTION
      'workflow: verified_by_user_id cannot be cleared once recorded'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_new ? 'approved_by_user_id'
     AND (v_old ->> 'approved_by_user_id') IS NOT NULL
     AND (v_new ->> 'approved_by_user_id') IS NULL THEN
    RAISE EXCEPTION
      'workflow: approved_by_user_id cannot be cleared once recorded'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- revoked_by_user_id is append-only for the same reason. Migration 25 pinned
  -- this column with trg_force_actor but left it out of the clearing guard --
  -- and force_actor_columns() only overwrites a NON-NULL incoming value, so an
  -- explicit null passed straight through. A status-preserving PATCH could
  -- therefore erase who ordered a revocation while the revocation stood.
  IF v_new ? 'revoked_by_user_id'
     AND (v_old ->> 'revoked_by_user_id') IS NOT NULL
     AND (v_new ->> 'revoked_by_user_id') IS NULL THEN
    RAISE EXCEPTION
      'workflow: revoked_by_user_id cannot be cleared once recorded'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Not a status change: nothing further to police.
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

  -- ----------------------------------------------------------------------
  -- Maker != checker (INV-05), enforced on the transition INTO `approved`.
  --
  -- Scoping it to that one transition rather than every status change is
  -- deliberate: requests approved before this migration existed were never
  -- subject to the rule, and freezing them mid-flight would strand real work
  -- with no remediation path. New approvals carry the full check.
  --
  -- Both columns are pinned to auth.uid() by trg_force_actor, so neither is
  -- forgeable; requiring both to be present closes the "omit the column and
  -- let NULL short-circuit the comparison" bypass.
  -- ----------------------------------------------------------------------
  IF NEW.status = 'approved'
     AND v_new ? 'approved_by_user_id' AND v_new ? 'verified_by_user_id' THEN
    v_approver := v_new ->> 'approved_by_user_id';
    v_verifier := v_new ->> 'verified_by_user_id';

    IF v_approver IS NULL THEN
      RAISE EXCEPTION
        'workflow: an approval must record the approver'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_verifier IS NULL THEN
      RAISE EXCEPTION
        'workflow: an approval requires a recorded verifier'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_approver = v_verifier THEN
      RAISE EXCEPTION
        'workflow: the approver and the verifier must be two different people'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ----------------------------------------------------------------------
  -- `replaced` is a CONSEQUENCE of handing over a newer card, never a verb of
  -- its own. Without this, any holder of credential.activate -- registry_clerk
  -- included -- could PATCH an active card to `replaced` and permanently void
  -- a government ID, reaching the revocation outcome without credential.revoke.
  -- ----------------------------------------------------------------------
  IF v_entity = 'residence_credential' AND NEW.status = 'replaced' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.residence_credential rc
       WHERE rc.resident_id = NEW.resident_id
         AND rc.woreda_id   = NEW.woreda_id
         AND rc.credential_id <> NEW.credential_id
         AND rc.status IN ('printed', 'active')
         AND rc.created_at > NEW.created_at
    ) THEN
      RAISE EXCEPTION
        'workflow: a credential may only be replaced once its successor has been issued'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. default_role_perms() -- drop the duplicated 'credential.preview_print'
--
-- Listed twice for tenant_admin, civil_registrar and registry_clerk. The
-- resolver de-duplicates so nothing is broken at runtime, but
-- scripts/check-role-perms-drift.ts compares Sets and is structurally blind to
-- it, which makes the compiled authorization matrix disagree with itself
-- without CI noticing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.preview_print','credential.confirm_print','credential.activate','credential.suspend','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.revoke','credential.approve','credential.return','credential.reject','credential.suspend','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','credential.submit','credential.review','credential.resubmit','credential.return','credential.preview_print','credential.confirm_print','credential.activate','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.submit','credential.review','credential.resubmit','credential.return','credential.preview_print','credential.confirm_print','credential.activate','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','credential.record_payment','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read']
    ELSE ARRAY[]::text[]
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Re-wire the transition triggers with a WHEN clause
--
-- enforce_workflow_transition() computes to_jsonb(NEW) and to_jsonb(OLD) at
-- DECLARE time -- before its own "not a status change" early return -- so
-- every unrelated write to either table paid two full-row serializations for
-- nothing: sign-credential's qr_payload update, every verification-checklist
-- save, every updated_at touch. The WHEN clause below covers exactly the
-- columns the function polices, so enforcement is identical and the work is
-- skipped entirely otherwise.
--
-- residence_credential has no verified_by/approved_by columns, so its clause
-- names only the two that exist on it. Naming a column a table does not have
-- is a hard error at CREATE TRIGGER time, not a silent no-op.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.credential_request;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.credential_request
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.verified_by_user_id IS DISTINCT FROM NEW.verified_by_user_id
    OR OLD.approved_by_user_id IS DISTINCT FROM NEW.approved_by_user_id
  )
  EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.residence_credential;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.residence_credential
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.revoked_by_user_id IS DISTINCT FROM NEW.revoked_by_user_id
  )
  EXECUTE FUNCTION public.enforce_workflow_transition();

-- ---------------------------------------------------------------------------
-- 5. Give `approval_returned` an exit
--
-- Retired by migration 25 (return-from-approval now lands in `returned`) and
-- no longer written by any UI path, but the trigger rejects every unseeded
-- pair -- so a row that somehow reached it would be frozen for every role,
-- super_admin included, with the detail page rendering no actions. The live
-- project holds zero such rows today; this makes the value recoverable rather
-- than a trap, without resurrecting it as a destination (nothing transitions
-- INTO it).
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('credential_request','approval_returned','under_review','credential.resubmit',false,
   'Recovery only: `approval_returned` is retired and nothing transitions into it. This exit exists so a legacy or hand-written row cannot be permanently frozen.')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

COMMIT;
