import { describe, expect, it } from "vitest";

import { base64UrlDecodeCanonical, isHighS } from "@/utils/harariCredentialCrypto";

const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sigWithS(s: bigint): Uint8Array {
  const out = new Uint8Array(64).fill(7);
  for (let i = 63; i >= 32; i--) {
    out[i] = Number(s & BigInt(0xff));
    s >>= BigInt(8);
  }
  return out;
}

describe("base64UrlDecodeCanonical (WP-CRY-001 trailing-bit variants)", () => {
  const sig = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 0xff);
  const canonical = b64url(sig);

  it("round-trips the canonical 86-character spelling", () => {
    expect(canonical).toHaveLength(86);
    expect(base64UrlDecodeCanonical(canonical)).toEqual(sig);
  });

  it("rejects every other last character that atob() would decode to the same bytes", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let variants = 0;
    for (const c of alphabet) {
      const t = canonical.slice(0, -1) + c;
      if (t === canonical) continue;
      const loose = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "==");
      const same = [...loose].every((ch, i) => ch.charCodeAt(0) === sig[i]);
      if (same) {
        variants++;
        expect(base64UrlDecodeCanonical(t)).toBeNull();
      }
    }
    expect(variants).toBe(15);
  });

  it("rejects padding, standard-base64 characters, whitespace and impossible lengths", () => {
    expect(base64UrlDecodeCanonical(canonical + "==")).toBeNull();
    expect(base64UrlDecodeCanonical("AB+C")).toBeNull();
    expect(base64UrlDecodeCanonical("AB/C")).toBeNull();
    expect(base64UrlDecodeCanonical(" " + canonical)).toBeNull();
    expect(base64UrlDecodeCanonical("A")).toBeNull();
  });
});

describe("isHighS", () => {
  it("splits at n/2", () => {
    const half = P256_N >> BigInt(1);
    expect(isHighS(sigWithS(half))).toBe(false);
    expect(isHighS(sigWithS(half + BigInt(1)))).toBe(true);
    expect(isHighS(sigWithS(BigInt(1)))).toBe(false);
    expect(isHighS(new Uint8Array(63))).toBe(false);
  });
});
