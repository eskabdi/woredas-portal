-- Exact row count for every table in the schemas a restore has to bring back
-- (public, auth, storage). Used by backup.sh on the source and by
-- restore-verify.sh on the restored copy; the two outputs are compared.
-- Read-only. query_to_xml runs one count(*) per table without needing a
-- function to be created on the server.
--
-- The `~`-prefixed rows count the security-relevant schema objects in
-- public (RLS policies, triggers, functions, views, tables with RLS on), so
-- a restore that lost a policy or a trigger fails even when every row is
-- back.
SELECT n.nspname || '.' || c.relname AS table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname IN ('public', 'auth', 'storage')
UNION ALL
SELECT '~policies.public', count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL
SELECT '~policies.storage', count(*) FROM pg_policies WHERE schemaname = 'storage'
UNION ALL
SELECT '~triggers.public', count(*)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL
SELECT '~functions.public', count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
UNION ALL
SELECT '~views.public', count(*) FROM pg_views WHERE schemaname = 'public'
UNION ALL
SELECT '~rls_enabled_tables.public', count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
ORDER BY 1;
