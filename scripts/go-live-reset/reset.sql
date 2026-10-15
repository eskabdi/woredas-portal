-- Go-live reset: removes every pilot/test record from production and keeps
-- the configuration. Run ONLY on go-live day, ONLY after a verified backup
-- (see docs/go-live-reset-runbook.md). This is a one-off data operation,
-- not a migration: it changes no schema.
--
-- Run it through run.sh, which wraps it in BEGIN ... COMMIT. Dry run by
-- default: without `SET LOCAL golive.apply = 'yes'` (run.sh --apply adds it)
-- the second block ends with RAISE EXCEPTION 'DRYRUN ...', so every change
-- rolls back and only the counts are reported.
--
-- session_replication_role is switched with top-level SET LOCAL statements:
-- on Supabase the postgres role may SET it, but not set_config() it from
-- inside a DO block.
--
-- What it does, in one transaction:
--   1. Refuses to run unless every public table is classified below, so a
--      table added after this script was written is never purged (or kept)
--      by accident.
--   2. Deletes every row from the PURGE tables (records, history, number
--      counters except credential numbers) with triggers disabled, since
--      the payment/receipt/workflow guards reject deletes by design.
--   3. Deletes audit_log (the pre-reset backup is the archive) and every
--      app_user except active, unrestricted super admins.
--   4. Clears references in kept rows that pointed at deleted rows
--      (e.g. woreda_settings.updated_by -> a deleted test user).
--   5. Re-enables triggers, deletes the removed users from auth.users
--      (cascading to their sessions and identities).
--   6. Fails if any foreign key anywhere in public is left dangling, then
--      writes one GO_LIVE_RESET audit row with the counts.
--
-- credential_number_sequence is kept on purpose: a test card that was
-- printed keeps a number no real resident will ever be given.
--
-- Output carries counts only, never row data (the repository is public).

SET LOCAL session_replication_role = replica;

DO $reset$
DECLARE
  _keep text[] := ARRAY[
    'woreda', 'woreda_settings', 'office', 'kebele',
    'fee_schedule', 'service_type', 'tenant_module_config',
    'role_permission', 'workflow_transition',
    'console_role', 'console_role_permission',
    'id_card_template', 'id_card_template_field', 'id_card_template_field_draft',
    'certificate_template', 'certificate_template_field', 'certificate_template_field_draft',
    'rental_policy', 'credential_policy', 'credential_number_sequence'
  ];
  _special text[] := ARRAY['app_user', 'audit_log'];
  _purge text[] := ARRAY[
    'approval',
    'arrears_installment_charge', 'arrears_plan_sequence',
    'arrears_repayment_installment', 'arrears_repayment_plan',
    'attachment', 'civil_certificate_print_log',
    'credential_print_log', 'credential_request', 'credential_request_sequence',
    'credential_request_status_history', 'credential_status_history',
    'credential_verification_log',
    'household', 'household_change_log', 'household_location',
    'kebele_rental_house',
    'payment', 'payment_reconciliation_exception', 'receipt', 'receipt_sequence',
    'platform_backup_restore_request', 'rate_limit_bucket',
    'rent_account', 'rent_account_sequence', 'rent_charge',
    'rent_payment_settlement', 'rent_rate_history', 'rent_reminder',
    'rental_occupancy', 'rental_occupancy_request', 'rental_payment',
    'rental_request_document', 'rental_request_sequence',
    'residence_credential', 'resident', 'resident_document',
    'resident_number_sequence',
    'service_request', 'service_request_attachment', 'service_request_checkpoint',
    'service_request_sequence', 'service_request_status_history',
    'tenant_role', 'tenant_role_permission', 'user_permission_override',
    'vital_event', 'vital_event_sequence', 'workflow_status_history'
  ];

  _keep_users uuid[];
  _unclassified text;
  r record;
  n bigint;
  _total bigint := 0;
  _counts jsonb := '{}'::jsonb;
  _cleared jsonb := '{}'::jsonb;
BEGIN
  -- 1. Every public table must be classified exactly once.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO _unclassified
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND NOT (c.relname = ANY (_keep || _special || _purge));
  IF _unclassified IS NOT NULL THEN
    RAISE EXCEPTION 'Unclassified tables, add each to _keep or _purge first: %', _unclassified;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_keep || _special || _purge) t
             GROUP BY t HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'A table is listed twice';
  END IF;

  _keep_users := ARRAY(
    SELECT user_id FROM public.app_user
    WHERE role = 'super_admin' AND status = 'active' AND console_role_id IS NULL
  );
  IF cardinality(_keep_users) = 0 THEN
    RAISE EXCEPTION 'No active unrestricted super admin would remain; refusing';
  END IF;

  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'Run through run.sh: triggers must be off for the purge';
  END IF;
  CREATE TEMP TABLE golive_keep ON COMMIT DROP AS SELECT unnest(_keep_users) AS user_id;

  -- 2-3. Purge with triggers off (guards and FK triggers alike).

  FOR r IN SELECT unnest(_purge) AS t LOOP
    EXECUTE format('DELETE FROM public.%I', r.t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN _counts := _counts || jsonb_build_object(r.t, n); END IF;
    _total := _total + n;
  END LOOP;

  DELETE FROM public.audit_log;
  GET DIAGNOSTICS n = ROW_COUNT;
  _counts := _counts || jsonb_build_object('audit_log', n);

  DELETE FROM public.app_user WHERE NOT (user_id = ANY (_keep_users));
  GET DIAGNOSTICS n = ROW_COUNT;
  _counts := _counts || jsonb_build_object('app_user', n);

  -- 4. Clear references from kept rows to rows that no longer exist.
  FOR r IN
    SELECT con.conrelid::regclass AS child, con.confrelid::regclass AS parent,
           a.attname AS col, pa.attname AS pcol, a.attnotnull AS notnull
    FROM pg_constraint con
    JOIN pg_namespace ns ON ns.oid = con.connamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND ns.nspname = 'public'
      AND cardinality(con.conkey) = 1
      AND (SELECT relname FROM pg_class WHERE oid = con.conrelid) = ANY (_keep || ARRAY['app_user'])
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = c.%I)',
      r.child, r.col, r.parent, r.pcol, r.col) INTO n;
    IF n > 0 THEN
      IF r.notnull THEN
        RAISE EXCEPTION '%.% (NOT NULL) points at % deleted row(s) in %; decide by hand',
          r.child, r.col, n, r.parent;
      END IF;
      EXECUTE format(
        'UPDATE %s c SET %I = NULL WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = c.%I)',
        r.child, r.col, r.col, r.parent, r.pcol, r.col);
      _cleared := _cleared || jsonb_build_object(r.child::text || '.' || r.col, n);
    END IF;
  END LOOP;

  CREATE TEMP TABLE golive_state ON COMMIT DROP AS
    SELECT _counts AS counts, _cleared AS cleared, cardinality(_keep_users) AS kept;
END
$reset$;

SET LOCAL session_replication_role = origin;

DO $reset2$
DECLARE
  _apply boolean := coalesce(current_setting('golive.apply', true), '') = 'yes';
  _counts jsonb;
  _cleared jsonb;
  _kept int;
  r record;
  n bigint;
  _dangling text := '';
BEGIN
  SELECT counts, cleared, kept INTO _counts, _cleared, _kept FROM golive_state;

  -- 5. Triggers back on; removed accounts leave auth too.
  DELETE FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM golive_keep k WHERE k.user_id = u.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  _counts := _counts || jsonb_build_object('auth.users', n);

  -- 6. No dangling foreign key anywhere in public (multi-column ones included).
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS child, con.confrelid::regclass AS parent,
           (SELECT string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' AND ')
              FROM unnest(con.conkey, con.confkey) k(ck, pk)
              JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.ck
              JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = k.pk) AS joincond,
           (SELECT string_agg(format('c.%I IS NOT NULL', ca.attname), ' AND ')
              FROM unnest(con.conkey) k(ck)
              JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.ck) AS notnullcond
    FROM pg_constraint con JOIN pg_namespace ns ON ns.oid = con.connamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
                   r.child, r.notnullcond, r.parent, r.joincond) INTO n;
    IF n > 0 THEN _dangling := _dangling || format('%s(%s) ', r.conname, n); END IF;
  END LOOP;
  IF _dangling <> '' THEN
    RAISE EXCEPTION 'Dangling foreign keys after reset: %', _dangling;
  END IF;

  INSERT INTO public.audit_log (entity_name, action_type, new_value_json)
  VALUES ('platform', 'GO_LIVE_RESET', jsonb_build_object(
    'deleted', _counts, 'references_cleared', _cleared,
    'kept_super_admins', _kept));

  IF NOT _apply THEN
    RAISE EXCEPTION 'DRYRUN deleted=% cleared=% kept_super_admins=%',
      _counts, _cleared, _kept;
  END IF;
  RAISE NOTICE 'APPLIED deleted=% cleared=% kept_super_admins=%',
    _counts, _cleared, _kept;
END
$reset2$;
