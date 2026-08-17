import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import type { ModuleKey } from "@/config/permissions";

const ALL_MODULES: ModuleKey[] = [
  "credentials",
  "civil_registration",
  "revenue",
  "reports",
  "audit",
  "services",
  "approvals",
];

/**
 * Fetches tenant module configuration for the current user's woreda.
 * Returns a Set of enabled module keys. Super admins see all modules enabled.
 * If the config row is missing for a module, it is treated as enabled (default).
 */
export function useTenantModules() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const role = useAuthStore((s) => s.role);

  return useQuery({
    queryKey: ["tenant_module_config", woredaId, role],
    enabled: !!role,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<Set<ModuleKey>> => {
      if (role === "super_admin" || !woredaId) {
        return new Set<ModuleKey>(ALL_MODULES);
      }
      const { data, error } = await supabase
        .from("tenant_module_config")
        .select("module_key, is_enabled")
        .eq("woreda_id", woredaId);
      if (error) throw error;

      const enabled = new Set<ModuleKey>();
      const seen = new Set<string>();
      for (const row of data ?? []) {
        seen.add(row.module_key);
        if (row.is_enabled) enabled.add(row.module_key as ModuleKey);
      }
      // Missing rows default to enabled (preserves behavior).
      for (const m of ALL_MODULES) {
        if (!seen.has(m)) enabled.add(m);
      }
      return enabled;
    },
  });
}
