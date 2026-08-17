ALTER TABLE public.resident
  ADD COLUMN father_name TEXT,
  ADD COLUMN grandfather_name TEXT,
  ADD COLUMN mother_full_name TEXT,
  ADD COLUMN ethnicity TEXT,
  ADD COLUMN religion TEXT,
  ADD COLUMN residency_start_date DATE,
  ADD COLUMN current_residence_extra JSONB,
  ADD COLUMN birth_place JSONB,
  ADD COLUMN work_info JSONB,
  ADD COLUMN former_residence JSONB;

COMMENT ON COLUMN public.resident.current_residence_extra IS 'sub_woreda, longitude, latitude, other_address_text — supplementary to household address';
COMMENT ON COLUMN public.resident.birth_place IS '{region, zone, woreda, kebele, house_number, area_name, place_name}';
COMMENT ON COLUMN public.resident.work_info IS '{education_level, occupation_status, occupation_post, work_address, region, zone, woreda, kebele, house_number, area_name, other_address}';
COMMENT ON COLUMN public.resident.former_residence IS '{address, region, zone, woreda, kebele, house_number, area_name}';

ALTER TABLE public.household
  ADD COLUMN household_head_resident_id UUID REFERENCES public.resident(resident_id),
  ADD COLUMN spouse_name TEXT,
  ADD COLUMN spouse_father_name TEXT,
  ADD COLUMN spouse_grandfather_name TEXT,
  ADD COLUMN alternate_head_name TEXT,
  ADD COLUMN alternate_head_father_name TEXT,
  ADD COLUMN alternate_head_grandfather_name TEXT,
  ADD COLUMN phone_number TEXT,
  ADD COLUMN po_box TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN house_type TEXT CHECK (house_type IN ('private','kebele','rental','government','rented_by_private','other')),
  ADD COLUMN house_type_other TEXT,
  ADD COLUMN rent_amount DECIMAL(12,2);

CREATE TABLE public.household_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.household(household_id),
  change_type TEXT NOT NULL,
  change_date DATE NOT NULL,
  registered_by_user_id UUID REFERENCES public.app_user(user_id),
  clerk_comment TEXT,
  household_head_signed BOOLEAN NOT NULL DEFAULT FALSE,
  clerk_signed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_change_log TO authenticated;
GRANT ALL ON public.household_change_log TO service_role;

ALTER TABLE public.household_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household_change_log_tenant_isolation" ON public.household_change_log
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.household h WHERE h.household_id = household_change_log.household_id AND h.woreda_id = public.get_user_woreda_id()
  ))
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.household h WHERE h.household_id = household_change_log.household_id AND h.woreda_id = public.get_user_woreda_id()
  ));