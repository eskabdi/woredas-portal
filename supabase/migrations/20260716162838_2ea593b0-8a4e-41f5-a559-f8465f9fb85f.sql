-- 1) Auto-number rental_occupancy_request
CREATE OR REPLACE FUNCTION public.assign_rental_request_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.request_type
    WHEN 'new_registration' THEN 'RNT'
    WHEN 'termination' THEN 'VAC'
    ELSE 'REQ'
  END;
  INSERT INTO public.rental_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = rental_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.request_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_rental_request_number ON public.rental_occupancy_request;
CREATE TRIGGER trg_assign_rental_request_number
BEFORE INSERT ON public.rental_occupancy_request
FOR EACH ROW EXECUTE FUNCTION public.assign_rental_request_number();

-- 2) On approval, open/close occupancy history and flip house status
CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_occupancy_id UUID;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.request_type = 'new_registration' THEN
      -- Close any existing active occupancy on this property
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(termination_date, CURRENT_DATE),
          termination_reason = COALESCE(termination_reason, 'Superseded by new occupancy ' || NEW.request_number)
      WHERE rental_house_id = NEW.rental_house_id AND status = 'active';

      INSERT INTO public.rental_occupancy (
        woreda_id, rental_house_id, resident_id, household_id,
        rent_start_date, rent_amount, status, originating_request_id
      ) VALUES (
        NEW.woreda_id, NEW.rental_house_id, NEW.resident_id, NEW.household_id,
        COALESCE(NEW.rent_start_date, CURRENT_DATE),
        COALESCE(NEW.rent_amount, 0),
        'active', NEW.rental_request_id
      )
      RETURNING occupancy_id INTO v_new_occupancy_id;

      NEW.resulting_occupancy_id := v_new_occupancy_id;

      UPDATE public.kebele_rental_house
      SET occupancy_status = 'occupied'
      WHERE rental_house_id = NEW.rental_house_id;

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active';

      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_rental_occupancy_on_approval ON public.rental_occupancy_request;
CREATE TRIGGER trg_apply_rental_occupancy_on_approval
BEFORE UPDATE ON public.rental_occupancy_request
FOR EACH ROW EXECUTE FUNCTION public.apply_rental_occupancy_on_approval();