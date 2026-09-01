import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { P, ROLE_PERMISSIONS } from "@/config/permissions";

const appUser = {
  user_id: "u1",
  woreda_id: "w1",
  role: "registry_clerk" as const,
  full_name: "Test User",
  username: "test",
  status: "active",
  console_role_id: null,
};

describe("authStore.hasPermission (F7 regression lock)", () => {
  beforeEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("resolves permissions from a current_permissions()-shaped list, not just ROLE_PERMISSIONS", () => {
    // A tenant admin has customized this role to grant approval.queue.view
    // even though the compiled default for registry_clerk includes it --
    // this asserts the store actually reads the fetched list, not the
    // hardcoded map, by handing it something the map alone wouldn't produce
    // on its own: an explicit, distinct resolved list.
    const resolved = [P.RESIDENT_READ, P.APPROVAL_QUEUE_VIEW];
    useAuthStore.getState().setAuth(null, appUser, [], resolved);

    expect(useAuthStore.getState().hasPermission(P.RESIDENT_READ)).toBe(true);
    expect(useAuthStore.getState().hasPermission(P.APPROVAL_QUEUE_VIEW)).toBe(true);
    // Absent from the resolved list -- proves hasPermission reads
    // `permissions` directly rather than falling through to
    // ROLE_PERMISSIONS[role] whenever a lookup misses.
    expect(useAuthStore.getState().hasPermission(P.TENANT_MANAGE)).toBe(false);
  });

  it("falls back to the compiled-in default when no resolved list is supplied", () => {
    useAuthStore.getState().setAuth(null, appUser, []);

    const expected = ROLE_PERMISSIONS.registry_clerk ?? [];
    for (const perm of expected) {
      expect(useAuthStore.getState().hasPermission(perm)).toBe(true);
    }
  });
});
