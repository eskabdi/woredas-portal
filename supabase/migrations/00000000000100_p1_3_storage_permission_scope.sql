-- ============================================================================
-- P1-3 (2026-09-24 audit, WP-DB-002): permission-scoped storage policies.
--
-- All 36 tenant storage.objects policies (9 buckets x SELECT/INSERT/UPDATE/
-- DELETE) checked only that the object's path prefix is the caller's woreda.
-- Any active staff account could therefore read every scanned legal
-- document and photo in its woreda, overwrite the woreda's logo and
-- signatures, and delete evidence attached to a credential, rental or
-- service request.
--
-- Each policy keeps its bucket and path-prefix tenant check and adds a
-- permission (resolved by current_permissions() via user_has_module_perm()
-- / user_has_any_perm(), active accounts only since migration 97):
--
--   bucket                        read                     write                         delete
--   tenant-assets                 tenant                   tenant.manage                 tenant.manage
--   staff-assets                  tenant                   user.manage|tenant.manage     user.manage|tenant.manage
--   resident-photos               resident.*|household.*,  resident.create|update        resident.create|update
--                                 or the photo of a resident the caller can read
--                                 (print_officer's card print path)
--   resident-documents            resident.*|household.*   resident.create|update        resident.update (*)
--   resident-clearance-letters    resident.*|household.*   resident.create|update        tenant.manage
--   credential-request-documents  credential.*             credential request makers     tenant.manage
--   attachments                   credential.*|civil.*     credential/civil makers       tenant.manage
--   service-request-documents     service.*|complaint.*    service makers, complaint.manage  tenant.manage
--   rental-request-documents      rental.*                 rental.create|approve|vacate  tenant.manage
--
--   (*) the resident_document row's own delete policy is resident.update and
--   the profile's delete button is gated on it, so the object follows the row.
--   The other document buckets have no delete path in the UI, so deleting
--   evidence there is tenant.manage only.
--
-- tenant-assets / staff-assets stay readable tenant-wide: logos, seals and
-- signatures are rendered on every printed document and in the shell.
-- credential-templates (platform bucket) is unchanged. The super_admin
-- branch is unchanged (P1-7 residual). service_docs_* insert/update/delete
-- never had a super_admin branch; they keep the same shape as the others
-- now.
--
-- Additive: ALTER POLICY in place only. No DROP.
-- ============================================================================

-- attachments
ALTER POLICY attachments_select_scoped ON storage.objects
  USING (bucket_id = 'attachments'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_module_perm(ARRAY['credential', 'civil'])))));
ALTER POLICY attachments_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'attachments'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['credential.create_request', 'credential.issue', 'credential.submit', 'credential.resubmit', 'civil.create_event', 'civil.register', 'civil.submit', 'civil.resubmit'])))));
ALTER POLICY attachments_update_scoped ON storage.objects
  USING (bucket_id = 'attachments'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['credential.create_request', 'credential.issue', 'credential.submit', 'credential.resubmit', 'civil.create_event', 'civil.register', 'civil.submit', 'civil.resubmit'])))))
  WITH CHECK (bucket_id = 'attachments'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['credential.create_request', 'credential.issue', 'credential.submit', 'credential.resubmit', 'civil.create_event', 'civil.register', 'civil.submit', 'civil.resubmit'])))));
ALTER POLICY attachments_delete_scoped ON storage.objects
  USING (bucket_id = 'attachments'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));

-- resident-clearance-letters
ALTER POLICY clearance_select_scoped ON storage.objects
  USING (bucket_id = 'resident-clearance-letters'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_module_perm(ARRAY['resident', 'household'])))));
ALTER POLICY clearance_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'resident-clearance-letters'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));
ALTER POLICY clearance_update_scoped ON storage.objects
  USING (bucket_id = 'resident-clearance-letters'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))))
  WITH CHECK (bucket_id = 'resident-clearance-letters'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));
ALTER POLICY clearance_delete_scoped ON storage.objects
  USING (bucket_id = 'resident-clearance-letters'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));

-- credential-request-documents
ALTER POLICY credreq_docs_select_scoped ON storage.objects
  USING (bucket_id = 'credential-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_module_perm(ARRAY['credential'])))));
ALTER POLICY credreq_docs_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'credential-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['credential.create_request', 'credential.issue', 'credential.submit', 'credential.resubmit'])))));
ALTER POLICY credreq_docs_update_scoped ON storage.objects
  USING (bucket_id = 'credential-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['credential.create_request', 'credential.issue', 'credential.submit', 'credential.resubmit'])))))
  WITH CHECK (bucket_id = 'credential-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['credential.create_request', 'credential.issue', 'credential.submit', 'credential.resubmit'])))));
ALTER POLICY credreq_docs_delete_scoped ON storage.objects
  USING (bucket_id = 'credential-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));

-- rental-request-documents
ALTER POLICY rentalreq_docs_select_scoped ON storage.objects
  USING (bucket_id = 'rental-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_module_perm(ARRAY['rental'])))));
ALTER POLICY rentalreq_docs_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'rental-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['rental.create', 'rental.approve', 'rental.vacate'])))));
ALTER POLICY rentalreq_docs_update_scoped ON storage.objects
  USING (bucket_id = 'rental-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['rental.create', 'rental.approve', 'rental.vacate'])))))
  WITH CHECK (bucket_id = 'rental-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['rental.create', 'rental.approve', 'rental.vacate'])))));
ALTER POLICY rentalreq_docs_delete_scoped ON storage.objects
  USING (bucket_id = 'rental-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));

-- resident-documents
ALTER POLICY resident_documents_select_scoped ON storage.objects
  USING (bucket_id = 'resident-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_module_perm(ARRAY['resident', 'household'])))));
ALTER POLICY resident_documents_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'resident-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));
ALTER POLICY resident_documents_update_scoped ON storage.objects
  USING (bucket_id = 'resident-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))))
  WITH CHECK (bucket_id = 'resident-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));
ALTER POLICY resident_documents_delete_scoped ON storage.objects
  USING (bucket_id = 'resident-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.update'])))));

-- resident-photos
ALTER POLICY resident_photos_select_scoped ON storage.objects
  USING (bucket_id = 'resident-photos'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND ((SELECT public.user_has_module_perm(ARRAY['resident', 'household'])) OR EXISTS (SELECT 1 FROM public.resident r WHERE r.photo_url = objects.name)))));
ALTER POLICY resident_photos_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'resident-photos'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));
ALTER POLICY resident_photos_update_scoped ON storage.objects
  USING (bucket_id = 'resident-photos'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))))
  WITH CHECK (bucket_id = 'resident-photos'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));
ALTER POLICY resident_photos_delete_scoped ON storage.objects
  USING (bucket_id = 'resident-photos'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['resident.create', 'resident.update'])))));

-- staff-assets
ALTER POLICY staff_assets_select_scoped ON storage.objects
  USING (bucket_id = 'staff-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id())));
ALTER POLICY staff_assets_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'staff-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['user.manage', 'tenant.manage'])))));
ALTER POLICY staff_assets_update_scoped ON storage.objects
  USING (bucket_id = 'staff-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['user.manage', 'tenant.manage'])))))
  WITH CHECK (bucket_id = 'staff-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['user.manage', 'tenant.manage'])))));
ALTER POLICY staff_assets_delete_scoped ON storage.objects
  USING (bucket_id = 'staff-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['user.manage', 'tenant.manage'])))));

-- tenant-assets
ALTER POLICY tenant_assets_select_scoped ON storage.objects
  USING (bucket_id = 'tenant-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id())));
ALTER POLICY tenant_assets_insert_scoped ON storage.objects
  WITH CHECK (bucket_id = 'tenant-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));
ALTER POLICY tenant_assets_update_scoped ON storage.objects
  USING (bucket_id = 'tenant-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))))
  WITH CHECK (bucket_id = 'tenant-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));
ALTER POLICY tenant_assets_delete_scoped ON storage.objects
  USING (bucket_id = 'tenant-assets'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));

-- service-request-documents (policies predate the _scoped naming)
ALTER POLICY service_docs_select ON storage.objects
  USING (bucket_id = 'service-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_module_perm(ARRAY['service', 'complaint'])))));
ALTER POLICY service_docs_insert ON storage.objects
  WITH CHECK (bucket_id = 'service-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['service.create', 'service.submit', 'service.resubmit', 'service.verify', 'service.issue', 'complaint.manage'])))));
ALTER POLICY service_docs_update ON storage.objects
  USING (bucket_id = 'service-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['service.create', 'service.submit', 'service.resubmit', 'service.verify', 'service.issue', 'complaint.manage'])))))
  WITH CHECK (bucket_id = 'service-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['service.create', 'service.submit', 'service.resubmit', 'service.verify', 'service.issue', 'complaint.manage'])))));
ALTER POLICY service_docs_delete ON storage.objects
  USING (bucket_id = 'service-request-documents'
    AND (public.is_super_admin() OR (
         public.storage_path_woreda_id(name) = public.get_user_woreda_id()
         AND (SELECT public.user_has_any_perm(ARRAY['tenant.manage'])))));
