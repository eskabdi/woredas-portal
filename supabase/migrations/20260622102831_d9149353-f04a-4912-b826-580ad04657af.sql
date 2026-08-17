
CREATE OR REPLACE FUNCTION public.storage_path_woreda_id(object_name TEXT)
RETURNS UUID
LANGUAGE SQL IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(split_part(object_name, '/', 1), '')::UUID;
$$;

DROP POLICY IF EXISTS "resident_photos_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "resident_photos_auth_select" ON storage.objects;
DROP POLICY IF EXISTS "resident_photos_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "resident_photos_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "resident_photos_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "resident_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "resident_photos_public_read" ON storage.objects;

CREATE POLICY "resident_photos_insert_scoped" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resident-photos' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

CREATE POLICY "resident_photos_select_scoped" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'resident-photos' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

CREATE POLICY "resident_photos_update_scoped" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'resident-photos' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

CREATE POLICY "resident_photos_delete_scoped" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'resident-photos' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

DROP POLICY IF EXISTS "resident_clearance_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "resident_clearance_auth_select" ON storage.objects;
DROP POLICY IF EXISTS "resident_clearance_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "resident_clearance_auth_delete" ON storage.objects;

CREATE POLICY "clearance_insert_scoped" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resident-clearance-letters' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

CREATE POLICY "clearance_select_scoped" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'resident-clearance-letters' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

CREATE POLICY "clearance_update_scoped" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'resident-clearance-letters' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );

CREATE POLICY "clearance_delete_scoped" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'resident-clearance-letters' AND (
      public.is_super_admin() OR
      public.storage_path_woreda_id(name) = public.get_user_woreda_id()
    )
  );
