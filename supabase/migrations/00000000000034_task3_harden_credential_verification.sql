-- ============================================================================
-- Harden public credential verification; INVALID semantics; verification log.
--
-- Closes F-02 from docs/system-review-2026-09.md. Task 3 of
-- fix-task-production-readiness-v3.
--
-- verify_credential_token() was keyed on the credential NUMBER -- 13 digits,
-- sequential per woreda/kebele/year, embedded (Luhn check digit and all) in
-- every printed card and every signed QR payload. The card's QR carries a
-- cryptographically signed blob (qr_payload, ES256 -- see
-- src/utils/harariCredentialCrypto.ts), but src/routes/v.$token.tsx only used
-- that signature to unwrap the plain credential number, then called this RPC
-- with the number -- which is anon-callable and never checked the signature
-- itself. So the actual gate on "does this caller hold a real card" was the
-- number's guessability, not the signature: a low sequential range per
-- woreda/kebele/year is enumerable in minutes, and every hit returns a
-- resident's name, woreda/kebele, issue/expiry dates and current status with
-- no rate limit at all.
--
-- Five changes:
--
--   1. verify_credential_token() is rekeyed on qr_payload itself -- the same
--      signed blob the QR already carries end to end, so no re-issuance and
--      no new column. This matches the entropy verify_service_letter() and
--      verify_receipt() already rely on (their own random 12-char/32-symbol
--      tokens, ~2^60) without inventing a parallel token scheme for
--      credentials specifically. Old param name (_credential_digits) is gone;
--      callers must update (both of this repo's own call sites do, same PR).
--   2. Rate limited on the anon path via rate_limit_hit() -- reusing
--      rate_limit_bucket, nothing new built. This reverses that one function
--      from 00000000000022's stated exemption for verify_credential_token
--      specifically (verify_service_letter is untouched here -- out of
--      scope for this task). Keyed on the platform-attested client IP
--      (cf-connecting-ip/x-real-ip, falling back to X-Forwarded-For's first
--      hop only when neither is present -- same header-trust order as
--      supabase/functions/_shared/clientIp.ts, for the same reason: those
--      two headers can't be overwritten by the caller, XFF's first hop can
--      be). Fails OPEN on any rate-limiter error, matching this repo's
--      established policy for every other limiter here (checkRateLimit(),
--      supabase/functions/_shared/rateLimit.ts) -- a broken limiter must
--      never take down the one page a resident needs to prove their card is
--      genuine.
--   3. Credential-NUMBER lookup still exists, but only for an active staff
--      caller (is_active_app_user()) of the SAME woreda as the credential
--      (or a super_admin) -- this is HararildScanner.tsx's path (the
--      in-portal /woreda/credentials/verify scanner), already reachable only
--      from inside the authenticated app. An anonymous caller passing a bare
--      number now matches nothing. is_active_app_user() alone checks
--      signed-in-and-active with no woreda predicate at all, so without the
--      explicit woreda_id check here, any active staff account of ANY
--      tenant could look up any OTHER tenant's credential by number --
--      exactly the enumerable-number problem this migration exists to
--      close, just moved one gate over. Caught in review before this
--      migration was ever committed.
--   4. The four terminal/withdrawn statuses (expired, suspended, revoked,
--      replaced) collapse to a single 'invalid' for an ANONYMOUS caller --
--      today's response leaks exactly which of the four applies, which is
--      more than a stranger holding (or guessing at) a card needs to learn.
--      Staff keep the real status (HararildScanner.tsx's in-portal tool
--      needs the distinction to know what to tell the resident).
--   5. credential_verification_log records every attempt -- matched or not,
--      rate-limited or not -- written from inside this SECURITY DEFINER
--      function so the anon path logs too, same as every other
--      staff-authenticated mutation's audit_log row but for a table nothing
--      authenticated ever writes to directly.
--
-- ADDITIVE for schema: no DROP of any table, column or CHECK constraint.
-- verify_credential_token() itself is DROPped and recreated, not
-- CREATE OR REPLACEd -- Postgres refuses to rename a parameter
-- ("cannot change name of input parameter") on an existing function, so a
-- drop is unavoidable for this one function. Safe here: it happens inside
-- this migration's own transaction, so PostgREST never observes a moment
-- where the function doesn't exist.
-- ============================================================================

BEGIN;

CREATE TABLE public.credential_verification_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- NULL when the attempted value matched no credential at all -- not tied to
  -- any tenant, so only a super_admin can see that row (RLS below).
  woreda_id uuid REFERENCES public.woreda(woreda_id),
  matched_credential_id uuid REFERENCES public.residence_credential(credential_id),
  attempted_value_kind text NOT NULL CHECK (attempted_value_kind IN ('token', 'credential_number')),
  -- Forensic value, not a secret store: this table is RLS-scoped to staff of
  -- the matched tenant (or super_admin), same trust level as audit_log.
  -- Length-capped: the caller controls this input entirely (any string, not
  -- just a real token), and the rate limiter fails open, so an unbounded
  -- column would let an anonymous caller grow this table's row size
  -- arbitrarily during a limiter outage.
  attempted_value text NOT NULL CHECK (length(attempted_value) <= 512),
  -- 'rate_limited' is a reserved value, not currently written -- see the
  -- comment at the RAISE EXCEPTION in verify_credential_token() below for
  -- why a rejection can't durably log a row in the same transaction that
  -- raises it.
  result text NOT NULL CHECK (result IN ('valid', 'invalid', 'not_found', 'rate_limited')),
  is_staff_caller boolean NOT NULL DEFAULT false,
  source_ip text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Read pattern is "this woreda's rows, newest first" (and super_admin's
-- "everything, newest first") -- index matches that rather than relying on
-- the primary key's UUID order.
CREATE INDEX credential_verification_log_woreda_created_idx
  ON public.credential_verification_log (woreda_id, created_at DESC);

ALTER TABLE public.credential_verification_log ENABLE ROW LEVEL SECURITY;

-- Same shape as audit_log_tenant_read: a super_admin sees everything
-- (including the woreda_id IS NULL "matched nothing" rows), tenant staff see
-- only their own woreda's rows. Nothing INSERTs here directly -- only this
-- migration's SECURITY DEFINER function does, as postgres, which bypasses
-- RLS -- so no INSERT policy is needed for the one legitimate writer.
CREATE POLICY credential_verification_log_tenant_read ON public.credential_verification_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id()));

-- Supabase's default privileges hand `authenticated` full DML on a new
-- table at CREATE TIME (00000000000007's ALTER DEFAULT PRIVILEGES only
-- narrowed anon's default, not authenticated's) -- naming authenticated
-- here too, not just PUBLIC/anon, so the later GRANT SELECT is the actual
-- ceiling rather than a no-op sitting on top of an already-wider default.
-- RLS has no INSERT/UPDATE/DELETE policy either way, so this is
-- defense-in-depth, not the only barrier.
REVOKE ALL ON TABLE public.credential_verification_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.credential_verification_log TO authenticated;

-- Lookup by the signed QR payload is the whole point of item 1 -- make it
-- indexed. Partial: qr_payload is NULL until a credential is actually signed
-- (sign-credential Edge Function), and most rows in any real dataset are
-- pre-signature at any given time.
CREATE UNIQUE INDEX IF NOT EXISTS residence_credential_qr_payload_key
  ON public.residence_credential (qr_payload)
  WHERE qr_payload IS NOT NULL;

-- Postgres refuses to rename a parameter via CREATE OR REPLACE
-- ("cannot change name of input parameter") -- an explicit DROP is required
-- for that specific change, even though the function's purpose, return
-- shape and grants are otherwise unchanged. Safe here: it happens inside
-- this migration's own transaction, so PostgREST never observes a moment
-- where the function doesn't exist.
DROP FUNCTION IF EXISTS public.verify_credential_token(TEXT);

CREATE FUNCTION public.verify_credential_token(_token TEXT)
 RETURNS TABLE(
   credential_number TEXT,
   status TEXT,
   issue_date DATE,
   expiry_date DATE,
   resident_full_name TEXT,
   woreda_name_am TEXT,
   woreda_name_en TEXT,
   kebele_name_am TEXT,
   kebele_name_en TEXT,
   photo_path TEXT,
   date_of_birth DATE
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_staff boolean := public.is_active_app_user();
  v_headers jsonb;
  v_ip text;
  v_hits integer;
  v_row RECORD;
  v_raw_status text;
  v_public_status text;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN
    RAISE EXCEPTION 'verify_credential_token: token is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Best-effort IP for the rate-limit key and the log row. Same
  -- attested-header-first order as clientIp.ts: cf-connecting-ip/x-real-ip
  -- can't be overwritten by the caller, XFF's first hop can be, so it's the
  -- last resort, not the first check.
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  v_ip := COALESCE(
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-real-ip',
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), '')
  );

  -- Rate limit the anon path only -- an authenticated staff session already
  -- has its own audit trail and this tool is part of their normal job.
  -- Fails OPEN: a limiter outage must never block a resident proving their
  -- own card is genuine (same policy as every other limiter in this repo).
  IF NOT v_is_staff THEN
    -- Only the limiter CALL itself is guarded (fail open on a limiter
    -- malfunction) -- an unexpected error from rate_limit_hit() itself must
    -- not block a real verification.
    v_hits := NULL;
    BEGIN
      v_hits := public.rate_limit_hit('verify_credential_token:' || COALESCE(v_ip, 'unknown'), 60);
    EXCEPTION WHEN OTHERS THEN
      v_hits := NULL;
    END;
    IF v_hits IS NOT NULL AND v_hits > 30 THEN
      -- Deliberately NOT logged to credential_verification_log: PostgREST
      -- runs this whole function as one transaction per call, and RAISE
      -- EXCEPTION aborts that transaction -- an INSERT made just before it
      -- would roll back along with everything else rate_limit_hit() wrote,
      -- including this same call's own bucket increment. A true audit trail
      -- for the rejection itself would need an autonomous transaction
      -- (dblink or similar), which this project doesn't run anywhere and
      -- which is disproportionate machinery for logging a 429. The
      -- enforcement itself is unaffected by this: rate_limit_bucket's count
      -- for this window settles at the limit rather than climbing past it
      -- (each further call recomputes "over budget" from the same
      -- last-committed count and is rejected the same way), so every call
      -- past the threshold is still correctly blocked -- only the exact
      -- count of how many were blocked, and a durable log row per
      -- rejection, are not observable.
      RAISE EXCEPTION 'Too many requests'
        USING ERRCODE = 'insufficient_resources';
    END IF;
  END IF;

  -- Item 1 + item 3: the high-entropy signed payload always matches; the
  -- bare credential number only matches for an active staff caller of the
  -- SAME woreda as the credential (or a super_admin) -- is_active_app_user()
  -- alone has no woreda predicate, so without this the number branch would
  -- let any tenant's staff enumerate any OTHER tenant's credentials, which
  -- is the exact vulnerability this migration exists to close, just moved
  -- behind a login instead of removed.
  SELECT
    rc.credential_id, rc.woreda_id, rc.credential_number, rc.status::text,
    rc.issue_date, rc.expiry_date,
    COALESCE(r.full_name_am, r.full_name) AS resident_full_name,
    w.woreda_name_am, w.woreda_name_en, k.kebele_name_am, k.kebele_name_en,
    r.photo_url, r.date_of_birth
  INTO v_row
  FROM public.residence_credential rc
  LEFT JOIN public.resident r ON r.resident_id = rc.resident_id
  LEFT JOIN public.woreda w ON w.woreda_id = rc.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = rc.issuing_kebele_id
  WHERE rc.qr_payload = _token
     OR (
       v_is_staff
       AND (public.is_super_admin() OR rc.woreda_id = public.get_user_woreda_id())
       AND replace(rc.credential_number, '-', '') = _token
     )
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.credential_verification_log
      (attempted_value_kind, attempted_value, result, is_staff_caller, source_ip)
    VALUES (
      -- A miss can't be classified by matching against a row (there isn't
      -- one) -- shape of the input is the only signal: the number is
      -- exactly 13 digits (WW-KK-YY-NNNNNN-C with hyphens stripped),
      -- anything else is treated as a token attempt.
      CASE WHEN _token ~ '^[0-9]{13}$' THEN 'credential_number' ELSE 'token' END,
      left(_token, 512), 'not_found', v_is_staff, v_ip
    );
    RETURN;
  END IF;

  v_raw_status := v_row.status;
  -- Item 4: collapse the four terminal/withdrawn statuses to a single
  -- 'invalid' for anyone who is not staff. Staff (HararildScanner.tsx) keep
  -- the real value -- they need to know which applies to tell the resident
  -- what to do next.
  v_public_status := CASE
    WHEN NOT v_is_staff AND v_raw_status IN ('expired', 'suspended', 'revoked', 'replaced') THEN 'invalid'
    ELSE v_raw_status
  END;

  INSERT INTO public.credential_verification_log
    (woreda_id, matched_credential_id, attempted_value_kind, attempted_value, result, is_staff_caller, source_ip)
  VALUES (
    v_row.woreda_id, v_row.credential_id,
    CASE WHEN v_is_staff AND replace(v_row.credential_number, '-', '') = _token THEN 'credential_number' ELSE 'token' END,
    left(_token, 512),
    -- The log records the credential's TRUE state, independent of what this
    -- particular caller was shown -- a staff lookup of a revoked credential
    -- is not a "valid" result just because staff see the real status value.
    CASE WHEN v_raw_status IN ('expired', 'suspended', 'revoked', 'replaced') THEN 'invalid' ELSE 'valid' END,
    v_is_staff, v_ip
  );

  RETURN QUERY SELECT
    v_row.credential_number,
    v_public_status,
    v_row.issue_date,
    v_row.expiry_date,
    v_row.resident_full_name,
    v_row.woreda_name_am,
    v_row.woreda_name_en,
    v_row.kebele_name_am,
    v_row.kebele_name_en,
    CASE WHEN v_is_staff THEN v_row.photo_url END,
    CASE WHEN v_is_staff THEN v_row.date_of_birth END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_credential_token(TEXT) TO anon, authenticated;

COMMIT;
