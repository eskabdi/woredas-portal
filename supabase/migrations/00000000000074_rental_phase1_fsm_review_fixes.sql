-- Kebele Rental Houses Management -- Phase 1 FSM review fixes.
--
-- The workflow-fsm-review agent found two HIGH-severity gaps in
-- 00000000000072/73 and one medium one; this migration closes all three.
-- ADDITIVE. 00072/73 are never edited in place, per this repo's
-- forward-only migration rule.

BEGIN;

-- ----------------------------------------------------------------------
-- 1. (HIGH) PD-07's self-verification guard compared NEW.verified_by_user_id
-- to NEW.requested_by_user_id, but a client PATCH that omits
-- verified_by_user_id (or resends its current value unchanged) leaves that
-- column exactly as it already was -- force_actor_columns() only
-- overwrites a value the client actually CHANGES, and PostgREST only
-- includes columns present in the request body in the UPDATE's SET clause.
-- Two real exploits followed from this:
--
--   a) A first verify with the actor column simply omitted left
--      verified_by_user_id NULL, so the "IS NOT NULL AND ... = requested_by"
--      guard never fired at all -- the submitting clerk could self-verify.
--   b) On the new verified -> approval_returned -> under_review loop
--      (PD-09), a stale verified_by_user_id from a PRIOR verification survives
--      the round trip untouched (nothing clears it, and
--      enforce_workflow_transition() deliberately forbids clearing it once
--      set). The original submitter could then move the request back to
--      'verified' with a bare status PATCH, and the guard would compare the
--      stale prior verifier against requested_by -- passing even though the
--      submitter, not that prior verifier, drove this re-verification.
--
-- Fixed by requiring the column to equal the actual caller (auth.uid()) on
-- every fresh transition into 'verified', not merely comparing whatever
-- ended up in NEW against requested_by. This makes the value unforgeable
-- (the client cannot set auth.uid() to anyone but themselves) and makes
-- omission itself a hard failure instead of a silent pass-through -- both
-- exploits above now raise. auth.uid() IS NULL is exempted (no rental
-- approval path runs from a non-authenticated/system context today, but
-- this mirrors force_actor_columns()'s own "IF uid IS NULL THEN RETURN"
-- convention rather than assuming that stays true forever).
--
-- 2. (MEDIUM) The AF-06 rent-amount check fired on every UPDATE of a
-- non-draft new_registration row, not just forward progress -- so any row
-- that already had a NULL/zero rent_amount (there was no CHECK on this
-- table before 00072) became permanently wedged: unable to be verified,
-- returned, approved, OR REJECTED, since rejection also sets a non-draft
-- status. Rescoped to only the statuses that represent forward progress
-- (submitted/under_review/verified/approved) so a bad legacy row can still
-- be returned or rejected out of the queue -- mirrors
-- enforce_rental_request_eligibility()'s own documented precedent of
-- checking at submission, not on every later transition.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_rental_request_integrity_guards()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_status := OLD.status;
  END IF;

  -- AF-06: only the forward-progress statuses require a valid rent amount.
  -- 'returned', 'approval_returned' and 'rejected' must stay reachable even
  -- from a row that predates this check.
  IF NEW.request_type = 'new_registration'
     AND NEW.status IN ('submitted', 'under_review', 'verified', 'approved')
     AND (NEW.rent_amount IS NULL OR NEW.rent_amount <= 0) THEN
    RAISE EXCEPTION
      'ትክክለኛ የቤት ኪራይ ዋጋ ያስፈልጋል / A valid rent amount is required to submit this request';
  END IF;

  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'verified') THEN
    -- Closes the omission/staleness exploit described above: the column
    -- must equal the real caller on every fresh entry into 'verified'.
    IF auth.uid() IS NOT NULL AND NEW.verified_by_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'ማረጋገጫውን የፈጸመው ተጠቃሚ በትክክል መመዝገብ አለበት / verified_by_user_id must be the user actually performing this verification';
    END IF;

    -- PD-07: the clerk who submitted a request may not also verify it --
    -- mirrors the maker<>checker rule enforce_workflow_transition() already
    -- applies between verified_by_user_id and approved_by_user_id. Now that
    -- verified_by_user_id is pinned to the real caller above, this
    -- comparison can no longer be defeated by omitting the column.
    IF NEW.verified_by_user_id IS NOT NULL
       AND NEW.verified_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION
        'ጥያቄውን ያቀረበው ሠራተኛ ራሱ ማረጋገጥ አይችልም / The clerk who submitted this request cannot also verify it';
    END IF;

    -- AF-08: the four-item verification checklist is re-checked
    -- server-side against the actual NEW row, not trusted from whatever
    -- the client claims it sent.
    IF NOT (COALESCE(NEW.verification_checklist, '{}'::jsonb) @> '{
      "identity_verified": true, "house_available": true,
      "rent_amount_confirmed": true, "documents_complete": true
    }'::jsonb) THEN
      RAISE EXCEPTION
        'ሁሉንም የማረጋገጫ ዝርዝሮች ማጠናቀቅ ያስፈልጋል / All verification checklist items must be completed';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------
-- 3. (low, hardening) apply_rental_occupancy_on_approval() cleared
-- app.system_transition to '' rather than restoring whatever value was
-- already set on entry. No rental approval path runs from inside another
-- system transition today, so this had no live effect, but it is a latent
-- footgun the moment one ever does (the GUC is shared with
-- enforce_workflow_transition()'s own is_system bypass). Capture and
-- restore instead of clobbering.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_occupancy_id UUID;
  v_terminated_count INT;
  v_prev_system_transition text := current_setting('app.system_transition', true);
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

      -- No WHERE to scope here: woreda_id is taken literally from
      -- NEW.woreda_id, not looked up by a bare foreign id.
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
      PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active' AND woreda_id = NEW.woreda_id;

      GET DIAGNOSTICS v_terminated_count = ROW_COUNT;
      IF v_terminated_count = 0 THEN
        RAISE EXCEPTION
          'ውሉ ማቋረጥ አልተቻለም -- ኪራዩ ንቁ ላይሆን ወይም ለዚህ ተከራይ ላይሆን ይችላል / Cannot terminate -- the occupancy is no longer active or does not belong to this tenant';
      END IF;

      PERFORM set_config('app.system_transition', 'on', true);
      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id AND woreda_id = NEW.woreda_id;
      PERFORM set_config('app.system_transition', coalesce(v_prev_system_transition, ''), true);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------
-- Documented, not fixed here (deliberate):
--
-- - PD-07 raises the minimum distinct-actor count to complete a rental
--   request from 2 to 3 (submitter, verifier, approver, all different).
--   This is the plan's own signed-off default (docs/rental-policy-decisions.md,
--   PD-07) and the review's staffing-math concern is a real operational
--   risk for a woreda with exactly one registry_clerk and one tenant_admin
--   and no supervisor -- logged as a residual risk in that same file rather
--   than silently relaxed here.
-- - 'approved' is terminal for rental_occupancy_request only by the
--   absence of an outbound workflow_transition row, not by
--   enforce_workflow_transition()'s terminal-state array -- that array is
--   shared across four entities (credential_request, vital_event,
--   service_request, rental_occupancy_request) with different real
--   terminal states (vital_event's own 'approved' legitimately continues to
--   'awaiting_payment'), so adding 'approved' there would break vital_event.
--   No outbound row exists today; flagged for whoever next touches this
--   entity's workflow_transition seed, not fixed here.
-- ----------------------------------------------------------------------

COMMIT;
