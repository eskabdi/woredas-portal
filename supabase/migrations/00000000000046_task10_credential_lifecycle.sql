-- Task 10 (fix-task-production-readiness-v3): credential lifecycle hardening.
-- Builds directly on Task 1's workflow engine (00000000000025/026), which
-- already seeded the residence_credential FSM (including the `printing`
-- lock state) and left this task's own header comment pointing at exactly
-- what was still open: "Task 10 inserts the `printing` lock state and the
-- preview/confirm split" (done in 025) "-- this migration closes the rest:
-- number immutability, a real print-eligibility gate, a guaranteed
-- print-log row on confirm, reprint authorization, one-transaction
-- activation with the one-active-credential invariant enforced by an
-- index, and a tenant_admin-only, reason-required revocation.
--
-- ADDITIVE except item 6 (permissions.ts + default_role_perms() no longer
-- grant credential.revoke to supervisor -- see that section for why this
-- is not a guardrail-1 violation: narrowing a compiled DEFAULT is not the
-- same as narrowing a CHECK constraint or dropping a column). The next
-- migration (00000000000047) is the one that actually force-revokes the
-- already-materialized role_permission rows and the matching seed.sql
-- rows -- this file only changes what a fresh/reset cell resolves to.
--
-- ---------------------------------------------------------------------------
-- 1. credential_number / serial_number / qr_payload are immutable once set.
--
-- These are the values printed on a physical card and embedded in its QR/
-- barcode. A later UPDATE that changed any of them would desynchronize the
-- card in the resident's hand from what the database (and every prior
-- verification) says it is -- silently, since nothing currently stops it.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.pin_credential_identity_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.credential_number IS NOT NULL
     AND NEW.credential_number IS DISTINCT FROM OLD.credential_number THEN
    RAISE EXCEPTION 'residence_credential.credential_number cannot be changed once assigned';
  END IF;
  IF OLD.serial_number IS NOT NULL
     AND NEW.serial_number IS DISTINCT FROM OLD.serial_number THEN
    RAISE EXCEPTION 'residence_credential.serial_number cannot be changed once assigned';
  END IF;
  IF OLD.qr_payload IS NOT NULL
     AND NEW.qr_payload IS DISTINCT FROM OLD.qr_payload THEN
    RAISE EXCEPTION 'residence_credential.qr_payload cannot be changed once assigned';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS residence_credential_pin_identity ON public.residence_credential;
CREATE TRIGGER residence_credential_pin_identity
  BEFORE UPDATE ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.pin_credential_identity_fields();

-- ---------------------------------------------------------------------------
-- 2. Print-eligibility gate on ready_to_print -> printing.
--
-- Today that transition only checks the caller holds credential.preview_print
-- (00000000000025). Nothing re-verifies that the chain of events that was
-- supposed to happen before printing actually did: a confirmed, receipted
-- payment against this credential's own request, and a resident who is
-- still active (not deceased or moved out since the request was approved).
-- Each failure raises its OWN specific reason, per this task's own
-- requirement, rather than one generic "not eligible" message.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_credential_print_eligibility(_credential_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rc public.residence_credential%ROWTYPE;
  v_request_status text;
  v_resident_status text;
  v_resident_active boolean;
BEGIN
  SELECT * INTO v_rc FROM public.residence_credential WHERE credential_id = _credential_id;

  IF v_rc.credential_request_id IS NULL THEN
    RAISE EXCEPTION 'print gate: credential has no linked request to verify payment against'
      USING ERRCODE = 'check_violation';
  END IF;

  -- History check: the source request must itself show it reached (or
  -- passed) the paid stage -- a request that was later returned/rejected
  -- after this credential row was created must not still be printable.
  SELECT status INTO v_request_status
    FROM public.credential_request WHERE credential_request_id = v_rc.credential_request_id;
  IF v_request_status IS NULL OR v_request_status NOT IN ('paid', 'printed', 'active') THEN
    RAISE EXCEPTION 'print gate: the linked request is not at or past the paid stage (currently %)',
      v_request_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Payment check: a confirmed, non-reversed payment must exist for this request.
  IF NOT EXISTS (
    SELECT 1 FROM public.payment p
     WHERE p.credential_request_id = v_rc.credential_request_id AND p.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'print gate: no confirmed payment found for this request'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Receipt check: the confirmed payment must have a receipt on file.
  IF NOT EXISTS (
    SELECT 1 FROM public.payment p
     JOIN public.receipt r ON r.payment_id = p.payment_id
     WHERE p.credential_request_id = v_rc.credential_request_id AND p.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'print gate: no receipt found for the confirmed payment'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Resident check: still active, not deceased/moved since approval.
  SELECT residency_status, active_flag INTO v_resident_status, v_resident_active
    FROM public.resident WHERE resident_id = v_rc.resident_id;
  IF v_resident_status IS DISTINCT FROM 'active' OR v_resident_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'print gate: resident is no longer active (status: %)', v_resident_status
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3 & 5. Extend the workflow engine itself with everything above plus the
-- guaranteed print-log row and the one-transaction activation handover.
-- CREATE OR REPLACE of an existing SECURITY DEFINER function -- no DROP.
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

  -- Task 10, item 2: the print-eligibility gate, on the one transition that
  -- actually sends a card to the printer.
  IF v_entity = 'residence_credential'
     AND OLD.status = 'ready_to_print' AND NEW.status = 'printing' THEN
    PERFORM public.check_credential_print_eligibility(NEW.credential_id);
  END IF;

  -- Task 10, item 6: revocation requires a reason and is tenant_admin-only.
  -- The tenant_admin-only half comes from the permission check just above
  -- ("Effective 2026-07": user_has_perm() against credential.revoke), which
  -- resolves correctly only once credential.revoke is actually narrowed to
  -- tenant_admin at every layer -- the compiled default (this migration),
  -- the already-materialized role_permission rows and seed.sql
  -- (00000000000047), and the matrix/override reassignment path
  -- (RESERVED_PERMISSION_KEYS, already locked since
  -- 00000000000037_task13_expand_reserved_keys.sql). This block only adds
  -- the reason requirement, which no permission check can express.
  IF v_entity = 'residence_credential' AND NEW.status = 'revoked' THEN
    IF NEW.revoked_reason IS NULL OR btrim(NEW.revoked_reason) = '' THEN
      RAISE EXCEPTION 'workflow: revoking a credential requires a reason'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Task 10, item 7: suspend and reactivate both require a reason, using
  -- the same NEW.suspended_reason column for whichever direction is
  -- happening -- entering suspension records why it was imposed, and lifting
  -- it (overwriting the same column) records why it was lifted. One column
  -- rather than two keeps "the reason for the current/most recent hold
  -- action" in a single, easy-to-audit place; credential_status_history
  -- (app-written) still carries the full timeline either way.
  IF v_entity = 'residence_credential'
     AND (NEW.status = 'suspended' OR (OLD.status = 'suspended' AND NEW.status = 'active')) THEN
    IF NEW.suspended_reason IS NULL OR btrim(NEW.suspended_reason) = '' THEN
      RAISE EXCEPTION 'workflow: % requires a reason', OLD.status || ' -> ' || NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Task 10, item 3: printing -> printed writes the guaranteed print-log
  -- row in the SAME transaction as the confirm, independent of whether the
  -- client also writes one. This is the row of record for "who confirmed
  -- this card printed and when" -- unlike the client's own pre-print log
  -- entry (written at ready_to_print -> printing, before anything is known
  -- to have actually come out of the printer correctly).
  IF v_entity = 'residence_credential'
     AND OLD.status = 'printing' AND NEW.status = 'printed' THEN
    INSERT INTO public.credential_print_log
      (woreda_id, credential_id, printed_by_user_id, print_type, print_reason, is_reprint)
    VALUES
      (NEW.woreda_id, NEW.credential_id, auth.uid(), NEW.credential_type, 'confirm_print', false);
  END IF;

  -- Task 10, item 5: activation is a one-transaction handover. Superseding
  -- the resident's prior card is a GUARANTEED consequence of this credential
  -- reaching `active`, not a separate client-driven step that can partially
  -- fail -- see the comment on residence_credential_one_active_per_resident
  -- below for the index that backstops this even if this trigger logic is
  -- ever wrong.
  IF v_entity = 'residence_credential'
     AND OLD.status = 'printed' AND NEW.status = 'active' THEN
    DECLARE
      v_prior public.residence_credential%ROWTYPE;
    BEGIN
      SELECT * INTO v_prior FROM public.residence_credential
       WHERE resident_id = NEW.resident_id
         AND woreda_id = NEW.woreda_id
         AND credential_id <> NEW.credential_id
         AND status = 'active'
       LIMIT 1;

      IF FOUND THEN
        UPDATE public.residence_credential
           SET status = 'replaced', replaced_at = now(), revoked_at = now()
         WHERE credential_id = v_prior.credential_id;

        INSERT INTO public.credential_status_history
          (credential_id, old_status, new_status, changed_by_user_id, change_reason)
        VALUES
          (v_prior.credential_id, 'active', 'replaced', auth.uid(),
           'Superseded by ' || NEW.credential_number);

        INSERT INTO public.audit_log
          (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
        VALUES
          (NEW.woreda_id, auth.uid(), 'residence_credential', v_prior.credential_id::text,
           'CREDENTIAL_REPLACED', jsonb_build_object('replaced_by', NEW.credential_id));
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Reprint authorization -- credential_print_log's own INSERT policy.
--
-- Confirm-print's own row is now written by the trigger above (SECURITY
-- DEFINER, bypasses RLS) -- a client-side confirm-print insert is no longer
-- expected and this policy no longer needs to allow one. A REPRINT (of an
-- already `printed`/`active` card, which drives no status transition for a
-- trigger to hook into) still has to be a direct client INSERT, so this is
-- the one enforcement point for it: credential.authorize_reprint, a
-- non-empty reason, and the target credential must actually be past initial
-- printing -- reprinting something still at ready_to_print/printing makes no
-- sense (that is what confirm/retry are for).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS credential_print_log_insert ON public.credential_print_log;
CREATE POLICY credential_print_log_insert ON public.credential_print_log
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      woreda_id = get_user_woreda_id()
      AND is_reprint = true
      AND reprint_reason IS NOT NULL AND btrim(reprint_reason) <> ''
      AND user_has_any_perm('{credential.authorize_reprint}'::text[])
      AND EXISTS (
        SELECT 1 FROM public.residence_credential rc
         WHERE rc.credential_id = credential_print_log.credential_id
           AND rc.status IN ('printed', 'active')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5 (continued). One active credential per resident -- backstops the
-- activation trigger above with a real constraint, not just trigger logic.
-- Partial unique index: only rows actually at `active` are constrained, so
-- every other status (including the many `replaced`/`revoked` rows a
-- resident accumulates over time) is unaffected.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS residence_credential_one_active_per_resident
  ON public.residence_credential (resident_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 7 (continued). suspended_reason column, mirroring revoked_reason's shape.
-- ---------------------------------------------------------------------------

ALTER TABLE public.residence_credential
  ADD COLUMN IF NOT EXISTS suspended_reason text;

COMMIT;
