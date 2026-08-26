import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

export interface TenantUserOption {
  user_id: string;
  full_name: string;
  job_title: string | null;
}

export function tenantUserOptionLabel(u: TenantUserOption) {
  return u.job_title ? `${u.full_name} — ${u.job_title}` : u.full_name;
}

/** Active staff of the current tenant, for assignee/addressee dropdowns. */
export function useTenantUsers() {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["tenant-users", woredaId],
    enabled: !!woredaId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TenantUserOption[]> => {
      const { data, error } = await supabase
        .from("app_user")
        .select("user_id, full_name, job_title")
        .eq("woreda_id", woredaId!)
        .eq("status", "active")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TenantUserOption[];
    },
  });
}
