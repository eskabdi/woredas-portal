import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore, type AppUser } from "@/stores/authStore";
import type { Role } from "@/config/permissions";

// Exported so set-password.tsx can refetch after the activate-invited-user
// Edge Function resolves, instead of racing the USER_UPDATED listener below
// (which defers via setTimeout(0) and isn't guaranteed to land before the
// component reads the freshly-activated status).
export async function fetchAppUser(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, woreda_id, role, full_name, username, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    user_id: data.user_id,
    woreda_id: data.woreda_id,
    role: data.role as Role,
    full_name: data.full_name,
    username: data.username,
    status: data.status,
  };
}

export function useAuthBootstrap() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const sessionUser = data.session?.user ?? null;
      if (!sessionUser) {
        clearAuth();
        return;
      }
      const appUser = await fetchAppUser(sessionUser.id);
      if (!mounted) return;
      setAuth(sessionUser, appUser);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearAuth();
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        const sessionUser = session?.user ?? null;
        if (!sessionUser) {
          clearAuth();
          return;
        }
        // Defer fetch so we don't block the auth callback.
        setTimeout(() => {
          fetchAppUser(sessionUser.id).then((appUser) => {
            if (mounted) setAuth(sessionUser, appUser);
          });
        }, 0);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [setAuth, clearAuth]);
}
