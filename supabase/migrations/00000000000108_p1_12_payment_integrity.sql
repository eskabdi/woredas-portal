-- P1-12 (WP-CRY-007, WP-DB-006, WP-DB-007, WP-WF-009, WP-WF-010, WP-WF-011):
-- payment and numbering integrity.
--
-- 1. One atomic RPC records a fee. record_fee_payment() locks the request,
--    resolves the fee server-side, raises approved -> awaiting_payment when
--    needed, inserts the payment and its receipt, moves the request to paid
--    and writes the audit (and, for credential and service requests, the
--    status-history) rows itself. It replaces three client calls per flow
--    (credential, civil, service letter, and the offline credential replay).
--    A repeated call on a request that is already paid returns the existing
--    payment instead of creating a second one.
-- 2. One payment per request, one receipt per payment: partial UNIQUE
--    indexes on payment(credential_request_id) and payment(service_request_id)
--    for confirmed rows (vital_event already had one), UNIQUE receipt(payment_id).
-- 3. Payments and receipts are written only by server code. From a user
--    session a payment can be inserted only inside record_fee_payment() (or
--    the rental RPCs, which keep their own guards), a receipt only by those
--    RPCs, a non-rental payment cannot be changed at all, and a receipt
--    only gets printed_at. A request's payment_id moves only inside the RPC.
--    The free-form 'penalty' / 'house_rent' payment types can no longer be
--    created from a user session.
-- 4. Waivers: the caller must hold the approve permission of that module
--    (credential.approve / civil.approve / service.approve), and must be
--    neither the request's approver nor its requester. The waiver audit row
--    is written by the database. The civil fee guard now knows the divorce
--    and adoption fee rows (it only mapped birth/death/marriage).
-- 5. Numbering: the seven numbering triggers always assign the number in a
--    user session (a client-sent number is ignored); the six counter tables
--    with FOR ALL tenant policies lose INSERT/UPDATE/DELETE grants for
--    anon/authenticated (the SECURITY DEFINER triggers own them).
-- 6. kebele is reference data: INSERT/UPDATE/DELETE need is_super_admin()
--    (restrictive policies; reads unchanged).
-- 7. Fee catalog edits (fee_schedule, service_type fee columns) write an
--    audit row with the old and new values.
--
-- Additive: new functions, triggers, indexes and restrictive policies;
-- CREATE OR REPLACE of validate_credential_fee_amount (migration 66) and the
-- seven assign_* numbering functions; privilege REVOKEs only.

-- 2. Uniqueness ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS receipt_payment_id_key
  ON public.receipt (payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_credential_request_confirmed_key
  ON public.payment (credential_request_id)
  WHERE credential_request_id IS NOT NULL AND status = 'confirmed';

CREATE UNIQUE INDEX IF NOT EXISTS payment_service_request_confirmed_key
  ON public.payment (service_request_id)
  WHERE service_request_id IS NOT NULL AND status = 'confirmed';

-- 3. Write guards ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_fee_payment_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(current_setting('app.payment_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  -- Rental payments have their own guards (settle_rent_payment /
  -- reverse_rental_payment, migrations 84/86).
  IF NEW.payment_type = 'rental_rent'
     OR (TG_OP = 'UPDATE' AND OLD.payment_type = 'rental_rent') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'payment: fees are recorded only through record_fee_payment() / ክፍያ የሚመዘገበው በክፍያ መመዝገቢያ ብቻ ነው'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
     OR NEW.waived IS DISTINCT FROM OLD.waived
     OR NEW.waiver_reason IS DISTINCT FROM OLD.waiver_reason
     OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id
     OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.posted_by_user_id IS DISTINCT FROM OLD.posted_by_user_id
     OR NEW.credential_request_id IS DISTINCT FROM OLD.credential_request_id
     OR NEW.vital_event_id IS DISTINCT FROM OLD.vital_event_id
     OR NEW.service_request_id IS DISTINCT FROM OLD.service_request_id
     OR NEW.rental_request_id IS DISTINCT FROM OLD.rental_request_id THEN
    RAISE EXCEPTION
      'payment: a recorded payment cannot be changed / የተመዘገበ ክፍያ ሊቀየር አይችልም'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'yy_guard_fee_payment_write'
                    AND tgrelid = 'public.payment'::regclass) THEN
    CREATE TRIGGER yy_guard_fee_payment_write
      BEFORE INSERT OR UPDATE ON public.payment
      FOR EACH ROW EXECUTE FUNCTION public.guard_fee_payment_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_receipt_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_type text;
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(current_setting('app.payment_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- settle_rent_payment() inserts the rental receipt from the user's
    -- session; a rental payment can only exist through that RPC.
    SELECT p.payment_type INTO v_type
      FROM public.payment p
     WHERE p.payment_id = NEW.payment_id AND p.woreda_id = NEW.woreda_id;
    IF v_type IS DISTINCT FROM 'rental_rent' THEN
      RAISE EXCEPTION
        'receipt: receipts are issued only with their payment / ደረሰኝ የሚሰጠው ከክፍያው ጋር ብቻ ነው'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
     OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.cash_bank_channel IS DISTINCT FROM OLD.cash_bank_channel
     OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id THEN
    RAISE EXCEPTION
      'receipt: only the print time of a receipt can be recorded / የደረሰኝ የታተመበት ጊዜ ብቻ ነው የሚመዘገበው'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'yy_guard_receipt_write'
                    AND tgrelid = 'public.receipt'::regclass) THEN
    CREATE TRIGGER yy_guard_receipt_write
      BEFORE INSERT OR UPDATE ON public.receipt
      FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_request_payment_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.payment_id IS DISTINCT FROM OLD.payment_id
     AND coalesce(current_setting('app.payment_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION
      'workflow: %.payment_id is set only by record_fee_payment()', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credential_request','vital_event','service_request'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = 'guard_request_payment_link'
                      AND tgrelid = ('public.' || t)::regclass) THEN
      EXECUTE format(
        'CREATE TRIGGER guard_request_payment_link BEFORE UPDATE OF payment_id ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.guard_request_payment_link()', t);
    END IF;
  END LOOP;
END $$;

-- 4. Fee guard: module-specific waiver authority, divorce/adoption fees ------

CREATE OR REPLACE FUNCTION public.validate_credential_fee_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expected numeric;
  v_entity_woreda uuid;
  v_approver uuid;
  v_requester uuid;
  v_waive_perm text;
BEGIN
  IF NEW.payment_type NOT IN ('service_fee', 'civil_registration_fee', 'credential_fee') THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_type = 'service_fee' THEN
    v_waive_perm := 'service.approve';
    SELECT sr.woreda_id, st.fee_amount, sr.approved_by_user_id, sr.requested_by_user_id
      INTO v_entity_woreda, v_expected, v_approver, v_requester
      FROM public.service_request sr
      JOIN public.service_type st
        ON st.service_type_id = sr.service_type_id AND st.woreda_id = sr.woreda_id
     WHERE sr.service_request_id = NEW.service_request_id;

  ELSIF NEW.payment_type = 'civil_registration_fee' THEN
    v_waive_perm := 'civil.approve';
    SELECT ve.woreda_id, ve.approved_by_user_id, ve.requested_by_user_id
      INTO v_entity_woreda, v_approver, v_requester
      FROM public.vital_event ve
     WHERE ve.vital_event_id = NEW.vital_event_id;

    IF v_entity_woreda IS NOT NULL THEN
      SELECT fs.standard_fee INTO v_expected
        FROM public.vital_event ve
        JOIN public.fee_schedule fs
          ON fs.woreda_id = ve.woreda_id
         AND fs.service_type = CASE ve.event_type
               WHEN 'birth' THEN 'Civil Registration - Birth'
               WHEN 'death' THEN 'Civil Registration - Death'
               WHEN 'marriage' THEN 'Civil Registration - Marriage'
               WHEN 'divorce' THEN 'Civil Registration - Divorce'
               WHEN 'adoption' THEN 'Civil Registration - Adoption'
             END
         AND fs.status = 'active'
         AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
       WHERE ve.vital_event_id = NEW.vital_event_id
       ORDER BY fs.effective_from DESC NULLS LAST
       LIMIT 1;
    END IF;

  ELSIF NEW.payment_type = 'credential_fee' THEN
    v_waive_perm := 'credential.approve';
    SELECT cr.woreda_id, cr.approved_by_user_id, cr.requested_by_user_id
      INTO v_entity_woreda, v_approver, v_requester
      FROM public.credential_request cr
     WHERE cr.credential_request_id = NEW.credential_request_id;

    IF v_entity_woreda IS NOT NULL THEN
      SELECT fs.standard_fee INTO v_expected
        FROM public.credential_request cr
        JOIN public.fee_schedule fs
          ON fs.woreda_id = cr.woreda_id
         AND fs.service_type = CASE cr.request_type
               WHEN 'new_issue' THEN 'New ID Issuance'
               WHEN 'renewal' THEN 'ID Renewal'
               WHEN 'reissue_lost' THEN 'Lost ID Replacement'
               WHEN 'reissue_damaged' THEN 'Lost ID Replacement'
               WHEN 'reissue_stolen' THEN 'Lost ID Replacement'
               WHEN 'reissue_correction' THEN 'Lost ID Replacement'
             END
         AND fs.status = 'active'
         AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
       WHERE cr.credential_request_id = NEW.credential_request_id
       ORDER BY fs.effective_from DESC NULLS LAST
       LIMIT 1;
    END IF;
  END IF;

  IF v_entity_woreda IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ክፍያው ከየትኛውም ጥያቄ ጋር አልተገናኘም / A fee-bearing payment must resolve to a real, linked request.';
  END IF;

  IF v_entity_woreda <> NEW.woreda_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ክፍያው ካለው ጥያቄ ወረዳ ጋር አይዛመድም / This payment''s woreda does not match its linked request''s woreda.';
  END IF;

  IF v_expected IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'ክፍያ መርሃ ግብር ወይም የአገልግሎት ዓይነት አልተገኘም / No active fee schedule or service type found for this request — an administrator must add or activate it in Settings.';
  END IF;

  IF NEW.waived THEN
    IF NEW.waiver_reason IS NULL OR length(trim(NEW.waiver_reason)) < 5 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'የስረዛ ምክንያት ያስፈልጋል / A waived payment requires a reason of at least 5 characters.';
    END IF;
    -- P1-12: the approve permission of THIS module, and a second person:
    -- never the request's approver or requester.
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
      IF NOT public.user_has_perm(v_waive_perm) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'insufficient_privilege',
          MESSAGE = format('ክፍያ ስረዛ የበላይ ፈቃድ ያስፈልገዋል / A fee waiver requires %s.', v_waive_perm);
      END IF;
      IF auth.uid() = v_approver OR auth.uid() = v_requester THEN
        RAISE EXCEPTION USING
          ERRCODE = 'insufficient_privilege',
          MESSAGE = 'ጥያቄውን ያጸደቀ ወይም ያቀረበ ሰው ክፍያውን ሊያነሳ አይችልም / The approver or requester of a request cannot also waive its fee.';
      END IF;
    END IF;
    IF NEW.amount <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = format(
          'የተነሳ ክፍያ 0 መሆን አለበት / A waived payment must be recorded as 0, not %s.',
          NEW.amount
        );
    END IF;
  ELSIF NEW.amount <> v_expected THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'የሚጠበቀው ክፍያ %s ብር ነው፣ የተመዘገበው ግን %s ብር ነው / Expected fee is %s ETB; recorded amount is %s ETB. Use the waiver option (requires supervisor authorization) to record a different amount, with a reason.',
        v_expected, NEW.amount, v_expected, NEW.amount
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- 1. record_fee_payment ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_fee_payment(
  _entity text,
  _entity_id uuid,
  _channel text,
  _reference_no text DEFAULT NULL,
  _waived boolean DEFAULT false,
  _waiver_reason text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_woreda    uuid := public.get_user_woreda_id();
  v_waived    boolean := coalesce(_waived, false);
  v_reason    text := nullif(btrim(coalesce(_waiver_reason, '')), '');
  v_ref       text := nullif(btrim(coalesce(_reference_no, '')), '');
  v_channel   text := coalesce(_channel, '');
  v_perm      text;
  v_type      text;
  v_status    text;
  v_pay_id    uuid;
  v_resident  uuid;
  v_household uuid;
  v_kind      text;
  v_fee       numeric;
  v_amount    numeric;
  v_payment   uuid;
  v_receipt   uuid;
  v_number    text;
  v_raised    boolean := false;
BEGIN
  IF v_uid IS NULL OR v_woreda IS NULL THEN
    RAISE EXCEPTION 'record_fee_payment: no active woreda session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _entity = 'credential_request' THEN
    v_perm := 'credential.record_payment'; v_type := 'credential_fee';
    SELECT status, payment_id, resident_id, household_id, request_type
      INTO v_status, v_pay_id, v_resident, v_household, v_kind
      FROM public.credential_request
     WHERE credential_request_id = _entity_id AND woreda_id = v_woreda
       FOR UPDATE;
  ELSIF _entity = 'vital_event' THEN
    v_perm := 'civil.record_payment'; v_type := 'civil_registration_fee';
    SELECT status, payment_id, resident_id, household_id, event_type
      INTO v_status, v_pay_id, v_resident, v_household, v_kind
      FROM public.vital_event
     WHERE vital_event_id = _entity_id AND woreda_id = v_woreda
       FOR UPDATE;
  ELSIF _entity = 'service_request' THEN
    v_perm := 'service.record_payment'; v_type := 'service_fee';
    SELECT status, payment_id, resident_id, household_id, service_type_id::text
      INTO v_status, v_pay_id, v_resident, v_household, v_kind
      FROM public.service_request
     WHERE service_request_id = _entity_id AND woreda_id = v_woreda
       FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'record_fee_payment: unknown entity %', _entity
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (public.is_super_admin() OR public.user_has_perm(v_perm)) THEN
    RAISE EXCEPTION 'ክፍያ ለመመዝገብ ፈቃድ የለዎትም / You do not have permission to record this payment'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'ጥያቄው አልተገኘም / The request was not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotent: a retry (double click, offline replay after a lost
  -- response) returns the payment already on file instead of a second one.
  IF v_status NOT IN ('approved', 'awaiting_payment') THEN
    IF v_pay_id IS NOT NULL THEN
      SELECT p.payment_id, r.receipt_id, r.receipt_number, p.amount, p.waived
        INTO v_payment, v_receipt, v_number, v_amount, v_waived
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = v_pay_id AND p.woreda_id = v_woreda AND p.status = 'confirmed';
      IF FOUND THEN
        RETURN jsonb_build_object(
          'payment_id', v_payment, 'receipt_id', v_receipt, 'receipt_number', v_number,
          'amount', v_amount, 'waived', v_waived, 'status', v_status, 'already_recorded', true);
      END IF;
    END IF;
    RAISE EXCEPTION 'ጥያቄው ለክፍያ ዝግጁ አይደለም (ሁኔታ: %) / The request is not ready for payment (status: %)',
      v_status, v_status USING ERRCODE = 'check_violation';
  END IF;

  IF v_channel NOT IN ('cash', 'bank', 'mobile') THEN
    RAISE EXCEPTION 'የክፍያ መንገድ ይምረጡ / Choose a payment channel' USING ERRCODE = 'check_violation';
  END IF;
  IF v_waived THEN
    IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 500 THEN
      RAISE EXCEPTION 'የስረዛ ምክንያት ያስፈልጋል / A waiver needs a reason of 5 to 500 characters'
        USING ERRCODE = 'check_violation';
    END IF;
    v_channel := 'cash';
    v_ref := NULL;
  ELSE
    v_reason := NULL;
    IF v_channel IN ('bank', 'mobile') AND v_ref IS NULL THEN
      RAISE EXCEPTION 'የክፍያ ማጣቀሻ ያስገቡ / Enter the bank or mobile payment reference'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF v_ref IS NOT NULL AND length(v_ref) > 100 THEN
    RAISE EXCEPTION 'ማጣቀሻው ረጅም ነው / The payment reference is too long'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The fee is resolved here, never taken from the client.
  IF _entity = 'credential_request' THEN
    v_fee := public.resolve_credential_fee(v_kind);
  ELSIF _entity = 'vital_event' THEN
    v_fee := public.resolve_civil_fee(v_kind);
  ELSE
    v_fee := public.resolve_service_fee(v_kind::uuid);
  END IF;
  v_amount := CASE WHEN v_waived THEN 0 ELSE v_fee END;

  -- approved -> awaiting_payment is its own FSM edge (record_payment).
  IF v_status = 'approved' THEN
    EXECUTE format('UPDATE public.%I SET status = %L WHERE %I = $1',
                   _entity, 'awaiting_payment',
                   CASE _entity WHEN 'credential_request' THEN 'credential_request_id'
                                WHEN 'vital_event' THEN 'vital_event_id'
                                ELSE 'service_request_id' END)
      USING _entity_id;
    v_raised := true;
  END IF;

  PERFORM set_config('app.payment_rpc', 'on', true);

  INSERT INTO public.payment (
    woreda_id, resident_id, household_id, payment_type, amount, payment_date,
    channel, reference_no, status, posted_by_user_id, waived, waiver_reason,
    credential_request_id, vital_event_id, service_request_id
  ) VALUES (
    v_woreda, v_resident, v_household, v_type, v_amount, current_date,
    v_channel, v_ref, 'confirmed', v_uid, v_waived, v_reason,
    CASE WHEN _entity = 'credential_request' THEN _entity_id END,
    CASE WHEN _entity = 'vital_event' THEN _entity_id END,
    CASE WHEN _entity = 'service_request' THEN _entity_id END
  )
  RETURNING payment_id INTO v_payment;

  INSERT INTO public.receipt (woreda_id, payment_id, receipt_date, total_amount, cash_bank_channel, receipt_number)
  VALUES (v_woreda, v_payment, current_date, v_amount, v_channel, '')
  RETURNING receipt_id, receipt_number INTO v_receipt, v_number;

  IF _entity = 'credential_request' THEN
    UPDATE public.credential_request SET status = 'paid', payment_id = v_payment
     WHERE credential_request_id = _entity_id;
  ELSIF _entity = 'vital_event' THEN
    UPDATE public.vital_event SET status = 'paid', payment_id = v_payment
     WHERE vital_event_id = _entity_id;
  ELSE
    UPDATE public.service_request SET status = 'paid', payment_id = v_payment
     WHERE service_request_id = _entity_id;
  END IF;

  PERFORM set_config('app.payment_rpc', '', true);

  -- A registered birth/death advances past paid inside the same statement.
  EXECUTE format('SELECT status FROM public.%I WHERE %I = $1', _entity,
                 CASE _entity WHEN 'credential_request' THEN 'credential_request_id'
                              WHEN 'vital_event' THEN 'vital_event_id'
                              ELSE 'service_request_id' END)
    INTO v_status USING _entity_id;

  -- Status history the app used to write for these two tables (vital_event
  -- history is trigger-written, migration 58).
  IF _entity = 'credential_request' THEN
    IF v_raised THEN
      INSERT INTO public.credential_request_status_history
        (credential_request_id, old_status, new_status, changed_by_user_id, change_reason)
      VALUES (_entity_id, 'approved', 'awaiting_payment', v_uid, 'Fee raised');
    END IF;
    INSERT INTO public.credential_request_status_history
      (credential_request_id, old_status, new_status, changed_by_user_id, change_reason)
    VALUES (_entity_id, 'awaiting_payment', 'paid', v_uid,
            CASE WHEN v_waived THEN 'Payment waived: ' || v_reason ELSE 'Payment collected' END);
  ELSIF _entity = 'service_request' THEN
    IF v_raised THEN
      INSERT INTO public.service_request_status_history
        (service_request_id, old_status, new_status, changed_by_user_id, change_reason)
      VALUES (_entity_id, 'approved', 'awaiting_payment', v_uid, 'Fee raised for payment');
    END IF;
    INSERT INTO public.service_request_status_history
      (service_request_id, old_status, new_status, changed_by_user_id, change_reason)
    VALUES (_entity_id, 'awaiting_payment', 'paid', v_uid,
            CASE WHEN v_waived THEN 'Payment waived: ' || v_reason ELSE 'Payment recorded' END);
  END IF;

  INSERT INTO public.audit_log
    (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda, v_uid, _entity, _entity_id::text,
          CASE WHEN v_waived THEN 'PAYMENT_WAIVED' ELSE 'PAYMENT_COLLECTED' END,
          jsonb_build_object('payment_id', v_payment, 'receipt_number', v_number,
                             'amount', v_amount, 'expected_fee', v_fee, 'channel', v_channel,
                             'waived', v_waived, 'waiver_reason', v_reason));

  RETURN jsonb_build_object(
    'payment_id', v_payment, 'receipt_id', v_receipt, 'receipt_number', v_number,
    'amount', v_amount, 'waived', v_waived, 'status', v_status, 'already_recorded', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_fee_payment(text, uuid, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fee_payment(text, uuid, text, text, boolean, text) TO authenticated;

-- 5. Numbering ---------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.credential_number_sequence,
  public.credential_request_sequence,
  public.receipt_sequence,
  public.rental_request_sequence,
  public.resident_number_sequence,
  public.vital_event_sequence
FROM anon, authenticated;

-- In a user session the number is always assigned; only a service-level
-- insert (auth.uid() IS NULL: seed, import, maintenance) may carry its own.
CREATE OR REPLACE FUNCTION public.assign_credential_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_num SMALLINT;
  v_kebele_num TEXT;
  v_year SMALLINT;
  v_next INT;
  v_digits TEXT;
  v_check INT;
BEGIN
  IF auth.uid() IS NULL AND NEW.credential_number IS NOT NULL AND NEW.credential_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_numeric_code INTO v_woreda_num FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  SELECT LPAD(kebele_number::TEXT, 2, '0') INTO v_kebele_num FROM public.kebele WHERE kebele_id = NEW.issuing_kebele_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;

  INSERT INTO public.credential_number_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = credential_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  IF v_next > 999999 THEN
    RAISE EXCEPTION 'credential sequence exhausted for woreda % in year %', NEW.woreda_id, v_year;
  END IF;

  v_digits := LPAD(v_woreda_num::TEXT, 2, '0') || v_kebele_num || LPAD(v_year::TEXT, 2, '0') || LPAD(v_next::TEXT, 6, '0');

  -- The card's barcode and the check-digit position both assume exactly this
  -- shape. Fail here rather than print a card that cannot be scanned.
  IF v_digits !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'credential number body must be 12 digits, got "%"', v_digits;
  END IF;

  v_check := public.luhn_check_digit(v_digits);

  NEW.credential_number := LPAD(v_woreda_num::TEXT,2,'0') || '-' || v_kebele_num || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0') || '-' || v_check;
  NEW.serial_number := v_digits;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_credential_request_number()
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
  IF auth.uid() IS NULL AND NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;

  INSERT INTO public.credential_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = credential_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.request_number := v_woreda_code || '-REQ-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_receipt_number()
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
  IF auth.uid() IS NULL AND NEW.receipt_number IS NOT NULL AND NEW.receipt_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  INSERT INTO public.receipt_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = receipt_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.receipt_number := v_woreda_code || '-RCT-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_rental_request_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF auth.uid() IS NULL AND NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.request_type
    WHEN 'new_registration' THEN 'RNT'
    WHEN 'termination' THEN 'VAC'
    ELSE 'REQ'
  END;
  INSERT INTO public.rental_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = rental_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.request_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_resident_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT;
  v_next INTEGER;
  v_format TEXT;
  v_result TEXT;
  v_seq_match TEXT;
  v_seq_width INT;
BEGIN
  IF auth.uid() IS NULL AND NEW.resident_number IS NOT NULL AND NEW.resident_number <> '' AND NEW.resident_number <> 'AUTO' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown woreda %', NEW.woreda_id;
  END IF;

  INSERT INTO public.resident_number_sequence(woreda_id, last_value)
  VALUES (NEW.woreda_id, 1)
  ON CONFLICT (woreda_id)
  DO UPDATE SET last_value = public.resident_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  SELECT resident_number_format INTO v_format
    FROM public.woreda_settings WHERE woreda_id = NEW.woreda_id;

  IF v_format IS NULL OR v_format = '' THEN
    NEW.resident_number := v_code || '-' || LPAD(v_next::TEXT, 6, '0');
    RETURN NEW;
  END IF;

  v_result := v_format;
  v_result := REPLACE(v_result, '{WOREDA_CODE}', v_code);

  v_seq_match := (regexp_match(v_result, '\{SEQ:(\d+)\}'))[1];
  IF v_seq_match IS NOT NULL THEN
    v_seq_width := v_seq_match::INT;
    v_result := regexp_replace(v_result, '\{SEQ:\d+\}', LPAD(v_next::TEXT, v_seq_width, '0'), 'g');
  ELSE
    v_result := REPLACE(v_result, '{SEQ}', v_next::TEXT);
  END IF;

  NEW.resident_number := v_result;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_service_request_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF auth.uid() IS NULL AND NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.category WHEN 'complaint' THEN 'CMP' ELSE 'SRV' END;
  INSERT INTO public.service_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = service_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.request_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_vital_event_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF auth.uid() IS NULL AND NEW.event_number IS NOT NULL AND NEW.event_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.event_type
    WHEN 'birth' THEN 'BR' WHEN 'death' THEN 'DT'
    WHEN 'marriage' THEN 'MR' WHEN 'divorce' THEN 'DV'
    WHEN 'adoption' THEN 'AD'
  END;

  INSERT INTO public.vital_event_sequence(woreda_id, event_type, seq_year, last_value)
  VALUES (NEW.woreda_id, NEW.event_type, v_year, 1)
  ON CONFLICT (woreda_id, event_type, seq_year)
  DO UPDATE SET last_value = vital_event_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.event_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0');
  RETURN NEW;
END;
$function$;

-- 6. kebele is reference data --------------------------------------------------

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'kebele'
                      AND policyname = 'kebele_write_super_admin_' || lower(c)) THEN
      IF c = 'INSERT' THEN
        EXECUTE 'CREATE POLICY kebele_write_super_admin_insert ON public.kebele AS RESTRICTIVE
                   FOR INSERT TO authenticated WITH CHECK (public.is_super_admin())';
      ELSIF c = 'UPDATE' THEN
        EXECUTE 'CREATE POLICY kebele_write_super_admin_update ON public.kebele AS RESTRICTIVE
                   FOR UPDATE TO authenticated USING (public.is_super_admin())
                   WITH CHECK (public.is_super_admin())';
      ELSE
        EXECUTE 'CREATE POLICY kebele_write_super_admin_delete ON public.kebele AS RESTRICTIVE
                   FOR DELETE TO authenticated USING (public.is_super_admin())';
      END IF;
    END IF;
  END LOOP;
END $$;

-- 7. Fee catalog edits are audited -------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_fee_catalog_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id  text;
BEGIN
  IF TG_TABLE_NAME = 'fee_schedule' THEN
    v_id := NEW.fee_schedule_id::text;
    v_new := jsonb_build_object('service_type', NEW.service_type, 'standard_fee', NEW.standard_fee,
                                'penalty_rate', NEW.penalty_rate, 'status', NEW.status,
                                'effective_from', NEW.effective_from);
    IF TG_OP = 'UPDATE' THEN
      v_old := jsonb_build_object('service_type', OLD.service_type, 'standard_fee', OLD.standard_fee,
                                  'penalty_rate', OLD.penalty_rate, 'status', OLD.status,
                                  'effective_from', OLD.effective_from);
    END IF;
  ELSE
    v_id := NEW.service_type_id::text;
    v_new := jsonb_build_object('code', NEW.code, 'fee_amount', NEW.fee_amount,
                                'requires_payment', NEW.requires_payment, 'is_active', NEW.is_active);
    IF TG_OP = 'UPDATE' THEN
      v_old := jsonb_build_object('code', OLD.code, 'fee_amount', OLD.fee_amount,
                                  'requires_payment', OLD.requires_payment, 'is_active', OLD.is_active);
    END IF;
  END IF;
  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.audit_log
    (woreda_id, actor_user_id, entity_name, entity_id, action_type, old_value_json, new_value_json)
  VALUES (NEW.woreda_id, auth.uid(), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP = 'INSERT' THEN 'FEE_CATALOG_ADDED' ELSE 'FEE_CATALOG_CHANGED' END,
          v_old, v_new);
  RETURN NULL;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_fee_catalog_change'
                    AND tgrelid = 'public.fee_schedule'::regclass) THEN
    CREATE TRIGGER audit_fee_catalog_change
      AFTER INSERT OR UPDATE OF service_type, standard_fee, penalty_rate, status, effective_from
      ON public.fee_schedule
      FOR EACH ROW EXECUTE FUNCTION public.audit_fee_catalog_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_fee_catalog_change'
                    AND tgrelid = 'public.service_type'::regclass) THEN
    CREATE TRIGGER audit_fee_catalog_change
      AFTER INSERT OR UPDATE OF code, fee_amount, requires_payment, is_active
      ON public.service_type
      FOR EACH ROW EXECUTE FUNCTION public.audit_fee_catalog_change();
  END IF;
END $$;
