import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  ScrollText,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { ModuleGate } from "@/components/common/ModuleGate";
import { KebeleFilter } from "@/components/common/KebeleFilter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TablePagination,
  DEFAULT_PAGE_SIZE,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { formatEthiopianDateShort } from "@/utils/ethiopianCalendar";
import { TableEmptyRow, TableErrorRow, TableSkeletonRows } from "@/components/common/TableStates";
import {
  ClearFiltersButton,
  ExportButtons,
  SortableTh,
  useClearTableFilters,
  useUrlSort,
} from "@/components/common/TableToolbar";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";

export const Route = createFileRoute("/woreda/audit")({
  ssr: false,
  component: () => (
    <ModuleGate moduleKey="audit">
      <AuditTrailPage />
    </ModuleGate>
  ),
});

const ENTITIES = [
  "resident",
  "household",
  "residence_credential",
  "credential_request",
  "vital_event",
  "payment",
  "receipt",
  "rental_occupancy_request",
  "kebele_rental_house",
  "app_user",
  "role_permission",
  "woreda_settings",
] as const;

interface AuditRow {
  audit_log_id: string;
  entity_name: string;
  entity_id: string | null;
  action_type: string;
  action_at: string;
  source_ip: string | null;
  old_value_json: unknown;
  new_value_json: unknown;
  actor: { full_name: string | null; username: string | null; role: string | null } | null;
}

function actionTone(action: string) {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("REVOK") || a.includes("REJECT"))
    return "bg-red-50 text-red-700 border-red-200";
  if (a.includes("CREATE") || a.includes("APPROV") || a.includes("PAID"))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("VERIF"))
    return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

type DeepLink = { to: string; params?: Record<string, string>; labelEn: string };

/** Map an audit entry to the record or workflow screen it affected. */
function deepLinkFor(row: { entity_name: string; entity_id: string | null }): DeepLink | null {
  const id = row.entity_id ?? "";
  switch (row.entity_name) {
    case "resident":
      return id
        ? {
            to: "/woreda/residents/$residentId",
            params: { residentId: id },
            labelEn: "Open resident",
          }
        : { to: "/woreda/residents", labelEn: "Open residents" };
    case "household":
    case "household_change_log":
      return id
        ? {
            to: "/woreda/households/$householdId",
            params: { householdId: id },
            labelEn: "Open household",
          }
        : { to: "/woreda/households", labelEn: "Open households" };
    case "credential_request":
      return id
        ? {
            to: "/woreda/credentials/$requestId",
            params: { requestId: id },
            labelEn: "Open request",
          }
        : { to: "/woreda/credentials", labelEn: "Open credentials" };
    case "residence_credential":
      return { to: "/woreda/credentials", labelEn: "Open credentials" };
    case "vital_event":
      return id
        ? { to: "/woreda/civil/$eventId", params: { eventId: id }, labelEn: "Open civil event" }
        : { to: "/woreda/civil", labelEn: "Open civil registry" };
    case "rental_occupancy_request":
      return id
        ? {
            to: "/woreda/rental-houses/requests/$requestId",
            params: { requestId: id },
            labelEn: "Open occupancy request",
          }
        : { to: "/woreda/rental-houses/requests", labelEn: "Open requests" };
    case "kebele_rental_house":
      return id
        ? {
            to: "/woreda/rental-houses/$houseId",
            params: { houseId: id },
            labelEn: "Open rental house",
          }
        : { to: "/woreda/rental-houses", labelEn: "Open rental houses" };
    case "payment":
    case "receipt":
      return { to: "/woreda/revenue", labelEn: "Open revenue ledger" };
    case "app_user":
    case "role_permission":
      return { to: "/woreda/settings/users-permissions", labelEn: "Open users & permissions" };
    case "woreda_settings":
      return { to: "/woreda/settings/woreda-configuration", labelEn: "Open woreda configuration" };
    default:
      return null;
  }
}

function AuditDeepLink({
  row,
  onNavigate,
  compact,
}: {
  row: AuditRow;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const link = deepLinkFor(row);
  if (!link) return null;
  return (
    <Button asChild size="sm" variant={compact ? "ghost" : "outline"} onClick={onNavigate}>
      <Link to={link.to} params={link.params as never}>
        <ExternalLink className="mr-1 h-4 w-4" />
        {compact ? "Open" : link.labelEn}
      </Link>
    </Button>
  );
}

function AuditTrailPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();
  const [entity, setEntity] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [kebeleId, setKebeleId] = useState("");
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const sort = useUrlSort("action_at", "desc", "asc");
  const sortColumnMap: Record<string, string> = {
    action_at: "action_at",
    entity_name: "entity_name",
    action_type: "action_type",
  };
  const dbSortColumn = sortColumnMap[sort.field] ?? "action_at";

  const filters = useMemo(
    () => ({ q: qTerm, entity, start, end, kebeleId }),
    [qTerm, entity, start, end, kebeleId],
  );
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [qTerm, entity, start, end, kebeleId, sort.key].join("|"),
  );

  const filtersActive = !!(q || entity || start || end || kebeleId || !sort.isDefault);
  const clearFilters = useClearTableFilters([], () => {
    setEntity("");
    setStart("");
    setEnd("");
    setKebeleId("");
  });

  const branding = useReportBranding();
  const [exporting, setExporting] = useState(false);

  function buildAuditQuery(rangeStart: number, rangeEnd: number) {
    let query = supabase
      .from("audit_log")
      .select(
        "audit_log_id, entity_name, entity_id, action_type, action_at, source_ip, old_value_json, new_value_json, actor:actor_user_id ( full_name, username, role )",
        { count: "exact" },
      )
      .eq("woreda_id", woredaId!)
      .order(dbSortColumn, { ascending: sort.dir === "asc" });
    if (dbSortColumn !== "action_at") {
      query = query.order("action_at", { ascending: false });
    }
    query = query.range(rangeStart, rangeEnd);

    if (filters.entity) query = query.eq("entity_name", filters.entity);
    if (filters.kebeleId) {
      query = query.or(
        [
          `new_value_json->>kebele_id.eq.${filters.kebeleId}`,
          `old_value_json->>kebele_id.eq.${filters.kebeleId}`,
          `new_value_json->>issuing_kebele_id.eq.${filters.kebeleId}`,
          `old_value_json->>issuing_kebele_id.eq.${filters.kebeleId}`,
        ].join(","),
      );
    }
    if (filters.start) query = query.gte("action_at", `${filters.start}T00:00:00.000Z`);
    if (filters.end) query = query.lte("action_at", `${filters.end}T23:59:59.999Z`);
    if (filters.q) {
      const esc = filters.q.replace(/[%,]/g, "");
      query = query.or(
        [
          `action_type.ilike.%${esc}%`,
          `entity_name.ilike.%${esc}%`,
          `entity_id.ilike.%${esc}%`,
        ].join(","),
      );
    }
    return query;
  }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["audit-log", woredaId, filters, page, pageSize, sort.key],
    enabled: !!woredaId,
    queryFn: async () => {
      const query = buildAuditQuery(page * pageSize, page * pageSize + pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as AuditRow[], count: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const filterLabel =
    [
      filters.q ? `Search: "${filters.q}"` : null,
      filters.entity ? `Entity: ${filters.entity}` : null,
      filters.start ? `From: ${filters.start}` : null,
      filters.end ? `To: ${filters.end}` : null,
      filters.kebeleId ? `Kebele: ${filters.kebeleId}` : null,
      !sort.isDefault ? `Sort: ${sort.field} ${sort.dir}` : null,
    ]
      .filter(Boolean)
      .join(" • ") || "No filters applied";

  const exportColumns: TableColumn<AuditRow>[] = [
    { header: "ቀን / Timestamp", value: (r) => new Date(r.action_at).toISOString() },
    { header: "ተጠቃሚ / Actor", value: (r) => r.actor?.full_name ?? r.actor?.username ?? "System" },
    { header: "ሚና / Role", value: (r) => r.actor?.role ?? "" },
    { header: "ክፍል / Entity", value: (r) => r.entity_name },
    { header: "Record ID", value: (r) => r.entity_id ?? "" },
    { header: "ተግባር / Action", value: (r) => r.action_type },
    { header: "Source IP", value: (r) => r.source_ip ?? "" },
  ];

  async function fetchAllMatchingRows(): Promise<AuditRow[]> {
    const { data, error } = await buildAuditQuery(0, 4999);
    if (error) throw error;
    return (data ?? []) as unknown as AuditRow[];
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const allRows = await fetchAllMatchingRows();
      exportRowsToCsv({
        fileName: `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows: allRows,
        filterLabel,
        titleEn: "Audit Trail",
      });
      toast.success(`Exported ${allRows.length} record(s) to CSV`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export CSV");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      const allRows = await fetchAllMatchingRows();
      await exportRowsToPdf({
        fileName: `audit-trail-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: branding.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "ኦዲት መዝገብ",
        titleEn: "Audit Trail",
        filterLabel,
        columns: exportColumns,
        rows: allRows,
      });
      toast.success(`Exported ${allRows.length} record(s) to PDF`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  }

  if (!hasPermission(P.AUDIT_VIEW)) return <Navigate to="/woreda/dashboard" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ScrollText}
        titleAm="ኦዲት መዝገብ"
        titleEn="Audit Trail"
        description="ሁሉም የስርዓት እንቅስቃሴዎች ዝርዝር / Immutable record of all system activity"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Refresh
            </Button>
            <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label className="font-noto-ethiopic text-xs">ፍለጋ / Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
                placeholder="Action, entity, or record ID"
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="font-noto-ethiopic text-xs">ክፍል / Entity</Label>
            <select
              className="h-10 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All entities</option>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="font-noto-ethiopic text-xs">ከ / From</Label>
            <Input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div>
            <Label className="font-noto-ethiopic text-xs">እስከ / To</Label>
            <Input
              type="date"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <KebeleFilter
            value={kebeleId}
            onChange={(v) => {
              setKebeleId(v);
              setPage(0);
            }}
            hint="Matches kebele recorded on the changed record"
          />
          <ClearFiltersButton
            active={filtersActive}
            onClear={() => {
              setQ("");
              clearFilters();
              setPage(0);
            }}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <SortableTh field="action_at" sort={sort}>
                  ቀን / Timestamp
                </SortableTh>
                <th className="px-4 py-2">ተጠቃሚ / Actor</th>
                <SortableTh field="entity_name" sort={sort}>
                  ክፍል / Entity
                </SortableTh>
                <SortableTh field="action_type" sort={sort}>
                  ተግባር / Action
                </SortableTh>
                <th className="px-4 py-2">Record</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeletonRows cols={6} />}
              {isError && !isLoading && (
                <TableErrorRow cols={6} error={error} onRetry={() => refetch()} />
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <TableEmptyRow
                  cols={6}
                  filtered={filtersActive}
                  onClearFilters={() => {
                    setQ("");
                    clearFilters();
                    setPage(0);
                  }}
                  labelAm="ምንም መዝገብ አልተገኘም"
                  labelEn="No audit entries yet"
                  filteredLabelAm="ምንም መዝገብ አልተገኘም"
                  filteredLabelEn="No audit entries match these filters"
                />
              )}
              {!isLoading &&
                !isError &&
                rows.map((r) => {
                  const at = new Date(r.action_at);
                  return (
                    <tr key={r.audit_log_id} className="border-t hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2">
                        <div className="font-noto-ethiopic">{formatEthiopianDateShort(at)}</div>
                        <div className="text-xs text-slate-500">
                          {at.toLocaleString("en-GB", { hour12: false })}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-noto-ethiopic">
                          {r.actor?.full_name ?? r.actor?.username ?? "System"}
                        </div>
                        {r.actor?.role && (
                          <div className="text-xs text-slate-500">{r.actor.role}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{r.entity_name}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${actionTone(r.action_type)}`}
                        >
                          {r.action_type}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">
                        {r.entity_id ? `${r.entity_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <AuditDeepLink row={r} compact />
                          <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                            <Eye className="mr-1 h-4 w-4" /> View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle className="font-noto-ethiopic">የመዝገብ ዝርዝር / Entry details</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Action" value={detail.action_type} />
                <Field label="Entity" value={detail.entity_name} />
                <Field label="Record ID" value={detail.entity_id ?? "—"} mono />
                <Field
                  label="Actor"
                  value={detail.actor?.full_name ?? detail.actor?.username ?? "System"}
                />
                <Field
                  label="Timestamp"
                  value={new Date(detail.action_at).toLocaleString("en-GB", { hour12: false })}
                />
                <Field label="Source IP" value={detail.source_ip ?? "—"} />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2">
                <p className="font-noto-ethiopic text-xs text-slate-600">
                  የተመለከተውን መዝገብ ክፈት / Review the affected record
                </p>
                <AuditDeepLink row={detail} onNavigate={() => setDetail(null)} />
              </div>
              <div>
                <Badge variant="secondary">Before</Badge>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                  {JSON.stringify(detail.old_value_json ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <Badge variant="secondary">After</Badge>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                  {JSON.stringify(detail.new_value_json ?? null, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={mono ? "break-all font-mono text-xs" : "font-noto-ethiopic"}>{value}</p>
    </div>
  );
}
