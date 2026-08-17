
ALTER TABLE public.household
  ADD COLUMN IF NOT EXISTS sub_woreda TEXT,
  ADD COLUMN IF NOT EXISTS po_box TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS house_type TEXT,
  ADD COLUMN IF NOT EXISTS house_type_other TEXT,
  ADD COLUMN IF NOT EXISTS rent_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS occupancy_status TEXT NOT NULL DEFAULT 'occupied',
  ADD COLUMN IF NOT EXISTS spouse_resident_id UUID REFERENCES public.resident(resident_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alternate_head_resident_id UUID REFERENCES public.resident(resident_id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'household_house_type_check') THEN
    ALTER TABLE public.household ADD CONSTRAINT household_house_type_check
      CHECK (house_type IS NULL OR house_type IN ('private','kebele','rental','government','rented_by_private','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'household_occupancy_status_check') THEN
    ALTER TABLE public.household ADD CONSTRAINT household_occupancy_status_check
      CHECK (occupancy_status IN ('occupied','vacant','demolished','transferred'));
  END IF;
END $$;

CREATE OR REPLACE VIEW public.household_member_roster AS
SELECT
  r.resident_id,
  r.current_household_id AS household_id,
  r.full_name_am,
  r.full_name,
  r.date_of_birth,
  r.sex,
  r.relation_to_head,
  r.residency_status,
  r.active_flag,
  DATE_PART('year', AGE(r.date_of_birth::DATE)) AS age
FROM public.resident r
WHERE r.current_household_id IS NOT NULL
  AND r.active_flag = TRUE;

GRANT SELECT ON public.household_member_roster TO authenticated;
GRANT ALL ON public.household_member_roster TO service_role;

ALTER TABLE public.household_change_log
  ADD COLUMN IF NOT EXISTS woreda_id UUID REFERENCES public.woreda(woreda_id),
  ADD COLUMN IF NOT EXISTS old_value_json JSONB,
  ADD COLUMN IF NOT EXISTS new_value_json JSONB;

UPDATE public.household_change_log hcl
SET woreda_id = h.woreda_id
FROM public.household h
WHERE hcl.household_id = h.household_id AND hcl.woreda_id IS NULL;

ALTER TABLE public.household_change_log ALTER COLUMN woreda_id SET NOT NULL;
ALTER TABLE public.household_change_log ALTER COLUMN change_date SET DEFAULT CURRENT_DATE;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_change_log TO authenticated;
GRANT ALL ON public.household_change_log TO service_role;

DROP POLICY IF EXISTS "household_change_log_tenant_isolation" ON public.household_change_log;
DROP POLICY IF EXISTS "household_change_log_tenant" ON public.household_change_log;

CREATE POLICY "household_change_log_tenant" ON public.household_change_log
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())
  WITH CHECK (public.is_super_admin() OR woreda_id = public.get_user_woreda_id());
