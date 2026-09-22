-- Kebele Rental Houses Management -- Phase 2 (financial core).
--
-- Grounded in Kebele_Rental_Houses_Management_Implementation_Plan.md Part B
-- (sections 12-14: rent_account, rent_rate_history, rent_charge) and Part C
-- section 20 (generate_rent_charges()), plus the section 6.5 legacy backfill.
-- Phase 0 (rental_policy, migration 71) and Phase 1 (integrity hardening,
-- migrations 72-75) are already live -- this migration is purely additive on
-- top of them: no existing table, column, constraint, or policy is dropped
-- except where immediately superseded by a strict superset (the same pattern
-- 72 used for kebele_rental_house_occupancy_status_check).
--
-- ---------------------------------------------------------------------------
-- Why the EC calendar math for every period/due-date value in this file is
-- computed by the CALLER, not by SQL in this migration (BR-28 / plan section
-- 3.7: "this module contains no calendar logic; reuse the existing shared EC
-- utility exclusively"):
--
-- The shared utility (src/utils/ethiopianCalendar.ts, gregorianToEthiopian /
-- ethiopianToGregorian) is TypeScript. Postgres cannot call it, and porting
-- its JDN arithmetic into a second, parallel SQL implementation would be
-- exactly the "new calendar logic" the plan forbids -- two implementations
-- of the same conversion drift the moment one of them gets a bugfix the
-- other doesn't. So every function below that needs an Ethiopian period or a
-- due date takes it as a pre-computed parameter (a 'YYYY-MM' period string,
-- a due `date`) from the client, which derives it via the existing utility
-- before calling in. Every function still VALIDATES the string it receives
-- (format + the months-1-12 range -- structural, not calendar arithmetic),
-- so a caller cannot smuggle a Pagume period past the CHECK-level guarantee
-- BR-24 depends on merely by mis-computing a parameter.
--
-- ADDITIVE. No DROP of any table, column, or constraint.

BEGIN;

-- ============================================================================
-- 1. Permission: rental.billing (invokes generate_rent_charges()).
--
-- Restates default_role_perms() in full (Postgres CREATE OR REPLACE
-- semantics; scripts/check-role-perms-drift.ts concatenates every migration
-- in order and takes the last definition) -- every array below is identical
-- to 00000000000071's except tenant_admin, which gains 'rental.billing'.
-- Not added to the reserved-key lists: unlike rental.policy.configure this is
-- an ordinary grantable permission (see the comment on P.RENTAL_BILLING in
-- src/config/permissions.ts) -- a tenant_admin may hand it to another role
-- (e.g. finance_clerk) via the matrix if the tenant wants that.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete','rental.policy.configure','rental.billing']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;$function$;

-- No role_permission backfill needed: tenant_admin has no per-tenant override
-- row (role_permission_role_name_check, 00000000000035, only allows the six
-- non-admin roles) so it resolves solely through default_role_perms() above.

-- ============================================================================
-- 2. rent_account_sequence + rent_account.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rent_account_sequence (
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  seq_year smallint NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (woreda_id, seq_year)
);

ALTER TABLE public.rent_account_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY rent_account_sequence_tenant ON public.rent_account_sequence
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_super_admin() OR woreda_id = get_user_woreda_id())
  WITH CHECK (is_super_admin() OR woreda_id = get_user_woreda_id());

CREATE TABLE IF NOT EXISTS public.rent_account (
  rent_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  occupancy_id uuid NOT NULL REFERENCES public.rental_occupancy(occupancy_id),
  rental_house_id uuid NOT NULL REFERENCES public.kebele_rental_house(rental_house_id),
  kebele_id uuid NOT NULL REFERENCES public.kebele(kebele_id),
  resident_id uuid NOT NULL REFERENCES public.resident(resident_id),
  household_id uuid REFERENCES public.household(household_id),
  account_number text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'terminated', 'closed')),
  -- 'YYYY-MM', Ethiopian calendar, months 1-12 only (Pagume structurally
  -- excluded by the regex itself -- '13' never matches).
  billing_start_period_key text NOT NULL
    CHECK (billing_start_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  billing_end_period_key text
    CHECK (billing_end_period_key IS NULL OR billing_end_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_by uuid REFERENCES public.app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (woreda_id, account_number)
);

-- One active account per active occupancy (plan section 12).
CREATE UNIQUE INDEX IF NOT EXISTS rent_account_one_active_per_occupancy
  ON public.rent_account (occupancy_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS rent_account_woreda_status_idx
  ON public.rent_account (woreda_id, status);

DROP TRIGGER IF EXISTS rent_account_set_updated_at ON public.rent_account;
CREATE TRIGGER rent_account_set_updated_at
  BEFORE UPDATE ON public.rent_account
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- account_number: "<woreda_code>-RA-<YY>-<00001>", mirroring
-- assign_rental_request_number()'s own shape and sequence-table pattern.
CREATE OR REPLACE FUNCTION public.assign_rent_account_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
BEGIN
  IF NEW.account_number IS NOT NULL AND NEW.account_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  INSERT INTO public.rent_account_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = rent_account_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.account_number := v_woreda_code || '-RA-' || LPAD(v_year::TEXT, 2, '0') || '-' || LPAD(v_next::TEXT, 5, '0');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_assign_rent_account_number ON public.rent_account;
CREATE TRIGGER zz_assign_rent_account_number
  BEFORE INSERT ON public.rent_account
  FOR EACH ROW EXECUTE FUNCTION public.assign_rent_account_number();

ALTER TABLE public.rent_account ENABLE ROW LEVEL SECURITY;

-- SELECT only for ordinary authenticated callers: every write to this table
-- goes through provision_rent_account() below (SECURITY DEFINER, which
-- bypasses RLS as the function owner) or the section 6.5 backfill script
-- (service_role, which also bypasses RLS) -- there is no legitimate direct
-- INSERT/UPDATE/DELETE from a plain client session, so no such policy exists.
CREATE POLICY rent_account_select ON public.rent_account
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 3. rent_rate_history.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rent_rate_history (
  rent_rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rent_account_id uuid NOT NULL REFERENCES public.rent_account(rent_account_id),
  effective_period_key text NOT NULL
    CHECK (effective_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  monthly_amount numeric(14, 2) NOT NULL CHECK (monthly_amount > 0),
  monthly_amount_enc bytea,
  change_reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  approved_by uuid REFERENCES public.app_user(user_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rent_account_id, effective_period_key)
);

-- One currently-active rate per account (plan section 13: "each rent_charge
-- snapshots its rate at generation" -- generate_rent_charges() below reads
-- exactly this row).
CREATE UNIQUE INDEX IF NOT EXISTS rent_rate_history_one_active_per_account
  ON public.rent_rate_history (rent_account_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS rent_rate_history_account_idx
  ON public.rent_rate_history (rent_account_id, effective_period_key DESC);

ALTER TABLE public.rent_rate_history ENABLE ROW LEVEL SECURITY;

-- Same reasoning as rent_account: writes only via provision_rent_account()
-- (initial rate) and, in a future phase, a rate-change RPC -- no direct
-- client INSERT/UPDATE policy in Phase 2.
CREATE POLICY rent_rate_history_select ON public.rent_rate_history
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 4. rent_charge -- the core entity. One row = one complete EC-month
--    obligation. Pagume is impossible at the database level (CHECK).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rent_charge (
  rent_charge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  rent_account_id uuid NOT NULL REFERENCES public.rent_account(rent_account_id),
  occupancy_id uuid NOT NULL REFERENCES public.rental_occupancy(occupancy_id),
  ethiopian_year integer NOT NULL CHECK (ethiopian_year > 0),
  ethiopian_month integer NOT NULL CHECK (ethiopian_month BETWEEN 1 AND 12),
  ethiopian_period_key text NOT NULL
    CHECK (ethiopian_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  charge_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  base_rent_amount numeric(14, 2) NOT NULL CHECK (base_rent_amount > 0),
  base_rent_amount_enc bytea,
  approved_adjustment_amount numeric(14, 2) NOT NULL DEFAULT 0,
  approved_adjustment_amount_enc bytea,
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount > 0),
  total_amount_enc bytea,
  status text NOT NULL DEFAULT 'due'
    CHECK (status IN ('scheduled', 'due', 'overdue', 'paid', 'waived', 'cancelled')),
  settled_at timestamptz,
  settled_by_payment_id uuid REFERENCES public.payment(payment_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One month, one charge (BR-04).
  UNIQUE (rent_account_id, ethiopian_period_key),
  -- total = base + adjustment (indivisibility -- no outstanding_amount
  -- column exists anywhere on this table; see plan section 14).
  CHECK (total_amount = base_rent_amount + approved_adjustment_amount)
);

CREATE INDEX IF NOT EXISTS rent_charge_account_idx
  ON public.rent_charge (rent_account_id, ethiopian_period_key);
CREATE INDEX IF NOT EXISTS rent_charge_woreda_status_idx
  ON public.rent_charge (woreda_id, status);

DROP TRIGGER IF EXISTS rent_charge_set_updated_at ON public.rent_charge;
CREATE TRIGGER rent_charge_set_updated_at
  BEFORE UPDATE ON public.rent_charge
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Historical immutability (plan section 14 / BR-13): base_rent_amount,
-- ethiopian_period_key/_year/_month and rent_account_id never change once a
-- charge exists. Corrections are governed adjustment/reversal transactions
-- (plan sections 28-29, future phases), never an edit of these columns.
CREATE OR REPLACE FUNCTION public.guard_rent_charge_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.base_rent_amount IS DISTINCT FROM OLD.base_rent_amount
     OR NEW.ethiopian_period_key IS DISTINCT FROM OLD.ethiopian_period_key
     OR NEW.ethiopian_year IS DISTINCT FROM OLD.ethiopian_year
     OR NEW.ethiopian_month IS DISTINCT FROM OLD.ethiopian_month
     OR NEW.rent_account_id IS DISTINCT FROM OLD.rent_account_id THEN
    RAISE EXCEPTION
      'የተፈጠረ የኪራይ ክፍያ ወር ወይም መጠን ሊቀየር አይችልም -- እርማት የሚደረገው በተፈቀደ ማስተካከያ ግብይት ብቻ ነው / A generated rent charge''s period or amount cannot be edited -- corrections require a governed adjustment transaction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_guard_rent_charge_immutable ON public.rent_charge;
CREATE TRIGGER zz_guard_rent_charge_immutable
  BEFORE UPDATE ON public.rent_charge
  FOR EACH ROW EXECUTE FUNCTION public.guard_rent_charge_immutable_fields();

ALTER TABLE public.rent_charge ENABLE ROW LEVEL SECURITY;

-- SELECT only. Every row is written by generate_rent_charges() (SECURITY
-- DEFINER); settlement writes (Phase 3) will be another SECURITY DEFINER
-- RPC. No direct client INSERT/UPDATE/DELETE policy exists or should ever
-- exist -- the whole point of BR-02/BR-13 is that nothing but a governed
-- server-side transaction can touch this table.
CREATE POLICY rent_charge_select ON public.rent_charge
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id() AND user_has_any_perm('{rental.view}'::text[])));

-- ============================================================================
-- 5. Money encryption (T-4), following pii_encryption's own established
--    pattern exactly: plaintext column remains authoritative, an `_enc`
--    mirror is derived by a sync trigger on every write, and a
--    security_invoker decrypted view is the read surface for anything that
--    needs the decrypted value alongside other row data. Uniqueness/FK keys
--    never involve the encrypted columns (T-4) -- none of the UNIQUE/CHECK
--    constraints above reference an `_enc` column.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rent_rate_history_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.monthly_amount_enc := public.encrypt_pii_numeric(NEW.monthly_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rent_rate_history_amount_sync_trg ON public.rent_rate_history;
CREATE TRIGGER rent_rate_history_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.rent_rate_history
  FOR EACH ROW EXECUTE FUNCTION public.rent_rate_history_amount_sync();

CREATE OR REPLACE FUNCTION public.rent_charge_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.base_rent_amount_enc := public.encrypt_pii_numeric(NEW.base_rent_amount, NEW.woreda_id);
  NEW.approved_adjustment_amount_enc := public.encrypt_pii_numeric(NEW.approved_adjustment_amount, NEW.woreda_id);
  NEW.total_amount_enc := public.encrypt_pii_numeric(NEW.total_amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rent_charge_amount_sync_trg ON public.rent_charge;
CREATE TRIGGER rent_charge_amount_sync_trg
  BEFORE INSERT OR UPDATE ON public.rent_charge
  FOR EACH ROW EXECUTE FUNCTION public.rent_charge_amount_sync();

DROP VIEW IF EXISTS public.rent_rate_history_decrypted;
CREATE VIEW public.rent_rate_history_decrypted
  WITH (security_invoker = on) AS
  SELECT rh.*,
         public.decrypt_pii_numeric(rh.monthly_amount_enc, rh.woreda_id) AS monthly_amount_decrypted
  FROM public.rent_rate_history rh;

DROP VIEW IF EXISTS public.rent_charge_decrypted;
CREATE VIEW public.rent_charge_decrypted
  WITH (security_invoker = on) AS
  SELECT rc.*,
         public.decrypt_pii_numeric(rc.base_rent_amount_enc, rc.woreda_id) AS base_rent_amount_decrypted,
         public.decrypt_pii_numeric(rc.approved_adjustment_amount_enc, rc.woreda_id) AS approved_adjustment_amount_decrypted,
         public.decrypt_pii_numeric(rc.total_amount_enc, rc.woreda_id) AS total_amount_decrypted
  FROM public.rent_charge rc;

REVOKE ALL ON public.rent_rate_history_decrypted FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rent_charge_decrypted        FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rent_rate_history_decrypted TO authenticated, service_role;
GRANT SELECT ON public.rent_charge_decrypted        TO authenticated, service_role;

-- ============================================================================
-- 6. provision_rent_account() -- the "rental_policy wiring" step: turns an
--    active occupancy into a billable account plus its initial rate. Called
--    by the client immediately after a new_registration request's approval
--    succeeds (src/routes/woreda.rental-houses.requests.$requestId.index.tsx),
--    with _billing_start_period_key computed there via the existing
--    gregorianToEthiopian() utility (adjusted for a Pagume start per plan
--    section 3.3 -- rolled forward to the following Meskerem -- entirely in
--    that TS call site, not here). Idempotent: re-invoking for an occupancy
--    that already has an active account returns the existing one rather than
--    erroring, so a retried client call after a network blip cannot create a
--    duplicate account.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_rent_account(
  _occupancy_id uuid,
  _billing_start_period_key text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_occ RECORD;
  v_kebele_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.approve', 'rental.billing'])) THEN
    RAISE EXCEPTION 'provision_rent_account: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _billing_start_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION
      'ልክ ያልሆነ የክፍያ ወቅት / Invalid billing period'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_occ FROM public.rental_occupancy WHERE occupancy_id = _occupancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provision_rent_account: occupancy not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_super_admin() AND v_occ.woreda_id <> get_user_woreda_id() THEN
    RAISE EXCEPTION 'provision_rent_account: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_occ.status <> 'active' THEN
    RAISE EXCEPTION 'provision_rent_account: occupancy is not active' USING ERRCODE = 'check_violation';
  END IF;

  SELECT rent_account_id INTO v_existing_id
    FROM public.rent_account
   WHERE occupancy_id = _occupancy_id AND status = 'active';
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  SELECT kebele_id INTO v_kebele_id
    FROM public.kebele_rental_house WHERE rental_house_id = v_occ.rental_house_id;

  INSERT INTO public.rent_account (
    woreda_id, occupancy_id, rental_house_id, kebele_id, resident_id, household_id,
    status, billing_start_period_key, created_by
  ) VALUES (
    v_occ.woreda_id, v_occ.occupancy_id, v_occ.rental_house_id, v_kebele_id,
    v_occ.resident_id, v_occ.household_id,
    'active', _billing_start_period_key, v_actor
  )
  RETURNING rent_account_id INTO v_new_id;

  INSERT INTO public.rent_rate_history (
    woreda_id, rent_account_id, effective_period_key, monthly_amount,
    change_reason, status, approved_by, approved_at
  ) VALUES (
    v_occ.woreda_id, v_new_id, _billing_start_period_key, v_occ.rent_amount,
    'initial_rate', 'active', v_actor, now()
  );

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_occ.woreda_id, v_actor, 'rent_account', v_new_id::text, 'RENT_ACCOUNT_PROVISIONED',
    jsonb_build_object('occupancy_id', _occupancy_id, 'billing_start_period_key', _billing_start_period_key));

  RETURN v_new_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.provision_rent_account(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_rent_account(uuid, text) TO authenticated, service_role;

-- Termination wiring: when apply_rental_occupancy_on_approval() (Phase 1,
-- migration 72) closes an occupancy, it now also closes that occupancy's
-- active rent_account. Restated in full (CREATE OR REPLACE) -- unchanged
-- from 72 except the new block at the end of the ELSIF branch. Billing stop
-- (plan section 26: "billing stops after that period") is enforced by
-- generate_rent_charges() below only ever iterating status = 'active'
-- accounts -- a 'terminated' account is simply never selected again, no
-- separate billing_end_period_key write is needed to stop billing (it
-- remains available for future phases' reporting/reactivation logic to set
-- explicitly if a governed correction ever requires it).
CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_occupancy_id UUID;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.request_type = 'new_registration' THEN
      IF EXISTS (
        SELECT 1 FROM public.rental_occupancy
         WHERE rental_house_id = NEW.rental_house_id AND status = 'active' AND woreda_id = NEW.woreda_id
      ) THEN
        RAISE EXCEPTION
          'ቤቱ በሌላ ተከራይ ተይዟል -- መጀመሪያ የነባሩን ኪራይ ማቋረጥ ማፅደቅ ያስፈልጋል / House is occupied by an active tenancy -- approve a termination first';
      END IF;

      INSERT INTO public.rental_occupancy (
        woreda_id, rental_house_id, resident_id, household_id,
        rent_start_date, rent_amount, status, originating_request_id
      ) VALUES (
        NEW.woreda_id, NEW.rental_house_id, NEW.resident_id, NEW.household_id,
        COALESCE(NEW.rent_start_date, CURRENT_DATE),
        COALESCE(NEW.rent_amount, 0),
        'active', NEW.rental_request_id
      )
      RETURNING occupancy_id INTO v_new_occupancy_id;

      NEW.resulting_occupancy_id := v_new_occupancy_id;

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'occupied'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', '', true);

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      -- Phase 2 wiring: close the billable account with the occupancy. A
      -- terminated occupancy may have no rent_account yet (it predates
      -- Phase 2 and the 6.5 backfill hasn't run, or the approving client
      -- never called provision_rent_account()) -- this UPDATE simply
      -- matches zero rows in that case, which is not an error.
      UPDATE public.rent_account
      SET status = 'terminated'
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', '', true);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 7. generate_rent_charges() -- the billing RPC (plan section 20). Manual
--    invocation only (PD-10); woreda-scoped; idempotent via the
--    UNIQUE(rent_account_id, ethiopian_period_key) constraint already on
--    rent_charge, backstopped here by ON CONFLICT DO NOTHING so a re-run
--    (or a double-click) creates nothing on its second pass.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_rent_charges(
  _target_period text,
  _due_date date
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_year int;
  v_month int;
  v_examined int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_inserted int;
  r RECORD;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'generate_rent_charges: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.billing'])) THEN
    RAISE EXCEPTION 'generate_rent_charges: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Structural validation only (BR-24): months 1-12, never 13 (Pagume).
  -- '13' cannot match this regex, so a Pagume period is rejected here
  -- exactly as it is at the CHECK-constraint level on rent_charge itself --
  -- this is defense in depth, not the only guarantee.
  IF _target_period IS NULL OR _target_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION
      'ልክ ያልሆነ የክፍያ ወቅት ወይም ጳጉሜ ተመርጧል -- ኪራይ የሚከፈለው ከመስከረም እስከ ነሐሴ ብቻ ነው / Invalid billing period or Pagume selected -- rent is billed Meskerem through Nehase only'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _due_date IS NULL THEN
    RAISE EXCEPTION 'generate_rent_charges: due date is required' USING ERRCODE = 'not_null_violation';
  END IF;

  v_year := split_part(_target_period, '-', 1)::int;
  v_month := split_part(_target_period, '-', 2)::int;

  FOR r IN
    SELECT ra.rent_account_id, ra.occupancy_id,
           (SELECT rh.monthly_amount FROM public.rent_rate_history rh
             WHERE rh.rent_account_id = ra.rent_account_id AND rh.status = 'active'
             LIMIT 1) AS v_rate
      FROM public.rent_account ra
     WHERE ra.woreda_id = v_woreda_id
       AND ra.status = 'active'
       AND ra.billing_start_period_key <= _target_period
       AND (ra.billing_end_period_key IS NULL OR ra.billing_end_period_key >= _target_period)
  LOOP
    v_examined := v_examined + 1;

    IF r.v_rate IS NULL THEN
      -- No active rate row -- data-integrity gap (every account should get
      -- one from provision_rent_account() or the 6.5 backfill). Skip rather
      -- than fail the whole batch; the run summary below surfaces it.
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    WITH ins AS (
      INSERT INTO public.rent_charge (
        woreda_id, rent_account_id, occupancy_id, ethiopian_year, ethiopian_month,
        ethiopian_period_key, charge_date, due_date,
        base_rent_amount, approved_adjustment_amount, total_amount, status
      ) VALUES (
        v_woreda_id, r.rent_account_id, r.occupancy_id, v_year, v_month,
        _target_period, current_date, _due_date,
        r.v_rate, 0, r.v_rate, 'due'
      )
      ON CONFLICT (rent_account_id, ethiopian_period_key) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;

    IF v_inserted > 0 THEN
      v_created := v_created + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, auth.uid(), 'rent_charge_batch', _target_period, 'RENT_BILLING_GENERATED',
    jsonb_build_object(
      'target_period', _target_period, 'due_date', _due_date,
      'accounts_examined', v_examined, 'charges_created', v_created, 'skipped', v_skipped
    ));

  RETURN jsonb_build_object(
    'target_period', _target_period,
    'accounts_examined', v_examined,
    'charges_created', v_created,
    'skipped', v_skipped
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_rent_charges(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_rent_charges(text, date) TO authenticated, service_role;

COMMIT;
