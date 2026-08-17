
-- 1. credential_number_sequence
CREATE TABLE public.credential_number_sequence (
  woreda_id UUID PRIMARY KEY REFERENCES public.woreda(woreda_id),
  last_value INT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credential_number_sequence TO authenticated;
GRANT ALL ON public.credential_number_sequence TO service_role;
ALTER TABLE public.credential_number_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credential_seq_tenant" ON public.credential_number_sequence FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

-- 2. residence_credential new columns
ALTER TABLE public.residence_credential
  ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES public.app_user(user_id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. id_card_template_field
CREATE TABLE public.id_card_template_field (
  template_field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type TEXT NOT NULL CHECK (template_type IN ('card_front','card_back','certificate')),
  field_key TEXT NOT NULL,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  width NUMERIC NOT NULL,
  height NUMERIC NOT NULL,
  font_size NUMERIC,
  font_weight TEXT,
  text_align TEXT NOT NULL DEFAULT 'left',
  z_index INT NOT NULL DEFAULT 0,
  canvas_width NUMERIC NOT NULL DEFAULT 1688,
  canvas_height NUMERIC NOT NULL DEFAULT 1063,
  UNIQUE(template_type, field_key)
);
GRANT SELECT ON public.id_card_template_field TO authenticated;
GRANT ALL ON public.id_card_template_field TO service_role;
ALTER TABLE public.id_card_template_field ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_read_all" ON public.id_card_template_field FOR SELECT TO authenticated USING (true);
CREATE POLICY "template_write_super_admin" ON public.id_card_template_field FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Seed card_front fields (canvas 1688x1063)
INSERT INTO public.id_card_template_field (template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index) VALUES
  ('card_front','photo',              60,  200, 380, 480, NULL, NULL, 'left',   1),
  ('card_front','full_name_am',      480,  220, 1150, 60,  36, 'bold',   'left', 2),
  ('card_front','full_name_en',      480,  295, 1150, 50,  30, 'normal', 'left', 2),
  ('card_front','id_number',         480,  370, 900,  50,  32, 'bold',   'left', 2),
  ('card_front','gender',            480,  445, 400,  40,  24, 'normal', 'left', 2),
  ('card_front','dob_ethiopian',     480,  510, 700,  40,  24, 'normal', 'left', 2),
  ('card_front','dob_gregorian',     480,  565, 700,  40,  22, 'normal', 'left', 2),
  ('card_front','woreda_name',       480,  630, 700,  40,  24, 'normal', 'left', 2),
  ('card_front','kebele_name',       480,  685, 700,  40,  24, 'normal', 'left', 2),
  ('card_front','house_number',      480,  740, 700,  40,  24, 'normal', 'left', 2);

-- Seed card_back fields
INSERT INTO public.id_card_template_field (template_type, field_key, x, y, width, height, font_size, font_weight, text_align, z_index) VALUES
  ('card_back','issue_date',       120, 260, 700, 50, 26, 'normal', 'left',   2),
  ('card_back','expiry_date',      120, 340, 700, 50, 26, 'normal', 'left',   2),
  ('card_back','place_of_issue',   120, 420, 900, 50, 26, 'normal', 'left',   2),
  ('card_back','qr_code',         1280, 680, 320, 320, NULL, NULL, 'left',   3),
  ('card_back','watermark_photo',  600, 260, 500, 640, NULL, NULL, 'center', 0);

-- 4. Numbering trigger for credential_number
CREATE OR REPLACE FUNCTION public.assign_credential_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code TEXT;
  v_next INTEGER;
BEGIN
  IF NEW.credential_number IS NOT NULL AND NEW.credential_number <> '' AND NEW.credential_number <> 'AUTO' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown woreda %', NEW.woreda_id;
  END IF;

  INSERT INTO public.credential_number_sequence(woreda_id, last_value)
  VALUES (NEW.woreda_id, 1)
  ON CONFLICT (woreda_id)
  DO UPDATE SET last_value = public.credential_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.credential_number := v_code || '-CR-' || LPAD(v_next::TEXT, 6, '0');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assign_credential_number ON public.residence_credential;
CREATE TRIGGER trg_assign_credential_number
  BEFORE INSERT ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.assign_credential_number();
