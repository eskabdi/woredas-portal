import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approvalMessage,
  APPROVAL_VERSION,
  artifactDownloadUrl,
  assertRepo,
  BACKUP_ARTIFACT_PREFIX,
  BACKUP_CRON_UTC,
  clearGithubCache,
  getBackupArtifact,
  type GithubConfig,
  GithubError,
  InputError,
  listBackupRuns,
  listRestoreRuns,
  matchRestoreRun,
  nextScheduledRun,
  requireId,
  requireMode,
  requireText,
  requireUuid,
  RESTORE_TEST_STEP_NAME,
  runState,
  signApproval,
} from "../github";

const ROOT = join(__dirname, "..", "..", "..", "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");
const VERIFY_APPROVAL = join(ROOT, "scripts", "backup", "verify-approval.py");
const nightly = readFileSync(join(WORKFLOWS, "nightly-backup.yml"), "utf-8");
const restore = readFileSync(join(WORKFLOWS, "restore-backup.yml"), "utf-8");

type Route = (url: string, init?: RequestInit) => Response | undefined;

function mockGithub(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return route(u, init) ?? new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const cfg: GithubConfig = {
    token: "test-token",
    repo: "o/r",
    ref: "main",
    apiBase: "https://gh.test",
    fetchImpl,
  };
  return { cfg, calls };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const RUN = {
  id: 11,
  status: "completed",
  conclusion: "success",
  event: "schedule",
  created_at: "2026-09-28T00:17:00Z",
  updated_at: "2026-09-28T00:25:00Z",
  html_url: "https://github.com/o/r/actions/runs/11",
  head_branch: "main",
  head_repository: { full_name: "o/r" },
  path: ".github/workflows/nightly-backup.yml",
  display_title: "Nightly backup",
};
const ART = {
  id: 22,
  name: "woredas-backup-11",
  size_in_bytes: 120_000,
  expired: false,
  created_at: RUN.created_at,
  expires_at: "2026-10-28T00:25:00Z",
  workflow_run: { id: 11, head_branch: "main" },
};

beforeEach(() => clearGithubCache());

describe("input validation", () => {
  it("ids must be positive safe integers; numeric strings are accepted", () => {
    expect(requireId(5, "x")).toBe(5);
    expect(requireId("123", "x")).toBe(123);
    for (const bad of [
      0,
      -1,
      1.5,
      "1/../2",
      "abc",
      null,
      undefined,
      2 ** 60,
      "12345678901234567",
    ]) {
      expect(() => requireId(bad, "x")).toThrow(InputError);
    }
  });
  it("uuids", () => {
    expect(requireUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301", "x")).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
    expect(() => requireUuid("not-a-uuid", "x")).toThrow(InputError);
    expect(() => requireUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301' or 1=1", "x")).toThrow();
  });
  it("mode and text", () => {
    expect(requireMode("verify")).toBe("verify");
    expect(() => requireMode("restore_to_production")).toThrow(InputError);
    expect(requireText("  enough text here  ", "reason", 10, 20)).toBe("enough text here");
    expect(() => requireText("short", "reason", 10, 20)).toThrow("reason must be 10-20 characters");
    expect(() => requireText(42, "reason", 10, 20)).toThrow(InputError);
  });
  it("GITHUB_REPO must be a plain owner/repo", () => {
    expect(() => assertRepo("eskabdi/woredas-portal")).not.toThrow();
    for (const bad of ["../..", "o/..", "o/.", "o", "o/r/x", "-o/r", "o/r?x=1"]) {
      expect(() => assertRepo(bad)).toThrow(InputError);
    }
  });
});

describe("schedule", () => {
  it("matches the cron in nightly-backup.yml", () => {
    expect(nightly).toContain(`cron: "${BACKUP_CRON_UTC.minute} ${BACKUP_CRON_UTC.hour} * * *"`);
  });
  it("next run is the next 00:17 UTC strictly after now", () => {
    expect(nextScheduledRun(new Date("2026-09-28T00:10:00Z")).toISOString()).toBe(
      "2026-09-28T00:17:00.000Z",
    );
    expect(nextScheduledRun(new Date("2026-09-28T00:17:00Z")).toISOString()).toBe(
      "2026-09-29T00:17:00.000Z",
    );
    expect(nextScheduledRun(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:17:00.000Z",
    );
  });
});

describe("constants stay in step with the workflows", () => {
  it("the restore-test step name exists in nightly-backup.yml", () => {
    expect(nightly).toContain(`- name: ${RESTORE_TEST_STEP_NAME}`);
  });
  it("the artifact name prefix matches nightly-backup.yml", () => {
    expect(nightly).toContain(`name: ${BACKUP_ARTIFACT_PREFIX}\${{ github.run_id }}`);
  });
  it("restore-backup.yml carries the request id in its run-name (matchRestoreRun relies on it)", () => {
    expect(restore).toMatch(/^run-name: .*\$\{\{ inputs\.request_id \}\}/m);
  });
  it("restore-backup.yml refuses the production project", () => {
    expect(restore).toContain("names the production project");
  });
  it("restore-backup.yml takes the approval inputs and checks them before decrypting", () => {
    expect(restore).toMatch(/^ {6}issued_at:$/m);
    expect(restore).toMatch(/^ {6}approval:$/m);
    const check = restore.indexOf("scripts/backup/verify-approval.py");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(restore.indexOf("age -d"));
    expect(readFileSync(VERIFY_APPROVAL, "utf-8")).toContain(`"${APPROVAL_VERSION}"`);
  });
  it("restore-backup.yml checks the archive's event and repository, not just path + branch", () => {
    expect(restore).toContain('(.event == "schedule" or .event == "workflow_dispatch")');
    expect(restore).toContain(".head_repository.full_name == $repo");
  });
});

describe("runState", () => {
  it.each([
    [{ status: "queued", conclusion: null }, "queued"],
    [{ status: "in_progress", conclusion: null }, "running"],
    [{ status: "completed", conclusion: "success" }, "succeeded"],
    [{ status: "completed", conclusion: "failure" }, "failed"],
    [{ status: "completed", conclusion: "timed_out" }, "failed"],
    [{ status: "completed", conclusion: "cancelled" }, "cancelled"],
  ] as const)("%o -> %s", (run, expected) => {
    expect(runState(run)).toBe(expected);
  });
});

describe("listBackupRuns", () => {
  it("joins each run with its archive and restore-test step", async () => {
    const failedTest = { ...RUN, id: 12, conclusion: "failure", event: "workflow_dispatch" };
    const running = { ...RUN, id: 13, status: "in_progress", conclusion: null };
    const { cfg, calls } = mockGithub((url) => {
      if (url.includes("/actions/workflows/nightly-backup.yml/runs"))
        return ok({ workflow_runs: [RUN, failedTest, running] });
      if (url.endsWith("/runs/11/artifacts")) return ok({ artifacts: [ART] });
      if (url.endsWith("/runs/12/artifacts")) return ok({ artifacts: [] });
      if (url.endsWith("/runs/13/artifacts")) return ok({ artifacts: [] });
      if (url.endsWith("/runs/11/jobs"))
        return ok({
          jobs: [
            {
              steps: [{ name: RESTORE_TEST_STEP_NAME, status: "completed", conclusion: "success" }],
            },
          ],
        });
      if (url.endsWith("/runs/12/jobs"))
        return ok({
          jobs: [
            {
              steps: [{ name: RESTORE_TEST_STEP_NAME, status: "completed", conclusion: "failure" }],
            },
          ],
        });
    });
    const runs = await listBackupRuns(cfg, 10, 1_000_000);
    expect(
      runs.map((r) => [r.id, r.state, r.trigger, r.restoreTest, r.artifact?.id ?? null]),
    ).toEqual([
      [11, "succeeded", "scheduled", "passed", 22],
      [12, "failed", "manual", "failed", null],
      [13, "running", "scheduled", "pending", null],
    ]);
    expect(calls[0]!.url).toContain("branch=main");
    expect(calls.some((c) => c.url.endsWith("/runs/13/jobs"))).toBe(false);
    const auth = (calls[0]!.init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe("Bearer test-token");

    // Within 30 s the listing is served from cache: no GitHub call at all.
    const before = calls.length;
    await listBackupRuns(cfg, 10, 1_020_000);
    expect(calls.length).toBe(before);
    // After that, completed runs' details are reused; only the list and the
    // still-running run are fetched again.
    await listBackupRuns(cfg, 10, 1_040_000);
    expect(calls.slice(before).map((c) => c.url.replace("https://gh.test/repos/o/r", ""))).toEqual([
      "/actions/workflows/nightly-backup.yml/runs?branch=main&per_page=10",
      "/actions/runs/13/artifacts",
    ]);
  });

  it("drops runs that are not this repository's scheduled or dispatched backups", async () => {
    const fork = { ...RUN, id: 14, event: "pull_request", head_repository: { full_name: "x/r" } };
    const prSameRepo = { ...RUN, id: 15, event: "pull_request" };
    const { cfg } = mockGithub((url) => {
      if (url.includes("/actions/workflows/nightly-backup.yml/runs"))
        return ok({ workflow_runs: [fork, prSameRepo, RUN] });
      if (url.endsWith("/artifacts")) return ok({ artifacts: [ART] });
      if (url.endsWith("/jobs")) return ok({ jobs: [] });
    });
    expect((await listBackupRuns(cfg)).map((r) => r.id)).toEqual([11]);
  });
});

describe("getBackupArtifact only accepts a nightly backup archive from ref", () => {
  const route =
    (art: object, run: object): Route =>
    (url) => {
      if (url.endsWith("/actions/artifacts/22")) return ok(art);
      if (url.endsWith("/actions/runs/11")) return ok(run);
    };

  it("accepts the real thing", async () => {
    const { cfg } = mockGithub(route(ART, RUN));
    const r = await getBackupArtifact(cfg, 22);
    expect(r.runId).toBe(11);
    expect(r.runCreatedAt).toBe(RUN.created_at);
  });
  it.each([
    ["another artifact name", { ...ART, name: "build-output" }, RUN, "not a backup archive"],
    ["another workflow", ART, { ...RUN, path: ".github/workflows/ci.yml" }, "not a backup archive"],
    ["another branch", ART, { ...RUN, head_branch: "attacker-branch" }, "not a backup archive"],
    // A fork PR named "main" that edits nightly-backup.yml runs under the
    // same path and branch name; event and head repository give it away.
    ["a pull_request run", ART, { ...RUN, event: "pull_request" }, "not a backup archive"],
    [
      "a fork's run",
      ART,
      { ...RUN, head_repository: { full_name: "attacker/r" } },
      "not a backup archive",
    ],
    ["a failed run", ART, { ...RUN, conclusion: "failure" }, "not a backup archive"],
    ["expired", { ...ART, expired: true }, RUN, "backup archive has expired"],
  ])("rejects %s", async (_label, art, run, message) => {
    const { cfg } = mockGithub(route(art, run));
    await expect(getBackupArtifact(cfg, 22)).rejects.toThrow(message);
  });
  it("turns a GitHub error into GithubError without its body", async () => {
    const { cfg } = mockGithub(() => new Response('{"message":"secret detail"}', { status: 404 }));
    const err = await getBackupArtifact(cfg, 22).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.status).toBe(404);
    expect(String(err.message)).not.toContain("secret detail");
  });
});

describe("artifactDownloadUrl", () => {
  it("returns GitHub's https redirect location without following it", async () => {
    const { cfg, calls } = mockGithub(
      () => new Response(null, { status: 302, headers: { Location: "https://blob.test/x?sig=1" } }),
    );
    expect(await artifactDownloadUrl(cfg, 22)).toBe("https://blob.test/x?sig=1");
    expect(calls[0]!.init?.redirect).toBe("manual");
  });
  it("refuses a non-https location", async () => {
    const { cfg } = mockGithub(
      () => new Response(null, { status: 302, headers: { Location: "http://blob.test/x" } }),
    );
    await expect(artifactDownloadUrl(cfg, 22)).rejects.toThrow(GithubError);
  });
});

describe("restore runs", () => {
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const restoreRun = (over: object) => ({
    ...RUN,
    path: ".github/workflows/restore-backup.yml",
    event: "workflow_dispatch",
    display_title: `Restore (verify) request ${id}`,
    ...over,
  });

  it("lists only this repository's dispatched restore runs on main", async () => {
    const { cfg, calls } = mockGithub(() =>
      ok({
        workflow_runs: [
          restoreRun({ id: 1 }),
          restoreRun({ id: 2, head_branch: "other" }),
          restoreRun({ id: 3, head_repository: { full_name: "x/r" } }),
          restoreRun({ id: 4, path: ".github/workflows/ci.yml" }),
        ],
      }),
    );
    expect((await listRestoreRuns(cfg)).map((r) => r.id)).toEqual([1]);
    expect(calls[0]!.url).toContain("event=workflow_dispatch&branch=main");
  });

  it("matches the EARLIEST run created after dispatch; a later replay cannot take over", () => {
    const runs = [
      restoreRun({ id: 9, created_at: "2026-09-28T10:20:00Z", conclusion: "failure" }),
      restoreRun({ id: 7, created_at: "2026-09-28T10:00:05Z" }),
      restoreRun({ id: 5, created_at: "2026-09-28T09:00:00Z" }), // before dispatch
      restoreRun({
        id: 8,
        created_at: "2026-09-28T10:00:30Z",
        display_title: "Restore (verify) request other",
      }),
    ] as Parameters<typeof matchRestoreRun>[0];
    expect(matchRestoreRun(runs, id, "2026-09-28T10:00:00Z")).toMatchObject({
      id: 7,
      state: "succeeded",
    });
    expect(
      matchRestoreRun(runs, "00000000-0000-4000-8000-000000000000", "2026-09-28T10:00:00Z"),
    ).toBeNull();
    expect(matchRestoreRun(runs, id, "2026-09-28T11:00:00Z")).toBeNull();
  });
});

describe("approval signature", () => {
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const key = "k".repeat(40);
  const issuedAt = 1790000000;

  it("signs a fixed, versioned message", async () => {
    expect(approvalMessage(id, 22, "verify", issuedAt)).toBe(
      `${APPROVAL_VERSION}|${id}|22|verify|${issuedAt}`,
    );
    const sig = await signApproval(key, approvalMessage(id, 22, "verify", issuedAt));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await signApproval(key, approvalMessage(id, 22, "restore_to_target", issuedAt)),
    ).not.toBe(sig);
  });

  // The workflow's verifier is the other half of the contract: run it.
  const python = spawnSync("python3", ["--version"]).status === 0;
  it.runIf(python)(
    "restore-backup.yml's verifier accepts exactly what backup-admin signs",
    async () => {
      const sig = await signApproval(key, approvalMessage(id, 22, "restore_to_target", issuedAt));
      const run = (over: Record<string, string>) =>
        spawnSync("python3", [VERIFY_APPROVAL], {
          env: {
            PATH: process.env.PATH ?? "",
            RESTORE_APPROVAL_KEY: key,
            REQUEST_ID: id,
            ARTIFACT_ID: "22",
            MODE: "restore_to_target",
            ISSUED_AT: String(issuedAt),
            APPROVAL: sig,
            RUN_CREATED: String(issuedAt + 3),
            ...over,
          },
        }).status;
      expect(run({})).toBe(0);
      expect(run({ MODE: "verify" })).toBe(1); // mode swapped
      expect(run({ ARTIFACT_ID: "23" })).toBe(1); // another archive
      expect(run({ REQUEST_ID: "00000000-0000-4000-8000-000000000000" })).toBe(1);
      expect(run({ RESTORE_APPROVAL_KEY: "x".repeat(40) })).toBe(1); // wrong key
      expect(run({ RESTORE_APPROVAL_KEY: "" })).toBe(1); // no key
      expect(run({ APPROVAL: "0".repeat(64) })).toBe(1);
      expect(run({ RUN_CREATED: String(issuedAt + 3600) })).toBe(1); // replayed later
    },
  );
});
