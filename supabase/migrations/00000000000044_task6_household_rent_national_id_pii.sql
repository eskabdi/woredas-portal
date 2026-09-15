-- Task 6 (fix-task-production-readiness-v3): closes two scope gaps
-- 00000000000023_pii_encryption.sql's own header comment recorded and left
-- open -- resident.national_id_no (a stronger identifier than the phone
-- number that migration already encrypts) and household.rent_amount (an
-- oversight next to rental_occupancy.rent_amount, which was in scope).
--
-- Same design as 00000000000023: per-tenant derived key (derive_woreda_key),
-- security_invoker decrypting views, fail-soft before/without the key,
-- plaintext stays authoritative through this stage (no application write
-- path changes). This migration folds stage 1 (columns/functions/triggers/
-- views) AND stage 2 (backfill) together in one transaction, unlike
-- 00000000000023's split -- the pii_root_key Vault secret already exists
-- live on this project (confirmed via pii_encryption_status() before writing
-- this), so there is no "key not provisioned yet" window to protect against
-- here the way there was for the original rollout.
--
-- ---------------------------------------------------------------------------
-- Stage-3 trade-off, disclosed rather than silently shipped
-- ---------------------------------------------------------------------------
-- resident.national_id_no is used two ways in the app today:
--   1. woreda.residents.index.tsx's free-text search does
--      `national_id_no.ilike.%term%` -- a SUBSTRING match.
--   2. ResidentWizardSteps.tsx's duplicate-ID check does
--      `.eq('national_id_no', trimmed)` -- an EXACT match.
-- A blind index (deterministic HMAC, same construction as
-- phone_blind_index) only ever supports (2). This migration's blind index
-- lets the exact-match duplicate check keep working exactly as before, but
-- the free-text list search LOSES SUBSTRING MATCHING on this field the
-- moment the read path cuts over to it -- identical to the disclosed
-- regression phone_number's own cutover already accepted (see
-- woreda.residents.index.tsx's own comment on phoneBlindIndexQuery, and
-- docs/security-functionality.md). A staff member typing a partial national
-- ID into the residents search box will no longer get a match on this field
-- once the read-path change lands; full-name, Amharic name and resident
-- number still match on partial input, and an exact full ID still matches.
-- No fuzzy/searchable encryption scheme is introduced to avoid this --
-- doing so would mean a weaker (partially-guessable) index over the
-- platform's strongest identifier, which is a worse trade than losing
-- substring search on it.
--
-- household.rent_amount has no such trade-off: it is purely numeric, same
-- shape as rental_occupancy.rent_amount, and no read path filters on it.
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

DO $$
BEGIN
  IF public.pii_root_key() IS NULL THEN
    RAISE EXCEPTION 'pii_root_key Vault secret is missing -- this migration assumes it already exists (confirm with pii_encryption_status() first)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Columns
-- ----------------------------------------------------------------------------

ALTER TABLE public.resident
  ADD COLUMN IF NOT EXISTS national_id_no_enc bytea,
  ADD COLUMN IF NOT EXISTS national_id_no_blind_index text;

ALTER TABLE public.household
  ADD COLUMN IF NOT EXISTS rent_amount_enc bytea;

CREATE INDEX IF NOT EXISTS resident_national_id_blind_index_idx
  ON public.resident (woreda_id, national_id_no_blind_index);

-- ----------------------------------------------------------------------------
-- Blind index. No normalization beyond trim -- unlike phone numbers,
-- national ID numbers have no equivalent-spellings problem this codebase
-- has documented, and inventing a normalization rule not asked for risks
-- silently folding together IDs that are not actually the same. Matches the
-- existing exact-match semantics of `.eq('national_id_no', trimmed)`
-- (ResidentWizardSteps.tsx) precisely.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.national_id_blind_index(_id text, _woreda_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k text;
  trimmed text;
BEGIN
  trimmed := NULLIF(trim(_id), '');
  IF trimmed IS NULL THEN RETURN NULL; END IF;
  k := public.derive_woreda_key(_woreda_id);
  IF k IS NULL THEN RETURN NULL; END IF;
  RETURN encode(extensions.hmac(trimmed, k, 'sha256'), 'hex');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.national_id_blind_index(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.national_id_blind_index(text, uuid) TO service_role;

-- Search helper, same shape as my_phone_blind_index: resolves the caller's
-- own tenant server-side, so it cannot be pointed at another woreda's index
-- space.
CREATE OR REPLACE FUNCTION public.my_national_id_blind_index(_id text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.national_id_blind_index(_id, public.get_user_woreda_id());
$function$;

REVOKE EXECUTE ON FUNCTION public.my_national_id_blind_index(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_national_id_blind_index(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- Sync triggers -- extend the existing ones rather than adding new triggers,
-- so column order of operations within one BEFORE INSERT/UPDATE stays
-- single-pass per row exactly like 00000000000023.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resident_pii_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.phone_number_enc          := public.encrypt_pii_text(NEW.phone_number, NEW.woreda_id);
  NEW.phone_number_blind_index  := public.phone_blind_index(NEW.phone_number, NEW.woreda_id);
  NEW.email_enc                 := public.encrypt_pii_text(NEW.email, NEW.woreda_id);
  NEW.national_id_no_enc        := public.encrypt_pii_text(NEW.national_id_no, NEW.woreda_id);
  NEW.national_id_no_blind_index := public.national_id_blind_index(NEW.national_id_no, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.household_pii_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.phone_number_enc := public.encrypt_pii_text(NEW.phone_number, NEW.woreda_id);
  NEW.email_enc        := public.encrypt_pii_text(NEW.email, NEW.woreda_id);
  NEW.rent_amount_enc  := public.encrypt_pii_numeric(NEW.rent_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

-- Triggers already exist (resident_pii_sync_trg, household_pii_sync_trg) and
-- fire BEFORE INSERT OR UPDATE on both tables -- CREATE OR REPLACE FUNCTION
-- above is all that's needed; no DROP/CREATE TRIGGER required.

-- ----------------------------------------------------------------------------
-- Decrypting views -- DROP + CREATE, not CREATE OR REPLACE, for the same
-- "SELECT t.*, computed" column-order reason 00000000000023 documents
-- (CREATE OR REPLACE VIEW can only append columns at the end of the
-- existing list, and the base table's `*` would otherwise reorder ahead of
-- the earlier decrypted columns). Grants reapplied immediately after, since
-- DROP VIEW clears them.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.resident_decrypted;
CREATE VIEW public.resident_decrypted
  WITH (security_invoker = on) AS
  SELECT r.*,
         public.decrypt_pii_text(r.phone_number_enc, r.woreda_id)     AS phone_number_decrypted,
         public.decrypt_pii_text(r.email_enc, r.woreda_id)            AS email_decrypted,
         public.decrypt_pii_text(r.national_id_no_enc, r.woreda_id)   AS national_id_no_decrypted
  FROM public.resident r;

DROP VIEW IF EXISTS public.household_decrypted;
CREATE VIEW public.household_decrypted
  WITH (security_invoker = on) AS
  SELECT h.*,
         public.decrypt_pii_text(h.phone_number_enc, h.woreda_id)    AS phone_number_decrypted,
         public.decrypt_pii_text(h.email_enc, h.woreda_id)           AS email_decrypted,
         public.decrypt_pii_numeric(h.rent_amount_enc, h.woreda_id)  AS rent_amount_decrypted
  FROM public.household h;

REVOKE ALL ON public.resident_decrypted  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.household_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.resident_decrypted  TO authenticated, service_role;
GRANT SELECT ON public.household_decrypted TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Rollout status view -- extend with the two new columns.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pii_encryption_status()
 RETURNS TABLE(key_present boolean, column_label text, rows_with_plaintext bigint, rows_encrypted bigint)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.pii_root_key() IS NOT NULL, 'resident.phone_number',
         count(*) FILTER (WHERE phone_number IS NOT NULL),
         count(*) FILTER (WHERE phone_number_enc IS NOT NULL) FROM public.resident
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'resident.email',
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE email_enc IS NOT NULL) FROM public.resident
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'resident.national_id_no',
         count(*) FILTER (WHERE national_id_no IS NOT NULL),
         count(*) FILTER (WHERE national_id_no_enc IS NOT NULL) FROM public.resident
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'household.phone_number',
         count(*) FILTER (WHERE phone_number IS NOT NULL),
         count(*) FILTER (WHERE phone_number_enc IS NOT NULL) FROM public.household
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'household.email',
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE email_enc IS NOT NULL) FROM public.household
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'household.rent_amount',
         count(*) FILTER (WHERE rent_amount IS NOT NULL),
         count(*) FILTER (WHERE rent_amount_enc IS NOT NULL) FROM public.household
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'service_request.applicant_phone',
         count(*) FILTER (WHERE applicant_phone IS NOT NULL),
         count(*) FILTER (WHERE applicant_phone_enc IS NOT NULL) FROM public.service_request
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'payment.amount',
         count(*), count(*) FILTER (WHERE amount_enc IS NOT NULL) FROM public.payment
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'rental_occupancy.rent_amount',
         count(*), count(*) FILTER (WHERE rent_amount_enc IS NOT NULL) FROM public.rental_occupancy
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'rental_occupancy_request.rent_amount',
         count(*) FILTER (WHERE rent_amount IS NOT NULL),
         count(*) FILTER (WHERE rent_amount_enc IS NOT NULL) FROM public.rental_occupancy_request;
$function$;

REVOKE EXECUTE ON FUNCTION public.pii_encryption_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pii_encryption_status() TO service_role;

-- ----------------------------------------------------------------------------
-- Backfill -- folded into this migration since the Vault key already exists
-- live (checked above). No-op self-assignment, filtered to rows still
-- missing their _enc value, same as scripts/phase-c-backfill.sh's pattern;
-- safe to re-run.
-- ----------------------------------------------------------------------------

UPDATE public.resident SET national_id_no = national_id_no
WHERE national_id_no IS NOT NULL AND national_id_no_enc IS NULL;

UPDATE public.household SET rent_amount = rent_amount
WHERE rent_amount IS NOT NULL AND rent_amount_enc IS NULL;

COMMIT;
