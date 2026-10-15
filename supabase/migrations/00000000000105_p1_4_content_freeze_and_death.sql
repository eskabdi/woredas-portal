-- P1-4 (WP-WF-004, WP-AZ-002, WP-APP-002, WP-WF-006): what was approved is
-- what takes effect, and a registered death is complete and irreversible.
--
-- 1. Content freeze. The workflow engine polices status changes only; the
--    subject of a request (who, what kind, which event, letter text) could
--    still be rewritten after verification/approval, and the side effects
--    (ID card mint, birth/death, letter render) read the row at the moment
--    they fire. pin_workflow_subject() rejects, from a user session, any
--    change to a table's subject columns once the row has left
--    draft/submitted/under_review/returned -- the states in which a maker or
--    verifier is still shaping it. residence_credential's identity columns
--    are frozen from creation. vital_event.event_details stays editable
--    only under its 'certificate' key, which the certificate card fills in
--    until registration (frozen from there by migration 101).
--    The trigger is named without a "trg_" prefix so it fires before the
--    birth side effect assigns vital_event.resident_id on registration.
--    Service-role/maintenance updates (auth.uid() IS NULL) are not blocked.
--
-- 2. Death. apply_death_on_approval() revoked only 'active' cards, and did
--    so through the user revoke edge, which needs credential.revoke
--    (tenant_admin only): registering a death as anyone else would have
--    failed (production had no death event yet), and printed, suspended and
--    print-queue cards (no user revoke edge) survived. It now revokes every
--    non-terminal card under a transaction-local flag that
--    enforce_workflow_transition() honours for that one purpose, with a
--    history and an audit row each. A deceased resident's card can no longer
--    be activated (suspended -> active, printed -> active).
--
-- 3. residency_status = 'deceased' is set only by the death side effect and
--    left only through correct_resident_deceased_status(): tenant_admin of
--    the resident's woreda, a reason of at least 10 characters, an audit
--    row. Revoked cards stay revoked (terminal); a corrected resident needs
--    a new card through the normal request workflow.
--
-- Additive: new functions and triggers, CREATE OR REPLACE of
-- enforce_workflow_transition (its migration-98 body plus the two P1-4
-- blocks) and apply_death_on_approval (migration 59).

-- 1. Content freeze ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pin_workflow_subject()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_cols text[];
  v_new  jsonb := to_jsonb(NEW);
  v_old  jsonb := to_jsonb(OLD);
  c      text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'credential_request' THEN
    v_cols := ARRAY['resident_id','household_id','issuing_kebele_id','request_type',
                    'credential_type','prior_credential_id','correction_fields',
                    'correction_reason','police_report_number','supporting_document_path'];
  ELSIF TG_TABLE_NAME = 'vital_event' THEN
    v_cols := ARRAY['resident_id','household_id','event_type','event_date',
                    'source_document_no','event_details'];
  ELSIF TG_TABLE_NAME = 'service_request' THEN
    v_cols := ARRAY['service_type_id','resident_id','household_id','kebele_id',
                    'applicant_name','purpose','addressed_to','details','subject',
                    'respondent_name','incident_date','incident_place','fee_amount'];
  ELSIF TG_TABLE_NAME = 'residence_credential' THEN
    v_cols := ARRAY['resident_id','credential_type','issue_date','expiry_date',
                    'issuing_kebele_id','credential_request_id'];
  ELSE
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME <> 'residence_credential'
     AND OLD.status = ANY (ARRAY['draft','submitted','under_review','returned']) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'vital_event' THEN
    IF jsonb_typeof(v_new -> 'event_details') = 'object' THEN
      v_new := jsonb_set(v_new, '{event_details}', (v_new -> 'event_details') - 'certificate');
    END IF;
    IF jsonb_typeof(v_old -> 'event_details') = 'object' THEN
      v_old := jsonb_set(v_old, '{event_details}', (v_old -> 'event_details') - 'certificate');
    END IF;
  END IF;

  FOREACH c IN ARRAY v_cols LOOP
    IF (v_new -> c) IS DISTINCT FROM (v_old -> c) THEN
      RAISE EXCEPTION
        'workflow: %.% cannot be changed once the record has left review (status %)',
        TG_TABLE_NAME, c, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credential_request','vital_event','service_request','residence_credential'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = 'pin_workflow_subject'
                      AND tgrelid = ('public.' || t)::regclass) THEN
      EXECUTE format(
        'CREATE TRIGGER pin_workflow_subject BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.pin_workflow_subject()', t);
    END IF;
  END LOOP;
END $$;

-- 2. Death: complete revocation, no re-activation ---------------------------

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
                    AND r.residency_status = 'deceased') THEN
    RAISE EXCEPTION
      'workflow: the resident is recorded as deceased; this credential cannot be activated'
      USING ERRCODE = 'check_violation';
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


CREATE OR REPLACE FUNCTION public.apply_death_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason TEXT;
  r RECORD;
BEGIN
  IF NEW.event_type = 'death' AND NEW.status = 'registered'
     AND (OLD.status IS DISTINCT FROM 'registered') THEN
    v_reason := 'Resident deceased (event ' || NEW.event_number || ')';

    PERFORM set_config('app.residency_change', 'death', true);
    UPDATE public.resident
       SET residency_status = 'deceased'
     WHERE resident_id = NEW.resident_id AND woreda_id = NEW.woreda_id;
    PERFORM set_config('app.residency_change', '', true);

    PERFORM set_config('app.death_revocation', 'on', true);
    FOR r IN
      SELECT credential_id, status
        FROM public.residence_credential
       WHERE resident_id = NEW.resident_id
         AND woreda_id = NEW.woreda_id
         AND status IN ('ready_to_print','printing','printed','active','suspended')
       FOR UPDATE
    LOOP
      UPDATE public.residence_credential
         SET status = 'revoked', revoked_at = now(), revoked_reason = v_reason
       WHERE credential_id = r.credential_id;

      INSERT INTO public.credential_status_history
        (credential_id, old_status, new_status, changed_by_user_id, change_reason)
      VALUES (r.credential_id, r.status, 'revoked', auth.uid(), v_reason);

      INSERT INTO public.audit_log
        (woreda_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
      VALUES (NEW.woreda_id, 'residence_credential', r.credential_id::text, 'CREDENTIAL_REVOKED',
              jsonb_build_object('status', r.status),
              jsonb_build_object('status', 'revoked', 'reason', v_reason,
                                 'vital_event_id', NEW.vital_event_id));
    END LOOP;
    PERFORM set_config('app.death_revocation', '', true);
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. 'deceased' is set by the death side effect and left only by correction --

CREATE OR REPLACE FUNCTION public.guard_resident_deceased_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_ctx text := coalesce(current_setting('app.residency_change', true), '');
BEGIN
  IF auth.uid() IS NULL OR NEW.residency_status IS NOT DISTINCT FROM OLD.residency_status THEN
    RETURN NEW;
  END IF;
  IF NEW.residency_status = 'deceased' AND v_ctx <> 'death' THEN
    RAISE EXCEPTION
      'resident: deceased is recorded only by registering a death event'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.residency_status = 'deceased' AND v_ctx <> 'correction' THEN
    RAISE EXCEPTION
      'resident: a deceased status can only be corrected by a tenant administrator, with a reason'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'guard_resident_deceased_status'
                    AND tgrelid = 'public.resident'::regclass) THEN
    CREATE TRIGGER guard_resident_deceased_status
      BEFORE UPDATE OF residency_status ON public.resident
      FOR EACH ROW EXECUTE FUNCTION public.guard_resident_deceased_status();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.correct_resident_deceased_status(
  _resident_id uuid,
  _new_status text,
  _reason text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_woreda uuid := public.get_user_woreda_id();
  v_reason text := btrim(coalesce(_reason, ''));
  v_old    text;
BEGIN
  IF auth.uid() IS NULL OR v_woreda IS NULL OR NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'resident: only a tenant administrator can correct a deceased status'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _new_status IS NULL OR _new_status NOT IN ('active','suspended') THEN
    RAISE EXCEPTION 'resident: the corrected status must be active or suspended'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'resident: a correction needs a reason of 10 to 500 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT residency_status INTO v_old
    FROM public.resident
   WHERE resident_id = _resident_id AND woreda_id = v_woreda
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resident: not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_old IS DISTINCT FROM 'deceased' THEN
    RAISE EXCEPTION 'resident: the resident is not recorded as deceased'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.residency_change', 'correction', true);
  UPDATE public.resident SET residency_status = _new_status
   WHERE resident_id = _resident_id AND woreda_id = v_woreda;
  PERFORM set_config('app.residency_change', '', true);

  INSERT INTO public.audit_log
    (woreda_id, actor_user_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
  VALUES (v_woreda, auth.uid(), 'resident', _resident_id::text, 'RESIDENT_DECEASED_CORRECTED',
          jsonb_build_object('residency_status', 'deceased'),
          jsonb_build_object('residency_status', _new_status, 'reason', v_reason));
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_resident_deceased_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_resident_deceased_status(uuid, text, text) TO authenticated;
