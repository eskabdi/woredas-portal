import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import type { ReportBranding } from "@/utils/reportExport";

async function toDataUrl(path: string): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from("tenant-assets").createSignedUrl(path, 3600);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Tenant name, contact info and logo (as a data URL) for PDF report headers. */
export function useReportBranding() {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery<ReportBranding>({
    queryKey: ["report-branding", woredaId],
    enabled: !!woredaId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [w, s] = await Promise.all([
        supabase
          .from("woreda")
          .select("woreda_name_am, woreda_name_en")
          .eq("woreda_id", woredaId!)
          .maybeSingle(),
        supabase
          .from("woreda_settings")
          .select("woreda_name_display, address_line, contact_phone, contact_email, logo_url")
          .eq("woreda_id", woredaId!)
          .maybeSingle(),
      ]);

      const logoDataUrl = s.data?.logo_url ? await toDataUrl(s.data.logo_url) : null;
      return {
        nameAm: s.data?.woreda_name_display || w.data?.woreda_name_am || "ወረዳ አስተዳደር",
        nameEn: w.data?.woreda_name_en || "Woreda Administration",
        addressLine: s.data?.address_line ?? null,
        contactPhone: s.data?.contact_phone ?? null,
        contactEmail: s.data?.contact_email ?? null,
        logoDataUrl,
      };
    },
  });
}
