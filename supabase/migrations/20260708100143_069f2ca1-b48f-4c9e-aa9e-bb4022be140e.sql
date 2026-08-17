
CREATE POLICY "credreq_docs_select_scoped" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'credential-request-documents' AND (public.is_super_admin() OR public.storage_path_woreda_id(name) = public.get_user_woreda_id()));

CREATE POLICY "credreq_docs_insert_scoped" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'credential-request-documents' AND (public.is_super_admin() OR public.storage_path_woreda_id(name) = public.get_user_woreda_id()));

CREATE POLICY "credreq_docs_update_scoped" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'credential-request-documents' AND (public.is_super_admin() OR public.storage_path_woreda_id(name) = public.get_user_woreda_id()));

CREATE POLICY "credreq_docs_delete_scoped" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'credential-request-documents' AND (public.is_super_admin() OR public.storage_path_woreda_id(name) = public.get_user_woreda_id()));
