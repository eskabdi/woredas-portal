-- Task 14-A (fix-task-production-readiness-v3): generalizes the workflow
-- engine onto vital_event (full 8-stage FSM, owner decision B2) and
-- rental_occupancy_request (enforcement only, zero behavior change).
-- See docs/task14a-mapping-memo.md for the full investigation this
-- migration implements -- every design choice below is explained there,
-- not repeated here.
--
-- enforce_workflow_transition() (migration 00000000000025) is already
-- entity-generic (resolves via TG_TABLE_NAME) -- this migration attaches
-- it to two new tables and seeds their transitions. It is NOT redefined
-- here; credential_request/residence_credential behavior is untouched by
-- construction.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. vital_event status CHECK -- superset extension. Every as-built value
--    stays legal; three new stages added for the payment gate + system
--    terminal.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vital_event DROP CONSTRAINT vital_event_status_check;
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_status_check
  CHECK (status = ANY (ARRAY[
    'draft', 'submitted', 'under_review', 'verified', 'pending_approval',
    'returned', 'approval_returned', 'rejected', 'approved',
    'awaiting_payment', 'paid', 'registered', 'issued'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Generic workflow_status_history -- house pattern RLS. Written by the
--    engine for vital_event and rental_occupancy_request going forward.
--    credential_status_history/credential_request_status_history are
--    UNCHANGED (still app-written, per the task's own instruction).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workflow_status_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id          uuid NOT NULL REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  entity             text NOT NULL,
  entity_id          uuid NOT NULL,
  old_status         text,
  new_status         text NOT NULL,
  changed_at         timestamptz NOT NULL DEFAULT now(),
  changed_by_user_id uuid REFERENCES public.app_user(user_id),
  change_reason      text
);

CREATE INDEX IF NOT EXISTS workflow_status_history_entity_idx
  ON public.workflow_status_history (entity, entity_id, changed_at);

ALTER TABLE public.workflow_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_status_history_select ON public.workflow_status_history
  FOR SELECT TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id());

-- Insert-only by convention (matches audit_log) -- written exclusively by
-- the trigger below (SECURITY DEFINER), never directly by a client. No
-- INSERT policy for `authenticated` at all: only functions running as the
-- table owner can write it, closing off a client-forged history row.

CREATE OR REPLACE FUNCTION public.log_workflow_status_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.workflow_status_history
    (woreda_id, entity, entity_id, old_status, new_status, changed_by_user_id, change_reason)
  VALUES
    (NEW.woreda_id, TG_TABLE_NAME, (to_jsonb(NEW) ->> TG_ARGV[0])::uuid,
     OLD.status, NEW.status, auth.uid(),
     COALESCE(NEW.return_reason, NEW.reject_reason));

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.log_workflow_status_history() IS
  'Generic AFTER UPDATE history writer for the shared workflow engine -- '
  'parameterized by the entity''s PK column name via TG_ARGV[0], mirroring '
  'log_workflow_transition()''s own audit_log writer. credential_request/ '
  'residence_credential keep their existing app-written *_status_history '
  'tables unchanged; this is the new generic table for vital_event and '
  'rental_occupancy_request.';

-- ---------------------------------------------------------------------------
-- 3. vital_event RLS widened to the full granular permission set the new
--    FSM needs someone to exercise. Additive -- civil.register stays in
--    the array, nothing that worked before stops working.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS vital_event_insert ON public.vital_event;
CREATE POLICY vital_event_insert ON public.vital_event
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin() OR (
      woreda_id = get_user_woreda_id() AND
      user_has_any_perm(ARRAY['civil.register', 'civil.create_event'])
    )
  );

DROP POLICY IF EXISTS vital_event_update ON public.vital_event;
CREATE POLICY vital_event_update ON public.vital_event
  FOR UPDATE TO authenticated
  USING (
    is_super_admin() OR (
      woreda_id = get_user_woreda_id() AND
      user_has_any_perm(ARRAY[
        'civil.register', 'civil.approve', 'civil.create_event', 'civil.submit',
        'civil.resubmit', 'civil.verify', 'civil.return', 'civil.reject',
        'civil.record_payment'
      ])
    )
  )
  WITH CHECK (
    is_super_admin() OR (
      woreda_id = get_user_woreda_id() AND
      user_has_any_perm(ARRAY[
        'civil.register', 'civil.approve', 'civil.create_event', 'civil.submit',
        'civil.resubmit', 'civil.verify', 'civil.return', 'civil.reject',
        'civil.record_payment'
      ])
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Attach the shared engine to vital_event and rental_occupancy_request.
--    zz_ prefix so it fires after trg_force_actor (name-order, matching the
--    existing credential_request wiring exactly).
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.vital_event;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_log_workflow_status_history ON public.vital_event;
CREATE TRIGGER zz_log_workflow_status_history
  AFTER UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_status_history('vital_event_id');

DROP TRIGGER IF EXISTS zz_enforce_workflow_transition ON public.rental_occupancy_request;
CREATE TRIGGER zz_enforce_workflow_transition
  BEFORE UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_transition();

DROP TRIGGER IF EXISTS zz_log_workflow_status_history ON public.rental_occupancy_request;
CREATE TRIGGER zz_log_workflow_status_history
  AFTER UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION public.log_workflow_status_history('rental_request_id');

-- ---------------------------------------------------------------------------
-- 5. vital_event FSM seed (B2, full 8-stage). draft->submitted is seeded
--    for completeness (mirrors credential_request's own unused-but-legal
--    draft->submitted edge) even though every INSERT path writes
--    'submitted' directly today.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('vital_event', 'draft',             'submitted',        'civil.submit',         false, 'Stage 1: initial submission'),
  ('vital_event', 'submitted',         'under_review',     'civil.verify',         false, 'Stage 2: intake into review'),
  ('vital_event', 'under_review',      'verified',         'civil.verify',         false, 'Stage 2: verification passed'),
  ('vital_event', 'under_review',      'returned',         'civil.return',         false, 'Stage 2: returned for correction'),
  ('vital_event', 'returned',          'under_review',     'civil.resubmit',       false, 'Resubmission after return'),
  ('vital_event', 'verified',          'pending_approval',  'civil.approve',        false, 'Stage 3: sent for approval'),
  ('vital_event', 'pending_approval',  'approved',          'civil.approve',        false, 'Stage 3: approved'),
  ('vital_event', 'pending_approval',  'returned',          'civil.return',         false, 'Stage 3: returned to registrar'),
  ('vital_event', 'pending_approval',  'rejected',          'civil.reject',         false, 'Stage 3: rejected (terminal)'),
  ('vital_event', 'approved',          'awaiting_payment',  'civil.record_payment', false, 'Stage 4: payment collection opened'),
  ('vital_event', 'awaiting_payment',  'paid',              'civil.record_payment', false, 'Stage 4: payment recorded (zero-fee writes a zero-value payment)'),
  ('vital_event', 'paid',              'registered',        NULL,                   true,  'System: registration finalized, side effects fire here (B2)')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. rental_occupancy_request FSM seed -- as-built transitions only
--    (traced from the live route code, docs/task14a-mapping-memo.md §2).
--    Enforcement-only: no new status, no new permission, no behavior
--    change for the one path the app actually drives today.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note) VALUES
  ('rental_occupancy_request', 'submitted',    'verified', 'rental.create',  false, 'As-built: verify from initial submission'),
  ('rental_occupancy_request', 'under_review', 'verified', 'rental.create',  false, 'As-built: verify from under_review (never written today, seeded for the CHECK-legal value)'),
  ('rental_occupancy_request', 'returned',     'verified', 'rental.create',  false, 'As-built: re-verify after return'),
  ('rental_occupancy_request', 'submitted',    'returned', 'rental.create',  false, 'As-built: return for correction'),
  ('rental_occupancy_request', 'under_review', 'returned', 'rental.create',  false, 'As-built: return from under_review (never written today, seeded for the CHECK-legal value)'),
  ('rental_occupancy_request', 'verified',     'approved', 'rental.approve', false, 'As-built: approval'),
  ('rental_occupancy_request', 'verified',     'rejected', 'rental.approve', false, 'As-built: rejection (terminal)')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

COMMIT;
