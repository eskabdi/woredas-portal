-- Task 11 hotfix: 00000000000049's assert_office_woreda_consistency() used
-- ONE shared trigger function for both residence_credential and
-- credential_request, branching on TG_TABLE_NAME. PL/pgSQL does not
-- short-circuit `NEW.<column>` field access around the AND -- it resolves
-- the field against the trigger's actual row type before the TG_TABLE_NAME
-- comparison is of any use, so firing this function on credential_request
-- (which has no issuing_office_id column) raised
-- `record "new" has no field "issuing_office_id"` unconditionally.
-- Confirmed live: this broke every credential_request INSERT, not only an
-- UPDATE of office_id, since a column-list on a trigger's UPDATE OF clause
-- doesn't gate INSERT firing at all -- caught by testing the exact
-- cross-tenant case before pushing, applied as an immediate fix rather than
-- left broken for even one push cycle.
--
-- Fix: two separate trigger functions, each referencing only its own
-- table's columns, replacing the single shared one.

BEGIN;

DROP TRIGGER IF EXISTS assert_residence_credential_office_woreda ON public.residence_credential;
DROP TRIGGER IF EXISTS assert_credential_request_office_woreda ON public.credential_request;
DROP FUNCTION IF EXISTS public.assert_office_woreda_consistency();

CREATE OR REPLACE FUNCTION public.assert_residence_credential_office_woreda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.issuing_office_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.office WHERE office_id = NEW.issuing_office_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION 'residence_credential: issuing_office_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER assert_residence_credential_office_woreda
  BEFORE INSERT OR UPDATE OF issuing_office_id ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.assert_residence_credential_office_woreda();

CREATE OR REPLACE FUNCTION public.assert_credential_request_office_woreda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.office_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.office WHERE office_id = NEW.office_id AND woreda_id = NEW.woreda_id
  ) THEN
    RAISE EXCEPTION 'credential_request: office_id does not belong to woreda %', NEW.woreda_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER assert_credential_request_office_woreda
  BEFORE INSERT OR UPDATE OF office_id ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.assert_credential_request_office_woreda();

COMMIT;
