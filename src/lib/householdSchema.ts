import { z } from "zod";

export const householdSchema = z
  .object({
    kebele_id: z.string().uuid("ቀበሌ ይምረጡ / Select a kebele"),
    house_number: z
      .string()
      .trim()
      .min(1, "የቤት ቁጥር ያስፈልጋል / House number required")
      .max(50),
    address_line: z.string().trim().max(255).optional().default(""),
    occupancy_status: z.enum(["occupied", "vacant", "demolished", "transferred"], {
      message: "አያያዝ ሁኔታ ይምረጡ / Select occupancy status",
    }),
    sub_woreda: z.string().trim().max(100).optional().default(""),

    household_head_resident_id: z.string().optional().default(""),
    spouse_resident_id: z.string().optional().default(""),
    alternate_head_resident_id: z.string().optional().default(""),

    phone_digits: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine((v) => !v || /^\d{9}$/.test(v), "ልክ 9 አሃዝ መሆን አለበት / Must be exactly 9 digits"),
    po_box: z.string().trim().max(50).optional().default(""),
    email: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine(
        (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "የተሳሳተ ኢሜይል ቅርፀት / Invalid email format",
      ),

    house_type: z.enum(
      ["private", "kebele", "rental", "government", "rented_by_private", "other"],
      { message: "የቤቱን ሁኔታ ይምረጡ / Select house type" },
    ),
    house_type_other: z.string().trim().max(100).optional().default(""),
    rent_amount: z.string().trim().optional().default(""),

    gps_lat: z
      .number({ message: "የቤቱን አድራሻ ካርታ ላይ ይምረጡ / Select the house address on the map." })
      .refine((v) => Number.isFinite(v), {
        message: "የቤቱን አድራሻ ካርታ ላይ ይምረጡ / Select the house address on the map.",
      }),
    gps_lng: z
      .number({ message: "የቤቱን አድራሻ ካርታ ላይ ይምረጡ / Select the house address on the map." })
      .refine((v) => Number.isFinite(v), {
        message: "የቤቱን አድራሻ ካርታ ላይ ይምረጡ / Select the house address on the map.",
      }),
  })
  .superRefine((v, ctx) => {
    if (v.house_type === "other" && !v.house_type_other) {
      ctx.addIssue({
        code: "custom",
        path: ["house_type_other"],
        message: "ይግለፁ / Please specify",
      });
    }
    if ((v.house_type === "rental" || v.house_type === "rented_by_private") && !v.rent_amount) {
      ctx.addIssue({
        code: "custom",
        path: ["rent_amount"],
        message: "የኪራይ መጠን ያስፈልጋል / Rent amount required",
      });
    }
  });

export type HouseholdFormInput = z.input<typeof householdSchema>;
export type HouseholdFormValues = z.output<typeof householdSchema>;

export function buildHouseholdPayload(
  v: HouseholdFormValues,
  woredaId: string,
): Record<string, unknown> {
  return {
    woreda_id: woredaId,
    kebele_id: v.kebele_id,
    house_number: v.house_number.trim(),
    address_line: v.address_line || null,
    occupancy_status: v.occupancy_status,
    sub_woreda: v.sub_woreda || null,
    household_head_resident_id: v.household_head_resident_id || null,
    spouse_resident_id: v.spouse_resident_id || null,
    alternate_head_resident_id: v.alternate_head_resident_id || null,
    phone_number: v.phone_digits ? `+251${v.phone_digits}` : null,
    po_box: v.po_box || null,
    email: v.email || null,
    house_type: v.house_type,
    house_type_other: v.house_type === "other" ? v.house_type_other || null : null,
    rent_amount:
      (v.house_type === "rental" || v.house_type === "rented_by_private") && v.rent_amount
        ? Number(v.rent_amount)
        : null,
    gps_lat: v.gps_lat,
    gps_lng: v.gps_lng,
  };
}
