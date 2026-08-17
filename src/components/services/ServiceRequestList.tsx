import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { KebeleFilter } from "@/components/common/KebeleFilter";
import {
  TablePagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import {
  ClearFiltersButton,
  ExportButtons,
  SortableTh,
  useClearTableFilters,
  useUrlSort,
} from "@/components/common/TableToolbar";
import { TableEmptyRow, TableErrorRow, TableSkeletonRows } from "@/components/common/TableStates";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";
import { useServiceTypes } from "@/hooks/useServiceTypes";
import {
  COMPLAINT_STATUS_OPTIONS,
  LETTER_STATUS_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_STYLE,
  SERVICE_STATUS_STYLE,
  serviceStatusLabel,
  type ServiceCategory,
} from "@/lib/serviceConstants";

interface Row {
  service_request_id: string;
  request_number: string;
  category: string;
  status: string;
  priority: string;
  subject: string | null;
  applicant_name: string | null;
  fee_amount: number;
  submitted_at: string;
  kebele_id: string | null;
  resident: { resident_id: string; full_name_am: string | null; full_name: string | null } | null;
  service_type: { name_am: string; name_en: string } | null;
}

const SORT_COLUMN: Record<string, string> = {
  request_number: "request_number",
  submitted_at: "submitted_at",
  status: "status",
  priority: "priority",
  fee_amount: "fee_amount",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={
        "font-noto-ethiopic inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
        (SERVICE_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700")
      }
    >
      {serviceStatusLabel(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={
        "font-noto-ethiopic inline-flex items-center rounded px-2 py-0.5 text-xs " +
        (PRIORITY_STYLE[priority] ?? "bg-slate-100 text-slate-700")
      }
    >
      {PRIORITY_LABEL[priority] ?? priority}
    </span>
  );
}

interface Props {
  category: ServiceCategory;
  titleAm: string;
  titleEn: string;
  descriptionAm: string;
}

export function ServiceRequestList({ category, titleAm, titleEn, descriptionAm }: Props) {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const branding = useReportBranding();
  const typesQuery = useServiceTypes({ category, activeOnly: false });

  const statusFilter = typeof search["st"] === "string" ? (search["st"] as string) : "all";
  const typeFilter = typeof search["ty"] === "string" ? (search["ty"] as string) : "";
  const kebeleFilter = typeof search["kb"] === "string" ? (search["kb"] as string) : "";

  const patch = (next: Record<string, unknown>) =>
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...next, page: undefined }),
      replace: true,
    } as never);

  const { input, setInput, term } = useUrlSearchTerm("q");
  const sort = useUrlSort("submitted_at", "desc");
  const resetKey = `${term}|${statusFilter}|${typeFilter}|${kebeleFilter}|${sort.key}`;
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(resetKey);
  const clearFilters = useClearTableFilters(["st", "ty", "kb"]);
  const [exporting, setExporting] = useState(false);

  const statusOptions = category === "complaint" ? COMPLAINT_STATUS_OPTIONS : LETTER_STATUS_OPTIONS;

  const buildQuery = (from: number, to: number) => {
    let q = supabase
      .from("service_request")
      .select(
        "service_request_id, request_number, category, status, priority, subject, applicant_name, fee_amount, submitted_at, kebele_id, resident:resident_id(resident_id, full_name_am, full_name), service_type:service_type_id(name_am, name_en)",
        { count: "exact" },
      )
      .eq("woreda_id", woredaId!)
      .eq("category", category);

    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (typeFilter) q = q.eq("service_type_id", typeFilter);
    if (kebeleFilter) q = q.eq("kebele_id", kebeleFilter);
    if (term.length >= 2) {
      const esc = term.replace(/[%,]/g, "");
      q = q.or(
        [
          `request_number.ilike.%${esc}%`,
          `applicant_name.ilike.%${esc}%`,
          `subject.ilike.%${esc}%`,
        ].join(","),
      );
    }
    const col = SORT_COLUMN[sort.field] ?? "submitted_at";
    return q.order(col, { ascending: sort.dir === "asc" }).range(from, to);
  };

  const listQuery = useQuery({
    queryKey: ["service-requests", category, woredaId, term, statusFilter, typeFilter, kebeleFilter, sort.key, page, pageSize],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error, count } = await buildQuery(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
  });

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const filtered = !!term || statusFilter !== "all" || !!typeFilter || !!kebeleFilter;

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { header: "ቁጥር / Reference", value: (r) => r.request_number, width: 1.2 },
      {
        header: "አመልካች / Applicant",
        value: (r) => r.applicant_name || r.resident?.full_name_am || r.resident?.full_name || "—",
        width: 1.4,
      },
      {
        header: "አገልግሎት / Service",
        value: (r) => r.service_type?.name_am ?? r.service_type?.name_en ?? "—",
        width: 1.6,
      },
      { header: "ጉዳይ / Subject", value: (r) => r.subject ?? "—", width: 1.6 },
      { header: "ደረጃ / Status", value: (r) => serviceStatusLabel(r.status), width: 1.2 },
      { header: "ቅድሚያ / Priority", value: (r) => PRIORITY_LABEL[r.priority] ?? r.priority, width: 1 },
      { header: "ክፍያ / Fee", value: (r) => Number(r.fee_amount ?? 0).toFixed(2), width: 0.8, align: "right" },
      {
        header: "ቀን / Submitted",
        value: (r) => new Date(r.submitted_at).toLocaleDateString("en-GB"),
        width: 1,
      },
    ],
    [],
  );

  const filterLabel = [
    term ? `search="${term}"` : null,
    statusFilter !== "all" ? `status=${statusFilter}` : null,
    typeFilter ? `service type selected` : null,
    kebeleFilter ? `kebele selected` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const fetchAllMatching = async (): Promise<Row[]> => {
    const out: Row[] = [];
    const step = 500;
    for (let from = 0; from < 5000; from += step) {
      const { data, error } = await buildQuery(from, from + step - 1);
      if (error) throw error;
      const chunk = (data ?? []) as unknown as Row[];
      out.push(...chunk);
      if (chunk.length < step) break;
    }
    return out;
  };

  const doExport = async (kind: "csv" | "pdf") => {
    setExporting(true);
    try {
      const all = await fetchAllMatching();
      if (all.length === 0) {
        toast.error("ምንም መዝገብ አልተገኘም / No records to export");
        return;
      }
      const base = category === "complaint" ? "complaints" : "service-requests";
      if (kind === "csv") {
        exportRowsToCsv({
          fileName: `${base}-${new Date().toISOString().slice(0, 10)}.csv`,
          columns,
          rows: all,
          titleEn: titleEn,
          filterLabel: filterLabel || "none",
        });
      } else {
        await exportRowsToPdf({
          fileName: `${base}-${new Date().toISOString().slice(0, 10)}.pdf`,
          branding: branding.data ?? { nameAm: "", nameEn: "", logoDataUrl: null },
          titleAm,
          titleEn,
          filterLabel: filterLabel || "none",
          columns,
          rows: all,
        });
      }
      toast.success(`${all.length} መዝገቦች ተልኳል / Exported ${all.length} records`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        titleAm={titleAm}
        titleEn={titleEn}
        description={descriptionAm}
        actions={
          hasPermission(P.SERVICE_CREATE) ? (
            <Link to="/woreda/services/new" search={{ category } as never}>

              <Button>
                <Plus className="mr-1 h-4 w-4" />
                <span className="font-noto-ethiopic">
                  {category === "complaint" ? "አዲስ ቅሬታ" : "አዲስ ጥያቄ"}
                </span>
              </Button>
            </Link>
          ) : null
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label className="font-noto-ethiopic text-xs">ፍለጋ / Search</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="ቁጥር፣ አመልካች ወይም ጉዳይ / Reference, applicant or subject"
                className="font-noto-ethiopic pl-9"
              />
            </div>
          </div>

          <div>
            <Label className="font-noto-ethiopic text-xs">ደረጃ / Status</Label>
            <select
              className="mt-1 block h-10 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(e) => patch({ st: e.target.value === "all" ? undefined : e.target.value })}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "ሁሉም / All" : serviceStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="font-noto-ethiopic text-xs">አገልግሎት / Service type</Label>
            <select
              className="font-noto-ethiopic mt-1 block h-10 w-[260px] rounded-md border border-input bg-background px-3 text-sm"
              value={typeFilter}
              onChange={(e) => patch({ ty: e.target.value || undefined })}
            >
              <option value="">ሁሉም / All types</option>
              {(typesQuery.data ?? []).map((t) => (
                <option key={t.service_type_id} value={t.service_type_id}>
                  {t.name_am} / {t.name_en}
                </option>
              ))}
            </select>
          </div>

          <KebeleFilter value={kebeleFilter} onChange={(v) => patch({ kb: v || undefined })} />

          <div className="ml-auto flex items-end gap-2">
            <ClearFiltersButton active={filtered || !sort.isDefault} onClear={clearFilters} />
            <ExportButtons onCsv={() => doExport("csv")} onPdf={() => doExport("pdf")} busy={exporting} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh field="request_number" sort={sort}>
                  ቁጥር / Reference
                </SortableTh>
                <th className="px-4 py-2">አመልካች / Applicant</th>
                <th className="px-4 py-2">አገልግሎት / Service</th>
                <SortableTh field="status" sort={sort}>
                  ደረጃ / Status
                </SortableTh>
                <SortableTh field="priority" sort={sort}>
                  ቅድሚያ / Priority
                </SortableTh>
                <SortableTh field="fee_amount" sort={sort} align="right" className="text-right">
                  ክፍያ / Fee
                </SortableTh>
                <SortableTh field="submitted_at" sort={sort}>
                  ቀን / Submitted
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {listQuery.isPending ? (
                <TableSkeletonRows cols={7} />
              ) : listQuery.isError ? (
                <TableErrorRow cols={7} error={listQuery.error} onRetry={() => listQuery.refetch()} />
              ) : rows.length === 0 ? (
                <TableEmptyRow cols={7} filtered={filtered} onClearFilters={clearFilters} />
              ) : (
                rows.map((r) => (
                  <tr key={r.service_request_id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to="/woreda/services/$requestId"
                        params={{ requestId: r.service_request_id }}
                        className="font-mono text-xs font-medium text-blue-700 hover:underline"
                      >
                        {r.request_number}
                      </Link>
                    </td>
                    <td className="font-noto-ethiopic px-4 py-3">
                      {r.applicant_name || r.resident?.full_name_am || r.resident?.full_name || "—"}
                    </td>
                    <td className="font-noto-ethiopic px-4 py-3">
                      {r.service_type?.name_am ?? r.service_type?.name_en ?? "—"}
                      {r.subject && <div className="text-xs text-slate-500">{r.subject}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {Number(r.fee_amount ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(r.submitted_at).toLocaleDateString("en-GB")}
                    </td>
                  </tr>
                ))
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
  );
}
