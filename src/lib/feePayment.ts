/**
 * Client side of record_fee_payment() (migration 108, P1-12): the one way a
 * fee is recorded for an ID card request, a civil registration event or a
 * service letter. The database resolves the fee, raises
 * approved -> awaiting_payment when needed, writes the payment and its
 * receipt, moves the request to paid and writes the audit (and status
 * history) rows, all in one transaction. A repeated call on a request that
 * is already paid returns the existing payment (already_recorded: true), so
 * a double click or an offline replay never creates a second payment.
 *
 * The amount is never sent: it is resolved server-side.
 */
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";

export type FeeEntity = "credential_request" | "vital_event" | "service_request";

export interface FeePaymentResult {
  payment_id: string;
  receipt_id: string;
  receipt_number: string;
  amount: number;
  waived: boolean;
  status: string;
  already_recorded: boolean;
}

export const feePaymentInput = z
  .object({
    entity: z.enum(["credential_request", "vital_event", "service_request"]),
    entityId: z.string().uuid(),
    channel: z.enum(["cash", "bank", "mobile"]),
    referenceNo: z.string().trim().max(100).nullish(),
    waived: z.boolean().default(false),
    waiverReason: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.waived) {
      if (!v.waiverReason || v.waiverReason.length < 5) {
        ctx.addIssue({
          code: "custom",
          path: ["waiverReason"],
          message: "የስረዛ ምክንያት ያስፈልጋል / A waiver needs a reason of at least 5 characters",
        });
      }
    } else if (v.channel !== "cash" && !v.referenceNo) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceNo"],
        message: "የክፍያ ማጣቀሻ ያስገቡ / Enter the bank or mobile payment reference",
      });
    }
  });

export type FeePaymentInput = z.input<typeof feePaymentInput>;

/** The RPC's arguments, after allow-list validation. */
export function feePaymentArgs(input: FeePaymentInput) {
  const parsed = feePaymentInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid payment details");
  }
  const v = parsed.data;
  return {
    _entity: v.entity,
    _entity_id: v.entityId,
    _channel: v.waived ? "cash" : v.channel,
    _reference_no: v.waived ? null : v.referenceNo || null,
    _waived: v.waived,
    _waiver_reason: v.waived ? (v.waiverReason ?? null) : null,
  };
}

// record_fee_payment is newer than the generated types; same cast pattern
// as other pre-typegen RPCs.
const rpc = supabase as unknown as {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** Throws the server's (bilingual) message on rejection. */
export async function recordFeePayment(input: FeePaymentInput): Promise<FeePaymentResult> {
  const { data, error } = await rpc.rpc("record_fee_payment", feePaymentArgs(input));
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (!data) throw new Error("ክፍያው አልተመዘገበም / The payment was not recorded");
  return data as FeePaymentResult;
}
