import { describe, expect, it } from "vitest";

import { approvalBlock } from "@/lib/makerChecker";

describe("approvalBlock (mirror of migration 107)", () => {
  it("lets a third person approve", () => {
    expect(approvalBlock("approver", "verifier", "maker")).toBeNull();
  });
  it("blocks the verifier", () => {
    expect(approvalBlock("v", "v", "maker")).toBe("verifier");
  });
  it("blocks the requester", () => {
    expect(approvalBlock("m", "v", "m")).toBe("requester");
  });
  it("blocks an approval with no verification on record", () => {
    expect(approvalBlock("a", null, "m")).toBe("unverified");
  });
  it("does not decide before the user is known", () => {
    expect(approvalBlock(null, "v", "m")).toBeNull();
  });
});
