-- Task 12 (fix-task-production-readiness-v3): wires Stage 1 intake's
-- document upload onto Task 11's generic `attachment` table instead of
-- `credential_request.supporting_document_path` (a single legacy field).
--
-- 1. `attachment` gets a new `attachment_type` column -- `entity`/`entity_id`
--    already say WHICH row an attachment is about; this says WHAT KIND of
--    file it is for that row, since one credential_request can now have
--    several (photo, police report, supporting document, correction
--    evidence). Additive only.
--
-- 2. Backfill: every existing credential_request with a
--    supporting_document_path becomes one attachment row
--    (attachment_type = 'supporting_doc'). `checksum` is NOT NULL on this
--    table, and there is no real checksum to backfill for a file uploaded
--    before this migration existed -- rather than compute one against
--    content this migration never reads (or silently invent a value that
--    LOOKS like a real SHA-256), these rows get the literal sentinel
--    'legacy-unchecked', which is not a valid hex digest and is meant to
--    be visibly distinguishable from a real checksum wherever it's shown.
--
-- 3. `supporting_document_path`/`_name`/`_content_type` on credential_request
--    are KEPT (guardrail 1: no DROP) -- the app stops writing new values
--    through them, but they stay as the historical record for rows created
--    before this migration. See docs/erd.md.

BEGIN;

ALTER TABLE public.attachment ADD COLUMN IF NOT EXISTS attachment_type text;

INSERT INTO public.attachment (woreda_id, entity, entity_id, file_name, mime, size_bytes, checksum, storage_path, uploaded_by, uploaded_at, attachment_type)
SELECT cr.woreda_id, 'credential_request', cr.credential_request_id,
       COALESCE(cr.supporting_document_name, 'document'),
       COALESCE(cr.supporting_document_content_type, 'application/octet-stream'),
       0, 'legacy-unchecked', cr.supporting_document_path, cr.requested_by_user_id, cr.created_at,
       'supporting_doc'
  FROM public.credential_request cr
 WHERE cr.supporting_document_path IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.attachment a
      WHERE a.entity = 'credential_request'
        AND a.entity_id = cr.credential_request_id
        AND a.storage_path = cr.supporting_document_path
   );

COMMIT;
