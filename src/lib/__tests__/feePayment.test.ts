import { describe, expect, it } from "vitest";

import { feePaymentArgs } from "@/lib/feePayment";

const id = "8c9b7f6e-1d2c-4b3a-9e8f-7a6b5c4d3e2f";

describe("feePaymentArgs", () => {
  it("sends no amount and maps a cash payment", () => {
    const a = feePaymentArgs({ entity: "credential_request", entityId: id, channel: "cash" });
    expect(a).toEqual({
      _entity: "credential_request",
      _entity_id: id,
      _channel: "cash",
      _reference_no: null,
      _waived: false,
      _waiver_reason: null,
    });
    expect(Object.keys(a)).not.toContain("_amount");
  });

  it("requires a reference for bank and mobile", () => {
    expect(() =>
      feePaymentArgs({ entity: "vital_event", entityId: id, channel: "bank", referenceNo: " " }),
    ).toThrow();
    expect(
      feePaymentArgs({
        entity: "vital_event",
        entityId: id,
        channel: "mobile",
        referenceNo: "TX-1",
      })._reference_no,
    ).toBe("TX-1");
  });

  it("a waiver needs a reason, records cash and drops the reference", () => {
    expect(() =>
      feePaymentArgs({ entity: "service_request", entityId: id, channel: "cash", waived: true }),
    ).toThrow();
    const a = feePaymentArgs({
      entity: "service_request",
      entityId: id,
      channel: "bank",
      referenceNo: "X",
      waived: true,
      waiverReason: "  hardship case ",
    });
    expect(a).toMatchObject({
      _channel: "cash",
      _reference_no: null,
      _waived: true,
      _waiver_reason: "hardship case",
    });
  });

  it("rejects an unknown entity or a malformed id", () => {
    expect(() =>
      feePaymentArgs({ entity: "payment" as never, entityId: id, channel: "cash" }),
    ).toThrow();
    expect(() =>
      feePaymentArgs({ entity: "vital_event", entityId: "1 OR 1=1", channel: "cash" }),
    ).toThrow();
  });
});
