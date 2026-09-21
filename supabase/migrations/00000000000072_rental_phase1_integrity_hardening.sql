-- Kebele Rental Houses Management -- Phase 1 (integrity hardening).
--
-- Grounded in Kebele_Rental_Houses_Management_Implementation_Plan.md Part A
-- section 6.3 (audit-findings disposition register) and section 38 (Phase 1
-- scope: "the audit's findings; no new features"). Closes AF-01, AF-02,
-- AF-06, AF-07, AF-08, AF-10, AF-11, plus the two workflow decisions Phase 0
-- signed off (docs/rental-policy-decisions.md): PD-07 (self-verification)
-- and PD-09 (the verified -> returned edge).
--
-- AF-03 (the .select().maybeSingle() sweep) and AF-04 (phantom intake
-- fields) are frontend-only fixes and land in the same commit as this
-- migration but touch no schema.
--
-- ADDITIVE. No DROP of any table or column. The two DROP CONSTRAINT calls
-- below immediately re-add a superset CHECK (the same pattern
-- 00000000000037 uses for its policies) -- every value legal today stays
-- legal.

BEGIN;

-- ----------------------------------------------------------------------
-- AF-10 (Phase 1.8): updated_at triggers. Both tables already carry the
-- column (confirmed against the live schema) but nothing ever wrote to it.
-- ----------------------------------------------------------------------

DROP TRIGGER IF EXISTS kebele_rental_house_set_updated_at ON public.kebele_rental_house;
CREATE TRIGGER kebele_rental_house_set_updated_at
  BEFORE UPDATE ON public.kebele_rental_house
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS rental_occupancy_set_updated_at ON public.rental_occupancy;
CREATE TRIGGER rental_occupancy_set_updated_at
  BEFORE UPDATE ON public.rental_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------
-- AF-11 (Phase 1.9): archive pattern. Widens the occupancy_status CHECK to
-- a superset that also allows 'archived'; nothing writes it yet (no Delete
-- action exists in the UI today -- confirmed, this bucket has never been
-- wired to a delete button), but the column can now represent it instead of
-- the only removal path being tenant.manage's hard DELETE. The guard below
-- (AF-01) already blocks setting any occupancy_status, archived included,
-- while an active occupancy exists, so a house cannot be archived out from
-- under a live tenancy.
-- ----------------------------------------------------------------------

ALTER TABLE public.kebele_rental_house
  DROP CONSTRAINT kebele_rental_house_occupancy_status_check;
ALTER TABLE public.kebele_rental_house
  ADD CONSTRAINT kebele_rental_house_occupancy_status_check
    CHECK (occupancy_status = ANY (ARRAY['vacant', 'occupied', 'under_maintenance', 'archived']));

-- ----------------------------------------------------------------------
-- AF-01 (Phase 1.1, CRITICAL): occupancy_status becomes trigger-maintained
-- only. A BEFORE UPDATE guard rejects any change to it while an active
-- occupancy exists on that house, unless the write comes from inside a
-- system transition (app.system_transition GUC -- the same bypass pattern
-- 00000000000059's advance_vital_event_to_registered() already uses).
-- apply_rental_occupancy_on_approval() below is the only legitimate writer
-- and is updated in the same migration to set that GUC around its own
-- writes. The partial unique index on rental_occupancy remains the
-- structural backstop this was already relying on.
--
-- The EXISTS check filters on woreda_id, not just rental_house_id: unlike
-- rental_occupancy_request (guarded by assert_rental_request_woreda_consistency(),
-- 00000000000032/33), rental_occupancy itself has no trigger tying its
-- rental_house_id to its own woreda_id, and its RLS INSERT policy only
-- checks woreda_id = get_user_woreda_id() -- so without this filter, a
-- cross-tenant-inconsistent row (an existing, pre-Phase-1 data-integrity
-- gap this migration does not otherwise touch) could make this guard block
-- edits on a house belonging to a different tenant than the occupancy row.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_manual_occupancy_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.occupancy_status IS DISTINCT FROM OLD.occupancy_status
     AND coalesce(current_setting('app.system_transition', true), '') <> 'on' THEN
    IF EXISTS (
      SELECT 1 FROM public.rental_occupancy
       WHERE rental_house_id = NEW.rental_house_id AND status = 'active'
         AND woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION
        'ንቁ ኪራይ ስላለ የቤት ሁኔታን በእጅ መቀየር አይቻልም -- መጀመሪያ ኪራዩን ማቋረጥ ማፅደቅ ያስፈልጋል / Cannot manually change occupancy status while an active occupancy exists -- approve a termination first';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_guard_manual_occupancy_status ON public.kebele_rental_house;
CREATE TRIGGER zz_guard_manual_occupancy_status
  BEFORE UPDATE ON public.kebele_rental_house
  FOR EACH ROW EXECUTE FUNCTION public.guard_manual_occupancy_status_change();

-- ----------------------------------------------------------------------
-- AF-02 (Phase 1.2, HIGH): approving a new_registration into a house that
-- already carries an active occupancy used to silently terminate that
-- occupancy (a defensive close, with only a client-side warning standing in
-- the way -- src/routes/woreda.rental-houses.requests.$requestId.index.tsx's
-- own guard is advisory only). Raises instead: tenant replacement is not a
-- first-class workflow yet (plan section 27) -- the existing occupancy must
-- go through the termination workflow and be approved first.
--
-- Also wraps both occupancy_status writes in the app.system_transition GUC
-- (AF-01 above) since this function is now the sole legitimate writer of
-- that column.
-- ----------------------------------------------------------------------

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
      PERFORM set_config('app.system_transition', '', true);

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
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

-- ----------------------------------------------------------------------
-- AF-06 (Phase 1.5), AF-08 (Phase 1.7), PD-07 (Phase 0 sign-off): three
-- server-side checks on rental_occupancy_request, combined into one guard
-- since all three fire off the same status transitions.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_rental_request_integrity_guards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_status := OLD.status;
  END IF;

  -- AF-06: a new_registration leaving draft (the intake form inserts
  -- directly at 'submitted', never starting at 'draft') must carry a
  -- positive rent amount. Catches the bad row at submission instead of
  -- letting COALESCE(NEW.rent_amount, 0) fail opaquely against
  -- rental_occupancy_rent_amount_check when the request is later approved.
  IF NEW.request_type = 'new_registration' AND NEW.status <> 'draft'
     AND (NEW.rent_amount IS NULL OR NEW.rent_amount <= 0) THEN
    RAISE EXCEPTION
      'ትክክለኛ የቤት ኪራይ ዋጋ ያስፈልጋል / A valid rent amount is required to submit this request';
  END IF;

  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM 'verified') THEN
    -- PD-07: the clerk who submitted a request may not also verify it --
    -- mirrors the maker<>checker rule enforce_workflow_transition() already
    -- applies between verified_by_user_id and approved_by_user_id.
    -- verified_by_user_id/requested_by_user_id are both server-forced by
    -- trg_force_actor, so this comparison cannot be spoofed by the client.
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

DROP TRIGGER IF EXISTS zz_enforce_rental_request_integrity ON public.rental_occupancy_request;
CREATE TRIGGER zz_enforce_rental_request_integrity
  BEFORE INSERT OR UPDATE ON public.rental_occupancy_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rental_request_integrity_guards();

-- ----------------------------------------------------------------------
-- PD-09 (Phase 0 sign-off): the verified -> returned edge, mirroring civil
-- registration's verified -> pending_approval -> returned -> under_review
-- shape. Renamed 'approval_returned' here since 'returned' already means
-- the clerk-level return-to-submitter and the CHECK constraint already
-- reserves 'approval_returned' for exactly this (AF-18: previously
-- CHECK-legal but unreachable). rental_occupancy_request has no separate
-- pending_approval hop -- 'verified' is itself the approver's queue state
-- -- so the approver acts on 'verified' directly, same as the existing
-- verified -> approved / verified -> rejected rows.
-- ----------------------------------------------------------------------

INSERT INTO public.workflow_transition (entity, from_status, to_status, required_permission, is_system)
VALUES
  ('rental_occupancy_request', 'verified', 'approval_returned', 'rental.approve', false),
  ('rental_occupancy_request', 'approval_returned', 'under_review', 'rental.create', false)
ON CONFLICT (entity, from_status, to_status) DO NOTHING;

-- ----------------------------------------------------------------------
-- AF-07 (Phase 1.6): bucket-level MIME/size enforcement. Matches the
-- client's own accept lists in
-- src/routes/woreda.rental-houses.occupants.new.tsx's UPLOAD_TILES exactly
-- (application/pdf, image/jpeg, image/png; the largest per-tile limit is
-- 5MB) -- previously NULL/NULL, i.e. client-side enforcement only.
-- ----------------------------------------------------------------------

UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id = 'rental-request-documents';

COMMIT;
