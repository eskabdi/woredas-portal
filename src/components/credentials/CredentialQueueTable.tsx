import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Gavel, CreditCard, Eye, BadgeCheck, FilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDateShort } from "@/utils/ethiopianCalendar";
import {
  WorkflowQueueTable,
  useWorkflowQueueFilters,
  waitingDaysLabel,
  type QueueColumn,
  type QueueQuickAction,
} from "@/components/workflow/WorkflowQueueTable";

const REQUEST_TYPE_LABEL: Record<string, string> = {
  new_issue: "አዲስ / New",
  renewal: "እድሳት / Renewal",
  reissue_lost: "የጠፋ / Lost",
  reissue_damaged: "የተበላሸ / Damaged",
  reissue_stolen: "የተሰረቀ / Stolen",
  reissue_correction: "እርማት / Correction",
};

const SORT_COLUMN: Record<string, string> = {
  request_number: "request_number",
  submitted_at: "submitted_at",
  created_at: "created_at",
};

interface QueueRow {
  credential_request_id: string;
  request_number: string;
  request_type: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  credential_id: string | null;
  issuing_kebele_id: string | null;
  requested_by_user_id: string | null;
  resident: {
    resident_id: string;
    full_name: string | null;
    full_name_am: string | null;
    resident_number: string | null;
  } | null;
  credential: { status: string } | null;
}

/** A quick-action affordance rendered per row, gated on BOTH the row's
 * current status and the signed-in user's granular permission for that
 * stage -- never one or the other alone, since a permission the user
 * happens to hold is irrelevant if the row isn't actually at that stage. */
function quickActionFor(row: QueueRow): QueueQuickAction | null {
  switch (row.status) {
    case "submitted":
    case "under_review":
      return {
        icon: ShieldCheck,
        permission: P.CREDENTIAL_VERIFY,
        labelAm: "አረጋግጥ",
        labelEn: "Verify",
      };
    case "pending_approval":
      return { icon: Gavel, permission: P.CREDENTIAL_APPROVE, labelAm: "አጽድቅ", labelEn: "Approve" };
    case "awaiting_payment":
      return {
        icon: CreditCard,
        permission: P.CREDENTIAL_RECORD_PAYMENT,
        labelAm: "ክፍያ መዝግብ",
        labelEn: "Record Payment",
      };
    case "paid":
      return {
        icon: Eye,
        permission: P.CREDENTIAL_PREVIEW_PRINT,
        labelAm: "ቅድመ እይታ",
        labelEn: "Preview",
      };
    case "printed":
      return {
        icon: BadgeCheck,
        permission: P.CREDENTIAL_ACTIVATE,
        labelAm: "አስነቃ",
        labelEn: "Activate",
      };
    default:
      return null;
  }
}

const STATUS_OPTIONS = [
  { value: "submitted", label: "ገብቷል / Submitted" },
  { value: "under_review", label: "በክለሳ ላይ / Under Review" },
  { value: "verified", label: "ተረጋግጧል / Verified" },
  { value: "pending_approval", label: "ጸድቆ በሚጠበቅ / Pending Approval" },
  { value: "approved", label: "ፀድቋል / Approved" },
  { value: "returned", label: "ተመልሷል / Returned" },
  { value: "approval_returned", label: "ተመልሷል (ማጽደቅ) / Returned (Approval)" },
  { value: "rejected", label: "ውድቅ ተደርጓል / Rejected" },
  { value: "awaiting_payment", label: "ክፍያ በጥበቃ / Awaiting Payment" },
  { value: "paid", label: "ተከፍሏል / Paid" },
  { value: "printed", label: "ታትሟል / Printed" },
  { value: "active", label: "ንቁ / Active" },
  { value: "revoked", label: "ተሽሯል / Revoked" },
];

const TYPE_OPTIONS = Object.entries(REQUEST_TYPE_LABEL).map(([value, label]) => ({ value, label }));

/** Task 12.3b's queue table, generalized in Task 14-C into
 * WorkflowQueueTable (see docs/task14c-mapping-memo.md) so civil
 * registration and service requests reuse the same filter bar, sort
 * headers, loading/empty/error states and permission-gated quick-action
 * button instead of forking their own copies. This component's own
 * behavior (URL params, query shape, columns, quick actions) is
 * byte-identical to before the extraction -- only the presentational shell
 * moved into the shared component. */
export function CredentialQueueTable() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const filters = useWorkflowQueueFilters();

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

  const buildQuery = () => {
    let q = supabase
      .from("credential_request")
      .select(
        "credential_request_id, request_number, request_type, status, submitted_at, created_at, credential_id, issuing_kebele_id, requested_by_user_id, resident:resident_id(resident_id, full_name, full_name_am, resident_number), credential:residence_credential!credential_request_credential_id_fkey(status)",
        { count: "exact" },
      )
      .eq("woreda_id", woredaId as string);

    if (filters.type.value !== "all") q = q.eq("request_type", filters.type.value);
    if (filters.status.value === "revoked") {
      q = q.eq("credential.status", "revoked").not("credential_id", "is", null);
    } else if (filters.status.value !== "all") {
      q = q.eq("status", filters.status.value);
    }
    if (filters.kebele.value !== "all") q = q.eq("issuing_kebele_id", filters.kebele.value);
    if (filters.officer.value !== "all") q = q.eq("requested_by_user_id", filters.officer.value);
    if (filters.dateFrom.value) q = q.gte("submitted_at", filters.dateFrom.value);
    if (filters.dateTo.value) q = q.lte("submitted_at", `${filters.dateTo.value}T23:59:59`);
    if (filters.search) {
      const escaped = filters.search.replace(/[%,]/g, "");
      q = q.or(`request_number.ilike.%${escaped}%`);
    }
    const dbColumn = SORT_COLUMN[filters.sort.field] ?? "created_at";
    q = q
      .order(dbColumn, { ascending: filters.sort.dir === "asc" })
      .order("created_at", { ascending: false });
    return q;
  };

  const requestsQuery = useQuery({
    queryKey: [
      "credential-requests-queue",
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
    enabled: !!woredaId && hasPermission(P.CREDENTIAL_READ),
    queryFn: async () => {
      const q = buildQuery().range(
        filters.page * filters.pageSize,
        filters.page * filters.pageSize + filters.pageSize - 1,
      );
      const { data, error, count } = await q;
      if (error) throw error;
      let rows = (data ?? []) as unknown as QueueRow[];
      if (filters.search) {
        const term = filters.search.toLowerCase();
        rows = rows.filter((r) => {
          if (r.request_number?.toLowerCase().includes(term)) return true;
          return (
            (r.resident?.full_name ?? "").toLowerCase().includes(term) ||
            (r.resident?.full_name_am ?? "").includes(filters.search)
          );
        });
      }
      return { rows, count: count ?? 0 };
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

  const columns: QueueColumn<QueueRow>[] = [
    {
      key: "request_number",
      am: "የጥያቄ ቁጥር",
      en: "Request #",
      sortField: "request_number",
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.request_number}</span>,
    },
    {
      key: "resident",
      am: "ነዋሪ",
      en: "Resident",
      render: (r) => (
        <>
          <div className="font-am-body font-medium text-slate-900">
            {r.resident?.full_name_am || "—"}
          </div>
          <div className="text-xs text-slate-500">
            {r.resident?.full_name} · {r.resident?.resident_number}
          </div>
        </>
      ),
    },
    {
      key: "kebele",
      am: "ቀበሌ",
      en: "Kebele",
      render: (r) => (
        <span className="text-xs text-slate-600">
          {r.issuing_kebele_id ? (kebeleLabel[r.issuing_kebele_id] ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "type",
      am: "ዓይነት",
      en: "Type",
      render: (r) => (
        <span className="font-am-body">{REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}</span>
      ),
    },
    {
      key: "status",
      am: "ሁኔታ",
      en: "Status",
      render: (r) => (
        <StatusChip status={r.credential?.status === "revoked" ? "revoked" : r.status} />
      ),
    },
    {
      key: "submitted_at",
      am: "የቀረበበት ቀን",
      en: "Submitted",
      sortField: "submitted_at",
      render: (r) => (
        <span className="text-xs text-slate-500">
          {formatEthiopianDateShort(new Date(r.submitted_at ?? r.created_at))}
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
    <WorkflowQueueTable
      filters={filters}
      searchPlaceholder="የጥያቄ ቁጥር ወይም የነዋሪ ስም / Search by request # or resident name…"
      statusOptions={STATUS_OPTIONS}
      typeOptions={TYPE_OPTIONS}
      kebeleOptions={kebeleOptions}
      officerOptions={officerOptions}
      columns={columns}
      rows={requestsQuery.data?.rows ?? []}
      totalCount={requestsQuery.data?.count ?? 0}
      isLoading={requestsQuery.isLoading}
      isError={requestsQuery.isError}
      error={requestsQuery.error}
      onRetry={() => requestsQuery.refetch()}
      rowKey={(r) => r.credential_request_id}
      onRowClick={(r) =>
        navigate({
          to: "/woreda/credentials/$requestId",
          params: { requestId: r.credential_request_id },
        })
      }
      quickActionFor={quickActionFor}
      emptyAction={
        <PermissionGate permission={P.CREDENTIAL_ISSUE}>
          <Link to="/woreda/credentials/new" className="mt-3">
            <Button className="bg-[color:var(--color-shell-header)] text-white hover:bg-[color:var(--color-shell-header)]/90">
              <FilePlus className="mr-2 h-4 w-4" />
              <span className="font-am-body">አዲስ ጥያቄ</span>
              <span className="ml-2 opacity-80">/ New Request</span>
            </Button>
          </Link>
        </PermissionGate>
      }
    />
  );
}
