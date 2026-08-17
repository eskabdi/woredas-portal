-- ============================================================================
-- Storage buckets and object policies, exported from the previous project
-- with scripts/dump-storage.sql.
--
-- Runs after 00000000000000_baseline.sql, which defines the three functions
-- these policies call: storage_path_woreda_id(), is_super_admin() and
-- get_user_woreda_id().
--
-- Every bucket is private. Reads go through signed URLs, and tenant isolation
-- comes from storage_path_woreda_id(name), which derives the owning woreda
-- from the object's path prefix -- so uploads must keep writing paths of the
-- form <woreda_id>/... or they become invisible to their own tenant.
--
-- The source project also had a bucket named database_export_11_07_26. It is
-- a one-off export artifact, carries no policies and is referenced nowhere in
-- the application, so it is deliberately not recreated here.
--
-- This migration creates the buckets and their access rules. It does not copy
-- stored files; those move separately.
-- ============================================================================

-- ===== BUCKETS =====

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('credential-request-documents', 'credential-request-documents', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('credential-templates', 'credential-templates', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rental-request-documents', 'rental-request-documents', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resident-clearance-letters', 'resident-clearance-letters', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resident-photos', 'resident-photos', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('service-request-documents', 'service-request-documents', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-assets', 'tenant-assets', 'f', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ===== STORAGE POLICIES =====

DROP POLICY IF EXISTS clearance_delete_scoped ON storage.objects;
CREATE POLICY clearance_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'resident-clearance-letters'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS clearance_insert_scoped ON storage.objects;
CREATE POLICY clearance_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'resident-clearance-letters'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS clearance_select_scoped ON storage.objects;
CREATE POLICY clearance_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'resident-clearance-letters'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS clearance_update_scoped ON storage.objects;
CREATE POLICY clearance_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'resident-clearance-letters'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS credential_templates_read_all ON storage.objects;
CREATE POLICY credential_templates_read_all ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'credential-templates'::text));

DROP POLICY IF EXISTS credential_templates_write_super_admin ON storage.objects;
CREATE POLICY credential_templates_write_super_admin ON storage.objects AS PERMISSIVE FOR ALL TO authenticated USING (((bucket_id = 'credential-templates'::text) AND is_super_admin())) WITH CHECK (((bucket_id = 'credential-templates'::text) AND is_super_admin()));

DROP POLICY IF EXISTS credreq_docs_delete_scoped ON storage.objects;
CREATE POLICY credreq_docs_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'credential-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS credreq_docs_insert_scoped ON storage.objects;
CREATE POLICY credreq_docs_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'credential-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS credreq_docs_select_scoped ON storage.objects;
CREATE POLICY credreq_docs_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'credential-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS credreq_docs_update_scoped ON storage.objects;
CREATE POLICY credreq_docs_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'credential-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS rentalreq_docs_delete_scoped ON storage.objects;
CREATE POLICY rentalreq_docs_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'rental-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS rentalreq_docs_insert_scoped ON storage.objects;
CREATE POLICY rentalreq_docs_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'rental-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS rentalreq_docs_select_scoped ON storage.objects;
CREATE POLICY rentalreq_docs_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'rental-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS rentalreq_docs_update_scoped ON storage.objects;
CREATE POLICY rentalreq_docs_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'rental-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_photos_delete_scoped ON storage.objects;
CREATE POLICY resident_photos_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'resident-photos'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_photos_insert_scoped ON storage.objects;
CREATE POLICY resident_photos_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'resident-photos'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_photos_select_scoped ON storage.objects;
CREATE POLICY resident_photos_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'resident-photos'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS resident_photos_update_scoped ON storage.objects;
CREATE POLICY resident_photos_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'resident-photos'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS service_docs_delete ON storage.objects;
CREATE POLICY service_docs_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'service-request-documents'::text) AND (storage_path_woreda_id(name) = get_user_woreda_id())));

DROP POLICY IF EXISTS service_docs_insert ON storage.objects;
CREATE POLICY service_docs_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'service-request-documents'::text) AND (storage_path_woreda_id(name) = get_user_woreda_id())));

DROP POLICY IF EXISTS service_docs_select ON storage.objects;
CREATE POLICY service_docs_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'service-request-documents'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS service_docs_update ON storage.objects;
CREATE POLICY service_docs_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'service-request-documents'::text) AND (storage_path_woreda_id(name) = get_user_woreda_id())));

DROP POLICY IF EXISTS tenant_assets_delete_scoped ON storage.objects;
CREATE POLICY tenant_assets_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'tenant-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS tenant_assets_insert_scoped ON storage.objects;
CREATE POLICY tenant_assets_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'tenant-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS tenant_assets_select_scoped ON storage.objects;
CREATE POLICY tenant_assets_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'tenant-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));

DROP POLICY IF EXISTS tenant_assets_update_scoped ON storage.objects;
CREATE POLICY tenant_assets_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'tenant-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id()))));
