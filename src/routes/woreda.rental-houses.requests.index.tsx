import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  TablePagination,
  useClientPagination,
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

export const Route = createFileRoute("/woreda/rental-houses/requests/")({
  ssr: false,
  component: RentalRequestListPage,
});

interface RequestRow {
  rental_request_id: string;
  request_number: string;
  request_type: "new_registration" | "termination";
  status: string;
  rent_start_date: string | null;
  rent_amount: number | null;
  created_at: string;
  house: {
    rental_house_id: string;
    house_number: string;
  } | null;
  resident: {
    resident_id: string;
    full_name_am: string | null;
    full_name: string | null;
  } | null;
}

function TabNav() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/woreda/rental-houses", labelAm: "ቤቶች", labelEn: "Houses" },
    { to: "/woreda/rental-houses/requests", labelAm: "ጥያቄዎች", labelEn: "Requests" },
  ] as const;

  return (
    <div className="inline-flex h-9 items-center rounded-lg bg-slate-100 p-1">
      {tabs.map((t) => {
        const active =
          t.to === "/woreda/rental-houses/requests"
            ? currentPath === t.to || currentPath.startsWith(t.to + "/")
            : currentPath === t.to ||
              currentPath === t.to + "/" ||
              (currentPath.startsWith(t.to + "/") &&
                !currentPath.startsWith("/woreda/rental-houses/requests"));
        return (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              "inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition",
              active ? "bg-white text-slate-900 shadow" : "text-slate-500 hover:text-slate-700",
            )}
          >
            <span className="font-noto-ethiopic">{t.labelAm}</span>
            <span className="ml-1 text-xs text-slate-400">/ {t.labelEn}</span>
          </Link>
        );
      })}
    </div>
  );
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_LABEL: Record<string, { am: string; en: string; className: string }> = {
  submitted: { am: "ገብቷል", en: "Submitted", className: "bg-blue-100 text-blue-800" },
  under_review: { am: "በግምገማ ላይ", en: "Under review", className: "bg-amber-100 text-amber-800" },
  verified: { am: "ተረጋግጧል", en: "Verified", className: "bg-emerald-100 text-emerald-800" },
  returned: { am: "ተመልሷል", en: "Returned", className: "bg-orange-100 text-orange-800" },
  rejected: { am: "ውድቅ ተደርጓል", en: "Rejected", className: "bg-red-100 text-red-800" },
  approved: { am: "ፀድቋል", en: "Approved", className: "bg-green-100 text-green-800" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? {
    am: status,
    en: status,
    className: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-flex flex-col items-start rounded-md px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      <span className="font-noto-ethiopic leading-tight">{s.am}</span>
      <span className="text-[10px] font-normal opacity-80">{s.en}</span>
    </span>
  );
}

function requestTypeLabel(type: string) {
  return type === "termination"
    ? { am: "መተው", en: "Vacate" }
    : { am: "አዲስ ምዝገባ", en: "New registration" };
}

const EXPORT_COLUMNS: TableColumn<RequestRow>[] = [
  { header: "ጥያቄ ቁጥር / Request #", value: (r) => r.request_number },
  { header: "አይነት / Type", value: (r) => requestTypeLabel(r.request_type).en },
  { header: "ቤት / House", value: (r) => r.house?.house_number ?? "" },
  {
    header: "ተከራይ / Resident",
    value: (r) => r.resident?.full_name_am || r.resident?.full_name || "",
  },
  { header: "ኪራይ / Rent", value: (r) => r.rent_amount ?? "", align: "right" },
  { header: "ሁኔታ / Status", value: (r) => r.status },
  { header: "የቀረበ / Submitted", value: (r) => fmtDate(r.created_at) },
];

function sortRows(rows: RequestRow[], field: string, dir: "asc" | "desc"): RequestRow[] {
  const mul = dir === "asc" ? 1 : -1;
  const arr = [...rows];
  arr.sort((a, b) => {
    switch (field) {
      case "request_number":
        return mul * a.request_number.localeCompare(b.request_number);
      case "request_type":
        return mul * a.request_type.localeCompare(b.request_type);
      case "house":
        return mul * (a.house?.house_number ?? "").localeCompare(b.house?.house_number ?? "");
      case "resident":
        return (
          mul *
          (a.resident?.full_name_am || a.resident?.full_name || "").localeCompare(
            b.resident?.full_name_am || b.resident?.full_name || "",
          )
        );
      case "rent_amount":
        return mul * ((a.rent_amount ?? 0) - (b.rent_amount ?? 0));
      case "status":
        return mul * a.status.localeCompare(b.status);
      case "created_at":
        return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      default:
        return 0;
    }
  });
  return arr;
}

function RentalRequestListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const sort = useUrlSort("created_at", "desc");
  const { data: branding } = useReportBranding();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["rental-requests", woredaId, typeFilter, statusFilter],
    enabled: !!woredaId,
    queryFn: async () => {
      let query = supabase
        .from("rental_occupancy_request")
        .select(
          `rental_request_id, request_number, request_type, status, rent_start_date, rent_amount, created_at,
           house:rental_house_id ( rental_house_id, house_number ),
           resident:resident_id ( resident_id, full_name_am, full_name )`,
        )
        .eq("woreda_id", woredaId!)
        .neq("status", "approved")
        .order("created_at", { ascending: false });

      if (statusFilter) query = query.eq("status", statusFilter);
      if (typeFilter) query = query.eq("request_type", typeFilter);

      const { data, error } = await query.limit(300);
      if (error) throw error;
      return data as unknown as RequestRow[];
    },
  });

  const filteredRows = useMemo(() => {
    const term = qTerm.toLowerCase();
    if (!term) return data ?? [];
    return (data ?? []).filter((r) => {
      const residentName = r.resident?.full_name_am || r.resident?.full_name || "";
      return (
        r.request_number.toLowerCase().includes(term) ||
        r.house?.house_number.toLowerCase().includes(term) ||
        residentName.toLowerCase().includes(term)
      );
    });
  }, [data, qTerm]);

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sort.field, sort.dir),
    [filteredRows, sort.field, sort.dir],
  );

  const { page, setPage, pageSize, setPageSize, total, pageRows } = useClientPagination(
    sortedRows,
    [qTerm, typeFilter, statusFilter, sort.key].join("|"),
  );

  const clearFilters = useClearTableFilters([], () => {
    setTypeFilter("");
    setStatusFilter("");
  });

  const filtersActive = !!qTerm || !!typeFilter || !!statusFilter || !sort.isDefault;

  function buildFilterLabel() {
    const parts: string[] = [];
    if (qTerm) parts.push(`Search: "${qTerm}"`);
    if (typeFilter) parts.push(`Type: ${typeFilter}`);
    if (statusFilter) parts.push(`Status: ${statusFilter}`);
    if (!sort.isDefault) parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  }

  async function handleExport(kind: "csv" | "pdf") {
    if (!woredaId) return;
    setExporting(true);
    try {
      let query = supabase
        .from("rental_occupancy_request")
        .select(
          `rental_request_id, request_number, request_type, status, rent_start_date, rent_amount, created_at,
           house:rental_house_id ( rental_house_id, house_number ),
           resident:resident_id ( resident_id, full_name_am, full_name )`,
        )
        .eq("woreda_id", woredaId)
        .neq("status", "approved")
        .order("created_at", { ascending: false });
      if (statusFilter) query = query.eq("status", statusFilter);
      if (typeFilter) query = query.eq("request_type", typeFilter);
      const { data: allData, error } = await query.range(0, 4999);
      if (error) throw error;
      let allRows = allData as unknown as RequestRow[];
      const term = qTerm.toLowerCase();
      if (term) {
        allRows = allRows.filter((r) => {
          const residentName = r.resident?.full_name_am || r.resident?.full_name || "";
          return (
            r.request_number.toLowerCase().includes(term) ||
            r.house?.house_number.toLowerCase().includes(term) ||
            residentName.toLowerCase().includes(term)
          );
        });
      }
      allRows = sortRows(allRows, sort.field, sort.dir);
      const filterLabel = buildFilterLabel();
      const dateStr = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        exportRowsToCsv({
          fileName: `rental-requests-${dateStr}.csv`,
          columns: EXPORT_COLUMNS,
          rows: allRows,
          filterLabel,
          titleEn: "Rental Occupancy Requests",
        });
      } else {
        await exportRowsToPdf({
          fileName: `rental-requests-${dateStr}.pdf`,
          branding: branding ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
          titleAm: "የቤት ኪራይ ጥያቄዎች",
          titleEn: "Rental Occupancy Requests",
          filterLabel,
          columns: EXPORT_COLUMNS,
          rows: allRows,
        });
      }
      toast.success("Export complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (!hasPermission(P.RENTAL_VIEW)) return <Navigate to="/woreda/dashboard" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FileText}
        titleAm="የቤት ኪራይ ጥያቄዎች"
        titleEn="Rental Occupancy Requests"
        description="All new registration and vacate requests across kebele rental houses"
        actions={
          <Button asChild variant="outline">
            <Link to="/woreda/rental-houses">← Back to Houses</Link>
          </Button>
        }
      />

      <TabNav />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ጥያቄ ቁጥር / የቤት ቁጥር / የተከራይ ስም / Request, house or name"
              className="pl-8"
            />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            <option value="new_registration">New registration</option>
            <option value="termination">Vacate</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="returned">Returned</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
          <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
          <ExportButtons
            onCsv={() => handleExport("csv")}
            onPdf={() => handleExport("pdf")}
            busy={exporting}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <SortableTh field="request_number" sort={sort}>
                  ጥያቄ ቁጥር / Request #
                </SortableTh>
                <SortableTh field="request_type" sort={sort}>
                  አይነት / Type
                </SortableTh>
                <SortableTh field="house" sort={sort}>
                  ቤት / House
                </SortableTh>
                <SortableTh field="resident" sort={sort}>
                  ተከራይ / Resident
                </SortableTh>
                <SortableTh field="rent_amount" sort={sort}>
                  ኪራይ / Rent
                </SortableTh>
                <SortableTh field="status" sort={sort}>
                  ሁኔታ / Status
                </SortableTh>
                <SortableTh field="created_at" sort={sort}>
                  የቀረበ / Submitted
                </SortableTh>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeletonRows cols={8} />}
              {!isLoading && isError && (
                <TableErrorRow cols={8} error={error} onRetry={() => refetch()} />
              )}
              {!isLoading && !isError && sortedRows.length === 0 && (
                <TableEmptyRow cols={8} filtered={filtersActive} onClearFilters={clearFilters} />
              )}
              {!isLoading &&
                !isError &&
                pageRows.map((r) => {
                  const type = requestTypeLabel(r.request_type);
                  return (
                    <tr key={r.rental_request_id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{r.request_number}</td>
                      <td className="px-4 py-2">
                        <div className="font-noto-ethiopic text-xs">{type.am}</div>
                        <div className="text-[10px] text-slate-500">{type.en}</div>
                      </td>
                      <td className="px-4 py-2">
                        {r.house ? (
                          <Link
                            to="/woreda/rental-houses/$houseId"
                            params={{ houseId: r.house.rental_house_id }}
                            className="text-blue-700 hover:underline"
                          >
                            {r.house.house_number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 font-noto-ethiopic">
                        {r.resident ? (
                          <Link
                            to="/woreda/residents/$residentId"
                            params={{ residentId: r.resident.resident_id }}
                            className="text-blue-700 hover:underline"
                          >
                            {r.resident.full_name_am || r.resident.full_name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {r.rent_amount != null ? Number(r.rent_amount).toLocaleString() : "—"}
                        {r.rent_start_date && (
                          <div className="text-[10px] text-slate-500">
                            {fmtDate(r.rent_start_date)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2 text-slate-500">{fmtDate(r.created_at)}</td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          to="/woreda/rental-houses/requests/$requestId"
                          params={{ requestId: r.rental_request_id }}
                          className="text-blue-700 hover:underline"
                        >
                          Open →
                        </Link>
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
    </div>
  );
}
