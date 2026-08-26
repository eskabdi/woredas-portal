import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore, type AppUser } from "@/stores/authStore";
import type { ConsolePermission, Role } from "@/config/permissions";

// Exported so set-password.tsx can refetch after the activate-invited-user
// Edge Function resolves, instead of racing the USER_UPDATED listener below
// (which defers via setTimeout(0) and isn't guaranteed to land before the
// component reads the freshly-activated status).
export async function fetchAppUser(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from("app_user")
    // console_role_id doesn't exist in the generated types yet, which
    // collapses this whole .select()'s return to SelectQueryError -- cast
    // the row immediately below rather than touching `data`'s fields
    // directly. Regenerate types.ts post-deploy and this cast goes away.
    .select("user_id, woreda_id, role, full_name, username, status, console_role_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    user_id: string;
    woreda_id: string | null;
    role: string;
    full_name: string;
    username: string;
    status: string;
    console_role_id: string | null;
  };
  return {
    user_id: row.user_id,
    woreda_id: row.woreda_id,
    role: row.role as Role,
    full_name: row.full_name,
    username: row.username,
    status: row.status,
    console_role_id: row.console_role_id,
  };
}

// Calls current_console_permissions() (00000000000012_enforce_console_rbac.sql)
// rather than querying console_role_permission directly. That table's own
// SELECT policy is intentionally left open to any active super_admin (see
// that migration's comment), but relying on a direct table query here would
// be one narrowing-of-that-policy away from silently breaking every scoped
// admin's own permission list again -- this RPC is SECURITY DEFINER and
// resolves auth.uid() server-side, so it doesn't depend on that policy at
// all. Only called when console_role_id is non-null -- null already means
// unrestricted and needs no permission list at all. Not yet in the
// generated types -- same temporary cast pattern as the other pre-deploy
// RPC/table additions in this PR set.
async function fetchConsolePermissions(): Promise<ConsolePermission[]> {
  const { data, error } = await (
    supabase.rpc as unknown as (fn: string) => Promise<{
      data: ConsolePermission[] | null;
      error: { message: string } | null;
    }>
  )("current_console_permissions");
  if (error || !data) return [];
  return data;
}

// Exported so login.tsx can populate the store with the full auth state in
// one call instead of duplicating the app_user query and always defaulting
// consolePermissions to [] -- a restricted-role super_admin logging in
// through the form would otherwise briefly (or, if the ambient
// USER_UPDATED listener's correction loses the race, indefinitely until
// reload) see every console section as denied.
export async function fetchAuthState(
  userId: string,
): Promise<{ appUser: AppUser | null; consolePermissions: ConsolePermission[] }> {
  const appUser = await fetchAppUser(userId);
  const consolePermissions = appUser?.console_role_id ? await fetchConsolePermissions() : [];
  return { appUser, consolePermissions };
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
      const { appUser, consolePermissions } = await fetchAuthState(sessionUser.id);
      if (!mounted) return;
      setAuth(sessionUser, appUser, consolePermissions);
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
          fetchAuthState(sessionUser.id).then(({ appUser, consolePermissions }) => {
            if (mounted) setAuth(sessionUser, appUser, consolePermissions);
          });
        }, 0);
        // record-login (last_login_at) is deliberately NOT fired from this
        // listener: SIGNED_IN also fires on tab-visibility recovery of an
        // existing session, and auth-js broadcasts it across every open tab
        // -- so "last login" would really mean "last tab focus", amplified by
        // tab count. login.tsx calls it directly, once, right after the
        // actual supabase.auth.signInWithPassword() call succeeds.
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [setAuth, clearAuth]);
}
