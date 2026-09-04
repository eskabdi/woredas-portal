import { describe, expect, it } from "vitest";
import {
  applyPhoneDigitsChange,
  isValidPhoneDigits,
  phoneDigitsToE164,
  sanitizePhoneDigits,
} from "@/lib/phoneNumber";

/** Simulates a controlled <PhoneDigitsInput>: each keystroke's raw DOM value
 * is the previous sanitized state plus the newly typed character. */
function typeKeystrokes(keys: string): string {
  let value = "";
  for (const key of keys) {
    value = applyPhoneDigitsChange(value, value + key);
  }
  return value;
}

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

describe("applyPhoneDigitsChange (keystroke-by-keystroke, not just whole-string paste)", () => {
  it("matches a one-shot sanitize when typed digit by digit", () => {
    expect(typeKeystrokes("911234567")).toBe("911234567");
  });

  it("trims a leading 0 typed digit by digit, without mangling digits that happen to spell 251 partway through", () => {
    // Regression: naively re-running sanitizePhoneDigits on the whole
    // accumulated value on every keystroke used to strip an extra "251"
    // the moment the growing string passed through that substring right
    // after the leading 0 was stripped, silently eating 3 real digits.
    expect(typeKeystrokes("0251234567")).toBe("251234567");
  });

  it("still strips a pasted 251/0 prefix in one shot, matching sanitizePhoneDigits", () => {
    expect(applyPhoneDigitsChange("", "0251234567")).toBe(sanitizePhoneDigits("0251234567"));
    expect(applyPhoneDigitsChange("", "+251911234567")).toBe(sanitizePhoneDigits("+251911234567"));
  });

  it("does not re-strip a 251-shaped substring appearing after existing digits", () => {
    // "9" then "251..." typed after it -- the 251 here is just part of the
    // number, not a country code, and must never be treated as one once the
    // field already has content.
    expect(typeKeystrokes("9251123456")).toBe("9251123456");
  });

  it("strips a select-all-and-paste correction, even when the replacement is the same length", () => {
    // Regression: a length-delta ">1" check only caught pastes that grew
    // the field. Selecting an existing 9-digit value and pasting a
    // same-length replacement that still carries a 251/0 prefix produced no
    // net length change, so the strip never ran and a wrong-but-9-digit
    // value silently passed validation.
    expect(applyPhoneDigitsChange("911234567", "251911234")).toBe(sanitizePhoneDigits("251911234"));
  });

  it("strips a select-all-and-paste correction that makes the field shorter", () => {
    expect(applyPhoneDigitsChange("911234567", "0912345")).toBe(sanitizePhoneDigits("0912345"));
  });

  it("leaves a plain backspace delete unaffected", () => {
    // Deleting the trailing digit re-runs the full sanitizer (any delta
    // other than +1 does), but a value built up through normal typing can
    // never itself start with 0/251 -- see the invariant this relies on in
    // applyPhoneDigitsChange's own doc comment -- so the result is
    // unchanged either way.
    expect(applyPhoneDigitsChange("911234567", "91123456")).toBe("91123456");
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
