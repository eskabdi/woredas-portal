import { describe, expect, it } from "vitest";
import { parseAuthRedirect } from "@/lib/authRedirect";

describe("parseAuthRedirect (F12 regression lock)", () => {
  it("parses a plain visit as none", () => {
    expect(parseAuthRedirect("", "")).toEqual({ kind: "none" });
  });

  it("parses an invite token_hash link", () => {
    expect(parseAuthRedirect("?token_hash=abc123&type=invite", "")).toEqual({
      kind: "invite",
      tokenHash: "abc123",
    });
  });

  it("parses a recovery token_hash link -- F12's new shape", () => {
    expect(parseAuthRedirect("?token_hash=xyz789&type=recovery", "")).toEqual({
      kind: "recovery",
      tokenHash: "xyz789",
    });
  });

  it("ignores a token_hash with an unrecognized type", () => {
    expect(parseAuthRedirect("?token_hash=abc123&type=magiclink", "")).toEqual({ kind: "none" });
  });

  it("parses an error in the query string", () => {
    expect(parseAuthRedirect("?error=access_denied&error_description=Link+expired", "")).toEqual({
      kind: "error",
      description: "Link expired",
    });
  });

  it("parses an error in the hash fragment", () => {
    expect(parseAuthRedirect("", "#error=access_denied&error_description=Link+expired")).toEqual({
      kind: "error",
      description: "Link expired",
    });
  });

  it("treats an error as taking precedence over a token_hash", () => {
    expect(
      parseAuthRedirect("?token_hash=abc&type=recovery&error=access_denied", ""),
    ).toMatchObject({ kind: "error" });
  });
});
