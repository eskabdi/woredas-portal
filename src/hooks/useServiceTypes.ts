import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import type { ServiceCategory } from "@/lib/serviceConstants";

export interface ServiceTypeRow {
  service_type_id: string;
  code: string;
  category: string;
  name_am: string;
  name_en: string;
  fee_amount: number;
  requires_payment: boolean;
  requires_approval: boolean;
  required_documents: unknown;
  letter_body_template: string | null;
  is_active: boolean;
  sort_order: number;
}

/** Tenant service catalog (letters + complaint types). */
export function useServiceTypes(opts?: { category?: ServiceCategory; activeOnly?: boolean }) {
  const woredaId = useAuthStore((s) => s.woredaId);
  const category = opts?.category;
  const activeOnly = opts?.activeOnly ?? true;

  return useQuery({
    queryKey: ["service-types", woredaId, category ?? "all", activeOnly],
    enabled: !!woredaId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ServiceTypeRow[]> => {
      let q = supabase
        .from("service_type")
        .select(
          "service_type_id, code, category, name_am, name_en, fee_amount, requires_payment, requires_approval, required_documents, letter_body_template, is_active, sort_order",
        )
        .eq("woreda_id", woredaId!)
        .order("sort_order", { ascending: true })
        .order("name_en", { ascending: true });
      if (category) q = q.eq("category", category);
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ServiceTypeRow[];
    },
  });
}

export function requiredDocList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [];
}
