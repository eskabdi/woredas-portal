CREATE OR REPLACE FUNCTION public.get_credential_live_status(_credential_number text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status::text
  FROM public.residence_credential
  WHERE credential_number = _credential_number
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_credential_live_status(text) TO authenticated;