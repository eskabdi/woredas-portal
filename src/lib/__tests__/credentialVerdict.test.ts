import { describe, expect, it } from "vitest";

import { credentialVerdict, verdictTone, type VerdictInput } from "@/lib/credentialVerdict";

const base: VerdictInput = {
  signatureValid: true,
  payloadExpired: false,
  registryAnswered: true,
  registryStatus: "active",
};

function v(over: Partial<VerdictInput>) {
  return credentialVerdict({ ...base, ...over });
}

describe("credentialVerdict (WP-CRY-001/002: fail closed)", () => {
  it("is green only for an active, unexpired card the registry knows", () => {
    expect(v({})).toBe("verified");
    expect(verdictTone(v({}))).toBe("green");
  });

  it("never returns verified for any other input", () => {
    const statuses = [
      null,
      "invalid",
      "revoked",
      "suspended",
      "replaced",
      "expired",
      "printed",
      "printing",
      "ready_to_print",
      "draft",
      "???",
    ];
    for (const registryStatus of statuses) {
      for (const payloadExpired of [false, true]) {
        for (const registryAnswered of [false, true]) {
          for (const signatureValid of [false, true]) {
            const out = credentialVerdict({
              signatureValid,
              payloadExpired,
              registryAnswered,
              registryStatus,
            });
            expect(out).not.toBe("verified");
          }
        }
      }
    }
    expect(v({ payloadExpired: true })).toBe("expired");
    expect(v({ registryAnswered: false })).toBe("status_unknown");
    expect(v({ signatureValid: false })).toBe("invalid_signature");
  });

  it("treats a card the registry does not know as red, not green (the old fall-through)", () => {
    expect(v({ registryStatus: null })).toBe("not_found");
    expect(verdictTone("not_found")).toBe("red");
  });

  it("treats an unreachable registry as amber status-unknown", () => {
    expect(v({ registryAnswered: false, registryStatus: null })).toBe("status_unknown");
    expect(verdictTone("status_unknown")).toBe("amber");
    expect(v({ registryAnswered: false, payloadExpired: true })).toBe("expired");
  });

  it("keeps a withdrawn card red even after its expiry date (staff see the real status)", () => {
    for (const s of ["revoked", "suspended", "replaced"]) {
      expect(v({ registryStatus: s, payloadExpired: true })).toBe("withdrawn");
    }
  });

  it("reads the anonymous 'invalid' collapse as expired only when the signed payload says so", () => {
    expect(v({ registryStatus: "invalid" })).toBe("withdrawn");
    expect(v({ registryStatus: "invalid", payloadExpired: true })).toBe("expired");
  });

  it("keeps not-yet-issued and uncollected cards amber", () => {
    expect(v({ registryStatus: "ready_to_print" })).toBe("not_issued");
    expect(v({ registryStatus: "printing" })).toBe("not_issued");
    expect(v({ registryStatus: "printed" })).toBe("printed_not_collected");
    expect(verdictTone("printed_not_collected")).toBe("amber");
  });
});
