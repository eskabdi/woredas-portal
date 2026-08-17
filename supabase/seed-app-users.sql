-- ============================================================================
-- app_user rows, exported from the previous project with
-- scripts/dump-app-users.sql.
--
-- Apply LAST: after 00000000000000_baseline.sql and after seed.sql, which
-- provides the woreda rows these reference.
--
-- Each user is looked up by email in this project's auth.users, so whatever
-- id exists here is the one inserted. Create the accounts in Supabase Auth
-- with these exact addresses first; any address missing at apply time
-- inserts nothing and is silently skipped, so check the row count after:
--   SELECT count(*) FROM public.app_user;   -- expected: 3
--
-- Note that saybermail is 'pending'. user_has_perm() requires status
-- 'active', so that account resolves no permissions until it is activated —
-- this mirrors its state in the source project and is not a migration
-- artifact.
-- ============================================================================

-- eskabdi (eskabdi4gpt@gmail.com)
INSERT INTO public.app_user
  (user_id, woreda_id, role, full_name, username, status,
   last_login_at, created_at, updated_at, invited_by_user_id, invited_at)
SELECT u.id, NULL, 'super_admin', 'Eskender Abdi', 'eskabdi', 'active', NULL, '2026-06-19 17:35:12.944427+00'::timestamptz, '2026-06-19 17:35:12.944427+00'::timestamptz, NULL, NULL
FROM auth.users u WHERE u.email = 'eskabdi4gpt@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- abokeradmin (aboker@woreda.gov.et)
INSERT INTO public.app_user
  (user_id, woreda_id, role, full_name, username, status,
   last_login_at, created_at, updated_at, invited_by_user_id, invited_at)
SELECT u.id, '81ac2ad6-a320-4069-b8dc-0c43e358371b'::uuid, 'tenant_admin', 'Aboker Admin', 'abokeradmin', 'active', NULL, '2026-06-19 17:40:41.064906+00'::timestamptz, '2026-06-19 17:40:41.064906+00'::timestamptz, NULL, NULL
FROM auth.users u WHERE u.email = 'aboker@woreda.gov.et'
ON CONFLICT (user_id) DO NOTHING;

-- saybermail (saybermail@gmail.com)
INSERT INTO public.app_user
  (user_id, woreda_id, role, full_name, username, status,
   last_login_at, created_at, updated_at, invited_by_user_id, invited_at)
SELECT u.id, '81ac2ad6-a320-4069-b8dc-0c43e358371b'::uuid, 'supervisor', 'Sultan', 'saybermail', 'pending', NULL, '2026-08-15 12:58:46.371824+00'::timestamptz, '2026-08-15 12:58:46.371824+00'::timestamptz, (SELECT id FROM auth.users WHERE email = 'aboker@woreda.gov.et'), '2026-08-15 12:58:46.074+00'::timestamptz
FROM auth.users u WHERE u.email = 'saybermail@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

