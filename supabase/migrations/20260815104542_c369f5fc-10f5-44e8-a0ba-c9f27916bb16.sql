CREATE POLICY "rentalreq_docs_select_scoped" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'rental-request-documents' AND (is_super_admin() OR storage_path_woreda_id(name) = get_user_woreda_id()));
CREATE POLICY "rentalreq_docs_insert_scoped" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'rental-request-documents' AND (is_super_admin() OR storage_path_woreda_id(name) = get_user_woreda_id()));
CREATE POLICY "rentalreq_docs_update_scoped" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'rental-request-documents' AND (is_super_admin() OR storage_path_woreda_id(name) = get_user_woreda_id()));
CREATE POLICY "rentalreq_docs_delete_scoped" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'rental-request-documents' AND (is_super_admin() OR storage_path_woreda_id(name) = get_user_woreda_id()));

CREATE TABLE public.rental_request_document (
  document_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rental_request_id uuid NOT NULL REFERENCES public.rental_occupancy_request(rental_request_id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('contract','clearance','id_copy','photo','other')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes integer,
  content_type text,
  uploaded_by_user_id uuid REFERENCES public.app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rental_request_document_request_idx ON public.rental_request_document (rental_request_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_request_document TO authenticated;
GRANT ALL ON public.rental_request_document TO service_role;

ALTER TABLE public.rental_request_document ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_request_document_tenant_scoped" ON public.rental_request_document FOR ALL TO authenticated
USING (is_super_admin() OR woreda_id = get_user_woreda_id())
WITH CHECK (is_super_admin() OR woreda_id = get_user_woreda_id());

CREATE TRIGGER set_rental_request_document_updated_at BEFORE UPDATE ON public.rental_request_document
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();