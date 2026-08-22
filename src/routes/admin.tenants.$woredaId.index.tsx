import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, ScrollText, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusChip } from "@/components/common/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/admin/tenants/$woredaId/")({
  ssr: false,
  component: TenantDetailPage,
});

const MODULES = [
  { key: "credentials", am: "የመኖሪያ መታወቂያ", en: "Credentials" },
  { key: "civil_registration", am: "የኩነት ምዝገባ", en: "Civil Registration" },
  { key: "revenue", am: "ገቢ", en: "Revenue" },
  { key: "reports", am: "ሪፖርቶች", en: "Reports" },
  { key: "audit", am: "ኦዲት", en: "Audit Trail" },
] as const;

interface WoredaShape {
  woreda_id: string;
  woreda_code: string;
  woreda_numeric_code: number | null;
  woreda_name_am: string;
  woreda_name_en: string;
}
interface ModuleRow {
  module_key: string;
  is_enabled: boolean;
}
interface AdminShape {
  user_id: string;
  full_name: string;
  username: string;
  status: string;
}

function TenantDetailPage() {
  const { woredaId } = Route.useParams();
  const qc = useQueryClient();
  const callerId = useAuthStore((s) => s.user?.id);

  const { data: woreda, isLoading: woredaLoading } = useQuery({
    queryKey: ["admin-tenant-detail", woredaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_id, woreda_code, woreda_numeric_code, woreda_name_am, woreda_name_en")
        .eq("woreda_id", woredaId)
        .single();
      if (error) throw error;
      return data as WoredaShape;
    },
  });

  const { data: moduleRows = [] } = useQuery({
    queryKey: ["admin-tenant-detail-modules", woredaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_module_config")
        .select("module_key, is_enabled")
        .eq("woreda_id", woredaId);
      if (error) throw error;
      return (data ?? []) as ModuleRow[];
    },
  });

  const { data: admin } = useQuery({
    queryKey: ["admin-tenant-detail-admin", woredaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_user")
        .select("user_id, full_name, username, status")
        .eq("woreda_id", woredaId)
        .eq("role", "tenant_admin")
        .neq("status", "suspended")
        .maybeSingle();
      return data as AdminShape | null;
    },
  });

  const enabledMap = new Map(moduleRows.map((r) => [r.module_key, r.is_enabled]));

  async function toggleModule(moduleKey: string, checked: boolean) {
    const { error } = await supabase.from("tenant_module_config").upsert(
      {
        woreda_id: woredaId,
        module_key: moduleKey,
        is_enabled: checked,
        updated_by: callerId ?? null,
      },
      { onConflict: "woreda_id,module_key" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("audit_log").insert({
      actor_user_id: callerId ?? null,
      woreda_id: woredaId,
      entity_name: "tenant_module_config",
      entity_id: woredaId,
      action_type: "TENANT_MODULE_TOGGLED",
      new_value_json: { module_key: moduleKey, is_enabled: checked },
    });
    await qc.invalidateQueries({ queryKey: ["admin-tenant-detail-modules", woredaId] });
    await qc.invalidateQueries({ queryKey: ["admin-tenants-modules"] });
    toast.success("Module configuration updated");
  }

  if (woredaLoading || !woreda) {
    return (
      <div className="p-6">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to="/admin/tenants" className="text-sm text-blue-700 hover:underline">
          ← Back to Tenants
        </Link>
      </div>
      <PageHeader
        icon={Building2}
        titleAm={woreda.woreda_name_am}
        titleEn={woreda.woreda_name_en}
        description={`Code ${woreda.woreda_numeric_code ?? woreda.woreda_code} · Harari Region`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <span className="font-noto-ethiopic">የወረዳ አስተዳዳሪ</span>
            <span className="ml-1">/ Tenant Administrator</span>
          </h2>
          {admin ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-900">{admin.full_name}</div>
                <div className="text-xs text-slate-500">{admin.username}</div>
              </div>
              <StatusChip status={admin.status} />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="font-noto-ethiopic text-amber-700">
                አስተዳዳሪ አልተመደበም
                <span className="ml-1 text-xs text-amber-600">/ No Admin Assigned</span>
              </span>
            </div>
          )}
          <Button asChild variant="outline" className="mt-4 w-full">
            <Link to="/admin/tenants/$woredaId/provision" params={{ woredaId }}>
              <UserPlus className="mr-2 h-4 w-4" />
              {admin ? "Invite Replacement Admin" : "Provision Administrator"}
            </Link>
          </Button>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <span className="font-noto-ethiopic">እንቅስቃሴ</span>
            <span className="ml-1">/ Activity</span>
          </h2>
          <p className="mb-4 text-sm text-slate-600">
            View every audit log entry recorded for this tenant.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/admin/audit" search={{ woreda: woredaId }}>
              <ScrollText className="mr-2 h-4 w-4" />
              View Audit Trail
            </Link>
          </Button>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <span className="font-noto-ethiopic">የሞጁል ውቅር</span>
            <span className="ml-1">/ Module Configuration</span>
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Residents, Households, Dashboard, and Settings are always enabled. Changes here take
            effect immediately for this tenant.
          </p>
          <div className="divide-y rounded-md border">
            {MODULES.map((m) => (
              <div key={m.key} className="flex items-center justify-between p-3">
                <div>
                  <div className="font-noto-ethiopic text-sm font-medium">{m.am}</div>
                  <div className="text-xs text-slate-500">{m.en}</div>
                </div>
                <Switch
                  checked={enabledMap.get(m.key) ?? true}
                  onCheckedChange={(c) => toggleModule(m.key, c)}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
