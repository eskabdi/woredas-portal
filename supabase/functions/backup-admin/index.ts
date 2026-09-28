//
// backup-admin: the super-admin console's only path to the backup system.
//
// Caller: an ACTIVE super_admin holding console.backup.manage (checked with
// user_has_console_perm() evaluated as the caller). Everything else is
// refused before any GitHub call. The GitHub token (GITHUB_BACKUP_TOKEN, a
// fine-grained token scoped to this one repository with Actions read/write)
// lives only here; the browser never sees it.
//
// POST { action, ... }:
//   status          -> backup runs + archives + restore-test results, restore
//                      requests (syncing any dispatched one with its GitHub
//                      run), schedule, configuration state
//   run_backup      -> dispatch nightly-backup.yml now
//   download        -> short-lived signed URL of an ENCRYPTED backup archive
//   request_restore -> create a restore request (maker)
//   decide_restore  -> approve or reject someone else's request (checker);
//                      approve dispatches restore-backup.yml
//   cancel_restore  -> requester withdraws their own pending request
//
// Restore never targets production: `verify` restores into an isolated
// sandbox inside the workflow; `restore_to_target` restores into the NEW
// project configured on the GitHub `restore` environment, and the workflow
// refuses the production project ref. Maker-checker, transitions and the
// audit trail are enforced by the table's triggers (migration 94) as well
// as here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The service-role client, typed without the generated database types
// (Edge Functions do not import src/integrations/supabase/types.ts).
type Admin = ReturnType<typeof createClient>;

interface RequestRow {
  restore_request_id: string;
  status: string;
  workflow_run_id: number | null;
}

import { corsHeaders, json, safeError } from "../_shared/response.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { getClientIp } from "../_shared/clientIp.ts";
import {
  artifactDownloadUrl,
  assertRepo,
  BACKUP_WORKFLOW_FILE,
  dispatchWorkflow,
  findRestoreRun,
  getBackupArtifact,
  type GithubConfig,
  GithubError,
  InputError,
  listBackupRuns,
  nextScheduledRun,
  requireId,
  requireMode,
  requireText,
  requireUuid,
  RESTORE_WORKFLOW_FILE,
} from "./github.ts";

const PERM = "console.backup.manage";
const TABLE = "platform_backup_restore_request";

// Per caller, per action: [limit, window seconds].
const LIMITS: Record<string, [number, number]> = {
  status: [60, 60],
  run_backup: [3, 3600],
  download: [20, 3600],
  request_restore: [10, 3600],
  decide_restore: [20, 3600],
  cancel_restore: [20, 3600],
};

function githubConfig(): GithubConfig | null {
  const token = Deno.env.get("GITHUB_BACKUP_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO") ?? "eskabdi/woredas-portal";
  if (!token) return null;
  assertRepo(repo);
  return {
    token,
    repo,
    ref: Deno.env.get("GITHUB_BACKUP_REF") ?? "main",
    // Test hook only: lets a local run point at a mock GitHub API.
    apiBase: Deno.env.get("GITHUB_API_BASE") ?? undefined,
  };
}

const NOT_CONFIGURED = "Backup integration is not configured";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, 401, { error: "Missing authorization header" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(req, 401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    // Evaluated AS THE CALLER: active super_admin + (unrestricted or a console
    // role granting console.backup.manage).
    const { data: allowed, error: permErr } = await userClient.rpc("user_has_console_perm", {
      _perm: PERM,
    });
    if (permErr || allowed !== true) {
      return json(req, 403, { error: "Forbidden: console.backup.manage required" });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json(req, 400, { error: "Invalid JSON body" });
    }
    const action = typeof body?.action === "string" ? body.action : "";
    if (!(action in LIMITS)) return json(req, 400, { error: "Unknown action" });

    const [limit, windowS] = LIMITS[action];
    const { allowed: withinLimit } = await checkRateLimit(
      admin,
      `backup-admin:${action}:${callerId}`,
      limit,
      windowS,
    );
    if (!withinLimit) return json(req, 429, { error: "Too many requests" });

    let gh: GithubConfig | null;
    try {
      gh = githubConfig();
    } catch (e) {
      return safeError(req, "backup-admin: bad GITHUB_REPO", e, NOT_CONFIGURED, 503);
    }
    const audit = (action_type: string, entity_id: string | null, value: Record<string, unknown>) =>
      admin.from("audit_log").insert({
        actor_user_id: callerId,
        entity_name: "platform_backup",
        entity_id,
        action_type,
        new_value_json: value,
        source_ip: getClientIp(req),
      });

    try {
      switch (action) {
        case "status":
          return json(req, 200, await status(admin, gh, callerId));

        case "run_backup": {
          if (!gh) return json(req, 503, { error: NOT_CONFIGURED });
          await dispatchWorkflow(gh, BACKUP_WORKFLOW_FILE, {});
          await audit("BACKUP_RUN_REQUESTED", null, { workflow: BACKUP_WORKFLOW_FILE });
          return json(req, 202, { success: true });
        }

        case "download": {
          if (!gh) return json(req, 503, { error: NOT_CONFIGURED });
          const artifactId = requireId(body.artifact_id, "artifact_id");
          const { runId } = await getBackupArtifact(gh, artifactId);
          const url = await artifactDownloadUrl(gh, artifactId);
          await audit("BACKUP_ARCHIVE_DOWNLOADED", String(artifactId), { backup_run_id: runId });
          // The archive is age-encrypted; the URL is GitHub's ~1 minute
          // signed link to that ciphertext.
          return json(req, 200, { url });
        }

        case "request_restore": {
          if (!gh) return json(req, 503, { error: NOT_CONFIGURED });
          const artifactId = requireId(body.artifact_id, "artifact_id");
          const mode = requireMode(body.mode);
          const reason = requireText(body.reason, "reason", 10, 1000);
          const { runId, runCreatedAt } = await getBackupArtifact(gh, artifactId);
          const { data, error } = await admin
            .from(TABLE)
            .insert({
              backup_run_id: runId,
              backup_artifact_id: artifactId,
              backup_created_at: runCreatedAt,
              mode,
              reason,
              requested_by: callerId,
            })
            .select("restore_request_id")
            .maybeSingle();
          if (error || !data) {
            return safeError(
              req,
              "backup-admin: insert request",
              error,
              "Could not create restore request",
              500,
            );
          }
          return json(req, 201, { restore_request_id: data.restore_request_id });
        }

        case "decide_restore": {
          const id = requireUuid(body.restore_request_id, "restore_request_id");
          const decision = body.decision;
          if (decision !== "approve" && decision !== "reject") {
            return json(req, 400, { error: "decision must be approve or reject" });
          }
          const note =
            body.note === undefined || body.note === null || body.note === ""
              ? null
              : requireText(body.note, "note", 1, 1000);
          if (decision === "reject" && !note) {
            return json(req, 400, { error: "A rejection needs a note" });
          }
          if (decision === "approve" && !gh) return json(req, 503, { error: NOT_CONFIGURED });

          const { data: row } = await admin
            .from(TABLE)
            .select("restore_request_id, status, requested_by, backup_artifact_id, mode")
            .eq("restore_request_id", id)
            .maybeSingle();
          if (!row) return json(req, 404, { error: "Restore request not found" });
          if (row.requested_by === callerId) {
            return json(req, 403, {
              error: "A restore request must be decided by a different super admin",
            });
          }
          if (row.status !== "requested") {
            return json(req, 409, { error: "Restore request is no longer pending" });
          }
          if (decision === "approve") {
            // The archive may have expired since the request was made.
            await getBackupArtifact(gh!, row.backup_artifact_id);
          }

          const { data: decided, error: decErr } = await admin
            .from(TABLE)
            .update({
              status: decision === "approve" ? "approved" : "rejected",
              decided_by: callerId,
              decision_note: note,
            })
            .eq("restore_request_id", id)
            .eq("status", "requested")
            .select("restore_request_id")
            .maybeSingle();
          if (decErr || !decided) {
            return safeError(
              req,
              "backup-admin: decide",
              decErr,
              "Restore request is no longer pending",
              409,
            );
          }
          if (decision === "reject") return json(req, 200, { status: "rejected" });

          try {
            await dispatchWorkflow(gh!, RESTORE_WORKFLOW_FILE, {
              request_id: id,
              artifact_id: String(row.backup_artifact_id),
              mode: row.mode,
            });
          } catch (e) {
            await admin
              .from(TABLE)
              .update({ status: "failed", result_conclusion: "dispatch_failed" })
              .eq("restore_request_id", id);
            return safeError(
              req,
              "backup-admin: dispatch restore",
              e,
              "Could not start the restore workflow",
              502,
            );
          }
          await admin.from(TABLE).update({ status: "dispatched" }).eq("restore_request_id", id);
          return json(req, 202, { status: "dispatched" });
        }

        case "cancel_restore": {
          const id = requireUuid(body.restore_request_id, "restore_request_id");
          const { data, error } = await admin
            .from(TABLE)
            .update({ status: "cancelled", decided_by: callerId })
            .eq("restore_request_id", id)
            .eq("requested_by", callerId)
            .eq("status", "requested")
            .select("restore_request_id")
            .maybeSingle();
          if (error || !data) {
            return json(req, 409, { error: "Only your own pending request can be cancelled" });
          }
          return json(req, 200, { status: "cancelled" });
        }
      }
      return json(req, 400, { error: "Unknown action" });
    } catch (e) {
      if (e instanceof InputError) return json(req, 400, { error: e.message });
      if (e instanceof GithubError) {
        const status = e.status === 404 ? 404 : 502;
        return safeError(
          req,
          `backup-admin: ${action}`,
          e,
          status === 404 ? "Backup not found" : "GitHub request failed",
          status,
        );
      }
      throw e;
    }
  } catch (e) {
    return safeError(req, "backup-admin: unhandled", e, "Internal error", 500);
  }
});

async function status(admin: Admin, gh: GithubConfig | null, callerId: string) {
  let requests = await loadRequests(admin);

  let runs: Awaited<ReturnType<typeof listBackupRuns>> = [];
  let githubError: string | null = null;
  if (gh) {
    try {
      runs = await listBackupRuns(gh);
      // Bring any dispatched request up to date with its workflow run.
      let changed = false;
      for (const r of requests.filter((x) => x.status === "dispatched")) {
        const run = await findRestoreRun(gh, r.restore_request_id);
        if (!run) continue;
        const patch: Record<string, unknown> = {};
        if (r.workflow_run_id !== run.id) {
          patch.workflow_run_id = run.id;
          patch.workflow_run_url = run.url;
        }
        if (run.state === "succeeded" || run.state === "failed" || run.state === "cancelled") {
          patch.status = run.state === "succeeded" ? "succeeded" : "failed";
          patch.result_conclusion = run.conclusion;
        }
        if (Object.keys(patch).length) {
          await admin.from(TABLE).update(patch).eq("restore_request_id", r.restore_request_id);
          changed = true;
        }
      }
      if (changed) requests = await loadRequests(admin);
    } catch (e) {
      console.error("backup-admin: GitHub status", e);
      githubError = e instanceof GithubError && e.status === 401 ? "token_rejected" : "unreachable";
    }
  }

  return {
    configured: !!gh,
    github_error: githubError,
    me: callerId,
    schedule: {
      description: "Daily 00:17 UTC (03:17 Addis Ababa, 9:17 ለሊት)",
      next_run_at: nextScheduledRun(new Date()).toISOString(),
      retention_days: 30,
    },
    runs,
    requests,
  };
}

async function loadRequests(admin: Admin): Promise<RequestRow[]> {
  const { data, error } = await admin
    .from(TABLE)
    .select(
      "restore_request_id, backup_run_id, backup_artifact_id, backup_created_at, mode, reason, status, requested_by, requested_at, decided_by, decided_at, decision_note, dispatched_at, workflow_run_id, workflow_run_url, completed_at, result_conclusion, requester:app_user!platform_backup_restore_request_requested_by_fkey(full_name), decider:app_user!platform_backup_restore_request_decided_by_fkey(full_name)",
    )
    .order("requested_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as RequestRow[];
}
