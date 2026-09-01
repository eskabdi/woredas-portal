import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P, ROLE_PERMISSIONS, type Role } from "@/config/permissions";

const ALL_PERMISSION_KEYS: string[] = Object.values(P);

const EDITABLE_ROLES: { key: Role; am: string; en: string }[] = [
  { key: "registry_clerk", am: "የመዝገብ ሰራተኛ", en: "Registry Clerk" },
  { key: "civil_registrar", am: "የኩነት መዝጋቢ", en: "Civil Registrar" },
  { key: "finance_clerk", am: "የገንዘብ ሰራተኛ", en: "Finance Clerk" },
  { key: "supervisor", am: "ተቆጣጣሪ", en: "Supervisor" },
  { key: "auditor", am: "ኦዲተር", en: "Auditor" },
  { key: "viewer", am: "ተመልካች", en: "Viewer" },
];

const LOCKED_KEYS = new Set(["credential.approve", "civil.approve", "tenant.manage"]);

const GROUP_LABELS: Record<string, { am: string; en: string }> = {
  resident: { am: "ነዋሪ", en: "Resident" },
  household: { am: "ቤተሰብ", en: "Household" },
  credential: { am: "መታወቂያ", en: "Credential" },
  civil: { am: "የኩነት ምዝገባ", en: "Civil Registration" },
  payment: { am: "ክፍያ", en: "Payment" },
  receipt: { am: "ደረሰኝ", en: "Receipt" },
  report: { am: "ሪፖርት", en: "Report" },
  audit: { am: "ኦዲት", en: "Audit" },
  tenant: { am: "ወረዳ", en: "Tenant" },
  user: { am: "ተጠቃሚ", en: "User" },
  platform: { am: "መድረክ", en: "Platform" },
};

const PERMISSION_LABELS: Record<string, string> = {
  "resident.create": "Create",
  "resident.read": "Read",
  "resident.update": "Update",
  "resident.delete": "Delete",
  "household.create": "Create",
  "household.read": "Read",
  "household.update": "Update",
  "credential.issue": "Issue",
  "credential.read": "Read",
  "credential.print": "Print",
  "credential.verify": "Verify",
  "credential.revoke": "Revoke",
  "credential.renew": "Renew",
  "credential.approve": "Approve",
  "civil.register": "Register",
  "civil.approve": "Approve",
  "civil.read": "Read",
  "payment.collect": "Collect",
  "payment.read": "Read",
  "receipt.print": "Print",
  "report.view": "View",
  "report.export": "Export",
  "audit.view": "View",
  "tenant.manage": "Manage",
  "tenant.create": "Create",
  "user.manage": "Manage",
  "platform.manage": "Manage",
};

export function RolesPermissionsTab() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["role_permission", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission")
        .select("role_name, permission_key, is_granted")
        .eq("woreda_id", woredaId as string);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Build lookup: key -> role -> bool
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, boolean>>();
    for (const r of rows) {
      if (!map.has(r.permission_key)) map.set(r.permission_key, new Map());
      map.get(r.permission_key)!.set(r.role_name, r.is_granted);
    }
    return map;
  }, [rows]);

  const permissionKeys = useMemo(() => {
    // Enumerate the full permission catalog, not just what's seeded for this
    // woreda — a permission added to the catalog after seeding must still
    // appear here (with the "default" indicator) rather than being silently
    // dropped from the matrix.
    const keys = new Set<string>(ALL_PERMISSION_KEYS);
    for (const k of matrix.keys()) keys.add(k);
    return Array.from(keys).sort();
  }, [matrix]);

  // Group by resource prefix
  const grouped = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const k of permissionKeys) {
      const prefix = k.split(".")[0];
      if (!g.has(prefix)) g.set(prefix, []);
      g.get(prefix)!.push(k);
    }
    return Array.from(g.entries());
  }, [permissionKeys]);

  const [pending, setPending] = useState<Set<string>>(new Set());

  async function toggle(role: string, key: string, next: boolean) {
    if (!woredaId) return;
    if (LOCKED_KEYS.has(key)) return;
    const cellId = `${role}:${key}`;
    setPending((p) => new Set(p).add(cellId));
    const { error } = await supabase
      .from("role_permission")
      .upsert(
        { woreda_id: woredaId, role_name: role, permission_key: key, is_granted: next },
        { onConflict: "woreda_id,role_name,permission_key" },
      );
    if (error) {
      toast.error(error.message);
    } else {
      await supabase.from("audit_log").insert({
        actor_user_id: userId ?? null,
        woreda_id: woredaId,
        entity_name: "role_permission",
        action_type: "ROLE_PERMISSION_UPDATED",
        new_value_json: { role_name: role, permission_key: key, is_granted: next },
      });
      toast.success("ተቀምጧል / Saved");
      qc.invalidateQueries({ queryKey: ["role_permission", woredaId] });
    }
    setPending((p) => {
      const n = new Set(p);
      n.delete(cellId);
      return n;
    });
  }

  const tenantAdminPerms = new Set(ROLE_PERMISSIONS.tenant_admin as string[]);

  if (isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <TooltipProvider>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-blue-700 text-white">
                <th className="sticky left-0 z-10 bg-blue-700 px-4 py-3 text-left font-noto-ethiopic font-medium">
                  <div>ፍቃድ</div>
                  <div className="text-[10px] uppercase tracking-wide text-blue-100">
                    Permission
                  </div>
                </th>
                {EDITABLE_ROLES.map((r) => (
                  <th key={r.key} className="px-3 py-3 text-center font-noto-ethiopic font-medium">
                    <div className="text-xs">{r.am}</div>
                    <div className="text-[10px] uppercase tracking-wide text-blue-100">{r.en}</div>
                  </th>
                ))}
                <th className="bg-slate-500 px-3 py-3 text-center font-noto-ethiopic font-medium">
                  <div className="text-xs">ወረዳ አስተዳዳሪ</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-200">
                    Tenant Admin (Read-Only)
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([prefix, keys]) => (
                <>
                  <tr key={`h-${prefix}`} className="bg-slate-100">
                    <td
                      colSpan={EDITABLE_ROLES.length + 2}
                      className="px-4 py-2 text-xs font-semibold text-slate-700"
                    >
                      <span className="font-noto-ethiopic">
                        {GROUP_LABELS[prefix]?.am ?? prefix}
                      </span>
                      <span className="ml-2 text-slate-500">
                        / {GROUP_LABELS[prefix]?.en ?? prefix}
                      </span>
                    </td>
                  </tr>
                  {keys.map((key, idx) => {
                    const locked = LOCKED_KEYS.has(key);
                    const rolesMap = matrix.get(key) ?? new Map<string, boolean>();
                    return (
                      <tr key={key} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="sticky left-0 z-[1] bg-inherit px-4 py-2 font-mono text-xs text-slate-700">
                          <div className="flex items-center gap-1.5">
                            {locked && <Lock className="h-3 w-3 text-amber-600" />}
                            <span>{key}</span>
                            <span className="text-slate-400">— {PERMISSION_LABELS[key] ?? ""}</span>
                          </div>
                        </td>
                        {EDITABLE_ROLES.map((r) => {
                          const isSeeded = rolesMap.has(r.key);
                          const checked = isSeeded
                            ? (rolesMap.get(r.key) ?? false)
                            : (ROLE_PERMISSIONS[r.key] as string[]).includes(key);
                          const cellId = `${r.key}:${key}`;
                          const isPending = pending.has(cellId);
                          const cell = (
                            <div className="flex flex-col items-center gap-0.5">
                              <Checkbox
                                checked={checked}
                                disabled={locked || isPending}
                                onCheckedChange={(v) => toggle(r.key, key, Boolean(v))}
                              />
                              {!isSeeded && (
                                <span className="text-[9px] leading-none text-slate-400">
                                  ነባሪ / default
                                </span>
                              )}
                            </div>
                          );
                          return (
                            <td key={r.key} className="px-3 py-2 text-center">
                              {locked ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>{cell}</TooltipTrigger>
                                  <TooltipContent>
                                    <span className="font-noto-ethiopic">
                                      የስርዓት ገደብ — ሊቀየር አይችልም
                                    </span>
                                    <span className="ml-1 text-xs text-slate-300">
                                      / System-locked
                                    </span>
                                  </TooltipContent>
                                </Tooltip>
                              ) : !isSeeded ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>{cell}</TooltipTrigger>
                                  <TooltipContent>
                                    <span className="font-noto-ethiopic">
                                      ይህ ፍቃድ ገና አልተቀመጠም — ነባሪ ዋጋ ታይቷል
                                    </span>
                                    <span className="ml-1 text-xs text-slate-300">
                                      / Not yet saved for this tenant — showing the code default.
                                      Toggling will save an explicit override.
                                    </span>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                cell
                              )}
                            </td>
                          );
                        })}
                        <td className="bg-slate-50 px-3 py-2 text-center">
                          <div className="flex justify-center">
                            <Checkbox checked={tenantAdminPerms.has(key)} disabled />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <span className="font-noto-ethiopic">የሚና ለውጦች ወዲያውኑ በተጠቃሚዎች ላይ ተፈፃሚ ይሆናሉ</span>
        <span className="ml-2 text-blue-700">/ Role changes apply immediately to users.</span>
      </div>
    </TooltipProvider>
  );
}
