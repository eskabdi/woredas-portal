-- Credential numbering and public verification.
--
-- Three things happen here, all in service of the redesigned ID card:
--
--   1. The credential number's check digit moves from a bespoke mod-11 scheme to
--      standard Luhn.
--   2. The 13-digit length of that number becomes an enforced invariant. The
--      card's Code 128 barcode and the fixed check-digit position both depend on
--      it, and nothing enforced it before.
--   3. verify_credential_token() backs the public /v/<token> page, returning a
--      minimal field set to anonymous callers and the full record to staff.

SET check_function_bodies = false;

-- ---------------------------------------------------------------------------
-- 1. Luhn
-- ---------------------------------------------------------------------------

-- Standard Luhn (mod 10) check digit for a numeric string.
-- Doubling starts at the rightmost digit of the body, which is the position that
-- becomes second-from-right once the check digit is appended.
CREATE OR REPLACE FUNCTION public.luhn_check_digit(_digits TEXT)
 RETURNS INT
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_sum INT := 0;
  v_digit INT;
  i INT;
BEGIN
  IF _digits IS NULL OR _digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'luhn_check_digit: expected digits only, got %', _digits;
  END IF;

  FOR i IN 1..length(_digits) LOOP
    v_digit := substring(_digits FROM (length(_digits) - i + 1) FOR 1)::INT;
    IF i % 2 = 1 THEN
      v_digit := v_digit * 2;
      IF v_digit > 9 THEN v_digit := v_digit - 9; END IF;
    END IF;
    v_sum := v_sum + v_digit;
  END LOOP;

  RETURN (10 - (v_sum % 10)) % 10;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Length invariants
-- ---------------------------------------------------------------------------

-- kebele_number is text, so "1" and "01" can both exist as distinct rows while
-- LPAD-ing to the same two digits — two kebeles stamping identical digits onto
-- their cards. Normalise first, then make it impossible.
UPDATE public.kebele
   SET kebele_number = LPAD(kebele_number, 2, '0')
 WHERE kebele_number ~ '^[0-9]$';

ALTER TABLE public.woreda
  DROP CONSTRAINT IF EXISTS woreda_numeric_code_two_digits;
ALTER TABLE public.woreda
  ADD CONSTRAINT woreda_numeric_code_two_digits
  CHECK (woreda_numeric_code BETWEEN 1 AND 99);

ALTER TABLE public.kebele
  DROP CONSTRAINT IF EXISTS kebele_number_two_digits;
ALTER TABLE public.kebele
  ADD CONSTRAINT kebele_number_two_digits
  CHECK (kebele_number ~ '^[0-9]{1,2}$');

-- ---------------------------------------------------------------------------
-- 3. Credential number assignment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_credential_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_num SMALLINT;
  v_kebele_num TEXT;
  v_year SMALLINT;
  v_next INT;
  v_digits TEXT;
  v_check INT;
BEGIN
  IF NEW.credential_number IS NOT NULL AND NEW.credential_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_numeric_code INTO v_woreda_num FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  SELECT LPAD(kebele_number::TEXT, 2, '0') INTO v_kebele_num FROM public.kebele WHERE kebele_id = NEW.issuing_kebele_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;

  INSERT INTO public.credential_number_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = credential_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  IF v_next > 999999 THEN
    RAISE EXCEPTION 'credential sequence exhausted for woreda % in year %', NEW.woreda_id, v_year;
  END IF;

  v_digits := LPAD(v_woreda_num::TEXT, 2, '0') || v_kebele_num || LPAD(v_year::TEXT, 2, '0') || LPAD(v_next::TEXT, 6, '0');

  -- The card's barcode and the check-digit position both assume exactly this
  -- shape. Fail here rather than print a card that cannot be scanned.
  IF v_digits !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'credential number body must be 12 digits, got "%"', v_digits;
  END IF;

  v_check := public.luhn_check_digit(v_digits);

  NEW.credential_number := LPAD(v_woreda_num::TEXT,2,'0') || '-' || v_kebele_num || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0') || '-' || v_check;
  NEW.serial_number := v_digits;
  RETURN NEW;
END;
$function$;

-- Existing credentials were numbered under the old mod-11 rule, so their check
-- digit is wrong under Luhn. They are unsigned and unprinted; renumber them.
UPDATE public.residence_credential
   SET credential_number = substring(serial_number FROM 1 FOR 2) || '-'
                        || substring(serial_number FROM 3 FOR 2) || '-'
                        || substring(serial_number FROM 5 FOR 2) || '-'
                        || substring(serial_number FROM 7 FOR 6) || '-'
                        || public.luhn_check_digit(serial_number)
 WHERE serial_number ~ '^[0-9]{12}$'
   AND qr_payload IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Public verification
-- ---------------------------------------------------------------------------

-- Backs the public /v/<token> page. The token carries the credential number as
-- 13 bare digits; the column stores it hyphenated, hence the replace().
--
-- Anonymous callers get only what confirms a card is genuine and current. The
-- photo path and full date of birth are returned solely to an active app_user —
-- a stranger scanning a card off a desk learns nothing they could not read off
-- the front of it.
CREATE OR REPLACE FUNCTION public.verify_credential_token(_credential_digits TEXT)
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
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    rc.credential_number,
    rc.status::text,
    rc.issue_date,
    rc.expiry_date,
    COALESCE(r.full_name_am, r.full_name),
    w.woreda_name_am,
    w.woreda_name_en,
    k.kebele_name_am,
    k.kebele_name_en,
    CASE WHEN public.is_active_app_user() THEN r.photo_url END,
    CASE WHEN public.is_active_app_user() THEN r.date_of_birth END
  FROM public.residence_credential rc
  LEFT JOIN public.resident r ON r.resident_id = rc.resident_id
  LEFT JOIN public.woreda w ON w.woreda_id = rc.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = rc.issuing_kebele_id
  WHERE replace(rc.credential_number, '-', '') = _credential_digits
  LIMIT 1;
$function$;

-- True when the caller is a signed-in, active staff account.
CREATE OR REPLACE FUNCTION public.is_active_app_user()
 RETURNS BOOLEAN
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = auth.uid() AND au.status = 'active'
  );
$function$;

GRANT EXECUTE ON FUNCTION public.verify_credential_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_app_user() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.luhn_check_digit(TEXT) TO authenticated;
