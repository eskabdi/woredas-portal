import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { KebeleFilter } from "@/components/common/KebeleFilter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { Navigate, useRouterState } from "@tanstack/react-router";
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

export const Route = createFileRoute("/woreda/rental-houses/")({
  ssr: false,
  component: RentalHouseListPage,
});

interface HouseRow {
  rental_house_id: string;
  house_number: string;
  address_line: string | null;
  monthly_rent_standard: number | null;
  occupancy_status: "vacant" | "occupied" | "under_maintenance";
  kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
  active_occupancy:
    | {
        occupancy_id: string;
        rent_amount: number;
        resident: { full_name_am: string | null; full_name: string | null } | null;
      }[]
    | null;
}

interface HouseViewRow extends HouseRow {
  occupant_name: string;
  current_rent: number | null;
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

// rental_occupancy_decrypted isn't in the generated types yet
// (00000000000023_pii_encryption.sql) -- same untyped-client cast pattern
// already used elsewhere in this codebase for pre-typegen tables. A separate
// bulk query rather than swapping the house query's `.from()` in place: that
// query embeds active_occupancy/resident via FK-derived PostgREST joins,
// which are not guaranteed to resolve through a view the same way they do
// through the base table. Overwrites rent_amount in place on each embedded
// occupancy row so toViewRow's existing logic (and sortRows/export below)
// stays unchanged.
async function decryptHouseRentAmounts(rows: HouseRow[]): Promise<HouseRow[]> {
  const ids = rows.flatMap((h) => (h.active_occupancy ?? []).map((o) => o.occupancy_id));
  if (ids.length === 0) return rows;
  const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = await db
    .from("rental_occupancy_decrypted")
    .select("occupancy_id, rent_amount_decrypted")
    .in("occupancy_id", ids);
  if (error) throw error;
  const amountById = new Map<string, number | null>(
    (data ?? []).map((d: { occupancy_id: string; rent_amount_decrypted: number | null }) => [
      d.occupancy_id,
      d.rent_amount_decrypted,
    ]),
  );
  return rows.map((h) => ({
    ...h,
    active_occupancy: (h.active_occupancy ?? []).map((o) => ({
      ...o,
      rent_amount: amountById.has(o.occupancy_id)
        ? (amountById.get(o.occupancy_id) ?? 0)
        : o.rent_amount,
    })),
  }));
}

function toViewRow(h: HouseRow): HouseViewRow {
  const active = (h.active_occupancy ?? []).find(
    (o) => (o as unknown as { status: string }).status === "active",
  );
  return {
    ...h,
    occupant_name: active?.resident?.full_name_am || active?.resident?.full_name || "—",
    current_rent: active?.rent_amount ?? h.monthly_rent_standard ?? null,
  };
}

const EXPORT_COLUMNS: TableColumn<HouseViewRow>[] = [
  { header: "የቤት ቁጥር / House", value: (r) => r.house_number },
  { header: "ቀበሌ / Kebele", value: (r) => r.kebele?.kebele_name_am ?? "" },
  { header: "ተያዥ / Occupancy", value: (r) => r.occupancy_status },
  { header: "ተከራይ / Occupant", value: (r) => r.occupant_name },
  { header: "የቤት ኪራይ / Rent", value: (r) => r.current_rent ?? "", align: "right" },
];

function sortRows(rows: HouseViewRow[], field: string, dir: "asc" | "desc"): HouseViewRow[] {
  const mul = dir === "asc" ? 1 : -1;
  const arr = [...rows];
  arr.sort((a, b) => {
    switch (field) {
      case "house_number":
        return mul * a.house_number.localeCompare(b.house_number);
      case "kebele":
        return mul * (a.kebele?.kebele_name_am ?? "").localeCompare(b.kebele?.kebele_name_am ?? "");
      case "occupancy_status":
        return mul * a.occupancy_status.localeCompare(b.occupancy_status);
      case "occupant_name":
        return mul * a.occupant_name.localeCompare(b.occupant_name);
      case "current_rent":
        return mul * ((a.current_rent ?? 0) - (b.current_rent ?? 0));
      default:
        return 0;
    }
  });
  return arr;
}

function RentalHouseListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [kebeleFilter, setKebeleFilter] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const sort = useUrlSort("house_number", "asc");
  const { data: branding } = useReportBranding();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["rental-houses", woredaId, qTerm, statusFilter, kebeleFilter],
    enabled: !!woredaId,
    queryFn: async () => {
      let query = supabase
        .from("kebele_rental_house")
        .select(
          `rental_house_id, house_number, address_line, monthly_rent_standard, occupancy_status,
           kebele:kebele_id ( kebele_name_am, kebele_number ),
           active_occupancy:rental_occupancy!rental_occupancy_rental_house_id_fkey ( occupancy_id, rent_amount, status, resident:resident_id ( full_name_am, full_name ) )`,
        )
        .eq("woreda_id", woredaId!)
        .order("house_number", { ascending: true });
      if (qTerm) query = query.ilike("house_number", `%${qTerm}%`);
      if (statusFilter) query = query.eq("occupancy_status", statusFilter);
      if (kebeleFilter) query = query.eq("kebele_id", kebeleFilter);
      const { data, error } = await query.limit(200);
      if (error) throw error;
      return decryptHouseRentAmounts(data as unknown as HouseRow[]);
    },
  });

  const rows = useMemo(() => (data ?? []).map(toViewRow), [data]);
  const sortedRows = useMemo(
    () => sortRows(rows, sort.field, sort.dir),
    [rows, sort.field, sort.dir],
  );

  const { page, setPage, pageSize, setPageSize, total, pageRows } = useClientPagination(
    sortedRows,
    [qTerm, statusFilter, kebeleFilter, sort.key].join("|"),
  );

  const clearFilters = useClearTableFilters([], () => {
    setStatusFilter("");
    setKebeleFilter("");
  });

  const filtersActive = !!qTerm || !!statusFilter || !!kebeleFilter || !sort.isDefault;

  function buildFilterLabel() {
    const parts: string[] = [];
    if (qTerm) parts.push(`Search: "${qTerm}"`);
    if (statusFilter) parts.push(`Status: ${statusFilter}`);
    if (kebeleFilter) parts.push(`Kebele: ${kebeleFilter}`);
    if (!sort.isDefault) parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  }

  async function handleExport(kind: "csv" | "pdf") {
    if (!woredaId) return;
    setExporting(true);
    try {
      let query = supabase
        .from("kebele_rental_house")
        .select(
          `rental_house_id, house_number, address_line, monthly_rent_standard, occupancy_status,
           kebele:kebele_id ( kebele_name_am, kebele_number ),
           active_occupancy:rental_occupancy!rental_occupancy_rental_house_id_fkey ( occupancy_id, rent_amount, status, resident:resident_id ( full_name_am, full_name ) )`,
        )
        .eq("woreda_id", woredaId)
        .order("house_number", { ascending: true });
      if (qTerm) query = query.ilike("house_number", `%${qTerm}%`);
      if (statusFilter) query = query.eq("occupancy_status", statusFilter);
      if (kebeleFilter) query = query.eq("kebele_id", kebeleFilter);
      const { data: allData, error } = await query.range(0, 4999);
      if (error) throw error;
      const decrypted = await decryptHouseRentAmounts(allData as unknown as HouseRow[]);
      const allRows = sortRows(decrypted.map(toViewRow), sort.field, sort.dir);
      const filterLabel = buildFilterLabel();
      const dateStr = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        exportRowsToCsv({
          fileName: `rental-houses-${dateStr}.csv`,
          columns: EXPORT_COLUMNS,
          rows: allRows,
          filterLabel,
          titleEn: "Kebele Rental Houses",
        });
      } else {
        await exportRowsToPdf({
          fileName: `rental-houses-${dateStr}.pdf`,
          branding: branding ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
          titleAm: "የቀበሌ የኪራይ ቤቶች",
          titleEn: "Kebele Rental Houses",
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
        icon={Building2}
        titleAm="የቀበሌ የኪራይ ቤቶች"
        titleEn="Kebele Rental Houses"
        description="Registry of kebele rental units and their occupancy"
        actions={
          hasPermission(P.RENTAL_CREATE) && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/woreda/rental-houses/occupants/new" })}
                className="font-noto-ethiopic"
              >
                <Plus className="mr-1 h-4 w-4" /> ተከራይ መዝግብ
              </Button>
              <Button onClick={() => navigate({ to: "/woreda/rental-houses/new" })}>
                <Plus className="mr-1 h-4 w-4" /> አዲስ ቤት / New House
              </Button>
            </div>
          )
        }
      />

      <TabNav />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="የቤት ቁጥር / House number"
              className="pl-8"
            />
          </div>
          <KebeleFilter
            value={kebeleFilter}
            onChange={(v) => {
              setKebeleFilter(v);
              setPage(0);
            }}
          />
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="vacant">Vacant</option>
            <option value="occupied">Occupied</option>
            <option value="under_maintenance">Under maintenance</option>
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
                <SortableTh field="house_number" sort={sort}>
                  የቤት ቁጥር / House
                </SortableTh>
                <SortableTh field="kebele" sort={sort}>
                  ቀበሌ / Kebele
                </SortableTh>
                <SortableTh field="occupancy_status" sort={sort}>
                  ተያዥ / Occupancy
                </SortableTh>
                <SortableTh field="occupant_name" sort={sort}>
                  ተከራይ / Occupant
                </SortableTh>
                <SortableTh field="current_rent" sort={sort}>
                  የቤት ኪራይ / Rent
                </SortableTh>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeletonRows cols={6} />}
              {!isLoading && isError && (
                <TableErrorRow cols={6} error={error} onRetry={() => refetch()} />
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <TableEmptyRow cols={6} filtered={filtersActive} onClearFilters={clearFilters} />
              )}
              {!isLoading &&
                !isError &&
                pageRows.map((r) => (
                  <tr key={r.rental_house_id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">{r.house_number}</td>
                    <td className="px-4 py-2 font-noto-ethiopic">
                      {r.kebele?.kebele_name_am ?? "—"}
                      {r.kebele?.kebele_number != null && (
                        <span className="ml-1 text-xs text-slate-500">
                          #{r.kebele.kebele_number}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={
                          r.occupancy_status === "occupied"
                            ? "default"
                            : r.occupancy_status === "vacant"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {r.occupancy_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-noto-ethiopic">{r.occupant_name}</td>
                    <td className="px-4 py-2">
                      {r.current_rent != null ? Number(r.current_rent).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        to="/woreda/rental-houses/$houseId"
                        params={{ houseId: r.rental_house_id }}
                        className="text-blue-700 hover:underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
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
