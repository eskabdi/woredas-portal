import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Search, UserPlus, Users } from "lucide-react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDateShort } from "@/utils/ethiopianCalendar";

type SexFilter = "all" | "male" | "female";
type StatusFilter = "all" | "active" | "inactive" | "deceased" | "moved_out";

export const Route = createFileRoute("/woreda/residents/")({
  ssr: false,
  component: ResidentsListPage,
});

function ResidentsListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { input: searchInput, setInput: setSearchInput, term: search } = useUrlSearchTerm();
  const [sex, setSex] = useState<SexFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kebeleId, setKebeleId] = useState<string>("all");
  const sort = useUrlSort("updated_at", "desc");
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [search, sex, status, kebeleId, sort.key].join("|"),
  );
  const [exporting, setExporting] = useState(false);
  const branding = useReportBranding();

  const kebelesQuery = useQuery({
    queryKey: ["kebeles", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele")
        .select("kebele_id, kebele_name_am, kebele_name_en, kebele_number")
        .eq("woreda_id", woredaId as string)
        .order("kebele_number");
      if (error) throw error;
      return data;
    },
  });

  const RESIDENT_SELECT =
    "resident_id, resident_number, full_name, full_name_am, sex, date_of_birth, residency_status, active_flag, updated_at, current_household_id, household:current_household_id(kebele_id, house_number, kebele:kebele_id(kebele_name_am, kebele_name_en, kebele_number))";

  const sortColumn = (field: string) => {
    switch (field) {
      case "full_name":
        return "full_name";
      case "resident_number":
        return "resident_number";
      case "date_of_birth":
        return "date_of_birth";
      case "residency_status":
        return "residency_status";
      default:
        return "updated_at";
    }
  };

  const buildResidentsQuery = () => {
    let q = supabase
      .from("resident")
      .select(RESIDENT_SELECT, { count: "exact" })
      .eq("woreda_id", woredaId as string);

    if (sex !== "all") q = q.eq("sex", sex);
    if (status !== "all") q = q.eq("residency_status", status);
    if (search) {
      const escaped = search.replace(/[%,]/g, "");
      q = q.or(
        [
          `full_name.ilike.%${escaped}%`,
          `full_name_am.ilike.%${escaped}%`,
          `resident_number.ilike.%${escaped}%`,
          `national_id_no.ilike.%${escaped}%`,
          `phone_number.ilike.%${escaped}%`,
        ].join(","),
      );
    }
    return q
      .order(sortColumn(sort.field), { ascending: sort.dir === "asc" })
      .order("resident_id", { ascending: true });
  };

  const residentsQuery = useQuery({
    queryKey: ["residents", woredaId, search, sex, status, kebeleId, page, pageSize, sort.key],
    enabled: !!woredaId && hasPermission(P.RESIDENT_READ),
    queryFn: async () => {
      const q = buildResidentsQuery().range(page * pageSize, page * pageSize + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      let rows = data ?? [];
      if (kebeleId !== "all") {
        rows = rows.filter((r) => {
          const hh = r.household as { kebele_id?: string } | null;
          return hh?.kebele_id === kebeleId;
        });
      }
      return { rows, count: count ?? 0 };
    },
  });

  const filtersActive =
    !!search || sex !== "all" || status !== "all" || kebeleId !== "all" || !sort.isDefault;

  const clearFilters = useClearTableFilters(["kebeleId"], () => {
    setSearchInput("");
    setSex("all");
    setStatus("all");
    setKebeleId("all");
  });

  const filterLabel = (() => {
    const parts: string[] = [];
    if (search) parts.push(`Search: "${search}"`);
    if (sex !== "all") parts.push(`Sex: ${sex}`);
    if (status !== "all") parts.push(`Status: ${status}`);
    if (kebeleId !== "all") {
      const k = (kebelesQuery.data ?? []).find((x) => x.kebele_id === kebeleId);
      parts.push(`Kebele: ${k ? k.kebele_number : kebeleId}`);
    }
    parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  })();

  const residentExportColumns: TableColumn<{
    resident_number: string | null;
    full_name: string | null;
    full_name_am: string | null;
    sex: string | null;
    date_of_birth: string | null;
    residency_status: string | null;
    updated_at: string;
    household: { kebele?: { kebele_name_am: string; kebele_number: string } | null } | null;
  }>[] = [
    { header: "Resident #", value: (r) => r.resident_number },
    { header: "ስም / Name", value: (r) => r.full_name_am || r.full_name },
    { header: "ጾታ / Sex", value: (r) => r.sex },
    {
      header: "የልደት ቀን / DOB",
      value: (r) => (r.date_of_birth ? new Date(r.date_of_birth).toLocaleDateString() : ""),
    },
    {
      header: "ቀበሌ / Kebele",
      value: (r) => {
        const hh = r.household as {
          kebele?: { kebele_name_am: string; kebele_number: string } | null;
        } | null;
        return hh?.kebele ? `${hh.kebele.kebele_number} — ${hh.kebele.kebele_name_am}` : "";
      },
    },
    { header: "ሁኔታ / Status", value: (r) => r.residency_status },
    { header: "የተሻሻለበት / Updated", value: (r) => new Date(r.updated_at).toLocaleDateString() },
  ];

  const fetchAllResidentsForExport = async () => {
    const q = buildResidentsQuery().range(0, 4999);
    const { data, error } = await q;
    if (error) throw error;
    let rows = data ?? [];
    if (kebeleId !== "all") {
      rows = rows.filter((r) => {
        const hh = r.household as { kebele_id?: string } | null;
        return hh?.kebele_id === kebeleId;
      });
    }
    return rows;
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllResidentsForExport();
      exportRowsToCsv({
        fileName: `residents-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: residentExportColumns,
        rows,
        filterLabel,
        titleEn: "Residents",
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
      const rows = await fetchAllResidentsForExport();
      await exportRowsToPdf({
        fileName: `residents-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: branding.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "ነዋሪዎች",
        titleEn: "Residents",
        filterLabel,
        columns: residentExportColumns,
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
    () => Math.max(1, Math.ceil((residentsQuery.data?.count ?? 0) / pageSize)),
    [residentsQuery.data?.count, pageSize],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        titleAm="ነዋሪዎች"
        titleEn="Residents"
        actions={
          <PermissionGate permission={P.RESIDENT_CREATE}>
            <Button
              onClick={() => navigate({ to: "/woreda/residents/new" })}
              className="bg-blue-700 text-white hover:bg-blue-800"
            >
              <Plus className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">አዲስ ነዋሪ</span>
              <span className="ml-2 opacity-80">/ New Resident</span>
            </Button>
          </PermissionGate>
        }
      />

      {/* Search + filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="በስም፣ የመታወቂያ ቁጥር፣ ስልክ ይፈልጉ / Search by name, ID number, phone…"
            className="font-noto-ethiopic pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterGroup
            label="Sex"
            value={sex}
            onChange={(v) => {
              setSex(v as SexFilter);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              { value: "male", label: "ወንድ / Male" },
              { value: "female", label: "ሴት / Female" },
            ]}
          />
          <FilterGroup
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v as StatusFilter);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም / All" },
              { value: "active", label: "ንቁ / Active" },
              { value: "inactive", label: "ኢ-ንቁ / Inactive" },
              { value: "moved_out", label: "ወጥቷል / Moved Out" },
              { value: "deceased", label: "ሞቷል / Deceased" },
            ]}
          />
          <FilterGroup
            label="Kebele"
            value={kebeleId}
            onChange={(v) => {
              setKebeleId(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "ሁሉም ቀበሌዎች / All Kebeles" },
              ...(kebelesQuery.data ?? []).map((k) => ({
                value: k.kebele_id,
                label: `${k.kebele_number} — ${k.kebele_name_am}`,
              })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
          <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh field="resident_number" sort={sort}>
                <span className="font-noto-ethiopic">የመዝገብ ቁጥር</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ Resident #</span>
              </SortableTh>
              <SortableTh field="full_name" sort={sort}>
                <span className="font-noto-ethiopic">ሙሉ ስም</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ Full Name</span>
              </SortableTh>
              <th className="px-4 py-3">
                <span className="font-noto-ethiopic">ጾታ</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ Sex</span>
              </th>
              <SortableTh field="date_of_birth" sort={sort}>
                <span className="font-noto-ethiopic">የልደት ቀን</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ DOB</span>
              </SortableTh>
              <th className="px-4 py-3">
                <span className="font-noto-ethiopic">ቀበሌ</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ Kebele</span>
              </th>
              <SortableTh field="residency_status" sort={sort}>
                <span className="font-noto-ethiopic">ሁኔታ</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ Status</span>
              </SortableTh>
              <SortableTh field="updated_at" sort={sort}>
                <span className="font-noto-ethiopic">የተሻሻለበት</span>{" "}
                <span className="ml-1 text-slate-400 normal-case">/ Updated</span>
              </SortableTh>
              <th className="font-noto-ethiopic px-4 py-3 text-right">ድርጊቶች / Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {residentsQuery.isLoading && <TableSkeletonRows cols={8} />}
            {residentsQuery.isError && (
              <TableErrorRow
                cols={8}
                error={residentsQuery.error}
                onRetry={() => residentsQuery.refetch()}
              />
            )}
            {!residentsQuery.isLoading &&
              !residentsQuery.isError &&
              (residentsQuery.data?.rows.length ?? 0) === 0 && (
                <TableEmptyRow
                  cols={8}
                  filtered={filtersActive}
                  onClearFilters={filtersActive ? clearFilters : undefined}
                  labelAm="እስካሁን የተመዘገበ ነዋሪ የለም"
                  labelEn="No residents registered yet"
                >
                  {!filtersActive && (
                    <PermissionGate permission={P.RESIDENT_CREATE}>
                      <Link to="/woreda/residents/new" className="mt-2">
                        <Button className="bg-blue-700 text-white hover:bg-blue-800">
                          <UserPlus className="mr-2 h-4 w-4" />
                          <span className="font-noto-ethiopic">አዲስ ነዋሪ መዝግብ</span>
                        </Button>
                      </Link>
                    </PermissionGate>
                  )}
                </TableEmptyRow>
              )}
            {!residentsQuery.isLoading &&
              !residentsQuery.isError &&
              residentsQuery.data?.rows.map((r) => {
                const hh = r.household as {
                  kebele?: { kebele_name_am: string; kebele_number: string } | null;
                } | null;
                return (
                  <tr
                    key={r.resident_id}
                    className="cursor-pointer transition hover:bg-blue-50/40"
                    onClick={() =>
                      navigate({
                        to: "/woreda/residents/$residentId",
                        params: { residentId: r.resident_id },
                      })
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {r.resident_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-noto-ethiopic font-medium text-slate-900">
                        {r.full_name_am || "—"}
                      </div>
                      <div className="text-xs text-slate-500">{r.full_name}</div>
                    </td>
                    <td className="font-noto-ethiopic px-4 py-3">
                      {r.sex === "male" ? "ወንድ" : r.sex === "female" ? "ሴት" : r.sex}
                    </td>
                    <td className="font-noto-ethiopic px-4 py-3">
                      {r.date_of_birth ? formatEthiopianDateShort(new Date(r.date_of_birth)) : "—"}
                    </td>
                    <td className="font-noto-ethiopic px-4 py-3">
                      {hh?.kebele
                        ? `${hh.kebele.kebele_number} — ${hh.kebele.kebele_name_am}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={r.residency_status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(r.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        resident={{
                          resident_id: r.resident_id,
                          full_name: r.full_name,
                          full_name_am: r.full_name_am,
                          residency_status: r.residency_status,
                          active_flag: r.active_flag,
                          current_household_id: r.current_household_id,
                        }}
                        woredaId={woredaId as string}
                        actorUserId={actorUserId}
                        onChanged={() => queryClient.invalidateQueries({ queryKey: ["residents"] })}
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
        total={residentsQuery.data?.count ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        className="rounded-lg border bg-white"
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

interface RowResident {
  resident_id: string;
  full_name: string | null;
  full_name_am: string | null;
  residency_status: string;
  active_flag: boolean;
  current_household_id: string | null;
}

type RowActionMode = null | "addHousehold" | "suspend" | "reactivate" | "deactivate" | "activate";

function RowActions({
  resident,
  woredaId,
  actorUserId,
  onChanged,
}: {
  resident: RowResident;
  woredaId: string;
  actorUserId: string | null;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission(P.RESIDENT_READ);
  const canUpdate = hasPermission(P.RESIDENT_UPDATE);
  const [mode, setMode] = useState<RowActionMode>(null);
  const [reason, setReason] = useState("");
  const close = () => {
    setMode(null);
    setReason("");
  };

  const writeAudit = async (
    action_type: string,
    old_value_json: Record<string, unknown> | null,
    new_value_json: Record<string, unknown> | null,
  ) => {
    await supabase.from("audit_log").insert({
      woreda_id: woredaId,
      actor_user_id: actorUserId,
      entity_name: "resident",
      entity_id: resident.resident_id,
      action_type,
      old_value_json: old_value_json as never,
      new_value_json: new_value_json as never,
      action_at: new Date().toISOString(),
    });
  };

  const suspendMutation = useMutation({
    mutationFn: async (reasonText: string) => {
      const { error } = await supabase
        .from("resident")
        .update({ residency_status: "suspended" })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit(
        "RESIDENT_SUSPENDED",
        { residency_status: resident.residency_status },
        { residency_status: "suspended", reason: reasonText },
      );
    },
    onSuccess: () => {
      toast.success("ነዋሪው ታግዷል / Resident suspended");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("resident")
        .update({ residency_status: "active" })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit(
        "RESIDENT_REACTIVATED",
        { residency_status: resident.residency_status },
        { residency_status: "active" },
      );
    },
    onSuccess: () => {
      toast.success("ነዋሪው ዳግም ነቅቷል / Resident reactivated");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("resident")
        .update({ active_flag: false })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit("RESIDENT_DEACTIVATED", { active_flag: true }, { active_flag: false });
    },
    onSuccess: () => {
      toast.success("ነዋሪው ወደ ኢ-ንቁ ሁኔታ ተቀይሯል / Resident set to inactive");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("resident")
        .update({ active_flag: true })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await writeAudit("RESIDENT_ACTIVATED", { active_flag: false }, { active_flag: true });
    },
    onSuccess: () => {
      toast.success("ነዋሪው ወደ ንቁ ሁኔታ ተቀይሯል / Resident restored to active");
      onChanged();
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const showSuspend = canUpdate && resident.residency_status === "active";
  const showReactivate = canUpdate && resident.residency_status === "suspended";
  const showDeactivate = canUpdate && resident.active_flag === true;
  const showActivate = canUpdate && resident.active_flag === false;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
            aria-label="Row actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canRead && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/woreda/residents/$residentId",
                  params: { residentId: resident.resident_id },
                })
              }
            >
              <span className="font-noto-ethiopic">ዝርዝር ይመልከቱ</span>
              <span className="ml-2 text-xs text-slate-500">/ View</span>
            </DropdownMenuItem>
          )}
          {canUpdate && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/woreda/residents/$residentId/edit",
                  params: { residentId: resident.resident_id },
                })
              }
            >
              <span className="font-noto-ethiopic">አስተካክል</span>
              <span className="ml-2 text-xs text-slate-500">/ Edit</span>
            </DropdownMenuItem>
          )}
          {canUpdate && (
            <DropdownMenuItem onClick={() => setMode("addHousehold")}>
              <span className="font-noto-ethiopic">ወደ ቤተሰብ ጨምር</span>
              <span className="ml-2 text-xs text-slate-500">/ Add to Household</span>
            </DropdownMenuItem>
          )}
          {(showSuspend || showReactivate || showDeactivate || showActivate) && (
            <DropdownMenuSeparator />
          )}
          {showSuspend && (
            <DropdownMenuItem
              className="text-amber-700 focus:text-amber-800"
              onClick={() => setMode("suspend")}
            >
              <span className="font-noto-ethiopic">አግድ</span>
              <span className="ml-2 text-xs text-slate-500">/ Suspend</span>
            </DropdownMenuItem>
          )}
          {showReactivate && (
            <DropdownMenuItem
              className="text-emerald-700 focus:text-emerald-800"
              onClick={() => setMode("reactivate")}
            >
              <span className="font-noto-ethiopic">ፍቀድ</span>
              <span className="ml-2 text-xs text-slate-500">/ Reactivate</span>
            </DropdownMenuItem>
          )}
          {showDeactivate && (
            <DropdownMenuItem className="text-slate-700" onClick={() => setMode("deactivate")}>
              <span className="font-noto-ethiopic">ቀይር (ኢ-ንቁ)</span>
              <span className="ml-2 text-xs text-slate-500">/ Set Inactive</span>
            </DropdownMenuItem>
          )}
          {showActivate && (
            <DropdownMenuItem
              className="text-emerald-700 focus:text-emerald-800"
              onClick={() => setMode("activate")}
            >
              <span className="font-noto-ethiopic">አንቃ</span>
              <span className="ml-2 text-xs text-slate-500">/ Reactivate</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <PermissionGate permission={P.RESIDENT_UPDATE}>
        <AddToHouseholdDialog
          open={mode === "addHousehold"}
          onClose={close}
          resident={resident}
          woredaId={woredaId}
          actorUserId={actorUserId}
          onChanged={onChanged}
        />
      </PermissionGate>

      <PermissionGate permission={P.RESIDENT_UPDATE}>
        <AlertDialog open={mode === "suspend"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ይህን ነዋሪ ለማገድ ይፈልጋሉ? / Suspend this resident?
              </AlertDialogTitle>
              <AlertDialogDescription className="font-noto-ethiopic">
                ምክንያት / Reason (required)
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ምክንያቱን ይጻፉ / Enter reason…"
              className="font-noto-ethiopic"
              rows={3}
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={reason.trim().length < 5 || suspendMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  suspendMutation.mutate(reason.trim());
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <span className="font-noto-ethiopic">አግድ / Suspend</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={mode === "reactivate"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ነዋሪውን ዳግም ማግበር ይፈልጋሉ? / Reactivate this resident?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={reactivateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  reactivateMutation.mutate();
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <span className="font-noto-ethiopic">ፍቀድ / Reactivate</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={mode === "deactivate"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ይህን ነዋሪ ወደ ኢ-ንቁ ሁኔታ መቀየር ይፈልጋሉ? / Set this resident to inactive?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deactivateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  deactivateMutation.mutate();
                }}
                className="bg-slate-700 hover:bg-slate-800"
              >
                <span className="font-noto-ethiopic">አረጋግጥ / Confirm</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={mode === "activate"} onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-noto-ethiopic">
                ነዋሪውን ወደ ንቁ ሁኔታ መቀየር ይፈልጋሉ? / Restore this resident to active?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={activateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  activateMutation.mutate();
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <span className="font-noto-ethiopic">አንቃ / Activate</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PermissionGate>
    </>
  );
}

interface HouseholdHit {
  household_id: string;
  house_number: string | null;
  kebele: { kebele_name_am: string | null; kebele_number: string | null } | null;
}

function AddToHouseholdDialog({
  open,
  onClose,
  resident,
  woredaId,
  actorUserId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  resident: RowResident;
  woredaId: string;
  actorUserId: string | null;
  onChanged: () => void;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setDebounced("");
      setSelectedId(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const search = useQuery({
    queryKey: ["household-search", woredaId, debounced],
    enabled: open && !!woredaId,
    queryFn: async () => {
      let q = supabase
        .from("household")
        .select("household_id, house_number, kebele:kebele_id(kebele_name_am, kebele_number)")
        .eq("woreda_id", woredaId)
        .order("house_number", { ascending: true })
        .limit(20);
      if (debounced) {
        const escaped = debounced.replace(/[%,]/g, "");
        q = q.ilike("house_number", `%${escaped}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as HouseholdHit[];
    },
  });

  const currentHouseholdQuery = useQuery({
    queryKey: ["household-current", resident.current_household_id],
    enabled: open && !!resident.current_household_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household")
        .select("household_id, house_number, kebele:kebele_id(kebele_name_am, kebele_number)")
        .eq("household_id", resident.current_household_id as string)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as HouseholdHit | null;
    },
  });

  const assign = useMutation({
    mutationFn: async (householdId: string) => {
      const { error } = await supabase
        .from("resident")
        .update({ current_household_id: householdId })
        .eq("resident_id", resident.resident_id)
        .eq("woreda_id", woredaId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "resident",
        entity_id: resident.resident_id,
        action_type: "HOUSEHOLD_ASSIGNED",
        old_value_json: { current_household_id: resident.current_household_id } as never,
        new_value_json: { current_household_id: householdId } as never,
        action_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast.success("ነዋሪው ወደ ቤተሰብ ተጨምሯል / Resident added to household");
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const displayName = resident.full_name_am || resident.full_name || "—";
  const current = currentHouseholdQuery.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-noto-ethiopic">ወደ ቤተሰብ ጨምር / Add to Household</DialogTitle>
          <DialogDescription>
            <span className="font-noto-ethiopic">{displayName}</span>
            <br />
            <span className="text-xs text-slate-500">
              {current
                ? `አሁን: ${current.house_number ?? "—"} — ${current.kebele?.kebele_name_am ?? ""}`
                : "Currently unassigned"}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="በቤት ቁጥር ይፈልጉ / Search by house number…"
            className="font-noto-ethiopic"
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
            {search.isLoading && <div className="p-3 text-sm text-slate-500">Loading…</div>}
            {!search.isLoading && (search.data?.length ?? 0) === 0 && (
              <div className="p-3 text-sm text-slate-500">
                <span className="font-noto-ethiopic">ምንም አልተገኘም / No households found</span>
              </div>
            )}
            {(search.data ?? []).map((h) => {
              const isSel = h.household_id === selectedId;
              return (
                <button
                  key={h.household_id}
                  type="button"
                  onClick={() => setSelectedId(h.household_id)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                    isSel ? "bg-blue-50 text-blue-900" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="font-mono text-xs">{h.house_number ?? "—"}</span>
                  <span className="font-noto-ethiopic text-xs text-slate-600">
                    {h.kebele
                      ? `${h.kebele.kebele_number ?? ""} — ${h.kebele.kebele_name_am ?? ""}`
                      : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selectedId || assign.isPending}
            onClick={() => selectedId && assign.mutate(selectedId)}
            className="bg-blue-700 text-white hover:bg-blue-800"
          >
            <span className="font-noto-ethiopic">ጨምር / Add</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
