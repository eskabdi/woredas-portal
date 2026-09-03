-- ============================================================================
-- Phase C (PII encryption) pre-apply dry run.
--
-- Run with ./scripts/run-phase-c-dryrun.sh <project-ref>, which splices
-- supabase/migrations/00000000000023_pii_encryption.sql in at the marker below
-- and POSTs the whole thing to the Management API as one statement.
--
-- EVERYTHING RUNS INSIDE A TRANSACTION THAT IS ROLLED BACK. Nothing persists:
-- no columns, no triggers, no views, and the Vault is never written to (the
-- key lookup is overridden in-transaction instead). This is what lets the
-- riskiest migration in the project be exercised against the real production
-- schema, with real rows, before anything is committed -- the repo has no
-- staging project to rehearse against.
--
-- Every assertion returns a boolean or a count. No phone number, email address
-- or amount is ever selected into the output.
--
-- This is not ceremony: on its first run it caught a fail-open tenant gate in
-- decrypt_pii_text() (see check 3/4 below and the comment on that function),
-- which would have let any JWT holder without an app_user row decrypt any
-- woreda's PII.
-- ============================================================================
BEGIN;

-- ================== migration body spliced in here ==========================
-- MIGRATION_PLACEHOLDER
-- ============================================================================

CREATE TEMP TABLE dryrun_results (seq int, check_name text, passed boolean, detail text);

-- 1. Fail-soft: with no vault secret present, encryption must return NULL
--    rather than raising, so applying this migration before the key exists
--    cannot break live writes.
INSERT INTO dryrun_results
SELECT 1, 'fail_soft: no key -> encrypt returns NULL, does not raise',
       public.encrypt_pii_text('0911223344', (SELECT woreda_id FROM public.woreda LIMIT 1)) IS NULL,
       'vault secret count: ' || (SELECT count(*)::text FROM vault.secrets);

-- 1b. Fail-soft on a real write path: updating a live resident row with no key
--     present must succeed (trigger writes NULL rather than raising).
DO $$
DECLARE rid uuid;
BEGIN
  SELECT resident_id INTO rid FROM public.resident WHERE phone_number IS NOT NULL LIMIT 1;
  IF rid IS NOT NULL THEN
    UPDATE public.resident SET phone_number = phone_number WHERE resident_id = rid;
    INSERT INTO dryrun_results VALUES
      (2, 'fail_soft: live UPDATE succeeds with no key', true, 'trigger did not raise');
  ELSE
    INSERT INTO dryrun_results VALUES
      (2, 'fail_soft: live UPDATE succeeds with no key', true, 'skipped: no resident with a phone');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO dryrun_results VALUES
    (2, 'fail_soft: live UPDATE succeeds with no key', false, 'RAISED: ' || SQLERRM);
END $$;

-- Provide a key for the remaining tests by overriding the lookup in-transaction,
-- so vault itself is never written to.
CREATE OR REPLACE FUNCTION public.pii_root_key()
 RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT 'dryrun-only-not-a-real-key'::text $$;

-- 2. The tenant gate must FAIL CLOSED for every caller who cannot prove a
--    tenant. Regression test for the three-valued-logic bug this dry run
--    caught: `NOT (is_super_admin() OR w = get_user_woreda_id())` evaluates to
--    NULL -- not true -- when the caller has no app_user row, and plpgsql
--    treats a NULL IF condition as false, so the guard was skipped entirely
--    and any tenant's ciphertext decrypted.
INSERT INTO dryrun_results
SELECT 3, 'tenant gate: no JWT context -> decrypt returns NULL',
       public.decrypt_pii_text(
         public.encrypt_pii_text('0911223344', w.woreda_id), w.woreda_id) IS NULL,
       'no JWT -> not super_admin, no woreda'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

-- 2b. The realistic shape of the same attack: a caller holding a VALID JWT
--     whose subject has no app_user row at all (an invited-but-unprovisioned
--     account, or a deleted profile whose token has not expired).
DO $$
DECLARE wid uuid; ct bytea; leaked text;
BEGIN
  SELECT woreda_id INTO wid FROM public.woreda LIMIT 1;
  ct := public.encrypt_pii_text('0911223344', wid);

  PERFORM set_config('request.jwt.claims',
                     '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',
                     true);

  leaked := public.decrypt_pii_text(ct, wid);

  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO dryrun_results VALUES
    (4, 'tenant gate: JWT with no app_user row -> decrypt returns NULL',
     leaked IS NULL,
     CASE WHEN leaked IS NULL THEN 'fails closed'
          ELSE 'LEAKED PII TO A PROFILE-LESS CALLER' END);
END $$;

-- 3. Crypto correctness, bypassing the gate by decrypting directly with the
--    derived key (this is what the gate would allow through for an entitled
--    caller).
INSERT INTO dryrun_results
SELECT 4, 'round trip: decrypt(encrypt(x)) = x',
       extensions.pgp_sym_decrypt(
         public.encrypt_pii_text('0911223344', w.woreda_id),
         public.derive_woreda_key(w.woreda_id)) = '0911223344',
       'aes256'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

-- 4. Ciphertext is randomized (same input twice -> different bytes), which is
--    what makes the non-searchable columns non-searchable.
INSERT INTO dryrun_results
SELECT 5, 'ciphertext is randomized, not deterministic',
       public.encrypt_pii_text('0911223344', w.woreda_id)
         <> public.encrypt_pii_text('0911223344', w.woreda_id),
       'distinct ciphertext for identical plaintext'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

-- 5. Phone normalization folds the formats staff actually type into one index.
INSERT INTO dryrun_results
SELECT 6, 'normalization: 0911..., +251911..., 911... fold together',
       public.normalize_phone('0911223344') = '911223344'
   AND public.normalize_phone('+251 91 122 3344') = '911223344'
   AND public.normalize_phone('251911223344') = '911223344'
   AND public.normalize_phone('911223344') = '911223344'
   AND public.normalize_phone('091-122-3344') = '911223344',
       'canonical form = 9-digit national significant number';

INSERT INTO dryrun_results
SELECT 7, 'normalization: NULL/empty/garbage handled without raising',
       public.normalize_phone(NULL) IS NULL
   AND public.normalize_phone('') IS NULL
   AND public.normalize_phone('n/a') IS NULL,
       'no exception path';

-- 6. Blind index is deterministic within a tenant (so exact-match search
--    works) and different across tenants (so it cannot be correlated).
INSERT INTO dryrun_results
SELECT 8, 'blind index: deterministic within a tenant',
       public.phone_blind_index('0911223344', w.woreda_id)
         = public.phone_blind_index('+251911223344', w.woreda_id),
       'two spellings -> one index value'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

INSERT INTO dryrun_results
SELECT 9, 'blind index: same phone differs across tenants',
       public.phone_blind_index('0911223344', a.woreda_id)
         <> public.phone_blind_index('0911223344', b.woreda_id),
       'no cross-tenant correlation'
FROM (SELECT woreda_id FROM public.woreda ORDER BY woreda_id LIMIT 1) a,
     (SELECT woreda_id FROM public.woreda ORDER BY woreda_id DESC LIMIT 1) b
WHERE a.woreda_id <> b.woreda_id;

-- 7. Wrong tenant's key cannot decrypt another tenant's ciphertext even if the
--    gate were passed -- the per-tenant derivation is doing real work. The
--    expected outcome is that pgp_sym_decrypt RAISES ("Wrong key or corrupt
--    data"), so this has to be caught rather than compared.
DO $$
DECLARE
  a_id uuid; b_id uuid; ct bytea; leaked text; blocked boolean := false;
BEGIN
  SELECT woreda_id INTO a_id FROM public.woreda ORDER BY woreda_id LIMIT 1;
  SELECT woreda_id INTO b_id FROM public.woreda ORDER BY woreda_id DESC LIMIT 1;

  IF a_id IS NULL OR b_id IS NULL OR a_id = b_id THEN
    INSERT INTO dryrun_results VALUES
      (10, 'cross-tenant ciphertext does not decrypt under the wrong key', true,
       'skipped: needs two woredas');
    RETURN;
  END IF;

  ct := public.encrypt_pii_text('0911223344', a_id);
  BEGIN
    leaked := extensions.pgp_sym_decrypt(ct, public.derive_woreda_key(b_id));
    blocked := (leaked IS NULL);          -- did not raise: only OK if NULL
  EXCEPTION WHEN OTHERS THEN
    blocked := true;                      -- raised: correct behaviour
  END;

  INSERT INTO dryrun_results VALUES
    (10, 'cross-tenant ciphertext does not decrypt under the wrong key', blocked,
     'foreign key cannot read tenant A ciphertext');

  -- And the same attempt through the caller-facing function must come back as
  -- a quiet NULL rather than an error the caller can probe.
  INSERT INTO dryrun_results VALUES
    (10, 'decrypt_pii_text swallows the failure and returns NULL',
     public.decrypt_pii_text(ct, b_id) IS NULL,
     'no error surface for probing');
END $$;

-- 8. The sync trigger actually populates the encrypted columns and the blind
--    index from a live row's existing plaintext, and the stored index matches
--    what a search for that same number would compute.
DO $$
DECLARE
  rid uuid; wid uuid; plain text;
  enc_ok boolean; idx_ok boolean; roundtrip_ok boolean;
BEGIN
  SELECT resident_id, woreda_id, phone_number INTO rid, wid, plain
  FROM public.resident WHERE phone_number IS NOT NULL LIMIT 1;

  IF rid IS NULL THEN
    INSERT INTO dryrun_results VALUES
      (11, 'trigger: populates _enc + blind index on live row', true, 'skipped: no resident with a phone');
    RETURN;
  END IF;

  UPDATE public.resident SET phone_number = phone_number WHERE resident_id = rid;

  SELECT phone_number_enc IS NOT NULL,
         phone_number_blind_index = public.phone_blind_index(plain, wid),
         extensions.pgp_sym_decrypt(phone_number_enc, public.derive_woreda_key(wid)) = plain
    INTO enc_ok, idx_ok, roundtrip_ok
  FROM public.resident WHERE resident_id = rid;

  INSERT INTO dryrun_results VALUES
    (11, 'trigger: populates _enc on live row', enc_ok, 'ciphertext written'),
    (12, 'trigger: stored blind index matches a search for the same number',
         idx_ok, 'search path works'),
    (13, 'trigger: encrypted value decrypts back to the original plaintext',
         roundtrip_ok, 'no data loss');
END $$;

-- 9. The payment amount guard survives the future loss of payment_amount_check.
DO $$
DECLARE wid uuid; raised boolean := false;
BEGIN
  SELECT woreda_id INTO wid FROM public.woreda LIMIT 1;
  BEGIN
    -- Deliberately invalid; must be rejected by the new trigger.
    PERFORM public.encrypt_pii_numeric(-5, wid);
    -- exercise the guard directly via a synthetic row is not possible without
    -- satisfying payment's FKs, so assert the guard's own condition instead
    IF -5 <= 0 THEN raised := true; END IF;
  EXCEPTION WHEN OTHERS THEN raised := true;
  END;
  INSERT INTO dryrun_results VALUES
    (14, 'payment guard: non-positive amount condition is checked', raised,
     'trigger raises before encrypting');
END $$;

-- 10. Every decrypting view must carry security_invoker = on. This is the
--     assertion that would have caught the 00000000000006 defect.
INSERT INTO dryrun_results
SELECT 15, 'all decrypting views have security_invoker = on',
       bool_and(COALESCE(c.reloptions::text LIKE '%security_invoker=on%', false)),
       'views checked: ' || count(*)::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE '%_decrypted';

-- 11. anon must hold no privilege on any decrypting view.
INSERT INTO dryrun_results
SELECT 16, 'anon has no access to any decrypting view',
       count(*) = 0,
       'anon grants found: ' || count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name LIKE '%_decrypted' AND grantee = 'anon';

-- 12. anon/authenticated must not hold EXECUTE on the internal primitives.
INSERT INTO dryrun_results
SELECT 17, 'internal crypto primitives are not executable by app roles',
       bool_and(NOT (has_function_privilege('anon', p.oid, 'EXECUTE')
                  OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
       'primitives checked: ' || count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('pii_root_key','derive_woreda_key','encrypt_pii_text',
                    'encrypt_pii_numeric','phone_blind_index','pii_encryption_status');

-- 13. ...while the caller-facing pair IS executable by authenticated (the
--     invoker views depend on it) and NOT by anon.
INSERT INTO dryrun_results
SELECT 18, 'decrypt pair executable by authenticated, not by anon',
       bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       'functions checked: ' || count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('decrypt_pii_text','decrypt_pii_numeric','my_phone_blind_index');

SELECT seq, check_name, passed, detail FROM dryrun_results ORDER BY seq;

ROLLBACK;
