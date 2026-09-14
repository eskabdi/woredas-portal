import { useEffect } from "react";

/**
 * Task 12-C: registers public/sw.js once, client-side only. Mounted from
 * __root.tsx alongside useAuthBootstrap -- every route has ssr: false
 * already (see CLAUDE.md), so this only ever runs in the browser. Silent
 * no-op on any registration failure (unsupported browser, blocked in a
 * private-mode-like context) -- the app must work identically without a
 * service worker, offline app-shell caching is a bonus, not a requirement.
 */
export function useServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline app-shell caching is best-effort; nothing else depends on it */
    });
  }, []);
}
