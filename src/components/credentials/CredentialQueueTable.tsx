import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Gavel, CreditCard, Eye, Printer, BadgeCheck, FilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TablePagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P, type Permission } from "@/config/permissions";
import { TableSkeletonRows, TableEmptyRow, TableErrorRow } from "@/components/common/TableStates";
import { useUrlSort, SortableTh, useClearTableFilters } from "@/components/common/TableToolbar";
import { formatEthiopianDateShort } from "@/utils/ethiopianCalendar";

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
function quickActionFor(row: QueueRow): {
  icon: typeof ShieldCheck;
  permission: Permission;
  labelAm: string;
  labelEn: string;
} | null {
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

/** Task 12.3b's queue table -- extracted from the plain list page so Task 14
 * (civil registration + service requests) can follow the same shape
 * (server-side filters, StatusChip, permission-gated quick actions,
 * computed waiting duration) for its own entities. Exported; not a fork
 * target -- see docs/task12-mapping-memo.md for how far the reuse actually
 * goes given the different backing tables. */
export function CredentialQueueTable() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  const { input: searchInput, setInput: setSearchInput, term: search } = useUrlSearchTerm();
  const status = useUrlFilter("status");
  const requestType = useUrlFilter("type");
  const kebeleId = useUrlFilter("kebele");
  const officerId = useUrlFilter("officer");
  const dateFrom = useUrlFilter("from");
  const dateTo = useUrlFilter("to");
  const sort = useUrlSort("created_at", "desc");
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [
      search,
      status.value,
      requestType.value,
      kebeleId.value,
      officerId.value,
      dateFrom.value,
      dateTo.value,
      sort.key,
    ].join("|"),
  );

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

    if (requestType.value !== "all") q = q.eq("request_type", requestType.value);
    if (status.value === "revoked") {
      q = q.eq("credential.status", "revoked").not("credential_id", "is", null);
    } else if (status.value !== "all") {
      q = q.eq("status", status.value);
    }
    if (kebeleId.value !== "all") q = q.eq("issuing_kebele_id", kebeleId.value);
    if (officerId.value !== "all") q = q.eq("requested_by_user_id", officerId.value);
    if (dateFrom.value) q = q.gte("submitted_at", dateFrom.value);
    if (dateTo.value) q = q.lte("submitted_at", `${dateTo.value}T23:59:59`);
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
      "credential-requests-queue",
      woredaId,
      search,
      requestType.value,
      status.value,
      kebeleId.value,
      officerId.value,
      dateFrom.value,
      dateTo.value,
      sort.key,
      page,
      pageSize,
    ],
    enabled: !!woredaId && hasPermission(P.CREDENTIAL_READ),
    queryFn: async () => {
      const q = buildQuery().range(page * pageSize, page * pageSize + pageSize - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      let rows = (data ?? []) as unknown as QueueRow[];
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

  // Waiting duration is computed from each row's own submitted_at against
  // "now" client-side (a simple elapsed-time display, not a security- or
  // report-relevant aggregate -- those go through get_credential_kpis()
  // instead, server-counted). credential_status_history isn't queried per
  // row here to avoid an N+1 fetch across a whole page of rows.
  const now = Date.now();
  const waitingDays = (row: QueueRow): number | null => {
    if (!row.submitted_at) return null;
    return Math.floor((now - new Date(row.submitted_at).getTime()) / 86_400_000);
  };

  const resetFilters = () => {
    requestType.set("all");
    status.set("all");
    kebeleId.set("all");
    officerId.set("all");
    dateFrom.set("");
    dateTo.set("");
    setSearchInput("");
  };
  const clearFilters = useClearTableFilters([], resetFilters);
  const filtersActive =
    !!search ||
    requestType.value !== "all" ||
    status.value !== "all" ||
    kebeleId.value !== "all" ||
    officerId.value !== "all" ||
    !!dateFrom.value ||
    !!dateTo.value;

  const kebeleLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const k of kebelesQuery.data ?? []) map[k.kebele_id] = `${k.kebele_number}`;
    return map;
  }, [kebelesQuery.data]);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="የጥያቄ ቁጥር ወይም የነዋሪ ስም / Search by request # or resident name…"
          className="font-noto-ethiopic"
        />
        <div className="flex flex-wrap items-end gap-2">
          <SelectFilter
            label="ሁኔታ / Status"
            value={status.value}
            onChange={(v) => {
              status.set(v);
              setPage(0);
            }}
            options={STATUS_OPTIONS}
          />
          <SelectFilter
            label="ዓይነት / Type"
            value={requestType.value}
            onChange={(v) => {
              requestType.set(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              ...Object.entries(REQUEST_TYPE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <SelectFilter
            label="ቀበሌ / Kebele"
            value={kebeleId.value}
            onChange={(v) => {
              kebeleId.set(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              ...(kebelesQuery.data ?? []).map((k) => ({
                value: k.kebele_id,
                label: `${k.kebele_number} · ${k.kebele_name_am}`,
              })),
            ]}
          />
          <SelectFilter
            label="ባለሙያ / Officer"
            value={officerId.value}
            onChange={(v) => {
              officerId.set(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              ...(officersQuery.data ?? []).map((o) => ({ value: o.user_id, label: o.full_name })),
            ]}
          />
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
            <span className="text-xs font-medium text-slate-500">ከ / From:</span>
            <EthiopianDateInput
              value={dateFrom.value}
              onChange={(v) => {
                dateFrom.set(v);
                setPage(0);
              }}
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
            <span className="text-xs font-medium text-slate-500">እስከ / To:</span>
            <EthiopianDateInput
              value={dateTo.value}
              onChange={(v) => {
                dateTo.set(v);
                setPage(0);
              }}
            />
          </div>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              አጽዳ / Clear
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh field="request_number" sort={sort}>
                <span className="font-noto-ethiopic">የጥያቄ ቁጥር</span>
                <span className="ml-1 text-slate-400 normal-case">/ Request #</span>
              </SortableTh>
              <Th am="ነዋሪ" en="Resident" />
              <Th am="ቀበሌ" en="Kebele" />
              <Th am="ዓይነት" en="Type" />
              <Th am="ሁኔታ" en="Status" />
              <SortableTh field="submitted_at" sort={sort}>
                <span className="font-noto-ethiopic">የቀረበበት ቀን</span>
                <span className="ml-1 text-slate-400 normal-case">/ Submitted</span>
              </SortableTh>
              <Th am="የቆየበት ጊዜ" en="Waiting" />
              <Th am="ፈጣን እርምጃ" en="Quick Action" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requestsQuery.isLoading && <TableSkeletonRows cols={8} />}
            {requestsQuery.isError && (
              <TableErrorRow
                cols={8}
                error={requestsQuery.error}
                onRetry={() => requestsQuery.refetch()}
              />
            )}
            {!requestsQuery.isLoading &&
              !requestsQuery.isError &&
              (requestsQuery.data?.rows.length ?? 0) === 0 && (
                <TableEmptyRow cols={8} filtered={filtersActive} onClearFilters={clearFilters}>
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
              const days = waitingDays(r);
              const action = quickActionFor(r);
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
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {r.issuing_kebele_id ? (kebeleLabel[r.issuing_kebele_id] ?? "—") : "—"}
                  </td>
                  <td className="font-noto-ethiopic px-4 py-3">
                    {REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip
                      status={r.credential?.status === "revoked" ? "revoked" : r.status}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatEthiopianDateShort(new Date(r.submitted_at ?? r.created_at))}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {days === null ? "—" : `${days} ${days === 1 ? "ቀን" : "ቀናት"}`}
                  </td>
                  <td className="px-4 py-3">
                    {action && (
                      <PermissionGate permission={action.permission}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({
                              to: "/woreda/credentials/$requestId",
                              params: { requestId: r.credential_request_id },
                            });
                          }}
                        >
                          <action.icon className="mr-1.5 h-3.5 w-3.5" />
                          <span className="font-noto-ethiopic">{action.labelAm}</span>
                          <span className="ml-1 opacity-70">/ {action.labelEn}</span>
                        </Button>
                      </PermissionGate>
                    )}
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

const STATUS_OPTIONS: { value: string; label: string }[] = [
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
  { value: "printed", label: "ታትሟል / Printed" },
  { value: "active", label: "ንቁ / Active" },
  { value: "revoked", label: "ተሽሯል / Revoked" },
];

function Th({ am, en }: { am: string; en: string }) {
  return (
    <th className="px-4 py-3">
      <span className="font-noto-ethiopic">{am}</span>
      <span className="ml-1 text-slate-400 normal-case">/ {en}</span>
    </th>
  );
}

function SelectFilter({
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
      <span className="font-noto-ethiopic text-xs font-medium text-slate-500">{label}:</span>
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

/** A minimal URL-persisted single filter value, following the exact same
 * useSearch()/navigate({search: prev => ...}) convention useUrlSort already
 * uses in this codebase, rather than reading window.location directly. */
function useUrlFilter(paramName: string): { value: string; set: (v: string) => void } {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const isDateParam = paramName === "from" || paramName === "to";
  const raw = search[paramName];
  const value = typeof raw === "string" && raw ? raw : isDateParam ? "" : "all";
  const set = (v: string) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        [paramName]: v === "all" || v === "" ? undefined : v,
        page: undefined,
      }),
      replace: true,
    } as never);
  };
  return { value, set };
}
