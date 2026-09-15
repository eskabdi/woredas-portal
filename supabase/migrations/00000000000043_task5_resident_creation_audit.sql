-- Task 5 (fix-task-production-readiness-v3): resident creation writes an
-- audit row. Confirmed no route currently writes one -- grep of every
-- src/routes file that touches audit_log turns up woreda.residents.new.tsx
-- nowhere in that list, so resident creation has been silently unaudited.
--
-- A DB-side AFTER INSERT trigger (SECURITY DEFINER, same shape as every
-- other audit-writing trigger in this codebase -- see
-- apply_death_on_approval() in baseline.sql, audit_tenant_role_change() in
-- 00000000000040/041) rather than a client-side insert: it catches every
-- insert path (this UI, any future one, a script), not just the one route
-- that exists today, and it can't be skipped by a caller that forgets to
-- add the second insert.
--
-- Actor: audit_log's own trg_force_actor (baseline.sql) only overwrites an
-- already-non-NULL actor_user_id with auth.uid() -- it never populates a
-- NULL one (00000000000041's fix #1 hit this same gap). Passing auth.uid()
-- directly here is both correct on its own and exactly what trg_force_actor
-- would also derive, so the two triggers agree rather than one silently
-- undoing the other.
--
-- new_value_json carries resident_number and full_name (identifying, not
-- sensitive) -- deliberately not national_id_no, which Task 6 moves behind
-- Vault encryption; an audit trail is not the place to keep a second
-- plaintext copy of a field being encrypted specifically to stop that.
--
-- ADDITIVE. No DROP of any table or column.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_resident_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.audit_log (actor_user_id, woreda_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (
    auth.uid(), NEW.woreda_id, 'resident', NEW.resident_id::text, 'RESIDENT_CREATED',
    jsonb_build_object('resident_number', NEW.resident_number, 'full_name', NEW.full_name)
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resident_audit_created ON public.resident;
CREATE TRIGGER resident_audit_created AFTER INSERT ON public.resident
  FOR EACH ROW EXECUTE FUNCTION public.audit_resident_created();

COMMIT;
