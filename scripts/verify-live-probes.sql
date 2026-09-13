-- Live-verification probe suite for the production-readiness fix task
-- (fix-task-production-readiness-v3.md), covering Tasks 1/1b/9/2/10/11/4+13's
-- "Done means" acceptance criteria that assert a database-layer gate
-- actually blocks something.
--
-- Every probe below is designed to run as ONE Management API query string of
-- the shape `BEGIN; <setup + action>; ROLLBACK;` -- the runner
-- (scripts/run-live-probes.py) submits each block independently and never
-- commits. A probe that is supposed to be rejected is scored PASS when the
-- whole block errors (the raise aborts the implicit transaction, which the
-- trailing ROLLBACK or the connection closing then discards); it is scored
-- FAIL if the block completes without error, since that means the gate
-- didn't fire. A probe that is supposed to succeed (e.g. a valid boundary
-- case) is scored PASS when it completes without error.
--
-- No probe here writes anything that survives -- ROLLBACK undoes the whole
-- block even when the trigger's own RAISE already aborted it, and Postgres
-- discards an aborted-but-unrolled-back transaction when the connection
-- closes regardless. Sequence advances (nextval() calls inside a rolled-back
-- INSERT) are the one documented exception -- see the runner's net-zero
-- check, which records sequence values before/after and flags any gap for
-- the report rather than silently correcting it.
--
-- Real, pre-existing production rows are used as read-only reference points
-- (FK targets, existing statuses) where that's simpler and no less safe than
-- inserting a fully synthetic row -- every probe still rolls back, so an
-- existing row's state is never actually changed. Two real, already-active
-- accounts from this project's own earlier development are used to drive
-- RLS-as-role checks: registry_clerk 35b307bd-c5f6-4925-ac14-231f934c3a00 and
-- tenant_admin 64e0384a-d240-4302-8310-682f79a302ce (both woreda
-- 81ac2ad6-a320-4069-b8dc-0c43e358371b), plus tenant_admin
-- bad5a1c7-28d7-4af8-988b-42bd36d5c7d5 in a different woreda
-- (d43c7fea-c2bb-491c-99e7-56c76aa577f1) for cross-tenant checks. No new
-- accounts are created anywhere in this file -- see the session's decision
-- to keep zero synthetic accounts in production.

-- === PROBE: unauthorized_backward_transition ===
-- An 'active' credential_request going back to 'submitted' is not in
-- workflow_transition for any from/to pair -- must raise.
BEGIN;
UPDATE public.credential_request
   SET status = 'submitted'
 WHERE credential_request_id = '01c0c362-d318-45af-b89e-cbf6f511528c';
ROLLBACK;
-- EXPECT: ERROR (invalid transition)

-- === PROBE: maker_equals_checker ===
-- Walks the REAL legal chain (submitted -> under_review -> verified ->
-- pending_approval -> approved) as a single actor (tenant_admin, who holds
-- every permission the chain needs since no `supervisor`-role account is
-- active in production -- see the report's role-coverage note). Reusing one
-- actor for both the verify and approve steps means verified_by_user_id and
-- approved_by_user_id land on the SAME person via force_actor_columns, which
-- is exactly the condition enforce_workflow_transition's maker != checker
-- block (fired specifically on the transition INTO 'approved') exists to
-- reject.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.credential_request
  (credential_request_id, woreda_id, request_number, resident_id, household_id,
   issuing_kebele_id, office_id, request_type, credential_type, status,
   requested_by_user_id, submitted_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', '81ac2ad6-a320-4069-b8dc-0c43e358371b', '',
   'a3c09f89-bde7-4f3b-b067-66a06311cccc', '06dc8908-0221-4225-ac34-dd7993242afe',
   'ce201405-40aa-40be-9445-b19e696502fb', '11474d37-8236-4297-9a17-b76eb01e4667',
   'new_issue', 'card', 'submitted', '64e0384a-d240-4302-8310-682f79a302ce', now());
UPDATE public.credential_request SET status = 'under_review'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000001';
UPDATE public.credential_request
   SET status = 'verified', verified_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce',
       verified_at = now()
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000001';
UPDATE public.credential_request SET status = 'pending_approval'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000001';
UPDATE public.credential_request
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce',
       approval_decision_at = now()
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000001';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (the approver and the verifier must be two different people)

-- === PROBE: terminal_rejected_locked ===
-- Walks submitted -> under_review -> verified -> rejected (a real, seeded
-- transition), then attempts to reopen the terminal state back to
-- 'submitted' -- must raise regardless of the seed table, per
-- enforce_workflow_transition's own terminal-state check.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.credential_request
  (credential_request_id, woreda_id, request_number, resident_id, household_id,
   issuing_kebele_id, office_id, request_type, credential_type, status,
   requested_by_user_id, submitted_at)
VALUES
  ('00000000-0000-4000-8000-000000000002', '81ac2ad6-a320-4069-b8dc-0c43e358371b', '',
   'a3c09f89-bde7-4f3b-b067-66a06311cccc', '06dc8908-0221-4225-ac34-dd7993242afe',
   'ce201405-40aa-40be-9445-b19e696502fb', '11474d37-8236-4297-9a17-b76eb01e4667',
   'new_issue', 'card', 'submitted', '64e0384a-d240-4302-8310-682f79a302ce', now());
UPDATE public.credential_request SET status = 'under_review'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000002';
UPDATE public.credential_request
   SET status = 'verified', verified_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce',
       verified_at = now()
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000002';
UPDATE public.credential_request
   SET status = 'rejected', reject_reason = 'Test rejection reason for probe'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000002';
UPDATE public.credential_request SET status = 'submitted'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000002';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (terminal on credential_request; no further transition is permitted)

-- === PROBE: paid_without_payment_row ===
-- Walks the full legal chain to `awaiting_payment` using TWO different
-- actors for verify/approve (so this probe isolates the payment gate
-- specifically, without also tripping maker != checker), then attempts
-- awaiting_payment -> paid with no payment_id set at all -- must raise via
-- generate_residence_credential_on_payment()'s own payment/receipt check,
-- a trigger separate from enforce_workflow_transition.
BEGIN;
SET LOCAL request.jwt.claim.sub = '35b307bd-c5f6-4925-ac14-231f934c3a00';
SET LOCAL role authenticated;
INSERT INTO public.credential_request
  (credential_request_id, woreda_id, request_number, resident_id, household_id,
   issuing_kebele_id, office_id, request_type, credential_type, status,
   requested_by_user_id, submitted_at)
VALUES
  ('00000000-0000-4000-8000-000000000003', '81ac2ad6-a320-4069-b8dc-0c43e358371b', '',
   'a3c09f89-bde7-4f3b-b067-66a06311cccc', '06dc8908-0221-4225-ac34-dd7993242afe',
   'ce201405-40aa-40be-9445-b19e696502fb', '11474d37-8236-4297-9a17-b76eb01e4667',
   'new_issue', 'card', 'submitted', '35b307bd-c5f6-4925-ac14-231f934c3a00', now());
UPDATE public.credential_request SET status = 'under_review'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000003';
UPDATE public.credential_request
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00',
       verified_at = now()
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000003';
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
UPDATE public.credential_request SET status = 'pending_approval'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000003';
UPDATE public.credential_request
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce',
       approval_decision_at = now()
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000003';
UPDATE public.credential_request SET status = 'awaiting_payment'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000003';
UPDATE public.credential_request SET status = 'paid'
 WHERE credential_request_id = '00000000-0000-4000-8000-000000000003';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (a confirmed payment with a receipt is required)

-- === PROBE: one_active_credential_per_resident ===
-- resident a3c09f89 already has an active residence_credential
-- (208db604-...). Inserting a second active row for the same resident must
-- violate the partial unique index.
BEGIN;
INSERT INTO public.residence_credential
  (credential_id, resident_id, woreda_id, issuing_kebele_id, credential_number,
   serial_number, status)
VALUES
  ('00000000-0000-4000-8000-000000000004', 'a3c09f89-bde7-4f3b-b067-66a06311cccc',
   '81ac2ad6-a320-4069-b8dc-0c43e358371b', 'ce201405-40aa-40be-9445-b19e696502fb',
   '99-99-99-999999-9', 'PROBE-SERIAL-0001', 'active');
ROLLBACK;
-- EXPECT: ERROR (duplicate key, residence_credential_one_active_per_resident)

-- === PROBE: credential_number_immutable ===
-- Changing credential_number on an existing residence_credential row must raise.
BEGIN;
UPDATE public.residence_credential
   SET credential_number = '00-00-00-000000-0'
 WHERE credential_id = '208db604-dc0d-4212-9a82-9daaa93e7793';
ROLLBACK;
-- EXPECT: ERROR (immutable once assigned)

-- === PROBE: cross_woreda_vital_event_insert ===
-- tenant_admin 64e0384a (woreda 81ac2ad6, holds civil.register by default)
-- inserting a vital_event row tagged with a DIFFERENT woreda_id must be
-- rejected by RLS (WITH CHECK requires woreda_id = get_user_woreda_id()).
-- Uses SET LOCAL role authenticated to actually engage RLS -- the raw
-- Management API session otherwise has BYPASSRLS.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, resident_id, event_date, status)
VALUES
  ('00000000-0000-4000-8000-000000000005', 'd43c7fea-c2bb-491c-99e7-56c76aa577f1',
   'birth', '', 'a3c09f89-bde7-4f3b-b067-66a06311cccc', current_date, 'pending');
RESET role;
ROLLBACK;
-- EXPECT: ERROR (RLS policy violation -- cross-tenant WITH CHECK)

-- === PROBE: cross_tenant_credential_request_read ===
-- tenant_admin bad5a1c7 (woreda d43c7fea) must see ZERO rows from the
-- OTHER woreda's credential_request table under RLS.
BEGIN;
SET LOCAL request.jwt.claim.sub = 'bad5a1c7-28d7-4af8-988b-42bd36d5c7d5';
SET LOCAL role authenticated;
SELECT count(*) AS visible_rows FROM public.credential_request
 WHERE woreda_id = '81ac2ad6-a320-4069-b8dc-0c43e358371b';
RESET role;
ROLLBACK;
-- EXPECT: SUCCESS, visible_rows = 0

-- === PROBE: role_permission_super_admin_row_rejected ===
-- Reserved roles (super_admin, tenant_admin) must never get a row in the
-- overridable role_permission matrix -- inserting one must be rejected
-- (CHECK constraint or RLS, whichever the migration used).
BEGIN;
INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
VALUES ('81ac2ad6-a320-4069-b8dc-0c43e358371b', 'super_admin', 'credential.approve', true);
ROLLBACK;
-- EXPECT: ERROR

-- === PROBE: reserved_permission_override_rejected ===
-- A per-user override attempting to grant a reserved/locked permission
-- (credential.approve, in user_permission_override_no_locked_keys's list)
-- must be rejected by that CHECK constraint, regardless of actor.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.user_permission_override
  (user_id, woreda_id, permission_key, is_granted)
VALUES ('35b307bd-c5f6-4925-ac14-231f934c3a00', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
        'credential.approve', true);
RESET role;
ROLLBACK;
-- EXPECT: ERROR (user_permission_override_no_locked_keys)

-- === PROBE: age_boundary_18y_0d_accepted / 17y_364d_rejected ===
-- Client-side only (calculateAgeYears + PreConditionCard) -- there is no
-- database-layer age gate to probe here; see the report row for this item,
-- classified UNVERIFIED-with-reason (client-side advisory, not a DB gate).

-- === PROBE: viewer_role_write_rejected ===
-- No active `viewer`-role account exists in production (only registry_clerk
-- and tenant_admin are active) -- see the report row for this item,
-- classified UNVERIFIED-with-reason.

-- === PROBE: civil_unauthorized_transition ===
-- Task 14-A: a synthetic vital_event inserted at 'submitted', then an
-- attempt to jump straight to 'approved' (skipping under_review/verified/
-- pending_approval) must raise -- no such edge is seeded.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000010', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"Unauthorized","sex":"male"}');
UPDATE public.vital_event SET status = 'approved'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000010';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (vital_event may not move from submitted to approved)

-- === PROBE: civil_maker_equals_checker ===
-- Walks the real chain (submitted -> under_review -> verified ->
-- pending_approval -> approved) as a single actor -- reusing one actor for
-- both verify and the transition into approved means verified_by_user_id
-- and approved_by_user_id land on the same person, which the SAME shared
-- engine check that already protects credential_request must also reject
-- here (it's the same function, just attached to a new table).
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000011', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"MakerChecker","sex":"male"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000011';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000011';
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000011';
UPDATE public.vital_event
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', approval_decision_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000011';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (the approver and the verifier must be two different people)

-- === PROBE: civil_terminal_rejected_locked ===
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000012', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"Terminal","sex":"male"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000012';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000012';
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000012';
UPDATE public.vital_event
   SET status = 'rejected', reject_reason = 'Test rejection reason for probe'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000012';
UPDATE public.vital_event SET status = 'submitted'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000012';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (terminal on vital_event; no further transition is permitted)

-- === PROBE: civil_paid_without_payment_row ===
BEGIN;
SET LOCAL request.jwt.claim.sub = '35b307bd-c5f6-4925-ac14-231f934c3a00';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000013', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '35b307bd-c5f6-4925-ac14-231f934c3a00', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"NoPayment","sex":"male"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000013';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000013';
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000013';
UPDATE public.vital_event
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', approval_decision_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000013';
UPDATE public.vital_event SET status = 'awaiting_payment'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000013';
UPDATE public.vital_event SET status = 'paid'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000013';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (a confirmed payment with a receipt is required)

-- === PROBE: civil_paid_with_unrelated_payment_row ===
-- security-review finding (HIGH, fixed in 00000000000059): the payment gate
-- originally checked only payment_id + woreda_id + status='confirmed', never
-- p.vital_event_id = NEW.vital_event_id -- so any confirmed payment the
-- caller could read in-tenant (here: a real, already-confirmed credential
-- fee payment, unrelated to this vital_event) could be pointed at a civil
-- event's payment_id to fast-track it to 'paid' -> 'registered' with no
-- payment ever collected for it. Must now raise.
BEGIN;
SET LOCAL request.jwt.claim.sub = '35b307bd-c5f6-4925-ac14-231f934c3a00';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000018', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '35b307bd-c5f6-4925-ac14-231f934c3a00', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"UnrelatedPayment","sex":"male"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000018';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000018';
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000018';
UPDATE public.vital_event
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', approval_decision_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000018';
UPDATE public.vital_event SET status = 'awaiting_payment'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000018';
-- 21f760c8-8272-4f9e-9ef0-d908a5c23334 is a real, already-confirmed
-- credential_request payment in the same woreda -- never inserted or
-- touched by this probe, only referenced.
UPDATE public.vital_event
   SET status = 'paid', payment_id = '21f760c8-8272-4f9e-9ef0-d908a5c23334'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000018';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (a confirmed payment with a receipt is required)

-- === PROBE: civil_paid_from_wrong_old_status ===
-- The payment gate's own defensive OLD.status check: 'verified' skipping
-- straight to 'paid' must raise even before the generic engine's own
-- from/to lookup would (there is no verified->paid seed row either, so
-- this doubles as a from/to check, but the message confirms which guard
-- actually fired).
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000014', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"WrongOld","sex":"male"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000014';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000014';
UPDATE public.vital_event SET status = 'paid'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000014';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (vital_event may not move from verified to paid)

-- === PROBE: civil_birth_side_effect_not_fired_before_payment ===
-- Walks to 'approved' only (unpaid) and confirms no resident row exists yet
-- for this probe's unique marker name -- the side effect must not fire
-- before payment under B2.
BEGIN;
SET LOCAL request.jwt.claim.sub = '35b307bd-c5f6-4925-ac14-231f934c3a00';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000015', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '35b307bd-c5f6-4925-ac14-231f934c3a00', 'submitted',
   '{"child_first_name":"ProbeUnpaid","child_father_name":"SideEffect","child_grandfather_name":"Check","sex":"male"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000015';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000015';
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000015';
UPDATE public.vital_event
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', approval_decision_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000015';
RESET role;
SELECT
  (SELECT status FROM public.vital_event WHERE vital_event_id = '00000000-0000-4000-8000-000000000015') AS event_status,
  (SELECT resident_id FROM public.vital_event WHERE vital_event_id = '00000000-0000-4000-8000-000000000015') AS linked_resident,
  (SELECT count(*) FROM public.resident WHERE full_name_am = 'ProbeUnpaid SideEffect Check') AS resident_count;
ROLLBACK;
-- EXPECT: SUCCESS (event_status=approved, linked_resident=null, resident_count=0)

-- === PROBE: civil_birth_side_effect_fires_at_registered ===
-- Full cycle through the zero-fee payment path to 'registered' -- confirms
-- the birth side effect fires exactly once, only at the terminal system
-- transition, tenant-scoped.
BEGIN;
SET LOCAL request.jwt.claim.sub = '35b307bd-c5f6-4925-ac14-231f934c3a00';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000016', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '35b307bd-c5f6-4925-ac14-231f934c3a00', 'submitted',
   '{"child_first_name":"ProbeRegistered","child_father_name":"SideEffect","child_grandfather_name":"Fires","sex":"female"}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
UPDATE public.vital_event
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', approval_decision_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
UPDATE public.vital_event SET status = 'awaiting_payment'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
INSERT INTO public.payment
  (payment_id, woreda_id, payment_type, amount, payment_date, channel, status, posted_by_user_id, vital_event_id)
VALUES
  ('00000000-0000-4000-8000-000000000116', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'civil_registration_fee', 0, current_date, 'cash', 'confirmed',
   '64e0384a-d240-4302-8310-682f79a302ce', '00000000-0000-4000-8000-000000000016');
INSERT INTO public.receipt
  (receipt_id, woreda_id, payment_id, receipt_date, total_amount, cash_bank_channel, receipt_number)
VALUES
  ('00000000-0000-4000-8000-000000000216', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   '00000000-0000-4000-8000-000000000116', current_date, 0, 'cash', 'PROBE-RECEIPT-0001');
UPDATE public.vital_event
   SET payment_id = '00000000-0000-4000-8000-000000000116'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
UPDATE public.vital_event SET status = 'paid'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000016';
RESET role;
SELECT
  (SELECT status FROM public.vital_event WHERE vital_event_id = '00000000-0000-4000-8000-000000000016') AS event_status,
  (SELECT r.resident_id FROM public.vital_event ve JOIN public.resident r ON r.resident_id = ve.resident_id
    WHERE ve.vital_event_id = '00000000-0000-4000-8000-000000000016' AND r.woreda_id = '81ac2ad6-a320-4069-b8dc-0c43e358371b') AS linked_resident_same_tenant,
  (SELECT count(*) FROM public.resident WHERE full_name_am = 'ProbeRegistered SideEffect Fires') AS resident_count;
ROLLBACK;
-- EXPECT: SUCCESS (event_status=registered, linked_resident_same_tenant not null, resident_count=1)

-- === PROBE: civil_death_side_effect_tenant_scoped ===
-- Uses a real, pre-existing active resident (51fcd835, woreda 81ac2ad6,
-- already has an active residence_credential from earlier session work) as
-- the death subject. Confirms residency_status flips to 'deceased' and the
-- active credential is revoked ONLY once 'registered' is actually reached,
-- and only within the resident's own woreda.
BEGIN;
SET LOCAL request.jwt.claim.sub = '35b307bd-c5f6-4925-ac14-231f934c3a00';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, resident_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000017', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'death', '', current_date, '51fcd835-9430-4b87-a738-db17eec51f2f',
   '35b307bd-c5f6-4925-ac14-231f934c3a00', 'submitted', '{}');
UPDATE public.vital_event SET status = 'under_review'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
UPDATE public.vital_event
   SET status = 'verified', verified_by_user_id = '35b307bd-c5f6-4925-ac14-231f934c3a00', verified_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
UPDATE public.vital_event SET status = 'pending_approval'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
UPDATE public.vital_event
   SET status = 'approved', approved_by_user_id = '64e0384a-d240-4302-8310-682f79a302ce', approval_decision_at = now()
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
UPDATE public.vital_event SET status = 'awaiting_payment'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
INSERT INTO public.payment
  (payment_id, woreda_id, payment_type, amount, payment_date, channel, status, posted_by_user_id, vital_event_id)
VALUES
  ('00000000-0000-4000-8000-000000000117', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'civil_registration_fee', 0, current_date, 'cash', 'confirmed',
   '64e0384a-d240-4302-8310-682f79a302ce', '00000000-0000-4000-8000-000000000017');
INSERT INTO public.receipt
  (receipt_id, woreda_id, payment_id, receipt_date, total_amount, cash_bank_channel, receipt_number)
VALUES
  ('00000000-0000-4000-8000-000000000217', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   '00000000-0000-4000-8000-000000000117', current_date, 0, 'cash', 'PROBE-RECEIPT-0002');
UPDATE public.vital_event
   SET payment_id = '00000000-0000-4000-8000-000000000117'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
UPDATE public.vital_event SET status = 'paid'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000017';
RESET role;
SELECT
  (SELECT status FROM public.vital_event WHERE vital_event_id = '00000000-0000-4000-8000-000000000017') AS event_status,
  (SELECT residency_status FROM public.resident WHERE resident_id = '51fcd835-9430-4b87-a738-db17eec51f2f') AS resident_status,
  (SELECT count(*) FROM public.residence_credential WHERE resident_id = '51fcd835-9430-4b87-a738-db17eec51f2f' AND status = 'revoked') AS revoked_count;
ROLLBACK;
-- EXPECT: SUCCESS (event_status=registered, resident_status=deceased, revoked_count>=1)

-- === PROBE: civil_precondition_birth_no_household ===
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000018', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date,
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"NoHousehold","sex":"male"}');
RESET role;
ROLLBACK;
-- EXPECT: ERROR (a birth registration requires a linked household)

-- === PROBE: civil_precondition_death_duplicate_open_event ===
-- A second, concurrent death event for the same resident who already has
-- one open (non-terminal) death event must be rejected.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, resident_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000019', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'death', '', current_date, '51fcd835-9430-4b87-a738-db17eec51f2f',
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted', '{}');
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, resident_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000020', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'death', '', current_date, '51fcd835-9430-4b87-a738-db17eec51f2f',
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted', '{}');
RESET role;
ROLLBACK;
-- EXPECT: ERROR (an open death registration already exists for this resident)

-- === PROBE: civil_precondition_marriage_cross_tenant_spouse ===
-- No real resident exists outside woreda 81ac2ad6 in production today (all
-- 3 real residents belong to it), so a synthetic resident is inserted in
-- the OTHER woreda (d43c7fea) within this same rolled-back transaction,
-- then referenced as spouse1 on a marriage event tagged to 81ac2ad6 -- must
-- be rejected.
BEGIN;
SET LOCAL request.jwt.claim.sub = 'bad5a1c7-28d7-4af8-988b-42bd36d5c7d5';
SET LOCAL role authenticated;
INSERT INTO public.resident
  (resident_id, woreda_id, resident_number, full_name, sex, date_of_birth, marital_status)
VALUES
  ('00000000-0000-4000-8000-000000000900', 'd43c7fea-c2bb-491c-99e7-56c76aa577f1', '',
   'Probe Cross Tenant Spouse', 'male', '1990-01-01', 'single');
RESET role;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000021', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'marriage', '', current_date,
   '64e0384a-d240-4302-8310-682f79a302ce', 'submitted',
   jsonb_build_object('spouse1', jsonb_build_object('resident_id', '00000000-0000-4000-8000-000000000900'),
                       'spouse2', jsonb_build_object('name', 'Free Text Spouse')));
RESET role;
ROLLBACK;
-- EXPECT: ERROR (Party 1 does not resolve to a resident of this woreda)

-- === PROBE: civil_registered_unreachable_directly ===
-- A user (even one holding every civil.* permission) can never write
-- status='registered' directly -- no seeded transition exists into it for
-- any permission, only is_system, and app.system_transition is never 'on'
-- in a normal client session.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.vital_event
  (vital_event_id, woreda_id, event_type, event_number, event_date, household_id,
   requested_by_user_id, status, event_details)
VALUES
  ('00000000-0000-4000-8000-000000000022', '81ac2ad6-a320-4069-b8dc-0c43e358371b',
   'birth', '', current_date, '9de75a40-7f23-4700-9b90-335a877d584c',
   '64e0384a-d240-4302-8310-682f79a302ce', 'paid',
   '{"child_first_name":"Probe","child_father_name":"Test","child_grandfather_name":"Direct","sex":"male"}');
UPDATE public.vital_event SET status = 'registered'
 WHERE vital_event_id = '00000000-0000-4000-8000-000000000022';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (is a system transition and cannot be driven directly)

-- === PROBE: rental_as_built_transition_still_succeeds ===
-- A synthetic request inserted at 'submitted' (the eligibility trigger's
-- own INSERT-time checks are satisfied by using real FK targets), then
-- verified via the SAME permission (rental.create) the as-built UI already
-- uses for this action -- must still succeed after attaching the shared
-- engine, proving zero behavior change for the one path the app drives.
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.rental_occupancy_request
  (rental_request_id, woreda_id, request_number, rental_house_id, resident_id, request_type, status, rent_amount)
VALUES
  ('00000000-0000-4000-8000-000000000023', '81ac2ad6-a320-4069-b8dc-0c43e358371b', '',
   'a50fd28d-1f1d-45ad-9eb7-d0803504d6b5', '51fcd835-9430-4b87-a738-db17eec51f2f',
   'new_registration', 'submitted', 1500);
UPDATE public.rental_occupancy_request SET status = 'verified'
 WHERE rental_request_id = '00000000-0000-4000-8000-000000000023';
RESET role;
SELECT status FROM public.rental_occupancy_request WHERE rental_request_id = '00000000-0000-4000-8000-000000000023';
ROLLBACK;
-- EXPECT: SUCCESS (status=verified)

-- === PROBE: rental_out_of_path_transition_now_raises ===
-- The same synthetic request, but attempting to jump straight from
-- 'submitted' to 'approved' -- not a seeded edge -- must now raise, proving
-- the shared engine actually gates rental once attached (it did not before
-- this PR: workflow_transition had zero rows for this entity).
BEGIN;
SET LOCAL request.jwt.claim.sub = '64e0384a-d240-4302-8310-682f79a302ce';
SET LOCAL role authenticated;
INSERT INTO public.rental_occupancy_request
  (rental_request_id, woreda_id, request_number, rental_house_id, resident_id, request_type, status, rent_amount)
VALUES
  ('00000000-0000-4000-8000-000000000024', '81ac2ad6-a320-4069-b8dc-0c43e358371b', '',
   'a50fd28d-1f1d-45ad-9eb7-d0803504d6b5', '51fcd835-9430-4b87-a738-db17eec51f2f',
   'new_registration', 'submitted', 1500);
UPDATE public.rental_occupancy_request SET status = 'approved'
 WHERE rental_request_id = '00000000-0000-4000-8000-000000000024';
RESET role;
ROLLBACK;
-- EXPECT: ERROR (rental_occupancy_request may not move from submitted to approved)

-- === PROBE: kpi_rpc_denies_suspended_user ===
-- (Task 12-B)
-- get_credential_kpis() (00000000000057) is SECURITY DEFINER and bypasses
-- RLS; get_user_woreda_id() alone doesn't check app_user.status the way
-- user_has_perm() does, so the RPC's own permission check
-- (is_super_admin() OR user_has_any_perm('{credential.read}')) is what has
-- to catch a non-active account. dc070cc9-24f6-4d19-b3e7-34c42e2f6b6f is a
-- real, pre-existing `suspended` tenant_admin in production (not created by
-- this probe) -- read-only RPC call, nothing to roll back.
BEGIN;
SET LOCAL request.jwt.claim.sub = 'dc070cc9-24f6-4d19-b3e7-34c42e2f6b6f';
SET LOCAL role authenticated;
SELECT get_credential_kpis() AS kpis;
RESET role;
ROLLBACK;
-- EXPECT: ERROR (get_credential_kpis: permission denied)
