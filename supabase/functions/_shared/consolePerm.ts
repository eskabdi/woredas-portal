// Console-permission (CP key) check for a super_admin caller, server-side
// (P1-7, WP-AZ-001). The console UI gates each screen on a CP key, but a
// scoped super_admin's JWT reaches these functions directly -- so every
// function that accepts a super_admin caller re-checks the matching key here.
//
// Must be called with a client carrying the CALLER's own JWT (never the
// service-role client): user_has_console_perm() resolves auth.uid(), which is
// NULL under service_role and would always answer false. NULL console role =
// unrestricted super_admin, so unscoped admins pass every key.
//
// FAIL-CLOSED, unlike checkRateLimit(): an RPC error denies. This is an
// authorization gate, not an abuse brake.

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export const CONSOLE_PERM = {
  TENANTS_MANAGE: "console.tenants.manage",
  USERS_MANAGE: "console.users.manage",
  CONSOLE_USERS_MANAGE: "console.console_users.manage",
} as const;

/** True when the caller holds at least one of `keys`. */
export async function hasAnyConsolePerm(
  userClient: RpcClient,
  keys: readonly string[],
): Promise<boolean> {
  for (const key of keys) {
    try {
      const { data, error } = await userClient.rpc("user_has_console_perm", { _perm: key });
      if (error) {
        console.error("consolePerm: user_has_console_perm failed", error);
        return false;
      }
      if (data === true) return true;
    } catch (e) {
      console.error("consolePerm: user_has_console_perm threw", e);
      return false;
    }
  }
  return false;
}
