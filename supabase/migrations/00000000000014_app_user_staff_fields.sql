-- ============================================================================
-- Staff directory fields on app_user: department, job title, an internal
-- reporting line, and a photo/signature pair for the same private-bucket +
-- path-prefix pattern every other upload in this app already uses.
-- ============================================================================

ALTER TABLE public.app_user
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS reports_to_user_id uuid,
  ADD COLUMN IF NOT EXISTS signature_path text,
  ADD COLUMN IF NOT EXISTS photo_path text;

ALTER TABLE public.app_user
  DROP CONSTRAINT IF EXISTS app_user_reports_to_user_id_fkey;
ALTER TABLE public.app_user
  ADD CONSTRAINT app_user_reports_to_user_id_fkey
  FOREIGN KEY (reports_to_user_id) REFERENCES public.app_user(user_id) ON DELETE SET NULL;

-- ===== BUCKET =====
-- Private, tenant-scoped by path prefix (<woreda_id>/...) like every other
-- bucket here; holds both staff photos and signatures.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('staff-assets', 'staff-assets', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS staff_assets_delete_scoped ON storage.objects;
CREATE POLICY staff_assets_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'staff-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS staff_assets_insert_scoped ON storage.objects;
CREATE POLICY staff_assets_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'staff-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS staff_assets_select_scoped ON storage.objects;
CREATE POLICY staff_assets_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'staff-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS staff_assets_update_scoped ON storage.objects;
CREATE POLICY staff_assets_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'staff-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));
