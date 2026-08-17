
REVOKE EXECUTE ON FUNCTION public.get_user_woreda_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_woreda_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
