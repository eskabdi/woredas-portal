// GitHub Actions client and input validation for the backup-admin Edge
// Function. Plain TypeScript with no Deno or esm.sh imports, so the Vitest
// suite can exercise it against a mocked fetch
// (supabase/functions/backup-admin/__tests__/github.test.ts).
//
// Only the Edge Function ever holds the GitHub token; the browser never
// talks to GitHub. Every id that reaches a GitHub URL is validated as a
// positive integer first, so no caller-supplied string is ever
// interpolated into a request path.

export const BACKUP_WORKFLOW_FILE = "nightly-backup.yml";
export const RESTORE_WORKFLOW_FILE = "restore-backup.yml";
/** Must equal the step name in nightly-backup.yml (a test checks it). */
export const RESTORE_TEST_STEP_NAME = "Test restore into a fresh Supabase stack";
/** Must equal the artifact name prefix in nightly-backup.yml. */
export const BACKUP_ARTIFACT_PREFIX = "woredas-backup-";
/** Nightly schedule in nightly-backup.yml: 00:17 UTC (03:17 Addis Ababa). */
export const BACKUP_CRON_UTC = { hour: 0, minute: 17 };
/** The only branch whose runs count as backups (restore-backup.yml checks the same). */
export const BACKUP_REF = "main";
/**
 * Events that can produce a real backup. A pull_request run executes the PR's
 * own copy of nightly-backup.yml -- from a fork whose branch may well be
 * called "main" -- so it must never count as one.
 */
export const BACKUP_EVENTS: readonly string[] = ["schedule", "workflow_dispatch"];
/** Version tag of the approval signature restore-backup.yml verifies. */
export const APPROVAL_VERSION = "restore-approval.v1";

export type RestoreMode = "verify" | "restore_to_target";

export interface GithubConfig {
  token: string;
  /** "owner/repo" */
  repo: string;
  /** Branch whose workflow definitions run, and whose runs count as backups. */
  ref: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export class GithubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class InputError extends Error {}

// ---------------------------------------------------------------- validation

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/;

export function requireUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} must be a UUID`);
  return v.toLowerCase();
}

export function requireId(v: unknown, field: string): number {
  const n = typeof v === "string" && /^[0-9]{1,15}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) {
    throw new InputError(`${field} must be a positive integer id`);
  }
  return n;
}

export function requireMode(v: unknown): RestoreMode {
  if (v !== "verify" && v !== "restore_to_target") {
    throw new InputError("mode must be verify or restore_to_target");
  }
  return v;
}

export function requireText(v: unknown, field: string, min: number, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min || s.length > max) {
    throw new InputError(`${field} must be ${min}-${max} characters`);
  }
  return s;
}

export function assertRepo(repo: string): void {
  if (!REPO_RE.test(repo)) throw new InputError("GITHUB_REPO must be owner/repo");
}

// ---------------------------------------------------------------- schedule

/** Next nightly run strictly after `now`. */
export function nextScheduledRun(now: Date): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      BACKUP_CRON_UTC.hour,
      BACKUP_CRON_UTC.minute,
    ),
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// ---------------------------------------------------------------- HTTP

async function gh(cfg: GithubConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const f = cfg.fetchImpl ?? fetch;
  const res = await f(`${cfg.apiBase ?? "https://api.github.com"}/repos/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "woredas-portal-backup-admin",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status >= 400) {
    // Only the status leaves this module; GitHub's body can name the repo,
    // the token's scopes or internal URLs.
    throw new GithubError(res.status, `GitHub API ${res.status}`);
  }
  return res;
}

async function ghJson<T>(cfg: GithubConfig, path: string): Promise<T> {
  return (await (await gh(cfg, path)).json()) as T;
}

// ---------------------------------------------------------------- shapes

interface GhRun {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url: string;
  head_branch: string;
  head_repository?: { full_name?: string } | null;
  path: string;
  display_title: string;
}
interface GhArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string;
  expires_at: string;
  workflow_run?: { id: number; head_branch?: string };
}
interface GhJob {
  steps?: { name: string; status: string; conclusion: string | null }[];
}

export type RunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RestoreTestState = "passed" | "failed" | "not_run" | "pending";

export interface BackupArtifact {
  id: number;
  name: string;
  sizeBytes: number;
  expired: boolean;
  expiresAt: string;
}

export interface BackupRun {
  id: number;
  state: RunState;
  trigger: "scheduled" | "manual";
  createdAt: string;
  updatedAt: string;
  url: string;
  restoreTest: RestoreTestState;
  artifact: BackupArtifact | null;
}

export function runState(r: Pick<GhRun, "status" | "conclusion">): RunState {
  if (
    r.status === "queued" ||
    r.status === "waiting" ||
    r.status === "requested" ||
    r.status === "pending"
  ) {
    return "queued";
  }
  if (r.status !== "completed") return "running";
  if (r.conclusion === "success") return "succeeded";
  if (r.conclusion === "cancelled" || r.conclusion === "skipped") return "cancelled";
  return "failed";
}

function restoreTestState(run: GhRun, jobs: GhJob[] | null): RestoreTestState {
  if (run.status !== "completed") return "pending";
  const step = (jobs ?? [])
    .flatMap((j) => j.steps ?? [])
    .find((s) => s.name === RESTORE_TEST_STEP_NAME);
  if (!step || step.conclusion === null || step.conclusion === "skipped") return "not_run";
  return step.conclusion === "success" ? "passed" : "failed";
}

function toArtifact(a: GhArtifact): BackupArtifact {
  return {
    id: a.id,
    name: a.name,
    sizeBytes: a.size_in_bytes,
    expired: a.expired,
    expiresAt: a.expires_at,
  };
}

// ---------------------------------------------------------------- operations

/**
 * True only for a run of THIS repository's nightly-backup.yml on `ref`,
 * started by the schedule or a dispatch -- never a pull_request run, whose
 * head_branch is the (attacker-chosen) fork branch name.
 */
export function isBackupRun(cfg: GithubConfig, run: GhRun): boolean {
  return (
    run.path === `.github/workflows/${BACKUP_WORKFLOW_FILE}` &&
    run.head_branch === cfg.ref &&
    BACKUP_EVENTS.includes(run.event) &&
    run.head_repository?.full_name === cfg.repo
  );
}

// Best-effort, per-isolate cache. A completed run's jobs never change and its
// artifact only expires, so its details are reused for a while; the run list
// itself briefly. Keeps a watched status page well inside the token's hourly
// GitHub API budget.
const RUN_LIST_TTL_MS = 30_000;
const RUN_DETAIL_TTL_MS = 10 * 60_000;
const runListCache = new Map<string, { at: number; runs: BackupRun[] }>();
const runDetailCache = new Map<
  string,
  { at: number; restoreTest: RestoreTestState; artifact: BackupArtifact | null }
>();

/** Test hook. */
export function clearGithubCache(): void {
  runListCache.clear();
  runDetailCache.clear();
}

/** Recent nightly-backup runs on `ref`, each with its archive and restore-test result. */
export async function listBackupRuns(
  cfg: GithubConfig,
  limit = 10,
  now = Date.now(),
): Promise<BackupRun[]> {
  const listKey = `${cfg.repo}|${cfg.ref}|${limit}`;
  const cached = runListCache.get(listKey);
  if (cached && now - cached.at < RUN_LIST_TTL_MS) return cached.runs;

  const { workflow_runs } = await ghJson<{ workflow_runs: GhRun[] }>(
    cfg,
    `/actions/workflows/${BACKUP_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(cfg.ref)}&per_page=${limit}`,
  );
  const runs = await Promise.all(
    workflow_runs
      .filter((run) => isBackupRun(cfg, run))
      .map(async (run) => {
        const detailKey = `${cfg.repo}|${run.id}`;
        let detail = run.status === "completed" ? runDetailCache.get(detailKey) : undefined;
        if (!detail || now - detail.at >= RUN_DETAIL_TTL_MS) {
          const [arts, jobs] = await Promise.all([
            ghJson<{ artifacts: GhArtifact[] }>(cfg, `/actions/runs/${run.id}/artifacts`),
            run.status === "completed"
              ? ghJson<{ jobs: GhJob[] }>(cfg, `/actions/runs/${run.id}/jobs`).then((j) => j.jobs)
              : Promise.resolve(null),
          ]);
          const art = arts.artifacts.find((a) => a.name.startsWith(BACKUP_ARTIFACT_PREFIX));
          detail = {
            at: now,
            restoreTest: restoreTestState(run, jobs),
            artifact: art ? toArtifact(art) : null,
          };
          if (run.status === "completed") runDetailCache.set(detailKey, detail);
        }
        return {
          id: run.id,
          state: runState(run),
          trigger: run.event === "schedule" ? "scheduled" : "manual",
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          url: run.html_url,
          restoreTest: detail.restoreTest,
          artifact: detail.artifact,
        } satisfies BackupRun;
      }),
  );
  runListCache.set(listKey, { at: now, runs });
  return runs;
}

/**
 * The artifact, but only if it is an unexpired backup archive produced by a
 * successful scheduled or dispatched nightly-backup.yml run of this repository
 * on `ref` -- never an arbitrary artifact of the repo (a restore request or a
 * download must not be pointed at, say, an archive a fork pull request
 * uploaded).
 */
export async function getBackupArtifact(
  cfg: GithubConfig,
  artifactId: number,
): Promise<{ artifact: BackupArtifact; runId: number; runCreatedAt: string }> {
  const a = await ghJson<GhArtifact>(cfg, `/actions/artifacts/${artifactId}`);
  const runId = a.workflow_run?.id;
  if (!runId || !a.name.startsWith(BACKUP_ARTIFACT_PREFIX)) {
    throw new InputError("not a backup archive");
  }
  const run = await ghJson<GhRun>(cfg, `/actions/runs/${runId}`);
  if (!isBackupRun(cfg, run) || run.status !== "completed" || run.conclusion !== "success") {
    throw new InputError("not a backup archive");
  }
  if (a.expired) throw new InputError("backup archive has expired");
  return { artifact: toArtifact(a), runId, runCreatedAt: run.created_at };
}

/** Short-lived signed URL for the (encrypted) archive zip. */
export async function artifactDownloadUrl(cfg: GithubConfig, artifactId: number): Promise<string> {
  const res = await gh(cfg, `/actions/artifacts/${artifactId}/zip`, { redirect: "manual" });
  const loc = res.headers.get("Location");
  if (res.status !== 302 || !loc || !loc.startsWith("https://")) {
    throw new GithubError(502, "GitHub did not return a download location");
  }
  return loc;
}

export async function dispatchWorkflow(
  cfg: GithubConfig,
  file: string,
  inputs: Record<string, string>,
): Promise<void> {
  await gh(cfg, `/actions/workflows/${file}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: cfg.ref, inputs }),
  });
}

export interface RestoreRunMatch {
  id: number;
  state: RunState;
  url: string;
  conclusion: string | null;
}

/**
 * Recent restore-backup.yml runs of this repository on `ref`, fetched ONCE
 * per status call and matched to each dispatched request with
 * matchRestoreRun().
 */
export async function listRestoreRuns(cfg: GithubConfig): Promise<GhRun[]> {
  const { workflow_runs } = await ghJson<{ workflow_runs: GhRun[] }>(
    cfg,
    `/actions/workflows/${RESTORE_WORKFLOW_FILE}/runs?event=workflow_dispatch&branch=${encodeURIComponent(cfg.ref)}&per_page=50`,
  );
  return workflow_runs.filter(
    (r) =>
      r.path === `.github/workflows/${RESTORE_WORKFLOW_FILE}` &&
      r.head_branch === cfg.ref &&
      r.event === "workflow_dispatch" &&
      r.head_repository?.full_name === cfg.repo,
  );
}

/** Allowed clock difference between the database and GitHub. */
const DISPATCH_SKEW_MS = 2 * 60_000;

/**
 * The run for a request. workflow_dispatch returns no run id, so the
 * workflow's run-name carries the request id (set from the validated UUID
 * input, nothing else). A later run reusing the same id -- a hand dispatch --
 * cannot take over: only runs created after the request was dispatched count,
 * and the EARLIEST of those wins.
 */
export function matchRestoreRun(
  runs: GhRun[],
  requestId: string,
  dispatchedAt: string,
): RestoreRunMatch | null {
  const floor = Date.parse(dispatchedAt) - DISPATCH_SKEW_MS;
  const run = runs
    .filter((r) => r.display_title.endsWith(` ${requestId}`) && Date.parse(r.created_at) >= floor)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)[0];
  return run
    ? { id: run.id, state: runState(run), url: run.html_url, conclusion: run.conclusion }
    : null;
}

// ---------------------------------------------------------------- approval

/**
 * The message an approved dispatch signs. restore-backup.yml rebuilds the
 * same string from its inputs and checks the HMAC with the key held on the
 * `restore` environment, so a dispatch that did not come from an approved
 * request (someone holding the GitHub token or repository write access) is
 * refused before anything is decrypted.
 */
export function approvalMessage(
  requestId: string,
  artifactId: number,
  mode: RestoreMode,
  issuedAt: number,
): string {
  return `${APPROVAL_VERSION}|${requestId}|${artifactId}|${mode}|${issuedAt}`;
}

export async function signApproval(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
