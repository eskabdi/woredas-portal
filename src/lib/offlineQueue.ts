/**
 * Task 12-C: entity-agnostic offline mutation queue. Mirrors
 * src/hooks/useFormDraft.ts's persistence pattern exactly (localStorage,
 * per-woreda-namespaced key, a clearAll* swept from both shells' sign-out
 * handlers) -- see docs/task12c-mapping-memo.md §1 for why localStorage
 * over IndexedDB. A plain module (not a hook) so it can be called from
 * both React components and the sync engine without a Provider.
 */

export type QueueEntity = "credential_request" | "vital_event" | "service_request";
export type QueueAction = "submit_intake" | "record_payment_draft";

export interface QueueItem {
  id: string;
  woredaId: string;
  entity: QueueEntity;
  action: QueueAction;
  payload: Record<string, unknown>;
  formId: string;
  createdAt: string;
  attemptCount: number;
}

const QUEUE_KEY_PREFIX = "offline-queue:";

function keyFor(woredaId: string): string {
  return `${QUEUE_KEY_PREFIX}${woredaId}`;
}

function readQueue(woredaId: string): QueueItem[] {
  try {
    const raw = localStorage.getItem(keyFor(woredaId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch {
    return []; // corrupt JSON or storage blocked (private mode) -- start empty
  }
}

function writeQueue(woredaId: string, items: QueueItem[]): void {
  try {
    localStorage.setItem(keyFor(woredaId), JSON.stringify(items));
  } catch {
    /* storage blocked or full -- the enqueue silently doesn't persist;
       callers should already have shown a toast from queueMutation's
       return value before relying on this */
  }
  notifySubscribers(woredaId);
}

/** FIFO order is the array's own insertion order -- items are only ever
 * appended (enqueue) or removed by id (dequeue), never reordered. */
export function getQueue(woredaId: string): QueueItem[] {
  return readQueue(woredaId);
}

export function enqueue(
  woredaId: string,
  entity: QueueEntity,
  action: QueueAction,
  payload: Record<string, unknown>,
  formId: string,
): QueueItem {
  const item: QueueItem = {
    id: crypto.randomUUID(),
    woredaId,
    entity,
    action,
    payload,
    formId,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  };
  const items = readQueue(woredaId);
  items.push(item);
  writeQueue(woredaId, items);
  return item;
}

export function dequeue(woredaId: string, id: string): void {
  const items = readQueue(woredaId).filter((i) => i.id !== id);
  writeQueue(woredaId, items);
}

export function bumpAttempt(woredaId: string, id: string): void {
  const items = readQueue(woredaId).map((i) =>
    i.id === id ? { ...i, attemptCount: i.attemptCount + 1 } : i,
  );
  writeQueue(woredaId, items);
}

/** Called from both portal shells' sign-out handlers, alongside
 * clearAllWizardDrafts() and queryClient.clear() (F-08) -- localStorage is
 * per-origin, not per-session, so a queued submission left behind after
 * sign-out would otherwise sync under the NEXT person's identity the
 * moment they reconnect on the same browser. */
export function clearOfflineQueue(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(QUEUE_KEY_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* storage blocked -- nothing to clear */
  }
  for (const woredaId of subscribers.keys()) notifySubscribers(woredaId);
}

// --- subscription plumbing for useSyncExternalStore -------------------

const subscribers = new Map<string, Set<() => void>>();

function notifySubscribers(woredaId: string): void {
  for (const cb of subscribers.get(woredaId) ?? []) cb();
}

export function subscribe(woredaId: string, callback: () => void): () => void {
  if (!subscribers.has(woredaId)) subscribers.set(woredaId, new Set());
  subscribers.get(woredaId)!.add(callback);
  return () => subscribers.get(woredaId)?.delete(callback);
}
