-- ============================================================================
-- Storage dump: bucket definitions and storage.objects policies.
--
-- Run in the Supabase SQL Editor against the OLD project. Copy the `ddl`
-- column into a migration and apply it to the new project.
--
-- Buckets are created through the dashboard or the storage API rather than in
-- SQL, so they are absent from the repository's migrations. The RLS policies
-- on storage.objects live in the storage schema, which the public-schema dump
-- in scripts/dump-schema.sql does not cover. This script captures both.
--
-- It does NOT copy the stored files themselves. Objects already uploaded --
-- resident photos, credential templates, woreda logos -- have to be moved
-- separately, for example with the Supabase CLI or the storage API.
-- ============================================================================

WITH

-- Bucket definitions, with their visibility and upload limits.
buckets AS (
  SELECT 100 AS ord, b.id AS sort_key,
         format(
           'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)'
           || E'\nVALUES (%L, %L, %L, %s, %s)\nON CONFLICT (id) DO NOTHING;',
           b.id, b.name, b.public,
           COALESCE(b.file_size_limit::text, 'NULL'),
           CASE WHEN b.allowed_mime_types IS NULL THEN 'NULL'
                ELSE quote_literal(b.allowed_mime_types::text) || '::text[]' END
         ) AS ddl
  FROM storage.buckets b
),

-- RLS policies on storage.objects, dropped first so the script is re-runnable.
policies AS (
  SELECT 200 AS ord, p.policyname AS sort_key,
         format('DROP POLICY IF EXISTS %I ON storage.objects;', p.policyname)
         || format(
              E'\nCREATE POLICY %I ON storage.objects AS %s FOR %s TO %s%s%s;',
              p.policyname,
              CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
              p.cmd,
              array_to_string(p.roles, ', '),
              COALESCE(' USING (' || p.qual || ')', ''),
              COALESCE(' WITH CHECK (' || p.with_check || ')', '')
            ) AS ddl
  FROM pg_policies p
  WHERE p.schemaname = 'storage'
    AND p.tablename = 'objects'
),

combined AS (
  SELECT * FROM buckets
  UNION ALL SELECT * FROM policies
),

sections AS (
  SELECT ord, sort_key, ddl FROM combined
  UNION ALL
  SELECT DISTINCT ord - 1, '', format(E'\n-- ===== %s =====',
    CASE ord WHEN 100 THEN 'BUCKETS' WHEN 200 THEN 'STORAGE POLICIES' END)
  FROM combined
)

SELECT ddl FROM sections ORDER BY ord, sort_key;
