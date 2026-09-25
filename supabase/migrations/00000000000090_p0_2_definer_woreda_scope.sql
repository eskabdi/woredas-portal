-- ---------------------------------------------------------------------------
-- 00000000000090_p0_2_definer_woreda_scope.sql
--
-- Security audit 2026-09-24, P0-2 / WP-VER-001 (Critical; merges WP-DB-003,
-- WP-DB-009, WP-DB-010). See docs/audit/2026-09-24/02-findings-register.md.
--
-- Three SECURITY DEFINER functions bypass RLS and look up a row by a key the
-- caller controls, without checking that the row belongs to the caller's
-- woreda. RLS alone keeps tenants apart only for direct table access; a
-- DEFINER body has to re-derive the tenant itself. This migration closes the
-- three functions and the precondition trigger that should have stopped the
-- first one at the door:
--
--   1. generate_resident_on_birth_approval() copied a mother's ethnicity,
--      religion, household and Amharic name from ANY woreda into the new
--      child resident (the gap migration 32 recorded as out of scope and
--      nothing closed afterwards). Every lookup is now pinned to
--      NEW.woreda_id -- the mother's household included, so a stray
--      cross-woreda current_household_id is dropped rather than copied. A
--      mother id that does not resolve inside the event's woreda (another
--      woreda's, since deleted, or malformed) copies nothing. This trigger
--      does not raise: it runs on the final registered transition, and a
--      raise there would strand an already-paid event (see 2 for where a
--      bad reference is refused).
--
--   2. enforce_vital_event_preconditions() only checked the household on a
--      birth, the resident on a death and the spouses on a marriage. It now
--      also rejects, for every event type, a household_id or resident_id
--      column value and any resident reference inside event_details
--      (top-level *_resident_id keys such as mother_resident_id,
--      father_resident_id, deceased_resident_id, plus spouse1/spouse2
--      .resident_id for marriage AND divorce) that does not belong to
--      NEW.woreda_id. This is the check a clerk hits first, with a bilingual
--      message. The event_details check runs when the references are
--      written (INSERT, or an UPDATE of event_details/woreda_id), not on the
--      later paid re-check: a resident deleted or moved after submission
--      must not make "Record payment" raise after the payment and receipt
--      are already committed, which would leave the event stuck at
--      awaiting_payment. (1) is the backstop for rows written before this
--      migration.
--
--   3. rental_eligibility() re-derived the woreda from the resident row
--      instead of from the caller, so any authenticated user -- and anon,
--      which still held Supabase's default EXECUTE grant (migration 31 only
--      revoked PUBLIC) -- could read another woreda's occupancy, household
--      head status and in-flight request number. An authenticated caller
--      now needs a rental permission and only sees residents and houses in
--      their own woreda; a resident outside it gets the same
--      'resident_not_found' verdict as a missing one (no existence oracle).
--      The trigger caller enforce_rental_request_eligibility() runs as the
--      inserting user and gets the same scope, which is what the
--      rental_occupancy_request INSERT policy already requires. A context
--      with no JWT (auth.uid() IS NULL) is only reachable by service_role or
--      the database owner once anon's grant is revoked below, and keeps the
--      previous resident-derived scope so operator/seed paths are unchanged.
--
--   4. get_credential_live_status() has had no caller since the scanner
--      moved to verify_credential_token() (migration 07's own note) but was
--      still executable by every authenticated user in every woreda: a
--      credential-number status oracle across tenants. It is retired the way
--      this repo retires functions without DROP: EXECUTE revoked from
--      PUBLIC, anon and authenticated, and its body replaced with the same
--      active-staff + same-woreda predicate verify_credential_token() uses,
--      in case anything is ever pointed at it again.
--
-- All four bodies move to SET search_path = '' with fully-qualified names.
--
-- ADDITIVE. CREATE OR REPLACE on four existing functions plus grant changes.
-- No table, column, constraint, policy or trigger is added or altered, and
-- no row is modified. Existing cross-woreda rows (if any) are not rewritten;
-- the Appendix C verification queries in the audit find them.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Birth side effect: every lookup pinned to the event's own woreda.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_resident_on_birth_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  d JSONB;
  v_mother_id UUID;
  v_mother_ethnicity TEXT;
  v_mother_religion TEXT;
  v_mother_household_id UUID;
  v_mother_full_name_am TEXT;
  v_full_name_am TEXT;
  v_new_resident_id UUID;
BEGIN
  IF NEW.event_type = 'birth' AND NEW.status = 'registered' AND (OLD.status IS DISTINCT FROM 'registered')
     AND NEW.resident_id IS NULL THEN
    d := NEW.event_details;
    -- Parsed defensively: a malformed value copies nothing rather than
    -- raising a cast error on the final registered transition.
    v_mother_id := CASE
      WHEN btrim(COALESCE(d->>'mother_resident_id', '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN btrim(d->>'mother_resident_id')::UUID
    END;

    IF v_mother_id IS NOT NULL THEN
      -- Pinned to the event's woreda. A mother who is not a resident of
      -- this woreda (another tenant's, or deleted since submission) matches
      -- no row, so nothing is copied and the child falls back to the
      -- details the clerk entered. The household is joined on the event's
      -- woreda too: current_household_id has a single-column FK, so a stray
      -- value pointing at another woreda's household must not spread to
      -- the child.
      SELECT r.ethnicity, r.religion, h.household_id, r.full_name_am
        INTO v_mother_ethnicity, v_mother_religion, v_mother_household_id, v_mother_full_name_am
        FROM public.resident r
        LEFT JOIN public.household h
          ON h.household_id = r.current_household_id
         AND h.woreda_id = NEW.woreda_id
       WHERE r.resident_id = v_mother_id
         AND r.woreda_id = NEW.woreda_id;
    END IF;

    v_full_name_am := trim(concat_ws(' ', d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name'));

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
      COALESCE(d->>'mother_name', v_mother_full_name_am),
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
-- 2. Preconditions: every resident/household reference must be in-woreda.
--    Keeps every check migration 66 had, in the same order, and adds the
--    generic reference checks after them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_vital_event_preconditions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  d JSONB := NEW.event_details;
  v_spouse1_id UUID;
  v_spouse2_id UUID;
  v_ref RECORD;
  v_ref_id UUID;
BEGIN
  IF current_setting('app.system_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    TG_OP = 'INSERT'
    OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id
    OR NEW.event_details IS DISTINCT FROM OLD.event_details
    OR (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  ) THEN
    RETURN NEW;
  END IF;

  -- Any linked household, for every event type (was birth-only).
  IF NEW.household_id IS NOT NULL THEN
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
  ELSIF NEW.resident_id IS NOT NULL THEN
    -- Any other event type that carries a resident_id column value.
    IF NOT EXISTS (
      SELECT 1 FROM public.resident r
       WHERE r.resident_id = NEW.resident_id AND r.woreda_id = NEW.woreda_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'ነዋሪው በዚህ ወረዳ አልተገኘም / The linked resident does not belong to this woreda.';
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

  -- Every other resident reference in event_details, for every event type:
  -- top-level *_resident_id keys (mother_resident_id, father_resident_id,
  -- deceased_resident_id, ...) and the nested spouse1/spouse2 references a
  -- divorce carries in the same shape as a marriage. Checked when the
  -- references are written, not on the paid re-check (see the header).
  IF d IS NOT NULL AND jsonb_typeof(d) = 'object'
     AND (TG_OP = 'INSERT'
          OR NEW.event_details IS DISTINCT FROM OLD.event_details
          OR NEW.woreda_id IS DISTINCT FROM OLD.woreda_id) THEN
    FOR v_ref IN
      SELECT e.key AS ref_key, e.value AS ref_value
        FROM jsonb_each_text(d) AS e
       WHERE e.key LIKE '%\_resident\_id' ESCAPE '\'
      UNION ALL
      SELECT p.party || '.resident_id', d #>> ARRAY[p.party, 'resident_id']
        FROM (VALUES ('spouse1'), ('spouse2')) AS p(party)
       WHERE jsonb_typeof(d -> p.party) = 'object'
    LOOP
      CONTINUE WHEN NULLIF(btrim(v_ref.ref_value), '') IS NULL;

      IF v_ref.ref_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING
          ERRCODE = 'check_violation',
          MESSAGE = format('የነዋሪ መለያ ትክክል አይደለም (%s) / %s is not a valid resident reference.',
                           v_ref.ref_key, v_ref.ref_key);
      END IF;

      v_ref_id := v_ref.ref_value::UUID;
      IF NOT EXISTS (
        SELECT 1 FROM public.resident r
         WHERE r.resident_id = v_ref_id AND r.woreda_id = NEW.woreda_id
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'check_violation',
          MESSAGE = format('ነዋሪው በዚህ ወረዳ አልተገኘም (%s) / %s was not found in this woreda.',
                           v_ref.ref_key, v_ref.ref_key);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. rental_eligibility(): caller-scoped, permission-gated, not anon.
--    Verdict shape and rules are unchanged from migration 31; only the
--    scope and the house check are new.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_eligibility(
  _resident_id     uuid,
  _rental_house_id uuid,
  _request_type    text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_scope_woreda  uuid;   -- NULL = no caller scope (service_role / owner)
  v_woreda_id     uuid;
  v_house_type    text;
  v_reasons       jsonb := '[]'::jsonb;
  v_active        record;
  v_inflight      record;
  v_is_head       boolean := false;
BEGIN
  -- Caller scope. A signed-in user who is not a super admin must hold a
  -- rental permission and is confined to their own woreda. auth.uid() IS
  -- NULL is reachable only by service_role or the database owner, because
  -- EXECUTE is revoked from anon and PUBLIC below.
  IF v_uid IS NOT NULL AND NOT public.is_super_admin() THEN
    v_scope_woreda := public.get_user_woreda_id();
    IF v_scope_woreda IS NULL
       OR NOT public.user_has_any_perm(ARRAY['rental.view', 'rental.create', 'rental.vacate', 'rental.approve']) THEN
      RAISE EXCEPTION 'rental_eligibility: not permitted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Tenant scope comes from the resident, and must match the caller's.
  SELECT r.woreda_id, h.house_type
    INTO v_woreda_id, v_house_type
    FROM public.resident r
    LEFT JOIN public.household h
      ON h.household_id = r.current_household_id
     AND h.woreda_id = r.woreda_id
   WHERE r.resident_id = _resident_id
     AND (v_scope_woreda IS NULL OR r.woreda_id = v_scope_woreda);

  IF v_woreda_id IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'house_type', NULL,
      'reasons', jsonb_build_array(jsonb_build_object(
        'code', 'resident_not_found',
        'am',   'ነዋሪው አልተገኘም።',
        'en',   'Resident not found.'))
    );
  END IF;

  -- The house, when given, must be in the same woreda as the resident.
  IF _rental_house_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kebele_rental_house kh
     WHERE kh.rental_house_id = _rental_house_id
       AND kh.woreda_id = v_woreda_id
  ) THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'house_type', v_house_type,
      'reasons', jsonb_build_array(jsonb_build_object(
        'code', 'house_not_found',
        'am',   'የቀበሌ ቤቱ በዚህ ወረዳ አልተገኘም።',
        'en',   'Rental house not found in this woreda.'))
    );
  END IF;

  -- =========================================================================
  -- Termination: there must BE something to terminate.
  -- =========================================================================
  IF _request_type = 'termination' THEN
    SELECT o.occupancy_id, o.rental_house_id
      INTO v_active
      FROM public.rental_occupancy o
     WHERE o.resident_id = _resident_id
       AND o.woreda_id   = v_woreda_id
       AND o.status      = 'active'
     LIMIT 1;

    IF NOT FOUND THEN
      v_reasons := v_reasons || jsonb_build_object(
        'code', 'no_active_occupancy',
        'am',   'ይህ ነዋሪ በአሁኑ ጊዜ የቀበሌ ቤት የለውም፤ ስለዚህ ውል ማቋረጥ አይቻልም።',
        'en',   'This resident has no active kebele house, so there is nothing to terminate.');
    END IF;

    RETURN jsonb_build_object(
      'eligible',   (jsonb_array_length(v_reasons) = 0),
      'house_type', v_house_type,
      'active_occupancy_id', (CASE WHEN v_active.occupancy_id IS NOT NULL
                                   THEN to_jsonb(v_active.occupancy_id) ELSE 'null'::jsonb END),
      'reasons',    v_reasons
    );
  END IF;

  -- =========================================================================
  -- New registration
  -- =========================================================================

  -- A. Already holds an active kebele house, in THIS woreda.
  SELECT o.occupancy_id, o.rental_house_id
    INTO v_active
    FROM public.rental_occupancy o
   WHERE o.resident_id = _resident_id
     AND o.woreda_id   = v_woreda_id
     AND o.status      = 'active'
   LIMIT 1;

  IF FOUND THEN
    v_reasons := v_reasons || jsonb_build_object(
      'code', 'active_occupancy_exists',
      'am',   'ይህ ነዋሪ አስቀድሞ የቀበሌ ቤት ተከራይቷል። ወደ ሌላ ቤት ለመዛወር በመጀመሪያ ያለውን ውል ማቋረጥ ያስፈልጋል።',
      'en',   'This resident already holds an active kebele house. To move to another house, terminate the existing occupancy first.');
  END IF;

  -- B. Another new_registration already in flight.
  SELECT q.request_number, q.status
    INTO v_inflight
    FROM public.rental_occupancy_request q
   WHERE q.resident_id  = _resident_id
     AND q.woreda_id    = v_woreda_id
     AND q.request_type = 'new_registration'
     AND q.status NOT IN ('rejected', 'approved')
   ORDER BY q.created_at
   LIMIT 1;

  IF FOUND THEN
    v_reasons := v_reasons || jsonb_build_object(
      'code',  'request_already_in_flight',
      'am',    format('ለዚህ ነዋሪ በሂደት ላይ ያለ ጥያቄ አለ (%s)። መጀመሪያ ያንን ይጨርሱ።', v_inflight.request_number),
      'en',    format('A request for this resident is already in progress (%s, %s). Complete or reject it first.',
                      v_inflight.request_number, v_inflight.status));
  END IF;

  -- C. Current house type is reported, never blocked on (migration 31).
  v_is_head := EXISTS (
    SELECT 1
      FROM public.resident r
      JOIN public.household h
        ON h.household_id = r.current_household_id
       AND h.woreda_id = r.woreda_id
     WHERE r.resident_id = _resident_id
       AND r.woreda_id = v_woreda_id
       AND h.household_head_resident_id = _resident_id);

  RETURN jsonb_build_object(
    'eligible',   (jsonb_array_length(v_reasons) = 0),
    'house_type', v_house_type,
    'is_household_head', v_is_head,
    'active_occupancy_id', (CASE WHEN v_active.occupancy_id IS NOT NULL
                                 THEN to_jsonb(v_active.occupancy_id) ELSE 'null'::jsonb END),
    'reasons',    v_reasons
  );
END;
$function$;

COMMENT ON FUNCTION public.rental_eligibility(uuid, uuid, text) IS
  'Structured eligibility verdict for a rental occupancy request, shared by the UI and enforce_rental_request_eligibility(). Since 00000000000090: a signed-in non-super-admin caller needs a rental.* permission and only sees residents and houses in their own woreda (a resident elsewhere reads as resident_not_found); not executable by anon.';

-- Revoking PUBLIC alone left anon's explicit Supabase default grant in place
-- (the same trap migration 07 documents for get_credential_live_status).
REVOKE ALL ON FUNCTION public.rental_eligibility(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_eligibility(uuid, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. get_credential_live_status(): retired (no caller), closed to clients.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_credential_live_status(_credential_number text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT rc.status::text
    FROM public.residence_credential rc
   WHERE rc.credential_number = _credential_number
     AND public.is_active_app_user()
     AND (public.is_super_admin() OR rc.woreda_id = public.get_user_woreda_id())
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.get_credential_live_status(text) IS
  'Retired in 00000000000090 (no caller since verify_credential_token() replaced it). EXECUTE revoked from PUBLIC, anon and authenticated; body limited to active staff of the credential''s own woreda. Use verify_credential_token() instead.';

REVOKE ALL ON FUNCTION public.get_credential_live_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_credential_live_status(text) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run after apply; each must return the value shown):
--
--   SELECT has_function_privilege('anon', 'public.rental_eligibility(uuid,uuid,text)', 'EXECUTE');          -- f
--   SELECT has_function_privilege('authenticated', 'public.get_credential_live_status(text)', 'EXECUTE');   -- f
--   SELECT has_function_privilege('anon', 'public.get_credential_live_status(text)', 'EXECUTE');            -- f
--   SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('generate_resident_on_birth_approval',
--      'enforce_vital_event_preconditions', 'rental_eligibility', 'get_credential_live_status');
--      -- every proconfig = {search_path=""}
--   SELECT count(*) FROM pg_proc WHERE proname = 'generate_resident_on_birth_approval'
--      AND prosrc LIKE '%r.woreda_id = NEW.woreda_id%';                                                    -- 1
--
-- Before apply AND after: every event_details resident reference that does
-- not resolve inside its event's woreda (cross-woreda, deleted, or not a
-- UUID). Should be 0. Rows not yet registered/rejected are the ones that
-- matter most -- resolve them first; later edits to their event_details
-- would be refused.
--
--   WITH refs AS (
--     SELECT ve.vital_event_id, ve.woreda_id, ve.status, e.key AS ref_key, e.value AS ref_value
--       FROM public.vital_event ve, jsonb_each_text(ve.event_details) e
--      WHERE jsonb_typeof(ve.event_details) = 'object' AND e.key LIKE '%\_resident\_id' ESCAPE '\'
--     UNION ALL
--     SELECT ve.vital_event_id, ve.woreda_id, ve.status, p.party || '.resident_id',
--            ve.event_details #>> ARRAY[p.party, 'resident_id']
--       FROM public.vital_event ve, (VALUES ('spouse1'), ('spouse2')) p(party)
--      WHERE jsonb_typeof(ve.event_details -> p.party) = 'object'
--   )
--   SELECT refs.status, refs.ref_key, count(*)
--     FROM refs
--    WHERE NULLIF(btrim(refs.ref_value), '') IS NOT NULL
--      AND NOT EXISTS (
--        SELECT 1 FROM public.resident r
--         WHERE r.resident_id::text = lower(btrim(refs.ref_value)) AND r.woreda_id = refs.woreda_id)
--    GROUP BY 1, 2 ORDER BY 1, 2;
-- ---------------------------------------------------------------------------
