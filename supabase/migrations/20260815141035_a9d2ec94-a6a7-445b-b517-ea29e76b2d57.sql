-- ============ SERVICE TYPE CATALOG ============
CREATE TABLE public.service_type (
  service_type_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_am TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'letter',
  fee_amount NUMERIC NOT NULL DEFAULT 0,
  requires_payment BOOLEAN NOT NULL DEFAULT false,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  required_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  letter_body_template TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT service_type_code_unique UNIQUE (woreda_id, code),
  CONSTRAINT service_type_category_chk CHECK (category IN ('letter','complaint'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_type TO authenticated;
GRANT ALL ON public.service_type TO service_role;
ALTER TABLE public.service_type ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_type_select" ON public.service_type FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
CREATE POLICY "service_type_insert" ON public.service_type FOR INSERT TO authenticated
  WITH CHECK ((public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
    AND (public.is_super_admin() OR public.user_has_any_perm(ARRAY['tenant.manage'])));
CREATE POLICY "service_type_update" ON public.service_type FOR UPDATE TO authenticated
  USING ((public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
    AND (public.is_super_admin() OR public.user_has_any_perm(ARRAY['tenant.manage'])));
CREATE POLICY "service_type_delete" ON public.service_type FOR DELETE TO authenticated
  USING ((public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
    AND (public.is_super_admin() OR public.user_has_any_perm(ARRAY['tenant.manage'])));

CREATE TRIGGER service_type_set_updated_at BEFORE UPDATE ON public.service_type
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SEQUENCE ============
CREATE TABLE public.service_request_sequence (
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  seq_year SMALLINT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (woreda_id, seq_year)
);
GRANT SELECT, INSERT, UPDATE ON public.service_request_sequence TO authenticated;
GRANT ALL ON public.service_request_sequence TO service_role;
ALTER TABLE public.service_request_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_request_sequence_read" ON public.service_request_sequence FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

-- ============ SERVICE REQUEST ============
CREATE TABLE public.service_request (
  service_request_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  request_number TEXT NOT NULL,
  service_type_id UUID NOT NULL REFERENCES public.service_type(service_type_id),
  category TEXT NOT NULL DEFAULT 'letter',
  resident_id UUID REFERENCES public.resident(resident_id),
  household_id UUID REFERENCES public.household(household_id),
  kebele_id UUID REFERENCES public.kebele(kebele_id),
  applicant_name TEXT,
  applicant_phone TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  priority TEXT NOT NULL DEFAULT 'normal',
  purpose TEXT,
  addressed_to TEXT,
  details TEXT,
  subject TEXT,
  respondent_name TEXT,
  incident_date DATE,
  incident_place TEXT,
  fee_amount NUMERIC NOT NULL DEFAULT 0,
  verification_checklist JSONB,
  return_reason TEXT,
  reject_reason TEXT,
  resolution_notes TEXT,
  requested_by_user_id UUID REFERENCES public.app_user(user_id),
  verified_by_user_id UUID REFERENCES public.app_user(user_id),
  verified_at TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES public.app_user(user_id),
  approval_decision_at TIMESTAMPTZ,
  issued_by_user_id UUID REFERENCES public.app_user(user_id),
  issued_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  payment_id UUID REFERENCES public.payment(payment_id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT service_request_category_chk CHECK (category IN ('letter','complaint')),
  CONSTRAINT service_request_priority_chk CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT service_request_status_chk CHECK (status IN (
    'draft','submitted','under_review','returned','pending_approval','approval_returned',
    'approved','rejected','awaiting_payment','paid','issued','in_progress','resolved','closed'))
);

CREATE INDEX idx_service_request_woreda_status ON public.service_request(woreda_id, status);
CREATE INDEX idx_service_request_resident ON public.service_request(resident_id);
CREATE INDEX idx_service_request_kebele ON public.service_request(kebele_id);
CREATE UNIQUE INDEX idx_service_request_number ON public.service_request(request_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_request TO authenticated;
GRANT ALL ON public.service_request TO service_role;
ALTER TABLE public.service_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_request_select" ON public.service_request FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
CREATE POLICY "service_request_insert" ON public.service_request FOR INSERT TO authenticated
  WITH CHECK (woreda_id = public.get_user_woreda_id()
    AND public.user_has_any_perm(ARRAY['service.create','complaint.manage','tenant.manage']));
CREATE POLICY "service_request_update" ON public.service_request FOR UPDATE TO authenticated
  USING (woreda_id = public.get_user_woreda_id()
    AND public.user_has_any_perm(ARRAY['service.create','service.verify','service.approve','service.issue','complaint.manage','tenant.manage']));
CREATE POLICY "service_request_delete" ON public.service_request FOR DELETE TO authenticated
  USING (woreda_id = public.get_user_woreda_id() AND public.user_has_any_perm(ARRAY['tenant.manage']));

CREATE TRIGGER service_request_set_updated_at BEFORE UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('requested_by_user_id','verified_by_user_id','approved_by_user_id','issued_by_user_id');

CREATE OR REPLACE FUNCTION public.assign_service_request_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.category WHEN 'complaint' THEN 'CMP' ELSE 'SRV' END;
  INSERT INTO public.service_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = service_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.request_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_service_request_number BEFORE INSERT ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.assign_service_request_number();

REVOKE EXECUTE ON FUNCTION public.assign_service_request_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_service_request_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.assign_service_request_number() FROM authenticated;

-- ============ ATTACHMENTS ============
CREATE TABLE public.service_request_attachment (
  attachment_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  service_request_id UUID NOT NULL REFERENCES public.service_request(service_request_id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  content_type TEXT,
  uploaded_by_user_id UUID REFERENCES public.app_user(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_request_attachment TO authenticated;
GRANT ALL ON public.service_request_attachment TO service_role;
ALTER TABLE public.service_request_attachment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_request_attachment_select" ON public.service_request_attachment FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
CREATE POLICY "service_request_attachment_insert" ON public.service_request_attachment FOR INSERT TO authenticated
  WITH CHECK (woreda_id = public.get_user_woreda_id()
    AND public.user_has_any_perm(ARRAY['service.create','service.verify','complaint.manage','tenant.manage']));
CREATE POLICY "service_request_attachment_update" ON public.service_request_attachment FOR UPDATE TO authenticated
  USING (woreda_id = public.get_user_woreda_id()
    AND public.user_has_any_perm(ARRAY['service.create','service.verify','complaint.manage','tenant.manage']));
CREATE POLICY "service_request_attachment_delete" ON public.service_request_attachment FOR DELETE TO authenticated
  USING (woreda_id = public.get_user_woreda_id()
    AND public.user_has_any_perm(ARRAY['service.create','complaint.manage','tenant.manage']));

CREATE TRIGGER service_request_attachment_set_updated_at BEFORE UPDATE ON public.service_request_attachment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.service_request_attachment
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('uploaded_by_user_id');

-- ============ STATUS HISTORY ============
CREATE TABLE public.service_request_status_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_request_id UUID NOT NULL REFERENCES public.service_request(service_request_id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by_user_id UUID REFERENCES public.app_user(user_id),
  change_reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.service_request_status_history TO authenticated;
GRANT ALL ON public.service_request_status_history TO service_role;
ALTER TABLE public.service_request_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_request_status_history_select" ON public.service_request_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.service_request sr
    WHERE sr.service_request_id = service_request_status_history.service_request_id
      AND (public.is_super_admin() OR sr.woreda_id = public.get_user_woreda_id())));
CREATE POLICY "service_request_status_history_insert" ON public.service_request_status_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_request sr
    WHERE sr.service_request_id = service_request_status_history.service_request_id
      AND sr.woreda_id = public.get_user_woreda_id()));

CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.service_request_status_history
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('changed_by_user_id');

-- ============ PAYMENT LINK ============
ALTER TABLE public.payment
  ADD COLUMN service_request_id UUID REFERENCES public.service_request(service_request_id);

-- ============ PERMISSIONS ============
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.revoke','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read']
    ELSE ARRAY[]::text[]
  END
$function$;

-- ============ APPROVAL QUEUE VIEW ============
CREATE VIEW public.approval_queue_v
WITH (security_invoker = true) AS
  SELECT
    'service'::TEXT AS work_type,
    sr.service_request_id AS item_id,
    sr.request_number AS reference_number,
    sr.status AS stage,
    sr.woreda_id,
    sr.kebele_id,
    sr.resident_id,
    sr.priority,
    st.name_am AS subtype_am,
    st.name_en AS subtype_en,
    sr.requested_by_user_id,
    sr.created_at,
    sr.updated_at
  FROM public.service_request sr
  JOIN public.service_type st ON st.service_type_id = sr.service_type_id
  WHERE sr.status IN ('submitted','under_review','pending_approval','awaiting_payment','returned','approval_returned','in_progress')

  UNION ALL
  SELECT
    'credential'::TEXT,
    cr.credential_request_id,
    cr.request_number,
    cr.status,
    cr.woreda_id,
    cr.issuing_kebele_id,
    cr.resident_id,
    'normal'::TEXT,
    cr.credential_type,
    cr.credential_type,
    cr.requested_by_user_id,
    cr.created_at,
    cr.updated_at
  FROM public.credential_request cr
  WHERE cr.status IN ('submitted','under_review','pending_approval','awaiting_payment','returned','approval_returned','ready_to_print')

  UNION ALL
  SELECT
    'civil'::TEXT,
    ve.vital_event_id,
    ve.event_number,
    ve.status,
    ve.woreda_id,
    NULL::UUID,
    ve.resident_id,
    'normal'::TEXT,
    ve.event_type,
    ve.event_type,
    ve.requested_by_user_id,
    ve.created_at,
    ve.updated_at
  FROM public.vital_event ve
  WHERE ve.status IN ('submitted','under_review','pending_approval','returned','approval_returned')

  UNION ALL
  SELECT
    'rental'::TEXT,
    ror.rental_request_id,
    ror.request_number,
    ror.status,
    ror.woreda_id,
    krh.kebele_id,
    ror.resident_id,
    'normal'::TEXT,
    ror.request_type,
    ror.request_type,
    ror.requested_by_user_id,
    ror.created_at,
    ror.updated_at
  FROM public.rental_occupancy_request ror
  LEFT JOIN public.kebele_rental_house krh ON krh.rental_house_id = ror.rental_house_id
  WHERE ror.status IN ('submitted','under_review','verified','pending_approval','returned','awaiting_payment');

GRANT SELECT ON public.approval_queue_v TO authenticated;
GRANT ALL ON public.approval_queue_v TO service_role;

-- ============ STORAGE POLICIES ============
CREATE POLICY "service_docs_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'service-request-documents'
    AND (public.is_super_admin() OR public.storage_path_woreda_id(name) = public.get_user_woreda_id()));
CREATE POLICY "service_docs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'service-request-documents'
    AND public.storage_path_woreda_id(name) = public.get_user_woreda_id());
CREATE POLICY "service_docs_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'service-request-documents'
    AND public.storage_path_woreda_id(name) = public.get_user_woreda_id());
CREATE POLICY "service_docs_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'service-request-documents'
    AND public.storage_path_woreda_id(name) = public.get_user_woreda_id());

-- ============ SEED CATALOG PER WOREDA ============
INSERT INTO public.service_type (woreda_id, code, name_am, name_en, category, fee_amount, requires_payment, requires_approval, sort_order)
SELECT w.woreda_id, v.code, v.name_am, v.name_en, v.category, v.fee, v.req_pay, true, v.ord
FROM public.woreda w
CROSS JOIN (VALUES
  ('UNEMP','የስራ አጥነት ማረጋገጫ ደብዳቤ','Unemployment Evidence Letter','letter',0::NUMERIC,false,1),
  ('INCOME','የገቢ ማረጋገጫ ደብዳቤ','Income Confirmation Letter','letter',50::NUMERIC,true,2),
  ('NOINCOME','ገቢ የለውም ማረጋገጫ ደብዳቤ','No-Income Confirmation Letter','letter',0::NUMERIC,false,3),
  ('MARITAL','የጋብቻ ሁኔታ ማረጋገጫ ደብዳቤ','Marital Status Letter','letter',50::NUMERIC,true,4),
  ('GUARANTEE','የዋስትና ደብዳቤ','Guarantee Letter','letter',100::NUMERIC,true,5),
  ('RESIDENCE','የመኖሪያ አድራሻ ማረጋገጫ ደብዳቤ','Residence Confirmation Letter','letter',50::NUMERIC,true,6),
  ('RECOMMEND','የምስክር ወረቀት / ድጋፍ ደብዳቤ','Recommendation Letter','letter',0::NUMERIC,false,7),
  ('BUSINESS','የንግድ ስራ ድጋፍ ደብዳቤ','Business Support Letter','letter',100::NUMERIC,true,8),
  ('CMP_LAND','የቦታ / ቤት ክርክር ቅሬታ','Land / House Dispute Complaint','complaint',0::NUMERIC,false,20),
  ('CMP_DELAY','የአገልግሎት መዘግየት ቅሬታ','Service Delay Complaint','complaint',0::NUMERIC,false,21),
  ('CMP_STAFF','የሰራተኛ ስነ ምግባር ቅሬታ','Staff Misconduct Complaint','complaint',0::NUMERIC,false,22),
  ('CMP_INFRA','የመሠረተ ልማት ቅሬታ','Utility / Infrastructure Complaint','complaint',0::NUMERIC,false,23),
  ('CMP_OTHER','ሌላ ቅሬታ','Other Complaint','complaint',0::NUMERIC,false,24)
) AS v(code, name_am, name_en, category, fee, req_pay, ord)
ON CONFLICT (woreda_id, code) DO NOTHING;

-- ============ MODULE FLAG ============
ALTER TABLE public.tenant_module_config DROP CONSTRAINT IF EXISTS tenant_module_config_module_key_check;
ALTER TABLE public.tenant_module_config ADD CONSTRAINT tenant_module_config_module_key_check
  CHECK (module_key = ANY (ARRAY['credentials','civil_registration','revenue','reports','audit','rental_houses','services','approvals']));

INSERT INTO public.tenant_module_config (woreda_id, module_key, is_enabled)
SELECT woreda_id, 'services', true FROM public.woreda
ON CONFLICT (woreda_id, module_key) DO NOTHING;