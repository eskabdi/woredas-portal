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
