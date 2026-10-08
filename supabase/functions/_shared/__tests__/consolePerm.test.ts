import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CP } from "../../../../src/config/permissions";
import { CONSOLE_PERM, hasAnyConsolePerm } from "../consolePerm";

type RpcResult = { data: unknown; error: unknown };

function client(answers: Record<string, RpcResult | Error>) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    expect(fn).toBe("user_has_console_perm");
    const a = answers[args._perm as string];
    if (a instanceof Error) throw a;
    return a ?? { data: false, error: null };
  });
  return { rpc };
}

describe("hasAnyConsolePerm", () => {
  it("allows when any one key is granted", async () => {
    const c = client({ [CONSOLE_PERM.USERS_MANAGE]: { data: true, error: null } });
    await expect(
      hasAnyConsolePerm(c, [CONSOLE_PERM.TENANTS_MANAGE, CONSOLE_PERM.USERS_MANAGE]),
    ).resolves.toBe(true);
  });

  it("denies when no key is granted", async () => {
    const c = client({});
    await expect(
      hasAnyConsolePerm(c, [CONSOLE_PERM.TENANTS_MANAGE, CONSOLE_PERM.USERS_MANAGE]),
    ).resolves.toBe(false);
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed on an RPC error, even if a later key would pass", async () => {
    const c = client({
      [CONSOLE_PERM.TENANTS_MANAGE]: { data: null, error: { message: "boom" } },
      [CONSOLE_PERM.USERS_MANAGE]: { data: true, error: null },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      hasAnyConsolePerm(c, [CONSOLE_PERM.TENANTS_MANAGE, CONSOLE_PERM.USERS_MANAGE]),
    ).resolves.toBe(false);
  });

  it("fails closed when the RPC throws", async () => {
    const c = client({ [CONSOLE_PERM.TENANTS_MANAGE]: new Error("network") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(hasAnyConsolePerm(c, [CONSOLE_PERM.TENANTS_MANAGE])).resolves.toBe(false);
  });

  it("treats only a literal true as granted", async () => {
    const c = client({ [CONSOLE_PERM.TENANTS_MANAGE]: { data: "true", error: null } });
    await expect(hasAnyConsolePerm(c, [CONSOLE_PERM.TENANTS_MANAGE])).resolves.toBe(false);
  });

  it("denies an empty key list", async () => {
    await expect(hasAnyConsolePerm(client({}), [])).resolves.toBe(false);
  });
});

describe("CONSOLE_PERM", () => {
  it("matches the client CP keys", () => {
    expect(CONSOLE_PERM.TENANTS_MANAGE).toBe(CP.TENANTS_MANAGE);
    expect(CONSOLE_PERM.USERS_MANAGE).toBe(CP.USERS_MANAGE);
    expect(CONSOLE_PERM.CONSOLE_USERS_MANAGE).toBe(CP.CONSOLE_USERS_MANAGE);
  });

  it("every Edge Function that accepts a super_admin caller checks a console key", () => {
    const fns = [
      "invite-tenant-user",
      "invite-platform-admin",
      "resend-platform-invite",
      "resend-tenant-invite",
      "send-password-reset-link",
      "sign-credential",
    ];
    for (const fn of fns) {
      const src = readFileSync(join(__dirname, "..", "..", fn, "index.ts"), "utf8");
      expect(src, fn).toMatch(/hasAnyConsolePerm\(userClient,/);
    }
  });
});
