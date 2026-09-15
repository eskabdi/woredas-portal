-- ---------------------------------------------------------------------------
-- 00000000000027_workflow_abandon_paths.sql
--
-- Closes freeze paths found by workflow-fsm-review after migrations 25 and 26
-- were applied to the live project. Migration 25 gave the credential workflow
-- real enforcement; what it did not give it was a way OUT of the corridor
-- between `approved` and `printed`. Measured outbound degree on the seeded FSM:
--
--   approved         -> {awaiting_payment}
--   awaiting_payment -> {paid}
--   paid             -> {printed}
--   printed          -> {active}
--
-- Every one of those has exactly one exit, so a request that is approved and
-- then never paid -- the applicant changes their mind, the fee is disputed, the
-- record turns out to be a duplicate -- can never be rejected, returned or
-- closed by ANY role. enforce_workflow_transition() has no super-admin bypass,
-- which is deliberate and correct, so `super_admin` cannot rescue one either.
--
-- Before migration 25 those requests simply sat there and an administrator
-- could move them by hand. The enforcement is what turned "sitting there" into
-- "frozen forever", so this is harm the workflow engine introduced and it is
-- fixed here rather than deferred.
--
-- This is the same trap migration 26 removed for `approval_returned`; the
-- reasoning was not carried into the payment/print corridor at the time.
--
-- `paid` deliberately gets NO abandon path. Money has changed hands and a
-- receipt exists; voiding that is a revenue operation with its own audit
-- requirements, not a status flip. A paid request that must be abandoned needs
-- the refund/void workflow, which does not exist yet.
--
-- ADDITIVE. Seeds rows and replaces one view; no table, column, constraint or
-- policy is dropped.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Abandon paths out of the pre-payment corridor
--
-- Permissions mirror the existing reject/return rows exactly -- this widens
-- WHERE those verbs may be used, never WHO holds them.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('credential_request','approved','rejected','credential.reject',false,
   'Abandon an approved request before a fee is raised. Without this, approval was a one-way door into the payment corridor.'),
  ('credential_request','approved','returned','credential.return',false,
   'Send an approved request back for correction before a fee is raised.'),
  ('credential_request','awaiting_payment','rejected','credential.reject',false,
   'Abandon a request whose fee was raised but never paid. Also the only exit for a request stranded by a failed fee waiver -- see the waiver note in docs/fix-task-v3-execution-notes.md.'),
  ('credential_request','awaiting_payment','returned','credential.return',false,
   'Send a request back for correction after a fee was raised but before it was paid.')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. approval_queue_v -- drop a dead predicate, surface the working stages
--
-- Two problems in the credential arm, both inherited from the baseline:
--
--   * It filters on 'ready_to_print', which `credential_request` cannot hold --
--     that is a `residence_credential` status (open item O-1). Dead predicate.
--
--   * It has no 'paid' or 'printed', which under the new FSM are real working
--     stages: `paid` means "print this card" and `printed` means "hand it to
--     the resident". Their absence is also why a request stranded by the
--     IssuanceCard bug never appeared in the inbox anyone would notice it in.
--
-- Adding them changes what /woreda/approvals lists: requests awaiting print and
-- awaiting collection now appear as the actionable work they are. That is the
-- intent of a unified queue that unions the workflow tables.
--
-- WITH (security_invoker = on) is LOAD-BEARING -- see migration 26's long note.
-- CREATE OR REPLACE VIEW does not preserve reloptions, and this view is owned
-- by a rolbypassrls role. The assertion after it is not optional.
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
  WHERE cr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'approved'::text, 'awaiting_payment'::text, 'paid'::text, 'printed'::text, 'returned'::text, 'approval_returned'::text])
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

ALTER VIEW public.approval_queue_v SET (security_invoker = on);

DO $sec$
DECLARE opts text[];
BEGIN
  SELECT c.reloptions INTO opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'approval_queue_v';
  IF opts IS NULL OR NOT ('security_invoker=on' = ANY (opts)) THEN
    RAISE EXCEPTION
      'approval_queue_v lost security_invoker -- it is owned by a rolbypassrls role, so this would return every tenant''s rows. Restore WITH (security_invoker = on).';
  END IF;
END $sec$;

GRANT SELECT ON public.approval_queue_v TO authenticated;
GRANT SELECT ON public.approval_queue_v TO service_role;
REVOKE ALL ON public.approval_queue_v FROM anon;

COMMIT;
