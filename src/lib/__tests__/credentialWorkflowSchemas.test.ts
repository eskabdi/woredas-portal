import { describe, expect, it } from "vitest";
import {
  formatStructuredReason,
  RETURN_REASONS,
  stageReturnSchema,
  rejectSchema,
  revokeSchema,
  paymentSchema,
  printConfirmSchema,
  intakeConditionalSchema,
} from "../credentialWorkflowSchemas";

describe("formatStructuredReason", () => {
  it("formats a picked reason without a note", () => {
    expect(formatStructuredReason(RETURN_REASONS, "missing_document", "")).toBe(
      "ሰነድ ይጎድላል / Missing document",
    );
  });

  it("appends a trimmed note when provided", () => {
    expect(formatStructuredReason(RETURN_REASONS, "photo_quality", "  blurry  ")).toBe(
      "የፎቶ ጥራት ችግር / Photo quality — blurry",
    );
  });

  it("falls back to the raw code if it isn't in the reason set", () => {
    expect(formatStructuredReason(RETURN_REASONS, "unknown_code", "")).toBe("unknown_code");
  });
});

describe("stageReturnSchema", () => {
  it("accepts a non-'other' reason with no note", () => {
    expect(stageReturnSchema.safeParse({ reasonCode: "name_mismatch", note: "" }).success).toBe(
      true,
    );
  });

  it("requires a note (min 5 chars) when reasonCode is 'other'", () => {
    expect(stageReturnSchema.safeParse({ reasonCode: "other", note: "" }).success).toBe(false);
    expect(stageReturnSchema.safeParse({ reasonCode: "other", note: "abcd" }).success).toBe(false);
    expect(stageReturnSchema.safeParse({ reasonCode: "other", note: "abcde" }).success).toBe(true);
  });

  it("rejects an unknown reason code", () => {
    expect(stageReturnSchema.safeParse({ reasonCode: "made_up", note: "" }).success).toBe(false);
  });
});

describe("rejectSchema / revokeSchema", () => {
  it("requires a minimum-length reason", () => {
    expect(rejectSchema.safeParse({ reason: "ab" }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "valid reason" }).success).toBe(true);
  });

  it("revoke reason has its own minimum and an optional reference", () => {
    expect(revokeSchema.safeParse({ reason: "abcd" }).success).toBe(false);
    expect(revokeSchema.safeParse({ reason: "abcde" }).success).toBe(true);
    expect(revokeSchema.safeParse({ reason: "abcde", reference: "REF-1" }).success).toBe(true);
  });
});

describe("paymentSchema", () => {
  it("requires a waiver reason (min 5 chars) when waived", () => {
    const base = { waived: true, waiverReason: "", channel: "" as const, referenceNo: "" };
    expect(paymentSchema.safeParse(base).success).toBe(false);
    expect(paymentSchema.safeParse({ ...base, waiverReason: "valid" }).success).toBe(true);
  });

  it("requires a channel when not waived", () => {
    const base = { waived: false, waiverReason: "", channel: "" as const, referenceNo: "" };
    expect(paymentSchema.safeParse(base).success).toBe(false);
    expect(paymentSchema.safeParse({ ...base, channel: "cash" as const }).success).toBe(true);
  });

  it("requires a reference number for bank/mobile, not cash", () => {
    const bank = { waived: false, waiverReason: "", channel: "bank" as const, referenceNo: "" };
    expect(paymentSchema.safeParse(bank).success).toBe(false);
    expect(paymentSchema.safeParse({ ...bank, referenceNo: "REF-1" }).success).toBe(true);
    const cash = { waived: false, waiverReason: "", channel: "cash" as const, referenceNo: "" };
    expect(paymentSchema.safeParse(cash).success).toBe(true);
  });
});

describe("printConfirmSchema", () => {
  it("requires printer name and at least 1 copy", () => {
    const base = { printerName: "", copies: 0, isReprint: false };
    expect(printConfirmSchema.safeParse(base).success).toBe(false);
    expect(printConfirmSchema.safeParse({ ...base, printerName: "HP1", copies: 1 }).success).toBe(
      true,
    );
  });

  it("requires a reprint reason code when isReprint is true", () => {
    const base = { printerName: "HP1", copies: 1, isReprint: true };
    expect(printConfirmSchema.safeParse(base).success).toBe(false);
    expect(
      printConfirmSchema.safeParse({ ...base, reprintReasonCode: "print_error" }).success,
    ).toBe(true);
  });

  it("requires a note when the reprint reason is 'other'", () => {
    const base = {
      printerName: "HP1",
      copies: 1,
      isReprint: true,
      reprintReasonCode: "other" as const,
    };
    expect(printConfirmSchema.safeParse(base).success).toBe(false);
    expect(printConfirmSchema.safeParse({ ...base, reprintNote: "valid" }).success).toBe(true);
  });
});

describe("intakeConditionalSchema", () => {
  it("requires a police report number for reissue_stolen only", () => {
    expect(intakeConditionalSchema.safeParse({ request_type: "reissue_stolen" }).success).toBe(
      false,
    );
    expect(
      intakeConditionalSchema.safeParse({
        request_type: "reissue_stolen",
        police_report_number: "PR-1",
      }).success,
    ).toBe(true);
    expect(intakeConditionalSchema.safeParse({ request_type: "new_issue" }).success).toBe(true);
  });

  it("requires correction_fields and correction_reason for reissue_correction only", () => {
    expect(intakeConditionalSchema.safeParse({ request_type: "reissue_correction" }).success).toBe(
      false,
    );
    expect(
      intakeConditionalSchema.safeParse({
        request_type: "reissue_correction",
        correction_fields: ["full_name"],
        correction_reason: "typo",
      }).success,
    ).toBe(true);
    expect(intakeConditionalSchema.safeParse({ request_type: "renewal" }).success).toBe(true);
  });
});
