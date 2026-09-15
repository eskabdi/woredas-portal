-- ---------------------------------------------------------------------------
-- 00000000000030_drop_legacy_transitions.sql
--
-- Removes the temporary rows migration 28 added, restoring the full 8-stage
-- FSM decision D-2 specified.
--
-- Migration 28 existed for one reason: migrations 25/26 were applied to the
-- live project while the DEPLOYED frontend was still the pre-Task-1 build, so
-- the transitions that build writes were unseeded and live credential
-- processing failed outright. It re-seeded exactly those transitions to get the
-- running system working again.
--
-- *** DO NOT APPLY THIS UNTIL THE NEW FRONTEND IS DEPLOYED AND VERIFIED. ***
--
-- Applying it while the old build is still serving traffic re-breaks the exact
-- failure it was written to fix:
--
--   workflow: credential_request may not move from submitted to pending_approval
--
-- What comes back by removing them:
--
--   * `verified` and `approved` are real stops again, so verification and
--     approval are distinct recorded acts rather than one combined click.
--   * The print step is two-phase again: `ready_to_print -> printing -> printed`
--     with an officer confirming a good card came out. While the legacy rows
--     were live, `ready_to_print -> printed` was legal, so a jammed or misfed
--     printer once again SPENT the credential and forced the resident to start
--     a new request. That regression is the main reason this file exists.
--   * `approval_returned` goes back to being retired -- reachable only via the
--     recovery exit migration 26 seeded, never as a destination.
--
-- Every row is tagged, so removal is exact and needs no hand-listing. The
-- assertions below fail the migration rather than leave the FSM in a shape
-- nobody intended.
--
-- ADDITIVE in the sense that matters: it deletes only reference-data rows this
-- project itself inserted, tagged for exactly this purpose. No table, column,
-- constraint, policy or function is touched, and no workflow ROW is modified --
-- requests and credentials keep whatever status they hold.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Refuse to run if the deployed frontend still needs the legacy rows
--
-- A cheap guard against the ordering mistake that caused the outage in the
-- first place. Any credential_request currently sitting in a state that ONLY
-- the legacy path can leave means the old build is still in service, or a
-- request is mid-flight through it.
-- ---------------------------------------------------------------------------

DO $guard$
DECLARE
  v_stranded int;
BEGIN
  -- `pending_approval` is reachable in BOTH models, so it is not evidence
  -- either way. What matters is a request that the new UI could not move:
  -- under the 8-stage model the approver works from `verified`, so a request
  -- parked at `pending_approval` having never passed through `verified` is a
  -- request the old build put there.
  SELECT count(*) INTO v_stranded
    FROM public.credential_request cr
   WHERE cr.status = 'pending_approval'
     AND NOT EXISTS (
       SELECT 1 FROM public.credential_request_status_history h
        WHERE h.credential_request_id = cr.credential_request_id
          AND h.new_status = 'verified'
     );

  IF v_stranded > 0 THEN
    RAISE EXCEPTION
      '% request(s) sit at pending_approval without ever having been verified -- the pre-Task-1 frontend is still in service, or a request is mid-flight through it. Deploy and verify the new frontend first, then re-run. Removing the legacy transitions now would strand them.',
      v_stranded;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 2. Remove them
-- ---------------------------------------------------------------------------

DELETE FROM public.workflow_transition WHERE note LIKE 'LEGACY-28:%';

-- ---------------------------------------------------------------------------
-- 3. Assert the FSM landed in the shape decision D-2 specifies
-- ---------------------------------------------------------------------------

DO $chk$
DECLARE
  v_left      int;
  v_missing   text := '';
  v_hops      text[][] := ARRAY[
    -- the 8-stage path the new frontend walks
    ARRAY['credential_request','submitted','verified'],
    ARRAY['credential_request','under_review','verified'],
    ARRAY['credential_request','verified','pending_approval'],
    ARRAY['credential_request','pending_approval','approved'],
    ARRAY['credential_request','approved','awaiting_payment'],
    ARRAY['credential_request','awaiting_payment','paid'],
    ARRAY['credential_request','paid','printed'],
    ARRAY['credential_request','printed','active'],
    -- two-phase print, restored
    ARRAY['residence_credential','ready_to_print','printing'],
    ARRAY['residence_credential','printing','printed'],
    ARRAY['residence_credential','printing','ready_to_print'],
    ARRAY['residence_credential','printed','active'],
    -- the abandon paths migration 27 added must survive
    ARRAY['credential_request','approved','rejected'],
    ARRAY['credential_request','awaiting_payment','rejected']
  ];
  i int;
BEGIN
  SELECT count(*) INTO v_left FROM public.workflow_transition WHERE note LIKE 'LEGACY-28:%';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'expected 0 legacy rows after delete, found %', v_left;
  END IF;

  -- The single-step print write must be gone; that is the regression this
  -- migration exists to reverse.
  IF EXISTS (SELECT 1 FROM public.workflow_transition
              WHERE entity = 'residence_credential'
                AND from_status = 'ready_to_print' AND to_status = 'printed') THEN
    RAISE EXCEPTION 'ready_to_print -> printed survived: a printer jam would still spend the credential';
  END IF;

  FOR i IN 1 .. array_length(v_hops, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.workflow_transition
                    WHERE entity = v_hops[i][1]
                      AND from_status = v_hops[i][2]
                      AND to_status = v_hops[i][3]) THEN
      v_missing := v_missing || format('%s %s->%s; ', v_hops[i][1], v_hops[i][2], v_hops[i][3]);
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'the delete removed more than it should -- missing: %', v_missing;
  END IF;

  -- Nothing may be left ungated, and terminals must stay closed.
  IF EXISTS (SELECT 1 FROM public.workflow_transition
              WHERE required_permission IS NULL AND NOT is_system) THEN
    RAISE EXCEPTION 'an ungated transition remains';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workflow_transition
              WHERE from_status IN ('rejected','expired','revoked','replaced')) THEN
    RAISE EXCEPTION 'a terminal state has an exit';
  END IF;
END $chk$;

COMMIT;
