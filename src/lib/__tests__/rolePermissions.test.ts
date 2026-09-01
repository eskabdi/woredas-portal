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
    const builder = createQueryBuilderMock({
      data: { woreda_id: "w1", role_name: "registry_clerk", permission_key: "rental.approve" },
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { data, error } = await upsertRolePermission(
      "w1",
      "registry_clerk",
      "rental.approve",
      true,
      "u1",
    );

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(fromMock).toHaveBeenCalledWith("role_permission");
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        woreda_id: "w1",
        role_name: "registry_clerk",
        permission_key: "rental.approve",
        is_granted: true,
        updated_by: "u1",
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

    const { error } = await upsertRolePermission(
      "w1",
      "registry_clerk",
      "rental.approve",
      true,
      "u1",
    );

    expect(error).toEqual({ message: "permission denied for table role_permission" });
  });

  it("treats a null row back from the upsert as a row-verification failure (access review)", async () => {
    // A silently RLS-filtered upsert: error is null, but no row was actually
    // written or updated. The caller must not log an audit_log entry for this.
    const builder = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { data, error } = await upsertRolePermission(
      "w1",
      "registry_clerk",
      "rental.approve",
      true,
      "u1",
    );

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
