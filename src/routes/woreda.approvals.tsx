import { createFileRoute, Link, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { ModuleGate } from "@/components/common/ModuleGate";
import { KebeleFilter } from "@/components/common/KebeleFilter";
import { TablePagination, useClientPagination } from "@/components/common/TablePagination";
import { TableEmptyRow, TableErrorRow, TableSkeletonRows } from "@/components/common/TableStates";
import { PriorityBadge, StatusBadge } from "@/components/services/ServiceRequestList";

export const Route = createFileRoute("/woreda/approvals")({
  ssr: false,
  component: ApprovalQueuePage,
});

interface QueueRow {
  item_id: string | null;
  work_type: string | null;
  stage: string | null;
  reference_number: string | null;
  subtype_am: string | null;
  subtype_en: string | null;
  priority: string | null;
  resident_id: string | null;
  kebele_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const WORK_TYPE_LABEL: Record<string, string> = {
  service: "አገልግሎት / Service",
  complaint: "ቅሬታ / Complaint",
  credential: "መታወቂያ / Credential",
  civil: "ኩነት / Civil event",
  rental: "ኪራይ / Rental",
};

function linkFor(row: QueueRow): { to: string; params: Record<string, string> } | null {
  if (!row.item_id) return null;
  switch (row.work_type) {
    case "service":
    case "complaint":
      return { to: "/woreda/services/$requestId", params: { requestId: row.item_id } };
    case "credential":
      return { to: "/woreda/credentials/$requestId", params: { requestId: row.item_id } };
    case "civil":
      return { to: "/woreda/civil/$eventId", params: { eventId: row.item_id } };
    case "rental":
      return { to: "/woreda/rental-houses/requests/$requestId", params: { requestId: row.item_id } };
    default:
      return null;
  }
}

function ApprovalQueuePage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const woredaId = useAuthStore((s) => s.woredaId);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const workType = typeof search["wt"] === "string" ? (search["wt"] as string) : "";
  const kebeleFilter = typeof search["kb"] === "string" ? (search["kb"] as string) : "";

  const patch = (next: Record<string, unknown>) =>
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...next, page: undefined }),
      replace: true,
    } as never);

  const queueQuery = useQuery({
    queryKey: ["approval-queue", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_queue_v")
        .select(
          "item_id, work_type, stage, reference_number, subtype_am, subtype_en, priority, resident_id, kebele_id, created_at, updated_at",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as QueueRow[];
    },
  });

  const rows = (queueQuery.data ?? []).filter(
    (r) =>
      (!workType || r.work_type === workType) &&
      (!kebeleFilter || r.kebele_id === kebeleFilter),
  );
  const filtered = !!workType || !!kebeleFilter;
  const { page, setPage, pageSize, setPageSize, total, pageRows } = useClientPagination(
    rows,
    `${workType}|${kebeleFilter}`,
  );

  if (!hasPermission(P.APPROVAL_QUEUE_VIEW)) return <Navigate to="/woreda/dashboard" />;

  return (
    <ModuleGate moduleKey="approvals">
      <div className="space-y-6">
        <PageHeader
          titleAm="የማጽደቅ ወረፋ"
          titleEn="Approval Queue"
          description="በእርስዎ እርምጃ የሚጠብቁ ጥያቄዎች በሙሉ በአንድ ቦታ"
        />

        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="font-noto-ethiopic text-xs">ዓይነት / Work type</Label>
              <select
                className="font-noto-ethiopic mt-1 block h-10 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
                value={workType}
                onChange={(e) => patch({ wt: e.target.value || undefined })}
              >
                <option value="">ሁሉም / All</option>
                {Object.entries(WORK_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <KebeleFilter value={kebeleFilter} onChange={(v) => patch({ kb: v || undefined })} />
            {filtered && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => patch({ wt: undefined, kb: undefined })}
              >
                Clear filters
              </Button>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <Inbox className="h-4 w-4 text-blue-700" />
            <span className="font-noto-ethiopic text-sm font-medium">
              {total} ጥያቄዎች በጥበቃ ላይ / {total} items awaiting action
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">ቁጥር / Reference</th>
                  <th className="px-4 py-2">ዓይነት / Type</th>
                  <th className="px-4 py-2">ንዑስ ዓይነት / Subtype</th>
                  <th className="px-4 py-2">ደረጃ / Stage</th>
                  <th className="px-4 py-2">ቅድሚያ / Priority</th>
                  <th className="px-4 py-2">ቀን / Created</th>
                </tr>
              </thead>
              <tbody>
                {queueQuery.isPending ? (
                  <TableSkeletonRows cols={6} />
                ) : queueQuery.isError ? (
                  <TableErrorRow cols={6} error={queueQuery.error} onRetry={() => queueQuery.refetch()} />
                ) : pageRows.length === 0 ? (
                  <TableEmptyRow
                    cols={6}
                    filtered={filtered}
                    labelAm="ወረፋው ንጹህ ነው"
                    labelEn="Nothing is waiting for your action"
                  />
                ) : (
                  pageRows.map((r) => {
                    const link = linkFor(r);
                    return (
                      <tr key={`${r.work_type}-${r.item_id}`} className="border-t hover:bg-slate-50">
                        <td className="px-4 py-3">
                          {link ? (
                            <Link
                              to={link.to as never}
                              params={link.params as never}
                              className="font-mono text-xs font-medium text-blue-700 hover:underline"
                            >
                              {r.reference_number ?? "—"}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs">{r.reference_number ?? "—"}</span>
                          )}
                        </td>
                        <td className="font-noto-ethiopic px-4 py-3">
                          {WORK_TYPE_LABEL[r.work_type ?? ""] ?? r.work_type ?? "—"}
                        </td>
                        <td className="font-noto-ethiopic px-4 py-3">
                          {r.subtype_am ?? r.subtype_en ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={r.stage ?? "submitted"} />
                        </td>
                        <td className="px-4 py-3">
                          <PriorityBadge priority={r.priority ?? "normal"} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString("en-GB") : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      </div>
    </ModuleGate>
  );
}
