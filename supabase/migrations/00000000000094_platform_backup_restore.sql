-- Super-admin Backup & Restore (P0-1 follow-on, 2026-09-27).
--
-- The nightly backup job (.github/workflows/nightly-backup.yml) and the
-- restore workflow (.github/workflows/restore-backup.yml) run in GitHub
-- Actions. The super-admin console drives them through ONE Edge Function,
-- `backup-admin`, which holds the GitHub token; the browser never talks to
-- GitHub. This migration adds what the database side needs:
--
--   1. console.backup.manage -- a new console permission (CP.BACKUP_MANAGE).
--      Widening a CHECK is DROP + ADD of the same constraint with a longer
--      list, the idiom migrations 19, 35-37 and 71 already use.
--   2. platform_backup_restore_request -- one row per restore request, with a
--      maker-checker FSM enforced by trigger. Written ONLY by the Edge
--      Function (service_role): there is no INSERT/UPDATE/DELETE policy for
--      `authenticated`, so a direct PostgREST write is refused.
--   3. An audit trigger: every insert, status change and linked workflow run
--      lands in audit_log, even if a future code path forgets to write one.
--
-- Restore NEVER targets production: the workflow's two modes are an
-- isolated verification sandbox and a NEW Supabase project (disaster
-- recovery, then cut over). See docs/backup-restore-runbook.md.
--
-- Additive apart from the sanctioned CHECK-widening idiom.

-- 1. Console permission --------------------------------------------------------
ALTER TABLE public.console_role_permission
  DROP CONSTRAINT console_role_permission_key_check;
ALTER TABLE public.console_role_permission
  ADD CONSTRAINT console_role_permission_key_check CHECK (permission_key = ANY (ARRAY[
    'console.tenants.manage',
    'console.users.manage',
    'console.audit.view',
    'console.credential_template.manage',
    'console.console_users.manage',
    'console.backup.manage'
  ]));

-- 2. Restore requests ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_backup_restore_request (
  restore_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- GitHub identifiers of the backup being restored (nightly-backup.yml run
  -- and its encrypted artifact). Validated by the Edge Function against the
  -- GitHub API before insert.
  backup_run_id bigint NOT NULL CHECK (backup_run_id > 0),
  backup_artifact_id bigint NOT NULL CHECK (backup_artifact_id > 0),
  backup_created_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('verify', 'restore_to_target')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled',
                      'dispatched', 'succeeded', 'failed')),
  requested_by uuid NOT NULL REFERENCES public.app_user(user_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.app_user(user_id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  dispatched_at timestamptz,
  workflow_run_id bigint,
  workflow_run_url text CHECK (workflow_run_url IS NULL OR workflow_run_url ~ '^https://github\.com/'),
  completed_at timestamptz,
  result_conclusion text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Maker-checker as a constraint as well as in the trigger.
  CONSTRAINT platform_backup_restore_request_maker_checker
    CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE INDEX IF NOT EXISTS platform_backup_restore_request_status_idx
  ON public.platform_backup_restore_request (status, requested_at DESC);

ALTER TABLE public.platform_backup_restore_request ENABLE ROW LEVEL SECURITY;

-- Read: any super admin allowed to manage backups. No write policies: all
-- writes go through the backup-admin Edge Function (service_role).
DROP POLICY IF EXISTS platform_backup_restore_request_select ON public.platform_backup_restore_request;
CREATE POLICY platform_backup_restore_request_select
  ON public.platform_backup_restore_request
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.user_has_console_perm('console.backup.manage'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_backup_restore_request FROM anon, authenticated;
GRANT SELECT ON public.platform_backup_restore_request TO authenticated;

-- FSM + maker-checker, enforced for every writer, service_role included.
--   requested  -> approved | rejected | cancelled
--   approved   -> dispatched | failed        (failed = dispatch refused)
--   dispatched -> succeeded | failed
-- rejected / cancelled / succeeded / failed are terminal and frozen. Only the
-- requester may cancel. Only a DIFFERENT active super admin holding
-- console.backup.manage may approve or reject, and only with an account that
-- already existed when the request was made -- so a second account invited
-- after the fact cannot rubber-stamp the first one's request. (Two accounts
-- held by one person who planned ahead is the residual risk; the GitHub
-- `restore` environment's required reviewer is the further gate, runbook §3a.)
-- Identity and backup columns never change after insert; the decision, the
-- timestamps and the linked workflow run are set once and then frozen. Rows
-- are never deleted.

-- console.backup.manage for a GIVEN user, the same rule user_has_console_perm()
-- applies to auth.uid(). Internal to the trigger (the Edge Function writes as
-- service_role, where auth.uid() is NULL); not callable by clients.
CREATE OR REPLACE FUNCTION public.backup_restore_actor_allowed(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = _user
      AND au.role = 'super_admin'
      AND au.status = 'active'
      AND (
        au.console_role_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.console_role_permission crp
          JOIN public.console_role cr ON cr.console_role_id = crp.console_role_id
          WHERE crp.console_role_id = au.console_role_id
            AND crp.permission_key = 'console.backup.manage'
            AND crp.is_granted = true
            AND cr.is_active = true
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.enforce_backup_restore_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'restore requests are never deleted' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' THEN
      RAISE EXCEPTION 'a restore request must start as requested' USING ERRCODE = '22023';
    END IF;
    IF NEW.decided_by IS NOT NULL OR NEW.decision_note IS NOT NULL
       OR NEW.workflow_run_id IS NOT NULL OR NEW.workflow_run_url IS NOT NULL
       OR NEW.result_conclusion IS NOT NULL THEN
      RAISE EXCEPTION 'a new restore request cannot carry a decision or a dispatch' USING ERRCODE = '22023';
    END IF;
    IF NOT public.backup_restore_actor_allowed(NEW.requested_by) THEN
      RAISE EXCEPTION 'the requester must be an active super admin with console.backup.manage'
        USING ERRCODE = '42501';
    END IF;
    NEW.requested_at := now();
    NEW.decided_at := NULL;
    NEW.dispatched_at := NULL;
    NEW.completed_at := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('rejected', 'cancelled', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'restore request is closed (%)', OLD.status USING ERRCODE = '22023';
  END IF;

  IF NEW.restore_request_id IS DISTINCT FROM OLD.restore_request_id
     OR NEW.backup_run_id IS DISTINCT FROM OLD.backup_run_id
     OR NEW.backup_artifact_id IS DISTINCT FROM OLD.backup_artifact_id
     OR NEW.backup_created_at IS DISTINCT FROM OLD.backup_created_at
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'restore request identity columns are immutable' USING ERRCODE = '22023';
  END IF;

  -- Timestamps belong to the trigger.
  NEW.decided_at := OLD.decided_at;
  NEW.dispatched_at := OLD.dispatched_at;
  NEW.completed_at := OLD.completed_at;

  -- A linked run is set once, and only while the request is dispatched.
  IF (NEW.workflow_run_id IS DISTINCT FROM OLD.workflow_run_id
      OR NEW.workflow_run_url IS DISTINCT FROM OLD.workflow_run_url)
     AND (OLD.status <> 'dispatched' OR OLD.workflow_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'the workflow run is linked once, while dispatched' USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by
       OR NEW.decision_note IS DISTINCT FROM OLD.decision_note
       OR NEW.result_conclusion IS DISTINCT FROM OLD.result_conclusion THEN
      RAISE EXCEPTION 'the decision and result change only with a status change' USING ERRCODE = '22023';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NOT (
       (OLD.status = 'requested'  AND NEW.status IN ('approved', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved'   AND NEW.status IN ('dispatched', 'failed'))
    OR (OLD.status = 'dispatched' AND NEW.status IN ('succeeded', 'failed'))
  ) THEN
    RAISE EXCEPTION 'illegal restore request transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IN ('approved', 'rejected') THEN
    IF NEW.decided_by IS NULL OR NEW.decided_by = OLD.requested_by THEN
      RAISE EXCEPTION 'a restore request must be decided by a different super admin'
        USING ERRCODE = '22023';
    END IF;
    IF NOT public.backup_restore_actor_allowed(NEW.decided_by) THEN
      RAISE EXCEPTION 'the decider must be an active super admin with console.backup.manage'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.app_user au
                   WHERE au.user_id = NEW.decided_by AND au.created_at < OLD.requested_at) THEN
      RAISE EXCEPTION 'the decider''s account must predate the request' USING ERRCODE = '42501';
    END IF;
    IF NEW.result_conclusion IS DISTINCT FROM OLD.result_conclusion THEN
      RAISE EXCEPTION 'a decision carries no result' USING ERRCODE = '22023';
    END IF;
    NEW.decided_at := now();
  ELSE
    -- Every other transition keeps the decision as it was ...
    IF NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
      RAISE EXCEPTION 'the decision note is set only with the decision' USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'cancelled' THEN
      -- ... except cancel: decided_by carries the canceller, who must be the
      -- requester, and is then cleared to keep the maker-checker CHECK meaningful.
      IF NEW.decided_by IS DISTINCT FROM OLD.requested_by THEN
        RAISE EXCEPTION 'only the requester can cancel a restore request' USING ERRCODE = '22023';
      END IF;
      NEW.decided_by := NULL;
      NEW.decided_at := now();
    ELSIF NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
      RAISE EXCEPTION 'decided_by changes only with a decision' USING ERRCODE = '22023';
    ELSIF NEW.status = 'dispatched' THEN
      IF NEW.result_conclusion IS DISTINCT FROM OLD.result_conclusion THEN
        RAISE EXCEPTION 'a dispatch carries no result' USING ERRCODE = '22023';
      END IF;
      NEW.dispatched_at := now();
    ELSE -- succeeded | failed
      NEW.completed_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_enforce_backup_restore_request
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_backup_restore_request
  FOR EACH ROW EXECUTE FUNCTION public.enforce_backup_restore_request();

CREATE OR REPLACE FUNCTION public.refuse_backup_restore_request_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'restore requests are never deleted' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE TRIGGER trg_refuse_backup_restore_request_truncate
  BEFORE TRUNCATE ON public.platform_backup_restore_request
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_backup_restore_request_truncate();

-- 3. Audit trail ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_backup_restore_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.workflow_run_id IS DISTINCT FROM OLD.workflow_run_id THEN
    INSERT INTO public.audit_log (actor_user_id, entity_name, entity_id, action_type,
                                  old_value_json, new_value_json)
    VALUES (
      CASE WHEN TG_OP = 'INSERT' THEN NEW.requested_by
           WHEN NEW.status IN ('approved', 'rejected') THEN NEW.decided_by
           WHEN NEW.status = 'cancelled' THEN NEW.requested_by
           ELSE NULL END,
      'platform_backup_restore_request',
      NEW.restore_request_id::text,
      CASE WHEN TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
           THEN 'BACKUP_RESTORE_RUN_LINKED'
           ELSE 'BACKUP_RESTORE_' || upper(NEW.status) END,
      CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) END,
      jsonb_build_object('status', NEW.status, 'mode', NEW.mode,
                         'backup_run_id', NEW.backup_run_id,
                         'workflow_run_id', NEW.workflow_run_id,
                         'result_conclusion', NEW.result_conclusion)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_backup_restore_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_backup_restore_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refuse_backup_restore_request_truncate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backup_restore_actor_allowed(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_log_backup_restore_request
  AFTER INSERT OR UPDATE ON public.platform_backup_restore_request
  FOR EACH ROW EXECUTE FUNCTION public.log_backup_restore_request();

COMMENT ON TABLE public.platform_backup_restore_request IS
  'Super-admin restore requests (maker-checker). Written only by the backup-admin Edge Function; restore never targets production. See docs/backup-restore-runbook.md.';
