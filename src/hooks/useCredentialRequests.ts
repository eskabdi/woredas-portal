import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

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
