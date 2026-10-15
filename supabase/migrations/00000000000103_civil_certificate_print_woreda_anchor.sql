-- ============================================================================
-- Defence in depth for migration 102: record_civil_certificate_print()'s
-- print-number lookup now also pins civil_certificate_print_log to the
-- caller's woreda. The event row it numbers against was already locked
-- WHERE woreda_id = get_user_woreda_id(), so this changes no result; it makes
-- the tenant anchor explicit in the statement itself, as every SECURITY
-- DEFINER lookup on a tenant table must (check:definer-tenant-predicate,
-- WP-VER-001).
--
-- Additive: CREATE OR REPLACE only; signature, grants and behaviour unchanged.
-- ============================================================================

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
    FROM public.civil_certificate_print_log l
   WHERE l.vital_event_id = _vital_event_id AND l.woreda_id = v_woreda;

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
