-- ============================================================================
-- Schema dump: emits runnable DDL for the `public` schema.
--
-- Run this in the Supabase SQL Editor against the EXISTING project, then copy
-- the `ddl` column top to bottom into a new migration file. Statements are
-- emitted in dependency order: types -> tables -> constraints -> foreign keys
-- -> indexes -> views -> functions -> triggers -> RLS -> policies -> grants.
--
-- Objects owned by extensions (pgcrypto, postgis, ...) are excluded, since
-- `CREATE EXTENSION` recreates them.
-- ============================================================================

WITH cfg AS (SELECT 'public'::text AS schema_name),

-- 0. Preamble ---------------------------------------------------------------
-- Functions are emitted alphabetically rather than in dependency order, and
-- PostgreSQL validates SQL-language function bodies at creation time. Turning
-- that check off lets them be created in any order, exactly as pg_dump does.
preamble AS (
  SELECT 0 AS ord, '' AS sort_key,
         E'SET check_function_bodies = false;' AS ddl
),

-- 1. Extensions -------------------------------------------------------------
extensions AS (
  SELECT 100 AS ord, e.extname AS sort_key,
         format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;',
                e.extname, n.nspname) AS ddl
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname NOT IN ('plpgsql')
),

-- 2. Enum types -------------------------------------------------------------
enums AS (
  SELECT 200 AS ord, t.typname AS sort_key,
         format('CREATE TYPE %I.%I AS ENUM (%s);',
                n.nspname, t.typname,
                string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)) AS ddl
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = (SELECT schema_name FROM cfg)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.objid = t.oid AND d.deptype = 'e')
  GROUP BY n.nspname, t.typname
),

-- 3. Domains ----------------------------------------------------------------
domains AS (
  SELECT 250 AS ord, t.typname AS sort_key,
         format('CREATE DOMAIN %I.%I AS %s%s%s;',
                n.nspname, t.typname,
                format_type(t.typbasetype, t.typtypmod),
                CASE WHEN t.typnotnull THEN ' NOT NULL' ELSE '' END,
                COALESCE((SELECT ' ' || string_agg(pg_get_constraintdef(c.oid), ' ')
                          FROM pg_constraint c WHERE c.contypid = t.oid), '')) AS ddl
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = (SELECT schema_name FROM cfg)
    AND t.typtype = 'd'
),

-- 4. Standalone sequences (not owned by a serial/identity column) ------------
sequences AS (
  SELECT 300 AS ord, c.relname AS sort_key,
         format('CREATE SEQUENCE IF NOT EXISTS %I.%I;', n.nspname, c.relname) AS ddl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'S'
    AND n.nspname = (SELECT schema_name FROM cfg)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
),

-- 5. Tables -----------------------------------------------------------------
tables AS (
  SELECT 400 AS ord, c.relname AS sort_key,
         format(E'CREATE TABLE IF NOT EXISTS %I.%I (\n  %s\n);',
                n.nspname, c.relname,
                string_agg(
                  format('%I %s%s%s',
                         a.attname,
                         format_type(a.atttypid, a.atttypmod),
                         CASE WHEN a.attidentity <> ''
                              THEN ' GENERATED ' ||
                                   CASE a.attidentity WHEN 'a' THEN 'ALWAYS' ELSE 'BY DEFAULT' END ||
                                   ' AS IDENTITY'
                              WHEN ad.adbin IS NOT NULL
                              THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid)
                              ELSE '' END,
                         CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END),
                  E',\n  ' ORDER BY a.attnum)) AS ddl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  WHERE c.relkind = 'r'
    AND n.nspname = (SELECT schema_name FROM cfg)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.objid = c.oid AND d.deptype = 'e')
  GROUP BY n.nspname, c.relname
),

-- 6. Primary key / unique / check constraints -------------------------------
constraints_local AS (
  SELECT 500 AS ord, con.conrelid::regclass::text || con.conname AS sort_key,
         format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s;',
                n.nspname, c.relname, con.conname,
                pg_get_constraintdef(con.oid)) AS ddl
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = (SELECT schema_name FROM cfg)
    AND con.contype IN ('p', 'u', 'c')
    AND con.conislocal
),

-- 7. Foreign keys (after every table exists) --------------------------------
constraints_fk AS (
  SELECT 600 AS ord, con.conrelid::regclass::text || con.conname AS sort_key,
         format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s;',
                n.nspname, c.relname, con.conname,
                pg_get_constraintdef(con.oid)) AS ddl
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = (SELECT schema_name FROM cfg)
    AND con.contype = 'f'
),

-- 8. Indexes (skipping those backing a constraint) --------------------------
indexes AS (
  SELECT 700 AS ord, i.indexname AS sort_key,
         i.indexdef || ';' AS ddl
  FROM pg_indexes i
  WHERE i.schemaname = (SELECT schema_name FROM cfg)
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class ic ON ic.oid = con.conindid
      WHERE ic.relname = i.indexname
    )
),

-- 9. Views ------------------------------------------------------------------
-- pg_get_viewdef() does not emit reloptions (e.g. security_invoker), so a
-- plain CREATE VIEW here silently drops any option set on the live view --
-- exactly how security_invoker went missing from approval_queue_v and
-- household_member_roster in the original baseline dump (see
-- 00000000000006_view_security_invoker.sql). Emit a WITH (...) clause from
-- c.reloptions so a regenerated baseline carries them forward.
views AS (
  SELECT 800 AS ord, c.relname AS sort_key,
         format(E'CREATE OR REPLACE VIEW %I.%I%s AS\n%s',
                n.nspname, c.relname,
                CASE WHEN c.reloptions IS NULL THEN ''
                     ELSE ' WITH (' || array_to_string(c.reloptions, ', ') || ')' END,
                pg_get_viewdef(c.oid, true)) AS ddl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'v'
    AND n.nspname = (SELECT schema_name FROM cfg)
),

-- 10. Functions and procedures ----------------------------------------------
functions AS (
  SELECT 900 AS ord, p.proname || p.oid::text AS sort_key,
         pg_get_functiondef(p.oid) || ';' AS ddl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = (SELECT schema_name FROM cfg)
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.objid = p.oid AND d.deptype = 'e')
),

-- 11. Triggers ---------------------------------------------------------------
triggers AS (
  SELECT 1000 AS ord, c.relname || t.tgname AS sort_key,
         pg_get_triggerdef(t.oid) || ';' AS ddl
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = (SELECT schema_name FROM cfg)
    AND NOT t.tgisinternal
),

-- 12. Row Level Security ----------------------------------------------------
rls_enable AS (
  SELECT 1100 AS ord, c.relname AS sort_key,
         format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;',
                n.nspname, c.relname) AS ddl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND c.relrowsecurity
    AND n.nspname = (SELECT schema_name FROM cfg)
),

policies AS (
  SELECT 1200 AS ord, p.tablename || p.policyname AS sort_key,
         format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
                p.policyname, p.schemaname, p.tablename,
                CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                p.cmd,
                array_to_string(p.roles, ', '),
                COALESCE(' USING (' || p.qual || ')', ''),
                COALESCE(' WITH CHECK (' || p.with_check || ')', '')) AS ddl
  FROM pg_policies p
  WHERE p.schemaname = (SELECT schema_name FROM cfg)
),

-- 13. Grants ----------------------------------------------------------------
grants AS (
  SELECT 1300 AS ord, g.table_name || g.grantee || g.privilege_type AS sort_key,
         format('GRANT %s ON %I.%I TO %I;',
                g.privilege_type, g.table_schema, g.table_name, g.grantee) AS ddl
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = (SELECT schema_name FROM cfg)
    AND g.grantee IN ('anon', 'authenticated', 'service_role')
),

combined AS (
  SELECT * FROM preamble
  UNION ALL SELECT * FROM extensions
  UNION ALL SELECT * FROM enums
  UNION ALL SELECT * FROM domains
  UNION ALL SELECT * FROM sequences
  UNION ALL SELECT * FROM tables
  UNION ALL SELECT * FROM constraints_local
  UNION ALL SELECT * FROM constraints_fk
  UNION ALL SELECT * FROM indexes
  UNION ALL SELECT * FROM views
  UNION ALL SELECT * FROM functions
  UNION ALL SELECT * FROM triggers
  UNION ALL SELECT * FROM rls_enable
  UNION ALL SELECT * FROM policies
  UNION ALL SELECT * FROM grants
),

sections AS (
  SELECT ord, sort_key, ddl FROM combined
  UNION ALL
  SELECT DISTINCT ord - 1, '', format(E'\n-- ===== %s =====',
    CASE ord
      WHEN 100  THEN 'EXTENSIONS'
      WHEN 200  THEN 'ENUM TYPES'
      WHEN 250  THEN 'DOMAINS'
      WHEN 300  THEN 'SEQUENCES'
      WHEN 400  THEN 'TABLES'
      WHEN 500  THEN 'CONSTRAINTS (PK / UNIQUE / CHECK)'
      WHEN 600  THEN 'FOREIGN KEYS'
      WHEN 700  THEN 'INDEXES'
      WHEN 800  THEN 'VIEWS'
      WHEN 900  THEN 'FUNCTIONS'
      WHEN 1000 THEN 'TRIGGERS'
      WHEN 1100 THEN 'ROW LEVEL SECURITY'
      WHEN 1200 THEN 'POLICIES'
      WHEN 1300 THEN 'GRANTS'
    END)
  FROM combined
  WHERE ord > 0
)

SELECT ddl
FROM sections
ORDER BY ord, sort_key;
