import { describe, expect, it } from "vitest";

import { certificateVerifyUrl } from "@/config/certificateVerify";

describe("certificateVerifyUrl", () => {
  it("points at the public certificate verify route on the configured origin", () => {
    const url = certificateVerifyUrl("ABCDEFGHJKLMNPQRSTUVWXYZ23");
    expect(url).toMatch(/^https?:\/\/[^/]+\/verify\/certificate\/ABCDEFGHJKLMNPQRSTUVWXYZ23$/);
    expect(url).not.toContain("localhost:5173");
  });
});
