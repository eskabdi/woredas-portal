-- Kebele Rental Houses Management -- Phase 1, PD-09 UI wiring.
--
-- The workflow-fsm-review agent's finding 4: 00072 seeded
-- verified -> approval_returned -> under_review but no route ever wrote
-- either status, so the edge was unreachable from the application --
-- exactly the AF-18 "CHECK-legal but unreachable" pattern this same phase
-- exists to close elsewhere, reopened by this migration's own addition.
--
-- This codebase's own existing convention for the clerk-level return
-- (submitted/under_review -> returned) is a single hop back to 'verified'
-- driven by the same Verify action and permission (rental.create) that
-- handles a fresh submission -- there is no separate "resubmit" step. This
-- migration adds the approver-level return's own direct edge to match that
-- convention exactly, rather than requiring a second, unused hop through
-- 'under_review'. The two 00072 rows (verified -> approval_returned,
-- approval_returned -> under_review) are left in place -- additive-only,
-- no DROP -- but only the new direct edge is wired to a UI action; the
-- under_review hop stays legal-but-unused, same disposition as AF-18.
--
-- ADDITIVE. No DROP of any row, constraint or column.

BEGIN;

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system)
VALUES ('rental_occupancy_request', 'approval_returned', 'verified', 'rental.create', false)
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

COMMIT;
