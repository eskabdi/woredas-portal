# APPENDIX C — READ-ONLY CATALOG QUERIES (live DB or ask user to run)

```sql
-- 1. RLS status per table
select n.nspname as schema, c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public','storage')
order by 1,2;

-- 2. All policies
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname in ('public','storage')
order by tablename, cmd;

-- 3. SECURITY DEFINER functions and search_path
select n.nspname, p.proname, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.prosecdef desc, p.proname;

-- 4. Grants to anon / authenticated
select grantee, table_name, string_agg(privilege_type, ',') as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by grantee, table_name order by table_name;

-- 5. Views and security_invoker
select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v','m') and n.nspname = 'public';

-- 6. Triggers
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public' order by 1,2;

-- 7. Storage buckets
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

-- 8. Enums
select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid order by 1, e.enumsortorder;

-- 9. Tables missing woreda_id
select table_name from information_schema.tables t
where table_schema = 'public' and table_type = 'BASE TABLE'
and not exists (select 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'woreda_id');

-- 10. Constraints (CHECK / UNIQUE / FK)
select tc.table_name, tc.constraint_type, tc.constraint_name, pg_get_constraintdef(pc.oid) as definition
from information_schema.table_constraints tc
join pg_constraint pc on pc.conname = tc.constraint_name
where tc.table_schema = 'public' order by 1,2;
```

If a Supabase MCP server is connected, also run its **security and performance advisors** and include results in `raw/`.

