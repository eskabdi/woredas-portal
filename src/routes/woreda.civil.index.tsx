import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Search, Baby, HeartCrack, Heart, Scale, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import {
  TablePagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { TableSkeletonRows, TableEmptyRow, TableErrorRow } from "@/components/common/TableStates";
import {
  useUrlSort,
  SortableTh,
  useClearTableFilters,
  ClearFiltersButton,
  ExportButtons,
} from "@/components/common/TableToolbar";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";

const EVENT_TYPES = [
  { value: "all", label: "ሁሉም / All" },
  { value: "birth", label: "ልደት / Birth" },
  { value: "death", label: "ሞት / Death" },
  { value: "marriage", label: "ጋብቻ / Marriage" },
  { value: "divorce", label: "ፍቺ / Divorce" },
];

const STATUSES = [
  { value: "all", label: "ሁሉም / All" },
  { value: "submitted", label: "ገብቷል / Submitted" },
  { value: "under_review", label: "በክለሳ ላይ / Under Review" },
  { value: "pending_approval", label: "ጸድቆ በሚጠበቅ / Pending Approval" },
  { value: "approved", label: "ፀድቋል / Approved" },
  { value: "returned", label: "ተመልሷል / Returned" },
  { value: "approval_returned", label: "ተመልሷል (ማጽደቅ) / Returned (Approval)" },
  { value: "rejected", label: "ውድቅ / Rejected" },
];

const EVENT_TYPE_LABEL: Record<string, string> = {
  birth: "ልደት / Birth",
  death: "ሞት / Death",
  marriage: "ጋብቻ / Marriage",
  divorce: "ፍቺ / Divorce",
};

const SORT_COLUMN: Record<string, string> = {
  event_number: "event_number",
  event_date: "event_date",
  created_at: "created_at",
};

export const Route = createFileRoute("/woreda/civil/")({
  ssr: false,
  component: CivilListPage,
});

interface EventDetails {
  child_full_name_en?: string;
  child_first_name?: string;
  child_father_name?: string;
  child_grandfather_name?: string;
  deceased_name?: string;
  spouse1?: { name?: string | null; resident_id?: string | null };
  spouse2?: { name?: string | null; resident_id?: string | null };
}

interface VitalEventRow {
  vital_event_id: string;
  event_number: string;
  event_type: string;
  event_date: string | null;
  status: string;
  created_at: string;
  event_details: unknown;
  resident: { resident_id: string; full_name: string | null; full_name_am: string | null } | null;
}

function CivilListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  const { input: searchInput, setInput: setSearchInput, term: search } = useUrlSearchTerm();
  const [eventType, setEventType] = useState("all");
  const [status, setStatus] = useState("all");
  const [exporting, setExporting] = useState(false);
  const brandingQuery = useReportBranding();
  const sort = useUrlSort("created_at", "desc");
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [search, eventType, status, sort.key].join("|"),
  );

  const buildQuery = () => {
    let q = supabase
      .from("vital_event")
      .select(
        "vital_event_id, event_number, event_type, event_date, status, created_at, event_details, resident:resident_id(resident_id, full_name, full_name_am, resident_number)",
        { count: "exact" },
      )
      .eq("woreda_id", woredaId as string);

    if (eventType !== "all") q = q.eq("event_type", eventType);
    if (status !== "all") q = q.eq("status", status);
    if (search) {
      const escaped = search.replace(/[%,]/g, "");
      q = q.ilike("event_number", `%${escaped}%`);
    }
    const dbColumn = SORT_COLUMN[sort.field] ?? "created_at";
    q = q
      .order(dbColumn, { ascending: sort.dir === "asc" })
      .order("created_at", { ascending: false });
    return q;
  };

  const eventsQuery = useQuery({
    queryKey: ["vital-events", woredaId, search, eventType, status, sort.key, page, pageSize],
    enabled: !!woredaId && hasPermission(P.CIVIL_READ),
    queryFn: async () => {
      const q = buildQuery().range(page * pageSize, page * pageSize + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as VitalEventRow[], count: count ?? 0 };
    },
  });

  const resetFilters = () => {
    setEventType("all");
    setStatus("all");
    setSearchInput("");
  };
  const clearFilters = useClearTableFilters([], resetFilters);
  const filtersActive = !!search || eventType !== "all" || status !== "all" || !sort.isDefault;

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (search) parts.push(`Search: "${search}"`);
    if (eventType !== "all") parts.push(`Type: ${EVENT_TYPE_LABEL[eventType] ?? eventType}`);
    if (status !== "all") parts.push(`Status: ${status}`);
    if (!sort.isDefault) parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  }, [search, eventType, status, sort]);

  const subjectName = (row: {
    event_type: string;
    event_details: unknown;
    resident: { full_name: string | null; full_name_am: string | null } | null;
  }) => {
    const d = (row.event_details ?? {}) as EventDetails;
    if (row.event_type === "birth") {
      if (row.resident) {
        return { am: row.resident.full_name_am || "—", en: row.resident.full_name || "" };
      }
      const am = [d.child_first_name, d.child_father_name, d.child_grandfather_name]
        .filter(Boolean)
        .join(" ");
      return { am: am || "—", en: d.child_full_name_en ?? "" };
    }
    if (row.event_type === "death") {
      if (row.resident) {
        return { am: row.resident.full_name_am || "—", en: row.resident.full_name || "" };
      }
      return { am: d.deceased_name || "—", en: "" };
    }
    if (row.event_type === "marriage" || row.event_type === "divorce") {
      const a = d.spouse1?.name || row.resident?.full_name_am || row.resident?.full_name || "—";
      const b = d.spouse2?.name || "—";
      return { am: `${a} ↔ ${b}`, en: "" };
    }
    return { am: "—", en: "" };
  };

  const exportColumns: TableColumn<VitalEventRow>[] = [
    { header: "የክስተት ቁጥር / Event #", value: (r) => r.event_number },
    { header: "ዓይነት / Type", value: (r) => EVENT_TYPE_LABEL[r.event_type] ?? r.event_type },
    { header: "ስም / Subject (Am)", value: (r) => subjectName(r).am },
    { header: "Subject (En)", value: (r) => subjectName(r).en },
    {
      header: "የክስተት ቀን / Event Date",
      value: (r) => (r.event_date ? new Date(r.event_date).toLocaleDateString() : "—"),
    },
    { header: "ሁኔታ / Status", value: (r) => r.status },
  ];

  const fetchAllForExport = async (): Promise<VitalEventRow[]> => {
    const q = buildQuery().range(0, 4999);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as VitalEventRow[];
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      exportRowsToCsv({
        fileName: `vital-events-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows,
        filterLabel,
        titleEn: "Civil Registration Events",
      });
      toast.success("CSV export ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      await exportRowsToPdf({
        fileName: `vital-events-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: brandingQuery.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "የፍትሐ ብሔር ምዝገባ",
        titleEn: "Civil Registration",
        filterLabel,
        columns: exportColumns,
        rows,
      });
      toast.success("PDF export ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileText}
        titleAm="የፍትሐ ብሔር ምዝገባ"
        titleEn="Civil Registration"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
            <PermissionGate permission={P.CIVIL_REGISTER}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-blue-700 text-white hover:bg-blue-800">
                    <Plus className="mr-2 h-4 w-4" />
                    <span className="font-noto-ethiopic">አዲስ ምዝገባ</span>
                    <span className="ml-2 opacity-80">/ New Registration</span>
                    <ChevronDown className="ml-2 h-4 w-4 opacity-80" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/birth/new" })}>
                    <Baby className="mr-2 h-4 w-4 text-blue-600" />
                    <span className="font-noto-ethiopic">ልደት</span>
                    <span className="ml-auto text-xs text-slate-500">Birth</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/death/new" })}>
                    <HeartCrack className="mr-2 h-4 w-4 text-slate-700" />
                    <span className="font-noto-ethiopic">ሞት</span>
                    <span className="ml-auto text-xs text-slate-500">Death</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/marriage/new" })}>
                    <Heart className="mr-2 h-4 w-4 text-rose-600" />
                    <span className="font-noto-ethiopic">ጋብቻ</span>
                    <span className="ml-auto text-xs text-slate-500">Marriage</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/divorce/new" })}>
                    <Scale className="mr-2 h-4 w-4 text-amber-600" />
                    <span className="font-noto-ethiopic">ፍቺ</span>
                    <span className="ml-auto text-xs text-slate-500">Divorce</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          </div>
        }
      />

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="የክስተት ቁጥር / Search by event #…"
            className="font-noto-ethiopic pl-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup
            label="Type"
            value={eventType}
            onChange={(v) => {
              setEventType(v);
              setPage(0);
            }}
            options={EVENT_TYPES}
          />
          <FilterGroup
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
            options={STATUSES}
          />
          <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh field="event_number" sort={sort}>
                <span className="font-noto-ethiopic">የክስተት ቁጥር</span>
                <span className="ml-1 text-slate-400 normal-case">/ Event #</span>
              </SortableTh>
              <Th am="ዓይነት" en="Type" />
              <Th am="ስም" en="Subject" />
              <SortableTh field="event_date" sort={sort}>
                <span className="font-noto-ethiopic">የክስተት ቀን</span>
                <span className="ml-1 text-slate-400 normal-case">/ Event Date</span>
              </SortableTh>
              <Th am="ሁኔታ" en="Status" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {eventsQuery.isLoading && <TableSkeletonRows cols={5} />}
            {eventsQuery.isError && (
              <TableErrorRow
                cols={5}
                error={eventsQuery.error}
                onRetry={() => eventsQuery.refetch()}
              />
            )}
            {!eventsQuery.isLoading &&
              !eventsQuery.isError &&
              (eventsQuery.data?.rows.length ?? 0) === 0 && (
                <TableEmptyRow cols={5} filtered={filtersActive} onClearFilters={clearFilters}>
                  {!filtersActive && (
                    <PermissionGate permission={P.CIVIL_REGISTER}>
                      <Button
                        onClick={() => navigate({ to: "/woreda/civil/birth/new" })}
                        className="mt-3 bg-blue-700 text-white hover:bg-blue-800"
                      >
                        <Baby className="mr-2 h-4 w-4" />
                        <span className="font-noto-ethiopic">አዲስ የልደት ምዝገባ</span>
                        <span className="ml-2 opacity-80">/ New Birth</span>
                      </Button>
                    </PermissionGate>
                  )}
                </TableEmptyRow>
              )}
            {eventsQuery.data?.rows.map((r) => {
              const sub = subjectName(r);
              return (
                <tr
                  key={r.vital_event_id}
                  className="cursor-pointer transition hover:bg-blue-50/40"
                  onClick={() =>
                    navigate({
                      to: "/woreda/civil/$eventId",
                      params: { eventId: r.vital_event_id },
                    })
                  }
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{r.event_number}</td>
                  <td className="font-noto-ethiopic px-4 py-3">
                    {EVENT_TYPE_LABEL[r.event_type] ?? r.event_type}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-noto-ethiopic font-medium text-slate-900">{sub.am}</div>
                    {sub.en && <div className="text-xs text-slate-500">{sub.en}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {r.event_date ? new Date(r.event_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={r.status} />
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
        total={eventsQuery.data?.count ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        className="rounded-lg border bg-white"
      />
    </div>
  );
}

function Th({ am, en }: { am: string; en: string }) {
  return (
    <th className="px-4 py-3">
      <span className="font-noto-ethiopic">{am}</span>
      <span className="ml-1 text-slate-400 normal-case">/ {en}</span>
    </th>
  );
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
      <span className="text-xs font-medium text-slate-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-noto-ethiopic bg-transparent px-1 py-0.5 text-sm focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
