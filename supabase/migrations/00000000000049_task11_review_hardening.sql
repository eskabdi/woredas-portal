-- Task 11 follow-up: fixes from tenant-isolation-review on 00000000000048.
--
-- 1. HIGH: household_location's INSERT/UPDATE policies only checked
--    `woreda_id = get_user_woreda_id()` -- the client-supplied `household_id`
--    was never validated against that woreda, so a household.create/update
--    holder in woreda A could attach a household_location row to a
--    household UUID belonging to woreda B (an existence oracle for foreign
--    household ids), and the SECURITY DEFINER mirror trigger into
--    `household` had no woreda_id predicate either, making the write land
--    cross-tenant with RLS fully bypassed. Fixed at the root instead of
--    only in RLS: a BEFORE INSERT/UPDATE trigger now derives
--    household_location.woreda_id FROM household itself, ignoring whatever
--    the client sent -- the same "assert_*_woreda_consistency" pattern used
--    for vital_event.household_id in 00000000000032, except here the value
--    is corrected rather than merely checked, since forcing the correct
--    value makes the existing WITH CHECK (woreda_id = get_user_woreda_id())
--    reject the cross-tenant attempt on its own once the row's real woreda
--    doesn't match the caller's. The two mirror triggers additionally gain
--    an explicit woreda_id guard as defense in depth.
--
-- 2. MEDIUM: entity_belongs_to_woreda() is SECURITY DEFINER and was left
--    executable by anon -- a cross-tenant existence oracle reachable as a
--    bare PostgREST RPC with no session. Locked down the same way every
--    other directly-callable definer helper is (00000000000008).
--
-- 3. MEDIUM: the "attachments" bucket had no UPDATE policy (breaks an
--    upsert:true re-upload, the pattern used elsewhere in this repo) and
--    DELETE was super-admin-only, unlike every other bucket's same-woreda
--    delete -- orphaning a failed/replaced upload with no tenant-level way
--    to clean it up. The attachment ROW stays insert-only (that part of the
--    design was about the row being immutable evidence, not about
--    orphaning the underlying object); the storage object itself now
--    follows the same same-woreda update/delete pattern as every other
--    bucket.
--
-- 4. LOW: residence_credential.issuing_office_id / credential_request.
--    office_id had no check that the referenced office belongs to the
--    row's own woreda. Added the same validation-trigger pattern.

BEGIN;

-- --- 1. household_location: derive woreda_id, don't trust it -------------

CREATE OR REPLACE FUNCTION public.force_household_location_woreda_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid;
BEGIN
  SELECT woreda_id INTO v_woreda_id FROM public.household WHERE household_id = NEW.household_id;
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'household_location: household_id % does not exist', NEW.household_id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.woreda_id := v_woreda_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS force_household_location_woreda_id ON public.household_location;
CREATE TRIGGER force_household_location_woreda_id
  BEFORE INSERT OR UPDATE ON public.household_location
  FOR EACH ROW EXECUTE FUNCTION public.force_household_location_woreda_id();

-- Defense in depth: even though woreda_id is now always correct by
-- construction, both mirror directions carry an explicit guard too.
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
       OR household_location.gps_lng IS DISTINCT FROM EXCLUDED.gps_lng;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mirror_location_gps_to_household()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.household
     SET gps_lat = NEW.gps_lat, gps_lng = NEW.gps_lng
   WHERE household_id = NEW.household_id
     AND woreda_id = NEW.woreda_id
     AND (gps_lat IS DISTINCT FROM NEW.gps_lat OR gps_lng IS DISTINCT FROM NEW.gps_lng);
  RETURN NEW;
END;
$function$;

-- --- 2. lock down entity_belongs_to_woreda() like every other definer helper

REVOKE EXECUTE ON FUNCTION public.entity_belongs_to_woreda(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_belongs_to_woreda(text, uuid, uuid) TO authenticated, service_role;

-- --- 3. attachments bucket: same-woreda update + delete, like every other bucket

DROP POLICY IF EXISTS attachments_delete_scoped ON storage.objects;
CREATE POLICY attachments_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'attachments') AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id())));

DROP POLICY IF EXISTS attachments_update_scoped ON storage.objects;
CREATE POLICY attachments_update_scoped ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'attachments') AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id())));

-- --- 4. office FK consistency for residence_credential / credential_request

CREATE OR REPLACE FUNCTION public.assert_office_woreda_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'residence_credential' AND NEW.issuing_office_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.office WHERE office_id = NEW.issuing_office_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION 'residence_credential: issuing_office_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'credential_request' AND NEW.office_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.office WHERE office_id = NEW.office_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION 'credential_request: office_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS assert_residence_credential_office_woreda ON public.residence_credential;
CREATE TRIGGER assert_residence_credential_office_woreda
  BEFORE INSERT OR UPDATE OF issuing_office_id ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.assert_office_woreda_consistency();

DROP TRIGGER IF EXISTS assert_credential_request_office_woreda ON public.credential_request;
CREATE TRIGGER assert_credential_request_office_woreda
  BEFORE INSERT OR UPDATE OF office_id ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.assert_office_woreda_consistency();

COMMIT;
