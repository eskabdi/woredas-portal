-- Controlled reversal of a fee payment (follow-up to P1-12, migration 108,
-- which froze non-rental payments: before it any cashier could flip a fee
-- payment to 'reversed' silently; after it nobody could reverse one at all).
--
-- reverse_fee_payment(_payment_id, _reason):
--   * tenant administrator (tenant.manage) of the payment's woreda;
--   * a reason of 10 to 500 characters;
--   * never the person who collected the payment (posted_by_user_id);
--   * only while the paid-for outcome has not been delivered:
--       - ID card request still 'paid' and its card still 'ready_to_print'
--         (not printing / printed / active): the card is revoked, the
--         request goes back to 'awaiting_payment';
--       - service letter still 'paid' (not issued): back to
--         'awaiting_payment';
--       - a civil event registers in the same transaction as its payment,
--         so its fee cannot be reversed here;
--   * the payment becomes 'reversed' (its receipt then fails public
--     verification, verify_receipt checks status = 'confirmed'), the
--     request's payment_id is cleared so a new payment can be recorded,
--     and status history plus audit rows are written by the database.
--
-- Three system-only edges (is_system, driven only under
-- app.system_transition): credential_request paid -> awaiting_payment,
-- service_request (letter) paid -> awaiting_payment, residence_credential
-- ready_to_print -> revoked. No user session can take them directly.
--
-- Additive: workflow_transition rows inserted if absent, one new function.

INSERT INTO public.workflow_transition (entity, category, from_status, to_status, required_permission, is_system, note)
SELECT v.entity, v.category, v.from_status, v.to_status, NULL, true, v.note
  FROM (VALUES
    ('credential_request', NULL::text, 'paid', 'awaiting_payment',
     'System: fee payment reversed (reverse_fee_payment, migration 109)'),
    ('service_request', 'letter', 'paid', 'awaiting_payment',
     'System: fee payment reversed (reverse_fee_payment, migration 109)'),
    ('residence_credential', NULL::text, 'ready_to_print', 'revoked',
     'System: card minted for a payment that was reversed (reverse_fee_payment, migration 109)')
  ) AS v(entity, category, from_status, to_status, note)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.workflow_transition w
    WHERE w.entity = v.entity AND w.from_status = v.from_status AND w.to_status = v.to_status);

CREATE OR REPLACE FUNCTION public.reverse_fee_payment(_payment_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_woreda   uuid := public.get_user_woreda_id();
  v_reason   text := btrim(coalesce(_reason, ''));
  v_pay      record;
  v_number   text;
  v_entity   text;
  v_entity_id uuid;
  v_status   text;
  v_card     uuid;
  v_card_status text;
BEGIN
  IF v_uid IS NULL OR v_woreda IS NULL THEN
    RAISE EXCEPTION 'reverse_fee_payment: no active woreda session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.user_has_perm('tenant.manage') THEN
    RAISE EXCEPTION 'ክፍያ ለመመለስ የወረዳ አስተዳዳሪ ፈቃድ ያስፈልጋል / Only a tenant administrator can reverse a payment'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'የመመለሻ ምክንያት ያስፈልጋል / A reversal needs a reason of 10 to 500 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT payment_id, payment_type, status, amount, posted_by_user_id,
         credential_request_id, vital_event_id, service_request_id
    INTO v_pay
    FROM public.payment
   WHERE payment_id = _payment_id AND woreda_id = v_woreda
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ክፍያው አልተገኘም / Payment not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_pay.status <> 'confirmed' THEN
    RAISE EXCEPTION 'ይህ ክፍያ ቀደም ብሎ ተመልሷል / This payment is not confirmed (status: %)', v_pay.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_pay.payment_type = 'rental_rent' THEN
    RAISE EXCEPTION 'የኪራይ ክፍያ በኪራይ ሂሳብ ገጽ ይመለሳል / Rental payments are reversed from the rent account (reverse_rental_payment)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_pay.payment_type = 'civil_registration_fee' THEN
    RAISE EXCEPTION 'የተመዘገበ ኩነት ክፍያ ሊመለስ አይችልም / A civil registration is completed with its payment; its fee cannot be reversed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_pay.payment_type NOT IN ('credential_fee', 'service_fee') THEN
    RAISE EXCEPTION 'ይህ የክፍያ ዓይነት ሊመለስ አይችልም / This payment type cannot be reversed here'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_pay.posted_by_user_id = v_uid THEN
    RAISE EXCEPTION 'ክፍያውን የሰበሰበው ሠራተኛ ራሱ ሊመልሰው አይችልም / The person who collected this payment cannot also reverse it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT receipt_number INTO v_number FROM public.receipt
   WHERE payment_id = _payment_id AND woreda_id = v_woreda;

  IF v_pay.payment_type = 'credential_fee' THEN
    v_entity := 'credential_request'; v_entity_id := v_pay.credential_request_id;
    SELECT status, credential_id INTO v_status, v_card
      FROM public.credential_request
     WHERE credential_request_id = v_entity_id AND woreda_id = v_woreda
       FOR UPDATE;
    IF v_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'ጥያቄው ከክፍያ በኋላ ተራምዷል (ሁኔታ: %) / The request has moved past payment (status: %); revoke the card instead',
        v_status, v_status USING ERRCODE = 'check_violation';
    END IF;
    IF v_card IS NOT NULL THEN
      SELECT status INTO v_card_status FROM public.residence_credential
       WHERE credential_id = v_card AND woreda_id = v_woreda
         FOR UPDATE;
      IF v_card_status IS DISTINCT FROM 'ready_to_print' THEN
        RAISE EXCEPTION 'መታወቂያው ወደ ህትመት ገብቷል (ሁኔታ: %) / The card has already gone to print (status: %); revoke the card instead',
          v_card_status, v_card_status USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    v_entity := 'service_request'; v_entity_id := v_pay.service_request_id;
    SELECT status INTO v_status
      FROM public.service_request
     WHERE service_request_id = v_entity_id AND woreda_id = v_woreda
       FOR UPDATE;
    IF v_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'ደብዳቤው ተሰጥቷል ወይም ከክፍያ በኋላ ተራምዷል (ሁኔታ: %) / The request has moved past payment (status: %)',
        v_status, v_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM set_config('app.payment_rpc', 'on', true);
  PERFORM set_config('app.system_transition', 'on', true);

  UPDATE public.payment SET status = 'reversed' WHERE payment_id = _payment_id;

  IF v_entity = 'credential_request' THEN
    IF v_card IS NOT NULL THEN
      UPDATE public.residence_credential
         SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid,
             revoked_reason = 'Fee payment reversed: ' || v_reason
       WHERE credential_id = v_card;
      INSERT INTO public.credential_status_history
        (credential_id, old_status, new_status, changed_by_user_id, change_reason)
      VALUES (v_card, 'ready_to_print', 'revoked', v_uid, 'Fee payment reversed: ' || v_reason);
    END IF;
    UPDATE public.credential_request
       SET status = 'awaiting_payment', payment_id = NULL, credential_id = NULL
     WHERE credential_request_id = v_entity_id;
    INSERT INTO public.credential_request_status_history
      (credential_request_id, old_status, new_status, changed_by_user_id, change_reason)
    VALUES (v_entity_id, 'paid', 'awaiting_payment', v_uid, 'Payment reversed: ' || v_reason);
  ELSE
    UPDATE public.service_request
       SET status = 'awaiting_payment', payment_id = NULL
     WHERE service_request_id = v_entity_id;
    INSERT INTO public.service_request_status_history
      (service_request_id, old_status, new_status, changed_by_user_id, change_reason)
    VALUES (v_entity_id, 'paid', 'awaiting_payment', v_uid, 'Payment reversed: ' || v_reason);
  END IF;

  PERFORM set_config('app.system_transition', '', true);
  PERFORM set_config('app.payment_rpc', '', true);

  INSERT INTO public.audit_log
    (woreda_id, actor_user_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
  VALUES (v_woreda, v_uid, 'payment', _payment_id::text, 'FEE_PAYMENT_REVERSED',
          jsonb_build_object('status', 'confirmed', 'amount', v_pay.amount,
                             'receipt_number', v_number, 'posted_by_user_id', v_pay.posted_by_user_id),
          jsonb_build_object('status', 'reversed', 'reason', v_reason, 'entity', v_entity,
                             'entity_id', v_entity_id, 'revoked_credential_id', v_card));

  RETURN jsonb_build_object('payment_id', _payment_id, 'status', 'reversed', 'entity', v_entity,
                            'entity_id', v_entity_id, 'revoked_credential_id', v_card);
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_fee_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_fee_payment(uuid, text) TO authenticated;
