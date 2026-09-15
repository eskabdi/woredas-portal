import { FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import { invokeEdgeFunction } from "@/lib/edgeFunction";

describe("invokeEdgeFunction (F1 regression lock)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("surfaces the function's own JSON error body, never the library's generic string", async () => {
    const fakeResponse = {
      json: async () => ({ error: "Cannot provision this role through tenant self-service." }),
    } as Response;
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(fakeResponse) });

    const result = await invokeEdgeFunction("invite-tenant-user", { email: "x@example.com" });

    expect(result.data).toBeNull();
    expect(result.friendlyError).not.toBe("Edge Function returned a non-2xx status code");
    expect(result.friendlyError).toContain(
      "This role can't be assigned this way — ask your tenant administrator",
    );
  });

  it("falls back to the generic message when the error body isn't JSON", async () => {
    const fakeResponse = {
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response;
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(fakeResponse) });

    const result = await invokeEdgeFunction("invite-tenant-user", {});

    expect(result.friendlyError).toContain("Something went wrong");
  });

  it("passes through data unchanged on success", async () => {
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });

    const result = await invokeEdgeFunction<{ success: boolean }>("invite-tenant-user", {});

    expect(result.friendlyError).toBeNull();
    expect(result.data).toEqual({ success: true });
  });
});
