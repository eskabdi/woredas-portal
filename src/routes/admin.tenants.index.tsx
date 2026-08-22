import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Building2, Shield, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusChip } from "@/components/common/StatusChip";
import { PlatformUsersTab } from "@/components/admin/PlatformUsersTab";
import { supabase } from "@/integrations/supabase/client";
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
import { InsufficientConsolePermissionNotice } from "@/components/common/ConsolePermissionGate";
import { CP } from "@/config/permissions";
import { useAuthStore } from "@/stores/authStore";

const PLATFORM_BRANDING = {
  nameAm: "የሐረሪ ክልል አስተዳደር",
  nameEn: "Harari Regional Administration",
  logoDataUrl: null,
};

type TenantsTab = "tenants" | "users";
const VALID_TABS: TenantsTab[] = ["tenants", "users"];

interface TenantsSearch {
  tab?: TenantsTab;
}

export const Route = createFileRoute("/admin/tenants/")({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): TenantsSearch => {
    const t = raw.tab;
    return { tab: VALID_TABS.includes(t as TenantsTab) ? (t as TenantsTab) : "tenants" };
  },
  component: TenantsListPage,
});

const MODULE_LABELS: Record<string, { am: string; en: string }> = {
  credentials: { am: "የመኖሪያ መታወቂያ", en: "Credentials" },
  civil_registration: { am: "የኩነት ምዝገባ", en: "Civil" },
  revenue: { am: "ገቢ", en: "Revenue" },
  reports: { am: "ሪፖርቶች", en: "Reports" },
  audit: { am: "ኦዲት", en: "Audit" },
  services: { am: "አገልግሎት ጥያቄዎች", en: "Services" },
  approvals: { am: "የማጽደቅ ወረፋ", en: "Approvals" },
};

interface WoredaRow {
  woreda_id: string;
  woreda_code: string;
  woreda_numeric_code: number | null;
  woreda_name_am: string;
  woreda_name_en: string;
}
interface AdminRow {
  woreda_id: string | null;
  full_name: string;
  status: string;
}
interface ModuleRow {
  woreda_id: string;
  module_key: string;
  is_enabled: boolean;
}

function sortWoredas(rows: WoredaRow[], field: string, dir: "asc" | "desc"): WoredaRow[] {
  const mul = dir === "asc" ? 1 : -1;
  const arr = [...rows];
  arr.sort((a, b) => {
    switch (field) {
      case "woreda_name":
        return mul * a.woreda_name_am.localeCompare(b.woreda_name_am);
      case "woreda_code":
        return (
          mul *
          String(a.woreda_numeric_code ?? a.woreda_code).localeCompare(
            String(b.woreda_numeric_code ?? b.woreda_code),
          )
        );
      default:
        return 0;
    }
  });
  return arr;
}

function TenantsListPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (next: TenantsTab) => {
    // No-op on the already-active tab: Radix's TabsTrigger fires
    // onValueChange unconditionally on mousedown, even re-clicking the
    // selected tab, and this is a full replace below (see comment) -- so
    // without this guard, re-clicking "Tenants" while already on it would
    // reset its own filters as a side effect of a no-op click.
    if (next === tab) return;
    // Deliberately a full replace, not a merge: the Tenants table and
    // PlatformUsersTab both read/write the same unnamespaced q/sort/dir/
    // page/size keys (useUrlSort and useUrlPagination don't take a key
    // prefix the way useUrlSearchTerm does), so merging would leak one
    // tab's filter/sort/page into the other on every switch. Resetting to
    // just {tab} means each tab starts clean instead of silently
    // inheriting state that doesn't apply to it.
    navigate({ to: "/admin/tenants", search: { tab: next } });
  };

  const hasConsolePerm = useAuthStore((s) => s.hasConsolePermission);
  const canTenants = hasConsolePerm(CP.TENANTS_MANAGE);
  const canUsers = hasConsolePerm(CP.USERS_MANAGE);

  // A console-scoped super_admin might only hold one of the two permissions
  // behind this merged nav entry -- land them on the tab they can actually
  // use rather than the fixed "tenants" default, and correct a direct link
  // to the other tab the same way.
  useEffect(() => {
    if (tab === "tenants" && !canTenants && canUsers) setTab("users");
    else if (tab === "users" && !canUsers && canTenants) setTab("tenants");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canTenants, canUsers]);

  const {
    data: woredas = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin-tenants-woredas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_id, woreda_code, woreda_numeric_code, woreda_name_am, woreda_name_en")
        .order("woreda_numeric_code");
      if (error) throw error;
      return (data ?? []) as WoredaRow[];
    },
  });

  const { data: admins = [] } = useQuery({
    queryKey: ["admin-tenants-admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("woreda_id, full_name, status")
        .eq("role", "tenant_admin");
      if (error) throw error;
      return (data ?? []) as AdminRow[];
    },
  });

  const { data: modules = [] } = useQuery({
    queryKey: ["admin-tenants-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_module_config")
        .select("woreda_id, module_key, is_enabled");
      if (error) throw error;
      return (data ?? []) as ModuleRow[];
    },
  });

  const adminByWoreda = new Map<string, AdminRow[]>();
  for (const a of admins) {
    if (!a.woreda_id) continue;
    const arr = adminByWoreda.get(a.woreda_id) ?? [];
    arr.push(a);
    adminByWoreda.set(a.woreda_id, arr);
  }

  const modulesByWoreda = new Map<string, Set<string>>();
  for (const m of modules) {
    if (!modulesByWoreda.has(m.woreda_id)) modulesByWoreda.set(m.woreda_id, new Set());
    if (m.is_enabled) modulesByWoreda.get(m.woreda_id)!.add(m.module_key);
  }

  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();
  const [exporting, setExporting] = useState(false);
  const sort = useUrlSort("woreda_code", "asc");

  const filteredWoredas = useMemo(() => {
    const term = qTerm.toLowerCase();
    if (!term) return woredas;
    return woredas.filter((w) =>
      [w.woreda_name_am, w.woreda_name_en, w.woreda_code, w.woreda_numeric_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [woredas, qTerm]);

  const sortedWoredas = useMemo(
    () => sortWoredas(filteredWoredas, sort.field, sort.dir),
    [filteredWoredas, sort.field, sort.dir],
  );

  const { page, setPage, pageSize, setPageSize, total, pageRows } = useClientPagination(
    sortedWoredas,
    [qTerm, sort.key].join("|"),
  );

  const clearFilters = useClearTableFilters();
  const filtersActive = !!qTerm || !sort.isDefault;

  function buildFilterLabel() {
    const parts: string[] = [];
    if (qTerm) parts.push(`Search: "${qTerm}"`);
    if (!sort.isDefault) parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  }

  function moduleSummary(woredaId: string) {
    const enabled = modulesByWoreda.get(woredaId) ?? new Set<string>();
    return Object.keys(MODULE_LABELS)
      .filter((k) => enabled.has(k))
      .map((k) => MODULE_LABELS[k].en)
      .join(", ");
  }

  function adminName(woredaId: string) {
    const wAdmins = adminByWoreda.get(woredaId) ?? [];
    const activeAdmin = wAdmins.find((a) => a.status !== "suspended");
    return activeAdmin?.full_name ?? "No Admin Assigned";
  }

  const EXPORT_COLUMNS: TableColumn<WoredaRow>[] = [
    { header: "ወረዳ / Woreda", value: (w) => w.woreda_name_am },
    { header: "ኮድ / Code", value: (w) => w.woreda_numeric_code ?? w.woreda_code },
    { header: "የወረዳ አስተዳዳሪ / Tenant Admin", value: (w) => adminName(w.woreda_id) },
    { header: "የነቁ ሞጁሎች / Enabled Modules", value: (w) => moduleSummary(w.woreda_id) },
  ];

  async function handleExport(kind: "csv" | "pdf") {
    setExporting(true);
    try {
      const filterLabel = buildFilterLabel();
      const dateStr = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        exportRowsToCsv({
          fileName: `tenants-${dateStr}.csv`,
          columns: EXPORT_COLUMNS,
          rows: sortedWoredas,
          filterLabel,
          titleEn: "Tenant Management",
        });
      } else {
        await exportRowsToPdf({
          fileName: `tenants-${dateStr}.pdf`,
          branding: PLATFORM_BRANDING,
          titleAm: "የወረዳ አስተዳደር",
          titleEn: "Tenant Management",
          filterLabel,
          columns: EXPORT_COLUMNS,
          rows: sortedWoredas,
        });
      }
      toast.success("Export complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (!canTenants && !canUsers) {
    return (
      <div className="p-6">
        <InsufficientConsolePermissionNotice />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        icon={Building2}
        titleAm="የወረዳ አስተዳደር"
        titleEn="Tenant Management"
        description="Provision administrators and configure modules for each woreda."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TenantsTab)} className="w-full">
        <TabsList className="mb-4">
          {canTenants && (
            <TabsTrigger value="tenants">
              <span className="font-noto-ethiopic">ወረዳዎች</span>
              <span className="ml-1 text-slate-400">/ Tenants</span>
            </TabsTrigger>
          )}
          {canUsers && (
            <TabsTrigger value="users">
              <span className="font-noto-ethiopic">ተጠቃሚዎች</span>
              <span className="ml-1 text-slate-400">/ Users</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="tenants">
          {!canTenants ? (
            <InsufficientConsolePermissionNotice />
          ) : (
            <>
              <Card className="mb-4 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="በወረዳ ስም ወይም ኮድ ይፈልጉ / Search woreda name or code…"
                    className="max-w-md"
                  />
                  <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
                  <ExportButtons
                    onCsv={() => handleExport("csv")}
                    onPdf={() => handleExport("pdf")}
                    busy={exporting}
                  />
                </div>
              </Card>

              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <SortableTh field="woreda_name" sort={sort} className="text-xs font-medium">
                        <span className="font-noto-ethiopic">ወረዳ</span>
                        <span className="ml-1 text-slate-400">/ Woreda</span>
                      </SortableTh>
                      <SortableTh field="woreda_code" sort={sort} className="text-xs font-medium">
                        <span className="font-noto-ethiopic">ኮድ</span>
                        <span className="ml-1 text-slate-400">/ Code</span>
                      </SortableTh>
                      <Th am="የወረዳ አስተዳዳሪ" en="Tenant Admin" />
                      <Th am="የነቁ ሞጁሎች" en="Enabled Modules" />
                      <Th am="ድርጊት" en="Actions" className="text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && <TableSkeletonRows cols={5} />}
                    {!isLoading && isError && (
                      <TableErrorRow cols={5} error={error} onRetry={() => refetch()} />
                    )}
                    {!isLoading && !isError && filteredWoredas.length === 0 && (
                      <TableEmptyRow
                        cols={5}
                        filtered={filtersActive}
                        onClearFilters={clearFilters}
                      />
                    )}
                    {!isLoading &&
                      !isError &&
                      pageRows.map((w) => {
                        const wAdmins = adminByWoreda.get(w.woreda_id) ?? [];
                        const activeAdmin = wAdmins.find((a) => a.status !== "suspended");
                        const enabled = modulesByWoreda.get(w.woreda_id) ?? new Set<string>();
                        return (
                          <tr key={w.woreda_id} className="border-t border-slate-100">
                            <td className="px-4 py-3">
                              <Link
                                to="/admin/tenants/$woredaId"
                                params={{ woredaId: w.woreda_id }}
                                className="hover:underline"
                              >
                                <div className="font-noto-ethiopic font-medium text-blue-700">
                                  {w.woreda_name_am}
                                </div>
                                <div className="text-xs text-slate-500">{w.woreda_name_en}</div>
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
                                {w.woreda_numeric_code ?? w.woreda_code}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {activeAdmin ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-800">{activeAdmin.full_name}</span>
                                  <StatusChip status={activeAdmin.status} />
                                </div>
                              ) : (
                                <span className="font-noto-ethiopic text-amber-700">
                                  አስተዳዳሪ አልተመደበም
                                  <span className="ml-1 text-xs text-amber-600">
                                    / No Admin Assigned
                                  </span>
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {Object.keys(MODULE_LABELS).map((key) => {
                                  const on = enabled.has(key);
                                  return (
                                    <Badge
                                      key={key}
                                      variant={on ? "default" : "outline"}
                                      className={
                                        on
                                          ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                                          : "text-slate-400"
                                      }
                                    >
                                      <span className="font-noto-ethiopic">
                                        {MODULE_LABELS[key].am}
                                      </span>
                                    </Badge>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link
                                      to="/admin/tenants/$woredaId/provision"
                                      params={{ woredaId: w.woreda_id }}
                                    >
                                      <Shield className="mr-2 h-4 w-4" />
                                      <span className="font-noto-ethiopic">አስተዳዳሪ መድብ</span>
                                      <span className="ml-2 text-xs text-slate-500">
                                        / Provision
                                      </span>
                                    </Link>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="users">
          {canUsers ? <PlatformUsersTab /> : <InsufficientConsolePermissionNotice />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Th({ am, en, className }: { am: string; en: string; className?: string }) {
  return (
    <th className={`px-4 py-2 text-left text-xs font-medium ${className ?? ""}`}>
      <span className="font-noto-ethiopic">{am}</span>
      <span className="ml-1 text-slate-400">/ {en}</span>
    </th>
  );
}
