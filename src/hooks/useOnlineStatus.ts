import { useEffect, useState } from "react";

const REACHABILITY_CHECK_INTERVAL_MS = 15_000;

// Read directly from env, same as src/integrations/supabase/client.ts --
// the SupabaseClient instance doesn't expose its own url/key as a typed
// public property in the installed client version.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  string | undefined;

/**
 * Task 12-C: navigator.onLine alone only reflects whether the OS thinks a
 * network interface is up -- it stays `true` behind a captive portal or a
 * corporate proxy that blocks this app's actual backend. Layers a cheap
 * reachability probe (a HEAD-shaped auth settings fetch, the same request
 * the Supabase client already knows how to make, not a bespoke endpoint)
 * on top so "online" here means "can actually reach the Supabase project,"
 * which is the property every offline-blocked action and the sync engine
 * both care about.
 */
export function useOnlineStatus(): boolean {
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!browserOnline) {
      setReachable(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        if (!cancelled) setReachable(true); // can't probe -- don't false-block the app
        return;
      }
      try {
        // A plain settings fetch, not getSession() -- avoids any side
        // effect on the session itself, purely a liveness probe.
        // AbortSignal.timeout keeps a hung request (a captive portal that
        // accepts but never responds) from leaving the app in
        // "reachable" limbo indefinitely.
        const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
          method: "GET",
          headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
          signal: AbortSignal.timeout(5000),
        });
        if (!cancelled) setReachable(res.ok);
      } catch {
        if (!cancelled) setReachable(false);
      }
    };
    check();
    const interval = setInterval(check, REACHABILITY_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [browserOnline]);

  return browserOnline && reachable;
}
