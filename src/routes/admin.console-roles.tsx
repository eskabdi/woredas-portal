import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { CP, type ConsolePermission } from "@/config/permissions";
import {
  ConsolePermissionGate,
  InsufficientConsolePermissionNotice,
} from "@/components/common/ConsolePermissionGate";

export const Route = createFileRoute("/admin/console-roles")({
  ssr: false,
  component: ConsoleRolesPageGated,
});

// console_role / console_role_permission are new tables absent from the
// generated types entirely -- cast the client for these calls rather than
// each query result, same pattern as useAuthBootstrap.ts's
// fetchConsolePermissions. Regenerate types.ts post-deploy and drop this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const PERMISSION_ROWS: { key: ConsolePermission; am: string; en: string }[] = [
  { key: CP.TENANTS_MANAGE, am: "ወረዳዎችን ማስተዳደር", en: "Manage Tenants" },
  { key: CP.USERS_MANAGE, am: "የመድረክ ተጠቃሚዎችን ማስተዳደር", en: "Manage Platform Users" },
  { key: CP.AUDIT_VIEW, am: "የኦዲት መዝገብ መመልከት", en: "View Audit Logs" },
  {
    key: CP.CREDENTIAL_TEMPLATE_MANAGE,
    am: "የመታወቂያ አብነት ማስተዳደር",
    en: "Manage ID Card Template",
  },
  {
    key: CP.CONSOLE_USERS_MANAGE,
    am: "የኮንሶል ተጠቃሚዎችና ሚናዎችን ማስተዳደር",
    en: "Manage Console Users and Role",
  },
];

interface ConsoleRoleRow {
  console_role_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}
interface ConsoleRolePermissionRow {
  console_role_id: string;
  permission_key: ConsolePermission;
  is_granted: boolean;
}

function ConsoleRolesPageGated() {
  return (
    <ConsolePermissionGate
      permission={CP.CONSOLE_USERS_MANAGE}
      fallback={<InsufficientConsolePermissionNotice />}
    >
      <ConsoleRolesPage />
    </ConsolePermissionGate>
  );
}

function ConsoleRolesPage() {
  const qc = useQueryClient();
  const callerId = useAuthStore((s) => s.user?.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRole, setDeleteRole] = useState<ConsoleRoleRow | null>(null);
  const [editRole, setEditRole] = useState<ConsoleRoleRow | null>(null);

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ["console-roles"],
    queryFn: async () => {
      const { data, error } = await db.from("console_role").select("*").order("name");
      if (error) throw error;
      return data as ConsoleRoleRow[];
    },
  });

  const { data: grants = [] } = useQuery({
    queryKey: ["console-role-permissions"],
    queryFn: async () => {
      const { data, error } = await db
        .from("console_role_permission")
        .select("console_role_id, permission_key, is_granted");
      if (error) throw error;
      return data as ConsoleRolePermissionRow[];
    },
  });

  const matrix = new Map<string, boolean>();
  for (const g of grants) matrix.set(`${g.console_role_id}:${g.permission_key}`, g.is_granted);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["console-roles"] });
    await qc.invalidateQueries({ queryKey: ["console-role-permissions"] });
  }

  async function toggleGrant(consoleRoleId: string, key: ConsolePermission, next: boolean) {
    // upsert, not update: an UPDATE matching zero rows succeeds silently
    // with no error, so a role missing this grant row (the create dialog's
    // insert failed partway, or a future CP.* key added after this role was
    // created) would flip the checkbox, write an audit row, and then
    // silently revert on refresh -- looks like the toggle is broken rather
    // than actually fixing the missing row.
    const { error } = await db
      .from("console_role_permission")
      .upsert(
        { console_role_id: consoleRoleId, permission_key: key, is_granted: next },
        { onConflict: "console_role_id,permission_key" },
      );
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "console_role_permission",
      entity_id: consoleRoleId,
      action_type: "CONSOLE_ROLE_PERMISSION_UPDATED",
      new_value_json: { console_role_id: consoleRoleId, permission_key: key, is_granted: next },
    });
    await refresh();
  }

  async function toggleActive(role: ConsoleRoleRow, next: boolean) {
    const { error } = await db
      .from("console_role")
      .update({ is_active: next, updated_by: callerId ?? null })
      .eq("console_role_id", role.console_role_id);
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "console_role",
      entity_id: role.console_role_id,
      action_type: "CONSOLE_ROLE_UPDATED",
      old_value_json: { is_active: role.is_active },
      new_value_json: { is_active: next },
    });
    toast.success(next ? "Role enabled" : "Role disabled");
    await refresh();
  }

  async function deleteRoleConfirmed() {
    if (!deleteRole) return;
    const { error } = await db
      .from("console_role")
      .delete()
      .eq("console_role_id", deleteRole.console_role_id);
    if (error) {
      toast.error(
        error.message.includes("foreign key")
          ? "Cannot delete: still assigned to one or more super admins"
          : error.message,
      );
      setDeleteRole(null);
      return;
    }
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "console_role",
      entity_id: deleteRole.console_role_id,
      action_type: "CONSOLE_ROLE_DELETED",
      old_value_json: { name: deleteRole.name },
    });
    toast.success("Console role deleted");
    setDeleteRole(null);
    await refresh();
  }

  return (
    <div className="p-6">
      <PageHeader
        icon={ShieldCheck}
        titleAm="የኮንሶል ተጠቃሚዎችና ሚናዎች"
        titleEn="Console Users and Role"
        description="Named roles that narrow a super admin's access to specific sections of this console."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="bg-blue-700 hover:bg-blue-800">
            <Plus className="mr-1 h-4 w-4" />
            New Console Role
          </Button>
        }
      />

      <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        A super admin with no console role assigned (shown as "Unrestricted" on their profile) has
        full access to every console section regardless of this grid. Assign a role to narrow their
        access to only the permissions granted below.
      </div>

      {rolesLoading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : roles.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No console roles yet. Every super admin remains unrestricted until you create one.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-700 text-white">
                  <th className="sticky left-0 z-10 bg-blue-700 px-4 py-3 text-left font-medium">
                    Permission
                  </th>
                  {roles.map((r) => (
                    <th key={r.console_role_id} className="px-3 py-3 text-center font-medium">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => setEditRole(r)}
                        >
                          {r.name}
                        </button>
                        <div className="flex items-center gap-1 text-[10px] font-normal uppercase tracking-wide text-blue-100">
                          <Switch
                            checked={r.is_active}
                            onCheckedChange={(c) => toggleActive(r, c)}
                            className="scale-75"
                          />
                          {r.is_active ? "Active" : "Inactive"}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROWS.map((p, idx) => (
                  <tr key={p.key} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="sticky left-0 z-[1] bg-inherit px-4 py-2 text-xs text-slate-700">
                      <div className="font-noto-ethiopic">{p.am}</div>
                      <div className="text-slate-400">{p.en}</div>
                    </td>
                    {roles.map((r) => (
                      <td key={r.console_role_id} className="px-3 py-2 text-center">
                        <div className="flex justify-center">
                          <Checkbox
                            checked={matrix.get(`${r.console_role_id}:${p.key}`) ?? false}
                            onCheckedChange={(v) =>
                              toggleGrant(r.console_role_id, p.key, Boolean(v))
                            }
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateConsoleRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refresh}
        callerId={callerId}
      />

      <EditConsoleRoleDialog
        role={editRole}
        onOpenChange={(o) => !o && setEditRole(null)}
        onSaved={refresh}
        onDelete={(r) => {
          setEditRole(null);
          setDeleteRole(r);
        }}
        callerId={callerId}
      />

      <AlertDialog open={!!deleteRole} onOpenChange={(o) => !o && setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteRole?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the role and its permission grants. Any super admin currently
              assigned to it must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={deleteRoleConfirmed}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateConsoleRoleDialog({
  open,
  onOpenChange,
  onCreated,
  callerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void | Promise<void>;
  callerId: string | undefined;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    const { data, error } = await db
      .from("console_role")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        updated_by: callerId ?? null,
      })
      .select("console_role_id")
      .single();
    if (error || !data) {
      setSubmitting(false);
      toast.error(error?.message ?? "Failed to create role");
      return;
    }
    // Every permission key starts ungranted -- toggling it on is an explicit
    // per-role decision, matching this migration's "no implicit grant except
    // console_role_id IS NULL" design.
    const rows = Object.values(CP).map((key) => ({
      console_role_id: data.console_role_id,
      permission_key: key,
      is_granted: false,
    }));
    const { error: permError } = await db.from("console_role_permission").insert(rows);
    setSubmitting(false);
    if (permError) {
      toast.error(permError.message);
      return;
    }
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "console_role",
      entity_id: data.console_role_id,
      action_type: "CONSOLE_ROLE_CREATED",
      new_value_json: { name: name.trim() },
    });
    toast.success("Console role created");
    setName("");
    setDescription("");
    onOpenChange(false);
    await onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Console Role</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tenant Manager"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} onClick={submit} className="bg-blue-700 hover:bg-blue-800">
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditConsoleRoleDialog({
  role,
  onOpenChange,
  onSaved,
  onDelete,
  callerId,
}: {
  role: ConsoleRoleRow | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
  onDelete: (role: ConsoleRoleRow) => void;
  callerId: string | undefined;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const openId = role?.console_role_id ?? null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (role && openId !== syncedFor) {
    setName(role.name);
    setDescription(role.description ?? "");
    setSyncedFor(openId);
  }

  if (!role) return null;

  async function save() {
    if (!role) return;
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const { error } = await db
      .from("console_role")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        updated_by: callerId ?? null,
      })
      .eq("console_role_id", role.console_role_id);
    setSaving(false);
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      entity_name: "console_role",
      entity_id: role.console_role_id,
      action_type: "CONSOLE_ROLE_UPDATED",
      old_value_json: { name: role.name, description: role.description },
      new_value_json: { name: name.trim(), description: description.trim() || null },
    });
    toast.success("Console role updated");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <Dialog open={!!role} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Console Role</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button
            variant="ghost"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => onDelete(role)}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={save} className="bg-blue-700 hover:bg-blue-800">
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
