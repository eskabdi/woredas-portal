-- Task 11 follow-up: findings from /code-review and /security-review on
-- PR #58, run after 00000000000052.
--
-- 1. HIGH (both reviews independently found this): 052's own fix for the
--    household-transfer staleness bug doesn't work. mirror_household_gps_
--    to_location()'s ON CONFLICT DO UPDATE ... WHERE clause only checks
--    gps_lat/gps_lng, so a woreda-only transfer (UPDATE household SET
--    woreda_id = 'B' with no GPS change) fires the now-widened trigger but
--    the WHERE evaluates false, the UPDATE never runs, and household_
--    location.woreda_id keeps pointing at the OLD tenant -- exactly what
--    052 claimed to fix. Fixed by adding the woreda_id comparison to the
--    WHERE clause itself.
--
-- 2. LOW (security-review): entity_belongs_to_woreda() is EXECUTE-granted
--    to `authenticated` (required -- it's called from inside the approval/
--    attachment RLS policies, and Postgres checks EXECUTE for the
--    INVOKING role even on a SECURITY DEFINER function, so revoking it
--    from `authenticated` would break every insert into those two tables,
--    not just tighten security -- rejected that specific suggestion).
--    But that same grant makes it a directly PostgREST-callable RPC: any
--    authenticated user can pass an arbitrary _woreda_id and learn whether
--    a UUID exists in a tenant that isn't theirs. Every real call site
--    (both RLS policies) already passes the row's OWN woreda_id, which by
--    that point in the WITH CHECK is already constrained to equal
--    get_user_woreda_id() -- so an internal guard that only lets the
--    function answer for the caller's own woreda changes nothing for the
--    policies and closes the oracle for a direct call with someone else's.
--
-- 3. LOW (security-review): household_location_insert's WITH CHECK
--    accepted `household.create` OR `household.update`, but the AFTER
--    INSERT mirror into `household` is SECURITY DEFINER and bypasses
--    household's own RLS (which requires `household.update` to write to
--    an EXISTING household). A user granted `household.create` without
--    `household.update` (only reachable via a per-tenant/per-user
--    override -- no compiled default role is split this way) could use a
--    direct household_location insert to edit an existing household's GPS
--    without the update permission. Narrowed to `household.update` only,
--    matching what the write actually does.
--
-- 4. MEDIUM (code-review): approval_insert / attachment_insert /
--    attachment_select OR-list every module's read/write permission
--    together regardless of which `entity` the row is actually about, so
--    e.g. a user holding only `service.create` could attach a file to a
--    `resident` row, or a user holding only `service.approve` could write
--    a forged 'approved' decision against a `credential_request`.
--    entity_belongs_to_woreda() already proved the per-entity CASE
--    pattern works for tenancy; the same shape now gates the PERMISSION
--    check per entity, not just the tenancy check.

BEGIN;

-- --- 1. fix the ON CONFLICT guard to actually catch a woreda-only change

CREATE OR REPLACE FUNCTION public.mirror_household_gps_to_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.household_location (household_id, woreda_id, gps_lat, gps_lng, captured_at)
  VALUES (NEW.household_id, NEW.woreda_id, NEW.gps_lat, NEW.gps_lng, now())
  ON CONFLICT (household_id) DO UPDATE
    SET gps_lat = EXCLUDED.gps_lat, gps_lng = EXCLUDED.gps_lng,
        woreda_id = EXCLUDED.woreda_id, captured_at = now()
    WHERE household_location.gps_lat IS DISTINCT FROM EXCLUDED.gps_lat
       OR household_location.gps_lng IS DISTINCT FROM EXCLUDED.gps_lng
       OR household_location.woreda_id IS DISTINCT FROM EXCLUDED.woreda_id;
  RETURN NEW;
END;
$function$;

-- --- 2. close the existence-oracle without touching the EXECUTE grant

CREATE OR REPLACE FUNCTION public.entity_belongs_to_woreda(_entity text, _entity_id uuid, _woreda_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Every real caller (the approval/attachment RLS policies) already
  -- passes the row's own woreda_id, which their WITH CHECK has already
  -- pinned to get_user_woreda_id() by the time this runs -- so this guard
  -- is a no-op for them. It only changes the answer for a direct RPC call
  -- asking about a woreda that isn't the caller's own.
  IF NOT is_super_admin() AND _woreda_id IS DISTINCT FROM get_user_woreda_id() THEN
    RETURN false;
  END IF;

  RETURN CASE _entity
    WHEN 'resident' THEN EXISTS (SELECT 1 FROM public.resident WHERE resident_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'household' THEN EXISTS (SELECT 1 FROM public.household WHERE household_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'credential_request' THEN EXISTS (SELECT 1 FROM public.credential_request WHERE credential_request_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'residence_credential' THEN EXISTS (SELECT 1 FROM public.residence_credential WHERE credential_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'service_request' THEN EXISTS (SELECT 1 FROM public.service_request WHERE service_request_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'rental_occupancy_request' THEN EXISTS (SELECT 1 FROM public.rental_occupancy_request WHERE rental_request_id = _entity_id AND woreda_id = _woreda_id)
    ELSE false
  END;
END;
$function$;

-- --- 3. household_location writes need household.update, not just .create

DROP POLICY IF EXISTS household_location_insert ON public.household_location;
CREATE POLICY household_location_insert ON public.household_location AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[])));

-- --- 4. per-entity permission gating for approval/attachment

CREATE OR REPLACE FUNCTION public.entity_read_perm_ok(_entity text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE _entity
    WHEN 'resident' THEN user_has_any_perm('{resident.read}'::text[])
    WHEN 'household' THEN user_has_any_perm('{household.read}'::text[])
    WHEN 'credential_request' THEN user_has_any_perm('{credential.read}'::text[])
    WHEN 'residence_credential' THEN user_has_any_perm('{credential.read}'::text[])
    WHEN 'service_request' THEN user_has_any_perm('{service.read}'::text[])
    WHEN 'rental_occupancy_request' THEN user_has_any_perm('{rental.view}'::text[])
    ELSE false
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.entity_attach_perm_ok(_entity text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE _entity
    WHEN 'resident' THEN user_has_any_perm('{resident.update}'::text[])
    WHEN 'household' THEN user_has_any_perm('{household.update}'::text[])
    WHEN 'credential_request' THEN user_has_any_perm('{credential.issue,credential.submit}'::text[])
    WHEN 'residence_credential' THEN user_has_any_perm('{credential.issue}'::text[])
    WHEN 'service_request' THEN user_has_any_perm('{service.create,service.submit}'::text[])
    WHEN 'rental_occupancy_request' THEN user_has_any_perm('{rental.create}'::text[])
    ELSE false
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.entity_approve_perm_ok(_entity text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE _entity
    WHEN 'credential_request' THEN user_has_any_perm('{credential.approve}'::text[])
    WHEN 'service_request' THEN user_has_any_perm('{service.approve}'::text[])
    WHEN 'rental_occupancy_request' THEN user_has_any_perm('{rental.approve}'::text[])
    ELSE false
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.entity_read_perm_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_read_perm_ok(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.entity_attach_perm_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_attach_perm_ok(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.entity_approve_perm_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_approve_perm_ok(text) TO authenticated, service_role;

DROP POLICY IF EXISTS attachment_select ON public.attachment;
CREATE POLICY attachment_select ON public.attachment AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND entity_read_perm_ok(entity)));

DROP POLICY IF EXISTS attachment_insert ON public.attachment;
CREATE POLICY attachment_insert ON public.attachment AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND entity_attach_perm_ok(entity)))
    AND public.entity_belongs_to_woreda(entity, entity_id, woreda_id)
  );

DROP POLICY IF EXISTS approval_select ON public.approval;
CREATE POLICY approval_select ON public.approval AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND (user_has_any_perm('{approval.queue.view}'::text[]) OR entity_approve_perm_ok(entity))));

DROP POLICY IF EXISTS approval_insert ON public.approval;
CREATE POLICY approval_insert ON public.approval AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND entity_approve_perm_ok(entity)))
    AND public.entity_belongs_to_woreda(entity, entity_id, woreda_id)
  );

COMMIT;
