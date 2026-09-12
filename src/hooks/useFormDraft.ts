import { useEffect, useRef } from "react";
import type { FieldValues, UseFormGetValues, UseFormReset, UseFormWatch } from "react-hook-form";

/** Every wizard draft key shares this prefix so sign-out (see
 * clearAllWizardDrafts below) can find and remove all of them without each
 * wizard having to be listed by name. */
const DRAFT_KEY_PREFIX = "wizard-draft:";

const WRITE_DEBOUNCE_MS = 500;

function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // corrupt JSON or storage blocked (private mode) -- start fresh
  }
}

function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full -- the draft simply doesn't persist this time */
  }
}

/**
 * Persists a react-hook-form wizard's in-progress values to localStorage so
 * a reload (or an accidental tab close) doesn't lose a half-filled, multi-
 * step form -- the resident wizard in particular has no autosave and can
 * take several minutes to complete.
 *
 * `key` should be namespaced by both the wizard and the current woreda (e.g.
 * `` `resident-new:${woredaId}` ``, this hook adds the shared prefix) --
 * localStorage is per-browser-origin, not per-tenant, so a bare wizard name
 * would let a half-typed draft from one woreda surface for a different one
 * on a shared kiosk machine. Cleared entirely on submit (call `clearDraft`)
 * and on sign-out (`clearAllWizardDrafts`, called from both portal shells)
 * for the same cross-tenant-leak reason.
 */
export function useFormDraft<T extends FieldValues>({
  storageKey,
  watch,
  reset,
  getValues,
  enabled = true,
}: {
  /** Unique per wizard instance, WITHOUT the shared prefix -- e.g.
   * `resident-new:${woredaId}`. Pass a stable value; changing it between
   * renders (e.g. before woredaId loads) is treated as a different draft. */
  storageKey: string;
  watch: UseFormWatch<T>;
  reset: UseFormReset<T>;
  getValues: UseFormGetValues<T>;
  /** Skip restore/persist entirely -- e.g. while woredaId hasn't loaded yet. */
  enabled?: boolean;
}): { clearDraft: () => void; hadDraft: boolean } {
  const key = `${DRAFT_KEY_PREFIX}${storageKey}`;
  const hadDraftRef = useRef(false);
  const restoredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore once, before the write-effect below can fire on a value it
  // itself just set -- both guarded by restoredRef so a re-render (e.g.
  // `enabled` flipping true once woredaId resolves) doesn't re-apply a
  // draft over edits the user has already made this session.
  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    const draft = readDraft<T>(key);
    if (draft) {
      hadDraftRef.current = true;
      reset(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per enabled transition, not per keystroke
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = watch(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        writeDraft(key, getValues());
      }, WRITE_DEBOUNCE_MS);
    });
    return () => {
      subscription.unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- watch/getValues are stable per react-hook-form instance
  }, [enabled, key]);

  function clearDraft() {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked -- nothing to clear */
    }
  }

  return { clearDraft, hadDraft: hadDraftRef.current };
}

/** Called from both portal shells' sign-out handlers. localStorage is
 * per-origin, not per-session, so a draft left behind after sign-out would
 * otherwise still be sitting there -- and readable -- for whoever signs in
 * next on the same browser, tenant boundary or not. */
export function clearAllWizardDrafts(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(DRAFT_KEY_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* storage blocked -- nothing to clear */
  }
}
