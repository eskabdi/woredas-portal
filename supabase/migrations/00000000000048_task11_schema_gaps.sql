-- Task 11 (fix-task-production-readiness-v3): fill the schema gaps (D1 --
-- all built, none excepted), applying the task's own reconciliation
-- addendum before writing anything: enumerate the live schema first,
-- classify each gap-fill object as create / extend-and-map, and never
-- create a duplicate of an object that already covers the same capability.
--
-- Classification recorded here (also mirrored into docs/erd.md):
--   office                       -- does not exist -> CREATE (+ backfill x6,
--                                   + issuing_office_id/office_id columns)
--   household_location           -- does not exist -> CREATE (+ backfill from
--                                   household.gps_*, bidirectional mirror)
--   approval                     -- does not exist -> CREATE (generic
--                                   stage-level decision trail; NOT a
--                                   duplicate of the workflow rows' own
--                                   approved_by_user_id/decision columns,
--                                   which the FSM and maker<>checker checks
--                                   keep reading directly)
--   attachment                   -- does not exist -> CREATE (generic
--                                   entity-bound uploads; resident_document,
--                                   service_request_attachment and
--                                   rental_request_document are module-local/
--                                   entity-specific, not a generic
--                                   entity_name+entity_id table, so this is a
--                                   new capability, not a duplicate --
--                                   nothing is consolidated by deletion)
--   fee_schedule                 -- EXISTS (fee_schedule_id, woreda_id,
--                                   service_type, standard_fee, penalty_rate,
--                                   status, created_at, updated_at) ->
--                                   EXTEND: add effective_from only.
--                                   `amount` maps to the existing
--                                   standard_fee column and `is_active` maps
--                                   to status = 'active' -- no renamed/
--                                   duplicate columns are added for those.
--   credential_policy            -- does not exist -> CREATE
--   audit_log columns            -- ALREADY HAS old_value_json,
--                                   new_value_json, source_ip (baseline
--                                   migration) -> no-op, nothing to add.
--   credential_verification_log  -- ALREADY EXISTS (created in Task 3,
--                                   00000000000034) -> no-op.
--   user / service_request bindings -- documentation-only, see docs/erd.md;
--                                   no schema change.
--
-- All new tables follow the house pattern used throughout this repo:
-- woreda_id + RLS with get_user_woreda_id() in both USING and WITH CHECK,
-- actor columns forced by force_actor_columns(), an updated_at trigger
-- where the table is ever updated in place.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. office -- one main office per woreda (E2), seeded 6 rows, no
-- management UI: future woredas get theirs from a seeding trigger on
-- woreda insert, mirroring seed_role_permission_for_new_woreda()
-- (00000000000015) rather than relying on a provisioning-wizard insert that
-- could be forgotten by a future second entry point.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.office (
  office_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  office_code text NOT NULL,
  office_name text NOT NULL,
  is_main boolean DEFAULT true NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT office_pkey PRIMARY KEY (office_id),
  CONSTRAINT office_woreda_id_key UNIQUE (woreda_id)
);

ALTER TABLE public.office
  ADD CONSTRAINT office_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES public.woreda(woreda_id) ON DELETE CASCADE;

ALTER TABLE public.office ENABLE ROW LEVEL SECURITY;

CREATE POLICY office_select ON public.office AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id()));
CREATE POLICY office_write_super_admin ON public.office AS PERMISSIVE FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE TRIGGER set_office_updated_at BEFORE UPDATE ON public.office
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.office (woreda_id, office_code, office_name, is_main, is_active)
SELECT w.woreda_id, w.woreda_code || '-MAIN', w.woreda_name_en || ' Main Office', true, true
FROM public.woreda w
ON CONFLICT (woreda_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_office_for_new_woreda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.office (woreda_id, office_code, office_name, is_main, is_active)
  VALUES (NEW.woreda_id, NEW.woreda_code || '-MAIN', NEW.woreda_name_en || ' Main Office', true, true)
  ON CONFLICT (woreda_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_office_after_woreda_insert ON public.woreda;
CREATE TRIGGER seed_office_after_woreda_insert
  AFTER INSERT ON public.woreda
  FOR EACH ROW EXECUTE FUNCTION public.seed_office_for_new_woreda();

-- residence_credential.issuing_office_id / credential_request.office_id --
-- both default to the woreda's (only, for now) main office so every
-- existing row backfills without a manual pass.
ALTER TABLE public.residence_credential ADD COLUMN IF NOT EXISTS issuing_office_id uuid;
ALTER TABLE public.credential_request ADD COLUMN IF NOT EXISTS office_id uuid;

UPDATE public.residence_credential rc
   SET issuing_office_id = o.office_id
  FROM public.office o
 WHERE o.woreda_id = rc.woreda_id
   AND rc.issuing_office_id IS NULL;

UPDATE public.credential_request cr
   SET office_id = o.office_id
  FROM public.office o
 WHERE o.woreda_id = cr.woreda_id
   AND cr.office_id IS NULL;

ALTER TABLE public.residence_credential
  ADD CONSTRAINT residence_credential_issuing_office_id_fkey FOREIGN KEY (issuing_office_id) REFERENCES public.office(office_id);
ALTER TABLE public.credential_request
  ADD CONSTRAINT credential_request_office_id_fkey FOREIGN KEY (office_id) REFERENCES public.office(office_id);

-- ---------------------------------------------------------------------------
-- 2. household_location -- backfilled from household.gps_*, kept in sync
-- both ways: the legacy write path (writing household.gps_lat/gps_lng
-- directly, what every existing call site does today) keeps working and is
-- mirrored here, and a future write to household_location directly is
-- mirrored back onto household.gps_* so old readers don't go stale. Each
-- trigger's WHEN clause only fires on an actual value change, so the
-- mutual mirror settles in one hop instead of looping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.household_location (
  household_location_id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  woreda_id uuid NOT NULL,
  gps_lat numeric,
  gps_lng numeric,
  map_reference text,
  captured_at timestamp with time zone DEFAULT now() NOT NULL,
  captured_by uuid,
  CONSTRAINT household_location_pkey PRIMARY KEY (household_location_id),
  CONSTRAINT household_location_household_id_key UNIQUE (household_id)
);

ALTER TABLE public.household_location
  ADD CONSTRAINT household_location_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(household_id) ON DELETE CASCADE;
ALTER TABLE public.household_location
  ADD CONSTRAINT household_location_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES public.woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.household_location
  ADD CONSTRAINT household_location_captured_by_fkey FOREIGN KEY (captured_by) REFERENCES public.app_user(user_id);

CREATE INDEX household_location_woreda_id_idx ON public.household_location USING btree (woreda_id);

ALTER TABLE public.household_location ENABLE ROW LEVEL SECURITY;

CREATE POLICY household_location_select ON public.household_location AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id()));
CREATE POLICY household_location_insert ON public.household_location AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.create,household.update}'::text[])));
CREATE POLICY household_location_update ON public.household_location AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[])))
  WITH CHECK (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[])));
CREATE POLICY household_location_delete ON public.household_location AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[])));

CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.household_location
  FOR EACH ROW EXECUTE FUNCTION force_actor_columns('captured_by');

INSERT INTO public.household_location (household_id, woreda_id, gps_lat, gps_lng, captured_at)
SELECT h.household_id, h.woreda_id, h.gps_lat, h.gps_lng, h.updated_at
FROM public.household h
WHERE (h.gps_lat IS NOT NULL OR h.gps_lng IS NOT NULL)
ON CONFLICT (household_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mirror_household_gps_to_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.household_location (household_id, woreda_id, gps_lat, gps_lng, captured_at)
  VALUES (NEW.household_id, NEW.woreda_id, NEW.gps_lat, NEW.gps_lng, now())
  ON CONFLICT (household_id) DO UPDATE
    SET gps_lat = EXCLUDED.gps_lat, gps_lng = EXCLUDED.gps_lng, captured_at = now()
    WHERE household_location.gps_lat IS DISTINCT FROM EXCLUDED.gps_lat
       OR household_location.gps_lng IS DISTINCT FROM EXCLUDED.gps_lng;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mirror_household_gps_after_write ON public.household;
CREATE TRIGGER mirror_household_gps_after_write
  AFTER INSERT OR UPDATE OF gps_lat, gps_lng ON public.household
  FOR EACH ROW EXECUTE FUNCTION public.mirror_household_gps_to_location();

CREATE OR REPLACE FUNCTION public.mirror_location_gps_to_household()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.household
     SET gps_lat = NEW.gps_lat, gps_lng = NEW.gps_lng
   WHERE household_id = NEW.household_id
     AND (gps_lat IS DISTINCT FROM NEW.gps_lat OR gps_lng IS DISTINCT FROM NEW.gps_lng);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mirror_location_gps_after_write ON public.household_location;
CREATE TRIGGER mirror_location_gps_after_write
  AFTER INSERT OR UPDATE OF gps_lat, gps_lng ON public.household_location
  FOR EACH ROW EXECUTE FUNCTION public.mirror_location_gps_to_household();

-- ---------------------------------------------------------------------------
-- Shared helper for approval/attachment's polymorphic (entity, entity_id)
-- columns: "a validation trigger asserts the referenced row exists in the
-- same woreda" (Task 11). Only entity types that exist in the schema today
-- are listed; Task 14 must extend this CASE when it adds civil_event (the
-- civil registration table does not exist yet -- confirmed live before
-- writing this migration).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entity_belongs_to_woreda(_entity text, _entity_id uuid, _woreda_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE _entity
    WHEN 'resident' THEN EXISTS (SELECT 1 FROM public.resident WHERE resident_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'household' THEN EXISTS (SELECT 1 FROM public.household WHERE household_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'credential_request' THEN EXISTS (SELECT 1 FROM public.credential_request WHERE credential_request_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'residence_credential' THEN EXISTS (SELECT 1 FROM public.residence_credential WHERE credential_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'service_request' THEN EXISTS (SELECT 1 FROM public.service_request WHERE service_request_id = _entity_id AND woreda_id = _woreda_id)
    WHEN 'rental_occupancy_request' THEN EXISTS (SELECT 1 FROM public.rental_occupancy_request WHERE rental_request_id = _entity_id AND woreda_id = _woreda_id)
    ELSE false
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. approval -- generic stage-level decision trail. Not a duplicate of a
-- workflow row's own approved_by_user_id/decision columns: those stay the
-- source the FSM and maker<>checker checks read directly (see Task 1/14).
-- This table is the audit-grade record of every decision made along the
-- way, written in the same transaction as the Stage-3/Task 14 approval
-- flows -- insert-only by convention, like audit_log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.approval (
  approval_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  approver_user_id uuid,
  decision text NOT NULL,
  decision_at timestamp with time zone DEFAULT now() NOT NULL,
  stage_no integer NOT NULL,
  reason text,
  CONSTRAINT approval_pkey PRIMARY KEY (approval_id),
  CONSTRAINT approval_decision_check CHECK (decision IN ('approved', 'rejected', 'returned'))
);

ALTER TABLE public.approval
  ADD CONSTRAINT approval_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES public.woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.approval
  ADD CONSTRAINT approval_approver_user_id_fkey FOREIGN KEY (approver_user_id) REFERENCES public.app_user(user_id);

CREATE INDEX approval_entity_idx ON public.approval USING btree (entity, entity_id);
CREATE INDEX approval_woreda_id_idx ON public.approval USING btree (woreda_id);

ALTER TABLE public.approval ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_select ON public.approval AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{approval.queue.view,credential.approve,civil.approve,service.approve,rental.approve}'::text[])));
CREATE POLICY approval_insert ON public.approval AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.approve,civil.approve,service.approve,rental.approve}'::text[])))
    AND public.entity_belongs_to_woreda(entity, entity_id, woreda_id)
  );

CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.approval
  FOR EACH ROW EXECUTE FUNCTION force_actor_columns('approver_user_id');

-- ---------------------------------------------------------------------------
-- 4. attachment -- generic entity-bound uploads. resident_document,
-- service_request_attachment and rental_request_document are module-local/
-- entity-specific (each FK's to one entity type), not a generic
-- entity_name+entity_id table, so this is a new capability for the
-- credential and (future, Task 14) civil workflows, which today have no
-- multi-document table of their own (credential_request only carries a
-- single supporting_document_path/name/content_type triple). The existing
-- module-local tables are left exactly as they are -- nothing is
-- consolidated by deletion.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attachment (
  attachment_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  checksum text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT attachment_pkey PRIMARY KEY (attachment_id)
);

ALTER TABLE public.attachment
  ADD CONSTRAINT attachment_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES public.woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.attachment
  ADD CONSTRAINT attachment_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.app_user(user_id);

CREATE INDEX attachment_entity_idx ON public.attachment USING btree (entity, entity_id);
CREATE INDEX attachment_woreda_id_idx ON public.attachment USING btree (woreda_id);

ALTER TABLE public.attachment ENABLE ROW LEVEL SECURITY;

CREATE POLICY attachment_select ON public.attachment AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{resident.read,household.read,credential.read,civil.read,service.read}'::text[])));
CREATE POLICY attachment_insert ON public.attachment AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{resident.update,credential.issue,credential.submit,civil.create_event,civil.submit,service.create}'::text[])))
    AND public.entity_belongs_to_woreda(entity, entity_id, woreda_id)
  );
-- No UPDATE/DELETE policy: an uploaded attachment's checksum is meant to be
-- immutable evidence, same reasoning as audit_log's own insert-only
-- convention. Only is_super_admin() can bypass RLS entirely to remove one.

CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.attachment
  FOR EACH ROW EXECUTE FUNCTION force_actor_columns('uploaded_by');

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS attachments_select_scoped ON storage.objects;
CREATE POLICY attachments_select_scoped ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'attachments') AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id())));
DROP POLICY IF EXISTS attachments_insert_scoped ON storage.objects;
CREATE POLICY attachments_insert_scoped ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'attachments') AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_woreda_id())));
DROP POLICY IF EXISTS attachments_delete_scoped ON storage.objects;
CREATE POLICY attachments_delete_scoped ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'attachments') AND is_super_admin());

-- ---------------------------------------------------------------------------
-- 5. fee_schedule -- extend, don't duplicate. `amount` maps to the existing
-- standard_fee column and `is_active` maps to status = 'active'; only
-- effective_from is a genuinely new capability (which date a fee schedule
-- version took effect), so it's the only column added. NULL means "always
-- effective" for every existing row, so nothing already in the table
-- changes behavior.
-- ---------------------------------------------------------------------------
ALTER TABLE public.fee_schedule ADD COLUMN IF NOT EXISTS effective_from date;

-- ---------------------------------------------------------------------------
-- 6. credential_policy -- tenant-scoped credential rules, read by any staff
-- (Stage 5 expiry lookups), written only under credential.configure_policy
-- (already RESERVED_PERMISSION_KEYS-locked to tenant_admin/super_admin
-- since Task 4, 00000000000036).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credential_policy (
  credential_policy_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  expiry_months integer,
  renewal_window_days integer,
  max_reissue_count integer,
  enabled_request_types text[] DEFAULT ARRAY[]::text[] NOT NULL,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT credential_policy_pkey PRIMARY KEY (credential_policy_id),
  CONSTRAINT credential_policy_woreda_id_key UNIQUE (woreda_id)
);

ALTER TABLE public.credential_policy
  ADD CONSTRAINT credential_policy_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES public.woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.credential_policy
  ADD CONSTRAINT credential_policy_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_user(user_id);

ALTER TABLE public.credential_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_policy_select ON public.credential_policy AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR (woreda_id = get_user_woreda_id()));
CREATE POLICY credential_policy_insert ON public.credential_policy AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.configure_policy}'::text[])));
CREATE POLICY credential_policy_update ON public.credential_policy AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.configure_policy}'::text[])))
  WITH CHECK (is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.configure_policy}'::text[])));

CREATE TRIGGER set_credential_policy_updated_at BEFORE UPDATE ON public.credential_policy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.credential_policy
  FOR EACH ROW EXECUTE FUNCTION force_actor_columns('updated_by');

-- No backfill: the table starts empty per woreda. Every consuming code path
-- (Stage 5 expiry, Task 12/14) must treat a missing row as "no override,
-- use the compiled default" -- the same missing-row-means-default
-- convention this repo already uses for tenant_module_config and
-- role_permission, not a gap to close here.

COMMIT;
