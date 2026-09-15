import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Plus,
  Baby,
  HeartCrack,
  Heart,
  Scale,
  ChevronDown,
  ShieldCheck,
  Gavel,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
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
import { ExportButtons } from "@/components/common/TableToolbar";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";
import { formatEthiopianDateShortOnly } from "@/utils/ethiopianCalendar";
import { CivilKpiWidgetRow } from "@/components/civil/CivilKpiWidgetRow";
import {
  WorkflowQueueTable,
  useWorkflowQueueFilters,
  waitingDaysLabel,
  type QueueColumn,
  type QueueQuickAction,
} from "@/components/workflow/WorkflowQueueTable";

const EVENT_TYPE_OPTIONS = [
  { value: "birth", label: "ልደት / Birth" },
  { value: "death", label: "ሞት / Death" },
  { value: "marriage", label: "ጋብቻ / Marriage" },
  { value: "divorce", label: "ፍቺ / Divorce" },
];

const STATUS_OPTIONS = [
  { value: "submitted", label: "ገብቷል / Submitted" },
  { value: "under_review", label: "በክለሳ ላይ / Under Review" },
  { value: "verified", label: "ተረጋግጧል / Verified" },
  { value: "pending_approval", label: "ጸድቆ በሚጠበቅ / Pending Approval" },
  { value: "approved", label: "ፀድቋል / Approved" },
  { value: "awaiting_payment", label: "ክፍያ በመጠባበቅ ላይ / Awaiting Payment" },
  { value: "paid", label: "ተከፍሏል / Paid" },
  { value: "registered", label: "ተመዝግቧል / Registered" },
  { value: "returned", label: "ተመልሷል / Returned" },
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
  requested_by_user_id: string | null;
  event_details: unknown;
  resident: { resident_id: string; full_name: string | null; full_name_am: string | null } | null;
  household: { kebele_id: string } | null;
}

/** Mirrors CredentialQueueTable's quickActionFor -- the row's status decides
 * WHICH stage action to offer; PermissionGate (applied by WorkflowQueueTable
 * itself) decides whether the signed-in user may actually see it. */
function quickActionFor(row: VitalEventRow): QueueQuickAction | null {
  switch (row.status) {
    case "submitted":
    case "under_review":
      return { icon: ShieldCheck, permission: P.CIVIL_VERIFY, labelAm: "አረጋግጥ", labelEn: "Verify" };
    case "pending_approval":
      return { icon: Gavel, permission: P.CIVIL_APPROVE, labelAm: "አጽድቅ", labelEn: "Approve" };
    case "awaiting_payment":
      return {
        icon: CreditCard,
        permission: P.CIVIL_RECORD_PAYMENT,
        labelAm: "ክፍያ መዝግብ",
        labelEn: "Record Payment",
      };
    default:
      return null;
  }
}

function CivilListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const filters = useWorkflowQueueFilters();
  const [exporting, setExporting] = useState(false);
  const brandingQuery = useReportBranding();

  const kebelesQuery = useQuery({
    queryKey: ["kebeles-for-filter", woredaId],
    enabled: !!woredaId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele")
        .select("kebele_id, kebele_number, kebele_name_am")
        .eq("woreda_id", woredaId!)
        .order("kebele_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const officersQuery = useQuery({
    queryKey: ["officers-for-filter", woredaId],
    enabled: !!woredaId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("user_id, full_name")
        .eq("woreda_id", woredaId!)
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // A birth/death event may have no household_id (household is optional on
  // vital_event) -- filtering by kebele therefore needs an INNER embed
  // (only when the filter is actually active) so events with no household
  // don't silently vanish from the unfiltered view, which a blanket
  // `!inner` embed would do.
  const buildQuery = () => {
    const householdEmbed =
      filters.kebele.value !== "all"
        ? "household:household_id!inner(kebele_id)"
        : "household:household_id(kebele_id)";
    let q = supabase
      .from("vital_event")
      .select(
        `vital_event_id, event_number, event_type, event_date, status, created_at, requested_by_user_id, event_details, resident:resident_id(resident_id, full_name, full_name_am, resident_number), ${householdEmbed}`,
        { count: "exact" },
      )
      .eq("woreda_id", woredaId as string);

    if (filters.type.value !== "all") q = q.eq("event_type", filters.type.value);
    if (filters.status.value !== "all") q = q.eq("status", filters.status.value);
    if (filters.kebele.value !== "all") q = q.eq("household.kebele_id", filters.kebele.value);
    if (filters.officer.value !== "all") q = q.eq("requested_by_user_id", filters.officer.value);
    if (filters.dateFrom.value) q = q.gte("event_date", filters.dateFrom.value);
    if (filters.dateTo.value) q = q.lte("event_date", filters.dateTo.value);
    if (filters.search) {
      const escaped = filters.search.replace(/[%,]/g, "");
      q = q.ilike("event_number", `%${escaped}%`);
    }
    const dbColumn = SORT_COLUMN[filters.sort.field] ?? "created_at";
    q = q
      .order(dbColumn, { ascending: filters.sort.dir === "asc" })
      .order("created_at", { ascending: false });
    return q;
  };

  const eventsQuery = useQuery({
    queryKey: [
      "vital-events",
      woredaId,
      filters.search,
      filters.type.value,
      filters.status.value,
      filters.kebele.value,
      filters.officer.value,
      filters.dateFrom.value,
      filters.dateTo.value,
      filters.sort.key,
      filters.page,
      filters.pageSize,
    ],
    enabled: !!woredaId && hasPermission(P.CIVIL_READ),
    queryFn: async () => {
      const q = buildQuery().range(
        filters.page * filters.pageSize,
        filters.page * filters.pageSize + filters.pageSize - 1,
      );
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as VitalEventRow[], count: count ?? 0 };
    },
  });

  const kebeleLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const k of kebelesQuery.data ?? []) map[k.kebele_id] = `${k.kebele_number}`;
    return map;
  }, [kebelesQuery.data]);

  const kebeleOptions = useMemo(
    () =>
      (kebelesQuery.data ?? []).map((k) => ({
        value: k.kebele_id,
        label: `${k.kebele_number} · ${k.kebele_name_am}`,
      })),
    [kebelesQuery.data],
  );
  const officerOptions = useMemo(
    () => (officersQuery.data ?? []).map((o) => ({ value: o.user_id, label: o.full_name })),
    [officersQuery.data],
  );

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
      value: (r) => formatEthiopianDateShortOnly(r.event_date ?? ""),
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
        filterLabel: filters.active ? "Filtered" : "No filters applied",
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
        filterLabel: filters.active ? "Filtered" : "No filters applied",
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

  const columns: QueueColumn<VitalEventRow>[] = [
    {
      key: "event_number",
      am: "የክስተት ቁጥር",
      en: "Event #",
      sortField: "event_number",
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.event_number}</span>,
    },
    {
      key: "type",
      am: "ዓይነት",
      en: "Type",
      render: (r) => (
        <span className="font-am-body">{EVENT_TYPE_LABEL[r.event_type] ?? r.event_type}</span>
      ),
    },
    {
      key: "subject",
      am: "ስም",
      en: "Subject",
      render: (r) => {
        const sub = subjectName(r);
        return (
          <>
            <div className="font-am-body font-medium text-slate-900">{sub.am}</div>
            {sub.en && <div className="text-xs text-slate-500">{sub.en}</div>}
          </>
        );
      },
    },
    {
      key: "kebele",
      am: "ቀበሌ",
      en: "Kebele",
      render: (r) => (
        <span className="text-xs text-slate-600">
          {r.household?.kebele_id ? (kebeleLabel[r.household.kebele_id] ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "event_date",
      am: "የክስተት ቀን",
      en: "Event Date",
      sortField: "event_date",
      render: (r) => (
        <span className="text-xs text-slate-500">
          {formatEthiopianDateShortOnly(r.event_date ?? "")}
        </span>
      ),
    },
    {
      key: "status",
      am: "ሁኔታ",
      en: "Status",
      render: (r) => <StatusChip status={r.status} />,
    },
    {
      key: "waiting",
      am: "የቆየበት ጊዜ",
      en: "Waiting",
      render: (r) => (
        <span className="text-xs text-slate-500">{waitingDaysLabel(r.created_at)}</span>
      ),
    },
  ];

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
                    <span className="font-am-body">አዲስ ምዝገባ</span>
                    <span className="ml-2 opacity-80">/ New Registration</span>
                    <ChevronDown className="ml-2 h-4 w-4 opacity-80" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/birth/new" })}>
                    <Baby className="mr-2 h-4 w-4 text-blue-600" />
                    <span className="font-am-body">ልደት</span>
                    <span className="ml-auto text-xs text-slate-500">Birth</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/death/new" })}>
                    <HeartCrack className="mr-2 h-4 w-4 text-slate-700" />
                    <span className="font-am-body">ሞት</span>
                    <span className="ml-auto text-xs text-slate-500">Death</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/marriage/new" })}>
                    <Heart className="mr-2 h-4 w-4 text-rose-600" />
                    <span className="font-am-body">ጋብቻ</span>
                    <span className="ml-auto text-xs text-slate-500">Marriage</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/woreda/civil/divorce/new" })}>
                    <Scale className="mr-2 h-4 w-4 text-amber-600" />
                    <span className="font-am-body">ፍቺ</span>
                    <span className="ml-auto text-xs text-slate-500">Divorce</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          </div>
        }
      />

      <CivilKpiWidgetRow />

      <WorkflowQueueTable
        filters={filters}
        searchPlaceholder="የክስተት ቁጥር / Search by event #…"
        statusOptions={STATUS_OPTIONS}
        typeOptions={EVENT_TYPE_OPTIONS}
        kebeleOptions={kebeleOptions}
        officerOptions={officerOptions}
        columns={columns}
        rows={eventsQuery.data?.rows ?? []}
        totalCount={eventsQuery.data?.count ?? 0}
        isLoading={eventsQuery.isLoading}
        isError={eventsQuery.isError}
        error={eventsQuery.error}
        onRetry={() => eventsQuery.refetch()}
        rowKey={(r) => r.vital_event_id}
        onRowClick={(r) =>
          navigate({ to: "/woreda/civil/$eventId", params: { eventId: r.vital_event_id } })
        }
        quickActionFor={quickActionFor}
        emptyAction={
          <PermissionGate permission={P.CIVIL_REGISTER}>
            <Button
              onClick={() => navigate({ to: "/woreda/civil/birth/new" })}
              className="mt-3 bg-blue-700 text-white hover:bg-blue-800"
            >
              <Baby className="mr-2 h-4 w-4" />
              <span className="font-am-body">አዲስ የልደት ምዝገባ</span>
              <span className="ml-2 opacity-80">/ New Birth</span>
            </Button>
          </PermissionGate>
        }
      />
    </div>
  );
}
