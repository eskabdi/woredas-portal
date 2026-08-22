import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/common/StatusChip";
import {
  TablePagination,
  useClientPagination,
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

import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

const PLATFORM_BRANDING = {
  nameAm: "የሐረሪ ክልል አስተዳደር",
  nameEn: "Harari Regional Administration",
  logoDataUrl: null,
};

interface AdminUserRow {
  user_id: string;
  full_name: string;
  username: string;
  role: string;
  status: string;
  woreda_id: string | null;
  invited_at: string | null;
}
interface WoredaOpt {
  woreda_id: string;
  woreda_name_am: string;
  woreda_name_en: string;
}

export function PlatformUsersTab() {
  const qc = useQueryClient();
  const callerId = useAuthStore((s) => s.user?.id);
  const [roleFilter, setRoleFilter] = useState<"all" | "super_admin" | "tenant_admin">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "pending" | "suspended">(
    "all",
  );
  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [suspendUser, setSuspendUser] = useState<AdminUserRow | null>(null);
  const [reactivateUser, setReactivateUser] = useState<AdminUserRow | null>(null);

  const sort = useUrlSort("full_name", "asc");
  const [exporting, setExporting] = useState(false);

  const {
    data: users = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("user_id, full_name, username, role, status, woreda_id, invited_at")
        .in("role", ["super_admin", "tenant_admin"])
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as AdminUserRow[];
    },
  });

  const { data: woredas = [] } = useQuery({
    queryKey: ["admin-users-woredas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_id, woreda_name_am, woreda_name_en")
        .order("woreda_numeric_code");
      if (error) throw error;
      return (data ?? []) as WoredaOpt[];
    },
  });

  const woredaMap = useMemo(() => {
    const m = new Map<string, WoredaOpt>();
    for (const w of woredas) m.set(w.woreda_id, w);
    return m;
  }, [woredas]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (qTerm) {
        const s = qTerm.toLowerCase();
        if (!u.full_name.toLowerCase().includes(s) && !u.username.toLowerCase().includes(s))
          return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, qTerm]);

  const sortRows = useCallback(
    (rows: AdminUserRow[]): AdminUserRow[] => {
      const mul = sort.dir === "asc" ? 1 : -1;
      const arr = [...rows];
      arr.sort((a, b) => {
        switch (sort.field) {
          case "full_name":
            return mul * a.full_name.localeCompare(b.full_name);
          case "role":
            return mul * a.role.localeCompare(b.role);
          case "status":
            return mul * a.status.localeCompare(b.status);
          case "tenant": {
            const an = a.woreda_id
              ? (woredaMap.get(a.woreda_id)?.woreda_name_en ?? "")
              : "Platform";
            const bn = b.woreda_id
              ? (woredaMap.get(b.woreda_id)?.woreda_name_en ?? "")
              : "Platform";
            return mul * an.localeCompare(bn);
          }
          default:
            return 0;
        }
      });
      return arr;
    },
    [sort.field, sort.dir, woredaMap],
  );

  const sortedFiltered = useMemo(() => sortRows(filtered), [filtered, sortRows]);

  const { page, setPage, pageSize, setPageSize, total, pageRows } = useClientPagination(
    sortedFiltered,
    [qTerm, roleFilter, statusFilter, sort.key].join("|"),
  );

  const clearFilters = useClearTableFilters([], () => {
    setRoleFilter("all");
    setStatusFilter("all");
  });

  const filtersActive =
    !!qTerm || roleFilter !== "all" || statusFilter !== "all" || !sort.isDefault;

  function buildFilterLabel() {
    const parts: string[] = [];
    if (qTerm) parts.push(`Search: "${qTerm}"`);
    if (roleFilter !== "all") parts.push(`Role: ${roleFilter}`);
    if (statusFilter !== "all") parts.push(`Status: ${statusFilter}`);
    if (!sort.isDefault) parts.push(`Sort: ${sort.field} ${sort.dir}`);
    return parts.length ? parts.join(" • ") : "No filters applied";
  }

  const EXPORT_COLUMNS: TableColumn<AdminUserRow>[] = [
    {
      header: "ወረዳ / Tenant",
      value: (u) => (u.woreda_id ? (woredaMap.get(u.woreda_id)?.woreda_name_en ?? "") : "Platform"),
    },
    { header: "ሙሉ ስም / Full Name", value: (u) => u.full_name },
    { header: "የተጠቃሚ ስም / Username", value: (u) => u.username },
    { header: "ሚና / Role", value: (u) => u.role },
    { header: "ሁኔታ / Status", value: (u) => u.status },
    { header: "የተጋበዘበት / Invited At", value: (u) => u.invited_at ?? "" },
  ];

  async function handleExportPdf() {
    setExporting(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      await exportRowsToPdf({
        fileName: `platform-admins-${dateStr}.pdf`,
        branding: PLATFORM_BRANDING,
        titleAm: "የተጠቃሚ አስተዳደር",
        titleEn: "User Management",
        filterLabel: buildFilterLabel(),
        columns: EXPORT_COLUMNS,
        rows: sortedFiltered,
      });
      toast.success("Export complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const stats = useMemo(() => {
    return {
      superAdmins: users.filter((u) => u.role === "super_admin").length,
      tenantAdmins: users.filter((u) => u.role === "tenant_admin").length,
      pending: users.filter((u) => u.status === "pending").length,
      suspended: users.filter((u) => u.status === "suspended").length,
    };
  }, [users]);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function suspend(u: AdminUserRow) {
    const { error } = await supabase
      .from("app_user")
      .update({ status: "suspended" })
      .eq("user_id", u.user_id);
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "app_user",
      entity_id: u.user_id,
      action_type: "PLATFORM_ADMIN_SUSPENDED",
      new_value_json: { role: u.role },
    });
    toast.success("ተጠቃሚው ታግዷል / User suspended");
    await refresh();
  }

  async function reactivate(u: AdminUserRow) {
    const { error } = await supabase
      .from("app_user")
      .update({ status: "active" })
      .eq("user_id", u.user_id);
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "app_user",
      entity_id: u.user_id,
      action_type: "PLATFORM_ADMIN_REACTIVATED",
      new_value_json: { role: u.role },
    });
    toast.success("ተጠቃሚው ተመልሷል / User reactivated");
    await refresh();
  }

  async function resendInvite(u: AdminUserRow) {
    const { data, error } = await supabase.functions.invoke("resend-platform-invite", {
      body: { email: u.username.includes("@") ? u.username : `${u.username}`, user_id: u.user_id },
    });
    const payload = data as { success?: boolean; error?: string } | null;
    if (error || payload?.error) {
      toast.error(payload?.error ?? error?.message ?? "Failed to resend invite");
      return;
    }
    toast.success("ግብዣ ተልኳል / Invitation resent");
  }

  function exportCsv() {
    exportRowsToCsv({
      fileName: `platform-admins-${new Date().toISOString().slice(0, 10)}.csv`,
      columns: EXPORT_COLUMNS,
      rows: sortedFiltered,
      filterLabel: buildFilterLabel(),
      titleEn: "User Management",
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-noto-ethiopic text-lg font-semibold text-slate-900">የተጠቃሚ አስተዳደር</h2>
          <p className="text-sm text-slate-500">
            User Management — Super Admin and Tenant Admin accounts across the platform.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="bg-blue-700 hover:bg-blue-800">
          <Plus className="mr-1 h-4 w-4" />
          <span className="font-noto-ethiopic">አዲስ አስተዳዳሪ</span>
          <span className="ml-1 text-xs opacity-80">/ Add Admin</span>
        </Button>
      </div>

      {/* KPI */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi am="ሁሉ አስተዳዳሪዎች" en="Super Admins" value={stats.superAdmins} />
        <Kpi am="የወረዳ አስተዳዳሪዎች" en="Tenant Admins" value={stats.tenantAdmins} />
        <Kpi am="የተጠበቁ ግብዣዎች" en="Pending Invitations" value={stats.pending} tone="amber" />
        <Kpi am="የታገዱ" en="Suspended" value={stats.suspended} tone="red" />
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search name or email…"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
              <SelectItem value="tenant_admin">Tenant Admin</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
          <ClearFiltersButton active={filtersActive} onClear={clearFilters} />
          <ExportButtons onCsv={exportCsv} onPdf={handleExportPdf} busy={exporting} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <SortableTh field="tenant" sort={sort} className="text-xs font-medium">
                <span className="font-noto-ethiopic">ወረዳ</span>
                <span className="ml-1 text-slate-400">/ Tenant</span>
              </SortableTh>
              <SortableTh field="full_name" sort={sort} className="text-xs font-medium">
                <span className="font-noto-ethiopic">ሙሉ ስም</span>
                <span className="ml-1 text-slate-400">/ Full Name</span>
              </SortableTh>
              <SortableTh field="role" sort={sort} className="text-xs font-medium">
                <span className="font-noto-ethiopic">ሚና</span>
                <span className="ml-1 text-slate-400">/ Role</span>
              </SortableTh>
              <SortableTh field="status" sort={sort} className="text-xs font-medium">
                <span className="font-noto-ethiopic">ሁኔታ</span>
                <span className="ml-1 text-slate-400">/ Status</span>
              </SortableTh>
              <Th am="ድርጊት" en="Actions" className="text-right" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeletonRows cols={5} />
            ) : isError ? (
              <TableErrorRow cols={5} error={error} onRetry={() => refetch()} />
            ) : filtered.length === 0 ? (
              <TableEmptyRow cols={5} filtered={filtersActive} onClearFilters={clearFilters} />
            ) : (
              pageRows.map((u) => (
                <tr key={u.user_id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    {u.role === "super_admin" ? (
                      <Badge variant="secondary">Platform</Badge>
                    ) : u.woreda_id && woredaMap.get(u.woreda_id) ? (
                      <div>
                        <div className="font-noto-ethiopic">
                          {woredaMap.get(u.woreda_id)!.woreda_name_am}
                        </div>
                        <div className="text-xs text-slate-500">
                          {woredaMap.get(u.woreda_id)!.woreda_name_en}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{u.full_name}</div>
                    <div className="text-xs text-slate-500">{u.username}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        u.role === "super_admin"
                          ? "bg-purple-100 text-purple-800 hover:bg-purple-100"
                          : "bg-blue-100 text-blue-800 hover:bg-blue-100"
                      }
                    >
                      {u.role === "super_admin" ? "Super Admin" : "Tenant Admin"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.status === "pending" && (
                          <DropdownMenuItem onClick={() => resendInvite(u)}>
                            <span className="font-noto-ethiopic">ግብዣ ድጋሚ ላክ</span>
                            <span className="ml-2 text-xs text-slate-500">/ Resend Invite</span>
                          </DropdownMenuItem>
                        )}
                        {u.status !== "suspended" ? (
                          <DropdownMenuItem
                            disabled={u.user_id === callerId}
                            onClick={() => setSuspendUser(u)}
                          >
                            <span className="font-noto-ethiopic text-red-600">እግድ</span>
                            <span className="ml-2 text-xs text-slate-500">/ Suspend</span>
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setReactivateUser(u)}>
                            <span className="font-noto-ethiopic text-green-700">ፍቀድ</span>
                            <span className="ml-2 text-xs text-slate-500">/ Reactivate</span>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
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

      <InviteAdminDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        woredas={woredas}
        onDone={refresh}
      />

      <AlertDialog open={!!suspendUser} onOpenChange={(o) => !o && setSuspendUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="font-noto-ethiopic">አስተዳዳሪውን ማገድ?</span>
              <span className="ml-2 text-sm text-slate-500">/ Suspend admin?</span>
            </AlertDialogTitle>
            <AlertDialogDescription>{suspendUser?.full_name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (suspendUser) await suspend(suspendUser);
                setSuspendUser(null);
              }}
            >
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivateUser} onOpenChange={(o) => !o && setReactivateUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="font-noto-ethiopic">አስተዳዳሪውን መፍቀድ?</span>
              <span className="ml-2 text-sm text-slate-500">/ Reactivate admin?</span>
            </AlertDialogTitle>
            <AlertDialogDescription>{reactivateUser?.full_name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-700 hover:bg-green-800"
              onClick={async () => {
                if (reactivateUser) await reactivate(reactivateUser);
                setReactivateUser(null);
              }}
            >
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({
  am,
  en,
  value,
  tone,
}: {
  am: string;
  en: string;
  value: number;
  tone?: "amber" | "red";
}) {
  const color =
    tone === "amber" ? "text-amber-600" : tone === "red" ? "text-red-600" : "text-blue-700";
  return (
    <Card className="p-5">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 font-noto-ethiopic text-sm text-slate-700">{am}</div>
      <div className="text-xs text-slate-500">{en}</div>
    </Card>
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

function InviteAdminDialog({
  open,
  onOpenChange,
  woredas,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  woredas: WoredaOpt[];
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"super_admin" | "tenant_admin">("tenant_admin");
  const [woredaId, setWoredaId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!fullName.trim() || !email.trim()) {
      toast.error("Full name and email are required");
      return;
    }
    if (role === "tenant_admin" && !woredaId) {
      toast.error("Select a woreda for Tenant Admin");
      return;
    }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      email: email.trim(),
      full_name: fullName.trim(),
      role,
    };
    if (role === "tenant_admin") body.woredaId = woredaId;

    const { data, error } = await supabase.functions.invoke("invite-platform-admin", { body });
    setSubmitting(false);
    const payload = data as { success?: boolean; warning?: string | null; error?: string } | null;
    if (error || payload?.error) {
      toast.error(payload?.error ?? error?.message ?? "Failed to send invitation");
      return;
    }
    toast.success("ግብዣ ተልኳል / Invitation sent");
    if (payload?.warning) toast.warning(payload.warning);
    setFullName("");
    setEmail("");
    setRole("tenant_admin");
    setWoredaId("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">አዲስ አስተዳዳሪ</span>
            <span className="ml-2 text-sm text-slate-500">/ Add New Admin</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Full Legal Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label>Government Email Address</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Assign Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant_admin">Tenant Admin</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "tenant_admin" && (
            <div>
              <Label>Woreda</Label>
              <Select value={woredaId} onValueChange={setWoredaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select woreda…" />
                </SelectTrigger>
                <SelectContent>
                  {woredas.map((w) => (
                    <SelectItem key={w.woreda_id} value={w.woreda_id}>
                      <span className="font-noto-ethiopic">{w.woreda_name_am}</span>
                      <span className="ml-2 text-xs text-slate-500">/ {w.woreda_name_en}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} onClick={submit} className="bg-blue-700 hover:bg-blue-800">
            {submitting ? "Sending…" : "Send Invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
