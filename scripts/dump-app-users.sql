-- ============================================================================
-- app_user export, keyed by email rather than by user id.
--
-- Run in the Supabase SQL Editor against the OLD project. Copy the `dml`
-- column and run it against the NEW project, after the baseline schema and
-- supabase/seed.sql (woreda rows must exist first).
--
-- app_user.user_id is a foreign key onto auth.users(id). Users recreated in a
-- new project get new ids, so exporting the old ids verbatim would fail that
-- constraint. Each statement therefore looks the user up by email in the
-- target project's auth.users and inserts whatever id it finds there.
--
-- A user whose email is absent from the new project inserts zero rows rather
-- than failing: the INSERT ... SELECT simply matches nothing. Compare the
-- reported row count afterwards to catch anyone missed --
--   SELECT count(*) FROM public.app_user;
--
-- invited_by_user_id is resolved the same way, through the inviter's email,
-- so it does not depend on insert order.
-- ============================================================================

SELECT format(
  E'-- %s (%s)\n'
  || E'INSERT INTO public.app_user\n'
  || E'  (user_id, woreda_id, role, full_name, username, status,\n'
  || E'   last_login_at, created_at, updated_at, invited_by_user_id, invited_at)\n'
  || E'SELECT u.id, %s, %L, %L, %L, %L, %s, %s, %s, %s, %s\n'
  || E'FROM auth.users u WHERE u.email = %L\n'
  || E'ON CONFLICT (user_id) DO NOTHING;',
  a.username,
  au.email,
  -- woreda_id: seeded from the same source, so the literal id is stable.
  CASE WHEN a.woreda_id IS NULL THEN 'NULL'
       ELSE quote_literal(a.woreda_id::text) || '::uuid' END,
  a.role,
  a.full_name,
  a.username,
  a.status,
  CASE WHEN a.last_login_at IS NULL THEN 'NULL'
       ELSE quote_literal(a.last_login_at::text) || '::timestamptz' END,
  CASE WHEN a.created_at IS NULL THEN 'now()'
       ELSE quote_literal(a.created_at::text) || '::timestamptz' END,
  CASE WHEN a.updated_at IS NULL THEN 'now()'
       ELSE quote_literal(a.updated_at::text) || '::timestamptz' END,
  -- Resolve the inviter through their email in the target project too.
  CASE WHEN inviter.email IS NULL THEN 'NULL'
       ELSE '(SELECT id FROM auth.users WHERE email = '
            || quote_literal(inviter.email) || ')' END,
  CASE WHEN a.invited_at IS NULL THEN 'NULL'
       ELSE quote_literal(a.invited_at::text) || '::timestamptz' END,
  au.email
) AS dml
FROM public.app_user a
JOIN auth.users au ON au.id = a.user_id
LEFT JOIN public.app_user inv ON inv.user_id = a.invited_by_user_id
LEFT JOIN auth.users inviter ON inviter.id = inv.user_id
ORDER BY a.created_at, a.username;
