import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryBuilderMock } from "@/test/supabaseMock";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import {
  clearAllUserOverrides,
  clearUserOverride,
  fetchUserOverrides,
  upsertUserOverride,
} from "@/lib/userPermissionOverrides";

describe("userPermissionOverrides (F3)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("fetches only this user's overrides", async () => {
    const builder = createQueryBuilderMock({
      data: [{ permission_key: "rental.approve", is_granted: true }],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const rows = await fetchUserOverrides("u1");

    expect(fromMock).toHaveBeenCalledWith("user_permission_override");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(rows).toEqual([{ permission_key: "rental.approve", is_granted: true }]);
  });

  it("upserts without sending woreda_id -- the DB trigger always re-derives it", async () => {
    const builder = createQueryBuilderMock({ data: { user_id: "u1" }, error: null });
    fromMock.mockReturnValue(builder);

    const { error } = await upsertUserOverride("u1", "rental.approve", true);

    expect(error).toBeNull();
    const [payload, opts] = builder.upsert.mock.calls[0];
    expect(payload).toEqual({ user_id: "u1", permission_key: "rental.approve", is_granted: true });
    expect(payload).not.toHaveProperty("woreda_id");
    expect(opts).toEqual({ onConflict: "user_id,permission_key" });
  });

  it("treats a null row back from the upsert as a row-verification failure (F6 house rule)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { data, error } = await upsertUserOverride("u1", "rental.approve", true);

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("clears a single override by (user_id, permission_key)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    await clearUserOverride("u1", "rental.approve");

    expect(builder.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(builder.eq).toHaveBeenCalledWith("permission_key", "rental.approve");
  });

  it("clears every override for a user in one call (role-change flow)", async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    await clearAllUserOverrides("u1");

    expect(builder.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(builder.eq).toHaveBeenCalledTimes(1);
  });
});
