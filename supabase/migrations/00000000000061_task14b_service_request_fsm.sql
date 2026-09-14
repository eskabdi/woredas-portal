-- Task 14-B (fix-task-production-readiness-v3): brings service_request
-- (category='letter') under the full 8-stage gated FSM (owner decision B3)
-- and attaches the shared engine to category='complaint' for enforcement
-- only, zero behavior change. See docs/task14b-mapping-memo.md for the full
-- investigation this migration implements.
--
-- enforce_workflow_transition() (migration 00000000000025) is already
-- entity-generic -- this migration only attaches it to service_request and
-- seeds its transitions; the function body is not touched, so
-- credential_request/residence_credential/vital_event/rental_occupancy_request
-- behavior is untouched by construction.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. service_request status CHECK -- superset extension. Every as-built
--    value survives; `verified` and `completed` are new.
-- ---------------------------------------------------------------------------

ALTER TABLE public.service_request DROP CONSTRAINT service_request_status_chk;
ALTER TABLE public.service_request ADD CONSTRAINT service_request_status_chk
  CHECK (status = ANY (ARRAY[
    'draft', 'submitted', 'under_review', 'verified', 'returned',
    'pending_approval', 'approval_returned', 'approved', 'rejected',
    'awaiting_payment', 'paid', 'issued', 'completed',
    'in_progress', 'resolved', 'closed'
  ]));

-- ---------------------------------------------------------------------------
-- 2. RLS widened to the full granular permission set (additive -- coarse
--    verbs stay in the array, matching civil's migration 058 exactly).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS service_request_insert ON public.service_request;
CREATE POLICY service_request_insert ON public.service_request
  FOR INSERT TO authenticated
  WITH CHECK (
    woreda_id = get_user_woreda_id() AND
    user_has_any_perm(ARRAY[
      'service.create', 'service.submit', 'complaint.manage', 'tenant.manage'
    ])
  );

DROP POLICY IF EXISTS service_request_update ON public.service_request;
CREATE POLICY service_request_update ON public.service_request
  FOR UPDATE TO authenticated
  USING (
    woreda_id = get_user_woreda_id() AND
    user_has_any_perm(ARRAY[
      'service.create', 'service.verify', 'service.approve', 'service.issue',
      'service.submit', 'service.resubmit', 'service.return', 'service.reject',
      'service.record_payment', 'service.issue_letter', 'service.complete',
      'complaint.manage', 'tenant.manage'
    ])
  )
  WITH CHECK (
    woreda_id = get_user_woreda_id() AND
    user_has_any_perm(ARRAY[
      'service.create', 'service.verify', 'service.approve', 'service.issue',
      'service.submit', 'service.resubmit', 'service.return', 'service.reject',
      'service.record_payment', 'service.issue_letter', 'service.complete',
      'complaint.manage', 'tenant.manage'
    ])
  );

-- ---------------------------------------------------------------------------
-- 3. Attach the shared engine + generic history writer. zz_ prefix so it
--    fires after trg_force_actor (name-order, matching the existing
--    convention exactly).
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.service_request;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_log_workflow_status_history ON public.service_request;
CREATE TRIGGER zz_log_workflow_status_history
  AFTER UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_status_history('service_request_id');

-- ---------------------------------------------------------------------------
-- 4. Letter FSM seed (B3, full 8-stage). draft->submitted seeded for
--    completeness (mirrors every other entity's own unused-but-legal
--    draft->submitted edge) even though the real form always inserts at
--    'submitted' directly.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('service_request', 'draft',             'submitted',         'service.submit',         false, 'Letter stage 1: initial submission'),
  ('service_request', 'submitted',         'under_review',      'service.verify',         false, 'Letter stage 2: intake into review'),
  ('service_request', 'under_review',      'verified',          'service.verify',         false, 'Letter stage 2: verification passed'),
  ('service_request', 'under_review',      'returned',          'service.return',         false, 'Letter stage 2: returned for correction'),
  ('service_request', 'returned',          'under_review',      'service.resubmit',       false, 'Resubmission after return'),
  ('service_request', 'verified',          'pending_approval',  'service.approve',        false, 'Letter stage 3: sent for approval'),
  ('service_request', 'pending_approval',  'approved',          'service.approve',        false, 'Letter stage 3: approved'),
  ('service_request', 'pending_approval',  'returned',          'service.return',         false, 'Letter stage 3: returned to registrar'),
  ('service_request', 'pending_approval',  'rejected',          'service.reject',         false, 'Letter stage 3: rejected (terminal)'),
  ('service_request', 'approved',          'awaiting_payment',  'service.record_payment', false, 'Letter stage 4: payment collection opened'),
  ('service_request', 'awaiting_payment',  'paid',              'service.record_payment', false, 'Letter stage 4: payment recorded (zero-fee writes a zero-value payment)'),
  ('service_request', 'paid',              'issued',            'service.issue_letter',   false, 'Letter stage 5: letter + verification token issued'),
  ('service_request', 'issued',            'completed',         'service.complete',       false, 'Letter stage 6: closed out (terminal)')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Complaint FSM seed -- as-built transitions only (traced from the live
--    route code, docs/task14b-mapping-memo.md §5). Enforcement-only: no new
--    status, no new permission, no behavior change for the path the app
--    actually drives today for category='complaint'.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('service_request', 'submitted',         'under_review',      'service.verify',  false, 'As-built (complaint): intake into review'),
  ('service_request', 'under_review',      'pending_approval',  'service.verify',  false, 'As-built (complaint): verify skips straight to pending_approval'),
  ('service_request', 'under_review',      'returned',          'service.return',  false, 'As-built (complaint): returned for correction'),
  ('service_request', 'returned',          'under_review',      'service.resubmit', false, 'As-built (complaint): resubmission after return'),
  ('service_request', 'pending_approval',  'approval_returned', 'service.return',  false, 'As-built (complaint): returned at approval stage'),
  ('service_request', 'pending_approval',  'rejected',          'service.reject',  false, 'As-built (complaint): rejected (terminal)'),
  -- nextAfterApproval() always returns 'in_progress' for a complaint (every
  -- complaint service_type has requires_payment=false), and the Approve
  -- button at pending_approval calls it directly -- 'approved' is NEVER
  -- actually reached by a real complaint (confirmed: only letters write
  -- 'approved', per the Explore pass behind this memo's §1). This is the
  -- real edge; 'pending_approval'->'approved' also exists (shared with the
  -- letter seed below, same permission) but is inert/unused for complaints.
  ('service_request', 'pending_approval',  'in_progress',       'service.approve', false, 'As-built (complaint): approve skips straight to in_progress (no fee ever required)'),
  ('service_request', 'approved',          'in_progress',       'service.issue',   false, 'Legal-but-unreached for complaints today (approved is never actually written) -- kept for symmetry/future-proofing'),
  ('service_request', 'in_progress',       'resolved',          'service.issue',   false, 'As-built (complaint): marked resolved'),
  ('service_request', 'resolved',          'closed',            'service.issue',   false, 'As-built (complaint): file closed'),
  ('service_request', 'issued',            'closed',            'service.issue',   false, 'Symmetry edge with the letter path''s own closed-adjacent value; CHECK-legal, never reached by complaints')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

COMMIT;
