-- 1. Role/permission helpers -------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.revoke','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read']
    ELSE ARRAY[]::text[]
  END
$$;

CREATE OR REPLACE FUNCTION public.user_has_perm(_perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = auth.uid()
      AND au.status = 'active'
      AND COALESCE(
            (SELECT rp.is_granted FROM public.role_permission rp
              WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
                AND rp.permission_key = _perm),
            _perm = ANY (public.default_role_perms(au.role))
          )
  )
$$;

CREATE OR REPLACE FUNCTION public.user_has_any_perm(_perms text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(_perms) p WHERE public.user_has_perm(p))
$$;

-- 2. Role-aware write policies ------------------------------------------------
CREATE OR REPLACE FUNCTION public.__tenant_scoped() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT false $$;
DROP FUNCTION public.__tenant_scoped();

DO $mig$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('resident','resident_tenant_isolation', ARRAY['resident.create'], ARRAY['resident.update'], ARRAY['resident.delete']),
      ('household','household_tenant_isolation', ARRAY['household.create'], ARRAY['household.update'], ARRAY['household.update']),
      ('household_change_log','household_change_log_tenant', ARRAY['household.update','household.create'], ARRAY['household.update'], ARRAY['tenant.manage']),
      ('credential_request','credential_request_tenant', ARRAY['credential.issue'], ARRAY['credential.issue','credential.approve','credential.verify','payment.collect','revenue.collect'], ARRAY['credential.approve']),
      ('residence_credential','residence_credential_tenant_isolation', ARRAY['credential.issue'], ARRAY['credential.issue','credential.approve','credential.print','credential.revoke','credential.renew'], ARRAY['credential.revoke']),
      ('credential_print_log','credential_print_log_tenant', ARRAY['credential.print'], ARRAY['credential.print'], ARRAY['tenant.manage']),
      ('vital_event','vital_event_tenant_isolation', ARRAY['civil.register'], ARRAY['civil.register','civil.approve'], ARRAY['civil.approve']),
      ('payment','payment_tenant_isolation', ARRAY['payment.collect','revenue.collect'], ARRAY['payment.collect','revenue.collect'], ARRAY['tenant.manage']),
      ('receipt','receipt_tenant', ARRAY['payment.collect','revenue.collect','receipt.print'], ARRAY['receipt.print','revenue.receipt_reprint','payment.collect'], ARRAY['tenant.manage']),
      ('kebele_rental_house','kebele_rental_house_tenant', ARRAY['rental.create'], ARRAY['rental.create','rental.approve','rental.vacate'], ARRAY['tenant.manage']),
      ('rental_occupancy_request','rental_occupancy_request_tenant', ARRAY['rental.create','rental.vacate'], ARRAY['rental.create','rental.approve','rental.vacate'], ARRAY['tenant.manage']),
      ('rental_occupancy','rental_occupancy_tenant', ARRAY['rental.create','rental.approve'], ARRAY['rental.approve','rental.vacate'], ARRAY['tenant.manage']),
      ('rental_request_document','rental_request_document_tenant_scoped', ARRAY['rental.create'], ARRAY['rental.create'], ARRAY['rental.create']),
      ('fee_schedule','fee_schedule_tenant', ARRAY['tenant.manage'], ARRAY['tenant.manage'], ARRAY['tenant.manage']),
      ('woreda_settings','woreda_settings_tenant', ARRAY['tenant.manage'], ARRAY['tenant.manage'], ARRAY['tenant.manage'])
    ) AS t(tbl, old_policy, ins_perms, upd_perms, del_perms)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.old_policy, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())',
      r.tbl || '_select', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR (woreda_id = public.get_user_woreda_id() AND public.user_has_any_perm(%L)))',
      r.tbl || '_insert', r.tbl, r.ins_perms);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_super_admin() OR (woreda_id = public.get_user_woreda_id() AND public.user_has_any_perm(%L))) WITH CHECK (public.is_super_admin() OR (woreda_id = public.get_user_woreda_id() AND public.user_has_any_perm(%L)))',
      r.tbl || '_update', r.tbl, r.upd_perms, r.upd_perms);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_super_admin() OR (woreda_id = public.get_user_woreda_id() AND public.user_has_any_perm(%L)))',
      r.tbl || '_delete', r.tbl, r.del_perms);
  END LOOP;
END
$mig$;

-- status history tables (no woreda_id column): keep tenant scoping, add perms
DROP POLICY IF EXISTS cred_req_history_tenant ON public.credential_request_status_history;
CREATE POLICY cred_req_history_select ON public.credential_request_status_history
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.credential_request cr
      WHERE cr.credential_request_id = credential_request_status_history.credential_request_id
        AND cr.woreda_id = public.get_user_woreda_id()));
CREATE POLICY cred_req_history_insert ON public.credential_request_status_history
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin() OR (
      public.user_has_any_perm(ARRAY['credential.issue','credential.approve','credential.verify','payment.collect','revenue.collect'])
      AND EXISTS (
        SELECT 1 FROM public.credential_request cr
        WHERE cr.credential_request_id = credential_request_status_history.credential_request_id
          AND cr.woreda_id = public.get_user_woreda_id())));

DROP POLICY IF EXISTS credential_status_history_insert ON public.credential_status_history;
CREATE POLICY credential_status_history_insert ON public.credential_status_history
  FOR INSERT TO authenticated WITH CHECK (
    public.is_super_admin() OR (
      public.user_has_any_perm(ARRAY['credential.issue','credential.approve','credential.print','credential.revoke','credential.renew'])
      AND EXISTS (
        SELECT 1 FROM public.residence_credential rc
        WHERE rc.credential_id = credential_status_history.credential_id
          AND rc.woreda_id = public.get_user_woreda_id())));

-- 3. Server-derived actor identity -------------------------------------------
CREATE OR REPLACE FUNCTION public.force_actor_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  col TEXT;
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF TG_OP = 'INSERT' THEN
      IF to_jsonb(NEW) ->> col IS NOT NULL THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(col, uid));
      END IF;
    ELSE
      IF (to_jsonb(NEW) ->> col) IS NOT NULL
         AND (to_jsonb(NEW) ->> col) IS DISTINCT FROM (to_jsonb(OLD) ->> col) THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(col, uid));
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_force_actor ON public.audit_log;
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('actor_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.credential_status_history;
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.credential_status_history
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('changed_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.credential_request_status_history;
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.credential_request_status_history
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('changed_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.household_change_log;
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.household_change_log
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('registered_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.credential_print_log;
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.credential_print_log
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('printed_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.payment;
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('posted_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.credential_request;
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.credential_request
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('requested_by_user_id','verified_by_user_id','approved_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.vital_event;
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('requested_by_user_id','verified_by_user_id','approved_by_user_id','issued_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.rental_occupancy_request;
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('requested_by_user_id','verified_by_user_id','approved_by_user_id');

DROP TRIGGER IF EXISTS trg_force_actor ON public.rental_request_document;
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.rental_request_document
  FOR EACH ROW EXECUTE FUNCTION public.force_actor_columns('uploaded_by_user_id');

-- 4. Server-side credential fee validation ------------------------------------
CREATE OR REPLACE FUNCTION public.validate_credential_fee_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee NUMERIC;
BEGIN
  IF NEW.payment_type <> 'credential_fee' THEN RETURN NEW; END IF;
  SELECT credential_issuance_fee INTO v_fee FROM public.woreda_settings WHERE woreda_id = NEW.woreda_id;
  IF v_fee IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount <> v_fee THEN
    IF NOT (public.is_super_admin() OR public.user_has_any_perm(ARRAY['credential.approve','tenant.manage'])) THEN
      RAISE EXCEPTION 'Credential fee must be % ETB; waivers or adjustments require supervisor authorization', v_fee;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_validate_credential_fee ON public.payment;
CREATE TRIGGER trg_validate_credential_fee BEFORE INSERT OR UPDATE OF amount, payment_type ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.validate_credential_fee_amount();

CREATE OR REPLACE FUNCTION public.validate_receipt_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount NUMERIC;
BEGIN
  SELECT amount INTO v_amount FROM public.payment WHERE payment_id = NEW.payment_id;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Receipt must reference an existing payment'; END IF;
  NEW.total_amount := v_amount;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_validate_receipt_amount ON public.receipt;
CREATE TRIGGER trg_validate_receipt_amount BEFORE INSERT OR UPDATE OF total_amount, payment_id ON public.receipt
  FOR EACH ROW EXECUTE FUNCTION public.validate_receipt_amount();

-- 5. Least-privilege EXECUTE on SECURITY DEFINER functions --------------------
DO $rev$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.prorettype = 'trigger'::regtype AS is_trigger, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    IF f.is_trigger THEN
      CONTINUE; -- trigger functions never need direct EXECUTE
    END IF;
    IF f.proname IN ('is_super_admin','is_tenant_admin','get_user_woreda_id','user_has_perm','user_has_any_perm','get_credential_live_status') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END
$rev$;