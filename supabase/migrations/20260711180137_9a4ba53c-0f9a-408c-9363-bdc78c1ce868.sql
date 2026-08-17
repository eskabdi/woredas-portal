
-- 1. role_permission table
CREATE TABLE public.role_permission (
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  role_name TEXT NOT NULL CHECK (role_name IN ('registry_clerk','civil_registrar','finance_clerk','supervisor','auditor','viewer')),
  permission_key TEXT NOT NULL,
  is_granted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (woreda_id, role_name, permission_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permission TO authenticated;
GRANT ALL ON public.role_permission TO service_role;

ALTER TABLE public.role_permission ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_permission_select_same_woreda" ON public.role_permission
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

CREATE POLICY "role_permission_update_tenant_admin" ON public.role_permission
  FOR UPDATE TO authenticated
  USING (
    (public.is_super_admin() OR (public.is_tenant_admin() AND woreda_id = public.get_user_woreda_id()))
    AND permission_key NOT IN ('credential.approve','civil.approve','tenant.manage')
  )
  WITH CHECK (
    (public.is_super_admin() OR (public.is_tenant_admin() AND woreda_id = public.get_user_woreda_id()))
    AND permission_key NOT IN ('credential.approve','civil.approve','tenant.manage')
  );

CREATE POLICY "role_permission_insert_tenant_admin" ON public.role_permission
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR (public.is_tenant_admin() AND woreda_id = public.get_user_woreda_id())
  );

-- 2. Seed
WITH perms(k) AS (
  VALUES
    ('resident.create'),('resident.read'),('resident.update'),('resident.delete'),
    ('household.create'),('household.read'),('household.update'),
    ('credential.issue'),('credential.read'),('credential.print'),('credential.verify'),('credential.revoke'),('credential.renew'),('credential.approve'),
    ('civil.register'),('civil.approve'),('civil.read'),
    ('payment.collect'),('payment.read'),
    ('receipt.print'),
    ('report.view'),('report.export'),
    ('audit.view'),
    ('tenant.manage'),('tenant.create'),
    ('user.manage'),
    ('platform.manage')
),
roles(r) AS (
  VALUES ('registry_clerk'),('civil_registrar'),('finance_clerk'),('supervisor'),('auditor'),('viewer')
),
granted(r, k) AS (
  VALUES
    -- registry_clerk
    ('registry_clerk','resident.create'),('registry_clerk','resident.read'),('registry_clerk','resident.update'),
    ('registry_clerk','household.create'),('registry_clerk','household.read'),('registry_clerk','household.update'),
    ('registry_clerk','credential.issue'),('registry_clerk','credential.read'),('registry_clerk','credential.print'),('registry_clerk','credential.verify'),
    ('registry_clerk','civil.read'),
    -- civil_registrar
    ('civil_registrar','resident.create'),('civil_registrar','resident.read'),('civil_registrar','resident.update'),
    ('civil_registrar','household.read'),
    ('civil_registrar','credential.issue'),('civil_registrar','credential.read'),('civil_registrar','credential.print'),('civil_registrar','credential.verify'),
    ('civil_registrar','civil.register'),('civil_registrar','civil.read'),
    -- finance_clerk
    ('finance_clerk','payment.collect'),('finance_clerk','payment.read'),('finance_clerk','receipt.print'),
    ('finance_clerk','resident.read'),('finance_clerk','household.read'),('finance_clerk','credential.read'),
    -- supervisor
    ('supervisor','resident.read'),('supervisor','household.read'),('supervisor','credential.read'),
    ('supervisor','credential.verify'),('supervisor','credential.revoke'),('supervisor','credential.approve'),
    ('supervisor','civil.approve'),('supervisor','civil.read'),
    ('supervisor','payment.read'),('supervisor','receipt.print'),
    ('supervisor','report.view'),('supervisor','report.export'),('supervisor','audit.view'),
    -- auditor
    ('auditor','resident.read'),('auditor','household.read'),('auditor','credential.read'),('auditor','civil.read'),
    ('auditor','payment.read'),('auditor','report.view'),('auditor','audit.view'),
    -- viewer
    ('viewer','resident.read'),('viewer','household.read'),('viewer','credential.read'),('viewer','civil.read'),('viewer','payment.read')
)
INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.r, p.k,
  EXISTS (SELECT 1 FROM granted g WHERE g.r = r.r AND g.k = p.k)
FROM public.woreda w
CROSS JOIN roles r
CROSS JOIN perms p
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

-- 3. app_user extensions
ALTER TABLE public.app_user DROP CONSTRAINT IF EXISTS app_user_status_check;
ALTER TABLE public.app_user ADD CONSTRAINT app_user_status_check
  CHECK (status IN ('active','inactive','suspended','pending'));

ALTER TABLE public.app_user ADD COLUMN IF NOT EXISTS invited_by_user_id UUID REFERENCES public.app_user(user_id);
ALTER TABLE public.app_user ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS role_permission_set_updated_at ON public.role_permission;
CREATE TRIGGER role_permission_set_updated_at BEFORE UPDATE ON public.role_permission
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
