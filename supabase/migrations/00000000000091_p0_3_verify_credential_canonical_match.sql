-- ---------------------------------------------------------------------------
-- 00000000000091_p0_3_verify_credential_canonical_match.sql
--
-- Security audit 2026-09-24, P0-3 / WP-CRY-001 (High) and WP-CRY-002
-- (Medium). See docs/audit/2026-09-24/02-findings-register.md.
--
-- verify_credential_token() looked a card up by exact string equality on the
-- whole token (`qr_payload = _token`). A token string is not unique for one
-- signed payload:
--
--   (a) the 64-byte ES256 signature is 86 base64url characters and the last
--       character carries 4 unused bits that every decoder ignores, so 15
--       other last characters decode to the same signature;
--   (b) ECDSA is malleable: (r, n - s) verifies exactly like (r, s).
--
-- A variant passes the browser's signature check but matches no row here, and
-- the public page then fell through to its green "verified" banner -- a
-- revoked card, re-encoded by anyone holding a photo of its QR, verified as
-- current (docs/audit/2026-09-24/raw/crypto-qr-malleability.ts.txt).
--
-- The lookup now keys on what the encoding cannot change:
--
--   * the signed payload segment, split_part(token, '.', 1) -- the exact
--     bytes the signature covers -- served by a new expression index; and
--   * the signature's r component (its first 32 bytes once decoded), which
--     neither trick (a) nor (b) touches.
--
-- Matching on r as well as the payload keeps the old property that a caller
-- must hold the real card's signature to get an answer: the payload alone
-- is readable from the card (WP-CRY-003) and partly guessable, r is 256 bits
-- of signer randomness. Every variant of one card now resolves to that card's
-- row, so a revoked card answers "invalid" however its token is spelled.
-- The exact-match branch stays as a fallback for any legacy token whose
-- signature segment is not the canonical 86-character form.
--
-- Everything else in verify_credential_token() is unchanged from migration
-- 34: the staff-only same-woreda credential-number branch, the anon rate
-- limit (fails open), the status collapse to 'invalid' for anonymous
-- callers, staff-only photo/date of birth, and a credential_verification_log
-- row for every attempt that reaches the lookup. The body moves to
-- SET search_path = '' with fully-qualified names.
--
-- The client half of the fix ships in the same PR: the browser verifier
-- rejects non-canonical base64url and any signature that is not 64 bytes,
-- the signer emits low-S, and both the public page and the staff scanner
-- show green only for a registry status of 'active' (red for no row, amber
-- when the registry cannot be reached).
--
-- ADDITIVE. One new IMMUTABLE helper, one new index, CREATE OR REPLACE on
-- one existing function (same signature, same grants). No table, column,
-- constraint or policy is changed and no row is modified.
-- ---------------------------------------------------------------------------

BEGIN;

-- r component of a token's signature: the first 32 bytes of the decoded
-- 64-byte ES256 signature. NULL for anything that is not a canonical-length
-- (86 character) base64url signature segment, so a malformed token can never
-- match. Postgres' base64 decoder, like atob(), ignores the unused trailing
-- bits, which is exactly why r (not the raw segment) is compared.
CREATE OR REPLACE FUNCTION public.credential_token_signature_r(_token text)
 RETURNS bytea
 LANGUAGE plpgsql
 IMMUTABLE
 STRICT
 PARALLEL SAFE
 SET search_path = ''
AS $function$
DECLARE
  v_sig text := split_part(_token, '.', 2);
  v_bytes bytea;
BEGIN
  IF v_sig !~ '^[A-Za-z0-9_-]{86}$' THEN
    RETURN NULL;
  END IF;
  v_bytes := decode(translate(v_sig, '-_', '+/') || '==', 'base64');
  IF length(v_bytes) <> 64 THEN
    RETURN NULL;
  END IF;
  RETURN substring(v_bytes FROM 1 FOR 32);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.credential_token_signature_r(text) IS
  'r component (first 32 bytes) of a credential token''s ES256 signature, or NULL when the signature segment is not canonical-length base64url. Used by verify_credential_token() so every re-encoding of one card resolves to the same row (00000000000091, WP-CRY-001).';

REVOKE ALL ON FUNCTION public.credential_token_signature_r(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credential_token_signature_r(text) TO service_role;

CREATE INDEX IF NOT EXISTS residence_credential_qr_payload_body_idx
  ON public.residence_credential ((split_part(qr_payload, '.', 1)))
  WHERE qr_payload IS NOT NULL;

CREATE OR REPLACE FUNCTION public.verify_credential_token(_token TEXT)
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
 SET search_path = ''
AS $function$
DECLARE
  v_is_staff boolean := public.is_active_app_user();
  v_headers jsonb;
  v_ip text;
  v_hits integer;
  v_row RECORD;
  v_raw_status text;
  v_public_status text;
  v_body text;
  v_sig_r bytea;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN
    RAISE EXCEPTION 'verify_credential_token: token is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Best-effort IP for the rate-limit key and the log row (unchanged from
  -- migration 34: attested headers first, XFF's first hop last).
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

  -- Anon-only rate limit, failing open on a limiter malfunction (unchanged).
  IF NOT v_is_staff THEN
    v_hits := NULL;
    BEGIN
      v_hits := public.rate_limit_hit('verify_credential_token:' || COALESCE(v_ip, 'unknown'), 60);
    EXCEPTION WHEN OTHERS THEN
      v_hits := NULL;
    END;
    IF v_hits IS NOT NULL AND v_hits > 30 THEN
      RAISE EXCEPTION 'Too many requests'
        USING ERRCODE = 'insufficient_resources';
    END IF;
  END IF;

  v_body := split_part(_token, '.', 1);
  v_sig_r := public.credential_token_signature_r(_token);

  -- The token branch matches the signed payload segment plus the signature's
  -- r component, so a re-encoded signature (unused trailing bits, or the
  -- (r, n - s) twin) still finds the card. Exact equality is kept as a
  -- fallback for a legacy non-canonical token. The credential-number branch
  -- is unchanged: active staff of the credential's own woreda, or a super
  -- admin.
  SELECT
    rc.credential_id, rc.woreda_id, rc.credential_number, rc.status::text AS status,
    rc.issue_date, rc.expiry_date,
    COALESCE(r.full_name_am, r.full_name) AS resident_full_name,
    w.woreda_name_am, w.woreda_name_en, k.kebele_name_am, k.kebele_name_en,
    r.photo_url, r.date_of_birth
  INTO v_row
  FROM public.residence_credential rc
  LEFT JOIN public.resident r ON r.resident_id = rc.resident_id AND r.woreda_id = rc.woreda_id
  LEFT JOIN public.woreda w ON w.woreda_id = rc.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = rc.issuing_kebele_id AND k.woreda_id = rc.woreda_id
  WHERE (
          rc.qr_payload IS NOT NULL
          AND v_sig_r IS NOT NULL
          AND split_part(rc.qr_payload, '.', 1) = v_body
          AND public.credential_token_signature_r(rc.qr_payload) = v_sig_r
        )
     OR rc.qr_payload = _token
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
      CASE WHEN _token ~ '^[0-9]{13}$' THEN 'credential_number' ELSE 'token' END,
      left(_token, 512), 'not_found', v_is_staff, v_ip
    );
    RETURN;
  END IF;

  v_raw_status := v_row.status;
  -- Anonymous callers see one generic 'invalid' for every withdrawn status;
  -- staff keep the real value (unchanged).
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

-- CREATE OR REPLACE keeps the existing grants; restated so this file alone
-- documents who can call it. The public page is anonymous by design.
GRANT EXECUTE ON FUNCTION public.verify_credential_token(TEXT) TO anon, authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run after apply; each must return the value shown):
--
--   SELECT p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'verify_credential_token';   -- {search_path=""}
--   SELECT count(*) FROM pg_indexes
--    WHERE indexname = 'residence_credential_qr_payload_body_idx';           -- 1
--   SELECT has_function_privilege('anon', 'public.credential_token_signature_r(text)', 'EXECUTE');  -- f
--
-- Every stored token is canonical, so r resolves for all of them (expect 0):
--   SELECT count(*) FROM public.residence_credential
--    WHERE qr_payload IS NOT NULL AND public.credential_token_signature_r(qr_payload) IS NULL;
-- ---------------------------------------------------------------------------
