import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore, type AppUser } from "@/stores/authStore";
import type { ConsolePermission, Role } from "@/config/permissions";

async function fetchAppUser(userId: string): Promise<AppUser | null> {
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

// Mirrors user_has_console_perm()'s own JOIN: only rows for an active role
// count, so a disabled console_role grants nothing client-side either, same
// as the DB-side check. Only called when console_role_id is non-null --
// null already means unrestricted and needs no permission list at all.
//
// console_role_permission is a wholly new table, absent from the generated
// types entirely (not just a missing column), so .from() itself fails to
// resolve an overload -- cast the client for this one call rather than the
// query result, same intent as the other pre-deploy casts in this PR set.
async function fetchConsolePermissions(consoleRoleId: string): Promise<ConsolePermission[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("console_role_permission")
    .select("permission_key, is_granted, console_role:console_role_id ( is_active )")
    .eq("console_role_id", consoleRoleId)
    .eq("is_granted", true);
  if (error || !data) return [];
  return (
    data as unknown as {
      permission_key: ConsolePermission;
      console_role: { is_active: boolean } | null;
    }[]
  )
    .filter((row) => row.console_role?.is_active)
    .map((row) => row.permission_key);
}

async function fetchAuthState(
  userId: string,
): Promise<{ appUser: AppUser | null; consolePermissions: ConsolePermission[] }> {
  const appUser = await fetchAppUser(userId);
  const consolePermissions = appUser?.console_role_id
    ? await fetchConsolePermissions(appUser.console_role_id)
    : [];
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
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [setAuth, clearAuth]);
}
