-- Short-form woreda name, alongside the existing full-form
-- woreda_name_display / woreda_name_display_en (the settings page's
-- "Woreda Name" fields, relabeled "Full Name of Woreda" / የወረዳ ሙሉ ስም in
-- this same change). These two columns hold an optional shorter form for
-- contexts too tight for the full name. Same pattern as the Harari/Oromiffa
-- variants added in 00000000000005_woreda_name_har_om.sql: no raw
-- woreda.* registry column to fall back to, since the base woreda table
-- only ever carried one (full-form) name per language.

ALTER TABLE public.woreda_settings
  ADD COLUMN IF NOT EXISTS woreda_name_short text,
  ADD COLUMN IF NOT EXISTS woreda_name_short_en text;

COMMENT ON COLUMN public.woreda_settings.woreda_name_short IS
  'Optional short-form Amharic woreda name, alongside the full-form '
  'woreda_name_display. No raw registry fallback exists.';
COMMENT ON COLUMN public.woreda_settings.woreda_name_short_en IS
  'Optional short-form English woreda name, alongside the full-form '
  'woreda_name_display_en. No raw registry fallback exists.';
