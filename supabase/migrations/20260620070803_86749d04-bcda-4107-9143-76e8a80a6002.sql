
-- Storage policies for resident-photos (private bucket; signed URLs for read)
CREATE POLICY "resident_photos_auth_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'resident-photos');

CREATE POLICY "resident_photos_auth_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'resident-photos');

CREATE POLICY "resident_photos_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'resident-photos');

CREATE POLICY "resident_photos_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'resident-photos');

-- Per-woreda resident-number sequence
CREATE TABLE IF NOT EXISTS public.resident_number_sequence (
  woreda_id UUID PRIMARY KEY REFERENCES public.woreda(woreda_id) ON DELETE CASCADE,
  last_value INTEGER NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE ON public.resident_number_sequence TO authenticated;
GRANT ALL ON public.resident_number_sequence TO service_role;
ALTER TABLE public.resident_number_sequence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resident_number_sequence_tenant"
ON public.resident_number_sequence FOR ALL
TO authenticated
USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());

-- Auto-assign resident_number on insert
CREATE OR REPLACE FUNCTION public.assign_resident_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_next INTEGER;
BEGIN
  IF NEW.resident_number IS NOT NULL AND NEW.resident_number <> '' AND NEW.resident_number <> 'AUTO' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown woreda %', NEW.woreda_id;
  END IF;

  INSERT INTO public.resident_number_sequence(woreda_id, last_value)
  VALUES (NEW.woreda_id, 1)
  ON CONFLICT (woreda_id)
  DO UPDATE SET last_value = public.resident_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.resident_number := v_code || '-' || LPAD(v_next::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_resident_number ON public.resident;
CREATE TRIGGER trg_assign_resident_number
BEFORE INSERT ON public.resident
FOR EACH ROW EXECUTE FUNCTION public.assign_resident_number();
