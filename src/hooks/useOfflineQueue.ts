import { useCallback, useSyncExternalStore } from "react";
import {
  getQueue,
  subscribe,
  enqueue as enqueueItem,
  type QueueEntity,
  type QueueAction,
  type QueueItem,
} from "@/lib/offlineQueue";

/** Task 12-C: reactive view of one woreda's offline queue, backed by
 * useSyncExternalStore so every component reading it re-renders the
 * instant an enqueue/dequeue happens anywhere in the app -- no polling,
 * no prop drilling a queue object through the shell. */
export function useOfflineQueue(woredaId: string | null) {
  const items = useSyncExternalStore(
    useCallback((cb) => (woredaId ? subscribe(woredaId, cb) : () => {}), [woredaId]),
    useCallback(() => (woredaId ? getQueue(woredaId) : []), [woredaId]),
    useCallback(() => (woredaId ? getQueue(woredaId) : []), [woredaId]),
  );

  const enqueue = useCallback(
    (
      entity: QueueEntity,
      action: QueueAction,
      payload: Record<string, unknown>,
      formId: string,
    ) => {
      if (!woredaId) throw new Error("useOfflineQueue: no woreda context");
      return enqueueItem(woredaId, entity, action, payload, formId);
    },
    [woredaId],
  );

  return { items: items as QueueItem[], count: items.length, enqueue };
}
