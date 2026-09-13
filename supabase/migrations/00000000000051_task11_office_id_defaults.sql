-- Task 11 follow-up: the spec's own gap-fill table says
-- "credential_request.office_id (default: the woreda's main office)" --
-- 00000000000048 only backfilled EXISTING rows to their woreda's office; a
-- brand-new credential_request or residence_credential row left office_id/
-- issuing_office_id NULL, since a plain column DEFAULT can't reference
-- another table. A BEFORE INSERT trigger fills it in from the row's own
-- woreda's main office when the caller doesn't supply one -- an explicit
-- value is still respected, since the assignment only happens when the
-- column comes in NULL. (`office.woreda_id` is UNIQUE today, so there is
-- only ever one office to default to per woreda; a future multi-office
-- woreda would need that constraint replaced with a partial unique index
-- on `(woreda_id) WHERE is_main`, which this migration does not do.)
--
-- Ordering: this default must run BEFORE 00000000000050's
-- assert_*_office_woreda check, or a caller that omits office_id entirely
-- gets rejected before this trigger ever gets to fill it in. Postgres fires
-- same-timing BEFORE triggers on one table in NAME order, and
-- "assert_..." sorts before "default_..." -- the wrong order -- so this
-- migration renames the two assert triggers with a zz_ prefix (the same
-- convention 00000000000025/026 already use to order enforce_workflow_
-- transition after trg_force_actor) rather than relying on alphabetical
-- luck.

BEGIN;

-- Guarding the zz_ CREATE itself (not just the old name) makes this
-- migration safely re-runnable, unlike a first draft of this file that
-- only dropped the pre-rename name. Also widened to fire on a woreda_id
-- change, not just an office_id edit -- a super-admin-only transfer of a
-- row to a different woreda should re-validate the office assignment too.
DROP TRIGGER IF EXISTS assert_residence_credential_office_woreda ON public.residence_credential;
DROP TRIGGER IF EXISTS zz_assert_residence_credential_office_woreda ON public.residence_credential;
CREATE TRIGGER zz_assert_residence_credential_office_woreda
  BEFORE INSERT OR UPDATE OF issuing_office_id, woreda_id ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.assert_residence_credential_office_woreda();

DROP TRIGGER IF EXISTS assert_credential_request_office_woreda ON public.credential_request;
DROP TRIGGER IF EXISTS zz_assert_credential_request_office_woreda ON public.credential_request;
CREATE TRIGGER zz_assert_credential_request_office_woreda
  BEFORE INSERT OR UPDATE OF office_id, woreda_id ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.assert_credential_request_office_woreda();

CREATE OR REPLACE FUNCTION public.default_residence_credential_office_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.issuing_office_id IS NULL THEN
    SELECT office_id INTO NEW.issuing_office_id FROM public.office WHERE woreda_id = NEW.woreda_id AND is_main;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS default_residence_credential_office_id ON public.residence_credential;
CREATE TRIGGER default_residence_credential_office_id
  BEFORE INSERT ON public.residence_credential
  FOR EACH ROW EXECUTE FUNCTION public.default_residence_credential_office_id();

CREATE OR REPLACE FUNCTION public.default_credential_request_office_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.office_id IS NULL THEN
    SELECT office_id INTO NEW.office_id FROM public.office WHERE woreda_id = NEW.woreda_id AND is_main;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS default_credential_request_office_id ON public.credential_request;
CREATE TRIGGER default_credential_request_office_id
  BEFORE INSERT ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.default_credential_request_office_id();

COMMIT;
