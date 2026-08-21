-- ============================================================================
-- Resident documents: PDF-only records attached to a resident, with the
-- owning household snapshotted at upload time.
--
-- household_id is NOT a live join through resident.current_household_id --
-- it is copied from that column once, when the row is inserted. If the
-- resident later moves to a different household, this document stays
-- associated with the household it was uploaded under. That is deliberate:
-- it keeps a household's document list a plain `WHERE household_id = :id`
-- (no join, no drift when membership changes) and gives a stable historical
-- record rather than one that silently follows the person around.
--
-- Modeled on rental_request_document / service_request_attachment (both
-- above in the baseline), but with two owning FKs instead of one, since a
-- document belongs to exactly one resident but may also belong to a
-- household (nullable -- a resident might not currently have one).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resident_document (
  document_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  household_id uuid,
  document_label text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes integer,
  content_type text DEFAULT 'application/pdf'::text NOT NULL,
  uploaded_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT resident_document_pkey PRIMARY KEY (document_id),
  CONSTRAINT resident_document_content_type_check CHECK ((content_type = 'application/pdf'::text))
);

-- woreda_id cascades on tenant deprovisioning, matching every other
-- per-tenant table. resident_id deliberately does NOT cascade: every other
-- table referencing a resident's own records (residence_credential,
-- payment, rental_occupancy_request, ...) uses no ON DELETE clause either,
-- so a resident with any such row can't be hard-deleted without first
-- clearing them -- this table should behave the same way, not silently
-- wipe a resident's document history. (rental_request_document /
-- service_request_attachment cascade because their parent is a workflow
-- request being deleted wholesale, not a person record -- different
-- semantics, not a precedent to follow here.) household_id is SET NULL: it
-- is a denormalized snapshot, not an ownership link, so deleting a
-- household must never delete a resident's document, only drop its
-- grouping.
ALTER TABLE public.resident_document
  ADD CONSTRAINT resident_document_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES public.woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.resident_document
  ADD CONSTRAINT resident_document_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.resident(resident_id);
ALTER TABLE public.resident_document
  ADD CONSTRAINT resident_document_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(household_id) ON DELETE SET NULL;
ALTER TABLE public.resident_document
  ADD CONSTRAINT resident_document_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.app_user(user_id);

CREATE INDEX resident_document_resident_id_idx ON public.resident_document USING btree (resident_id);
CREATE INDEX resident_document_household_id_idx ON public.resident_document USING btree (household_id);
CREATE INDEX resident_document_woreda_id_idx ON public.resident_document USING btree (woreda_id);

ALTER TABLE public.resident_document ENABLE ROW LEVEL SECURITY;

-- Select is gated on resident.read OR household.read (either view is
-- enough to read the list). Insert/update/delete are resident.update only
-- -- there is no household-side write path; uploading only ever happens
-- from the owning resident's own page. No new permission keys: this
-- follows the same precedent as rental_request_document /
-- service_request_attachment, which reuse their parent entity's
-- permission rather than getting a dedicated one.
CREATE POLICY resident_document_select ON public.resident_document AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_super_admin() OR ((woreda_id = public.get_user_woreda_id()) AND public.user_has_any_perm('{resident.read,household.read}'::text[]))));

CREATE POLICY resident_document_insert ON public.resident_document AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((public.is_super_admin() OR ((woreda_id = public.get_user_woreda_id()) AND public.user_has_any_perm('{resident.update}'::text[]))));

CREATE POLICY resident_document_update ON public.resident_document AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((public.is_super_admin() OR ((woreda_id = public.get_user_woreda_id()) AND public.user_has_any_perm('{resident.update}'::text[]))))
  WITH CHECK ((public.is_super_admin() OR ((woreda_id = public.get_user_woreda_id()) AND public.user_has_any_perm('{resident.update}'::text[]))));

CREATE POLICY resident_document_delete ON public.resident_document AS PERMISSIVE FOR DELETE TO authenticated
  USING ((public.is_super_admin() OR ((woreda_id = public.get_user_woreda_id()) AND public.user_has_any_perm('{resident.update}'::text[]))));

CREATE TRIGGER set_resident_document_updated_at BEFORE UPDATE ON public.resident_document
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- force_actor_columns only overwrites uploaded_by_user_id with auth.uid()
-- if the insert already sent a non-null value for it -- the client-side
-- insert must explicitly pass uploaded_by_user_id, not omit it, or it
-- stays NULL. Matches how service_request_attachment's insert already
-- behaves.
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.resident_document
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('uploaded_by_user_id');

-- ============================================================================
-- Storage: a dedicated bucket, private and PDF-only.
--
-- Unlike the seven existing buckets (all NULL file_size_limit /
-- allowed_mime_types, relying on client-side checks only), this bucket sets
-- both at the bucket level. It's a deliberate departure: this bucket is
-- genuinely PDF-only with no mixed-type use case, so a server-side check is
-- cheap insurance against a client-side check being bypassed by calling the
-- Storage API directly with a valid session token.
--
-- What this does NOT guarantee: allowed_mime_types validates the *declared*
-- Content-Type on upload, and the table's content_type CHECK validates a
-- client-supplied string -- neither inspects the actual bytes. A caller can
-- still declare application/pdf and upload anything; the practical
-- consequence of that is react-pdf failing to render it, not a security
-- exposure on its own.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resident-documents', 'resident-documents', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS resident_documents_select_scoped ON storage.objects;
CREATE POLICY resident_documents_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'resident-documents'::text) AND (public.is_super_admin() OR (public.storage_path_woreda_id(name) = public.get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_documents_insert_scoped ON storage.objects;
CREATE POLICY resident_documents_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'resident-documents'::text) AND (public.is_super_admin() OR (public.storage_path_woreda_id(name) = public.get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_documents_update_scoped ON storage.objects;
CREATE POLICY resident_documents_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'resident-documents'::text) AND (public.is_super_admin() OR (public.storage_path_woreda_id(name) = public.get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_documents_delete_scoped ON storage.objects;
CREATE POLICY resident_documents_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'resident-documents'::text) AND (public.is_super_admin() OR (public.storage_path_woreda_id(name) = public.get_user_woreda_id()))));

-- ============================================================================
-- credential_request.supporting_document_content_type
--
-- The credential's supporting-document upload (woreda.credentials.new.tsx)
-- already allows pdf/jpeg/png but never stored which one, so the "open
-- document" viewer had no way to know how to render a given file without
-- sniffing the storage path's extension. Store it going forward; existing
-- rows are backfilled by extension as a one-time best effort (NULL stays
-- NULL where the path has no recognizable extension, and the viewer falls
-- back to a plain "open in new tab" link in that case).
-- ============================================================================

ALTER TABLE public.credential_request
  ADD COLUMN IF NOT EXISTS supporting_document_content_type text;

UPDATE public.credential_request
SET supporting_document_content_type = CASE
  WHEN supporting_document_path ~* '\.pdf$' THEN 'application/pdf'
  WHEN supporting_document_path ~* '\.png$' THEN 'image/png'
  WHEN supporting_document_path ~* '\.jpe?g$' THEN 'image/jpeg'
  ELSE NULL
END
WHERE supporting_document_path IS NOT NULL
  AND supporting_document_content_type IS NULL;
