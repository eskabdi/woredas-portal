-- Task 12.1 (fix-task-production-readiness-v3): the intake form's
-- request-type-conditional fields -- a police report number for
-- reissue_stolen, and the fields-to-correct multi-select + reason for
-- reissue_correction -- have no backing columns on credential_request.
-- Additive only, per guardrail 1.

BEGIN;

ALTER TABLE public.credential_request ADD COLUMN IF NOT EXISTS police_report_number text;
ALTER TABLE public.credential_request ADD COLUMN IF NOT EXISTS correction_fields text[];
ALTER TABLE public.credential_request ADD COLUMN IF NOT EXISTS correction_reason text;

COMMIT;
