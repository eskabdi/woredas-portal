-- English counterpart to woreda_settings.woreda_name_display.
--
-- The credential's "place of issue" identifies the issuing tenant entity, not
-- the raw administrative woreda name — a woreda can brand itself differently
-- from its official registry name (this is exactly what woreda_name_display
-- already does for Amharic). English had no equivalent override, so the ID
-- card's place-of-issue always fell back to the unbranded woreda_name_en.

ALTER TABLE public.woreda_settings
  ADD COLUMN IF NOT EXISTS woreda_name_display_en text;

COMMENT ON COLUMN public.woreda_settings.woreda_name_display_en IS
  'English tenant display name, paired with woreda_name_display (Amharic). '
  'Used as the "place of issue" entity name on residence ID cards; falls '
  'back to woreda.woreda_name_en when unset.';
