import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Plus, Search, FilePlus, ShieldCheck } from "lucide-react";
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
import { formatEthiopianDateShort } from "@/utils/ethiopianCalendar";

const REQUEST_TYPES: { value: string; label: string }[] = [
  { value: "all", label: "ሁሉም / All" },
  { value: "new_issue", label: "አዲስ / New Issue" },
  { value: "renewal", label: "እድሳት / Renewal" },
  { value: "reissue_lost", label: "የጠፋ / Lost" },
  { value: "reissue_damaged", label: "የተበላሸ / Damaged" },
  { value: "reissue_stolen", label: "የተሰረቀ / Stolen" },
  { value: "reissue_correction", label: "እርማት / Correction" },
];

const STATUSES: { value: string; label: string }[] = [
  { value: "all", label: "ሁሉም / All" },
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
  { value: "closed", label: "ተዘግቷል / Closed" },
  { value: "revoked", label: "ተሽሯል / Revoked" },
];

const CRED_TYPES: { value: string; label: string }[] = [
  { value: "all", label: "ሁሉም / All" },
  { value: "card", label: "ካርድ / Card" },
  { value: "certificate", label: "ሰርተፍኬት / Certificate" },
  { value: "both", label: "ሁለቱም / Both" },
];

const REQUEST_TYPE_LABEL: Record<string, string> = {
  new_issue: "አዲስ / New",
  renewal: "እድሳት / Renewal",
  reissue_lost: "የጠፋ / Lost",
  reissue_damaged: "የተበላሸ / Damaged",
  reissue_stolen: "የተሰረቀ / Stolen",
  reissue_correction: "እርማት / Correction",
};

const CRED_TYPE_LABEL: Record<string, string> = {
  card: "ካርድ / Card",
  certificate: "ሰርተፍኬት / Certificate",
  both: "ሁለቱም / Both",
};

const SORT_COLUMN: Record<string, string> = {
  request_number: "request_number",
  submitted_at: "submitted_at",
  created_at: "created_at",
};

export const Route = createFileRoute("/woreda/credentials/")({
  ssr: false,
  component: CredentialsListPage,
});

interface CredentialRow {
  credential_request_id: string;
  request_number: string;
  request_type: string;
  credential_type: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  credential_id: string | null;
  resident: {
    resident_id: string;
    full_name: string | null;
    full_name_am: string | null;
    resident_number: string | null;
  } | null;
  credential: { status: string } | null;
}

function CredentialsListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  const { input: searchInput, setInput: setSearchInput, term: search } = useUrlSearchTerm();
  const [requestType, setRequestType] = useState("all");
  const [status, setStatus] = useState("all");
  const [credentialType, setCredentialType] = useState("all");
  const [exporting, setExporting] = useState(false);
  const brandingQuery = useReportBranding();
  const sort = useUrlSort("created_at", "desc");
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [search, requestType, status, credentialType, sort.key].join("|"),
  );

  const buildQuery = () => {
    let q = supabase
      .from("credential_request")
      .select(
        "credential_request_id, request_number, request_type, credential_type, status, submitted_at, created_at, credential_id, resident:resident_id(resident_id, full_name, full_name_am, resident_number), credential:residence_credential!credential_request_credential_id_fkey(status)",
        { count: "exact" },
      )
      .eq("woreda_id", woredaId as string);

    if (requestType !== "all") q = q.eq("request_type", requestType);
    if (status === "revoked") {
      q = q.eq("credential.status", "revoked").not("credential_id", "is", null);
    } else if (status !== "all") {
      q = q.eq("status", status);
    }

    if (credentialType !== "all") q = q.eq("credential_type", credentialType);
    if (search) {
      const escaped = search.replace(/[%,]/g, "");
      q = q.or(`request_number.ilike.%${escaped}%`);
    }
    const dbColumn = SORT_COLUMN[sort.field] ?? "created_at";
    q = q
      .order(dbColumn, { ascending: sort.dir === "asc" })
      .order("created_at", { ascending: false });
    return q;
  };

  const requestsQuery = useQuery({
    queryKey: [
      "credential-requests",
      woredaId,
      search,
      requestType,
      status,
      credentialType,
      sort.key,
      page,
      pageSize,
    ],
    enabled: !!woredaId && hasPermission(P.CREDENTIAL_READ),
    queryFn: async () => {
      const q = buildQuery().range(page * pageSize, page * pageSize + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;

      let rows = (data ?? []) as unknown as CredentialRow[];
      // Client-side filter for resident name when searching
      if (search) {
        const term = search.toLowerCase();
        rows = rows.filter((r) => {
          if (r.request_number?.toLowerCase().includes(term)) return true;
          return (
            (r.resident?.full_name ?? "").toLowerCase().includes(term) ||
            (r.resident?.full_name_am ?? "").includes(search)
          );
        });
      }

      return { rows, count: count ?? 0 };
    },
  });

  const resetFilters = () => {
    setRequestType("all");
    setStatus("all");
    setCredentialType("all");
    setSearchInput("");
  };
  const clearFilters = useClearTableFilters([], resetFilters);
  const filtersActive =
    !!search ||
    requestType !== "all" ||
    status !== "all" ||
    credentialType !== "all" ||
    !sort.isDefault;

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (search) parts.push(`Search: "${search}"`);
    if (requestType !== "all")
      parts.push(`Type: ${REQUEST_TYPE_LABEL[requestType] ?? requestType}`);
    if (status !== "all") parts.push(`Status: ${status}`);
    if (credentialType !== "all")
      parts.push(`Credential: ${CRED_TYPE_LABEL[credentialType] ?? credentialType}`);
    if (!sort.isDefault) parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  }, [search, requestType, status, credentialType, sort]);

  const exportColumns: TableColumn<CredentialRow>[] = [
    { header: "የጥያቄ ቁጥር / Request #", value: (r) => r.request_number },
    { header: "ስም / Resident (Am)", value: (r) => r.resident?.full_name_am },
    { header: "Resident (En)", value: (r) => r.resident?.full_name },
    { header: "የነዋሪ ቁጥር / Resident #", value: (r) => r.resident?.resident_number },
    { header: "ዓይነት / Type", value: (r) => REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type },
    {
      header: "የምስክርነት ዓይነት / Credential Type",
      value: (r) => CRED_TYPE_LABEL[r.credential_type] ?? r.credential_type,
    },
    {
      header: "ሁኔታ / Status",
      value: (r) => (r.credential?.status === "revoked" ? "revoked" : r.status),
    },
    {
      header: "የቀረበበት ቀን / Submitted",
      value: (r) => formatEthiopianDateShort(new Date(r.submitted_at ?? r.created_at)),
    },
  ];

  const fetchAllForExport = async (): Promise<CredentialRow[]> => {
    const q = buildQuery().range(0, 4999);
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data ?? []) as unknown as CredentialRow[];
    if (search) {
      const term = search.toLowerCase();
      rows = rows.filter((r) => {
        if (r.request_number?.toLowerCase().includes(term)) return true;
        return (
          (r.resident?.full_name ?? "").toLowerCase().includes(term) ||
          (r.resident?.full_name_am ?? "").includes(search)
        );
      });
    }
    return rows;
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      exportRowsToCsv({
        fileName: `credential-requests-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows,
        filterLabel,
        titleEn: "Credential Requests",
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
        fileName: `credential-requests-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: brandingQuery.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "የመታወቂያ ጥያቄዎች",
        titleEn: "Credential Requests",
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
        icon={CreditCard}
        titleAm="የመታወቂያ ጥያቄዎች"
        titleEn="Credential Requests"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
            <PermissionGate permission={P.CREDENTIAL_VERIFY}>
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/woreda/credentials/verify" })}
                className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                <span className="font-noto-ethiopic">ያረጋግጡ</span>
                <span className="ml-2 opacity-80">/ Verify</span>
              </Button>
            </PermissionGate>
            <PermissionGate permission={P.CREDENTIAL_ISSUE}>
              <Button
                onClick={() => navigate({ to: "/woreda/credentials/new" })}
                className="bg-blue-700 text-white hover:bg-blue-800"
              >
                <Plus className="mr-2 h-4 w-4" />
                <span className="font-noto-ethiopic">አዲስ ጥያቄ</span>
                <span className="ml-2 opacity-80">/ New Request</span>
              </Button>
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
            placeholder="የጥያቄ ቁጥር ወይም የነዋሪ ስም / Search by request # or resident name…"
            className="font-noto-ethiopic pl-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup
            label="Request Type"
            value={requestType}
            onChange={(v) => {
              setRequestType(v);
              setPage(0);
            }}
            options={REQUEST_TYPES}
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
          <FilterGroup
            label="Credential"
            value={credentialType}
            onChange={(v) => {
              setCredentialType(v);
              setPage(0);
            }}
            options={CRED_TYPES}
          />
          <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh field="request_number" sort={sort}>
                <span className="font-noto-ethiopic">የጥያቄ ቁጥር</span>
                <span className="ml-1 text-slate-400 normal-case">/ Request #</span>
              </SortableTh>
              <Th am="ነዋሪ" en="Resident" />
              <Th am="ዓይነት" en="Type" />
              <Th am="የምስክርነት ዓይነት" en="Credential Type" />
              <Th am="ሁኔታ" en="Status" />
              <SortableTh field="submitted_at" sort={sort}>
                <span className="font-noto-ethiopic">የቀረበበት ቀን</span>
                <span className="ml-1 text-slate-400 normal-case">/ Submitted</span>
              </SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requestsQuery.isLoading && <TableSkeletonRows cols={6} />}
            {requestsQuery.isError && (
              <TableErrorRow
                cols={6}
                error={requestsQuery.error}
                onRetry={() => requestsQuery.refetch()}
              />
            )}
            {!requestsQuery.isLoading &&
              !requestsQuery.isError &&
              (requestsQuery.data?.rows.length ?? 0) === 0 && (
                <TableEmptyRow cols={6} filtered={filtersActive} onClearFilters={clearFilters}>
                  {!filtersActive && (
                    <PermissionGate permission={P.CREDENTIAL_ISSUE}>
                      <Link to="/woreda/credentials/new" className="mt-3">
                        <Button className="bg-blue-700 text-white hover:bg-blue-800">
                          <FilePlus className="mr-2 h-4 w-4" />
                          <span className="font-noto-ethiopic">አዲስ ጥያቄ</span>
                          <span className="ml-2 opacity-80">/ New Request</span>
                        </Button>
                      </Link>
                    </PermissionGate>
                  )}
                </TableEmptyRow>
              )}
            {requestsQuery.data?.rows.map((r) => {
              const person = r.resident;
              return (
                <tr
                  key={r.credential_request_id}
                  className="cursor-pointer transition hover:bg-blue-50/40"
                  onClick={() =>
                    navigate({
                      to: "/woreda/credentials/$requestId",
                      params: { requestId: r.credential_request_id },
                    })
                  }
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{r.request_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-noto-ethiopic font-medium text-slate-900">
                      {person?.full_name_am || "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {person?.full_name} · {person?.resident_number}
                    </div>
                  </td>
                  <td className="font-noto-ethiopic px-4 py-3">
                    {REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}
                  </td>
                  <td className="font-noto-ethiopic px-4 py-3">
                    {CRED_TYPE_LABEL[r.credential_type] ?? r.credential_type}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip
                      status={r.credential?.status === "revoked" ? "revoked" : r.status}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatEthiopianDateShort(new Date(r.submitted_at ?? r.created_at))}
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
        total={requestsQuery.data?.count ?? 0}
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
