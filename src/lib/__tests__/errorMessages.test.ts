import { describe, expect, it } from "vitest";
import { translateError } from "@/lib/errorMessages";

describe("translateError (F9 regression lock)", () => {
  it("returns Amharic-first bilingual copy for the report's own reviewed examples", () => {
    expect(translateError("User already registered")).toContain("ይህ ኢሜይል ቀድሞ ተመዝግቧል");
    expect(translateError("User already registered")).toContain("This email is already registered");
  });

  it("never surfaces the raw library string, even as the generic fallback", () => {
    const message = translateError("Edge Function returned a non-2xx status code");
    expect(message).not.toBe("Edge Function returned a non-2xx status code");
    expect(message).toContain("Something went wrong");
  });

  it("falls back to the (bilingual) generic message for an unrecognized string", () => {
    expect(translateError("some string no function actually throws")).toContain(
      "Something went wrong",
    );
  });

  it("falls back to the generic message for null/undefined", () => {
    expect(translateError(null)).toContain("Something went wrong");
    expect(translateError(undefined)).toContain("Something went wrong");
  });
});
