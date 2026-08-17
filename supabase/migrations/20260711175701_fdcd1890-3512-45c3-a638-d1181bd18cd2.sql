
CREATE OR REPLACE FUNCTION public.assign_resident_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT;
  v_next INTEGER;
  v_format TEXT;
  v_result TEXT;
  v_seq_match TEXT;
  v_seq_width INT;
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

  SELECT resident_number_format INTO v_format
    FROM public.woreda_settings WHERE woreda_id = NEW.woreda_id;

  IF v_format IS NULL OR v_format = '' THEN
    NEW.resident_number := v_code || '-' || LPAD(v_next::TEXT, 6, '0');
    RETURN NEW;
  END IF;

  v_result := v_format;
  v_result := REPLACE(v_result, '{WOREDA_CODE}', v_code);

  v_seq_match := (regexp_match(v_result, '\{SEQ:(\d+)\}'))[1];
  IF v_seq_match IS NOT NULL THEN
    v_seq_width := v_seq_match::INT;
    v_result := regexp_replace(v_result, '\{SEQ:\d+\}', LPAD(v_next::TEXT, v_seq_width, '0'), 'g');
  ELSE
    v_result := REPLACE(v_result, '{SEQ}', v_next::TEXT);
  END IF;

  NEW.resident_number := v_result;
  RETURN NEW;
END;
$function$;
