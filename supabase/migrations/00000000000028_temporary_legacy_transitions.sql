-- ---------------------------------------------------------------------------
-- 00000000000028_temporary_legacy_transitions.sql
--
-- *** TEMPORARY. DELETE THIS ONCE THE NEW FRONTEND IS DEPLOYED. ***
--
-- Migrations 25 and 26 were applied to the live project on 2026-09-07 while the
-- DEPLOYED frontend was still the pre-Task-1 build. That build walks a 6-stage
-- workflow; the FSM seeded by migration 25 encodes the 8-stage one (decision
-- D-2, which made `verified` and `approved` real stops). The transitions the
-- deployed build writes are therefore not seeded, and the live credential
-- module has been failing with
--
--   workflow: credential_request may not move from submitted to pending_approval
--
-- since the moment the FSM landed. This migration re-seeds exactly the
-- transitions that build performs, so the running system works again while the
-- frontend deploy is unblocked.
--
-- WHAT THIS COSTS: `verified` and `approved` can be skipped, so the workflow
-- reverts to the shape production actually ran for months before 2026-09-07.
--
-- WHAT IT DOES NOT COST -- and this is the point: every row below carries the
-- SAME permission the proper multi-step path requires, so no gate is removed
-- and no role gains anything.
--
--     submitted/under_review -> pending_approval   credential.review
--       (the proper path is -> verified, also credential.review)
--     pending_approval -> awaiting_payment         credential.approve
--       (the proper path is -> approved via credential.approve, then
--        approved -> awaiting_payment via credential.record_payment; the
--        stricter of the two is kept)
--     pending_approval -> approval_returned        credential.return
--     approval_returned -> pending_approval        credential.resubmit
--     ready_to_print -> printed  (credential)      credential.print
--       (the proper path is -> printing -> printed; the old build has no
--        confirmation step, so it writes `printed` directly)
--
-- This does NOT reopen F-01. F-01 was an UNAUTHORIZED jump -- any status to any
-- status with no permission check at all. Everything here is permission-gated,
-- and maker != checker, the terminal-state guard, the append-only actor guards
-- and the successor-required check on `replaced` are all untouched.
--
-- Note the print row also re-opens the failure the two-phase print step was
-- built to prevent: the old build marks a card `printed` when the job is SENT,
-- so a jam still spends the credential. That is the pre-2026-09-07 behaviour and
-- it is why this file is temporary rather than a design change.
--
-- ---------------------------------------------------------------------------
-- HOW TO REMOVE, once the new frontend is live and verified:
--
--   DELETE FROM public.workflow_transition WHERE note LIKE 'LEGACY-28:%';
--
-- Every row below is tagged, so removal is exact and needs no hand-listing.
-- Verify afterwards that the count returns to 31 (27 from migrations 25/26 plus
-- the 4 abandon paths from 27, if that has landed by then).
-- ---------------------------------------------------------------------------

BEGIN;

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('credential_request','submitted','pending_approval','credential.review',false,
   'LEGACY-28: pre-Task-1 build Pass button, straight from submitted. Remove when the new frontend is deployed.'),
  ('credential_request','under_review','pending_approval','credential.review',false,
   'LEGACY-28: pre-Task-1 build Pass button, from under_review. Remove when the new frontend is deployed.'),
  ('credential_request','pending_approval','awaiting_payment','credential.approve',false,
   'LEGACY-28: pre-Task-1 build Approve button, which raised the fee in the same step. Remove when the new frontend is deployed.'),
  ('credential_request','pending_approval','approval_returned','credential.return',false,
   'LEGACY-28: pre-Task-1 build Return-from-approval. Remove when the new frontend is deployed.'),
  ('credential_request','approval_returned','pending_approval','credential.resubmit',false,
   'LEGACY-28: pre-Task-1 build Resubmit-for-approval, which skipped re-verification. Remove when the new frontend is deployed.'),
  ('residence_credential','ready_to_print','printed','credential.print',false,
   'LEGACY-28: pre-Task-1 build printed directly on send, with no confirmation step. Remove when the new frontend is deployed.')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- Fail rather than commit a half-seeded mitigation: the whole point is that the
-- deployed build works end to end afterwards.
DO $chk$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.workflow_transition WHERE note LIKE 'LEGACY-28:%';
  IF n <> 6 THEN
    RAISE EXCEPTION 'expected 6 legacy transitions, found % -- the deployed build would still fail somewhere', n;
  END IF;
END $chk$;

COMMIT;
