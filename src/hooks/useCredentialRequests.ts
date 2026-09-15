import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";

/**
 * Task 12.6: the credential workflow's typed data-layer hooks. Started with
 * the two genuinely new reads this task introduces (the fee resolver and
 * credential_policy, both from Task 11/12's new schema) rather than a
 * wholesale extraction of every existing inline useQuery/useMutation in the
 * four route files -- see docs/task12-mapping-memo.md's 12.6 section for why
 * that full extraction is its own careful, function-by-function pass and not
 * done in one sweep here. New stage-UI pieces this task adds should read
 * through this file; existing untouched mutations stay inline until their
 * own turn.
 */

/** Resolves the applicable fee for a credential request_type in the
 * caller's own woreda via the fail-closed resolve_credential_fee() RPC
 * (00000000000054) -- throws (surfaced as `error`) when the mapped
 * fee_schedule row is missing or inactive, by design: there is no silent
 * fallback to a flat fee. */
export function useFeeSchedule(requestType: string | undefined, enabled = true) {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["credential-fee", woredaId, requestType],
    enabled: enabled && !!woredaId && !!requestType,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("resolve_credential_fee", {
        _request_type: requestType!,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}

export interface CredentialKpis {
  new_today: number;
  pending_verification: number;
  pending_approval: number;
  awaiting_payment: number;
  ready_or_printing: number;
  issued_this_month: number;
  returned_rate_pct: number | null;
  rejected_this_month: number;
  blocked: number;
  avg_turnaround_days: number | null;
}

/** Task 12.3's 10 KPI widgets, all server-counted in one round trip by
 * get_credential_kpis() (00000000000057) -- woreda_id is resolved from
 * get_user_woreda_id() inside the RPC, never sent by the client, so there is
 * nothing here to spoof across tenants. A short staleTime rather than a long
 * one: these are dashboard counts an officer expects to reflect what just
 * happened (a request just submitted, a payment just recorded), not a
 * slow-changing reference table like credential_policy above. */
export function useCredentialKpis() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return useQuery({
    queryKey: ["credential-kpis", woredaId],
    // get_credential_kpis() now raises for a caller lacking credential.read
    // (the same review finding that added its DB-side permission check) --
    // gating here matches CredentialQueueTable's own `enabled` check, so a
    // viewer/finance_clerk (or a pending/suspended user) never fires this
    // RPC only to have it reject every 60s for as long as the page stays open.
    enabled: !!woredaId && hasPermission(P.CREDENTIAL_READ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<CredentialKpis> => {
      const { data, error } = await supabase.rpc("get_credential_kpis");
      if (error) throw error;
      return data as unknown as CredentialKpis;
    },
  });
}

export interface CredentialPolicyRow {
  credential_policy_id: string;
  woreda_id: string;
  expiry_months: number | null;
  renewal_window_days: number | null;
  max_reissue_count: number | null;
  enabled_request_types: string[];
}

/** Reads the tenant's credential_policy row (Task 11). A missing row is not
 * an error -- it means "no override, use the compiled default" per the
 * same convention tenant_module_config and role_permission already use
 * (see docs/erd.md's Task 11 section) -- so this returns `null`, not a
 * thrown error, when no row exists yet. */
export function useCredentialPolicy() {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["credential-policy", woredaId],
    enabled: !!woredaId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CredentialPolicyRow | null> => {
      const { data, error } = await supabase
        .from("credential_policy")
        .select(
          "credential_policy_id, woreda_id, expiry_months, renewal_window_days, max_reissue_count, enabled_request_types",
        )
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data as CredentialPolicyRow | null;
    },
  });
}
