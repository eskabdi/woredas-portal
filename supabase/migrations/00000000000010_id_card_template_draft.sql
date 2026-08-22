-- ============================================================================
-- Real draft/live staging for the ID card template.
--
-- Today, "Draft" vs "Active" on id_card_template is a cosmetic status label:
-- the print workflow (woreda.credentials.$requestId.print.tsx) reads
-- id_card_template_field completely unfiltered by status, so every edit made
-- in the template editor takes effect on printed cards immediately, whether
-- or not a super_admin has clicked Publish. This migration introduces a
-- shadow draft table the editor reads/writes exclusively, so unpublished
-- edits genuinely cannot affect production printing until publish_id_
-- card_template() reconciles them into the live table. The print route's
-- own field query (id_card_template_field) needs zero changes -- it keeps
-- reading that table directly, which this design guarantees always holds
-- exactly the last-published state. It DOES need one line dropped: its
-- background-image query selects the old `status` text column, which this
-- migration replaces below.
--
-- id_card_template.status ('draft'/'active' text) is also converted to a
-- boolean is_published here, so the admin UI can render it as a checkbox
-- instead of a status-label badge.
-- ============================================================================

ALTER TABLE public.id_card_template
  ADD COLUMN is_published boolean DEFAULT false NOT NULL;
UPDATE public.id_card_template SET is_published = (status = 'active');
ALTER TABLE public.id_card_template
  DROP CONSTRAINT id_card_template_status_check,
  DROP COLUMN status;

CREATE TABLE public.id_card_template_field_draft (
  template_field_id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  template_type text NOT NULL,
  field_key text NOT NULL,
  x numeric NOT NULL,
  y numeric NOT NULL,
  width numeric NOT NULL,
  height numeric NOT NULL,
  font_size numeric,
  font_weight text,
  text_align text DEFAULT 'left'::text NOT NULL,
  z_index integer DEFAULT 0 NOT NULL,
  canvas_width numeric DEFAULT 1688 NOT NULL,
  canvas_height numeric DEFAULT 1063 NOT NULL,
  field_type text DEFAULT 'text'::text NOT NULL,
  color text DEFAULT '#000000'::text NOT NULL,
  font_family text DEFAULT 'Inter'::text NOT NULL,
  font_style text DEFAULT 'normal'::text NOT NULL,
  text_decoration text DEFAULT 'none'::text NOT NULL,
  binding_mode text DEFAULT 'bound'::text NOT NULL,
  static_value text,
  CONSTRAINT id_card_template_field_draft_template_type_check
    CHECK (template_type = ANY (ARRAY['card_front'::text, 'card_back'::text, 'certificate'::text])),
  CONSTRAINT id_card_template_field_draft_field_type_check
    CHECK (field_type = ANY (ARRAY['text'::text, 'image'::text])),
  CONSTRAINT id_card_template_field_draft_font_style_check
    CHECK (font_style = ANY (ARRAY['normal'::text, 'italic'::text])),
  CONSTRAINT id_card_template_field_draft_text_decoration_check
    CHECK (text_decoration = ANY (ARRAY['none'::text, 'underline'::text])),
  CONSTRAINT id_card_template_field_draft_binding_mode_check
    CHECK (binding_mode = ANY (ARRAY['bound'::text, 'static'::text])),
  CONSTRAINT id_card_template_field_draft_type_key_key UNIQUE (template_type, field_key)
);

-- No FK to id_card_template_field -- deliberately separate PK space. A draft
-- row and its eventually-published counterpart are linked only by
-- (template_type, field_key), reconciled explicitly in
-- publish_id_card_template() below, not by a shared identity column.

ALTER TABLE public.id_card_template_field_draft ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_draft_read_all ON public.id_card_template_field_draft
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY template_draft_write_super_admin ON public.id_card_template_field_draft
  AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Seed the draft from whatever is currently published, so an existing
-- deployment's live state becomes the starting draft rather than an empty
-- canvas. On a genuinely fresh project this INSERT...SELECT finds nothing
-- (migrations run before seed.sql) -- seed.sql carries a matching mirrored
-- block for that case.
INSERT INTO public.id_card_template_field_draft
  (template_field_id, template_type, field_key, x, y, width, height, font_size,
   font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
   color, font_family, font_style, text_decoration, binding_mode, static_value)
SELECT template_field_id, template_type, field_key, x, y, width, height, font_size,
       font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
       color, font_family, font_style, text_decoration, binding_mode, static_value
FROM public.id_card_template_field
ON CONFLICT (template_field_id) DO NOTHING;

-- Any write to the draft table means the corresponding side's live template
-- is now stale relative to it.
CREATE OR REPLACE FUNCTION public.mark_template_draft_dirty()
 RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.id_card_template
     SET is_published = false
   WHERE template_type = COALESCE(NEW.template_type, OLD.template_type)
     AND is_published = true;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER trg_mark_template_draft_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public.id_card_template_field_draft
  FOR EACH ROW EXECUTE FUNCTION public.mark_template_draft_dirty();

-- Publish: reconcile the live table to exactly match the draft, in one
-- transaction (upsert every changed/new field, delete any live field whose
-- key no longer exists in the draft -- this is what makes the new
-- delete-from-canvas affordance actually remove a field from printed cards).
-- SECURITY INVOKER, not DEFINER: this needs atomicity, not elevated
-- privilege -- the calling super_admin already satisfies
-- template_write_super_admin / id_card_template_write_super_admin /
-- audit_log's insert policy on every table touched below. The explicit
-- is_super_admin() check exists only for a clean error message; RLS on the
-- underlying tables is still the real backstop.
CREATE OR REPLACE FUNCTION public.publish_id_card_template()
 RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super_admin may publish the ID card template';
  END IF;

  INSERT INTO public.id_card_template_field
    (template_field_id, template_type, field_key, x, y, width, height, font_size,
     font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
     color, font_family, font_style, text_decoration, binding_mode, static_value)
  SELECT template_field_id, template_type, field_key, x, y, width, height, font_size,
         font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
         color, font_family, font_style, text_decoration, binding_mode, static_value
  FROM public.id_card_template_field_draft
  ON CONFLICT (template_type, field_key) DO UPDATE SET
    x = EXCLUDED.x, y = EXCLUDED.y, width = EXCLUDED.width, height = EXCLUDED.height,
    font_size = EXCLUDED.font_size, font_weight = EXCLUDED.font_weight,
    text_align = EXCLUDED.text_align, z_index = EXCLUDED.z_index,
    canvas_width = EXCLUDED.canvas_width, canvas_height = EXCLUDED.canvas_height,
    field_type = EXCLUDED.field_type, color = EXCLUDED.color,
    font_family = EXCLUDED.font_family, font_style = EXCLUDED.font_style,
    text_decoration = EXCLUDED.text_decoration, binding_mode = EXCLUDED.binding_mode,
    static_value = EXCLUDED.static_value;

  DELETE FROM public.id_card_template_field live
  WHERE NOT EXISTS (
    SELECT 1 FROM public.id_card_template_field_draft d
    WHERE d.template_type = live.template_type AND d.field_key = live.field_key
  );

  UPDATE public.id_card_template
     SET is_published = true, updated_by = auth.uid(), updated_at = now()
   WHERE template_type IN ('card_front', 'card_back');

  INSERT INTO public.audit_log (actor_user_id, entity_name, action_type, new_value_json)
  VALUES (auth.uid(), 'id_card_template', 'TEMPLATE_PUBLISHED', jsonb_build_object('published_at', now()));
END;
$function$;

-- Discard: reset the draft back to whatever is currently live, undoing any
-- unsaved/unpublished edits.
CREATE OR REPLACE FUNCTION public.discard_id_card_template_draft()
 RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super_admin may discard the ID card template draft';
  END IF;

  DELETE FROM public.id_card_template_field_draft;
  INSERT INTO public.id_card_template_field_draft
    (template_field_id, template_type, field_key, x, y, width, height, font_size,
     font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
     color, font_family, font_style, text_decoration, binding_mode, static_value)
  SELECT template_field_id, template_type, field_key, x, y, width, height, font_size,
         font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
         color, font_family, font_style, text_decoration, binding_mode, static_value
  FROM public.id_card_template_field;

  -- Content now equals what's live again -- override the dirty trigger's
  -- flip from the DELETE/INSERT above.
  UPDATE public.id_card_template
     SET is_published = true
   WHERE template_type IN ('card_front', 'card_back') AND is_published = false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_id_card_template() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.discard_id_card_template_draft() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_id_card_template() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discard_id_card_template_draft() TO authenticated, service_role;
