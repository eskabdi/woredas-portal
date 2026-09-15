import { FunctionsHttpError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createQueryBuilderMock, createSupabaseMock } from "./supabaseMock";

// These two are the harness's own proof-of-life, not regression locks for a
// real finding — they exist so later phases (F1, F5, ...) have a worked
// example of each mock shape to build their actual regression tests on,
// per the F13 remediation task's "one example test per pattern" deliverable.

describe("supabase mock harness", () => {
  it("mocks a rejected functions.invoke() as a real FunctionsHttpError", async () => {
    const supabase = createSupabaseMock();
    const fakeResponse = {
      json: async () => ({ error: "Cannot provision this role through tenant self-service." }),
    } as Response;
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeResponse),
    });

    const { data, error } = await supabase.functions.invoke("invite-tenant-user", {
      body: { email: "x@example.com" },
    });

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(FunctionsHttpError);
    const body = await (error as FunctionsHttpError).context.json();
    expect(body.error).toBe("Cannot provision this role through tenant self-service.");
  });

  it("mocks an .update() that matches zero rows but still returns error: null", async () => {
    const supabase = createSupabaseMock();
    // This is F5's exact bug shape: PostgREST returns error: null whether the
    // WHERE clause matched one row or zero, so a bare .update() can't tell
    // the difference between "saved" and "silently touched nothing".
    const builder = createQueryBuilderMock({ data: null, error: null });
    supabase.from.mockReturnValue(builder);

    const { error } = await supabase
      .from("role_permission")
      .update({ is_granted: true })
      .eq("woreda_id", "w1")
      .eq("role_name", "registry_clerk")
      .eq("permission_key", "rental.approve");

    expect(error).toBeNull();
    expect(builder.eq).toHaveBeenCalledTimes(3);
  });
});
