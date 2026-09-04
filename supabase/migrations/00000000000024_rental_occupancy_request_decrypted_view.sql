-- ============================================================================
-- Fill a gap in 00000000000023_pii_encryption.sql: stage 1 added
-- rental_occupancy_request.rent_amount_enc and its sync trigger
-- (rental_occupancy_request_amount_sync_trg) alongside the other five encrypted
-- columns, but never created the matching decrypting view -- the five
-- `DROP VIEW IF EXISTS ...; CREATE VIEW ...` statements cover resident,
-- household, service_request, payment and rental_occupancy only.
--
-- This was found while doing the stage-3 read cutover: two real call sites
-- (src/routes/woreda.rental-houses.requests.index.tsx and
-- .../requests.$requestId.index.tsx) read rental_occupancy_request.rent_amount
-- and have nowhere to cut over to without this. Same pattern as
-- 00000000000023's other five views -- security_invoker = on per
-- 00000000000006_view_security_invoker.sql's precedent, DROP + CREATE (not
-- CREATE OR REPLACE) for the same "SELECT t.*, computed" column-order reason
-- documented there, grants re-issued immediately after since DROP VIEW clears
-- them.
-- ============================================================================

DROP VIEW IF EXISTS public.rental_occupancy_request_decrypted;
CREATE VIEW public.rental_occupancy_request_decrypted
  WITH (security_invoker = on) AS
  SELECT rr.*,
         public.decrypt_pii_numeric(rr.rent_amount_enc, rr.woreda_id) AS rent_amount_decrypted
  FROM public.rental_occupancy_request rr;

REVOKE ALL ON public.rental_occupancy_request_decrypted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rental_occupancy_request_decrypted TO authenticated, service_role;
