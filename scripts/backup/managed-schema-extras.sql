-- Generates the app-owned objects that live INSIDE the platform-managed
-- `auth` and `storage` schemas, which `supabase db dump` leaves out along
-- with the rest of those schemas. Without this, a restore brings back every
-- file row but none of the 38 storage.objects RLS policies that enforce the
-- woreda path-prefix isolation (see CLAUDE.md, "Storage") -- and nothing
-- errors. Output is executable SQL, one statement per row, run by
-- restore-verify.sh after schema.sql.
--
-- 1. Every RLS policy on an auth/storage table.
-- 2. Every trigger on an auth/storage table whose function is outside
--    auth/storage (i.e. defined by this app, not by the platform).
-- Read-only. search_path is emptied first so the policy/trigger expressions
-- deparse fully schema-qualified (public.is_super_admin(), not
-- is_super_admin()) and replay in a restore session with any search_path.
-- Run with psql -q so the SET's command tag is not written into the output.
SET search_path = '';
SELECT format(
         'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
         p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
         (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
            FROM unnest(p.roles) AS r),
         CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END,
         CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END)
FROM pg_policies p
WHERE p.schemaname IN ('auth', 'storage')
UNION ALL
SELECT pg_get_triggerdef(t.oid) || ';'
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc f ON f.oid = t.tgfoid
JOIN pg_namespace fn ON fn.oid = f.pronamespace
WHERE n.nspname IN ('auth', 'storage')
  AND fn.nspname NOT IN ('auth', 'storage')
  AND NOT t.tgisinternal;
