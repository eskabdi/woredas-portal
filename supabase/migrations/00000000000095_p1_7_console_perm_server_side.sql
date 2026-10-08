-- ============================================================================
-- P1-7 (2026-09-24 audit, WP-AZ-001, merges WP-API-001): enforce console
-- permissions (CP keys) server-side.
--
-- Before this migration a "scoped" super_admin (app_user.console_role_id set
-- to a console role granting, say, only console.audit.view) was scoped only in
-- the browser: every console-owned policy below checked is_super_admin(), so
-- the same JWT could PATCH woreda, toggle tenant modules, rewrite app_user,
-- publish the ID card template or edit the platform workflow FSM straight
-- through PostgREST. This swaps each console-owned check for the CP key the
-- console UI already gates that screen on (src/config/permissions.ts,
-- ADMIN_NAV), via user_has_console_perm() -- which keeps the documented
-- default: console_role_id IS NULL is an unrestricted super_admin, so every
-- existing unscoped admin is unaffected.
--
--   console.tenants.manage             woreda, office, tenant_module_config writes
--   console.users.manage               app_user writes by a super_admin
--   console.audit.view                 cross-tenant audit_log SELECT
--   console.credential_template.manage id_card_template* writes, the
--                                      credential-templates bucket,
--                                      publish/discard RPCs
--   (unrestricted super_admin only)    workflow_transition writes -- platform-
--                                      wide FSM, no console screen, no CP key
--
-- Not in scope (documented residual, docs/security-functionality.md):
-- super_admin's cross-tenant branch on tenant operational tables (resident,
-- payment, ... and their storage buckets). No CP key exists for "operate
-- inside a tenant" yet; inventing one changes ~100 policies and is its own
-- change.
--
-- audit_log hardening, same finding family:
--   * force_actor_columns() only overwrites a NON-NULL actor, so an
--     authenticated insert with actor_user_id = null landed as an
--     unattributed row. A second BEFORE INSERT trigger now always stamps the
--     caller's auth.uid() (service_role / migrations, where auth.uid() is
--     NULL, are untouched -- the Edge Functions set their own actor).
--   * anon held DELETE/INSERT/SELECT/UPDATE and authenticated UPDATE/DELETE
--     on audit_log. RLS has no UPDATE/DELETE policy so they were already
--     denied, but the grant is the layer that makes the log append-only
--     even if a permissive policy is ever added by mistake. Revoked.
--
-- Policies change through ALTER POLICY (in place, same name, same command),
-- the policy analogue of CREATE OR REPLACE: no DROP anywhere in this file.
-- Functions change only through CREATE OR REPLACE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: an unrestricted super_admin (console_role_id IS NULL).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_unrestricted_super_admin()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = auth.uid()
      AND au.role = 'super_admin'
      AND au.status = 'active'
      AND au.console_role_id IS NULL
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_unrestricted_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_unrestricted_super_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. console.tenants.manage
-- ---------------------------------------------------------------------------
ALTER POLICY woreda_super_admin_write ON public.woreda
  USING (public.user_has_console_perm('console.tenants.manage'))
  WITH CHECK (public.user_has_console_perm('console.tenants.manage'));

ALTER POLICY office_write_super_admin ON public.office
  USING (public.user_has_console_perm('console.tenants.manage'))
  WITH CHECK (public.user_has_console_perm('console.tenants.manage'));

ALTER POLICY tenant_module_config_write_super_admin ON public.tenant_module_config
  USING (public.user_has_console_perm('console.tenants.manage'))
  WITH CHECK (public.user_has_console_perm('console.tenants.manage'));

-- ---------------------------------------------------------------------------
-- 3. console.users.manage. guard_console_role_assignment() still separately
--    requires console.console_users.manage for any console_role_id change and
--    still blocks self-assignment; this narrows who can write the row at all.
-- ---------------------------------------------------------------------------
ALTER POLICY app_user_super_admin_write ON public.app_user
  USING (public.user_has_console_perm('console.users.manage'))
  WITH CHECK (public.user_has_console_perm('console.users.manage'));

-- ---------------------------------------------------------------------------
-- 4. console.audit.view -- the platform-wide read. A tenant user's own-woreda
--    branch is unchanged; a super_admin has no woreda_id, so that branch
--    never widens a scoped admin's read.
-- ---------------------------------------------------------------------------
ALTER POLICY audit_log_tenant_read ON public.audit_log
  USING (public.user_has_console_perm('console.audit.view')
         OR woreda_id = public.get_user_woreda_id());

-- ---------------------------------------------------------------------------
-- 5. console.credential_template.manage
-- ---------------------------------------------------------------------------
ALTER POLICY id_card_template_write_super_admin ON public.id_card_template
  USING (public.user_has_console_perm('console.credential_template.manage'))
  WITH CHECK (public.user_has_console_perm('console.credential_template.manage'));

ALTER POLICY template_write_super_admin ON public.id_card_template_field
  USING (public.user_has_console_perm('console.credential_template.manage'))
  WITH CHECK (public.user_has_console_perm('console.credential_template.manage'));

ALTER POLICY template_draft_write_super_admin ON public.id_card_template_field_draft
  USING (public.user_has_console_perm('console.credential_template.manage'))
  WITH CHECK (public.user_has_console_perm('console.credential_template.manage'));

ALTER POLICY credential_templates_write_super_admin ON storage.objects
  USING (bucket_id = 'credential-templates'
         AND public.user_has_console_perm('console.credential_template.manage'))
  WITH CHECK (bucket_id = 'credential-templates'
              AND public.user_has_console_perm('console.credential_template.manage'));

-- Both run as INVOKER, so the template-table policies above already bind
-- them; the explicit check keeps the error a clear one rather than a
-- half-applied publish that RLS rejects partway through.
CREATE OR REPLACE FUNCTION public.publish_id_card_template()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_has_console_perm('console.credential_template.manage') THEN
    RAISE EXCEPTION 'Only super_admin may publish the ID card template';
  END IF;

  -- template_field_id is deliberately NOT copied from the draft row: draft and
  -- live are separate PK spaces (see the no-FK note above), so reusing the
  -- draft's id here could collide with an unrelated live row's PK when a
  -- draft field's (template_type, field_key) has changed since the last
  -- publish. Let the live table assign its own id; ON CONFLICT below is
  -- keyed on (template_type, field_key), which is the only identity that
  -- actually carries across the two tables.
  INSERT INTO public.id_card_template_field
    (template_type, field_key, x, y, width, height, font_size,
     font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
     color, font_family, font_style, text_decoration, binding_mode, static_value)
  SELECT template_type, field_key, x, y, width, height, font_size,
         font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
         color, font_family, font_style, text_decoration, binding_mode, static_value
  FROM public.id_card_template_field_draft
  ON CONFLICT (template_type, field_key) DO UPDATE SET
    x = EXCLUDED.x, y = EXCLUDED.y, width = EXCLUDED.width, height = EXCLUDED.height,
    font_size = EXCLUDED.font_size, font_weight = EXCLUDED.font_weight,
    text_align = EXCLUDED.text_align, z_index = EXCLUDED.z_index,
    canvas_width = EXCLUDED.canvas_width, canvas_height = EXCLUDED.canvas_height,
    field_type = EXCLUDED.field_type, color = EXCLUDED.color,
    font_family = EXCLUDED.font_family, font_style = EXCLUDED.font_style,
    text_decoration = EXCLUDED.text_decoration, binding_mode = EXCLUDED.binding_mode,
    static_value = EXCLUDED.static_value;

  DELETE FROM public.id_card_template_field live
  WHERE NOT EXISTS (
    SELECT 1 FROM public.id_card_template_field_draft d
    WHERE d.template_type = live.template_type AND d.field_key = live.field_key
  );

  UPDATE public.id_card_template
     SET is_published = true, updated_by = auth.uid(), updated_at = now()
   WHERE template_type IN ('card_front', 'card_back');

  INSERT INTO public.audit_log (actor_user_id, entity_name, action_type, new_value_json)
  VALUES (auth.uid(), 'id_card_template', 'TEMPLATE_PUBLISHED', jsonb_build_object('published_at', now()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.discard_id_card_template_draft()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  prior_front boolean;
  prior_back boolean;
BEGIN
  IF NOT public.user_has_console_perm('console.credential_template.manage') THEN
    RAISE EXCEPTION 'Only super_admin may discard the ID card template draft';
  END IF;

  -- Capture each side's is_published state before the DELETE/INSERT below
  -- triggers mark_template_draft_dirty() and flips both to false -- a side
  -- that was never published (still false) must come back false, not true.
  SELECT is_published INTO prior_front FROM public.id_card_template WHERE template_type = 'card_front';
  SELECT is_published INTO prior_back FROM public.id_card_template WHERE template_type = 'card_back';

  DELETE FROM public.id_card_template_field_draft;
  INSERT INTO public.id_card_template_field_draft
    (template_field_id, template_type, field_key, x, y, width, height, font_size,
     font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
     color, font_family, font_style, text_decoration, binding_mode, static_value)
  SELECT template_field_id, template_type, field_key, x, y, width, height, font_size,
         font_weight, text_align, z_index, canvas_width, canvas_height, field_type,
         color, font_family, font_style, text_decoration, binding_mode, static_value
  FROM public.id_card_template_field;

  -- Content now equals what's live again -- restore each side's prior
  -- is_published state, overriding the dirty trigger's flip from the
  -- DELETE/INSERT above.
  UPDATE public.id_card_template SET is_published = prior_front WHERE template_type = 'card_front';
  UPDATE public.id_card_template SET is_published = prior_back WHERE template_type = 'card_back';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. workflow_transition: the platform-wide FSM (which verification /
--    approval / payment gates exist at all). No console screen writes it and
--    no CP key maps to it, so only an unrestricted super_admin may.
-- ---------------------------------------------------------------------------
ALTER POLICY workflow_transition_super_admin_write ON public.workflow_transition
  USING (public.is_unrestricted_super_admin())
  WITH CHECK (public.is_unrestricted_super_admin());

-- ---------------------------------------------------------------------------
-- 7. audit_log: always attribute an authenticated insert to its caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_log_stamp_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  -- NULL for service_role, migrations and the Management API: those set
  -- their own actor (Edge Functions) or are system rows by design.
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

-- Named to sort after trg_force_actor (same-event triggers fire in name
-- order), so this is the last word on actor_user_id either way.
CREATE OR REPLACE TRIGGER trg_stamp_audit_actor
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_stamp_actor();

-- ---------------------------------------------------------------------------
-- 8. audit_log grants: append-only for clients at the grant layer.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.audit_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
