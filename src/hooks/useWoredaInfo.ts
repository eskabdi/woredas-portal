import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

export function useWoredaInfo() {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["woreda", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const [w, s] = await Promise.all([
        supabase
          .from("woreda")
          .select("woreda_id, woreda_code, woreda_name_en, woreda_name_am, status")
          .eq("woreda_id", woredaId as string)
          .maybeSingle(),
        supabase
          .from("woreda_settings")
          .select("woreda_name_display")
          .eq("woreda_id", woredaId as string)
          .maybeSingle(),
      ]);
      if (w.error) throw w.error;
      if (!w.data) return null;
      const display = s.data?.woreda_name_display?.trim() || null;
      return {
        ...w.data,
        woreda_name_display: display,
        display_name_am: display || w.data.woreda_name_am,
      };
    },

  });
}
