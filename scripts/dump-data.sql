-- ============================================================================
-- Data dump: emits INSERT statements for reference / seed tables.
--
-- Run in the Supabase SQL Editor against the EXISTING project, then copy the
-- `dml` column into a seed file and run it against the new project AFTER the
-- baseline schema has been applied.
--
-- The table list at the bottom controls what gets exported. It is limited to
-- configuration and lookup data, not operational records like residents,
-- credentials or payments. Tables are dumped in the order given, so keep
-- parents before children to satisfy foreign keys.
--
-- Rows use ON CONFLICT DO NOTHING, so the seed can be re-run safely.
-- Column values are quoted by PostgreSQL via quote_literal / quote_ident,
-- so embedded quotes, newlines and NULLs round-trip correctly.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.dump_seed_data(tables text[])
RETURNS TABLE (dml text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  t          text;
  cols       text;
  vals       text;
  n          bigint;
  seeded     oid[];
BEGIN
  -- OIDs of the tables being seeded. A nullable foreign key pointing outside
  -- this set is emitted as NULL rather than a value that would fail: audit
  -- columns such as updated_by reference app_user, which holds real accounts
  -- tied to auth.users and is deliberately not seeded.
  SELECT coalesce(array_agg(to_regclass('public.' || quote_ident(u))), '{}')
    INTO seeded
  FROM unnest(tables) AS u
  WHERE to_regclass('public.' || quote_ident(u)) IS NOT NULL;

  FOREACH t IN ARRAY tables LOOP
    -- Skip anything that is not present, rather than aborting the whole dump.
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      dml := format('-- skipped %I: table not found', t);
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Column list and value expressions are both built in attnum order, and
    -- each value addresses its column by name. Do NOT iterate the row with
    -- jsonb_each_text: jsonb orders keys by length then bytewise, which does
    -- not match column order, and the values would be assigned to the wrong
    -- columns.
    --
    -- The row is aliased "__dump_row" rather than something short like x:
    -- a bare identifier resolves to a COLUMN before a table alias, so on a
    -- table that has a column named x, to_jsonb(x) would pass that column's
    -- value instead of the row and every field would come back NULL.
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
           string_agg(
             CASE
               -- Nullable FK pointing at a table we are not seeding: emit NULL.
               WHEN NOT a.attnotnull AND EXISTS (
                 SELECT 1
                 FROM pg_constraint con
                 WHERE con.conrelid = a.attrelid
                   AND con.contype = 'f'
                   AND a.attnum = ANY (con.conkey)
                   AND NOT (con.confrelid = ANY (seeded))
               )
               THEN '''NULL'''
               ELSE format(
                 'CASE WHEN (to_jsonb("__dump_row") ->> %L) IS NULL THEN ''NULL'''
                 || ' ELSE quote_literal(to_jsonb("__dump_row") ->> %L) END',
                 a.attname, a.attname)
             END,
             ', ' ORDER BY a.attnum)
      INTO cols, vals
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || quote_ident(t))::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;

    dml := format(E'\n-- ===== %s (%s rows) =====', t, n);
    RETURN NEXT;

    -- One INSERT per row.
    RETURN QUERY EXECUTE format(
      'SELECT %L || concat_ws('', '', %s) || %L FROM public.%I AS "__dump_row"',
      format('INSERT INTO public.%I (%s) VALUES (', t, cols),
      vals,
      ') ON CONFLICT DO NOTHING;',
      t
    );
  END LOOP;
END;
$fn$;

SELECT dml FROM pg_temp.dump_seed_data(ARRAY[
  'woreda',
  'kebele',
  'woreda_settings',
  'role_permission',
  'service_type',
  'fee_schedule',
  'tenant_module_config',
  'id_card_template',
  'id_card_template_field'
]);
