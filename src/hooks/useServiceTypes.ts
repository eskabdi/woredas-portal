import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
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
  rental_checkpoint_gated: boolean;
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
          "service_type_id, code, category, name_am, name_en, fee_amount, requires_payment, requires_approval, required_documents, letter_body_template, is_active, sort_order, rental_checkpoint_gated",
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

export interface ServiceKpis {
  new_today: number;
  pending_verification: number;
  pending_approval: number;
  awaiting_payment: number;
  issued_this_month: number;
  rejected_this_month: number;
  avg_turnaround_days: number | null;
}

// Task 14-B: get_service_kpis() (00000000000062), mirroring
// useCredentialKpis()'s exact pattern -- server-counted, tenant-scoped
// internally, gated client-side on service.read to match the RPC's own
// permission check so a viewer/finance_clerk (or a pending/suspended user)
// doesn't have this reject every 60s for as long as the page stays open.
export function useServiceKpis() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return useQuery({
    queryKey: ["service-kpis", woredaId],
    enabled: !!woredaId && hasPermission(P.SERVICE_READ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ServiceKpis> => {
      const { data, error } = await supabase.rpc("get_service_kpis");
      if (error) throw error;
      return data as unknown as ServiceKpis;
    },
  });
}

export function requiredDocList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [];
}
