-- ---------------------------------------------------------------------------
-- 00000000000092_qw5_rename_jinala.sql
--
-- Security audit 2026-09-24, quick win QW-5 / WP-LOC-014 (Low). The system
-- owner confirmed on 2026-09-25 that woreda 5's English name is spelled
-- "Jinala"; the live row, seed.sql and README all said "Jineala"
-- (docs/audit/2026-09-24/10-live-verification.md, section D).
--
-- Only woreda_name_en changes:
--
--   * woreda_code stays 'JINEALA'. It is an identifier, not display text,
--     and renaming it would orphan anything keyed on it.
--   * woreda_name_am stays as it is until the owner confirms the Amharic
--     spelling (the live row says ጂንኤላ, the README said ጂናኤላ).
--   * Cards already signed keep "Jineala" inside their signed payload -- a
--     signature cannot be edited. Cards signed after this migration carry
--     "Jinala". Both verify.
--
-- Guarded on the old value, so re-running it (or running it on a project
-- whose row was already corrected by hand) changes nothing.
-- ---------------------------------------------------------------------------

BEGIN;

UPDATE public.woreda
   SET woreda_name_en = 'Jinala',
       updated_at = now()
 WHERE woreda_id = '70954b2c-3b13-4add-a47d-31a18a3e9817'
   AND woreda_name_en = 'Jineala';

COMMIT;

-- Verification (expect one row, 'Jinala'):
--   SELECT woreda_code, woreda_name_en, woreda_name_am FROM public.woreda
--    WHERE woreda_id = '70954b2c-3b13-4add-a47d-31a18a3e9817';
