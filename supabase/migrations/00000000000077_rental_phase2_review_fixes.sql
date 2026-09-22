-- Kebele Rental Houses Management -- Phase 2 follow-up: rental.billing
-- reachability + audit completeness fixes from the tenant-isolation-review
-- and rbac-escalation-review dispatched on 00000000000076.
--
-- 1. rental.billing role_permission backfill (both reviewers flagged this
--    independently as the same gap). 00000000000076's own comment argued
--    "no role_permission backfill needed" because tenant_admin has no
--    per-tenant override row -- true, but irrelevant to the actual grant
--    surfaces: RolesPermissionsTab.tsx / CustomRolesTab.tsx /
--    UsersRolesTab.tsx all build their permission-key catalogue from
--    EXISTING role_permission rows, not from P or default_role_perms().
--    Every prior new permission key got exactly this backfill
--    (00000000000015, 00000000000035, 00000000000063) specifically so it
--    becomes visible/grantable in the Settings matrix for tenants
--    provisioned before the migration that introduced it --
--    00000000000035's own comment says so directly. Without this, the six
--    woredas that existed before 00000000000076 can never see or grant
--    rental.billing to anything but its compiled tenant_admin default,
--    while any woreda created AFTER 00000000000076 gets it automatically
--    via seed_role_permission_for_new_woreda()'s dynamic default_role_perms()
--    cross-join -- the same tenant-shaped permission reachable on a
--    provisioning-date-dependent basis, which is the real defect.
--
--    Seeded as is_granted = false for all six editable roles (registry_clerk,
--    civil_registrar, finance_clerk, supervisor, auditor, viewer) -- nothing
--    in default_role_perms() grants any of them rental.billing by default,
--    this only makes the toggle exist and default OFF, matching what
--    seed_role_permission_for_new_woreda() would produce for a new woreda
--    today.
--
-- 2. provision_rent_account()'s audit row previously omitted the rate it
--    copied into the initial rent_rate_history row (only occupancy_id and
--    billing_start_period_key were recorded). Since that copied
--    rental_occupancy.rent_amount becomes every future charge's snapshot
--    rate, an audit trail that can't show what rate was provisioned undercuts
--    T-3's own "old/new JSON" guarantee for the one write in this function
--    that a reviewer would actually want to inspect. Restated in full
--    (CREATE OR REPLACE) with monthly_amount added to new_value_json --
--    no behavioural change otherwise.
--
-- ADDITIVE. No DROP of any table, column, or constraint.

BEGIN;

INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, 'rental.billing', false
  FROM public.woreda w
 CROSS JOIN (VALUES
    ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
    ('supervisor'), ('auditor'), ('viewer')
  ) AS r(role_name)
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.provision_rent_account(
  _occupancy_id uuid,
  _billing_start_period_key text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_occ RECORD;
  v_kebele_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.approve', 'rental.billing'])) THEN
    RAISE EXCEPTION 'provision_rent_account: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _billing_start_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION
      'ልክ ያልሆነ የክፍያ ወቅት / Invalid billing period'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_occ FROM public.rental_occupancy WHERE occupancy_id = _occupancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provision_rent_account: occupancy not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_super_admin() AND v_occ.woreda_id <> get_user_woreda_id() THEN
    RAISE EXCEPTION 'provision_rent_account: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_occ.status <> 'active' THEN
    RAISE EXCEPTION 'provision_rent_account: occupancy is not active' USING ERRCODE = 'check_violation';
  END IF;

  SELECT rent_account_id INTO v_existing_id
    FROM public.rent_account
   WHERE occupancy_id = _occupancy_id AND status = 'active';
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  SELECT kebele_id INTO v_kebele_id
    FROM public.kebele_rental_house WHERE rental_house_id = v_occ.rental_house_id;

  INSERT INTO public.rent_account (
    woreda_id, occupancy_id, rental_house_id, kebele_id, resident_id, household_id,
    status, billing_start_period_key, created_by
  ) VALUES (
    v_occ.woreda_id, v_occ.occupancy_id, v_occ.rental_house_id, v_kebele_id,
    v_occ.resident_id, v_occ.household_id,
    'active', _billing_start_period_key, v_actor
  )
  RETURNING rent_account_id INTO v_new_id;

  INSERT INTO public.rent_rate_history (
    woreda_id, rent_account_id, effective_period_key, monthly_amount,
    change_reason, status, approved_by, approved_at
  ) VALUES (
    v_occ.woreda_id, v_new_id, _billing_start_period_key, v_occ.rent_amount,
    'initial_rate', 'active', v_actor, now()
  );

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_occ.woreda_id, v_actor, 'rent_account', v_new_id::text, 'RENT_ACCOUNT_PROVISIONED',
    jsonb_build_object(
      'occupancy_id', _occupancy_id,
      'billing_start_period_key', _billing_start_period_key,
      'monthly_amount', v_occ.rent_amount
    ));

  RETURN v_new_id;
END;
$function$;

COMMIT;
