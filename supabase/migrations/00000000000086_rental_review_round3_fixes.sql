-- Kebele Rental Houses Management -- third round of pre-merge fixes, from a
-- final security-focused pass over the full accumulated diff (after 00084
-- and 00085 had already landed).
--
-- 1. guard_rental_payment_status_change() (00085) checked only
--    NEW.payment_type = 'rental_rent', and the trigger fired only on
--    `UPDATE OF status`. Both are bypassable in one PATCH: send
--    {payment_type: 'house_rent', status: 'reversed'} -- NEW.payment_type
--    is no longer 'rental_rent' so the guard never evaluates, and nothing
--    else on this table guards payment_type/amount/payment_date/
--    resident_id for a rental payment. A second, separate PATCH restoring
--    payment_type back to 'rental_rent' changes no status, so that
--    trigger doesn't fire either. Checking OLD.payment_type as well, and
--    widening the trigger to the columns whose desync with rental_payment/
--    rent_payment_settlement/receipt would matter.
--
-- 2. enforce_rental_checkpoint() (00083) returns early whenever
--    NEW.resident_id IS NULL -- but service_request.resident_id is
--    nullable and the new-request form (woreda.services.new.tsx) lets a
--    clerk submit with only a free-text applicant_name, no linked
--    resident, for any category including a gated letter type. A woreda
--    with block_on_rental_arrears=true never actually blocks a gated
--    letter submitted this way, through the ordinary UI, no override
--    needed. Requiring a resident_id for a gated request closes it.
--
-- 3. rental_occupancy's baseline INSERT/UPDATE policies (migration 0) only
--    check woreda_id -- rental.create/rental.approve holders can write
--    status and rent_amount directly, bypassing PD-07 verification, the
--    verification checklist, AF-06's rent-amount requirement, and (via
--    provision_rent_account()/the Phase-2 backfill script) feeding an
--    unvetted rent_amount straight into billing. The only legitimate
--    writer is apply_rental_occupancy_on_approval() (SECURITY DEFINER,
--    bypasses RLS as table owner regardless); no client code selects this
--    table for anything but reads. Matching the SELECT-only pattern this
--    module already uses for rent_account/rent_charge/rental_payment/
--    service_request_checkpoint. DELETE stays as-is (tenant.manage,
--    already narrowly scoped, unused by any current UI per AF-11).
--
-- 4. resolve_reconciliation_exception() (00079) let the same actor both
--    create a mismatch (via settle_rent_payment(), gated on rental.collect)
--    and resolve it (gated on rental.settle) -- finance_clerk holds both.
--    A clerk pocketing a shortfall could open the exception and then
--    close it themselves with no independent check. Requiring the
--    resolver differ from the exception's own creator.
--
-- 5. provision_rent_account()'s kebele lookup (00085 fix 4) silently
--    inserts a NULL kebele_id if no matching row is found, instead of
--    raising like every other lookup in this function. With (3) closing
--    the path that could produce a cross-tenant-shaped rental_occupancy
--    row in the first place, this is now unreachable in practice, but
--    it's the same "silent success on bad data" shape the rest of this
--    function is careful to avoid. Raising instead.
--
-- ADDITIVE. No DROP of any table, column, or constraint (rental_occupancy's
-- INSERT/UPDATE policies are replaced with none, per (3); no schema object
-- is dropped).
-- ---------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- 1. Widen the rental payment guard to survive a payment_type swap and to
--    cover the other columns that must stay in lockstep with
--    rental_payment/rent_payment_settlement/receipt.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_rental_payment_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (OLD.payment_type = 'rental_rent' OR NEW.payment_type = 'rental_rent')
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id
     )
     AND coalesce(current_setting('app.system_transition', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'guard_rental_payment_status_change: a rental payment''s type, status, amount, date, payer, or woreda can only change through reverse_rental_payment()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS yy_guard_rental_payment_status_change ON public.payment;
CREATE TRIGGER yy_guard_rental_payment_status_change
  BEFORE UPDATE OF status, payment_type, amount, payment_date, resident_id, woreda_id ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.guard_rental_payment_status_change();

-- ============================================================================
-- 2. A gated request must actually name a resident -- otherwise the
--    checkpoint has nothing to resolve against and silently passes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_rental_checkpoint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gated boolean;
  v_checkpoint jsonb;
  v_policy_exempt boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.service_type_id IS NOT DISTINCT FROM OLD.service_type_id
       AND NEW.resident_id IS NOT DISTINCT FROM OLD.resident_id
       AND NEW.checkpoint_override IS NOT DISTINCT FROM OLD.checkpoint_override
       AND NEW.checkpoint_override_reason IS NOT DISTINCT FROM OLD.checkpoint_override_reason
    THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT rental_checkpoint_gated INTO v_gated
    FROM public.service_type WHERE service_type_id = NEW.service_type_id AND woreda_id = NEW.woreda_id;

  IF NOT COALESCE(v_gated, false) THEN
    NEW.checkpoint_override := false;
    NEW.checkpoint_override_reason := NULL;
    RETURN NEW;
  END IF;

  -- Round-3 fix: a gated request submitted with no linked resident
  -- (free-text applicant_name only) previously skipped the checkpoint
  -- entirely, the same as a non-gated type -- silently defeating
  -- block_on_rental_arrears whenever a request isn't linked to a resident
  -- record.
  IF NEW.resident_id IS NULL THEN
    RAISE EXCEPTION
      'ይህ የደብዳቤ አይነት የተከራይ ማንነት ማረጋገጫ ስለሚያስፈልገው ነዋሪ መያያዝ አለበት / This letter type requires rental standing verification -- a linked resident is required'
      USING ERRCODE = 'check_violation';
  END IF;

  v_checkpoint := public.resolve_rental_checkpoint_core(NEW.resident_id);

  IF NOT COALESCE((v_checkpoint ->> 'would_block')::boolean, false) THEN
    NEW.checkpoint_override := false;
    NEW.checkpoint_override_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.checkpoint_override THEN
    SELECT emergency_exemption INTO v_policy_exempt
      FROM public.rental_policy WHERE woreda_id = NEW.woreda_id;

    IF NOT COALESCE(v_policy_exempt, false) THEN
      RAISE EXCEPTION
        'ይህ ወረዳ የአስቸኳይ ጊዜ ማለፊያ አይፈቅድም / This woreda does not allow an emergency checkpoint override'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['service.checkpoint_override'])) THEN
      RAISE EXCEPTION 'enforce_rental_checkpoint: permission denied to override'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.checkpoint_override_reason IS NULL OR length(trim(NEW.checkpoint_override_reason)) = 0 THEN
      RAISE EXCEPTION
        'ማለፊያውን ለምን እንደተጠቀሙ ምክንያት ያስፈልጋል / A reason is required to override this checkpoint'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ይህ አመልካች/ቤተሰብ ያልተከፈለ የኪራይ ዕዳ አለበት፣ ይህ ጥያቄ በፖሊሲ ታግዷል / This applicant''s household has unresolved rental arrears and this request is blocked by policy'
    USING ERRCODE = 'check_violation';
END;
$function$;

-- ============================================================================
-- 3. rental_occupancy: SELECT-only for clients. The only legitimate
--    writer is apply_rental_occupancy_on_approval() (SECURITY DEFINER,
--    unaffected by narrowing the client-facing policy).
-- ============================================================================

DROP POLICY IF EXISTS rental_occupancy_insert ON public.rental_occupancy;
DROP POLICY IF EXISTS rental_occupancy_update ON public.rental_occupancy;

-- ============================================================================
-- 4. resolve_reconciliation_exception(): the resolver may not be the same
--    actor who created the exception.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_reconciliation_exception(
  _exception_id uuid,
  _status text,
  _resolution_note text
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_id uuid := get_user_woreda_id();
  v_actor uuid := auth.uid();
  v_owner_woreda uuid;
  v_current_status text;
  v_created_by uuid;
BEGIN
  IF v_woreda_id IS NULL THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: caller has no woreda context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (is_super_admin() OR user_has_any_perm(ARRAY['rental.settle'])) THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: permission denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _status NOT IN ('under_review', 'resolved', 'rejected') THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: invalid status' USING ERRCODE = 'check_violation';
  END IF;

  SELECT woreda_id, status, created_by INTO v_owner_woreda, v_current_status, v_created_by
    FROM public.payment_reconciliation_exception WHERE exception_id = _exception_id;
  IF NOT FOUND OR v_owner_woreda <> v_woreda_id THEN
    RAISE EXCEPTION 'resolve_reconciliation_exception: exception not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'ይህ ጉዳይ ቀድሞ ተፈትቷል -- ተጨማሪ ለውጥ አይፈቀድም / This exception is already resolved -- no further change is allowed'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT is_super_admin() AND v_actor IS NOT NULL AND v_actor = v_created_by THEN
    RAISE EXCEPTION
      'ይህን ልዩነት የከፈተው ተመሳሳይ ሠራተኛ ራሱ ሊፈታው አይችልም / The staff member who recorded this exception cannot also resolve it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.payment_reconciliation_exception
     SET status = _status,
         resolution_note = _resolution_note,
         resolved_by = v_actor,
         resolved_at = now()
   WHERE exception_id = _exception_id;

  INSERT INTO public.audit_log (woreda_id, actor_user_id, entity_name, entity_id, action_type, new_value_json)
  VALUES (v_woreda_id, v_actor, 'payment_reconciliation_exception', _exception_id::text,
    'RECONCILIATION_EXCEPTION_RESOLVED', jsonb_build_object('status', _status, 'note', _resolution_note));
END;
$function$;

-- ============================================================================
-- 5. provision_rent_account(): raise rather than silently insert a NULL
--    kebele_id.
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
    FROM public.kebele_rental_house
   WHERE rental_house_id = v_occ.rental_house_id AND woreda_id = v_occ.woreda_id;

  IF v_kebele_id IS NULL THEN
    RAISE EXCEPTION 'provision_rent_account: rental house not found in this woreda' USING ERRCODE = 'no_data_found';
  END IF;

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
    jsonb_build_object(
      'occupancy_id', _occupancy_id,
      'billing_start_period_key', _billing_start_period_key,
      'monthly_amount', v_occ.rent_amount
    ));

  RETURN v_new_id;
END;
$function$;

COMMIT;
