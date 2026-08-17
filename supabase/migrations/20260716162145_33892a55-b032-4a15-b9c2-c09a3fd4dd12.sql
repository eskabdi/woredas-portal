-- Add rental_request_id linking payments to rental occupancy requests
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS rental_request_id UUID NULL
  REFERENCES public.rental_occupancy_request(rental_request_id);

CREATE INDEX IF NOT EXISTS idx_payment_rental_request_id
  ON public.payment(rental_request_id)
  WHERE rental_request_id IS NOT NULL;

-- Extend payment_type CHECK to allow 'rental_rent'
ALTER TABLE public.payment DROP CONSTRAINT IF EXISTS payment_payment_type_check;
ALTER TABLE public.payment ADD CONSTRAINT payment_payment_type_check
  CHECK (payment_type = ANY (ARRAY[
    'service_fee'::text,
    'house_rent'::text,
    'penalty'::text,
    'credential_fee'::text,
    'rental_rent'::text
  ]));

-- Ensure a payment isn't linked to both a credential and a rental request at once
ALTER TABLE public.payment DROP CONSTRAINT IF EXISTS payment_source_exclusive_check;
ALTER TABLE public.payment ADD CONSTRAINT payment_source_exclusive_check
  CHECK (NOT (credential_request_id IS NOT NULL AND rental_request_id IS NOT NULL));