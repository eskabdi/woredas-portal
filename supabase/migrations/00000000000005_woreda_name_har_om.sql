-- Harari and Afaan Oromo (Oromiffa) counterparts to
-- woreda_settings.woreda_name_display / woreda_name_display_en -- the Harari
-- Regional State recognizes Harari and Afaan Oromo as working languages
-- alongside Amharic, and the residence ID card's issuing-entity name should
-- be expressible in either. Like woreda_name_display_en (added in
-- 00000000000003_tenant_name_en.sql), these are settings-only overrides --
-- there is no raw woreda.woreda_name_har/om registry column to fall back to.

ALTER TABLE public.woreda_settings
  ADD COLUMN IF NOT EXISTS woreda_name_display_har text,
  ADD COLUMN IF NOT EXISTS woreda_name_display_om text;

COMMENT ON COLUMN public.woreda_settings.woreda_name_display_har IS
  'Harari-language tenant display name, alongside woreda_name_display '
  '(Amharic) and woreda_name_display_en (English). Optional -- no raw '
  'registry fallback exists for this language.';
COMMENT ON COLUMN public.woreda_settings.woreda_name_display_om IS
  'Afaan Oromo (Oromiffa) tenant display name, alongside woreda_name_display '
  '(Amharic) and woreda_name_display_en (English). Optional -- no raw '
  'registry fallback exists for this language.';

-- New id_card_template_field placeholders so every woreda-name language
-- variant (the existing Amharic+English combined "woreda_name", plus the
-- new Harari and Oromiffa fields) is selectable on the template designer
-- for BOTH card sides -- "woreda_name" previously existed only on
-- card_front. Positions are seeded to a reasonable, non-overlapping
-- default in empty canvas space; a super admin repositions them via the
-- drag/resize editor like any other field, same as every row already in
-- seed.sql. Kept in sync with seed.sql per this repo's convention for
-- id_card_template_field (CLAUDE.md: "when a template or config table... is
-- edited live in the DB, sync the same values into seed.sql").
INSERT INTO public.id_card_template_field (template_field_id, template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index, canvas_width, canvas_height, field_type, color, font_family, font_style, text_decoration, binding_mode, static_value) VALUES ('e6e099e6-f712-4325-bdde-e3e4fbe88d1e', 'card_front', 'woreda_name_har', '595', '745', '316', '60', '18', 'normal', 'left', '2', '1688', '1063', 'text', '#000000', 'Inter', 'normal', 'none', 'bound', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.id_card_template_field (template_field_id, template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index, canvas_width, canvas_height, field_type, color, font_family, font_style, text_decoration, binding_mode, static_value) VALUES ('267c653d-ea98-4366-930b-efc790c40a90', 'card_front', 'woreda_name_om', '935', '745', '258', '60', '18', 'normal', 'left', '2', '1688', '1063', 'text', '#000000', 'Inter', 'normal', 'none', 'bound', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.id_card_template_field (template_field_id, template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index, canvas_width, canvas_height, field_type, color, font_family, font_style, text_decoration, binding_mode, static_value) VALUES ('0d57ee07-fd85-4666-9ab2-3859bf03d37c', 'card_back', 'woreda_name', '82', '436', '632', '55', '18', 'normal', 'left', '2', '1688', '1063', 'text', '#000000', 'Inter', 'normal', 'none', 'bound', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.id_card_template_field (template_field_id, template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index, canvas_width, canvas_height, field_type, color, font_family, font_style, text_decoration, binding_mode, static_value) VALUES ('599ac88b-0648-4651-a8b4-86b6fafeca48', 'card_back', 'woreda_name_har', '82', '496', '300', '55', '18', 'normal', 'left', '2', '1688', '1063', 'text', '#000000', 'Inter', 'normal', 'none', 'bound', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.id_card_template_field (template_field_id, template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index, canvas_width, canvas_height, field_type, color, font_family, font_style, text_decoration, binding_mode, static_value) VALUES ('370eb957-87fa-44d4-938f-600f7aa0cd78', 'card_back', 'woreda_name_om', '395', '496', '300', '55', '18', 'normal', 'left', '2', '1688', '1063', 'text', '#000000', 'Inter', 'normal', 'none', 'bound', NULL) ON CONFLICT DO NOTHING;
