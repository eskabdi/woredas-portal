import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Task 12-C: authoritative actions (approve, reject, issuance, print
 * confirmation, activation, revoke, suspend, verify) are never queued --
 * see docs/task12c-mapping-memo.md §4. This hook is the shared way a
 * button disables itself offline with a visible, bilingual reason,
 * instead of the action silently failing on submit.
 */
export function useOfflineGuard() {
  const isOnline = useOnlineStatus();
  return {
    isOffline: !isOnline,
    offlineReason: "ከመስመር ውጭ ነዎት / You are offline",
  };
}
