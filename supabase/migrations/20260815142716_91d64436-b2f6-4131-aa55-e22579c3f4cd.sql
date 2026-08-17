ALTER TABLE public.service_type ADD COLUMN IF NOT EXISTS letter_body_html TEXT;

ALTER TABLE public.service_request
  ADD COLUMN IF NOT EXISTS verification_token TEXT,
  ADD COLUMN IF NOT EXISTS issued_letter_html TEXT,
  ADD COLUMN IF NOT EXISTS letter_summary TEXT;

CREATE OR REPLACE FUNCTION public.gen_letter_verification_token()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_token TEXT;
  i INT;
BEGIN
  LOOP
    v_token := '';
    FOR i IN 1..12 LOOP
      v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.service_request WHERE verification_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$$;

UPDATE public.service_request
SET verification_token = public.gen_letter_verification_token()
WHERE verification_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_request_verification_token_key
  ON public.service_request (verification_token);

CREATE OR REPLACE FUNCTION public.assign_letter_verification_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_token IS NULL OR NEW.verification_token = '' THEN
    NEW.verification_token := public.gen_letter_verification_token();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_letter_verification_token ON public.service_request;
CREATE TRIGGER trg_assign_letter_verification_token
  BEFORE INSERT ON public.service_request
  FOR EACH ROW EXECUTE FUNCTION public.assign_letter_verification_token();

CREATE OR REPLACE FUNCTION public.verify_service_letter(_token TEXT)
RETURNS TABLE (
  request_number TEXT,
  issued_at TIMESTAMPTZ,
  subject TEXT,
  resident_full_name TEXT,
  letter_summary TEXT,
  service_type_am TEXT,
  service_type_en TEXT,
  woreda_name_am TEXT,
  woreda_name_en TEXT,
  kebele_name_am TEXT,
  kebele_name_en TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.request_number,
    sr.issued_at,
    sr.subject,
    COALESCE(r.full_name_am, r.full_name, sr.applicant_name),
    COALESCE(sr.letter_summary, sr.purpose),
    st.name_am,
    st.name_en,
    w.woreda_name_am,
    w.woreda_name_en,
    k.kebele_name_am,
    k.kebele_name_en
  FROM public.service_request sr
  LEFT JOIN public.resident r ON r.resident_id = sr.resident_id
  LEFT JOIN public.service_type st ON st.service_type_id = sr.service_type_id
  LEFT JOIN public.woreda w ON w.woreda_id = sr.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = sr.kebele_id
  WHERE sr.verification_token = _token
    AND sr.issued_at IS NOT NULL
    AND sr.status IN ('issued', 'resolved', 'closed')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_service_letter(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_service_letter(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.gen_letter_verification_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_letter_verification_token() FROM PUBLIC;