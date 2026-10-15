-- ============================================================================
-- Civil certificate issuance, like ID card printing, with a verifiable QR.
--
-- After a civil registration is approved, paid and registered, its
-- certificate is printed and issued as the last workflow stage:
--
--   ... paid -> registered (system) -> issued (certificate printed)
--
-- Like the ID card print stage:
--   * two new permissions: civil.print_certificate (first print, which issues
--     the certificate) and civil.authorize_reprint (any later print, with a
--     reason). Granted by default to tenant_admin, civil_registrar,
--     registry_clerk and print_officer (print) and tenant_admin, supervisor,
--     print_officer (reprint). print_officer also gets civil.read/civil.view
--     so it can reach the civil print queue -- the same shape as its
--     credential.read grant for ID cards. permissions.ts, default_role_perms()
--     and the per-woreda role_permission backfill change together (F8).
--   * civil_certificate_print_log: one row per print, numbered, with the
--     reprint reason and who printed it.
--   * record_civil_certificate_print(): the only way to print. It checks the
--     permission, the woreda, the event state and that a template is
--     published, assigns the certificate's verification token on the first
--     print, logs the print, moves registered -> issued (stamping issued_at /
--     issued_by_user_id), and audits -- in one transaction, before any PDF
--     is generated.
--   * The token, issued_at/issued_by and the move to 'issued' can be written
--     only inside that function (guard trigger), never by a direct PATCH.
--
-- QR: every certificate carries vital_event.certificate_token (26 symbols
-- from gen_random_bytes, 130 bits, same alphabet as letters/receipts, P0-7).
-- The template's QR field encodes /verify/certificate/<token>;
-- verify_civil_certificate() (anon) answers only for an issued certificate
-- and returns the minimum needed to confirm it: certificate type,
-- registration number and dates, the subject's name, the issuing woreda.
--
-- Additive: new keys, CREATE OR REPLACE, new column/table/functions/
-- triggers, one workflow_transition row. No DROP.
-- ============================================================================

-- 1. Permissions --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.reject','credential.record_payment','credential.confirm_print','credential.activate','credential.suspend','credential.preview_print','credential.create_request','credential.authorize_reprint','credential.configure_policy','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.reject','civil.record_payment','civil.view','service.submit','service.resubmit','service.return','service.reject','service.record_payment','service.issue_letter','service.complete','rental.policy.configure','rental.billing','rental.collect','rental.settle','rental.reverse','rental.plan.create','rental.plan.approve','rental.plan.manage','service.checkpoint_override','civil.print_certificate','civil.authorize_reprint']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view','credential.return','credential.reject','credential.suspend','credential.authorize_reprint','credential.view','civil.reject','civil.view','service.reject','rental.plan.approve','rental.plan.manage','service.checkpoint_override','civil.authorize_reprint']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete','civil.print_certificate']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','rental.collect','service.create','service.read','service.issue','complaint.manage','approval.queue.view','credential.submit','credential.review','credential.resubmit','credential.return','credential.confirm_print','credential.activate','credential.preview_print','credential.create_request','credential.view','civil.create_event','civil.submit','civil.resubmit','civil.verify','civil.return','civil.view','service.submit','service.resubmit','service.verify','service.return','service.issue_letter','service.complete','civil.print_certificate']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view','credential.record_payment','credential.view','civil.view','civil.record_payment','service.record_payment','rental.view','rental.collect','rental.settle','rental.plan.create']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read','credential.view','civil.view']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read','credential.view','civil.view']
    WHEN 'print_officer' THEN ARRAY['credential.read','credential.view','credential.preview_print','credential.confirm_print','credential.authorize_reprint','credential.activate','approval.queue.view','civil.read','civil.view','civil.print_certificate','civil.authorize_reprint']
    WHEN 'custom' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;$function$;

INSERT INTO public.role_permission (woreda_id, role_name, permission_key, is_granted)
SELECT w.woreda_id, r.role_name, p.permission_key, p.permission_key = ANY (public.default_role_perms(r.role_name))
  FROM public.woreda w
 CROSS JOIN (VALUES
    ('registry_clerk'), ('civil_registrar'), ('finance_clerk'),
    ('supervisor'), ('auditor'), ('viewer'), ('print_officer')
  ) AS r(role_name)
 CROSS JOIN (VALUES ('civil.print_certificate'), ('civil.authorize_reprint'), ('civil.read'), ('civil.view')) AS p(permission_key)
ON CONFLICT (woreda_id, role_name, permission_key) DO NOTHING;

-- print_officer had civil.read / civil.view explicitly denied in every
-- woreda's matrix (the old default); flip exactly those rows to the new
-- default. Rows an administrator changed later (updated_by set) are left.
UPDATE public.role_permission
   SET is_granted = true, updated_at = now()
 WHERE role_name = 'print_officer'
   AND permission_key IN ('civil.read', 'civil.view')
   AND is_granted = false
   AND updated_by IS NULL;

-- 2. Workflow: registered -> issued -------------------------------------------
INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system, note)
VALUES ('vital_event', 'registered', 'issued', 'civil.print_certificate', false,
        'Certificate printed and issued (record_civil_certificate_print only; migration 102)')
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- 3. Token column + generator -------------------------------------------------
ALTER TABLE public.vital_event ADD COLUMN IF NOT EXISTS certificate_token text;
CREATE UNIQUE INDEX IF NOT EXISTS vital_event_certificate_token_key
  ON public.vital_event (certificate_token) WHERE certificate_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.gen_certificate_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_token text;
  i int;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(26);
    v_token := '';
    FOR i IN 0..25 LOOP
      v_token := v_token || substr(v_alphabet, 1 + (get_byte(v_bytes, i) & 31), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.vital_event WHERE certificate_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.gen_certificate_token() FROM PUBLIC, anon, authenticated;

-- 4. Print log ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.civil_certificate_print_log (
  print_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woreda_id uuid NOT NULL REFERENCES public.woreda(woreda_id),
  vital_event_id uuid NOT NULL REFERENCES public.vital_event(vital_event_id),
  print_no integer NOT NULL CHECK (print_no >= 1),
  is_reprint boolean NOT NULL,
  reprint_reason text CHECK (reprint_reason IS NULL OR length(btrim(reprint_reason)) BETWEEN 5 AND 500),
  printed_by_user_id uuid NOT NULL REFERENCES public.app_user(user_id),
  printed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vital_event_id, print_no),
  CONSTRAINT civil_certificate_print_log_reason_ck
    CHECK (NOT is_reprint OR reprint_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS civil_certificate_print_log_event_idx
  ON public.civil_certificate_print_log (vital_event_id);

ALTER TABLE public.civil_certificate_print_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.civil_certificate_print_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.civil_certificate_print_log FROM authenticated;
GRANT SELECT ON public.civil_certificate_print_log TO authenticated;
GRANT ALL ON public.civil_certificate_print_log TO service_role;

CREATE POLICY civil_certificate_print_log_select ON public.civil_certificate_print_log
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (
    woreda_id = public.get_user_woreda_id()
    AND (SELECT public.user_has_module_perm(ARRAY['civil']))));

-- 5. Issuance guard: token, issued_at/by and the move to 'issued' only via
--    record_civil_certificate_print() ----------------------------------------
CREATE OR REPLACE FUNCTION public.guard_vital_event_issuance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND coalesce(current_setting('app.certificate_issue', true), '') <> 'on'
     AND (   NEW.certificate_token IS DISTINCT FROM OLD.certificate_token
          OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
          OR NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id
          OR (NEW.status = 'issued' AND OLD.status IS DISTINCT FROM 'issued')) THEN
    RAISE EXCEPTION
      'የምስክር ወረቀት የሚሰጠው በህትመት ብቻ ነው / A certificate is issued only by printing it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_guard_vital_event_issuance
  BEFORE UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.guard_vital_event_issuance();

-- A vital_event can never be inserted with these set (P0-6 guard covers
-- status and issued_*; the token too).
CREATE OR REPLACE FUNCTION public.guard_vital_event_token_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  IF NEW.certificate_token IS NOT NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'certificate_token cannot be set when an event is created'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_guard_vital_event_token_insert
  BEFORE INSERT ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.guard_vital_event_token_insert();

-- 6. The print / issue RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_civil_certificate_print(
  _vital_event_id uuid,
  _reprint_reason text DEFAULT NULL
)
 RETURNS TABLE (certificate_token text, print_no integer, is_reprint boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_woreda uuid := public.get_user_woreda_id();
  v_ev record;
  v_token text;
  v_no integer;
  v_reprint boolean;
  v_reason text := nullif(btrim(coalesce(_reprint_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR v_woreda IS NULL THEN
    RAISE EXCEPTION 'record_civil_certificate_print: no active woreda session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT ve.vital_event_id, ve.woreda_id, ve.event_type, ve.status, ve.certificate_token
    INTO v_ev
    FROM public.vital_event ve
   WHERE ve.vital_event_id = _vital_event_id AND ve.woreda_id = v_woreda
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ኩነቱ አልተገኘም / Event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_ev.status NOT IN ('registered', 'issued') THEN
    RAISE EXCEPTION 'የምስክር ወረቀት የሚታተመው ኩነቱ ከተመዘገበ በኋላ ነው / A certificate prints only once the event is registered'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.certificate_template ct
                  WHERE ct.certificate_type = v_ev.event_type AND ct.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ለዚህ የምስክር ወረቀት የታተመ አብነት የለም / No published template for this certificate'
      USING ERRCODE = 'check_violation';
  END IF;

  v_reprint := v_ev.status = 'issued';
  IF v_reprint THEN
    IF NOT public.user_has_perm('civil.authorize_reprint') THEN
      RAISE EXCEPTION 'workflow: reprinting a certificate requires civil.authorize_reprint'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_reason IS NULL OR length(v_reason) < 5 THEN
      RAISE EXCEPTION 'የድጋሚ ህትመት ምክንያት ያስፈልጋል / A reprint needs a reason (at least 5 characters)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT public.user_has_perm('civil.print_certificate') THEN
    RAISE EXCEPTION 'workflow: printing a certificate requires civil.print_certificate'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_token := coalesce(v_ev.certificate_token, public.gen_certificate_token());

  SELECT coalesce(max(l.print_no), 0) + 1 INTO v_no
    FROM public.civil_certificate_print_log l WHERE l.vital_event_id = _vital_event_id;

  INSERT INTO public.civil_certificate_print_log
    (woreda_id, vital_event_id, print_no, is_reprint, reprint_reason, printed_by_user_id)
  VALUES (v_woreda, _vital_event_id, v_no, v_reprint, CASE WHEN v_reprint THEN left(v_reason, 500) END, auth.uid());

  IF NOT v_reprint THEN
    PERFORM set_config('app.certificate_issue', 'on', true);
    UPDATE public.vital_event
       SET status = 'issued', certificate_token = v_token,
           issued_at = now(), issued_by_user_id = auth.uid()
     WHERE vital_event_id = _vital_event_id;
    PERFORM set_config('app.certificate_issue', '', true);
  END IF;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda, auth.uid(), 'vital_event', _vital_event_id::text,
          CASE WHEN v_reprint THEN 'CERTIFICATE_REPRINTED' ELSE 'CERTIFICATE_ISSUED' END,
          jsonb_build_object('certificate_type', v_ev.event_type, 'print_no', v_no,
                             'reprint_reason', CASE WHEN v_reprint THEN v_reason END));

  RETURN QUERY SELECT v_token, v_no, v_reprint;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_civil_certificate_print(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_civil_certificate_print(uuid, text) TO authenticated;

-- 7. Public verification ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_civil_certificate(_token text)
 RETURNS TABLE (
   certificate_type text,
   registration_number text,
   event_date date,
   registration_date date,
   issued_at timestamptz,
   subject_name_am text,
   subject_name_en text,
   second_party_name_am text,
   second_party_name_en text,
   woreda_name_am text,
   woreda_name_en text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  WITH ev AS (
    SELECT ve.*, coalesce(ve.event_details -> 'certificate', '{}'::jsonb) AS c
      FROM public.vital_event ve
     WHERE _token ~ '^[A-HJ-NP-Z2-9]{26}$'
       AND ve.certificate_token = _token
       AND ve.status = 'issued'
  ), names AS (
    SELECT ev.*,
      CASE ev.event_type
        WHEN 'birth' THEN 'child' WHEN 'death' THEN 'deceased' WHEN 'marriage' THEN 'wife'
        WHEN 'divorce' THEN 'party1' WHEN 'adoption' THEN 'adoptee' END AS p1,
      CASE ev.event_type WHEN 'marriage' THEN 'husband' WHEN 'divorce' THEN 'party2' END AS p2
    FROM ev
  )
  SELECT n.event_type, n.event_number, n.event_date, n.registration_date, n.issued_at,
         nullif(concat_ws(' ', n.c ->> (n.p1 || '_name_am'), n.c ->> (n.p1 || '_father_name_am'),
                          n.c ->> (n.p1 || '_grandfather_name_am')), ''),
         nullif(concat_ws(' ', n.c ->> (n.p1 || '_name_en'), n.c ->> (n.p1 || '_father_name_en'),
                          n.c ->> (n.p1 || '_grandfather_name_en')), ''),
         CASE WHEN n.p2 IS NOT NULL THEN nullif(concat_ws(' ', n.c ->> (n.p2 || '_name_am'),
              n.c ->> (n.p2 || '_father_name_am'), n.c ->> (n.p2 || '_grandfather_name_am')), '') END,
         CASE WHEN n.p2 IS NOT NULL THEN nullif(concat_ws(' ', n.c ->> (n.p2 || '_name_en'),
              n.c ->> (n.p2 || '_father_name_en'), n.c ->> (n.p2 || '_grandfather_name_en')), '') END,
         coalesce(ws.woreda_name_display, w.woreda_name_am),
         coalesce(ws.woreda_name_display_en, w.woreda_name_en)
    FROM names n
    JOIN public.woreda w ON w.woreda_id = n.woreda_id
    LEFT JOIN public.woreda_settings ws ON ws.woreda_id = n.woreda_id
   LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_civil_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_civil_certificate(text) TO anon, authenticated;
