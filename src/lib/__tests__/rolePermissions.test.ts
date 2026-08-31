import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryBuilderMock } from "@/test/supabaseMock";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { upsertRolePermission } from "@/lib/rolePermissions";

describe("upsertRolePermission (F5 regression lock)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("upserts on the (woreda, role, permission) conflict target instead of a bare update", async () => {
    // This is the exact fail-before/pass-after scenario: toggling a
    // permission key with no existing role_permission row. A plain `.update()`
    // would match zero rows and still return error: null (F5's bug); a row
    // now exists in the mocked "table" only because upsert was called.
    const builder = createQueryBuilderMock({ data: [{ woreda_id: "w1" }], error: null });
    fromMock.mockReturnValue(builder);

    const { error } = await upsertRolePermission("w1", "registry_clerk", "rental.approve", true);

    expect(error).toBeNull();
    expect(fromMock).toHaveBeenCalledWith("role_permission");
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        woreda_id: "w1",
        role_name: "registry_clerk",
        permission_key: "rental.approve",
        is_granted: true,
      },
      { onConflict: "woreda_id,role_name,permission_key" },
    );
    // The regression this guards against: a bare .update() must never be
    // used for this write again.
    expect(builder.update).not.toHaveBeenCalled();
  });

  it("surfaces a real database error rather than swallowing it", async () => {
    const builder = createQueryBuilderMock({
      data: null,
      error: { message: "permission denied for table role_permission" },
    });
    fromMock.mockReturnValue(builder);

    const { error } = await upsertRolePermission("w1", "registry_clerk", "rental.approve", true);

    expect(error).toEqual({ message: "permission denied for table role_permission" });
  });
});
