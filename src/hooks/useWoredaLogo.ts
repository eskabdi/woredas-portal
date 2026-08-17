import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

/** Signed URL for the tenant logo uploaded in Settings → Images (null when not set). */
export function useWoredaLogo() {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["woreda-logo", woredaId],
    enabled: !!woredaId,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("woreda_settings")
        .select("logo_url")
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (!data?.logo_url) return null;
      const signed = await supabase.storage
        .from("tenant-assets")
        .createSignedUrl(data.logo_url, 3600);
      return signed.data?.signedUrl ?? null;
    },
  });
}
