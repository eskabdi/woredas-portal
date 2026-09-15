-- ---------------------------------------------------------------------------
-- 00000000000029_workflow_insert_guard.sql
--
-- Closes the hole that meant F-01 was NOT actually closed.
--
-- Migrations 25/26 police UPDATE only. Both zz_ triggers are BEFORE/AFTER
-- UPDATE, so the entire state machine is reachable around by POSTing a row that
-- STARTS at the status you want. The INSERT policies gate on `credential.issue`
-- alone (baseline.sql:1567 and :1620), which registry_clerk, civil_registrar
-- and tenant_admin all hold.
--
-- workflow-fsm-review reproduced the full attack on a real cluster as a real
-- registry_clerk:
--
--   INSERT credential_request (status='paid')            -> accepted
--   INSERT residence_credential (status='active',
--                                credential_request_id=NULL) -> accepted,
--     and trg_assign_credential_number minted a valid Luhn number for it
--   audit_log rows for either insert                     -> ZERO, because the
--     logging trigger is AFTER UPDATE
--
-- Inserting the credential at `ready_to_print` instead, calling sign-credential
-- (which checks only the caller's credential.print, the woreda, the status and
-- that qr_payload is null -- it never reads the parent request), then walking
-- ready_to_print -> printing -> printed -> active, all of which registry_clerk
-- holds, produces a SIGNED, ACTIVE government ID attached to no request, with
-- no verification, no approval and no payment. That is F-01's outcome reached
-- by POST instead of PATCH.
--
-- This migration adds the missing BEFORE INSERT arm.
--
--   credential_request  may only be INSERTed at `draft` or `submitted`.
--     woreda.credentials.new.tsx:337 inserts at `submitted`, the only app path
--     that creates one, so nothing legitimate changes.
--
--   residence_credential may only be INSERTed at `ready_to_print`, with a
--     credential_request_id, and ONLY from generate_residence_credential_on_payment().
--     No application code inserts this table at all -- verified across src/ and
--     supabase/functions/; every app reference is a select or an update. The
--     sole writer is the mint trigger.
--
-- HOW THE MINT IS RECOGNISED, and why not the obvious alternatives:
--
--   The mint is a BEFORE UPDATE trigger on credential_request, so at the moment
--   it inserts, the parent row still reads `awaiting_payment` -- a guard of the
--   form "parent must be `paid`" would reject the legitimate mint. Widening it
--   to accept `awaiting_payment` would then let anyone with a request parked
--   there mint against it, which is most of what we are trying to prevent.
--
--   So the mint sets a TRANSACTION-scoped GUC around its own INSERT and this
--   guard requires it. Transaction-scoped (`set_config(..., true)`) matters:
--   a session-scoped setting would survive on a pooled connection and could be
--   reused by a later, unrelated request on the same backend.
--
--   Note the rationale migration 25 gives for its `is_system` GUC check is
--   factually wrong and is NOT relied on here. It claims SET LOCAL by a
--   PostgREST caller "does not survive into the trigger's execution context";
--   workflow-fsm-review showed it plainly does. What actually protects both
--   flags is that set_config lives in pg_catalog, PostgREST only routes to
--   functions in the exposed schema, and no function in `public` calls
--   set_config or executes dynamic SQL. That is a real boundary, but it is a
--   property of the surrounding system rather than of the trigger -- so the
--   status and parent checks below stand on their own and the GUC is the
--   third lock, not the only one.
--
-- ADDITIVE. Adds two triggers and one function; replaces the mint via
-- CREATE OR REPLACE to add the flag. Nothing is dropped.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The guard
--
-- SECURITY INVOKER (the default) on purpose. A SECURITY DEFINER function would
-- see its own owner as current_user and could not observe the real caller; more
-- importantly it does not need any privilege the caller lacks -- it reads only
-- NEW and one GUC.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_workflow_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_workflow_insert() IS
  'BEFORE INSERT arm of the workflow engine. Migrations 25/26 police UPDATE only, so without this the state machine is bypassable by POSTing a row that already starts at the desired status. See migration 29 header.';

-- ---------------------------------------------------------------------------
-- 2. Teach the mint to announce itself
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

    -- Flag the mint so the BEFORE INSERT guard on residence_credential can
    -- tell this apart from a hand-rolled POST. `true` = TRANSACTION-scoped:
    -- it is discarded at commit/rollback and therefore cannot leak across a
    -- pooled connection the way a session-scoped (`false`) setting would.
    PERFORM set_config('app.minting_credential', 'on', true);

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

    -- Clear it immediately: the flag authorises exactly one INSERT, not the
    -- remainder of the transaction.
    PERFORM set_config('app.minting_credential', '', true);

    NEW.credential_id := v_new_credential_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Wire the guard
--
-- `zz_` prefix for the same reason as the UPDATE arm: same-timing triggers fire
-- in name order, and this must run after trg_force_actor and after the number
-- assignment so it sees the final row.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS zz_enforce_workflow_insert ON public.credential_request;
CREATE TRIGGER zz_enforce_workflow_insert
  BEFORE INSERT ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_insert();

DROP TRIGGER IF EXISTS zz_enforce_workflow_insert ON public.residence_credential;
CREATE TRIGGER zz_enforce_workflow_insert
  BEFORE INSERT ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_insert();

COMMIT;
