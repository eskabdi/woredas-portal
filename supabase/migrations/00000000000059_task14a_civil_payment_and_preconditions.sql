-- Task 14-A (fix-task-production-readiness-v3), part 2: payment integration,
-- the paid -> registered system transition, side-effect timing move (B2),
-- and event-type pre-conditions for vital_event. See
-- docs/task14a-mapping-memo.md sections 3, 5, 6, 7 for the full design.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. vital_event.payment_id -- mirrors credential_request.payment_id
--    exactly (same nullable FK, same "app sets it before the paid
--    transition" pattern the payment gate below checks).
-- ---------------------------------------------------------------------------

ALTER TABLE public.vital_event ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payment(payment_id);

-- ---------------------------------------------------------------------------
-- 2. payment table extended for vital_event, additively. Two CHECK
--    constraints widened as strict supersets (zero existing rows affected,
--    confirmed live before this migration was written):
--      - amount > 0  ->  amount >= 0   (B2's zero-fee rule requires this)
--      - payment_type gains 'civil_registration_fee'
--    payment_source_exclusive_check gains a clause for the new column only
--    -- the existing credential/rental clause is untouched.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment ADD COLUMN IF NOT EXISTS vital_event_id uuid REFERENCES public.vital_event(vital_event_id);

ALTER TABLE public.payment DROP CONSTRAINT payment_amount_check;
ALTER TABLE public.payment ADD CONSTRAINT payment_amount_check CHECK (amount >= 0);

-- payment_amount_sync() (Task 6/23's PII-encryption trigger) independently
-- re-enforces amount > 0 before encrypting it -- found live while dry-
-- running a zero-fee payment probe. Same widening as the CHECK constraint
-- above, same reasoning: B2's zero-fee rule needs amount = 0 to be legal.
CREATE OR REPLACE FUNCTION public.payment_amount_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.amount IS NOT NULL AND NEW.amount < 0 THEN
    RAISE EXCEPTION 'payment.amount must not be negative';
  END IF;
  NEW.amount_enc := public.encrypt_pii_numeric(NEW.amount, NEW.woreda_id);
  RETURN NEW;
END;
$function$;

ALTER TABLE public.payment DROP CONSTRAINT payment_payment_type_check;
ALTER TABLE public.payment ADD CONSTRAINT payment_payment_type_check
  CHECK (payment_type = ANY (ARRAY[
    'service_fee', 'house_rent', 'penalty', 'credential_fee', 'rental_rent',
    'civil_registration_fee'
  ]));

ALTER TABLE public.payment DROP CONSTRAINT payment_source_exclusive_check;
ALTER TABLE public.payment ADD CONSTRAINT payment_source_exclusive_check
  CHECK (
    (NOT (credential_request_id IS NOT NULL AND rental_request_id IS NOT NULL))
    AND (NOT (
      vital_event_id IS NOT NULL AND (
        credential_request_id IS NOT NULL OR rental_request_id IS NOT NULL OR service_request_id IS NOT NULL
      )
    ))
  );

-- ---------------------------------------------------------------------------
-- 3. Side-effect timing move (B2): the resident-affecting side effects now
--    fire at 'registered', not 'approved'. Tenant-scoping and idempotency
--    are unchanged from the existing bodies -- only the status literal in
--    the guard moves.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_death_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason TEXT;
BEGIN
  IF NEW.event_type = 'death' AND NEW.status = 'registered' AND (OLD.status IS DISTINCT FROM 'registered') THEN
    v_reason := 'Resident deceased (event ' || NEW.event_number || ')';

    UPDATE public.resident
    SET residency_status = 'deceased'
    WHERE resident_id = NEW.resident_id AND woreda_id = NEW.woreda_id;

    UPDATE public.residence_credential
    SET status = 'revoked', revoked_at = NOW(), revoked_reason = v_reason
    WHERE resident_id = NEW.resident_id AND status = 'active' AND woreda_id = NEW.woreda_id;

    INSERT INTO public.credential_status_history (credential_id, old_status, new_status, change_reason)
    SELECT credential_id, 'active', 'revoked', v_reason
    FROM public.residence_credential
    WHERE resident_id = NEW.resident_id AND status = 'revoked' AND revoked_reason = v_reason
      AND woreda_id = NEW.woreda_id;

    INSERT INTO public.audit_log (entity_name, entity_id, action_type, new_value_json)
    SELECT 'residence_credential', credential_id, 'CREDENTIAL_REVOKED', jsonb_build_object('reason', v_reason)
    FROM public.residence_credential
    WHERE resident_id = NEW.resident_id AND revoked_reason = v_reason
      AND woreda_id = NEW.woreda_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_resident_on_birth_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d JSONB;
  v_mother_id UUID;
  v_mother_ethnicity TEXT;
  v_mother_religion TEXT;
  v_mother_household_id UUID;
  v_full_name_am TEXT;
  v_new_resident_id UUID;
BEGIN
  IF NEW.event_type = 'birth' AND NEW.status = 'registered' AND (OLD.status IS DISTINCT FROM 'registered')
     AND NEW.resident_id IS NULL THEN
    d := NEW.event_details;
    v_mother_id := NULLIF(d->>'mother_resident_id', '')::UUID;

    IF v_mother_id IS NOT NULL THEN
      SELECT ethnicity, religion, current_household_id
      INTO v_mother_ethnicity, v_mother_religion, v_mother_household_id
      FROM public.resident WHERE resident_id = v_mother_id;
    END IF;

    v_full_name_am := trim(concat_ws(' ', d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name'));

    -- marital_status is NOT NULL on resident with no default -- this INSERT
    -- never set it, so this side effect has been broken since the column
    -- was added (found live while probing this migration: 0 vital_event
    -- rows ever existed in production, so this INSERT had never actually
    -- executed until now). 'single' for a newborn is the only value that
    -- makes sense; fixed here alongside the status-guard move since both
    -- touch this same function body.
    INSERT INTO public.resident (
      woreda_id, first_name, father_name, grandfather_name,
      full_name_am, full_name, sex, date_of_birth, mother_full_name,
      ethnicity, religion, current_household_id, active_flag, residency_status,
      marital_status
    ) VALUES (
      NEW.woreda_id, d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name',
      v_full_name_am,
      COALESCE(NULLIF(d->>'child_full_name_en', ''), v_full_name_am),
      d->>'sex', NEW.event_date,
      COALESCE(d->>'mother_name', (SELECT full_name_am FROM public.resident WHERE resident_id = v_mother_id)),
      COALESCE(v_mother_ethnicity, d->>'ethnicity'),
      COALESCE(v_mother_religion, d->>'religion'),
      v_mother_household_id, true, 'active',
      'single'
    )
    RETURNING resident_id INTO v_new_resident_id;

    NEW.resident_id := v_new_resident_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Payment gate + the system transition itself. Mirrors
--    generate_residence_credential_on_payment()'s gate shape exactly.
--    zzz_ prefix so it runs after zz_enforce_workflow_transition (the
--    generic FSM/permission check runs first).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_vital_event_payment_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipted BOOLEAN;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    IF OLD.status IS DISTINCT FROM 'awaiting_payment' THEN
      RAISE EXCEPTION
        'payment: a vital event may only be paid from awaiting_payment (was %)', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.payment p
        JOIN public.receipt r ON r.payment_id = p.payment_id
       WHERE p.payment_id = NEW.payment_id
         AND p.woreda_id = NEW.woreda_id
         AND p.status = 'confirmed'
    ) INTO v_receipted;

    IF NEW.payment_id IS NULL OR NOT v_receipted THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ክፍያ ወይም ደረሰኝ አልተገኘም / A confirmed payment with a receipt is required before registration can be finalized -- even a free registration must write a zero-value payment and receipt.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_enforce_vital_event_payment_gate ON public.vital_event;
CREATE TRIGGER zzz_enforce_vital_event_payment_gate
  BEFORE UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vital_event_payment_gate();

CREATE OR REPLACE FUNCTION public.advance_vital_event_to_registered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    PERFORM set_config('app.system_transition', 'on', true);
    UPDATE public.vital_event SET status = 'registered' WHERE vital_event_id = NEW.vital_event_id;
    PERFORM set_config('app.system_transition', '', true);
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.advance_vital_event_to_registered() IS
  'The first real is_system transition driver in this codebase -- the '
  'workflow_transition.is_system column and app.system_transition GUC check '
  'in enforce_workflow_transition() existed since migration 00000000000025 '
  'but nothing ever set the GUC before this. A user can never reach '
  '''registered'' directly: no seeded transition exists into it for any '
  'permission, and the GUC is only ever set inside this SECURITY DEFINER '
  'function body, never from a client request.';

DROP TRIGGER IF EXISTS zzz_advance_vital_event_to_registered ON public.vital_event;
CREATE TRIGGER zzz_advance_vital_event_to_registered
  AFTER UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.advance_vital_event_to_registered();

-- ---------------------------------------------------------------------------
-- 5. Event-type pre-conditions, fail-closed, tenant-scoped, bilingual.
--    None of these existed before this migration.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_vital_event_preconditions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d JSONB := NEW.event_details;
  v_spouse1_id UUID;
  v_spouse2_id UUID;
BEGIN
  -- The system-driven paid -> registered transition (advance_vital_event_to_
  -- registered()) re-fires this BEFORE trigger on its own nested UPDATE.
  -- By that point trg_apply_death_on_approval has already run (same timing
  -- group, fires first: 'apply' < 'enforce' alphabetically) and legitimately
  -- flipped the resident to deceased -- so re-checking "resident is not
  -- already deceased" here would reject the very transition that finalizes
  -- that death. Every precondition was already enforced when this event was
  -- first submitted/reviewed; the system transition re-validates nothing.
  IF current_setting('app.system_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'birth' THEN
    IF NEW.household_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'የቤተሰብ ትስስር ያስፈልጋል / A birth registration requires a linked household.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.household h
       WHERE h.household_id = NEW.household_id AND h.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ቤተሰቡ በዚህ ወረዳ አልተገኘም / The linked household does not belong to this woreda.';
    END IF;
  END IF;

  IF NEW.event_type = 'death' AND NEW.resident_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.resident r
       WHERE r.resident_id = NEW.resident_id AND r.woreda_id = NEW.woreda_id
         AND r.active_flag = true AND r.residency_status <> 'deceased'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ነዋሪው ንቁ ወይም አስቀድሞ የሞተ ነው / The resident is not active, or is already recorded as deceased.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.vital_event ve
       WHERE ve.resident_id = NEW.resident_id
         AND ve.event_type = 'death'
         AND ve.vital_event_id <> NEW.vital_event_id
         AND ve.woreda_id = NEW.woreda_id
         AND ve.status NOT IN ('rejected', 'returned', 'approval_returned')
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ለዚህ ነዋሪ ቀደም ያለ የሞት ምዝገባ ክፍት ነው / An open death registration already exists for this resident.';
    END IF;
  END IF;

  IF NEW.event_type = 'marriage' THEN
    v_spouse1_id := NULLIF(d #>> '{spouse1,resident_id}', '')::UUID;
    v_spouse2_id := NULLIF(d #>> '{spouse2,resident_id}', '')::UUID;

    IF v_spouse1_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.resident r WHERE r.resident_id = v_spouse1_id AND r.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ተጋቢ 1 በዚህ ወረዳ አልተገኘም / Party 1 does not resolve to a resident of this woreda.';
    END IF;
    IF v_spouse2_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.resident r WHERE r.resident_id = v_spouse2_id AND r.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ተጋቢ 2 በዚህ ወረዳ አልተገኘም / Party 2 does not resolve to a resident of this woreda.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_vital_event_preconditions ON public.vital_event;
CREATE TRIGGER trg_enforce_vital_event_preconditions
  BEFORE INSERT OR UPDATE ON public.vital_event
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vital_event_preconditions();

-- ---------------------------------------------------------------------------
-- 6. Zero-fee civil registration fee catalog -- three NEW, distinctly-named
--    rows (never the existing non-zero "Birth Certificate"/"Death
--    Certificate"/"Marriage Registration" rows, which price the 14-B
--    certificate/letter service, not this registration event). Amount 0,
--    woreda-adjustable in Settings like any other fee_schedule row.
-- ---------------------------------------------------------------------------

INSERT INTO public.fee_schedule (woreda_id, service_type, standard_fee, penalty_rate, status, effective_from)
SELECT w.woreda_id, st.service_type, 0, 0, 'active', current_date
  FROM public.woreda w
 CROSS JOIN (VALUES
    ('Civil Registration - Birth'),
    ('Civil Registration - Death'),
    ('Civil Registration - Marriage')
  ) AS st(service_type)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.fee_schedule fs
    WHERE fs.woreda_id = w.woreda_id AND fs.service_type = st.service_type
 );

-- ---------------------------------------------------------------------------
-- 7. Fee resolver -- same fail-closed, tenant-internal pattern as
--    resolve_credential_fee() (00000000000054). A missing/inactive row
--    raises rather than silently defaulting to zero, so the zero-fee rule
--    is a real, verifiable catalog entry -- not an absence of one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_civil_fee(_event_type text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_service_type text;
  v_amount numeric;
BEGIN
  v_service_type := CASE _event_type
    WHEN 'birth' THEN 'Civil Registration - Birth'
    WHEN 'death' THEN 'Civil Registration - Death'
    WHEN 'marriage' THEN 'Civil Registration - Marriage'
    ELSE NULL
  END;

  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'resolve_civil_fee: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_service_type IS NULL THEN
    RAISE EXCEPTION 'resolve_civil_fee: unknown event_type %', _event_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['civil.read', 'civil.record_payment'])) THEN
    RAISE EXCEPTION 'resolve_civil_fee: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT fs.standard_fee INTO v_amount
    FROM public.fee_schedule fs
   WHERE fs.woreda_id = v_woreda_id
     AND fs.service_type = v_service_type
     AND fs.status = 'active'
     AND (fs.effective_from IS NULL OR fs.effective_from <= current_date)
   ORDER BY fs.effective_from DESC NULLS LAST
   LIMIT 1;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = format(
        'ክፍያ መርሃ ግብር አልተገኘም ለ "%s" / No active fee schedule found for "%s" — an administrator must add or activate it in Settings.',
        v_service_type, v_service_type
      ),
      DETAIL = v_service_type;
  END IF;

  RETURN v_amount;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_civil_fee(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_civil_fee(text) TO authenticated, service_role;

COMMIT;
