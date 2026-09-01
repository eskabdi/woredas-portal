import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, UserPlus, MoreHorizontal, Upload, Loader2, UserCircle2 } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusChip } from "@/components/common/StatusChip";
import {
  TablePagination,
  useClientPagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { ROW_VERIFICATION_FAILURE_MESSAGE } from "@/lib/rowVerification";
import {
  clearAllUserOverrides,
  clearUserOverride,
  fetchUserOverrides,
  upsertUserOverride,
} from "@/lib/userPermissionOverrides";
import { useAuthStore } from "@/stores/authStore";
import {
  toWebp,
  storageExtension,
  PHOTO_WEBP,
  BRANDING_WEBP,
  type WebpOptions,
} from "@/utils/imageCompression";
import { GROUP_LABELS, LOCKED_KEYS, PERMISSION_LABELS } from "./RolesPermissionsTab";

const EDITABLE_ROLES = [
  { key: "registry_clerk", am: "የመዝገብ ሰራተኛ", en: "Registry Clerk" },
  { key: "civil_registrar", am: "የኩነት መዝጋቢ", en: "Civil Registrar" },
  { key: "finance_clerk", am: "የገንዘብ ሰራተኛ", en: "Finance Clerk" },
  { key: "supervisor", am: "ተቆጣጣሪ", en: "Supervisor" },
  { key: "auditor", am: "ኦዲተር", en: "Auditor" },
  { key: "viewer", am: "ተመልካች", en: "Viewer" },
] as const;

const ROLE_LABEL_MAP: Record<string, { am: string; en: string }> = Object.fromEntries(
  EDITABLE_ROLES.map((r) => [r.key, { am: r.am, en: r.en }]),
);
ROLE_LABEL_MAP.tenant_admin = { am: "ወረዳ አስተዳዳሪ", en: "Tenant Admin" };
ROLE_LABEL_MAP.super_admin = { am: "ሁሉ አስተዳዳሪ", en: "Super Admin" };

interface AppUserRow {
  user_id: string;
  full_name: string;
  role: string;
  status: string;
  invited_at: string | null;
  department: string | null;
  job_title: string | null;
  reports_to_user_id: string | null;
  signature_path: string | null;
  photo_path: string | null;
}

export function UsersRolesTab() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const callerId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["app_user_list", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select(
          "user_id, full_name, role, status, invited_at, department, job_title, reports_to_user_id, signature_path, photo_path",
        )
        .eq("woreda_id", woredaId as string)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as AppUserRow[];
    },
  });

  const { input: q, setInput: setQ, term: qTerm } = useUrlSearchTerm("uq");

  const filteredUsers = useMemo(() => {
    const term = qTerm.toLowerCase();
    if (!term) return users;
    return users.filter((u) =>
      [u.full_name, u.role, u.status].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(term),
      ),
    );
  }, [users, qTerm]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    total: pagedTotal,
    pageRows,
  } = useClientPagination(filteredUsers, qTerm);

  const stats = useMemo(() => {
    const total = users.length;
    const active = new Set(users.filter((u) => u.status === "active").map((u) => u.role)).size;
    const pending = users.filter((u) => u.status === "pending").length;
    return { total, active, pending };
  }, [users]);

  const roleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of EDITABLE_ROLES) map[r.key] = 0;
    for (const u of users) {
      if (map[u.role] !== undefined) map[u.role] += 1;
    }
    return map;
  }, [users]);

  const usersById = useMemo(() => {
    const map: Record<string, AppUserRow> = {};
    for (const u of users) map[u.user_id] = u;
    return map;
  }, [users]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [changeUser, setChangeUser] = useState<AppUserRow | null>(null);
  const [suspendUser, setSuspendUser] = useState<AppUserRow | null>(null);
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [permissionsUser, setPermissionsUser] = useState<AppUserRow | null>(null);

  async function refresh() {
    qc.invalidateQueries({ queryKey: ["app_user_list", woredaId] });
  }

  async function changeRole(user: AppUserRow, newRole: string): Promise<void> {
    if (!EDITABLE_ROLES.find((r) => r.key === newRole)) {
      toast.error("Invalid role");
      return;
    }
    const { data: updated, error } = await supabase
      .from("app_user")
      .update({ role: newRole })
      .eq("user_id", user.user_id)
      .select("user_id")
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!updated) {
      toast.error(ROW_VERIFICATION_FAILURE_MESSAGE);
      return;
    }
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      woreda_id: woredaId,
      entity_name: "app_user",
      entity_id: user.user_id,
      action_type: "USER_ROLE_CHANGED",
      new_value_json: { from: user.role, to: newRole },
    });
    toast.success("ሚና ተቀይሯል / Role updated");
    await refresh();
  }

  async function suspendUserAction(user: AppUserRow) {
    const { data: updated, error } = await supabase
      .from("app_user")
      .update({ status: "suspended" })
      .eq("user_id", user.user_id)
      .select("user_id")
      .maybeSingle();
    if (error) return toast.error(error.message);
    if (!updated) return toast.error(ROW_VERIFICATION_FAILURE_MESSAGE);
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      woreda_id: woredaId,
      entity_name: "app_user",
      entity_id: user.user_id,
      action_type: "USER_SUSPENDED",
      new_value_json: {},
    });
    toast.success("ተጠቃሚው ታግዷል / User suspended");
    await refresh();
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard am="ጠቅላላ ተጠቃሚዎች" en="Total Users" value={stats.total} />
        <KpiCard am="የነቁ ሚናዎች" en="Active Roles" value={stats.active} />
        <KpiCard am="የተጠበቁ ግብዣዎች" en="Pending Invites" value={stats.pending} />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">
            <span className="font-noto-ethiopic">የተጠቃሚዎች ዝርዝር</span>
            <span className="ml-2 text-xs text-slate-500">/ User List</span>
          </TabsTrigger>
          <TabsTrigger value="roles">
            <span className="font-noto-ethiopic">የስራ ድርሻ አስተዳደር</span>
            <span className="ml-2 text-xs text-slate-500">/ Role Management</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="በስም ወይም ሚና ይፈልጉ / Search name or role…"
              className="max-w-xs"
            />
            <Button onClick={() => setInviteOpen(true)} className="bg-blue-700 hover:bg-blue-800">
              <Plus className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">ተጠቃሚ ጨምር</span>
              <span className="ml-1 text-xs opacity-80">/ Add User</span>
            </Button>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <Th am="ፎቶ" en="Photo" />
                    <Th am="ስም" en="Name" />
                    <Th am="ሚና" en="Role" />
                    <Th am="የሥራ ክፍል" en="Department" />
                    <Th am="የሥራ ድርሻ" en="Job Title" />
                    <Th am="ተጠሪነት" en="Reports To" />
                    <Th am="ፊርማ" en="Signature" />
                    <Th am="ሁኔታ" en="Status" />
                    <Th am="ድርጊት" en="Actions" className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                        Loading…
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                        No users
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((u) => (
                      <tr key={u.user_id} className="border-t border-slate-100">
                        <td className="px-4 py-3">
                          <StaffThumb path={u.photo_path} shape="circle" />
                        </td>
                        <td className="px-4 py-3 text-slate-800">{u.full_name}</td>
                        <td className="px-4 py-3">
                          <span className="font-noto-ethiopic">
                            {ROLE_LABEL_MAP[u.role]?.am ?? u.role}
                          </span>
                          <span className="ml-1 text-xs text-slate-500">
                            / {ROLE_LABEL_MAP[u.role]?.en ?? u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{u.department || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{u.job_title || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {u.reports_to_user_id
                            ? (usersById[u.reports_to_user_id]?.full_name ?? "—")
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StaffThumb path={u.signature_path} shape="square" />
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
                              <DropdownMenuItem
                                disabled={u.role === "tenant_admin" || u.role === "super_admin"}
                                onClick={() => setChangeUser(u)}
                              >
                                <span className="font-noto-ethiopic">ሚና ቀይር</span>
                                <span className="ml-2 text-xs text-slate-500">/ Change Role</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={u.status === "suspended" || u.user_id === callerId}
                                onClick={() => setSuspendUser(u)}
                              >
                                <span className="font-noto-ethiopic text-red-600">አግድ</span>
                                <span className="ml-2 text-xs text-slate-500">/ Suspend</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={u.role === "tenant_admin" || u.role === "super_admin"}
                                onClick={() => setPermissionsUser(u)}
                              >
                                <span className="font-noto-ethiopic">የግል ፈቃድ</span>
                                <span className="ml-2 text-xs text-slate-500">/ Permissions</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={pagedTotal}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button
              onClick={() => setAssignRoleOpen(true)}
              className="bg-blue-700 hover:bg-blue-800"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              <span className="font-noto-ethiopic">የሚና ምድብ ስጥ</span>
              <span className="ml-1 text-xs opacity-80">/ Assign Role</span>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {EDITABLE_ROLES.map((r) => (
              <Card key={r.key} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-noto-ethiopic text-sm font-semibold text-slate-900">
                      {r.am}
                    </div>
                    <div className="text-xs text-slate-500">{r.en}</div>
                  </div>
                  <div className="text-2xl font-bold text-blue-700">{roleCounts[r.key] ?? 0}</div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  <span className="font-noto-ethiopic">ተጠቃሚዎች</span> / users
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        woredaId={woredaId}
        users={users}
        onDone={refresh}
      />

      <ChangeRoleDialog
        user={changeUser}
        onClose={() => setChangeUser(null)}
        onConfirm={changeRole}
      />

      <UserPermissionOverridesDialog
        user={permissionsUser}
        woredaId={woredaId}
        onClose={() => setPermissionsUser(null)}
      />

      <AlertDialog open={!!suspendUser} onOpenChange={(o) => !o && setSuspendUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="font-noto-ethiopic">ተጠቃሚን ማገድ</span>
              <span className="ml-2 text-sm text-slate-500">/ Suspend user?</span>
            </AlertDialogTitle>
            <AlertDialogDescription>{suspendUser?.full_name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (suspendUser) await suspendUserAction(suspendUser);
                setSuspendUser(null);
              }}
            >
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AssignRoleDialog
        open={assignRoleOpen}
        onOpenChange={setAssignRoleOpen}
        users={users}
        onConfirm={changeRole}
      />
    </div>
  );
}

function KpiCard({ am, en, value }: { am: string; en: string; value: number }) {
  return (
    <Card className="p-5">
      <div className="text-3xl font-bold text-blue-700">{value}</div>
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

/** Small signed-URL thumbnail for a staff-assets object; a dash when there is none. */
function StaffThumb({ path, shape }: { path: string | null; shape: "circle" | "square" }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!path) {
        setSignedUrl(null);
        return;
      }
      const { data } = await supabase.storage.from("staff-assets").createSignedUrl(path, 600);
      if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return <span className="text-slate-400">—</span>;
  if (!signedUrl)
    return (
      <div
        className={`h-9 w-9 animate-pulse bg-slate-100 ${shape === "circle" ? "rounded-full" : "rounded-md"}`}
      />
    );
  return (
    <img
      src={signedUrl}
      alt=""
      className={`h-9 w-9 border border-slate-200 object-cover ${shape === "circle" ? "rounded-full" : "rounded-md bg-white"}`}
    />
  );
}

/** Inline photo/signature uploader for the Invite dialog, before the user row exists. */
function StaffImageField({
  am,
  en,
  woredaId,
  webpOptions,
  shape,
  value,
  onChange,
}: {
  am: string;
  en: string;
  woredaId: string | null;
  webpOptions: WebpOptions;
  shape: "circle" | "square";
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!value) {
        setPreviewUrl(null);
        return;
      }
      const { data } = await supabase.storage.from("staff-assets").createSignedUrl(value, 600);
      if (!cancelled) setPreviewUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function onFile(file: File) {
    if (!woredaId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const upload = await toWebp(file, webpOptions);
      const path = `${woredaId}/${crypto.randomUUID()}.${storageExtension(upload, "jpg")}`;
      const { error } = await supabase.storage
        .from("staff-assets")
        .upload(path, upload, { upsert: false, contentType: upload.type });
      if (error) throw error;
      onChange(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <Label>
        <span className="font-noto-ethiopic">{am}</span>
        <span className="ml-1 text-xs text-slate-500">/ {en}</span>
      </Label>
      <div className="mt-1 flex items-center gap-3">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-slate-200 bg-slate-50 ${shape === "circle" ? "rounded-full" : "rounded-md"}`}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserCircle2 className="h-8 w-8 text-slate-300" />
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span>Upload</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  woredaId,
  users,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  woredaId: string | null;
  users: AppUserRow[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<string>("registry_clerk");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [reportsTo, setReportsTo] = useState<string>("none");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setFullName("");
    setRole("registry_clerk");
    setDepartment("");
    setJobTitle("");
    setReportsTo("none");
    setPhotoPath(null);
    setSignaturePath(null);
  }

  async function submit() {
    if (!email || !fullName || !woredaId) {
      toast.error("Email and name are required");
      return;
    }
    setSubmitting(true);
    const { friendlyError } = await invokeEdgeFunction("invite-tenant-user", {
      email,
      full_name: fullName,
      role,
      woredaId,
      department: department || null,
      job_title: jobTitle || null,
      reports_to_user_id: reportsTo === "none" ? null : reportsTo,
      photo_path: photoPath,
      signature_path: signaturePath,
    });
    setSubmitting(false);
    if (friendlyError) {
      toast.error(friendlyError);
      return;
    }
    toast.success("ግብዣ ተልኳል / Invitation sent");
    reset();
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">ተጠቃሚ ጨምር</span>
            <span className="ml-2 text-sm text-slate-500">/ Invite User</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_ROLES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    <span className="font-noto-ethiopic">{r.am}</span>
                    <span className="ml-2 text-xs text-slate-500">/ {r.en}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የሥራ ክፍል</span>
              <span className="ml-1 text-xs text-slate-500">/ Department</span>
            </Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">የሥራ ድርሻ</span>
              <span className="ml-1 text-xs text-slate-500">/ Job Title</span>
            </Label>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div>
            <Label>
              <span className="font-noto-ethiopic">ተጠሪነት</span>
              <span className="ml-1 text-xs text-slate-500">/ Report To</span>
            </Label>
            <Select value={reportsTo} onValueChange={setReportsTo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="font-noto-ethiopic">የለም</span>
                  <span className="ml-2 text-xs text-slate-500">/ None</span>
                </SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>
                    {u.full_name}
                    <span className="ml-2 text-xs text-slate-500">
                      ({ROLE_LABEL_MAP[u.role]?.en ?? u.role})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <StaffImageField
            am="ፎቶ"
            en="Photo"
            woredaId={woredaId}
            webpOptions={PHOTO_WEBP}
            shape="circle"
            value={photoPath}
            onChange={setPhotoPath}
          />
          <StaffImageField
            am="ፊርማ"
            en="Signature"
            woredaId={woredaId}
            webpOptions={BRANDING_WEBP}
            shape="square"
            value={signaturePath}
            onChange={setSignaturePath}
          />
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

function ChangeRoleDialog({
  user,
  onClose,
  onConfirm,
}: {
  user: AppUserRow | null;
  onClose: () => void;
  onConfirm: (u: AppUserRow, role: string) => Promise<void>;
}) {
  const [role, setRole] = useState<string>(user?.role ?? "registry_clerk");
  const [clearOverrides, setClearOverrides] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const current = user;

  // D2(c) (docs/rbac-security-forensic-review.md, "Open Decisions"): overrides
  // persist across a role change by default -- surfaced here so the admin
  // making the change explicitly confirms or clears them, rather than a
  // per-person restriction ("this person is not to issue credentials") going
  // silently stale under a new role, or silently surviving one it shouldn't.
  const { data: overrides = [] } = useQuery({
    queryKey: ["user_permission_override", current?.user_id],
    enabled: !!current,
    queryFn: () => fetchUserOverrides(current!.user_id),
  });

  return (
    <Dialog
      open={!!current}
      onOpenChange={(o) => {
        if (!o) setClearOverrides(false);
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">ሚና ቀይር</span>
            <span className="ml-2 text-sm text-slate-500">
              / Change Role — {current?.full_name}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div>
          <Label>Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_ROLES.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  <span className="font-noto-ethiopic">{r.am}</span>
                  <span className="ml-2 text-xs text-slate-500">/ {r.en}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {overrides.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              This person has {overrides.length} permission override
              {overrides.length === 1 ? "" : "s"} set independent of their role. By default they
              carry over unchanged after this role change.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={clearOverrides}
                onChange={(e) => setClearOverrides(e.target.checked)}
              />
              Clear all overrides for this person as part of this change
            </label>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setClearOverrides(false);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={submitting}
            className="bg-blue-700 hover:bg-blue-800"
            onClick={async () => {
              if (!current) return;
              setSubmitting(true);
              await onConfirm(current, role);
              if (clearOverrides) {
                const { error } = await clearAllUserOverrides(current.user_id);
                if (error) toast.error("Role changed, but clearing overrides failed. Try again.");
              }
              setSubmitting(false);
              setClearOverrides(false);
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserPermissionOverridesDialog({
  user,
  woredaId,
  onClose,
}: {
  user: AppUserRow | null;
  woredaId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: roleDefaults = new Map<string, boolean>(), isLoading: loadingDefaults } = useQuery({
    queryKey: ["role_permission_defaults", woredaId, user?.role],
    enabled: !!user && !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission")
        .select("permission_key, is_granted")
        .eq("woreda_id", woredaId as string)
        .eq("role_name", user!.role);
      if (error) throw error;
      const map = new Map<string, boolean>();
      for (const r of data ?? []) map.set(r.permission_key, r.is_granted);
      return map;
    },
  });

  const { data: overrides = [], isLoading: loadingOverrides } = useQuery({
    queryKey: ["user_permission_override", user?.user_id],
    enabled: !!user,
    queryFn: () => fetchUserOverrides(user!.user_id),
  });

  const overrideMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const o of overrides) m.set(o.permission_key, o.is_granted);
    return m;
  }, [overrides]);

  const grouped = useMemo(() => {
    const keys = Array.from(roleDefaults.keys()).sort();
    const g = new Map<string, string[]>();
    for (const k of keys) {
      const prefix = k.split(".")[0];
      if (!g.has(prefix)) g.set(prefix, []);
      g.get(prefix)!.push(k);
    }
    return Array.from(g.entries());
  }, [roleDefaults]);

  async function setOverride(key: string, value: "default" | "grant" | "deny") {
    if (!user) return;
    setPending((p) => new Set(p).add(key));
    if (value === "default") {
      const { error } = await clearUserOverride(user.user_id, key);
      if (error) toast.error("Failed to clear override");
    } else {
      const { data, error } = await upsertUserOverride(user.user_id, key, value === "grant");
      if (error) toast.error("Failed to save override");
      else if (!data) toast.error(ROW_VERIFICATION_FAILURE_MESSAGE);
    }
    await qc.invalidateQueries({ queryKey: ["user_permission_override", user.user_id] });
    setPending((p) => {
      const n = new Set(p);
      n.delete(key);
      return n;
    });
  }

  if (!user) return null;

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">የግል ፈቃድ ማስተካከያ</span>
            <span className="ml-2 text-sm text-slate-500">
              / Permission Overrides — {user.full_name}
            </span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">
          Overrides this person&apos;s permissions independent of their role (
          {ROLE_LABEL_MAP[user.role]?.en ?? user.role}). &quot;Default&quot; means this person gets
          exactly what their role grants.
        </p>
        {loadingDefaults || loadingOverrides ? (
          <div className="p-4 text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([prefix, keys]) => (
              <div key={prefix}>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  <span className="font-noto-ethiopic">{GROUP_LABELS[prefix]?.am ?? prefix}</span>
                  <span className="ml-1 text-slate-400">
                    / {GROUP_LABELS[prefix]?.en ?? prefix}
                  </span>
                </div>
                <div className="space-y-1">
                  {keys.map((key) => {
                    const locked = LOCKED_KEYS.has(key);
                    const defaultGranted = roleDefaults.get(key) ?? false;
                    const overrideValue = overrideMap.has(key)
                      ? overrideMap.get(key)
                        ? "grant"
                        : "deny"
                      : "default";
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-sm"
                      >
                        <div className="font-mono text-xs text-slate-700">
                          {key}{" "}
                          <span className="text-slate-400">— {PERMISSION_LABELS[key] ?? ""}</span>
                          <span className="ml-2 text-[10px] text-slate-400">
                            (default: {defaultGranted ? "granted" : "not granted"})
                          </span>
                        </div>
                        <Select
                          value={overrideValue}
                          disabled={locked || pending.has(key)}
                          onValueChange={(v) => setOverride(key, v as "default" | "grant" | "deny")}
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="grant">Grant</SelectItem>
                            <SelectItem value="deny">Deny</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignRoleDialog({
  open,
  onOpenChange,
  users,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  users: AppUserRow[];
  onConfirm: (u: AppUserRow, role: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AppUserRow | null>(null);
  const [role, setRole] = useState<string>("registry_clerk");
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return users
      .filter((u) => u.role !== "tenant_admin" && u.role !== "super_admin")
      .filter((u) => !needle || u.full_name.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [users, q]);

  function reset() {
    setQ("");
    setSelected(null);
    setRole("registry_clerk");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">የሚና ምድብ ስጥ</span>
            <span className="ml-2 text-sm text-slate-500">/ Assign Role</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Search user by name</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type name…" />
          </div>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
            {filtered.map((u) => (
              <button
                type="button"
                key={u.user_id}
                onClick={() => setSelected(u)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  selected?.user_id === u.user_id ? "bg-blue-50" : ""
                }`}
              >
                <div className="font-medium text-slate-800">{u.full_name}</div>
                <div className="text-xs text-slate-500">
                  <span className="font-noto-ethiopic">{ROLE_LABEL_MAP[u.role]?.am ?? u.role}</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
            )}
          </div>
          {selected && (
            <div>
              <Label>New role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      <span className="font-noto-ethiopic">{r.am}</span>
                      <span className="ml-2 text-xs text-slate-500">/ {r.en}</span>
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
          <Button
            disabled={!selected || submitting}
            className="bg-blue-700 hover:bg-blue-800"
            onClick={async () => {
              if (!selected) return;
              setSubmitting(true);
              await onConfirm(selected, role);
              setSubmitting(false);
              reset();
              onOpenChange(false);
            }}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
