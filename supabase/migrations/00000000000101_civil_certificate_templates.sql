-- ============================================================================
-- Civil-registration certificates: adoption as an event type, and a platform
-- certificate-template module (super-admin console) for the five
-- certificates -- birth, death, marriage, divorce, adoption -- with a draft /
-- publish cycle like the ID card template (migration 10).
--
-- Field definitions (bilingual labels, groups, data sources) live in
-- src/config/certificateFields.ts. The database stores only *placements*:
-- which catalog field sits where on which certificate, in which format.
-- Captured certificate data lives in vital_event.event_details.certificate.
--
--   1. vital_event.event_type accepts 'adoption' (CHECK widening).
--   2. resolve_civil_fee() maps divorce (previously unmapped, so a divorce
--      could not be paid) and adoption; zero-fee rows like birth/death/
--      marriage (migration 59), adjustable per woreda in Settings.
--   3. New console permission console.certificate_template.manage (CHECK
--      widening on console_role_permission).
--   4. certificate_template (one row per certificate type),
--      certificate_template_field (live) and certificate_template_field_draft.
--      Positions and sizes are percentages of the page, so a placement is
--      independent of the screen it was edited on and of the print DPI.
--   5. publish_certificate_template() / discard_certificate_template_draft().
--   6. Private storage bucket certificate-templates (blank certificate
--      backgrounds): readable by any signed-in user (woredas print with it),
--      writable only with the console permission.
--   7. A registered certificate's captured data is frozen: event_details
--      .certificate cannot change from a user session once the event is
--      registered or issued -- what prints must be what was approved.
--
-- Additive: CHECK widening (DROP + ADD CONSTRAINT, the sanctioned form),
-- new tables/functions/policies, CREATE OR REPLACE. No other DROP.
-- ============================================================================

-- 1. Adoption ----------------------------------------------------------------
ALTER TABLE public.vital_event DROP CONSTRAINT IF EXISTS vital_event_event_type_check;
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_event_type_check
  CHECK (event_type = ANY (ARRAY['birth', 'death', 'marriage', 'divorce', 'adoption']));

-- Registration numbers: adoption gets its own series code, AD.
CREATE OR REPLACE FUNCTION public.assign_vital_event_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF NEW.event_number IS NOT NULL AND NEW.event_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.event_type
    WHEN 'birth' THEN 'BR' WHEN 'death' THEN 'DT'
    WHEN 'marriage' THEN 'MR' WHEN 'divorce' THEN 'DV'
    WHEN 'adoption' THEN 'AD'
  END;

  INSERT INTO public.vital_event_sequence(woreda_id, event_type, seq_year, last_value)
  VALUES (NEW.woreda_id, NEW.event_type, v_year, 1)
  ON CONFLICT (woreda_id, event_type, seq_year)
  DO UPDATE SET last_value = vital_event_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.event_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0');
  RETURN NEW;
END;
$function$;

-- 2. Fees --------------------------------------------------------------------
INSERT INTO public.fee_schedule (woreda_id, service_type, standard_fee, penalty_rate, status, effective_from)
SELECT w.woreda_id, st.service_type, 0, 0, 'active', current_date
  FROM public.woreda w
 CROSS JOIN (VALUES ('Civil Registration - Divorce'), ('Civil Registration - Adoption')) AS st(service_type)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.fee_schedule fs
    WHERE fs.woreda_id = w.woreda_id AND fs.service_type = st.service_type);

CREATE OR REPLACE FUNCTION public.resolve_civil_fee(_event_type text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_service_type text;
  v_amount numeric;
BEGIN
  v_service_type := CASE _event_type
    WHEN 'birth' THEN 'Civil Registration - Birth'
    WHEN 'death' THEN 'Civil Registration - Death'
    WHEN 'marriage' THEN 'Civil Registration - Marriage'
    WHEN 'divorce' THEN 'Civil Registration - Divorce'
    WHEN 'adoption' THEN 'Civil Registration - Adoption'
    ELSE NULL
  END;

  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'resolve_civil_fee: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_service_type IS NULL THEN
    RAISE EXCEPTION 'resolve_civil_fee: unknown event_type %', _event_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['civil.read', 'civil.record_payment'])) THEN
    RAISE EXCEPTION 'resolve_civil_fee: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT fs.standard_fee INTO v_amount
    FROM public.fee_schedule fs
   WHERE fs.woreda_id = v_woreda_id
     AND fs.service_type = v_service_type
     AND fs.status = 'active'
     AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
   ORDER BY fs.effective_from DESC NULLS LAST
   LIMIT 1;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = format(
        'ክፍያ መርሃ ግብር አልተገኘም ለ "%s" / No active fee schedule found for "%s" — an administrator must add or activate it in Settings.',
        v_service_type, v_service_type
      ),
      DETAIL = v_service_type;
  END IF;

  RETURN v_amount;
END;
$function$;

-- 3. Console permission -------------------------------------------------------
ALTER TABLE public.console_role_permission DROP CONSTRAINT IF EXISTS console_role_permission_key_check;
ALTER TABLE public.console_role_permission ADD CONSTRAINT console_role_permission_key_check
  CHECK (permission_key = ANY (ARRAY[
    'console.tenants.manage',
    'console.users.manage',
    'console.audit.view',
    'console.credential_template.manage',
    'console.console_users.manage',
    'console.backup.manage',
    'console.certificate_template.manage'
  ]));

-- 4. Template tables -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificate_template (
  certificate_type text PRIMARY KEY
    CHECK (certificate_type = ANY (ARRAY['birth', 'death', 'marriage', 'divorce', 'adoption'])),
  background_path text CHECK (background_path IS NULL OR background_path ~ '^[a-z]+/[A-Za-z0-9._-]+$'),
  orientation text NOT NULL DEFAULT 'portrait' CHECK (orientation = ANY (ARRAY['portrait', 'landscape'])),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_user(user_id)
);

INSERT INTO public.certificate_template (certificate_type)
VALUES ('birth'), ('death'), ('marriage'), ('divorce'), ('adoption')
ON CONFLICT (certificate_type) DO NOTHING;

-- Shared column shape for the live and draft placement tables.
CREATE TABLE IF NOT EXISTS public.certificate_template_field (
  certificate_field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_type text NOT NULL REFERENCES public.certificate_template(certificate_type),
  field_key text NOT NULL CHECK (field_key ~ '^[a-z0-9_]{1,64}$'),
  format text NOT NULL CHECK (format = ANY (ARRAY[
    'am', 'en', 'am_en', 'plain', 'image',
    'ec_full', 'ec_day', 'ec_month', 'ec_year', 'gc_full', 'gc_day', 'gc_month', 'gc_year'])),
  binding_mode text NOT NULL DEFAULT 'data' CHECK (binding_mode = ANY (ARRAY['data', 'static'])),
  static_value text CHECK (static_value IS NULL OR length(static_value) <= 500),
  x numeric NOT NULL CHECK (x >= 0 AND x <= 100),
  y numeric NOT NULL CHECK (y >= 0 AND y <= 100),
  width numeric NOT NULL CHECK (width > 0 AND width <= 100),
  height numeric NOT NULL CHECK (height > 0 AND height <= 100),
  font_size numeric NOT NULL DEFAULT 11 CHECK (font_size >= 4 AND font_size <= 72),
  font_weight text NOT NULL DEFAULT 'normal' CHECK (font_weight = ANY (ARRAY['normal', 'bold'])),
  font_style text NOT NULL DEFAULT 'normal' CHECK (font_style = ANY (ARRAY['normal', 'italic'])),
  text_align text NOT NULL DEFAULT 'left' CHECK (text_align = ANY (ARRAY['left', 'center', 'right'])),
  color text NOT NULL DEFAULT '#000000' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  font_family text NOT NULL DEFAULT 'Tayitu'
    CHECK (font_family = ANY (ARRAY['Tayitu', 'Jiret', 'Noto Sans Ethiopic', 'Times New Roman', 'Arial'])),
  z_index integer NOT NULL DEFAULT 1 CHECK (z_index BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certificate_template_field_static_ck
    CHECK (binding_mode = 'data' OR (static_value IS NOT NULL AND format = 'plain'))
);

CREATE TABLE IF NOT EXISTS public.certificate_template_field_draft
  (LIKE public.certificate_template_field INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
DO $pk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_template_field_draft_pkey') THEN
    ALTER TABLE public.certificate_template_field_draft
      ADD CONSTRAINT certificate_template_field_draft_pkey PRIMARY KEY (certificate_field_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_template_field_draft_type_fkey') THEN
    ALTER TABLE public.certificate_template_field_draft
      ADD CONSTRAINT certificate_template_field_draft_type_fkey
      FOREIGN KEY (certificate_type) REFERENCES public.certificate_template(certificate_type);
  END IF;
END
$pk$;

CREATE INDEX IF NOT EXISTS certificate_template_field_type_idx
  ON public.certificate_template_field (certificate_type);
CREATE INDEX IF NOT EXISTS certificate_template_field_draft_type_idx
  ON public.certificate_template_field_draft (certificate_type);

ALTER TABLE public.certificate_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_template_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_template_field_draft ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.certificate_template, public.certificate_template_field,
              public.certificate_template_field_draft FROM anon;
GRANT SELECT, UPDATE ON public.certificate_template TO authenticated;
GRANT SELECT ON public.certificate_template_field TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificate_template_field_draft TO authenticated;
GRANT ALL ON public.certificate_template, public.certificate_template_field,
             public.certificate_template_field_draft TO service_role;

-- Woredas print with the live template, so any signed-in user may read it.
CREATE POLICY certificate_template_read ON public.certificate_template
  FOR SELECT TO authenticated USING (true);
CREATE POLICY certificate_template_write ON public.certificate_template
  FOR UPDATE TO authenticated
  USING (public.user_has_console_perm('console.certificate_template.manage'))
  WITH CHECK (public.user_has_console_perm('console.certificate_template.manage'));

CREATE POLICY certificate_template_field_read ON public.certificate_template_field
  FOR SELECT TO authenticated USING (true);
-- No client write policy on the live table: it changes only through
-- publish_certificate_template() below.

CREATE POLICY certificate_template_field_draft_all ON public.certificate_template_field_draft
  FOR ALL TO authenticated
  USING (public.user_has_console_perm('console.certificate_template.manage'))
  WITH CHECK (public.user_has_console_perm('console.certificate_template.manage'));

-- Editing the draft marks the certificate unpublished.
CREATE OR REPLACE FUNCTION public.mark_certificate_draft_dirty()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  UPDATE public.certificate_template
     SET is_published = false, updated_at = now(), updated_by = auth.uid()
   WHERE certificate_type = COALESCE(NEW.certificate_type, OLD.certificate_type)
     AND is_published = true;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE TRIGGER trg_mark_certificate_draft_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public.certificate_template_field_draft
  FOR EACH ROW EXECUTE FUNCTION public.mark_certificate_draft_dirty();

-- 5. Publish / discard ---------------------------------------------------------
-- SECURITY DEFINER because the live table has no client write policy; the
-- console permission is checked first, as the caller.
CREATE OR REPLACE FUNCTION public.publish_certificate_template(_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.user_has_console_perm('console.certificate_template.manage') THEN
    RAISE EXCEPTION 'Only a super admin with console.certificate_template.manage may publish a certificate template'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.certificate_template WHERE certificate_type = _type) THEN
    RAISE EXCEPTION 'Unknown certificate type %', _type USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.certificate_template_field WHERE certificate_type = _type;
  INSERT INTO public.certificate_template_field
    (certificate_field_id, certificate_type, field_key, format, binding_mode, static_value,
     x, y, width, height, font_size, font_weight, font_style, text_align, color, font_family, z_index)
  SELECT certificate_field_id, certificate_type, field_key, format, binding_mode, static_value,
         x, y, width, height, font_size, font_weight, font_style, text_align, color, font_family, z_index
    FROM public.certificate_template_field_draft
   WHERE certificate_type = _type;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.certificate_template
     SET is_published = true, published_at = now(), updated_at = now(), updated_by = auth.uid()
   WHERE certificate_type = _type;

  INSERT INTO public.audit_log (actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (auth.uid(), 'certificate_template', _type, 'CERTIFICATE_TEMPLATE_PUBLISHED',
          jsonb_build_object('field_count', v_count));
END;
$function$;

CREATE OR REPLACE FUNCTION public.discard_certificate_template_draft(_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_was_published boolean;
BEGIN
  IF NOT public.user_has_console_perm('console.certificate_template.manage') THEN
    RAISE EXCEPTION 'Only a super admin with console.certificate_template.manage may discard a certificate draft'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT published_at IS NOT NULL INTO v_was_published
    FROM public.certificate_template WHERE certificate_type = _type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown certificate type %', _type USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.certificate_template_field_draft WHERE certificate_type = _type;
  INSERT INTO public.certificate_template_field_draft
    (certificate_field_id, certificate_type, field_key, format, binding_mode, static_value,
     x, y, width, height, font_size, font_weight, font_style, text_align, color, font_family, z_index)
  SELECT certificate_field_id, certificate_type, field_key, format, binding_mode, static_value,
         x, y, width, height, font_size, font_weight, font_style, text_align, color, font_family, z_index
    FROM public.certificate_template_field
   WHERE certificate_type = _type;

  -- Content equals the live version again.
  UPDATE public.certificate_template
     SET is_published = v_was_published, updated_at = now(), updated_by = auth.uid()
   WHERE certificate_type = _type;

  INSERT INTO public.audit_log (actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (auth.uid(), 'certificate_template', _type, 'CERTIFICATE_TEMPLATE_DRAFT_DISCARDED', '{}'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_certificate_template(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.discard_certificate_template_draft(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_certificate_template(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_certificate_template_draft(text) TO authenticated;

-- 6. Storage bucket -------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificate-templates', 'certificate-templates', false, 10485760,
        ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY certificate_templates_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'certificate-templates');
CREATE POLICY certificate_templates_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificate-templates'
              AND public.user_has_console_perm('console.certificate_template.manage'));
CREATE POLICY certificate_templates_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'certificate-templates'
         AND public.user_has_console_perm('console.certificate_template.manage'))
  WITH CHECK (bucket_id = 'certificate-templates'
              AND public.user_has_console_perm('console.certificate_template.manage'));
CREATE POLICY certificate_templates_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'certificate-templates'
         AND public.user_has_console_perm('console.certificate_template.manage'));

-- 7. Frozen certificate data after registration ---------------------------------
CREATE OR REPLACE FUNCTION public.pin_vital_event_certificate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status IN ('registered', 'issued')
     AND (NEW.event_details -> 'certificate') IS DISTINCT FROM (OLD.event_details -> 'certificate') THEN
    RAISE EXCEPTION
      'የተመዘገበ ኩነት የምስክር ወረቀት መረጃ ሊቀየር አይችልም / Certificate details of a registered event cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_pin_vital_event_certificate
  BEFORE UPDATE OF event_details ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.pin_vital_event_certificate();
