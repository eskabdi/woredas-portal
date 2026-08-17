
CREATE TABLE public.id_card_template (
  template_type TEXT PRIMARY KEY CHECK (template_type IN ('card_front','card_back')),
  background_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.app_user(user_id)
);

GRANT SELECT ON public.id_card_template TO authenticated;
GRANT ALL ON public.id_card_template TO service_role;

ALTER TABLE public.id_card_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY "id_card_template_read_all" ON public.id_card_template FOR SELECT TO authenticated USING (true);
CREATE POLICY "id_card_template_write_super_admin" ON public.id_card_template FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

INSERT INTO public.id_card_template (template_type, status)
VALUES ('card_front','active'), ('card_back','active')
ON CONFLICT DO NOTHING;

INSERT INTO public.id_card_template_field (template_type, field_key, x, y, width, height, font_size, text_align, z_index, canvas_width, canvas_height)
SELECT * FROM (VALUES
  ('card_front', 'phone_number',  900::numeric, 700::numeric, 300::numeric, 40::numeric,  20::numeric, 'left',   1, 1688::numeric, 1063::numeric),
  ('card_front', 'barcode',        60::numeric, 900::numeric, 500::numeric, 80::numeric,   0::numeric, 'left',   1, 1688::numeric, 1063::numeric),
  ('card_front', 'serial_number', 900::numeric, 900::numeric, 300::numeric, 40::numeric,  18::numeric, 'left',   1, 1688::numeric, 1063::numeric),
  ('card_back',  'signature',    1200::numeric, 700::numeric, 300::numeric,150::numeric,  16::numeric, 'center', 1, 1688::numeric, 1063::numeric)
) AS v(template_type, field_key, x, y, width, height, font_size, text_align, z_index, canvas_width, canvas_height)
ON CONFLICT (template_type, field_key) DO NOTHING;

CREATE POLICY "credential_templates_read_all" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'credential-templates');
CREATE POLICY "credential_templates_write_super_admin" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'credential-templates' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'credential-templates' AND public.is_super_admin());
