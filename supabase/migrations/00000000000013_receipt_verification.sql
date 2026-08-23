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

-- gen_receipt_verification_token() would otherwise keep Postgres's default
-- PUBLIC EXECUTE grant (returns text, unlike the trigger functions below,
-- so PostgREST *would* expose it to anon) -- not a disclosure on its own
-- (its only read is an RLS-invisible-to-anon uniqueness probe against
-- receipt), but it contradicts this file's own explicit-grant convention for
-- verify_receipt() two functions down. No re-GRANT: its only caller is
-- assign_receipt_verification_token(), itself SECURITY DEFINER, so the
-- inner call already executes as the definer regardless of the caller's own
-- privileges -- same reasoning 00000000000008 gives for is_active_app_user().
REVOKE EXECUTE ON FUNCTION public.gen_receipt_verification_token() FROM PUBLIC;

-- Pins verification_token once assigned: receipt_update (baseline) lets any
-- in-tenant receipt.print/payment.collect holder update any column on their
-- own woreda's receipts, including this one -- without this guard, an
-- otherwise-ordinary UPDATE (or one crafted specifically to do this) could
-- silently invalidate an already-printed receipt's QR by nulling or
-- rewriting its token. SECURITY INVOKER: this only needs to compare OLD/NEW
-- on a row the caller already has UPDATE privilege on via RLS -- no
-- elevation required.
--
-- Only blocks changing an ALREADY-assigned token (OLD IS NOT NULL), not the
-- NULL -> token transition -- the backfill DO block below performs exactly
-- that transition via UPDATE (not INSERT, since the assign trigger is
-- BEFORE INSERT-only), so a plain "any change at all" guard would reject
-- its own backfill.
CREATE OR REPLACE FUNCTION public.pin_receipt_verification_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.verification_token IS NOT NULL
     AND NEW.verification_token IS DISTINCT FROM OLD.verification_token THEN
    RAISE EXCEPTION 'receipt.verification_token cannot be changed once assigned';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_pin_receipt_verification_token
  BEFORE UPDATE ON public.receipt
  FOR EACH ROW EXECUTE FUNCTION public.pin_receipt_verification_token();

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
--
-- Every joined table is re-pinned to r.woreda_id explicitly (not just left to
-- follow the FK chain): nothing in payment_insert enforces that
-- payment.resident_id/household_id actually belong to the same woreda as
-- payment.woreda_id itself, so an id from a different tenant, however it got
-- there, must not be able to leak that tenant's resident/kebele name back
-- out through this anon-reachable RPC.
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
  JOIN public.payment p ON p.payment_id = r.payment_id AND p.woreda_id = r.woreda_id
  LEFT JOIN public.rental_occupancy_request ror
    ON ror.rental_request_id = p.rental_request_id AND ror.woreda_id = r.woreda_id
  LEFT JOIN public.kebele_rental_house krh
    ON krh.rental_house_id = ror.rental_house_id AND krh.woreda_id = r.woreda_id
  LEFT JOIN public.resident res
    ON res.resident_id = COALESCE(p.resident_id, ror.resident_id) AND res.woreda_id = r.woreda_id
  LEFT JOIN public.household h ON h.household_id = p.household_id AND h.woreda_id = r.woreda_id
  LEFT JOIN public.woreda w ON w.woreda_id = r.woreda_id
  LEFT JOIN public.kebele k
    ON k.kebele_id = COALESCE(h.kebele_id, krh.kebele_id) AND k.woreda_id = r.woreda_id
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
