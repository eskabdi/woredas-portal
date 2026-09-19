import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { ROW_VERIFICATION_FAILURE_MESSAGE } from "@/lib/rowVerification";
import {
  createTenantRole,
  fetchTenantRolePermissions,
  fetchTenantRoles,
  updateTenantRole,
  upsertTenantRolePermission,
  type TenantRoleRow,
} from "@/lib/tenantRoles";
import { useAuthStore } from "@/stores/authStore";
import { GROUP_LABELS, LOCKED_KEYS, PERMISSION_LABELS } from "./RolesPermissionsTab";
import { PERMISSION_ACTION_LABELS } from "@/config/permissionLabels";

/** D4 (Task 13): tenant-defined custom roles, managed per-woreda. Grants live
 * in tenant_role_permission (00000000000038_task13_tenant_role_schema.sql),
 * resolved for a user via app_user.custom_role_id + role = 'custom'
 * (00000000000039). Reserved keys (A4, RESERVED_PERMISSION_KEYS) are locked
 * here exactly the way RolesPermissionsTab locks them for built-in roles --
 * tenant_role_permission's own CHECK constraint rejects them server-side
 * regardless, this only avoids a raw constraint-violation round-trip. */
export function CustomRolesTab() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TenantRoleRow | null>(null);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["tenant_role", woredaId],
    enabled: !!woredaId,
    queryFn: () => fetchTenantRoles(woredaId as string),
  });

  // Full permission-key catalog for this tenant, reused from the built-in
  // matrix so a custom role can grant exactly the same set of keys -- no
  // separate catalog to keep in sync.
  const { data: catalogRows = [] } = useQuery({
    queryKey: ["role_permission_catalog", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission")
        .select("permission_key")
        .eq("woreda_id", woredaId as string)
        .eq("role_name", "viewer");
      if (error) throw error;
      return data ?? [];
    },
  });

  const catalog = useMemo(() => {
    const keys = Array.from(new Set(catalogRows.map((r) => r.permission_key))).sort();
    const g = new Map<string, string[]>();
    for (const k of keys) {
      const prefix = k.split(".")[0];
      if (!g.has(prefix)) g.set(prefix, []);
      g.get(prefix)!.push(k);
    }
    return Array.from(g.entries());
  }, [catalogRows]);

  async function toggleActive(role: TenantRoleRow) {
    const { data, error } = await updateTenantRole(
      role.tenant_role_id,
      { is_active: !role.is_active },
      userId ?? null,
    );
    if (error) toast.error(error instanceof Error ? error.message : "Failed to update role");
    else if (!data) toast.error(ROW_VERIFICATION_FAILURE_MESSAGE);
    else {
      toast.success(role.is_active ? "ቦታ ላይ ወጣ / Deactivated" : "ነቅቷል / Activated");
      qc.invalidateQueries({ queryKey: ["tenant_role", woredaId] });
    }
  }

  if (isLoading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[color:var(--color-shell-header)] hover:bg-[color:var(--color-shell-header)]/90"
        >
          <Plus className="mr-2 h-4 w-4" />
          <span className="font-am-body">አዲስ ሚና</span>
          <span className="ml-1 text-xs opacity-80">/ New Custom Role</span>
        </Button>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          <span className="font-am-body">ምንም ዝግጁ ሚና የለም</span>
          <span className="ml-2">/ No custom roles yet</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.tenant_role_id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{r.name}</div>
                  {r.description && (
                    <div className="mt-0.5 text-xs text-slate-500">{r.description}</div>
                  )}
                </div>
                <Badge variant={r.is_active ? "default" : "secondary"}>
                  {r.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  Edit Permissions
                </Button>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{r.is_active ? "Deactivate" : "Activate"}</span>
                  <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        woredaId={woredaId}
        userId={userId ?? null}
        onCreated={() => qc.invalidateQueries({ queryKey: ["tenant_role", woredaId] })}
      />

      <EditPermissionsDialog
        role={editing}
        catalog={catalog}
        userId={userId ?? null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  woredaId,
  userId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  woredaId: string | null;
  userId: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setDescription("");
  }

  async function submit() {
    if (!woredaId || !name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    const { data, error } = await createTenantRole(
      woredaId,
      name.trim(),
      description.trim() || null,
      userId,
    );
    setSubmitting(false);
    if (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create role");
      return;
    }
    if (!data) {
      toast.error(ROW_VERIFICATION_FAILURE_MESSAGE);
      return;
    }
    toast.success("ሚና ተፈጥሯል / Role created");
    reset();
    onOpenChange(false);
    onCreated();
  }

  function handleOpenChange(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-am-body">አዲስ ብጁ ሚና</span>
            <span className="ml-2 text-sm text-slate-500">/ New Custom Role</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cashier" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={submitting}
            onClick={submit}
            className="bg-[color:var(--color-shell-header)] hover:bg-[color:var(--color-shell-header)]/90"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPermissionsDialog({
  role,
  catalog,
  userId,
  onClose,
}: {
  role: TenantRoleRow | null;
  catalog: [string, string[]][];
  userId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const { data: grants = [], isLoading } = useQuery({
    queryKey: ["tenant_role_permission", role?.tenant_role_id],
    enabled: !!role,
    queryFn: () => fetchTenantRolePermissions(role!.tenant_role_id),
  });

  const grantMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const g of grants) m.set(g.permission_key, g.is_granted);
    return m;
  }, [grants]);

  async function toggle(key: string, next: boolean) {
    if (!role || LOCKED_KEYS.has(key)) return;
    setPending((p) => new Set(p).add(key));
    const { data, error } = await upsertTenantRolePermission(
      role.tenant_role_id,
      key,
      next,
      userId,
    );
    if (error) toast.error(error instanceof Error ? error.message : "Failed to save");
    else if (!data) toast.error(ROW_VERIFICATION_FAILURE_MESSAGE);
    else {
      toast.success("ተቀምጧል / Saved");
      qc.invalidateQueries({ queryKey: ["tenant_role_permission", role.tenant_role_id] });
    }
    setPending((p) => {
      const n = new Set(p);
      n.delete(key);
      return n;
    });
  }

  if (!role) return null;

  return (
    <TooltipProvider>
      <Dialog open={!!role} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <span className="font-am-body">ፈቃዶች</span>
              <span className="ml-2 text-sm text-slate-500">/ Permissions — {role.name}</span>
            </DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="p-4 text-sm text-slate-500">Loading…</div>
          ) : (
            <div className="space-y-4">
              {catalog.map(([prefix, keys]) => (
                <Fragment key={prefix}>
                  <div className="text-xs font-semibold text-slate-600">
                    <span className="font-am-body">{GROUP_LABELS[prefix]?.am ?? prefix}</span>
                    <span className="ml-1 text-slate-400">
                      / {GROUP_LABELS[prefix]?.en ?? prefix}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {keys.map((key) => {
                      const locked = LOCKED_KEYS.has(key);
                      const checked = grantMap.get(key) ?? false;
                      const cell = (
                        <Checkbox
                          checked={checked}
                          disabled={locked || pending.has(key)}
                          onCheckedChange={(v) => toggle(key, Boolean(v))}
                        />
                      );
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-sm"
                        >
                          <div className="flex items-center gap-1.5 font-mono text-xs text-slate-700">
                            {locked && <Lock className="h-3 w-3 text-amber-600" />}
                            <span>{key}</span>
                            <span className="text-slate-400">
                              — {PERMISSION_ACTION_LABELS[key]?.en ?? PERMISSION_LABELS[key] ?? ""}
                            </span>
                          </div>
                          {locked ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{cell}</TooltipTrigger>
                              <TooltipContent>
                                <span className="font-am-body">የስርዓት ገደብ</span>
                                <span className="ml-1 text-xs text-slate-300">/ System-locked</span>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            cell
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Fragment>
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
    </TooltipProvider>
  );
}
