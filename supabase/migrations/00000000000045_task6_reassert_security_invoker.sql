-- Task 6 follow-up (review nit from tenant-isolation-review on
-- 00000000000044_task6_household_rent_national_id_pii.sql): that migration's
-- DROP + CREATE VIEW for resident_decrypted/household_decrypted states
-- `WITH (security_invoker = on)` in the CREATE, which is correct, but
-- doesn't re-run 00000000000026_workflow_engine_fixes.sql's own belt-and-
-- suspenders assertion that the option actually landed. Copies that exact
-- pattern (ALTER VIEW ... SET, then the DO $sec$ check across all eight
-- views) rather than inventing a narrower one, so the same fail-closed
-- guarantee 00000000000026 established keeps holding after this migration
-- series.
--
-- ADDITIVE. No DROP of any table, column, or view.

BEGIN;

ALTER VIEW public.resident_decrypted SET (security_invoker = on);
ALTER VIEW public.household_decrypted SET (security_invoker = on);

DO $sec$
DECLARE
  v_name text;
  v_opts text[];
  v_missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'approval_queue_v', 'household_member_roster', 'resident_decrypted',
    'household_decrypted', 'payment_decrypted', 'service_request_decrypted',
    'rental_occupancy_decrypted', 'rental_occupancy_request_decrypted'
  ] LOOP
    SELECT c.reloptions INTO v_opts
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_name AND c.relkind = 'v';
    IF FOUND AND (v_opts IS NULL OR NOT ('security_invoker=on' = ANY (v_opts))) THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'These views lost security_invoker: %. They are owned by a rolbypassrls role, so without it they stop applying the underlying tables'' RLS and return every tenant''s rows. Restore WITH (security_invoker = on).',
      array_to_string(v_missing, ', ');
  END IF;
END $sec$;

COMMIT;
