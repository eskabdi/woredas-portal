import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";

export interface CivilKpis {
  registered_this_month_birth: number;
  registered_this_month_death: number;
  registered_this_month_marriage: number;
  pending_verification: number;
  pending_approval: number;
  awaiting_payment: number;
  avg_turnaround_days: number | null;
}

// Task 14-C: get_civil_kpis() (00000000000067), mirroring useServiceKpis()'s
// exact pattern -- server-counted, tenant-scoped internally, gated
// client-side on civil.read to match the RPC's own permission check.
export function useCivilKpis() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return useQuery({
    queryKey: ["civil-kpis", woredaId],
    enabled: !!woredaId && hasPermission(P.CIVIL_READ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<CivilKpis> => {
      const { data, error } = await supabase.rpc("get_civil_kpis");
      if (error) throw error;
      return data as unknown as CivilKpis;
    },
  });
}
