import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  IDLE_CHECK_INTERVAL_MS,
  IDLE_LAST_ACTIVITY_STORAGE_KEY,
  IDLE_LOGOUT_MS,
  IDLE_WARNING_MS,
} from "@/config/idleTimeout";

interface UseIdleTimeoutOptions {
  /** Called once when the idle limit is reached -- the shells pass their
   * existing handleSignOut (supabase.auth.signOut() + navigate to /login). */
  onTimeout: () => void;
  /** Shell-supplied copy so each portal keeps its own language convention
   * (Amharic-first bilingual in the woreda shell, English in admin). */
  warningMessage: string;
  staySignedInLabel: string;
  signedOutMessage: string;
}

// keydown/pointerdown/touchstart cover input; mousemove covers reading with
// the cursor; scroll+wheel (capture: scroll does not bubble out of the
// shells' overflow-auto <main>) cover reading a long report without ever
// clicking -- the case a naive click-only tracker logs out mid-read.
const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "pointerdown",
  "scroll",
  "wheel",
  "touchstart",
] as const;

// mousemove can fire >100x/s; the in-memory timestamp updates every time
// (cheap), but the cross-tab storage write is throttled.
const STORAGE_WRITE_THROTTLE_MS = 5_000;

function readStoredActivity(): number {
  try {
    const raw = localStorage.getItem(IDLE_LAST_ACTIVITY_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredActivity(at: number): void {
  try {
    localStorage.setItem(IDLE_LAST_ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    /* blocked storage (private mode) -- per-tab tracking still works */
  }
}

/**
 * Signs the user out after IDLE_LOGOUT_MS without activity, warning at
 * IDLE_WARNING_MS (INSA Phase 3 session-management requirement). Mounted
 * once per portal shell -- WoredaShell and AdminShell each wrap their whole
 * portal, so one instance covers every page.
 */
export function useIdleTimeout({
  onTimeout,
  warningMessage,
  staySignedInLabel,
  signedOutMessage,
}: UseIdleTimeoutOptions): void {
  // Latest-ref pattern: the effect below runs once, but callers recreate
  // these props every render (handleSignOut is an inline closure in both
  // shells) -- refs keep the listeners bound to fresh values without
  // rebinding.
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const messagesRef = useRef({ warningMessage, staySignedInLabel, signedOutMessage });
  messagesRef.current = { warningMessage, staySignedInLabel, signedOutMessage };

  useEffect(() => {
    let lastActivity = Date.now();
    let lastStorageWrite = 0;
    let warningToastId: string | number | null = null;
    let fired = false;

    writeStoredActivity(lastActivity);

    const dismissWarning = () => {
      if (warningToastId !== null) {
        toast.dismiss(warningToastId);
        warningToastId = null;
      }
    };

    const markActivity = () => {
      if (fired) return;
      lastActivity = Date.now();
      if (lastActivity - lastStorageWrite >= STORAGE_WRITE_THROTTLE_MS) {
        lastStorageWrite = lastActivity;
        writeStoredActivity(lastActivity);
      }
      dismissWarning();
    };

    const check = () => {
      if (fired) return;
      // Activity in ANOTHER tab counts: the freshest of this tab's own
      // timestamp and the storage-synced one wins, so an idle background
      // tab can't end a session someone is actively using next door.
      const effectiveLast = Math.max(lastActivity, readStoredActivity());
      const idleMs = Date.now() - effectiveLast;

      if (idleMs >= IDLE_LOGOUT_MS) {
        fired = true;
        dismissWarning();
        toast.info(messagesRef.current.signedOutMessage);
        onTimeoutRef.current();
        return;
      }
      if (idleMs >= IDLE_WARNING_MS) {
        if (warningToastId === null) {
          warningToastId = toast.warning(messagesRef.current.warningMessage, {
            duration: Infinity,
            action: { label: messagesRef.current.staySignedInLabel, onClick: markActivity },
          });
        }
        return;
      }
      // Back under the threshold without local activity -- another tab was
      // active. Withdraw a shown warning.
      dismissWarning();
    };

    const onVisibilityChange = () => {
      // Returning to a long-hidden tab: don't wait up to a full interval
      // (browsers also throttle hidden-tab timers) to notice the session
      // expired while away.
      if (document.visibilityState === "visible") check();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(check, IDLE_CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, markActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
      dismissWarning();
    };
    // Intentionally mount-once: everything dynamic flows through refs above.
  }, []);
}
