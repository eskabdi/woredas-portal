import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, ShieldCheck, Gavel, CreditCard, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { StatusChip } from "@/components/common/StatusChip";
import { ExportButtons } from "@/components/common/TableToolbar";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";
import { useServiceTypes } from "@/hooks/useServiceTypes";
import {
  WorkflowQueueTable,
  useWorkflowQueueFilters,
  waitingDaysLabel,
  type QueueColumn,
  type QueueQuickAction,
} from "@/components/workflow/WorkflowQueueTable";
import {
  COMPLAINT_STATUS_OPTIONS,
  LETTER_STATUS_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_STYLE,
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
  requested_by_user_id: string | null;
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

/** Delegates to the single shared StatusChip constant (Task 14-C) --
 * kept as a named export since other modules already import StatusBadge
 * by this name; no longer forks its own color map. */
export function StatusBadge({ status }: { status: string }) {
  return <StatusChip status={status} />;
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

/** Same status decides the stage; PermissionGate (inside WorkflowQueueTable)
 * decides whether it renders for the signed-in user. Complaints share the
 * same service.* permission keys as letters (both categories are seeded
 * into the same shared workflow_transition table -- see
 * docs/task14b-mapping-memo.md §0.1). */
function quickActionFor(row: Row): QueueQuickAction | null {
  switch (row.status) {
    case "submitted":
    case "under_review":
      return {
        icon: ShieldCheck,
        permission: P.SERVICE_VERIFY,
        labelAm: "አረጋግጥ",
        labelEn: "Verify",
      };
    case "pending_approval":
      return { icon: Gavel, permission: P.SERVICE_APPROVE, labelAm: "አጽድቅ", labelEn: "Approve" };
    case "awaiting_payment":
      return {
        icon: CreditCard,
        permission: P.SERVICE_RECORD_PAYMENT,
        labelAm: "ክፍያ መዝግብ",
        labelEn: "Record Payment",
      };
    case "paid":
      return {
        icon: FileCheck2,
        permission: P.SERVICE_ISSUE_LETTER,
        labelAm: "ደብዳቤ ስጥ",
        labelEn: "Issue Letter",
      };
    default:
      return null;
  }
}

interface Props {
  category: ServiceCategory;
  titleAm: string;
  titleEn: string;
  descriptionAm: string;
}

export function ServiceRequestList({ category, titleAm, titleEn, descriptionAm }: Props) {
  const woredaId = useAuthStore((s) => s.woredaId);
  const navigate = useNavigate();
  const branding = useReportBranding();
  const typesQuery = useServiceTypes({ category, activeOnly: false });
  const filters = useWorkflowQueueFilters();
  const [exporting, setExporting] = useState(false);

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

  const statusOptions = (
    category === "complaint" ? COMPLAINT_STATUS_OPTIONS : LETTER_STATUS_OPTIONS
  )
    .filter((s) => s !== "all")
    .map((s) => ({ value: s, label: serviceStatusLabel(s) }));
  const typeOptions = (typesQuery.data ?? []).map((t) => ({
    value: t.service_type_id,
    label: `${t.name_am} / ${t.name_en}`,
  }));
  const officerOptions = (officersQuery.data ?? []).map((o) => ({
    value: o.user_id,
    label: o.full_name,
  }));
  const kebeleOptions = (kebelesQuery.data ?? []).map((k) => ({
    value: k.kebele_id,
    label: `${k.kebele_number} · ${k.kebele_name_am}`,
  }));

  const buildQuery = () => {
    let q = supabase
      .from("service_request")
      .select(
        "service_request_id, request_number, category, status, priority, subject, applicant_name, fee_amount, submitted_at, kebele_id, requested_by_user_id, resident:resident_id(resident_id, full_name_am, full_name), service_type:service_type_id(name_am, name_en)",
        { count: "exact" },
      )
      .eq("woreda_id", woredaId!)
      .eq("category", category);

    if (filters.status.value !== "all") q = q.eq("status", filters.status.value);
    if (filters.type.value !== "all") q = q.eq("service_type_id", filters.type.value);
    if (filters.kebele.value !== "all") q = q.eq("kebele_id", filters.kebele.value);
    if (filters.officer.value !== "all") q = q.eq("requested_by_user_id", filters.officer.value);
    if (filters.dateFrom.value) q = q.gte("submitted_at", filters.dateFrom.value);
    if (filters.dateTo.value) q = q.lte("submitted_at", `${filters.dateTo.value}T23:59:59`);
    if (filters.search.length >= 2) {
      const esc = filters.search.replace(/[%,]/g, "");
      q = q.or(
        [
          `request_number.ilike.%${esc}%`,
          `applicant_name.ilike.%${esc}%`,
          `subject.ilike.%${esc}%`,
        ].join(","),
      );
    }
    const col = SORT_COLUMN[filters.sort.field] ?? "submitted_at";
    return q.order(col, { ascending: filters.sort.dir === "asc" });
  };

  const listQuery = useQuery({
    queryKey: [
      "service-requests",
      category,
      woredaId,
      filters.search,
      filters.status.value,
      filters.type.value,
      filters.kebele.value,
      filters.officer.value,
      filters.dateFrom.value,
      filters.dateTo.value,
      filters.sort.key,
      filters.page,
      filters.pageSize,
    ],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error, count } = await buildQuery().range(
        filters.page * filters.pageSize,
        filters.page * filters.pageSize + filters.pageSize - 1,
      );
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
  });

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const exportColumns: TableColumn<Row>[] = useMemo(
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
      {
        header: "ቅድሚያ / Priority",
        value: (r) => PRIORITY_LABEL[r.priority] ?? r.priority,
        width: 1,
      },
      {
        header: "ክፍያ / Fee",
        value: (r) => Number(r.fee_amount ?? 0).toFixed(2),
        width: 0.8,
        align: "right",
      },
      {
        header: "ቀን / Submitted",
        value: (r) => new Date(r.submitted_at).toLocaleDateString("en-GB"),
        width: 1,
      },
    ],
    [],
  );

  const fetchAllMatching = async (): Promise<Row[]> => {
    const out: Row[] = [];
    const step = 500;
    for (let from = 0; from < 5000; from += step) {
      const { data, error } = await buildQuery().range(from, from + step - 1);
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
          columns: exportColumns,
          rows: all,
          titleEn: titleEn,
          filterLabel: filters.active ? "Filtered" : "none",
        });
      } else {
        await exportRowsToPdf({
          fileName: `${base}-${new Date().toISOString().slice(0, 10)}.pdf`,
          branding: branding.data ?? { nameAm: "", nameEn: "", logoDataUrl: null },
          titleAm,
          titleEn,
          filterLabel: filters.active ? "Filtered" : "none",
          columns: exportColumns,
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

  const columns: QueueColumn<Row>[] = [
    {
      key: "request_number",
      am: "ቁጥር",
      en: "Reference",
      sortField: "request_number",
      render: (r) => (
        <span className="font-mono text-xs font-medium text-blue-700">{r.request_number}</span>
      ),
    },
    {
      key: "applicant",
      am: "አመልካች",
      en: "Applicant",
      render: (r) => (
        <span className="font-noto-ethiopic">
          {r.applicant_name || r.resident?.full_name_am || r.resident?.full_name || "—"}
        </span>
      ),
    },
    {
      key: "service_type",
      am: "አገልግሎት",
      en: "Service",
      render: (r) => (
        <>
          <span className="font-noto-ethiopic">
            {r.service_type?.name_am ?? r.service_type?.name_en ?? "—"}
          </span>
          {r.subject && <div className="text-xs text-slate-500">{r.subject}</div>}
        </>
      ),
    },
    {
      key: "status",
      am: "ደረጃ",
      en: "Status",
      sortField: "status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "priority",
      am: "ቅድሚያ",
      en: "Priority",
      sortField: "priority",
      render: (r) => <PriorityBadge priority={r.priority} />,
    },
    {
      key: "fee_amount",
      am: "ክፍያ",
      en: "Fee",
      sortField: "fee_amount",
      align: "right",
      render: (r) => (
        <span className="font-mono text-xs">{Number(r.fee_amount ?? 0).toFixed(2)}</span>
      ),
    },
    {
      key: "submitted_at",
      am: "ቀን",
      en: "Submitted",
      sortField: "submitted_at",
      render: (r) => (
        <span className="text-slate-600">
          {new Date(r.submitted_at).toLocaleDateString("en-GB")}
        </span>
      ),
    },
    {
      key: "waiting",
      am: "የቆየበት ጊዜ",
      en: "Waiting",
      render: (r) => (
        <span className="text-xs text-slate-500">{waitingDaysLabel(r.submitted_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        titleAm={titleAm}
        titleEn={titleEn}
        description={descriptionAm}
        actions={
          <div className="flex items-center gap-2">
            <ExportButtons
              onCsv={() => doExport("csv")}
              onPdf={() => doExport("pdf")}
              busy={exporting}
            />
            <Link to="/woreda/services/new" search={{ category } as never}>
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                <span className="font-noto-ethiopic">
                  {category === "complaint" ? "አዲስ ቅሬታ" : "አዲስ ጥያቄ"}
                </span>
              </Button>
            </Link>
          </div>
        }
      />

      <WorkflowQueueTable
        filters={filters}
        searchPlaceholder="ቁጥር፣ አመልካች ወይም ጉዳይ / Reference, applicant or subject"
        statusOptions={statusOptions}
        typeOptions={typeOptions}
        typeLabel="አገልግሎት / Service type"
        kebeleOptions={kebeleOptions}
        officerOptions={officerOptions}
        columns={columns}
        rows={rows}
        totalCount={total}
        isLoading={listQuery.isPending}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={() => listQuery.refetch()}
        rowKey={(r) => r.service_request_id}
        onRowClick={(r) =>
          navigate({
            to: "/woreda/services/$requestId",
            params: { requestId: r.service_request_id },
          })
        }
        quickActionFor={quickActionFor}
      />
    </div>
  );
}
