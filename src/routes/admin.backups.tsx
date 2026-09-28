import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableEmptyRow, TableErrorRow, TableSkeletonRows } from "@/components/common/TableStates";
import {
  ConsolePermissionGate,
  InsufficientConsolePermissionNotice,
} from "@/components/common/ConsolePermissionGate";
import { CP } from "@/config/permissions";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import {
  formatEthiopianDate,
  formatEthiopianDateTimeAddis,
  toAddisWallClock,
} from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/admin/backups")({
  ssr: false,
  component: BackupsPageGated,
});

function BackupsPageGated() {
  return (
    <ConsolePermissionGate
      permission={CP.BACKUP_MANAGE}
      fallback={<InsufficientConsolePermissionNotice />}
    >
      <BackupsPage />
    </ConsolePermissionGate>
  );
}

// ------------------------------------------------------------------ types
// Mirrors supabase/functions/backup-admin (status action).

type RunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type RestoreTest = "passed" | "failed" | "not_run" | "pending";
type RestoreMode = "verify" | "restore_to_target";
type RequestStatus =
  "requested" | "approved" | "rejected" | "cancelled" | "dispatched" | "succeeded" | "failed";

interface BackupRun {
  id: number;
  state: RunState;
  trigger: "scheduled" | "manual" | "other";
  createdAt: string;
  url: string;
  restoreTest: RestoreTest;
  artifact: {
    id: number;
    name: string;
    sizeBytes: number;
    expired: boolean;
    expiresAt: string;
  } | null;
}

interface RestoreRequest {
  restore_request_id: string;
  backup_run_id: number;
  backup_artifact_id: number;
  backup_created_at: string;
  mode: RestoreMode;
  reason: string;
  status: RequestStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  workflow_run_url: string | null;
  completed_at: string | null;
  requester: { full_name: string } | null;
  decider: { full_name: string } | null;
}

interface BackupStatus {
  configured: boolean;
  github_error: "token_rejected" | "unreachable" | null;
  me: string;
  schedule: { description: string; next_run_at: string; retention_days: number };
  runs: BackupRun[];
  requests: RestoreRequest[];
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, friendlyError } = await invokeEdgeFunction<T>("backup-admin", body);
  if (friendlyError || !data) throw new Error(friendlyError ?? "No response");
  return data;
}

// ------------------------------------------------------------------ formatting

/**
 * Ethiopian date and Ethiopian-clock time in Addis Ababa (Arabic numerals),
 * then the international time for cross-reference with GitHub, which shows UTC.
 */
function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const utc = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
  return `${formatEthiopianDateTimeAddis(d)} (${utc})`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const RUN_BADGE: Record<RunState, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-slate-100 text-slate-700" },
  running: { label: "Running", className: "bg-blue-100 text-blue-800" },
  succeeded: { label: "Succeeded", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600" },
};

const TEST_BADGE: Record<RestoreTest, { label: string; className: string }> = {
  passed: { label: "Restore test passed", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Restore test failed", className: "bg-red-100 text-red-800" },
  not_run: { label: "Not tested", className: "bg-amber-100 text-amber-800" },
  pending: { label: "Pending", className: "bg-slate-100 text-slate-700" },
};

const REQUEST_BADGE: Record<RequestStatus, { label: string; className: string }> = {
  requested: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-800" },
  dispatched: { label: "Running", className: "bg-blue-100 text-blue-800" },
  succeeded: { label: "Succeeded", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
  rejected: { label: "Rejected", className: "bg-slate-100 text-slate-700" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600" },
};

const MODE_LABEL: Record<RestoreMode, string> = {
  verify: "Verify in isolated sandbox",
  restore_to_target: "Restore to new project",
};

// ------------------------------------------------------------------ page

function BackupsPage() {
  const qc = useQueryClient();
  const [restoreFor, setRestoreFor] = useState<BackupRun | null>(null);
  const [decide, setDecide] = useState<{
    req: RestoreRequest;
    decision: "approve" | "reject";
  } | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);

  const status = useQuery({
    queryKey: ["backup-admin", "status"],
    queryFn: () => call<BackupStatus>({ action: "status" }),
    // Poll while anything is in flight.
    refetchInterval: (q) => {
      const d = q.state.data;
      const busy =
        d?.runs.some((r) => r.state === "queued" || r.state === "running") ||
        d?.requests.some((r) => r.status === "dispatched" || r.status === "approved");
      return busy ? 15_000 : false;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["backup-admin", "status"] });

  const runBackup = useMutation({
    mutationFn: () => call<{ success: boolean }>({ action: "run_backup" }),
    onSuccess: () => {
      toast.success("Backup started. It usually takes 5–10 minutes.");
      setConfirmRun(false);
      // GitHub lists the new run a few seconds after the dispatch.
      setTimeout(refresh, 5000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const download = useMutation({
    mutationFn: (artifactId: number) =>
      call<{ url: string }>({ action: "download", artifact_id: artifactId }),
    onSuccess: ({ url }) => {
      // GitHub's short-lived signed link to the age-encrypted archive.
      window.location.assign(url);
      toast.success(
        "Download started. The archive is encrypted: decrypt it with your offline key.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) =>
      call<{ status: string }>({ action: "cancel_restore", restore_request_id: id }),
    onSuccess: () => {
      toast.success("Restore request cancelled.");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = status.data;
  const lastGood = d?.runs.find((r) => r.state === "succeeded");
  const latest = d?.runs[0];
  const pendingForMe =
    d?.requests.filter((r) => r.status === "requested" && r.requested_by !== d.me).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={DatabaseBackup}
        titleAm="ምትኬና መልሶ ማግኛ"
        titleEn="Backup & Restore"
        description="Nightly encrypted backups of the database and files, restore-tested every run. Restores need a second super admin's approval and never overwrite production."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refresh()} disabled={status.isFetching}>
              {status.isFetching ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button onClick={() => setConfirmRun(true)} disabled={!d?.configured}>
              <Play className="mr-1.5 h-4 w-4" /> Back up now
            </Button>
          </div>
        }
      />

      {status.isError && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {(status.error as Error).message}
        </Card>
      )}

      {d && !d.configured && <SetupNotice reason="token" />}
      {d?.github_error && <SetupNotice reason={d.github_error} />}
      {d?.configured && !d.github_error && latest?.state === "failed" && !lastGood && (
        <SetupNotice reason="first_run_failed" runUrl={latest.url} />
      )}

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile
          icon={lastGood ? CheckCircle2 : AlertTriangle}
          tone={lastGood ? "good" : "warn"}
          label="Last successful backup"
          value={lastGood ? when(lastGood.createdAt) : status.isLoading ? "…" : "None yet"}
        />
        <SummaryTile
          icon={
            lastGood?.restoreTest === "passed"
              ? ShieldCheck
              : lastGood?.restoreTest === "failed"
                ? XCircle
                : AlertTriangle
          }
          tone={lastGood?.restoreTest === "passed" ? "good" : "warn"}
          label="Its restore test"
          value={lastGood ? TEST_BADGE[lastGood.restoreTest].label : "—"}
        />
        <SummaryTile
          icon={Clock}
          tone="neutral"
          label="Next scheduled backup"
          value={d ? when(d.schedule.next_run_at) : "…"}
          hint={d?.schedule.description}
        />
        <SummaryTile
          icon={RotateCcw}
          tone={pendingForMe ? "warn" : "neutral"}
          label="Restore requests awaiting you"
          value={String(pendingForMe)}
          hint={d ? `Archives are kept ${d.schedule.retention_days} days` : undefined}
        />
      </div>

      {/* Backups */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold text-slate-900">Backups</h2>
          <p className="text-sm text-slate-500">
            Each archive is encrypted with the owner's key before it leaves the backup job.
            Downloading gives you ciphertext only.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Trigger</th>
                <th className="px-4 py-2">Backup</th>
                <th className="px-4 py-2">Restore test</th>
                <th className="px-4 py-2">Archive</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {status.isLoading && <TableSkeletonRows cols={6} rows={3} />}
              {status.isError && (
                <TableErrorRow cols={6} error={status.error} onRetry={() => refresh()} />
              )}
              {d && d.runs.length === 0 && (
                <TableEmptyRow cols={6} labelAm="ምትኬ የለም" labelEn="No backups yet" />
              )}
              {d?.runs.map((r) => {
                const usable = r.artifact && !r.artifact.expired;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3 whitespace-nowrap">{when(r.createdAt)}</td>
                    <td className="px-4 py-3 capitalize">{r.trigger}</td>
                    <td className="px-4 py-3">
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        <Badge className={RUN_BADGE[r.state].className}>
                          {RUN_BADGE[r.state].label}
                        </Badge>
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={TEST_BADGE[r.restoreTest].className}>
                        {TEST_BADGE[r.restoreTest].label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {r.artifact
                        ? r.artifact.expired
                          ? "Expired"
                          : `${bytes(r.artifact.sizeBytes)}, until ${formatEthiopianDate(toAddisWallClock(new Date(r.artifact.expiresAt)))}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!usable || download.isPending}
                          onClick={() => r.artifact && download.mutate(r.artifact.id)}
                          aria-label={`Download encrypted archive of ${when(r.createdAt)}`}
                        >
                          <Download className="mr-1 h-4 w-4" /> Download
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!usable}
                          onClick={() => setRestoreFor(r)}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" /> Restore…
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Restore requests */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold text-slate-900">Restore requests</h2>
          <p className="text-sm text-slate-500">
            Maker-checker: a request runs only after a different super admin approves it. Every step
            is written to the audit trail.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Requested</th>
                <th className="px-4 py-2">Backup of</th>
                <th className="px-4 py-2">Mode</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {status.isLoading && <TableSkeletonRows cols={6} rows={2} />}
              {d && d.requests.length === 0 && (
                <TableEmptyRow cols={6} labelAm="ጥያቄ የለም" labelEn="No restore requests" />
              )}
              {d?.requests.map((q) => {
                const mine = q.requested_by === d.me;
                return (
                  <tr key={q.restore_request_id} className="border-t align-top">
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap">{when(q.requested_at)}</div>
                      <div className="text-xs text-slate-500">
                        by {q.requester?.full_name ?? "—"}
                        {mine ? " (you)" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{when(q.backup_created_at)}</td>
                    <td className="px-4 py-3">{MODE_LABEL[q.mode]}</td>
                    <td className="max-w-xs px-4 py-3 break-words text-slate-700">
                      {q.reason}
                      {q.decision_note && (
                        <div className="mt-1 text-xs text-slate-500">
                          Note from {q.decider?.full_name ?? "approver"}: {q.decision_note}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={REQUEST_BADGE[q.status].className}>
                        {REQUEST_BADGE[q.status].label}
                      </Badge>
                      {q.decider && q.status !== "requested" && q.status !== "cancelled" && (
                        <div className="mt-1 text-xs text-slate-500">
                          decided by {q.decider.full_name}
                        </div>
                      )}
                      {q.workflow_run_url && (
                        <a
                          href={q.workflow_run_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 flex items-center gap-1 text-xs text-blue-700 hover:underline"
                        >
                          Workflow run <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {q.status === "requested" && !mine && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => setDecide({ req: q, decision: "approve" })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDecide({ req: q, decision: "reject" })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {q.status === "requested" && mine && (
                          <>
                            <span className="self-center text-xs text-slate-500">
                              Needs another super admin
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={cancel.isPending}
                              onClick={() => cancel.mutate(q.restore_request_id)}
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Back up now?</DialogTitle>
            <DialogDescription>
              Starts the backup job immediately, in addition to the nightly run. It takes a snapshot
              of the database and all files, test-restores it and keeps the encrypted archive for 30
              days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(false)}>
              Cancel
            </Button>
            <Button onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
              {runBackup.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Start backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {restoreFor && (
        <RequestRestoreDialog
          run={restoreFor}
          onClose={() => setRestoreFor(null)}
          onDone={() => {
            setRestoreFor(null);
            void refresh();
          }}
        />
      )}
      {decide && (
        <DecideDialog
          req={decide.req}
          decision={decide.decision}
          onClose={() => setDecide(null)}
          onDone={() => {
            setDecide(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function SummaryTile({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  tone: "good" | "warn" | "neutral";
  label: string;
  value: string;
  hint?: string;
}) {
  const color =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-500";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className={`h-4 w-4 ${color}`} /> {label}
      </div>
      <div className="mt-1 font-medium text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

function SetupNotice({
  reason,
  runUrl,
}: {
  reason: "token" | "token_rejected" | "unreachable" | "first_run_failed";
  runUrl?: string;
}) {
  const text = {
    token:
      "The server has no GitHub token yet, so this page cannot list or start backups. Set the Edge Function secret GITHUB_BACKUP_TOKEN (see the runbook, §3).",
    token_rejected:
      "GitHub rejected the server's token (GITHUB_BACKUP_TOKEN). It may have expired or lost the Actions permission: create a new one and update the secret.",
    unreachable: "GitHub could not be reached just now. The list below may be out of date.",
    first_run_failed:
      "The backup job has run but has not succeeded yet. Usually the one-time setup is incomplete: the `backup` environment needs SUPABASE_DB_URL and BACKUP_AGE_RECIPIENTS (runbook §3).",
  }[reason];
  return (
    <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {text}{" "}
        {runUrl && (
          <a href={runUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Open the failed run
          </a>
        )}
      </div>
    </Card>
  );
}

function RequestRestoreDialog({
  run,
  onClose,
  onDone,
}: {
  run: BackupRun;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<RestoreMode>("verify");
  const [reason, setReason] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      call<{ restore_request_id: string }>({
        action: "request_restore",
        artifact_id: run.artifact?.id,
        mode,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Restore request created. Another super admin must approve it.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = reason.trim().length >= 10 && reason.trim().length <= 1000;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a restore</DialogTitle>
          <DialogDescription>Backup of {when(run.createdAt)}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as RestoreMode)}>
            <label className="flex cursor-pointer gap-3 rounded-md border p-3">
              <RadioGroupItem value="verify" id="mode-verify" className="mt-1" />
              <div>
                <div className="font-medium">Verify in an isolated sandbox</div>
                <div className="text-sm text-slate-500">
                  Decrypts and restores this backup into a throwaway database inside the job, then
                  checks every table, policy and file. Nothing live changes. Use it for a restore
                  drill or before relying on an older backup.
                </div>
              </div>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-md border p-3">
              <RadioGroupItem value="restore_to_target" id="mode-target" className="mt-1" />
              <div>
                <div className="font-medium">Restore to the new recovery project</div>
                <div className="text-sm text-slate-500">
                  Disaster recovery: restores into the separate, empty Supabase project configured
                  as the restore target. Production is never overwritten; switching the site to the
                  recovered project is a separate, manual step (runbook §5).
                </div>
              </div>
            </label>
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor="restore-reason">Reason (kept in the audit trail)</Label>
            <Textarea
              id="restore-reason"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Monthly restore drill; or: rows deleted by mistake on …"
            />
            <div className="text-xs text-slate-500">At least 10 characters.</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}>
            {submit.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({
  req,
  decision,
  onClose,
  onDone,
}: {
  req: RestoreRequest;
  decision: "approve" | "reject";
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      call<{ status: string }>({
        action: "decide_restore",
        restore_request_id: req.restore_request_id,
        decision,
        note: note.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(
        r.status === "dispatched" ? "Approved. The restore workflow has started." : "Rejected.",
      );
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = decision === "approve" || note.trim().length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {decision === "approve" ? "Approve restore request" : "Reject restore request"}
          </DialogTitle>
          <DialogDescription>
            {MODE_LABEL[req.mode]}, backup of {when(req.backup_created_at)}, requested by{" "}
            {req.requester?.full_name ?? "—"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{req.reason}</div>
          {decision === "approve" && req.mode === "restore_to_target" && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              This loads the backup into the recovery project, which must be empty (the restore
              aborts, changing nothing, if it is not). Production is not touched.
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="decision-note">
              Note {decision === "reject" ? "(required)" : "(optional)"}
            </Label>
            <Textarea
              id="decision-note"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision === "reject" ? "destructive" : "default"}
            onClick={() => submit.mutate()}
            disabled={!valid || submit.isPending}
          >
            {submit.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {decision === "approve" ? "Approve and run" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
