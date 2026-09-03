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
-- This is not ceremony. On its first run it caught a fail-open tenant gate in
-- decrypt_pii_text() (see check 3/4 below and the comment on that function).
-- On a second, independent review pass (a fresh cluster, not this rolled-back
-- transaction -- see the PR discussion), this harness's OWN checks were found
-- to have real gaps: check 16 below was a tautology that could not have failed
-- regardless of the trigger's correctness, four checks silently vanished to
-- zero rows (and therefore reported nothing, not a failure) on a
-- single-woreda project, three checks used bool_and() over a set that could
-- shrink to a passing subset without detection, and the anon/view check used
-- an information_schema view that misses privileges held via PUBLIC rather
-- than granted to anon directly. All are fixed below, and check 24 is a
-- blanket safety net against any future version of the same class of bug:
-- it fails loudly if any check's row went missing instead of silently
-- reporting a smaller "N/N passed" as if nothing were wrong.
-- ============================================================================
BEGIN;

-- ================== migration body spliced in here ==========================
-- MIGRATION_PLACEHOLDER
-- ============================================================================

CREATE TEMP TABLE dryrun_results (seq int, check_name text, passed boolean, detail text);

-- Precondition the tenant-scoped checks below rely on. If this ever fails, it
-- fails LOUDLY (a FAIL row) rather than causing every check that reads from
-- `public.woreda` to silently produce zero rows and vanish from the output --
-- exactly the class of bug this rewrite exists to close.
INSERT INTO dryrun_results
SELECT 1, 'precondition: at least 2 distinct woredas exist for cross-tenant checks',
       count(*) >= 2,
       'woreda rows: ' || count(*)::text
FROM public.woreda;

-- 2. Fail-soft: with no vault secret present, encryption must return NULL
--    rather than raising, so applying this migration before the key exists
--    cannot break live writes.
INSERT INTO dryrun_results
SELECT 2, 'fail_soft: no key -> encrypt returns NULL, does not raise',
       public.encrypt_pii_text('0911223344', (SELECT woreda_id FROM public.woreda LIMIT 1)) IS NULL,
       'vault secret count: ' || (SELECT count(*)::text FROM vault.secrets);

-- 3. Fail-soft on a real write path: updating a live resident row with no key
--    present must succeed (trigger writes NULL rather than raising).
DO $$
DECLARE rid uuid;
BEGIN
  SELECT resident_id INTO rid FROM public.resident WHERE phone_number IS NOT NULL LIMIT 1;
  IF rid IS NOT NULL THEN
    UPDATE public.resident SET phone_number = phone_number WHERE resident_id = rid;
    INSERT INTO dryrun_results VALUES
      (3, 'fail_soft: live UPDATE succeeds with no key', true, 'trigger did not raise');
  ELSE
    INSERT INTO dryrun_results VALUES
      (3, 'fail_soft: live UPDATE succeeds with no key', true, 'skipped: no resident with a phone');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO dryrun_results VALUES
    (3, 'fail_soft: live UPDATE succeeds with no key', false, 'RAISED: ' || SQLERRM);
END $$;

-- Provide a key for the remaining tests by overriding the lookup in-transaction,
-- so vault itself is never written to.
CREATE OR REPLACE FUNCTION public.pii_root_key()
 RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT 'dryrun-only-not-a-real-key'::text $$;

-- 4. The tenant gate must FAIL CLOSED for every caller who cannot prove a
--    tenant. Regression test for the three-valued-logic bug this dry run
--    caught: `NOT (is_super_admin() OR w = get_user_woreda_id())` evaluates to
--    NULL -- not true -- when the caller has no app_user row, and plpgsql
--    treats a NULL IF condition as false, so the guard was skipped entirely
--    and any tenant's ciphertext decrypted.
INSERT INTO dryrun_results
SELECT 4, 'tenant gate: no JWT context -> decrypt returns NULL',
       public.decrypt_pii_text(
         public.encrypt_pii_text('0911223344', w.woreda_id), w.woreda_id) IS NULL,
       'no JWT -> not super_admin, no woreda'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

-- 5. The realistic shape of the same attack: a caller holding a VALID JWT
--    whose subject has no app_user row at all (an invited-but-unprovisioned
--    account, or a deleted profile whose token has not expired).
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
    (5, 'tenant gate: JWT with no app_user row -> decrypt returns NULL',
     leaked IS NULL,
     CASE WHEN leaked IS NULL THEN 'fails closed'
          ELSE 'LEAKED PII TO A PROFILE-LESS CALLER' END);
END $$;

-- 6. Crypto correctness, bypassing the gate by decrypting directly with the
--    derived key (this is what the gate would allow through for an entitled
--    caller).
INSERT INTO dryrun_results
SELECT 6, 'round trip: decrypt(encrypt(x)) = x',
       extensions.pgp_sym_decrypt(
         public.encrypt_pii_text('0911223344', w.woreda_id),
         public.derive_woreda_key(w.woreda_id)) = '0911223344',
       'aes256'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

-- 7. Ciphertext is randomized (same input twice -> different bytes), which is
--    what makes the non-searchable columns non-searchable.
INSERT INTO dryrun_results
SELECT 7, 'ciphertext is randomized, not deterministic',
       public.encrypt_pii_text('0911223344', w.woreda_id)
         <> public.encrypt_pii_text('0911223344', w.woreda_id),
       'distinct ciphertext for identical plaintext'
FROM (SELECT woreda_id FROM public.woreda LIMIT 1) w;

-- 8. Phone normalization folds the formats staff actually type into one index.
INSERT INTO dryrun_results
SELECT 8, 'normalization: 0911..., +251911..., 911... fold together',
       public.normalize_phone('0911223344') = '911223344'
   AND public.normalize_phone('+251 91 122 3344') = '911223344'
   AND public.normalize_phone('251911223344') = '911223344'
   AND public.normalize_phone('911223344') = '911223344'
   AND public.normalize_phone('091-122-3344') = '911223344',
       'canonical form = 9-digit national significant number';

INSERT INTO dryrun_results
SELECT 9, 'normalization: NULL/empty/garbage handled without raising',
       public.normalize_phone(NULL) IS NULL
   AND public.normalize_phone('') IS NULL
   AND public.normalize_phone('n/a') IS NULL,
       'no exception path';

-- 10. Blind index is deterministic within a tenant (so exact-match search
--     works). Explicit skip-with-message rather than a silently-vanishing
--     WHERE clause -- there is only ever one row to insert either way, so a
--     missing row here would otherwise look identical to "not run yet".
DO $$
DECLARE wid uuid;
BEGIN
  SELECT woreda_id INTO wid FROM public.woreda LIMIT 1;
  IF wid IS NULL THEN
    INSERT INTO dryrun_results VALUES
      (10, 'blind index: deterministic within a tenant', true, 'skipped: no woreda');
    RETURN;
  END IF;
  INSERT INTO dryrun_results VALUES
    (10, 'blind index: deterministic within a tenant',
     public.phone_blind_index('0911223344', wid) = public.phone_blind_index('+251911223344', wid),
     'two spellings -> one index value');
END $$;

-- 11. ...and different across tenants, so it cannot be correlated. This is the
--     check that used to vanish entirely (INSERT ... SELECT with a WHERE that
--     matches zero rows inserts zero rows) on a project with fewer than two
--     woredas -- the harness would report "N/N passed" one short of the real
--     total with nothing to say why. Explicit skip branch instead.
DO $$
DECLARE a_id uuid; b_id uuid;
BEGIN
  SELECT woreda_id INTO a_id FROM public.woreda ORDER BY woreda_id LIMIT 1;
  SELECT woreda_id INTO b_id FROM public.woreda ORDER BY woreda_id DESC LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL OR a_id = b_id THEN
    INSERT INTO dryrun_results VALUES
      (11, 'blind index: same phone differs across tenants', true, 'skipped: needs two woredas');
    RETURN;
  END IF;
  INSERT INTO dryrun_results VALUES
    (11, 'blind index: same phone differs across tenants',
     public.phone_blind_index('0911223344', a_id) <> public.phone_blind_index('0911223344', b_id),
     'no cross-tenant correlation');
END $$;

-- 12. Wrong tenant's key cannot decrypt another tenant's ciphertext even if the
--     gate were passed -- the per-tenant derivation is doing real work. The
--     expected outcome is that pgp_sym_decrypt RAISES ("Wrong key or corrupt
--     data"), so this has to be caught rather than compared.
DO $$
DECLARE
  a_id uuid; b_id uuid; ct bytea; leaked text; blocked boolean := false;
BEGIN
  SELECT woreda_id INTO a_id FROM public.woreda ORDER BY woreda_id LIMIT 1;
  SELECT woreda_id INTO b_id FROM public.woreda ORDER BY woreda_id DESC LIMIT 1;

  IF a_id IS NULL OR b_id IS NULL OR a_id = b_id THEN
    INSERT INTO dryrun_results VALUES
      (12, 'cross-tenant ciphertext does not decrypt under the wrong key', true,
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
    (12, 'cross-tenant ciphertext does not decrypt under the wrong key', blocked,
     'foreign key cannot read tenant A ciphertext');
END $$;

-- 13. And through the caller-facing function it must come back as a quiet
--     NULL rather than an error the caller can probe.
DO $$
DECLARE a_id uuid; b_id uuid; ct bytea;
BEGIN
  SELECT woreda_id INTO a_id FROM public.woreda ORDER BY woreda_id LIMIT 1;
  SELECT woreda_id INTO b_id FROM public.woreda ORDER BY woreda_id DESC LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL OR a_id = b_id THEN
    INSERT INTO dryrun_results VALUES
      (13, 'decrypt_pii_text swallows the failure and returns NULL', true,
       'skipped: needs two woredas');
    RETURN;
  END IF;
  ct := public.encrypt_pii_text('0911223344', a_id);
  INSERT INTO dryrun_results VALUES
    (13, 'decrypt_pii_text swallows the failure and returns NULL',
     public.decrypt_pii_text(ct, b_id) IS NULL,
     'no error surface for probing');
END $$;

-- 14. The sync trigger actually populates the encrypted columns and the blind
--     index from a live row's existing plaintext, and the stored index matches
--     what a search for that same number would compute.
DO $$
DECLARE
  rid uuid; wid uuid; plain text;
  enc_ok boolean; idx_ok boolean; roundtrip_ok boolean;
BEGIN
  SELECT resident_id, woreda_id, phone_number INTO rid, wid, plain
  FROM public.resident WHERE phone_number IS NOT NULL LIMIT 1;

  IF rid IS NULL THEN
    INSERT INTO dryrun_results VALUES
      (14, 'trigger: populates _enc on live row', true, 'skipped: no resident with a phone'),
      (15, 'trigger: stored blind index matches a search for the same number', true, 'skipped: no resident with a phone'),
      (16, 'trigger: encrypted value decrypts back to the original plaintext', true, 'skipped: no resident with a phone');
    RETURN;
  END IF;

  UPDATE public.resident SET phone_number = phone_number WHERE resident_id = rid;

  SELECT phone_number_enc IS NOT NULL,
         phone_number_blind_index = public.phone_blind_index(plain, wid),
         extensions.pgp_sym_decrypt(phone_number_enc, public.derive_woreda_key(wid)) = plain
    INTO enc_ok, idx_ok, roundtrip_ok
  FROM public.resident WHERE resident_id = rid;

  INSERT INTO dryrun_results VALUES
    (14, 'trigger: populates _enc on live row', enc_ok, 'ciphertext written'),
    (15, 'trigger: stored blind index matches a search for the same number',
         idx_ok, 'search path works'),
    (16, 'trigger: encrypted value decrypts back to the original plaintext',
         roundtrip_ok, 'no data loss');
END $$;

-- 17. The payment amount guard rejects a real, non-positive INSERT -- not a
--     tautology about the `<=` operator. Check 16 used to assert
--     `IF -5 <= 0 THEN raised := true` unconditionally inside the very block
--     it was supposed to be testing, so it passed with `payment_amount_sync()`
--     never invoked at all. This attempts a real insert with a real payment_id
--     (satisfying payment_type's enum and every NOT NULL column) and asserts
--     the trigger's OWN message, not just that something failed -- the
--     pre-existing payment_amount_check CHECK constraint would also reject
--     this row, so matching the trigger's exact wording is what proves the
--     NEW guard fired rather than the old constraint coincidentally catching
--     the same bad value.
DO $$
DECLARE wid uuid; trigger_fired boolean := false; err text;
BEGIN
  SELECT woreda_id INTO wid FROM public.woreda LIMIT 1;
  IF wid IS NULL THEN
    INSERT INTO dryrun_results VALUES
      (17, 'payment guard: a real negative-amount INSERT is rejected by the trigger', true, 'skipped: no woreda');
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.payment (woreda_id, payment_type, amount, payment_date)
    VALUES (wid, 'service_fee', -5, current_date);
  EXCEPTION WHEN OTHERS THEN
    err := SQLERRM;
    trigger_fired := (err LIKE '%must be greater than zero%');
  END;
  INSERT INTO dryrun_results VALUES
    (17, 'payment guard: a real negative-amount INSERT is rejected by the trigger',
     trigger_fired,
     CASE WHEN trigger_fired THEN 'trigger raised its own message'
          ELSE 'did not raise the expected message: ' || COALESCE(err, '(no error at all)') END);
END $$;

-- 18. Every decrypting view must carry security_invoker = on. This is the
--     assertion that would have caught the 00000000000006 defect. Asserts an
--     exact count, not just bool_and() over whatever rows happen to match --
--     bool_and() over a set that shrank from 5 views to fewer (a rename, a
--     dropped view) is still true, and would report "compliant" over less
--     than the full surface without saying so.
INSERT INTO dryrun_results
SELECT 18, 'all 5 decrypting views exist and have security_invoker = on',
       count(*) = 5
       AND bool_and(COALESCE(c.reloptions::text LIKE '%security_invoker=on%', false)),
       'views checked: ' || count(*)::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE '%_decrypted';

-- 19. anon must hold no privilege on any decrypting view -- via a direct grant
--     OR via PUBLIC. information_schema.role_table_grants (the original
--     version of this check) only sees grants made TO anon directly; a grant
--     to PUBLIC is invisible there even though anon inherits it. Verified live:
--     granting SELECT to PUBLIC on a probe view made the old query report zero
--     anon grants while has_table_privilege('anon', ..., 'SELECT') correctly
--     reported true. has_table_privilege is PUBLIC-aware and is what the
--     function-privilege checks below already use for the same reason.
INSERT INTO dryrun_results
SELECT 19, 'anon has no privilege (direct or via PUBLIC) on any decrypting view',
       count(*) = 5 AND bool_and(
         NOT has_table_privilege('anon', c.oid, 'SELECT')
         AND NOT has_table_privilege('anon', c.oid, 'INSERT')
         AND NOT has_table_privilege('anon', c.oid, 'UPDATE')
         AND NOT has_table_privilege('anon', c.oid, 'DELETE')
       ),
       'views checked: ' || count(*)::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE '%_decrypted';

-- 20. authenticated must hold SELECT on every decrypting view and NOTHING
--     ELSE. Supabase's default ACL grants INSERT/UPDATE/DELETE to
--     `authenticated` on every new public relation
--     (00000000000007_tighten_anon_grants.sql's own header documents this),
--     so an earlier version of this migration left all five views writable by
--     any authenticated user -- not exploitable given security_invoker = on
--     and the base table's RLS, but a write surface nobody designed. This is
--     the regression test for that fix.
INSERT INTO dryrun_results
SELECT 20, 'authenticated has SELECT-only (no write) on every decrypting view',
       count(*) = 5 AND bool_and(
         has_table_privilege('authenticated', c.oid, 'SELECT')
         AND NOT has_table_privilege('authenticated', c.oid, 'INSERT')
         AND NOT has_table_privilege('authenticated', c.oid, 'UPDATE')
         AND NOT has_table_privilege('authenticated', c.oid, 'DELETE')
       ),
       'views checked: ' || count(*)::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE '%_decrypted';

-- 21. anon/authenticated must not hold EXECUTE on the internal primitives.
--     normalize_phone was missing from this list in the original version of
--     this check -- it was the one function in the migration with no explicit
--     REVOKE, left on Postgres's default PUBLIC grant, and untested here for
--     exactly that reason. Count asserted, not just bool_and(), for the same
--     shrinking-set reason as check 18.
INSERT INTO dryrun_results
SELECT 21, 'internal crypto primitives are not executable by app roles',
       count(*) = 7
       AND bool_and(NOT (has_function_privilege('anon', p.oid, 'EXECUTE')
                      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
       'primitives checked: ' || count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('pii_root_key','derive_woreda_key','encrypt_pii_text',
                    'encrypt_pii_numeric','phone_blind_index','pii_encryption_status',
                    'normalize_phone');

-- 22. ...while the caller-facing pair IS executable by authenticated (the
--     invoker views depend on it) and NOT by anon.
INSERT INTO dryrun_results
SELECT 22, 'decrypt pair executable by authenticated, not by anon',
       count(*) = 3
       AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       'functions checked: ' || count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('decrypt_pii_text','decrypt_pii_numeric','my_phone_blind_index');

-- 23. service_role must hold EXECUTE on everything the backfill script and a
--     future Edge Function actually need to call -- and still NOT on
--     pii_root_key/derive_woreda_key, which stay closed to every role except
--     the functions that call them internally. This is the regression test
--     for the "REVOKE FROM PUBLIC also silently strips service_role, since
--     PUBLIC was its only source of EXECUTE" bug documented in
--     00000000000008_close_definer_helpers.sql and repeated in this file
--     before this fix: the original grants left every one of these unreachable
--     by service_role, which would have made the stage-2 backfill and every
--     stage-3 Edge Function read fail with "permission denied".
INSERT INTO dryrun_results
SELECT 23, 'service_role can execute what it needs, and nothing more than that',
       count(*) FILTER (WHERE p.proname IN (
         'encrypt_pii_text','encrypt_pii_numeric','phone_blind_index',
         'pii_encryption_status','decrypt_pii_text','decrypt_pii_numeric'
       ) AND has_function_privilege('service_role', p.oid, 'EXECUTE')) = 6
       AND count(*) FILTER (WHERE p.proname IN ('pii_root_key','derive_woreda_key')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')) = 0,
       'checked ' || count(*)::text || ' functions'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('pii_root_key','derive_woreda_key','encrypt_pii_text',
                    'encrypt_pii_numeric','phone_blind_index','pii_encryption_status',
                    'decrypt_pii_text','decrypt_pii_numeric');

-- 24. Blanket safety net: assert the row count matches what a full, nothing-
--     silently-skipped run produces. If a future edit reintroduces a check
--     that can vanish to zero rows under some data shape, this is what turns
--     that into a loud FAIL instead of a quietly-smaller "N/N passed".
INSERT INTO dryrun_results
SELECT 24, 'harness: no check silently produced zero rows', count(*) = 23,
       'rows in dryrun_results before this check: ' || count(*)::text
FROM dryrun_results;

SELECT seq, check_name, passed, detail FROM dryrun_results ORDER BY seq;

ROLLBACK;
