CREATE TABLE public.tenant_module_config (
  woreda_id UUID NOT NULL REFERENCES public.woreda(woreda_id),
  module_key TEXT NOT NULL CHECK (module_key IN ('credentials','civil_registration','revenue','reports','audit')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.app_user(user_id),
  PRIMARY KEY (woreda_id, module_key)
);

GRANT SELECT ON public.tenant_module_config TO authenticated;
GRANT ALL ON public.tenant_module_config TO service_role;

ALTER TABLE public.tenant_module_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_module_config_read" ON public.tenant_module_config FOR SELECT TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
CREATE POLICY "tenant_module_config_write_super_admin" ON public.tenant_module_config FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

INSERT INTO public.tenant_module_config (woreda_id, module_key, is_enabled)
SELECT w.woreda_id, m.module_key, true
FROM public.woreda w, (VALUES ('credentials'),('civil_registration'),('revenue'),('reports'),('audit')) AS m(module_key)
ON CONFLICT DO NOTHING;