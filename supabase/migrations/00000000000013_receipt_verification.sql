-- ============================================================================
-- Public verification for revenue receipts, on the same pattern as
-- assign_letter_verification_token()/verify_service_letter() (baseline): a
-- random opaque token stamped at INSERT, checked by a SECURITY DEFINER RPC
-- that anon can call. This is deliberately NOT the credential's cryptographic
-- ES256-signing path (sign-credential Edge Function + qr_payload) -- a
-- receipt is a same-day transaction record scoped to one woreda's own
-- database, not a portable identity document meant to be verified offline or
-- against a rotating keypair, so a DB-side token check is proportionate the
-- same way it already is for issued letters.
-- ============================================================================

ALTER TABLE public.receipt ADD COLUMN verification_token text;
CREATE UNIQUE INDEX receipt_verification_token_key ON public.receipt USING btree (verification_token);

CREATE OR REPLACE FUNCTION public.gen_receipt_verification_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_token text;
BEGIN
  LOOP
    v_token := '';
    FOR i IN 1..12 LOOP
      v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.receipt WHERE verification_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_receipt_verification_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.verification_token IS NULL OR NEW.verification_token = '' THEN
    NEW.verification_token := public.gen_receipt_verification_token();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_assign_receipt_verification_token
  BEFORE INSERT ON public.receipt
  FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_verification_token();

-- Backfill: every receipt inserted before this migration has verification_token
-- IS NULL (the trigger above only fires on future INSERTs), which would leave
-- every already-printed receipt's QR permanently unable to verify. One row at
-- a time so gen_receipt_verification_token()'s own uniqueness check
-- (a query against this same table) sees each prior backfilled token.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT receipt_id FROM public.receipt WHERE verification_token IS NULL LOOP
    UPDATE public.receipt
       SET verification_token = public.gen_receipt_verification_token()
     WHERE receipt_id = r.receipt_id;
  END LOOP;
END;
$$;

-- Curated public read: resident name and woreda/kebele identity are already
-- the precedent verify_service_letter() sets for what a QR scan may reveal
-- (see 00000000000008's note: "verify_service_letter() also stays open to
-- anon"). Deliberately excludes anything not already public through that
-- precedent -- no phone number, no reference/payment IDs, no resident_number,
-- no house number.
--
-- "Paid by" resolution mirrors the client's own kebele-derivation logic in
-- woreda.revenue.tsx (household.kebele_id ?? rental_request's rental house's
-- kebele_id) rather than payment.resident_id alone, because
-- CollectRentalDialog's INSERT (same file) never populates payment.resident_id
-- -- only rental_request_id -- so a rental-rent receipt would otherwise verify
-- with no payer name at all.
CREATE OR REPLACE FUNCTION public.verify_receipt(_token text)
 RETURNS TABLE(
   receipt_number text,
   receipt_date date,
   total_amount numeric,
   payment_type text,
   channel text,
   printed_at timestamp with time zone,
   paid_by_full_name text,
   paid_by_full_name_am text,
   woreda_name_am text,
   woreda_name_en text,
   kebele_name_am text,
   kebele_name_en text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    r.receipt_number,
    r.receipt_date,
    r.total_amount,
    p.payment_type,
    r.cash_bank_channel,
    r.printed_at,
    res.full_name,
    res.full_name_am,
    w.woreda_name_am,
    w.woreda_name_en,
    k.kebele_name_am,
    k.kebele_name_en
  FROM public.receipt r
  JOIN public.payment p ON p.payment_id = r.payment_id
  LEFT JOIN public.rental_occupancy_request ror ON ror.rental_request_id = p.rental_request_id
  LEFT JOIN public.kebele_rental_house krh ON krh.rental_house_id = ror.rental_house_id
  LEFT JOIN public.resident res ON res.resident_id = COALESCE(p.resident_id, ror.resident_id)
  LEFT JOIN public.household h ON h.household_id = p.household_id
  LEFT JOIN public.woreda w ON w.woreda_id = r.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = COALESCE(h.kebele_id, krh.kebele_id)
  WHERE r.verification_token = _token
    AND p.status = 'confirmed'
  LIMIT 1
$function$;

-- Explicit, not relied-on-by-default: PostgREST/Postgres grant EXECUTE to
-- PUBLIC on a new function by default, which would already cover anon here --
-- but this repo's convention (00000000000007/8) is to state every function's
-- anon-reachability outright rather than let it ride on the default.
REVOKE EXECUTE ON FUNCTION public.verify_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_receipt(text) TO anon, authenticated, service_role;
