-- ============================================================================
-- P1-2 (2026-09-24 audit, WP-DB-004, merges WP-AZ-005): tenant SELECT
-- policies check a read permission, not only the woreda.
--
-- Every tenant table's SELECT policy was `is_super_admin() OR woreda_id =
-- get_user_woreda_id()`: any active staff account read the whole woreda
-- (residents, households, civil events, payments, the audit trail),
-- whatever its role. 14 of the 80 permission keys -- resident.read,
-- household.read, civil.read, payment.read, audit.view, ... -- were never
-- evaluated server-side; a print_officer or a zero-grant custom role could
-- read everything a tenant_admin could.
--
-- Each tenant SELECT policy now also requires the caller to hold a key in
-- the table's module family, resolved by current_permissions() (role
-- defaults, tenant overrides, user overrides and custom roles, active
-- accounts only). A module "family" is every key with that prefix -- the
-- module's read key and its action keys -- because a role that may create
-- or approve a record has to read it too (INSERT ... RETURNING needs
-- SELECT). Cross-module reads that real screens depend on are kept:
--
--   resident          resident.* | household.*, or credential.* for a
--                     resident with a card at a print/activation stage
--                     (the print_officer's card print path, nothing else)
--   household*        household.* | resident.*
--   vital_event       civil.*
--   credential_*      credential.*           (status-history tables follow
--   residence_credential, credential_print_log, credential_verification_log
--                                             via their EXISTS on the parent)
--   service_request*  service.* | complaint.*
--   rental tables     rental.*
--   payment           payment.* | revenue.* | receipt.*, or the module that
--                     owns the payment_type (credential_fee -> credential.*,
--                     civil_registration_fee -> civil.*, service_fee ->
--                     service.*/complaint.*, rent/penalty -> rental.*), so a
--                     clerk still sees the payment on a record they handle
--   receipt           only for a payment the caller can see
--   workflow_status_history  the family of the row's entity
--   audit_log         audit.view (tenant branch); the platform branch keeps
--                     console.audit.view (migration 95)
--
-- Reference/config tables (kebele, office, service_type, fee_schedule,
-- woreda_settings, sequences, role tables) stay readable by the tenant:
-- every screen needs them and they hold no personal data.
--
-- Production impact, checked 2026-10-09 against current_permissions() for
-- every active account: tenant_admin keeps everything; registry_clerk keeps
-- every module it works in (it holds no payment/revenue/audit key, so it now
-- sees payments only on credential/civil/service/rental records it handles,
-- and no audit trail).
--
-- Additive: one new helper (CREATE OR REPLACE), ALTER POLICY in place. No
-- DROP.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_has_module_perm(_modules text[])
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM unnest(public.current_permissions()) AS p(key)
    WHERE split_part(p.key, '.', 1) = ANY (_modules)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.user_has_module_perm(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_module_perm(text[]) TO authenticated, service_role;

-- (SELECT fn(...)) is an uncorrelated sub-select, so Postgres evaluates it
-- once per query as an InitPlan rather than once per row.

-- Residents -----------------------------------------------------------------
ALTER POLICY resident_select ON public.resident
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id() AND (
      (SELECT public.user_has_module_perm(ARRAY['resident', 'household']))
      OR ((SELECT public.user_has_module_perm(ARRAY['credential']))
          AND EXISTS (
            SELECT 1 FROM public.residence_credential rc
            WHERE rc.resident_id = resident.resident_id
              AND rc.woreda_id = resident.woreda_id
              AND rc.status IN ('ready_to_print', 'printing', 'printed', 'active')))
    )));

-- Households ----------------------------------------------------------------
ALTER POLICY household_select ON public.household
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['household', 'resident']))));

ALTER POLICY household_location_select ON public.household_location
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['household', 'resident']))));

ALTER POLICY household_change_log_select ON public.household_change_log
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['household', 'resident']))));

-- Civil registration --------------------------------------------------------
ALTER POLICY vital_event_select ON public.vital_event
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['civil']))));

-- Credentials ---------------------------------------------------------------
ALTER POLICY credential_request_select ON public.credential_request
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['credential']))));

ALTER POLICY residence_credential_select ON public.residence_credential
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['credential']))));

ALTER POLICY credential_print_log_select ON public.credential_print_log
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['credential']))));

ALTER POLICY credential_verification_log_tenant_read ON public.credential_verification_log
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['credential']))));

-- Services ------------------------------------------------------------------
ALTER POLICY service_request_select ON public.service_request
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['service', 'complaint']))));

ALTER POLICY service_request_attachment_select ON public.service_request_attachment
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['service', 'complaint']))));

-- Rental --------------------------------------------------------------------
ALTER POLICY kebele_rental_house_select ON public.kebele_rental_house
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['rental']))));

ALTER POLICY rental_occupancy_select ON public.rental_occupancy
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['rental']))));

ALTER POLICY rental_occupancy_request_select ON public.rental_occupancy_request
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['rental']))));

ALTER POLICY rental_request_document_select ON public.rental_request_document
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['rental']))));

-- Payments and receipts -----------------------------------------------------
ALTER POLICY payment_select ON public.payment
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id() AND (
      (SELECT public.user_has_module_perm(ARRAY['payment', 'revenue', 'receipt']))
      OR (payment_type = 'credential_fee'
          AND (SELECT public.user_has_module_perm(ARRAY['credential'])))
      OR (payment_type = 'civil_registration_fee'
          AND (SELECT public.user_has_module_perm(ARRAY['civil'])))
      OR (payment_type = 'service_fee'
          AND (SELECT public.user_has_module_perm(ARRAY['service', 'complaint'])))
      OR (payment_type IN ('rental_rent', 'house_rent', 'penalty')
          AND (SELECT public.user_has_module_perm(ARRAY['rental'])))
    )));

-- The payment sub-select runs under payment's own policy, so a receipt is
-- visible exactly when its payment is.
ALTER POLICY receipt_select ON public.receipt
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND EXISTS (SELECT 1 FROM public.payment p
                WHERE p.payment_id = receipt.payment_id
                  AND p.woreda_id = receipt.woreda_id)));

-- Workflow history: the family of the row's entity ---------------------------
ALTER POLICY workflow_status_history_select ON public.workflow_status_history
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id() AND (
      CASE entity
        WHEN 'vital_event'              THEN (SELECT public.user_has_module_perm(ARRAY['civil']))
        WHEN 'service_request'          THEN (SELECT public.user_has_module_perm(ARRAY['service', 'complaint']))
        WHEN 'rental_occupancy_request' THEN (SELECT public.user_has_module_perm(ARRAY['rental']))
        WHEN 'credential_request'       THEN (SELECT public.user_has_module_perm(ARRAY['credential']))
        WHEN 'residence_credential'     THEN (SELECT public.user_has_module_perm(ARRAY['credential']))
        ELSE false
      END)));

-- Audit trail ---------------------------------------------------------------
ALTER POLICY audit_log_tenant_read ON public.audit_log
  USING (public.user_has_console_perm('console.audit.view')
         OR (woreda_id = public.get_user_woreda_id()
             AND (SELECT public.user_has_perm('audit.view'))));
