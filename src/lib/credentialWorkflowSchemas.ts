import { z } from "zod";

/**
 * Task 12.5: structured reason enums + Zod schemas for the credential
 * workflow's stage transitions. Centralized here (rather than inline per
 * route, the pattern `woreda.credentials.new.tsx`'s own `formSchema` used
 * before this file existed) so the enum values, Amharic/English labels, and
 * validation rules for a given transition live in exactly one place —
 * `StageReturnDialog`-shaped UI in different stages was starting to drift
 * on what "a reason" even meant (free text vs. a fixed list) before this.
 */

export const RETURN_REASONS = [
  { value: "missing_document", labelAm: "ሰነድ ይጎድላል", labelEn: "Missing document" },
  { value: "name_mismatch", labelAm: "የስም አለመመሳሰል", labelEn: "Name mismatch" },
  { value: "address_mismatch", labelAm: "የአድራሻ አለመመሳሰል", labelEn: "Address mismatch" },
  { value: "photo_quality", labelAm: "የፎቶ ጥራት ችግር", labelEn: "Photo quality" },
  { value: "other", labelAm: "ሌላ", labelEn: "Other" },
] as const;
export type ReturnReasonCode = (typeof RETURN_REASONS)[number]["value"];

export const REPRINT_REASONS = [
  { value: "print_error", labelAm: "ህትመት ስህተት", labelEn: "Print error" },
  { value: "damaged_copy", labelAm: "ቆሻሻ ቅጂ", labelEn: "Damaged copy" },
  { value: "other", labelAm: "ሌላ", labelEn: "Other" },
] as const;
export type ReprintReasonCode = (typeof REPRINT_REASONS)[number]["value"];

/** Formats a picked reason code + optional free-text note into the single
 * `text` column these tables actually have (`return_reason`, `reject_reason`,
 * `revoked_reason`, `suspended_reason`, `reprint_reason`) — no schema change,
 * just a consistent "Label — note" shape instead of ad-hoc free text. */
export function formatStructuredReason(
  reasonSet: readonly { value: string; labelAm: string; labelEn: string }[],
  code: string,
  note: string,
): string {
  const picked = reasonSet.find((r) => r.value === code);
  const label = picked ? `${picked.labelAm} / ${picked.labelEn}` : code;
  const trimmedNote = note.trim();
  return trimmedNote ? `${label} — ${trimmedNote}` : label;
}

const reasonCodeSchema = (values: readonly [string, ...string[]]) => z.enum(values);

const RETURN_REASON_VALUES = RETURN_REASONS.map((r) => r.value) as [string, ...string[]];
const REPRINT_REASON_VALUES = REPRINT_REASONS.map((r) => r.value) as [string, ...string[]];

export const stageReturnSchema = z
  .object({
    reasonCode: reasonCodeSchema(RETURN_REASON_VALUES),
    note: z.string().max(2000),
  })
  .refine((v) => v.reasonCode !== "other" || v.note.trim().length >= 5, {
    path: ["note"],
    message: 'A note is required when the reason is "Other" (min 5 characters)',
  });
export type StageReturnValues = z.infer<typeof stageReturnSchema>;

export const rejectSchema = z.object({
  reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(2000),
});
export type RejectValues = z.infer<typeof rejectSchema>;

export const revokeSchema = z.object({
  reason: z.string().trim().min(5, "Revocation reason must be at least 5 characters").max(2000),
  reference: z.string().max(200).optional(),
});
export type RevokeValues = z.infer<typeof revokeSchema>;

export const suspendSchema = z.object({
  reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(2000),
});
export type SuspendValues = z.infer<typeof suspendSchema>;

export const paymentSchema = z
  .object({
    waived: z.boolean(),
    waiverReason: z.string().max(2000),
    channel: z.enum(["cash", "bank", "mobile", ""]),
    referenceNo: z.string().max(200),
  })
  .refine((v) => !v.waived || v.waiverReason.trim().length >= 5, {
    path: ["waiverReason"],
    message: "Waiver reason must be at least 5 characters",
  })
  .refine((v) => v.waived || v.channel !== "", {
    path: ["channel"],
    message: "Select a payment method",
  })
  .refine(
    (v) =>
      v.waived ||
      !(v.channel === "bank" || v.channel === "mobile") ||
      v.referenceNo.trim().length > 0,
    { path: ["referenceNo"], message: "Bank/mobile reference is required" },
  );
export type PaymentValues = z.infer<typeof paymentSchema>;

export const printConfirmSchema = z
  .object({
    printerName: z.string().trim().min(1, "Printer name is required"),
    copies: z.coerce.number().int().min(1, "At least 1 copy is required"),
    isReprint: z.boolean(),
    reprintReasonCode: reasonCodeSchema(REPRINT_REASON_VALUES).optional(),
    reprintNote: z.string().max(2000).optional(),
  })
  .refine((v) => !v.isReprint || !!v.reprintReasonCode, {
    path: ["reprintReasonCode"],
    message: "Select a reprint reason",
  })
  .refine(
    (v) =>
      !v.isReprint || v.reprintReasonCode !== "other" || (v.reprintNote ?? "").trim().length >= 5,
    { path: ["reprintNote"], message: 'A note is required when the reason is "Other"' },
  );
export type PrintConfirmValues = z.infer<typeof printConfirmSchema>;

/** Stage 1 intake, request-type-conditional rules (Task 12.5). Extends
 * `woreda.credentials.new.tsx`'s own `formSchema` in place rather than
 * replacing it — this only adds the two rules that schema didn't have yet. */
export const POLICE_REPORT_REQUIRED_TYPES = new Set(["reissue_stolen"]);
export const CORRECTION_FIELD_OPTIONS = [
  { value: "full_name", labelAm: "ሙሉ ስም", labelEn: "Full name" },
  { value: "date_of_birth", labelAm: "የትውልድ ቀን", labelEn: "Date of birth" },
  { value: "address", labelAm: "አድራሻ", labelEn: "Address" },
  { value: "photo", labelAm: "ፎቶ", labelEn: "Photo" },
  { value: "other", labelAm: "ሌላ", labelEn: "Other" },
] as const;

export const intakeConditionalSchema = z
  .object({
    request_type: z.string(),
    police_report_number: z.string().max(100).optional().nullable(),
    correction_fields: z.array(z.string()).optional(),
    correction_reason: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (v) => !POLICE_REPORT_REQUIRED_TYPES.has(v.request_type) || !!v.police_report_number?.trim(),
    { path: ["police_report_number"], message: "Police report number is required" },
  )
  .refine(
    (v) => v.request_type !== "reissue_correction" || (v.correction_fields?.length ?? 0) > 0,
    {
      path: ["correction_fields"],
      message: "Select at least one field to correct",
    },
  )
  .refine((v) => v.request_type !== "reissue_correction" || !!v.correction_reason?.trim(), {
    path: ["correction_reason"],
    message: "A reason is required for a correction",
  });
