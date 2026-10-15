-- Civil-registration certificates are printed on A4 landscape only
-- (system owner decision). Additive: the column and its original
-- portrait|landscape CHECK stay; this migration
--   1. moves every template to landscape (none had placed fields or a
--      background when this was applied, so no geometry is reinterpreted),
--   2. makes landscape the default for any future certificate type, and
--   3. adds a second CHECK that only accepts landscape, so a direct
--      PostgREST write cannot switch a template back to portrait.
-- The builder no longer offers an orientation choice and the print route
-- always produces an A4 landscape PDF.

UPDATE public.certificate_template
   SET orientation = 'landscape'
 WHERE orientation IS DISTINCT FROM 'landscape';

ALTER TABLE public.certificate_template
  ALTER COLUMN orientation SET DEFAULT 'landscape';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'certificate_template_a4_landscape_ck'
       AND conrelid = 'public.certificate_template'::regclass
  ) THEN
    ALTER TABLE public.certificate_template
      ADD CONSTRAINT certificate_template_a4_landscape_ck CHECK (orientation = 'landscape');
  END IF;
END $$;
