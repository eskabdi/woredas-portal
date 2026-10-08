-- ============================================================================
-- P0-7 (2026-09-24 audit, WP-DB-013, merges WP-CRY-008): harden the public
-- verification tokens printed on issued letters and revenue receipts.
--
-- Before: gen_letter_verification_token() / gen_receipt_verification_token()
-- built 12 characters from random() -- a non-cryptographic PRNG, ~60 bits --
-- and the assign triggers kept any client-supplied token, so an authenticated
-- clerk could choose a letter's or receipt's public verification code.
-- service_request had no pin trigger, so the token could also be rewritten
-- after the letter was printed.
--
-- After:
--   * 26 characters from extensions.gen_random_bytes() over the same
--     unambiguous 32-symbol alphabet (no I/O/0/1), 130 bits. 256 is a
--     multiple of 32, so `byte & 31` is uniform -- no modulo bias. The
--     alphabet is kept so the printed code stays easy to read and type and
--     every existing 12-character token still verifies unchanged.
--   * Every insert from a user session gets a server-generated token,
--     whatever the client sent. Inserts with no auth.uid() (service_role,
--     migrations, a pg_restore of a backup) keep a supplied token, so a
--     disaster restore does not silently invalidate every printed QR code.
--   * service_request.verification_token is immutable from a user session
--     once set (receipt already had trg_pin_receipt_verification_token). A
--     service-level UPDATE stays possible on purpose: it is the rotation path
--     for a token that is ever disclosed.
--
-- The disclosed letter token quoted in migration 64 and the remediation
-- report matches no row in production (checked 2026-10-08), so there is
-- nothing to rotate. Existing tokens (2 letters, 9 receipts) are left as
-- issued: rotating them would break QR codes already on paper.
--
-- Additive only: CREATE OR REPLACE for functions, one new trigger.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gen_letter_verification_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_token text;
  i int;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(26);
    v_token := '';
    FOR i IN 0..25 LOOP
      v_token := v_token || substr(v_alphabet, 1 + (get_byte(v_bytes, i) & 31), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.service_request WHERE verification_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gen_receipt_verification_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_token text;
  i int;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(26);
    v_token := '';
    FOR i IN 0..25 LOOP
      v_token := v_token || substr(v_alphabet, 1 + (get_byte(v_bytes, i) & 31), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.receipt WHERE verification_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_letter_verification_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     OR NEW.verification_token IS NULL OR NEW.verification_token = '' THEN
    NEW.verification_token := public.gen_letter_verification_token();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_receipt_verification_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     OR NEW.verification_token IS NULL OR NEW.verification_token = '' THEN
    NEW.verification_token := public.gen_receipt_verification_token();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pin_letter_verification_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.verification_token IS NOT NULL
     AND NEW.verification_token IS DISTINCT FROM OLD.verification_token THEN
    RAISE EXCEPTION 'service_request.verification_token cannot be changed once assigned';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_pin_letter_verification_token
  BEFORE UPDATE OF verification_token ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.pin_letter_verification_token();
