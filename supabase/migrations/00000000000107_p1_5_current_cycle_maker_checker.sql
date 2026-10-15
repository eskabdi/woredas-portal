-- P1-5 (WP-WF-003): maker != checker compares the people acting in the
-- current cycle, not stale actor columns from before a return.
--
-- After a return, verified_by_user_id / approved_by_user_id kept the
-- previous cycle's values (they cannot be cleared, and force_actor_columns()
-- only re-pins a changed value), so the engine's approver != verifier check
-- compared the current approver with someone who may not have acted in this
-- cycle. Live data showed every approved credential request (5) and service
-- request (2) with one person as requester, verifier and approver.
--
-- enforce_workflow_transition() (CREATE OR REPLACE of its migration-106
-- body) now requires, from a user session, on the three generic-engine
-- tables:
--   * the verify step records the verifier as auth.uid(); credential and
--     civil verification also carries a checklist object whose reviewed_by
--     is auth.uid() (both screens already send it);
--   * the approval step records the approver as auth.uid(), who must differ
--     from the (now current) verifier and from the requester.
-- Two people still suffice: one makes and verifies, another approves.
-- The actor columns are not cleared on return -- the verify/approve steps
-- overwrite them, and the previous cycle stays in the history tables.

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

  -- P0-6: the category decides which FSM a row walks, so it is fixed at
  -- creation. Switching a letter to 'complaint' mid-flight would otherwise
  -- re-open the complaint edges that skip approval and payment.
  IF v_new ? 'category'
     AND (v_new ->> 'category') IS DISTINCT FROM (v_old ->> 'category') THEN
    RAISE EXCEPTION
      'workflow: % category cannot be changed once created', v_entity
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P0-6: a letter's issuance stamp is written only by the paid -> issued
  -- transition, and an issued letter's public content is frozen -- what
  -- verify_service_letter() shows must be what was approved and paid for.
  IF v_entity = 'service_request' THEN
    IF ((v_new ->> 'issued_at') IS DISTINCT FROM (v_old ->> 'issued_at')
        OR (v_new ->> 'issued_by_user_id') IS DISTINCT FROM (v_old ->> 'issued_by_user_id'))
       AND NOT (OLD.status = 'paid' AND NEW.status = 'issued') THEN
      RAISE EXCEPTION
        'workflow: issued_at / issued_by_user_id are set only by the paid -> issued transition'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (v_old ->> 'category') = 'letter'
       AND OLD.status IN ('issued', 'completed')
       AND (   (v_new ->> 'subject')            IS DISTINCT FROM (v_old ->> 'subject')
            OR (v_new ->> 'letter_summary')     IS DISTINCT FROM (v_old ->> 'letter_summary')
            OR (v_new ->> 'issued_letter_html') IS DISTINCT FROM (v_old ->> 'issued_letter_html')
            OR (v_new ->> 'purpose')            IS DISTINCT FROM (v_old ->> 'purpose')
            OR (v_new ->> 'addressed_to')       IS DISTINCT FROM (v_old ->> 'addressed_to')
            OR (v_new ->> 'resident_id')        IS DISTINCT FROM (v_old ->> 'resident_id')
            OR (v_new ->> 'applicant_name')     IS DISTINCT FROM (v_old ->> 'applicant_name')
            OR (v_new ->> 'service_type_id')    IS DISTINCT FROM (v_old ->> 'service_type_id')) THEN
      RAISE EXCEPTION
        'workflow: an issued letter''s content cannot be changed'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- P1-4: a registered death revokes every non-terminal credential of the
  -- deceased, whatever its stage. Only apply_death_on_approval() sets this
  -- transaction-local flag, around its own UPDATE, and it runs as the
  -- paid -> registered system transition: the person who recorded the
  -- payment does not hold credential.revoke (tenant_admin only), and
  -- printed/suspended/print-queue cards have no user revoke edge at all.
  IF v_entity = 'residence_credential'
     AND NEW.status = 'revoked'
     AND coalesce(current_setting('app.death_revocation', true), '') = 'on'
     AND OLD.status = ANY (ARRAY['ready_to_print','printing','printed','active','suspended']) THEN
    IF NEW.revoked_reason IS NULL OR btrim(NEW.revoked_reason) = '' THEN
      RAISE EXCEPTION 'workflow: revoking a credential requires a reason'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- P0-6: a rule with a category applies only to rows of that category
  -- (service_request letter vs complaint); NULL means every row. Tables
  -- without a category column only ever match NULL-category rules.
  SELECT * INTO v_rule
    FROM public.workflow_transition
   WHERE entity = v_entity
     AND from_status = OLD.status
     AND to_status = NEW.status
     AND (category IS NULL OR category = (v_new ->> 'category'));

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

  -- P1-4: a deceased resident's card can never become valid again --
  -- neither by lifting a suspension nor by handing over a printed card.
  IF v_entity = 'residence_credential'
     AND NEW.status = 'active'
     AND OLD.status = ANY (ARRAY['suspended','printed'])
     AND EXISTS (SELECT 1 FROM public.resident r
                  WHERE r.resident_id = NEW.resident_id
                    AND r.woreda_id = NEW.woreda_id
                    AND r.residency_status = 'deceased') THEN
    RAISE EXCEPTION
      'workflow: the resident is recorded as deceased; this credential cannot be activated'
      USING ERRCODE = 'check_violation';
  END IF;

  -- P1-5: maker != checker on the people who act in THIS cycle. The actor
  -- columns keep the previous cycle's values after a return, so comparing
  -- them proved nothing. Every path to approval passes a verify step, so
  -- requiring that step and the approval step to record the person acting
  -- now (auth.uid()) makes the comparison current. Applies to the three
  -- generic-engine tables; rental pins its own actors (migration 89).
  --   verify  : pre-verification status -> verified (letters, credentials,
  --             civil) or -> pending_approval (complaints)
  --   approve : pending_approval -> approved (letters, credentials, civil)
  --             or -> in_progress (complaints)
  IF v_entity = ANY (ARRAY['credential_request','vital_event','service_request'])
     AND auth.uid() IS NOT NULL THEN
    IF OLD.status = ANY (ARRAY['draft','submitted','under_review','returned','approval_returned'])
       AND NEW.status = ANY (ARRAY['verified','pending_approval']) THEN
      IF (v_new ->> 'verified_by_user_id') IS DISTINCT FROM auth.uid()::text THEN
        RAISE EXCEPTION
          'workflow: a verification must be recorded by the person verifying'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      -- Credential and civil verifiers work through a checklist; it must be
      -- this cycle's, signed by this verifier.
      IF v_entity = ANY (ARRAY['credential_request','vital_event'])
         AND (jsonb_typeof(v_new -> 'verification_checklist') IS DISTINCT FROM 'object'
              OR (v_new -> 'verification_checklist' ->> 'reviewed_by') IS DISTINCT FROM auth.uid()::text) THEN
        RAISE EXCEPTION
          'workflow: verification requires the completed checklist, recorded by the verifier'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF OLD.status = 'pending_approval'
       AND NEW.status = ANY (ARRAY['approved','in_progress']) THEN
      IF (v_new ->> 'approved_by_user_id') IS DISTINCT FROM auth.uid()::text THEN
        RAISE EXCEPTION
          'workflow: an approval must be recorded by the person approving'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF (v_new ->> 'verified_by_user_id') IS NULL
         OR (v_new ->> 'verified_by_user_id') = (v_new ->> 'approved_by_user_id') THEN
        RAISE EXCEPTION
          'workflow: the approver and the verifier must be two different people'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF (v_new ->> 'requested_by_user_id') = (v_new ->> 'approved_by_user_id') THEN
        RAISE EXCEPTION
          'workflow: the person who made the request cannot approve it'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
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
  -- credential.revoke is reserved to tenant_admin's compiled default alone
  -- (see item 6 below) and additionally locked from ever being reassigned
  -- via the matrix or an override (RESERVED_PERMISSION_KEYS,
  -- 00000000000037_task13_expand_reserved_keys.sql) -- so the permission
  -- check just above already enforces "tenant_admin only" in practice; this
  -- adds the reason requirement the permission check alone cannot express.
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
