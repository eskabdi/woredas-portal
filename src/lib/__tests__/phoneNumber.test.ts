import { describe, expect, it } from "vitest";
import { isValidPhoneDigits, phoneDigitsToE164, sanitizePhoneDigits } from "@/lib/phoneNumber";

describe("sanitizePhoneDigits", () => {
  it("strips non-digit characters", () => {
    expect(sanitizePhoneDigits("091 123 4567")).toBe("911234567");
  });

  it("trims a single leading 0 (local dialling prefix)", () => {
    expect(sanitizePhoneDigits("0911234567")).toBe("911234567");
  });

  it("does not trim a leading 0 that isn't the very first character", () => {
    expect(sanitizePhoneDigits("911034567")).toBe("911034567");
  });

  it("strips a typed or pasted 251 country code without its +", () => {
    expect(sanitizePhoneDigits("+251911234567")).toBe("911234567");
    expect(sanitizePhoneDigits("251911234567")).toBe("911234567");
  });

  it("does not truncate an overlong result -- validation must see the real length", () => {
    expect(sanitizePhoneDigits("09112345678")).toBe("9112345678"); // 10 digits, still too long
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizePhoneDigits("")).toBe("");
  });
});

describe("isValidPhoneDigits", () => {
  it("accepts an empty string (every phone field in this app is optional)", () => {
    expect(isValidPhoneDigits("")).toBe(true);
  });

  it("accepts exactly 9 digits", () => {
    expect(isValidPhoneDigits("911234567")).toBe(true);
  });

  it("rejects fewer than 9 digits", () => {
    expect(isValidPhoneDigits("91123456")).toBe(false);
  });

  it("rejects more than 9 digits", () => {
    expect(isValidPhoneDigits("9112345678")).toBe(false);
  });

  it("rejects non-digit characters slipping through", () => {
    expect(isValidPhoneDigits("91123456a")).toBe(false);
  });
});

describe("phoneDigitsToE164", () => {
  it("prefixes valid digits with +251", () => {
    expect(phoneDigitsToE164("911234567")).toBe("+251911234567");
  });

  it("returns null for an empty value instead of a bare +251", () => {
    expect(phoneDigitsToE164("")).toBeNull();
  });
});
