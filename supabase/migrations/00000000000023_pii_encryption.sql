-- ============================================================================
-- PII / financial encryption at rest -- Stage 1 of INSA remediation Phase C
-- (Enforcer 1.3 / 3.9: "sensitive fields must use AES-256 encryption").
--
-- This migration is ADDITIVE AND INERT. It adds columns, functions, views and
-- sync triggers, but changes no existing column, drops nothing, and rewrites
-- no application read path. Plaintext stays authoritative until a later
-- migration retires it. Applying this alone cannot break the running app --
-- see "Fails soft before the key exists" below, which is the property that
-- makes that true.
--
-- ---------------------------------------------------------------------------
-- What this actually protects against
-- ---------------------------------------------------------------------------
-- The real threat this closes is a stolen database dump, snapshot or backup.
-- Supabase Vault holds the root key encrypted under a platform-managed root
-- that does NOT live in the database, so a dump alone yields ciphertext and
-- nothing else.
--
-- It deliberately does NOT defend against a compromised staff session reading
-- its own tenant's data -- that user can already read that PII legitimately,
-- and no column encryption changes it. RLS remains the tenant boundary; this
-- is a second layer under it, not a replacement for it.
--
-- ---------------------------------------------------------------------------
-- Per-tenant derived keys, and why (this is the load-bearing design decision)
-- ---------------------------------------------------------------------------
-- The remediation plan asked for two things that are in direct tension:
--
--   (a) decrypting VIEWS created with `security_invoker = on`, so the
--       underlying table's RLS still gates every row -- the hard-won lesson of
--       00000000000006_view_security_invoker.sql, which exists because a
--       definer view laundered rows past the tenant boundary; and
--   (b) no generic `decrypt(bytea) -> text` primitive that any caller can
--       point at arbitrary ciphertext.
--
-- These conflict: under `security_invoker = on` the view's function calls run
-- as the CALLER, so `authenticated` must hold EXECUTE on the decrypt function
-- -- which is exactly the generic primitive (b) forbids.
--
-- Resolved by deriving a distinct key per tenant:
--
--     woreda_key = hmac(woreda_id::text, root_key, 'sha256')
--
-- and having decrypt_pii_*() take the row's woreda_id and verify the caller
-- is entitled to that tenant before decrypting. The primitive stops being
-- generic:
--
--   * Called through a view, RLS has already proven the row is the caller's.
--   * Called directly with another tenant's ciphertext, the caller must name
--     that woreda_id -- and the tenant check rejects it. Naming their OWN
--     woreda_id instead derives the wrong key and simply fails to decrypt.
--   * A stolen dump plus one compromised staff account therefore exposes only
--     that one tenant -- the blast radius that account already had -- rather
--     than every woreda on the platform.
--
-- The same derivation keys the blind index, so an identical phone number in
-- two woredas produces two different index values and cannot be correlated
-- across tenants.
--
-- ---------------------------------------------------------------------------
-- Fails soft before the key exists
-- ---------------------------------------------------------------------------
-- The root key is created MANUALLY, once, and never appears in this file or
-- any other tracked file (same discipline CLAUDE.md enforces for deploy
-- tokens and HARARI_EC_PRIVATE_KEY):
--
--     select vault.create_secret('<generated key>', 'pii_root_key',
--                                'INSA Phase C PII encryption root key');
--
-- Until that secret exists, pii_root_key() returns NULL, encrypt_pii_*()
-- returns NULL, and the sync triggers below write NULL into the _enc columns
-- instead of raising. That ordering property is deliberate: applying this
-- migration to a project whose key has not been created yet must not break
-- every resident INSERT in production. Use pii_encryption_status() to see
-- whether encryption is actually live, rather than assuming it is.
--
-- LOSING THE KEY MEANS LOSING THE CIPHERTEXT. It is not recoverable from a
-- backup of this database. Back it up wherever HARARI_EC_PRIVATE_KEY is kept.
--
-- ---------------------------------------------------------------------------
-- Rollout (this migration is stage 1 only)
-- ---------------------------------------------------------------------------
--   1. THIS FILE: columns, crypto functions, sync triggers, decrypting views.
--      Triggers keep _enc columns in step with plaintext from now on, so the
--      application needs no write-path change during the transition.
--   2. Create the Vault secret, then backfill pre-existing rows (a one-off
--      script, not a migration).
--   3. Cut read paths over to the *_decrypted views, call site by call site.
--   4. LATER, SEPARATE MIGRATION, after a production burn-in: drop the
--      plaintext columns and the ENCRYPTION half of these sync triggers.
--      payment_amount_sync()/rental_occupancy_amount_sync() must NOT simply be
--      dropped wholesale at that point -- their `amount > 0` / `rent_amount > 0`
--      RAISE EXCEPTION guard is what keeps that invariant enforced once
--      payment_amount_check (baseline.sql, on the plaintext column) goes away
--      with it. Stage 4 replaces each of those two trigger functions with a
--      narrower one that keeps the RAISE EXCEPTION and drops only the
--      encrypt_pii_numeric() call -- it does not delete the trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Key material
-- ----------------------------------------------------------------------------

-- Returns NULL rather than raising when the secret is absent -- see "Fails
-- soft" above. STABLE, not IMMUTABLE: the Vault lookup is a table read.
CREATE OR REPLACE FUNCTION public.pii_root_key()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pii_root_key'
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.pii_root_key() FROM PUBLIC, anon, authenticated;

-- Per-tenant key. Never returns the root itself, so leaking one tenant's
-- derived key does not compromise any other tenant.
CREATE OR REPLACE FUNCTION public.derive_woreda_key(_woreda_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN _woreda_id IS NULL THEN NULL
           WHEN public.pii_root_key() IS NULL THEN NULL
           ELSE encode(
                  extensions.hmac(_woreda_id::text, public.pii_root_key(), 'sha256'),
                  'hex')
         END;
$function$;

REVOKE EXECUTE ON FUNCTION public.derive_woreda_key(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Phone normalization -- pinned explicitly, because getting it wrong breaks
-- exact-match lookup SILENTLY (two spellings of one number hash differently
-- and the resident simply cannot be found).
--
-- Rule: strip every non-digit, then reduce to the 9-digit Ethiopian national
-- significant number where the shape is recognisable:
--     +251 91 122 3344 / 251911223344  (12 digits, 251 prefix) -> 911223344
--     0911223344                        (10 digits, 0 prefix)   -> 911223344
--     911223344                         (9 digits)              -> 911223344
-- Anything else is kept as its digit string: still deterministic, so exact
-- match on an unusual format keeps working, it just is not folded together
-- with the forms above.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  digits text;
BEGIN
  IF _phone IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(_phone, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;

  IF length(digits) = 12 AND left(digits, 3) = '251' THEN
    RETURN right(digits, 9);
  ELSIF length(digits) = 10 AND left(digits, 1) = '0' THEN
    RETURN right(digits, 9);
  END IF;

  RETURN digits;
END;
$function$;

-- Pure text transform -- no key material, no row access, nothing sensitive to
-- gate. REVOKEd anyway to match this file's own pattern (every other function
-- here is explicit about its grants) rather than leaving one silently on the
-- Postgres default of PUBLIC.
REVOKE EXECUTE ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Internal crypto primitives.
--
-- These take a woreda_id and do NOT check the caller, because their callers
-- are the sync triggers (running as owner) and the service-role backfill --
-- neither of which has an end-user tenant context. They are kept out of
-- `authenticated`'s reach entirely; the tenant check lives on the decrypt
-- side, which is the half that is actually exposed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.encrypt_pii_text(_plain text, _woreda_id uuid)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k text;
BEGIN
  IF _plain IS NULL THEN RETURN NULL; END IF;
  k := public.derive_woreda_key(_woreda_id);
  IF k IS NULL THEN RETURN NULL; END IF;   -- key not provisioned yet
  RETURN extensions.pgp_sym_encrypt(_plain, k, 'cipher-algo=aes256');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encrypt_pii_text(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.encrypt_pii_numeric(_value numeric, _woreda_id uuid)
 RETURNS bytea
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.encrypt_pii_text(
           CASE WHEN _value IS NULL THEN NULL ELSE _value::text END,
           _woreda_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.encrypt_pii_numeric(numeric, uuid) FROM PUBLIC, anon, authenticated;

-- Deterministic, per-tenant. Internal: the trigger computes it on write.
CREATE OR REPLACE FUNCTION public.phone_blind_index(_phone text, _woreda_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k text;
  normalized text;
BEGIN
  normalized := public.normalize_phone(_phone);
  IF normalized IS NULL THEN RETURN NULL; END IF;
  k := public.derive_woreda_key(_woreda_id);
  IF k IS NULL THEN RETURN NULL; END IF;
  RETURN encode(extensions.hmac(normalized, k, 'sha256'), 'hex');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.phone_blind_index(text, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Caller-facing surface
-- ----------------------------------------------------------------------------

-- Tenant-gated decrypt. Safe to expose precisely because of the per-tenant key
-- derivation documented at the top of this file. Returns NULL -- never raises
-- and never leaks a reason -- on an unauthorized tenant, a missing key, or
-- ciphertext that does not belong to the named woreda.
CREATE OR REPLACE FUNCTION public.decrypt_pii_text(_cipher bytea, _woreda_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k text;
  caller_is_super boolean;
  caller_woreda uuid;
BEGIN
  IF _cipher IS NULL OR _woreda_id IS NULL THEN RETURN NULL; END IF;

  -- Mirrors the SELECT policy every table in scope carries:
  --   is_super_admin() OR woreda_id = get_user_woreda_id()
  --
  -- Written out in three-valued-logic-safe form ON PURPOSE. The obvious
  -- spelling --
  --     IF NOT (is_super_admin() OR _woreda_id = get_user_woreda_id())
  -- -- FAILS OPEN for a caller with no app_user row: get_user_woreda_id()
  -- returns NULL, so the comparison is NULL, `false OR NULL` is NULL,
  -- `NOT NULL` is NULL, and plpgsql treats a NULL IF condition as false --
  -- skipping the RETURN and decrypting anyway. That is a cross-tenant read
  -- for anyone holding a JWT without a profile row. (RLS itself is immune to
  -- this: a NULL USING result there means "row not visible", so the same
  -- expression fails closed in a policy and open in an IF.)
  caller_is_super := COALESCE(public.is_super_admin(), false);
  caller_woreda   := public.get_user_woreda_id();

  IF NOT caller_is_super
     AND (caller_woreda IS NULL OR caller_woreda <> _woreda_id) THEN
    RETURN NULL;
  END IF;

  k := public.derive_woreda_key(_woreda_id);
  IF k IS NULL THEN RETURN NULL; END IF;

  BEGIN
    RETURN extensions.pgp_sym_decrypt(_cipher, k);
  EXCEPTION WHEN OTHERS THEN
    -- Wrong tenant's ciphertext, corrupt bytes, or a rotated key.
    RETURN NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrypt_pii_numeric(_cipher bytea, _woreda_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  plain text;
BEGIN
  plain := public.decrypt_pii_text(_cipher, _woreda_id);
  IF plain IS NULL THEN RETURN NULL; END IF;
  BEGIN
    RETURN plain::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$function$;

-- Search helper for the residents phone lookup. Takes no woreda argument at
-- all -- it resolves the caller's own tenant server-side -- so it cannot be
-- pointed at another woreda's index space even by a caller who tries.
CREATE OR REPLACE FUNCTION public.my_phone_blind_index(_phone text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.phone_blind_index(_phone, public.get_user_woreda_id());
$function$;

-- ----------------------------------------------------------------------------
-- Columns (additive, all nullable -- nothing existing is touched)
-- ----------------------------------------------------------------------------

ALTER TABLE public.resident
  ADD COLUMN IF NOT EXISTS phone_number_enc bytea,
  ADD COLUMN IF NOT EXISTS phone_number_blind_index text,
  ADD COLUMN IF NOT EXISTS email_enc bytea;

ALTER TABLE public.household
  ADD COLUMN IF NOT EXISTS phone_number_enc bytea,
  ADD COLUMN IF NOT EXISTS email_enc bytea;

ALTER TABLE public.service_request
  ADD COLUMN IF NOT EXISTS applicant_phone_enc bytea;

ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS amount_enc bytea;

ALTER TABLE public.rental_occupancy
  ADD COLUMN IF NOT EXISTS rent_amount_enc bytea;

ALTER TABLE public.rental_occupancy_request
  ADD COLUMN IF NOT EXISTS rent_amount_enc bytea;

-- Exact-match lookup only. The blind index is an HMAC, so LIKE/prefix search
-- against it is meaningless by construction -- see the search-UX note in
-- docs/security-functionality.md.
CREATE INDEX IF NOT EXISTS resident_phone_blind_index_idx
  ON public.resident (woreda_id, phone_number_blind_index);

-- Operator visibility: is encryption actually live, and how far has the
-- backfill got? Cheap counts, no plaintext and no ciphertext returned.
-- Defined after the ALTER TABLEs above because a LANGUAGE sql body is parsed
-- and validated at CREATE time, so it cannot reference a column that does not
-- exist yet.
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
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'household.phone_number',
         count(*) FILTER (WHERE phone_number IS NOT NULL),
         count(*) FILTER (WHERE phone_number_enc IS NOT NULL) FROM public.household
  UNION ALL SELECT public.pii_root_key() IS NOT NULL, 'household.email',
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE email_enc IS NOT NULL) FROM public.household
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

-- ----------------------------------------------------------------------------
-- Sync triggers.
--
-- Plaintext remains authoritative during the transition and these derive the
-- encrypted form from it on every write, so no application write path has to
-- change until stage 4. They recompute unconditionally rather than diffing
-- against OLD -- these tables see human-scale write volume, and a missed
-- branch here would silently desynchronise ciphertext from plaintext, which
-- is far more expensive than a redundant encrypt.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resident_pii_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.phone_number_enc         := public.encrypt_pii_text(NEW.phone_number, NEW.woreda_id);
  NEW.phone_number_blind_index := public.phone_blind_index(NEW.phone_number, NEW.woreda_id);
  NEW.email_enc                := public.encrypt_pii_text(NEW.email, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resident_pii_sync_trg ON public.resident;
CREATE TRIGGER resident_pii_sync_trg
  BEFORE INSERT OR UPDATE ON public.resident
  FOR EACH ROW EXECUTE FUNCTION public.resident_pii_sync();

CREATE OR REPLACE FUNCTION public.household_pii_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.phone_number_enc := public.encrypt_pii_text(NEW.phone_number, NEW.woreda_id);
  NEW.email_enc        := public.encrypt_pii_text(NEW.email, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS household_pii_sync_trg ON public.household;
CREATE TRIGGER household_pii_sync_trg
  BEFORE INSERT OR UPDATE ON public.household
  FOR EACH ROW EXECUTE FUNCTION public.household_pii_sync();

CREATE OR REPLACE FUNCTION public.service_request_pii_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.applicant_phone_enc := public.encrypt_pii_text(NEW.applicant_phone, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS service_request_pii_sync_trg ON public.service_request;
CREATE TRIGGER service_request_pii_sync_trg
  BEFORE INSERT OR UPDATE ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.service_request_pii_sync();

-- Financial columns. The amount guard below is the reason this one is a
-- separate function per table rather than one generic trigger.
--
-- payment_amount_check (baseline.sql) enforces amount > 0 on the plaintext
-- column and will lapse when that column is dropped in stage 4. Validating
-- here means the invariant can survive that drop -- but only if stage 4
-- narrows this function (drops the encrypt_pii_numeric call, keeps the RAISE
-- EXCEPTION) rather than dropping the trigger outright; see the rollout note
-- at the top of this file.
CREATE OR REPLACE FUNCTION public.payment_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.amount IS NOT NULL AND NEW.amount <= 0 THEN
    RAISE EXCEPTION 'payment.amount must be greater than zero';
  END IF;
  NEW.amount_enc := public.encrypt_pii_numeric(NEW.amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payment_amount_sync_trg ON public.payment;
CREATE TRIGGER payment_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.payment_amount_sync();

-- Same stage-4 note as payment_amount_sync() above: narrow this function
-- rather than dropping it, so rental_occupancy_rent_amount_check's invariant
-- survives losing the plaintext column.
CREATE OR REPLACE FUNCTION public.rental_occupancy_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rent_amount IS NOT NULL AND NEW.rent_amount <= 0 THEN
    RAISE EXCEPTION 'rental_occupancy.rent_amount must be greater than zero';
  END IF;
  NEW.rent_amount_enc := public.encrypt_pii_numeric(NEW.rent_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rental_occupancy_amount_sync_trg ON public.rental_occupancy;
CREATE TRIGGER rental_occupancy_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.rental_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.rental_occupancy_amount_sync();

CREATE OR REPLACE FUNCTION public.rental_occupancy_request_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.rent_amount_enc := public.encrypt_pii_numeric(NEW.rent_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rental_occupancy_request_amount_sync_trg ON public.rental_occupancy_request;
CREATE TRIGGER rental_occupancy_request_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION public.rental_occupancy_request_amount_sync();

-- ----------------------------------------------------------------------------
-- Decrypting views.
--
-- `security_invoker = on` is NOT optional here -- 00000000000006 exists
-- because a definer view over these same tables laundered rows past the
-- tenant boundary. Under invoker semantics the underlying table's RLS still
-- decides which rows the caller sees, and decrypt_pii_*() re-checks the
-- tenant per row on top of that.
--
-- No call site reads these yet; stage 3 moves reads over one at a time.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.resident_decrypted
  WITH (security_invoker = on) AS
  SELECT r.*,
         public.decrypt_pii_text(r.phone_number_enc, r.woreda_id) AS phone_number_decrypted,
         public.decrypt_pii_text(r.email_enc, r.woreda_id)        AS email_decrypted
  FROM public.resident r;

CREATE OR REPLACE VIEW public.household_decrypted
  WITH (security_invoker = on) AS
  SELECT h.*,
         public.decrypt_pii_text(h.phone_number_enc, h.woreda_id) AS phone_number_decrypted,
         public.decrypt_pii_text(h.email_enc, h.woreda_id)        AS email_decrypted
  FROM public.household h;

CREATE OR REPLACE VIEW public.service_request_decrypted
  WITH (security_invoker = on) AS
  SELECT s.*,
         public.decrypt_pii_text(s.applicant_phone_enc, s.woreda_id) AS applicant_phone_decrypted
  FROM public.service_request s;

CREATE OR REPLACE VIEW public.payment_decrypted
  WITH (security_invoker = on) AS
  SELECT p.*,
         public.decrypt_pii_numeric(p.amount_enc, p.woreda_id) AS amount_decrypted
  FROM public.payment p;

CREATE OR REPLACE VIEW public.rental_occupancy_decrypted
  WITH (security_invoker = on) AS
  SELECT ro.*,
         public.decrypt_pii_numeric(ro.rent_amount_enc, ro.woreda_id) AS rent_amount_decrypted
  FROM public.rental_occupancy ro;

-- ----------------------------------------------------------------------------
-- Grants. `anon` gets nothing here: every one of these views carries PII or
-- money, and the two public verification surfaces read neither.
-- ----------------------------------------------------------------------------

REVOKE ALL ON public.resident_decrypted         FROM PUBLIC, anon;
REVOKE ALL ON public.household_decrypted        FROM PUBLIC, anon;
REVOKE ALL ON public.service_request_decrypted  FROM PUBLIC, anon;
REVOKE ALL ON public.payment_decrypted          FROM PUBLIC, anon;
REVOKE ALL ON public.rental_occupancy_decrypted FROM PUBLIC, anon;

GRANT SELECT ON public.resident_decrypted         TO authenticated;
GRANT SELECT ON public.household_decrypted        TO authenticated;
GRANT SELECT ON public.service_request_decrypted  TO authenticated;
GRANT SELECT ON public.payment_decrypted          TO authenticated;
GRANT SELECT ON public.rental_occupancy_decrypted TO authenticated;

-- The two functions the app itself calls.
GRANT EXECUTE ON FUNCTION public.decrypt_pii_text(bytea, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrypt_pii_numeric(bytea, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_phone_blind_index(text)       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_text(bytea, uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_numeric(bytea, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_phone_blind_index(text)       FROM PUBLIC, anon;
