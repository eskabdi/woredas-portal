import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/common/StatusChip";
import { formatEthiopianDateTime } from "@/utils/ethiopianCalendar";

export interface HistoryRow {
  id: string;
  old_status: string | null;
  new_status: string;
  changed_at: string;
  change_reason: string | null;
  changed_by_user_id: string | null;
}

/** Task 14-C: one history query shape for all three modules --
 * workflow_status_history (civil, services -- both categories) is keyed on
 * (entity, entity_id); credential_request_status_history (credentials) is
 * keyed on credential_request_id directly. Same five columns either way,
 * so only the table/filter differs, never the row shape or the render. */
export function useWorkflowHistory(
  entity: "vital_event" | "service_request",
  entityId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["workflow-history", entity, entityId],
    enabled,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase
        .from("workflow_status_history")
        .select("id, old_status, new_status, changed_at, change_reason, changed_by_user_id")
        .eq("entity", entity)
        .eq("entity_id", entityId)
        .order("changed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });
}

export function useCredentialRequestHistory(credentialRequestId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["credential-request-history", credentialRequestId],
    enabled,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase
        .from("credential_request_status_history")
        .select("id, old_status, new_status, changed_at, change_reason, changed_by_user_id")
        .eq("credential_request_id", credentialRequestId)
        .order("changed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });
}

/** Resolves a batch of app_user ids to full_name in one round trip --
 * none of the three modules' history cards resolved actor names before
 * this (Task 14-C); a plain lookup query rather than an embedded FK select
 * since credential_request_status_history/service_request_status_history
 * declare changed_by_user_id as a bare uuid with no FK constraint. */
export function useActorNames(userIds: (string | null)[]) {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id))).sort();
  return useQuery({
    queryKey: ["actor-names", ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("user_id, full_name")
        .in("user_id", ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const u of data ?? []) map[u.user_id] = u.full_name;
      return map;
    },
  });
}

/** Bilingual, Ethiopian-calendar, StatusChip-based history timeline shared
 * by the credential/civil/service detail pages -- replaces three separate
 * ad-hoc renderings (one of which showed Gregorian dates via
 * toLocaleString(), a bug this unification also fixes). */
export function HistoryTimeline({
  rows,
  actorNames,
}: {
  rows: HistoryRow[];
  actorNames?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">— የታሪክ መዝገብ የለም / No history yet</p>;
  }
  return (
    <ol className="space-y-3">
      {rows.map((h) => (
        <li key={h.id} className="flex items-start gap-3 text-sm">
          <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {h.old_status && <StatusChip status={h.old_status} />}
              {h.old_status && <span className="text-slate-400">→</span>}
              <StatusChip status={h.new_status} />
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {formatEthiopianDateTime(new Date(h.changed_at))}
              {h.changed_by_user_id && actorNames?.[h.changed_by_user_id] && (
                <span> · {actorNames[h.changed_by_user_id]}</span>
              )}
            </div>
            {h.change_reason && (
              <div className="mt-0.5 text-xs text-slate-500">{h.change_reason}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
