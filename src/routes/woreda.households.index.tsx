import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Home, MoreHorizontal, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { toast } from "sonner";
import {
  useUrlSort,
  SortableTh,
  useClearTableFilters,
  ClearFiltersButton,
  ExportButtons,
} from "@/components/common/TableToolbar";
import { TableSkeletonRows, TableEmptyRow, TableErrorRow } from "@/components/common/TableStates";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";

import { Button } from "@/components/ui/button";
import {
  TablePagination,
  DEFAULT_PAGE_SIZE,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";


export const Route = createFileRoute("/woreda/households/")({
  ssr: false,
  component: HouseholdsListPage,
});

type OccupancyFilter = "all" | "occupied" | "vacant" | "demolished" | "transferred";
type HouseTypeFilter = "all" | "private" | "kebele" | "rental" | "government" | "rented_by_private" | "other";

function HouseholdsListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { input: searchInput, setInput: setSearchInput, term: search } = useUrlSearchTerm();
  const [kebeleId, setKebeleId] = useState<string>("all");
  const [occupancy, setOccupancy] = useState<OccupancyFilter>("all");
  const [houseType, setHouseType] = useState<HouseTypeFilter>("all");
  const [logForHouseholdId, setLogForHouseholdId] = useState<string | null>(null);
  const sort = useUrlSort("updated_at", "desc");
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [search, kebeleId, occupancy, houseType, sort.key].join("|"),
  );
  const [exporting, setExporting] = useState(false);
  const branding = useReportBranding();

  const kebelesQuery = useQuery({
    queryKey: ["kebeles", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele")
        .select("kebele_id, kebele_number, kebele_name_am")
        .eq("woreda_id", woredaId as string)
        .order("kebele_number");
      if (error) throw error;
      return data;
    },
  });

  const HOUSEHOLD_SELECT = `household_id, house_number, address_line, occupancy_status, house_type, woreda_id, updated_at,
           kebele:kebele_id ( kebele_id, kebele_number, kebele_name_am ),
           head:resident!household_head_resident_id ( full_name_am, full_name ),
           member_count:resident!current_household_id ( count )`;

  const sortColumn = (field: string) => {
    switch (field) {
      case "house_number":
        return "house_number";
      case "house_type":
        return "house_type";
      case "occupancy_status":
        return "occupancy_status";
      default:
        return "updated_at";
    }
  };

  const buildHouseholdsQuery = () => {
    let q = supabase
      .from("household")
      .select(HOUSEHOLD_SELECT, { count: "exact" })
      .eq("woreda_id", woredaId as string);

    if (kebeleId !== "all") q = q.eq("kebele_id", kebeleId);
    if (occupancy !== "all") q = q.eq("occupancy_status", occupancy);
    if (houseType !== "all") q = q.eq("house_type", houseType);
    if (search) {
      const escaped = search.replace(/[%,]/g, "");
      q = q.or(
        [
          `house_number.ilike.%${escaped}%`,
          `address_line.ilike.%${escaped}%`,
        ].join(","),
      );
    }
    return q.order(sortColumn(sort.field), { ascending: sort.dir === "asc" }).order("household_id", { ascending: true });
  };

  const householdsQuery = useQuery({
    queryKey: ["households", woredaId, search, kebeleId, occupancy, houseType, page, pageSize, sort.key],
    enabled: !!woredaId && hasPermission(P.HOUSEHOLD_READ),
    queryFn: async () => {
      const q = buildHouseholdsQuery().range(page * pageSize, page * pageSize + pageSize - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const filtersActive =
    !!search || kebeleId !== "all" || occupancy !== "all" || houseType !== "all" || !sort.isDefault;

  const clearFilters = useClearTableFilters([], () => {
    setSearchInput("");
    setKebeleId("all");
    setOccupancy("all");
    setHouseType("all");
  });

  const filterLabel = (() => {
    const parts: string[] = [];
    if (search) parts.push(`Search: "${search}"`);
    if (kebeleId !== "all") {
      const k = (kebelesQuery.data ?? []).find((x) => x.kebele_id === kebeleId);
      parts.push(`Kebele: ${k ? k.kebele_number : kebeleId}`);
    }
    if (occupancy !== "all") parts.push(`Occupancy: ${occupancy}`);
    if (houseType !== "all") parts.push(`Type: ${houseType}`);
    parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  })();

  type HouseholdExportRow = {
    house_number: string | null;
    occupancy_status: string | null;
    house_type: string | null;
    updated_at: string;
    kebele: { kebele_number: string; kebele_name_am: string } | null;
    head: { full_name_am: string | null; full_name: string | null } | null;
    member_count: { count: number }[] | null;
  };

  const householdExportColumns: TableColumn<HouseholdExportRow>[] = [
    { header: "House #", value: (h) => h.house_number },
    {
      header: "ቀበሌ / Kebele",
      value: (h) => (h.kebele ? `${h.kebele.kebele_number} — ${h.kebele.kebele_name_am}` : ""),
    },
    { header: "የቤተሰብ ኃላፊ / Household Head", value: (h) => h.head?.full_name_am || h.head?.full_name },
    { header: "አባላት / Members", value: (h) => h.member_count?.[0]?.count ?? 0 },
    { header: "የቤት አይነት / House Type", value: (h) => h.house_type },
    { header: "ሁኔታ / Status", value: (h) => h.occupancy_status },
    { header: "የተሻሻለበት / Updated", value: (h) => new Date(h.updated_at).toLocaleDateString() },
  ];

  const fetchAllHouseholdsForExport = async () => {
    const q = buildHouseholdsQuery().range(0, 4999);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as HouseholdExportRow[];
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllHouseholdsForExport();
      exportRowsToCsv({
        fileName: `households-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: householdExportColumns,
        rows,
        filterLabel,
        titleEn: "Households",
      });
      toast.success("CSV exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllHouseholdsForExport();
      await exportRowsToPdf({
        fileName: `households-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: branding.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "ቤተሰቦች",
        titleEn: "Households",
        filterLabel,
        columns: householdExportColumns,
        rows,
      });
      toast.success("PDF exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((householdsQuery.data?.count ?? 0) / pageSize)),
    [householdsQuery.data?.count],
  );

  if (!hasPermission(P.HOUSEHOLD_READ)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
        <p className="text-sm">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Home}
        titleAm="ቤተሰቦች"
        titleEn="Households"
        actions={
          <PermissionGate permission={P.HOUSEHOLD_CREATE}>
            <Button
              onClick={() => navigate({ to: "/woreda/households/new" })}
              className="bg-blue-700 text-white hover:bg-blue-800"
            >
              <Plus className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">አዲስ ቤተሰብ</span>
              <span className="ml-2 opacity-80">/ New Household</span>
            </Button>
          </PermissionGate>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="በቤት ቁጥር ወይም አድራሻ ይፈልጉ / Search by house number or address…"
            className="font-noto-ethiopic pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterGroup
            label="Kebele"
            value={kebeleId}
            onChange={(v) => {
              setKebeleId(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              ...(kebelesQuery.data ?? []).map((k) => ({
                value: k.kebele_id,
                label: `${k.kebele_number} — ${k.kebele_name_am}`,
              })),
            ]}
          />
          <FilterGroup
            label="Occupancy"
            value={occupancy}
            onChange={(v) => {
              setOccupancy(v as OccupancyFilter);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              { value: "occupied", label: "ተይዟል / Occupied" },
              { value: "vacant", label: "ባዶ / Vacant" },
              { value: "demolished", label: "ፈርሷል / Demolished" },
              { value: "transferred", label: "ተዛውሯል / Transferred" },
            ]}
          />
          <FilterGroup
            label="Type"
            value={houseType}
            onChange={(v) => {
              setHouseType(v as HouseTypeFilter);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              { value: "private", label: "የግል / Private" },
              { value: "kebele", label: "የቀበሌ / Kebele" },
              { value: "rental", label: "የኪራይ / Rental" },
              { value: "government", label: "የመንግስት / Government" },
              { value: "rented_by_private", label: "ኪራይ በግለሰብ / Rented Private" },
              { value: "other", label: "ሌላ / Other" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
          <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh field="house_number" sort={sort}><span className="font-noto-ethiopic">የቤት ቁጥር</span> <span className="ml-1 text-slate-400 normal-case">/ House #</span></SortableTh>
              <th className="px-4 py-3"><span className="font-noto-ethiopic">ቀበሌ</span> <span className="ml-1 text-slate-400 normal-case">/ Kebele</span></th>
              <th className="px-4 py-3"><span className="font-noto-ethiopic">የቤተሰብ ኃላፊ</span> <span className="ml-1 text-slate-400 normal-case">/ Household Head</span></th>
              <th className="px-4 py-3 text-center"><span className="font-noto-ethiopic">አባላት</span> <span className="ml-1 text-slate-400 normal-case">/ Members</span></th>
              <SortableTh field="house_type" sort={sort}><span className="font-noto-ethiopic">የቤት አይነት</span> <span className="ml-1 text-slate-400 normal-case">/ House Type</span></SortableTh>
              <SortableTh field="occupancy_status" sort={sort}><span className="font-noto-ethiopic">ሁኔታ</span> <span className="ml-1 text-slate-400 normal-case">/ Status</span></SortableTh>
              <SortableTh field="updated_at" sort={sort}><span className="font-noto-ethiopic">የተሻሻለበት</span> <span className="ml-1 text-slate-400 normal-case">/ Updated</span></SortableTh>
              <th className="font-noto-ethiopic px-4 py-3 text-right">ድርጊቶች / Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {householdsQuery.isLoading && <TableSkeletonRows cols={8} />}
            {householdsQuery.isError && (
              <TableErrorRow cols={8} error={householdsQuery.error} onRetry={() => householdsQuery.refetch()} />
            )}
            {!householdsQuery.isLoading && !householdsQuery.isError && (householdsQuery.data?.rows.length ?? 0) === 0 && (
              <TableEmptyRow
                cols={8}
                filtered={filtersActive}
                onClearFilters={filtersActive ? clearFilters : undefined}
                labelAm="እስካሁን የተመዘገበ ቤተሰብ የለም"
                labelEn="No households registered yet"
              >
                {!filtersActive && (
                  <PermissionGate permission={P.HOUSEHOLD_CREATE}>
                    <Link to="/woreda/households/new" className="mt-2">
                      <Button className="bg-blue-700 text-white hover:bg-blue-800">
                        <Plus className="mr-2 h-4 w-4" />
                        <span className="font-noto-ethiopic">አዲስ ቤተሰብ መዝግብ</span>
                      </Button>
                    </Link>
                  </PermissionGate>
                )}
              </TableEmptyRow>
            )}
            {!householdsQuery.isLoading && !householdsQuery.isError && householdsQuery.data?.rows.map((h) => {
              const kebele = h.kebele as unknown as { kebele_number: string; kebele_name_am: string } | null;
              const head = h.head as unknown as { full_name_am: string | null } | null;
              const memberAgg = h.member_count as unknown as { count: number }[] | null;
              const memberCount = memberAgg?.[0]?.count ?? 0;
              return (
                <tr
                  key={h.household_id}
                  className="cursor-pointer transition hover:bg-blue-50/40"
                  onClick={() =>
                    navigate({
                      to: "/woreda/households/$householdId",
                      params: { householdId: h.household_id },
                    })
                  }
                >
                  <td className="px-4 py-3 font-mono text-sm font-medium text-slate-900">{h.house_number}</td>
                  <td className="font-noto-ethiopic px-4 py-3 text-sm">
                    {kebele ? `${kebele.kebele_number} — ${kebele.kebele_name_am}` : "—"}
                  </td>
                  <td className="font-noto-ethiopic px-4 py-3 text-sm">{head?.full_name_am || "—"}</td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-slate-700">{memberCount}</td>
                  <td className="px-4 py-3">
                    {h.house_type ? <StatusChip status={h.house_type} /> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={h.occupancy_status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(h.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      household={{
                        household_id: h.household_id,
                        house_number: h.house_number,
                        occupancy_status: h.occupancy_status,
                      }}
                      woredaId={woredaId as string}
                      actorUserId={actorUserId}
                      onViewLog={() => setLogForHouseholdId(h.household_id)}
                      onChanged={() => queryClient.invalidateQueries({ queryKey: ["households"] })}
                    />
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
        total={householdsQuery.data?.count ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        className="rounded-lg border bg-white"
      />

      <ChangeLogDrawer
        householdId={logForHouseholdId}
        onClose={() => setLogForHouseholdId(null)}
      />
    </div>
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


interface RowHousehold {
  household_id: string;
  house_number: string;
  occupancy_status: string;
}

function RowActions({
  household,
  woredaId,
  actorUserId,
  onChanged,
  onViewLog,
}: {
  household: RowHousehold;
  woredaId: string;
  actorUserId: string | null;
  onChanged: () => void;
  onViewLog: () => void;
}) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission(P.HOUSEHOLD_READ);
  const canUpdate = hasPermission(P.HOUSEHOLD_UPDATE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  const deactivate = useMutation({
    mutationFn: async (reasonText: string) => {
      const { error } = await supabase
        .from("household")
        .update({ occupancy_status: "vacant" })
        .eq("household_id", household.household_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      const oldVal = { occupancy_status: household.occupancy_status };
      const newVal = { occupancy_status: "vacant", reason: reasonText };
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "household",
        entity_id: household.household_id,
        action_type: "HOUSEHOLD_DEACTIVATED",
        old_value_json: oldVal as never,
        new_value_json: newVal as never,
        action_at: new Date().toISOString(),
      });
      await supabase.from("household_change_log").insert({
        household_id: household.household_id,
        woreda_id: woredaId,
        change_type: "HOUSEHOLD_DEACTIVATED",
        registered_by_user_id: actorUserId,
        clerk_comment: reasonText,
        old_value_json: oldVal as never,
        new_value_json: newVal as never,
      });
    },
    onSuccess: () => {
      toast.success("ቤተሰቡ ኢ-ንቁ ሆኗል / Household set inactive");
      onChanged();
      setConfirmOpen(false);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="font-noto-ethiopic">
          {canRead && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/woreda/households/$householdId",
                  params: { householdId: household.household_id },
                })
              }
            >
              ዝርዝር ይመልከቱ / View
            </DropdownMenuItem>
          )}
          {canUpdate && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/woreda/households/$householdId/edit",
                  params: { householdId: household.household_id },
                })
              }
            >
              አስተካክል / Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onViewLog}>ዘርፍ ሪፖርት / View Change Log</DropdownMenuItem>
          {canUpdate && household.occupancy_status !== "demolished" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:text-red-700"
                onClick={() => setConfirmOpen(true)}
              >
                ቀይር (ኢ-ንቁ) / Set Inactive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <PermissionGate permission={P.HOUSEHOLD_UPDATE}>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-noto-ethiopic">ቤተሰብ ኢ-ንቁ አድርግ / Set Household Inactive</DialogTitle>
              <DialogDescription className="font-noto-ethiopic">
                ቤት ቁጥር <span className="font-mono">{household.house_number}</span> በመንጠቅ ሁኔታ ይቀየራል።
                <br />
                House <span className="font-mono">{household.house_number}</span> will be marked vacant.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="font-noto-ethiopic text-sm font-medium text-slate-700">
                ምክንያት / Reason <span className="text-red-600">*</span>
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ይህን ለውጥ ለምን ያደርጋሉ? / Why are you making this change?"
                rows={3}
                className="font-noto-ethiopic"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                ይቅር / Cancel
              </Button>
              <Button
                disabled={reason.trim().length < 5 || deactivate.isPending}
                onClick={() => deactivate.mutate(reason.trim())}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                ኢ-ንቁ አድርግ / Set Inactive
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PermissionGate>
    </>
  );
}

function ChangeLogDrawer({
  householdId,
  onClose,
}: {
  householdId: string | null;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["household-change-log", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household_change_log")
        .select("id, change_type, change_date, clerk_comment, created_at")
        .eq("household_id", householdId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return (
    <Sheet open={!!householdId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-noto-ethiopic">የለውጥ ምዝግብ / Change Log</SheetTitle>
          <SheetDescription>All recorded changes for this household.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3">
          {query.isLoading && <Skeleton className="h-16 w-full" />}
          {!query.isLoading && (query.data?.length ?? 0) === 0 && (
            <p className="font-noto-ethiopic text-sm text-slate-500">
              ምንም ለውጥ አልተመዘገበም / No changes recorded
            </p>
          )}
          {query.data?.map((row) => (
            <div key={row.id} className="rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">
                  {row.change_type}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </div>
              {row.clerk_comment && (
                <p className="font-noto-ethiopic mt-2 text-sm text-slate-700">{row.clerk_comment}</p>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
