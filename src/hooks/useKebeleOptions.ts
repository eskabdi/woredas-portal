import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

export interface KebeleOption {
  kebele_id: string;
  kebele_number: string | null;
  kebele_name_am: string | null;
  kebele_name_en: string | null;
}

export function kebeleOptionLabel(k: KebeleOption) {
  const name = k.kebele_name_am || k.kebele_name_en || "—";
  return k.kebele_number ? `ቀበሌ ${k.kebele_number} — ${name}` : name;
}

/** Active kebeles of the current tenant, for filter dropdowns. */
export function useKebeleOptions() {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["kebele-options", woredaId],
    enabled: !!woredaId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<KebeleOption[]> => {
      const { data, error } = await supabase
        .from("kebele")
        .select("kebele_id, kebele_number, kebele_name_am, kebele_name_en")
        .eq("woreda_id", woredaId!)
        .order("kebele_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as KebeleOption[];
    },
  });
}
