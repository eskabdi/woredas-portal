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
  t     text;
  cols  text;
  vals  text;
  n     bigint;
BEGIN
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
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
           string_agg(
             format(
               'CASE WHEN (to_jsonb(x) ->> %L) IS NULL THEN ''NULL'''
               || ' ELSE quote_literal(to_jsonb(x) ->> %L) END',
               a.attname, a.attname),
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
      'SELECT %L || concat_ws('', '', %s) || %L FROM public.%I x',
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
