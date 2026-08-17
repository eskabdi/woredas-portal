
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============ TABLES ============

CREATE TABLE public.woreda (
  woreda_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_code TEXT NOT NULL UNIQUE,
  woreda_name_en TEXT NOT NULL,
  woreda_name_am TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.woreda TO authenticated;
GRANT ALL ON public.woreda TO service_role;

CREATE TABLE public.kebele (
  kebele_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  kebele_number TEXT NOT NULL,
  kebele_name_en TEXT NOT NULL,
  kebele_name_am TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(woreda_id, kebele_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kebele TO authenticated;
GRANT ALL ON public.kebele TO service_role;

CREATE TABLE public.app_user (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  woreda_id UUID REFERENCES public.woreda(woreda_id),
  role TEXT NOT NULL CHECK (role IN ('super_admin','tenant_admin','civil_registrar','registry_clerk','finance_clerk','supervisor','auditor','viewer')),
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user TO authenticated;
GRANT ALL ON public.app_user TO service_role;

CREATE TABLE public.household (
  household_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  kebele_id UUID NOT NULL REFERENCES public.kebele(kebele_id),
  house_number TEXT NOT NULL,
  house_label TEXT,
  occupancy_status TEXT NOT NULL DEFAULT 'occupied' CHECK (occupancy_status IN ('occupied','vacant','demolished','transferred')),
  address_line TEXT,
  gps_lat DECIMAL(10,8),
  gps_lng DECIMAL(11,8),
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(kebele_id, house_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household TO authenticated;
GRANT ALL ON public.household TO service_role;

CREATE TABLE public.resident (
  resident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  resident_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  full_name_am TEXT,
  sex TEXT NOT NULL CHECK (sex IN ('male','female')),
  date_of_birth DATE NOT NULL,
  marital_status TEXT NOT NULL CHECK (marital_status IN ('single','married','divorced','widowed')),
  current_household_id UUID REFERENCES public.household(household_id),
  relation_to_head TEXT,
  phone_number TEXT,
  national_id_no TEXT,
  residency_status TEXT NOT NULL DEFAULT 'active' CHECK (residency_status IN ('active','moved_out','deceased','suspended')),
  photo_url TEXT,
  active_flag BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident TO authenticated;
GRANT ALL ON public.resident TO service_role;

CREATE TABLE public.residence_credential (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  resident_id UUID NOT NULL REFERENCES public.resident(resident_id),
  issuing_kebele_id UUID NOT NULL REFERENCES public.kebele(kebele_id),
  credential_number TEXT NOT NULL UNIQUE,
  serial_number TEXT NOT NULL UNIQUE,
  credential_type TEXT NOT NULL DEFAULT 'card' CHECK (credential_type IN ('card','certificate')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','printed','active','expired','suspended','revoked','replaced')),
  issue_date DATE,
  expiry_date DATE,
  reason_for_issue TEXT,
  reissue_count INT NOT NULL DEFAULT 0,
  qr_payload TEXT,
  printed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.residence_credential TO authenticated;
GRANT ALL ON public.residence_credential TO service_role;

CREATE TABLE public.credential_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES public.residence_credential(credential_id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by_user_id UUID REFERENCES public.app_user(user_id),
  change_reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT ON public.credential_status_history TO authenticated;
GRANT ALL ON public.credential_status_history TO service_role;

CREATE TABLE public.vital_event (
  vital_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  resident_id UUID REFERENCES public.resident(resident_id),
  household_id UUID REFERENCES public.household(household_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('birth','death','marriage','divorce')),
  event_number TEXT NOT NULL,
  event_date DATE NOT NULL,
  registration_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(woreda_id, event_type, event_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vital_event TO authenticated;
GRANT ALL ON public.vital_event TO service_role;

CREATE TABLE public.payment (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  household_id UUID REFERENCES public.household(household_id),
  resident_id UUID REFERENCES public.resident(resident_id),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('service_fee','house_rent','penalty','credential_fee')),
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  channel TEXT NOT NULL DEFAULT 'cash' CHECK (channel IN ('cash','bank','mobile')),
  reference_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','reversed')),
  posted_by_user_id UUID REFERENCES public.app_user(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment TO authenticated;
GRANT ALL ON public.payment TO service_role;

CREATE TABLE public.audit_log (
  audit_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id UUID REFERENCES public.woreda(woreda_id),
  actor_user_id UUID REFERENCES public.app_user(user_id),
  entity_name TEXT NOT NULL,
  entity_id TEXT,
  action_type TEXT NOT NULL,
  old_value_json JSONB,
  new_value_json JSONB,
  action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_ip TEXT
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

-- ============ HELPER FUNCTIONS ============

CREATE OR REPLACE FUNCTION public.get_user_woreda_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT woreda_id FROM public.app_user WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_user WHERE user_id = auth.uid() AND role = 'super_admin');
$$;

-- ============ RLS ============

ALTER TABLE public.woreda ENABLE ROW LEVEL SECURITY;
CREATE POLICY "woreda_read_all_authenticated" ON public.woreda FOR SELECT TO authenticated USING (true);
CREATE POLICY "woreda_super_admin_write" ON public.woreda FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

ALTER TABLE public.kebele ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kebele_tenant_isolation" ON public.kebele FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_user_self_read" ON public.app_user FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
CREATE POLICY "app_user_super_admin_write" ON public.app_user FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

ALTER TABLE public.household ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household_tenant_isolation" ON public.household FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

ALTER TABLE public.resident ENABLE ROW LEVEL SECURITY;
CREATE POLICY "resident_tenant_isolation" ON public.resident FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

ALTER TABLE public.residence_credential ENABLE ROW LEVEL SECURITY;
CREATE POLICY "residence_credential_tenant_isolation" ON public.residence_credential FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

ALTER TABLE public.credential_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credential_status_history_read" ON public.credential_status_history FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.residence_credential rc
    WHERE rc.credential_id = credential_status_history.credential_id
      AND rc.woreda_id = public.get_user_woreda_id()
  ));
CREATE POLICY "credential_status_history_insert" ON public.credential_status_history FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.residence_credential rc
    WHERE rc.credential_id = credential_status_history.credential_id
      AND rc.woreda_id = public.get_user_woreda_id()
  ));

ALTER TABLE public.vital_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vital_event_tenant_isolation" ON public.vital_event FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_tenant_isolation" ON public.payment FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

-- audit_log: insert-only for tenant; super_admin sees all
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_tenant_read" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
CREATE POLICY "audit_log_tenant_insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

-- ============ SEED HARARI WOREDAS + KEBELES ============

INSERT INTO public.woreda (woreda_code, woreda_name_en, woreda_name_am) VALUES
  ('AMIR_NUR', 'Amir Nur', 'አሚር ኑር'),
  ('ABADIR',   'Abadir',   'አባዲር'),
  ('SHENKOR',  'Shenkor',  'ሸንኮር'),
  ('ABOKER',   'Aboker',   'አቦከር'),
  ('JINEALA',  'Jineala',  'ጂናኤላ'),
  ('HAKIM',    'Hakim',    'ሃኪም');

INSERT INTO public.kebele (woreda_id, kebele_number, kebele_name_en, kebele_name_am)
SELECT w.woreda_id, k.num, 'Kebele ' || k.num, 'ቀበሌ ' || k.num
FROM public.woreda w
JOIN (VALUES
  ('AMIR_NUR','01'),('AMIR_NUR','02'),('AMIR_NUR','07'),
  ('ABADIR','03'),('ABADIR','04'),('ABADIR','05'),('ABADIR','06'),
  ('SHENKOR','08'),('SHENKOR','09'),('SHENKOR','10'),
  ('ABOKER','11'),('ABOKER','12'),('ABOKER','13'),
  ('JINEALA','14'),('JINEALA','15'),('JINEALA','16'),
  ('HAKIM','17'),('HAKIM','18'),('HAKIM','19')
) AS k(code, num) ON k.code = w.woreda_code;
