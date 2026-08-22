import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Eye, Loader2, ScrollText, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TablePagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
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

interface AuditSearch {
  woreda?: string;
}

export const Route = createFileRoute("/admin/audit")({
  ssr: false,
  // Only `woreda` is validated -- it's the one filter a deep link (the
  // tenant detail page's "View Audit Trail" button) needs to pre-populate.
  // Other filters stay local state, same as every other table on this
  // portal that isn't search/sort/pagination.
  validateSearch: (raw: Record<string, unknown>): AuditSearch => ({
    woreda: typeof raw.woreda === "string" ? raw.woreda : undefined,
  }),
  component: AdminAuditPage,
});

/** The `/admin` layout already restricts this console to super admins. */

const PLATFORM_BRANDING = {
  nameAm: "የሐረሪ ክልል አስተዳደር",
  nameEn: "Harari Regional Administration",
  logoDataUrl: null,
};

/** Entity names written to `audit_log` by the app, edge functions and triggers. */
const ENTITIES = [
  "app_user",
  "role_permission",
  "woreda_settings",
  "resident",
  "household",
  "household_change_log",
  "residence_credential",
  "credential_request",
  "vital_event",
  "service_request",
  "payment",
  "receipt",
  "fee_schedule",
  "rental_occupancy_request",
  "kebele_rental_house",
] as const;

/** Sentinel for rows with no `woreda_id` — platform-level actions. */
const PLATFORM_SCOPE = "platform";

/** Rows are capped on export so a full-platform log cannot exhaust the browser. */
const EXPORT_ROW_LIMIT = 5000;

interface AuditRow {
  audit_log_id: string;
  woreda_id: string | null;
  entity_name: string;
  entity_id: string | null;
  action_type: string;
  action_at: string;
  source_ip: string | null;
  old_value_json: unknown;
  new_value_json: unknown;
  actor: { full_name: string | null; username: string | null; role: string | null } | null;
}

interface WoredaOpt {
  woreda_id: string;
  woreda_name_am: string;
  woreda_name_en: string;
}

function actionTone(action: string) {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("REVOK") || a.includes("REJECT") || a.includes("SUSPEND"))
    return "bg-red-50 text-red-700 border-red-200";
  if (a.includes("CREATE") || a.includes("APPROV") || a.includes("PAID") || a.includes("REACTIVAT"))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("VERIF"))
    return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function AdminAuditPage() {
  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();
  const navigate = useNavigate();
  const woreda = Route.useSearch({ select: (s) => s.woreda }) ?? "";
  const setWoreda = (next: string) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, woreda: next || undefined }),
      replace: true,
    } as never);
  };
  const [entity, setEntity] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const sort = useUrlSort("action_at", "desc", "asc");
  const sortColumnMap: Record<string, string> = {
    action_at: "action_at",
    entity_name: "entity_name",
    action_type: "action_type",
  };
  const dbSortColumn = sortColumnMap[sort.field] ?? "action_at";

  const filters = useMemo(
    () => ({ q: qTerm, woreda, entity, start, end }),
    [qTerm, woreda, entity, start, end],
  );
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [qTerm, woreda, entity, start, end, sort.key].join("|"),
  );

  const filtersActive = !!(q || woreda || entity || start || end || !sort.isDefault);
  const clearFilters = useClearTableFilters([], () => {
    setWoreda("");
    setEntity("");
    setStart("");
    setEnd("");
  });

  const { data: woredas = [] } = useQuery({
    queryKey: ["admin-audit-woredas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_id, woreda_name_am, woreda_name_en")
        .order("woreda_numeric_code");
      if (error) throw error;
      return (data ?? []) as WoredaOpt[];
    },
  });

  const woredaMap = useMemo(() => {
    const m = new Map<string, WoredaOpt>();
    for (const w of woredas) m.set(w.woreda_id, w);
    return m;
  }, [woredas]);

  function tenantLabel(row: { woreda_id: string | null }) {
    if (!row.woreda_id) return "Platform";
    return woredaMap.get(row.woreda_id)?.woreda_name_en ?? row.woreda_id;
  }

  function buildAuditQuery(rangeStart: number, rangeEnd: number) {
    let query = supabase
      .from("audit_log")
      .select(
        "audit_log_id, woreda_id, entity_name, entity_id, action_type, action_at, source_ip, old_value_json, new_value_json, actor:actor_user_id ( full_name, username, role )",
        { count: "exact" },
      )
      .order(dbSortColumn, { ascending: sort.dir === "asc" });
    if (dbSortColumn !== "action_at") {
      query = query.order("action_at", { ascending: false });
    }
    query = query.range(rangeStart, rangeEnd);

    if (filters.woreda === PLATFORM_SCOPE) query = query.is("woreda_id", null);
    else if (filters.woreda) query = query.eq("woreda_id", filters.woreda);
    if (filters.entity) query = query.eq("entity_name", filters.entity);
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
    queryKey: ["admin-audit-log", filters, page, pageSize, sort.key],
    queryFn: async () => {
      const { data, error, count } = await buildAuditQuery(
        page * pageSize,
        page * pageSize + pageSize - 1,
      );
      if (error) throw error;
      return { rows: (data ?? []) as unknown as AuditRow[], count: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;

  const filterLabel =
    [
      filters.q ? `Search: "${filters.q}"` : null,
      filters.woreda
        ? `Tenant: ${filters.woreda === PLATFORM_SCOPE ? "Platform" : tenantLabel({ woreda_id: filters.woreda })}`
        : null,
      filters.entity ? `Entity: ${filters.entity}` : null,
      filters.start ? `From: ${filters.start}` : null,
      filters.end ? `To: ${filters.end}` : null,
      !sort.isDefault ? `Sort: ${sort.field} ${sort.dir}` : null,
    ]
      .filter(Boolean)
      .join(" • ") || "No filters applied";

  const exportColumns: TableColumn<AuditRow>[] = [
    { header: "ቀን / Timestamp", value: (r) => new Date(r.action_at).toISOString() },
    { header: "ወረዳ / Tenant", value: (r) => tenantLabel(r) },
    { header: "ተጠቃሚ / Actor", value: (r) => r.actor?.full_name ?? r.actor?.username ?? "System" },
    { header: "ሚና / Role", value: (r) => r.actor?.role ?? "" },
    { header: "ክፍል / Entity", value: (r) => r.entity_name },
    { header: "Record ID", value: (r) => r.entity_id ?? "" },
    { header: "ተግባር / Action", value: (r) => r.action_type },
    { header: "Source IP", value: (r) => r.source_ip ?? "" },
  ];

  async function fetchAllMatchingRows(): Promise<AuditRow[]> {
    const { data, error } = await buildAuditQuery(0, EXPORT_ROW_LIMIT - 1);
    if (error) throw error;
    return (data ?? []) as unknown as AuditRow[];
  }

  function reportExported(count: number, format: string) {
    if (count >= EXPORT_ROW_LIMIT) {
      toast.warning(
        `Exported the first ${count} record(s) to ${format} — narrow the filters to capture the rest`,
      );
      return;
    }
    toast.success(`Exported ${count} record(s) to ${format}`);
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const allRows = await fetchAllMatchingRows();
      exportRowsToCsv({
        fileName: `platform-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows: allRows,
        filterLabel,
        titleEn: "Platform Audit Trail",
      });
      reportExported(allRows.length, "CSV");
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
        fileName: `platform-audit-trail-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: PLATFORM_BRANDING,
        titleAm: "የመድረክ ኦዲት መዝገብ",
        titleEn: "Platform Audit Trail",
        filterLabel,
        columns: exportColumns,
        rows: allRows,
      });
      reportExported(allRows.length, "PDF");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  }

  function resetAll() {
    setQ("");
    clearFilters();
    setPage(0);
  }

  return (
    <div className="p-6">
      <PageHeader
        icon={ScrollText}
        titleAm="የመድረክ ኦዲት መዝገብ"
        titleEn="Platform Audit Trail"
        description="በሁሉም ወረዳዎች ውስጥ ያሉ እንቅስቃሴዎች / Immutable activity record across every tenant"
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

      <Card className="mb-4 p-4">
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
            <Label className="font-noto-ethiopic text-xs">ወረዳ / Tenant</Label>
            <select
              className="h-10 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
              value={woreda}
              onChange={(e) => setWoreda(e.target.value)}
            >
              <option value="">All tenants</option>
              <option value={PLATFORM_SCOPE}>Platform (no tenant)</option>
              {woredas.map((w) => (
                <option key={w.woreda_id} value={w.woreda_id}>
                  {w.woreda_name_en}
                </option>
              ))}
            </select>
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
          <ClearFiltersButton active={filtersActive} onClear={resetAll} />
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
                <th className="px-4 py-2">ወረዳ / Tenant</th>
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
              {isLoading && <TableSkeletonRows cols={7} />}
              {isError && !isLoading && (
                <TableErrorRow cols={7} error={error} onRetry={() => refetch()} />
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <TableEmptyRow
                  cols={7}
                  filtered={filtersActive}
                  onClearFilters={resetAll}
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
                  const tenant = r.woreda_id ? woredaMap.get(r.woreda_id) : null;
                  return (
                    <tr key={r.audit_log_id} className="border-t hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2">
                        <div className="font-noto-ethiopic">{formatEthiopianDateShort(at)}</div>
                        <div className="text-xs text-slate-500">
                          {at.toLocaleString("en-GB", { hour12: false })}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {!r.woreda_id ? (
                          <Badge variant="secondary">Platform</Badge>
                        ) : tenant ? (
                          <div>
                            <div className="font-noto-ethiopic">{tenant.woreda_name_am}</div>
                            <div className="text-xs text-slate-500">{tenant.woreda_name_en}</div>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-slate-500">
                            {r.woreda_id.slice(0, 8)}…
                          </span>
                        )}
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
                        <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                          <Eye className="mr-1 h-4 w-4" /> View
                        </Button>
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
                <Field label="Tenant" value={tenantLabel(detail)} />
                <Field
                  label="Actor"
                  value={detail.actor?.full_name ?? detail.actor?.username ?? "System"}
                />
                <Field label="Role" value={detail.actor?.role ?? "—"} />
                <Field
                  label="Timestamp"
                  value={new Date(detail.action_at).toLocaleString("en-GB", { hour12: false })}
                />
                <Field label="Source IP" value={detail.source_ip ?? "—"} />
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
