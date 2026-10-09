-- ============================================================================
-- P0-6 (2026-09-24 audit, WP-WF-001 + WP-WF-002): guard workflow inserts on
-- vital_event / service_request, and make the service FSM category-aware.
--
-- WP-WF-001. enforce_workflow_transition() is BEFORE UPDATE only; migration 29
-- added a BEFORE INSERT arm for the credential tables, but vital_event
-- (migration 58) and service_request (migration 61) never got one. A clerk
-- could POST a death event straight at 'awaiting_payment' (the paid ->
-- registered system step then marks the resident deceased) or a letter
-- straight at 'issued' -- publicly verifiable, never verified, approved or
-- paid. Both tables now accept only 'draft'/'submitted' at insert, with every
-- verifier/approver/issuer/payment column NULL, and log the creation row to
-- workflow_status_history (the UPDATE-time logger never saw it).
--
-- WP-WF-002. workflow_transition was keyed by entity only, so a letter could
-- walk the complaint edges (under_review -> pending_approval ->
-- in_progress -> resolved -> closed): no verify/approve separation, no fee,
-- no issuance gate -- and verify_service_letter() accepted 'resolved' and
-- 'closed'. workflow_transition gains a nullable `category` column (NULL =
-- every row); the engine matches it against the row's own category, the
-- category is immutable after insert, issued_at/issued_by are set only by
-- paid -> issued, and an issued letter's public content is frozen. The
-- verifier now requires category = 'letter' and status issued/completed.
--
-- Edge classification (traced from woreda.services.$requestId.index.tsx and
-- migration 61's own seed notes):
--   letter    under_review->verified, verified->pending_approval,
--             pending_approval->approved, pending_approval->returned,
--             approved->awaiting_payment, awaiting_payment->paid,
--             paid->issued, issued->completed
--   complaint under_review->pending_approval, pending_approval->in_progress,
--             pending_approval->approval_returned, approved->in_progress,
--             in_progress->resolved, resolved->closed, issued->closed
--   both      draft->submitted, submitted->under_review,
--             under_review->returned, returned->under_review,
--             pending_approval->rejected
-- Production data (2026-10-09): 2 letters (paid, issued), 0 complaints; both
-- are on the letter path and unaffected.
--
-- Restores run with session_replication_role = replica
-- (scripts/backup/restore-verify.sh), so the new insert guard does not fire
-- on a backup restore.
--
-- Additive: one nullable column + CHECK, data UPDATE of the new column,
-- CREATE OR REPLACE for functions, new triggers. No DROP.
-- ============================================================================

-- 1. Category-scoped transition rules --------------------------------------
ALTER TABLE public.workflow_transition
  ADD COLUMN IF NOT EXISTS category text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'workflow_transition_category_check') THEN
    ALTER TABLE public.workflow_transition
      ADD CONSTRAINT workflow_transition_category_check
      CHECK (category IS NULL OR category = ANY (ARRAY['letter', 'complaint']));
  END IF;
END
$c$;

COMMENT ON COLUMN public.workflow_transition.category IS
  'P0-6: NULL = applies to every row of the entity; otherwise only rows whose own category column equals it (service_request letter/complaint).';

UPDATE public.workflow_transition SET category = 'letter'
 WHERE entity = 'service_request' AND (from_status, to_status) IN (
   ('under_review', 'verified'), ('verified', 'pending_approval'),
   ('pending_approval', 'approved'), ('pending_approval', 'returned'),
   ('approved', 'awaiting_payment'), ('awaiting_payment', 'paid'),
   ('paid', 'issued'), ('issued', 'completed'));

UPDATE public.workflow_transition SET category = 'complaint'
 WHERE entity = 'service_request' AND (from_status, to_status) IN (
   ('under_review', 'pending_approval'), ('pending_approval', 'in_progress'),
   ('pending_approval', 'approval_returned'), ('approved', 'in_progress'),
   ('in_progress', 'resolved'), ('resolved', 'closed'), ('issued', 'closed'));

-- 2. Transition engine: category match, category pin, issuance stamp, frozen
--    issued letters (body otherwise identical to the live definition).
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

-- 3. Insert guard for vital_event and service_request ----------------------
CREATE OR REPLACE FUNCTION public.enforce_workflow_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_col text;
BEGIN
  IF TG_TABLE_NAME = 'credential_request' THEN
    IF NEW.status IS DISTINCT FROM 'draft' AND NEW.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION
        'workflow: a credential request must be created at draft or submitted (got %). Advancing it is an UPDATE, which the transition rules police.',
        NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'residence_credential' THEN
    IF coalesce(current_setting('app.minting_credential', true), '') <> 'on' THEN
      RAISE EXCEPTION
        'workflow: a residence credential is issued by the payment trigger, not by direct insert'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status IS DISTINCT FROM 'ready_to_print' THEN
      RAISE EXCEPTION
        'workflow: a residence credential must be created at ready_to_print (got %)',
        NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.credential_request_id IS NULL THEN
      RAISE EXCEPTION
        'workflow: a residence credential must reference the request it was issued for'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- P0-6 (WP-WF-001): civil events and service requests start at the
  -- beginning of their FSM, with no checker, issuer or payment recorded --
  -- every later stage is an UPDATE the transition rules police.
  IF TG_TABLE_NAME IN ('vital_event', 'service_request') THEN
    IF NEW.status IS DISTINCT FROM 'draft' AND NEW.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION
        'workflow: a % must be created at draft or submitted (got %)', TG_TABLE_NAME, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    FOREACH v_col IN ARRAY ARRAY[
      'verified_by_user_id', 'verified_at', 'approved_by_user_id', 'approval_decision_at',
      'issued_by_user_id', 'issued_at', 'payment_id', 'closed_at', 'issued_letter_html',
      'letter_summary', 'resolution_notes'] LOOP
      IF v_new ? v_col AND (v_new ->> v_col) IS NOT NULL THEN
        RAISE EXCEPTION
          'workflow: % cannot be set when a % is created', v_col, TG_TABLE_NAME
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER zz_enforce_workflow_insert
  BEFORE INSERT ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_insert();

CREATE OR REPLACE TRIGGER zz_enforce_workflow_insert
  BEFORE INSERT ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_insert();

-- 4. Creation row in workflow_status_history -------------------------------
CREATE OR REPLACE FUNCTION public.log_workflow_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.workflow_status_history
    (woreda_id, entity, entity_id, old_status, new_status, changed_by_user_id, change_reason)
  VALUES
    (NEW.woreda_id, TG_TABLE_NAME, (to_jsonb(NEW) ->> TG_ARGV[0])::uuid,
     NULL, NEW.status, auth.uid(), 'created');
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_workflow_creation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER zz_log_workflow_creation
  AFTER INSERT ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_creation('vital_event_id');

CREATE OR REPLACE TRIGGER zz_log_workflow_creation
  AFTER INSERT ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_creation('service_request_id');

-- 5. Public verifier: letters only, issued or completed only ---------------
CREATE OR REPLACE FUNCTION public.verify_service_letter(_token text)
 RETURNS TABLE(request_number text, issued_at timestamp with time zone, subject text, resident_full_name text, letter_summary text, service_type_am text, service_type_en text, woreda_name_am text, woreda_name_en text, kebele_name_am text, kebele_name_en text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    sr.request_number,
    sr.issued_at,
    sr.subject,
    COALESCE(r.full_name_am, r.full_name, sr.applicant_name),
    COALESCE(sr.letter_summary, sr.purpose),
    st.name_am,
    st.name_en,
    w.woreda_name_am,
    w.woreda_name_en,
    k.kebele_name_am,
    k.kebele_name_en
  FROM public.service_request sr
  LEFT JOIN public.resident r ON r.resident_id = sr.resident_id
  LEFT JOIN public.service_type st ON st.service_type_id = sr.service_type_id
  LEFT JOIN public.woreda w ON w.woreda_id = sr.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = sr.kebele_id
  WHERE sr.verification_token = _token
    AND sr.issued_at IS NOT NULL
    AND sr.category = 'letter'
    AND sr.status IN ('issued', 'completed')
  LIMIT 1;
$function$;
