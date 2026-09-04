import { z } from "zod";
import type { FieldPath } from "react-hook-form";
import { phoneDigitsSchema, phoneDigitsToE164 } from "@/lib/phoneNumber";

const todayIso = () => new Date().toISOString().slice(0, 10);

const nameRegex = /^[\p{L}\p{M}\s]+$/u;
const nameRule = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} ያስፈልጋል / ${label} required`)
    .max(200)
    .refine((v) => !v || nameRegex.test(v), `${label}: ምልክቶች አይፈቀዱም / Symbols are not allowed`);

export const residentSchema = z.object({
  // Identity
  first_name: nameRule("የመጀመሪያ ስም"),
  full_name: nameRule("Full Name (English)"),
  father_name: nameRule("የአባት ስም"),
  grandfather_name: nameRule("የወንድ አያት ስም"),
  mother_full_name: z.string().trim().min(1, "የእናት ስም ያስፈልጋል / Mother's name required").max(200),
  sex: z.enum(["male", "female"], { message: "ፆታ ይምረጡ / Select gender" }),
  date_of_birth: z
    .string()
    .min(1, "የትውልድ ቀን ያስፈልጋል / Date of birth required")
    .refine((v) => v <= todayIso(), "የትውልድ ቀን ወደፊት መሆን አይችልም / Date must be in the past"),
  photo_url: z.string().optional().default(""),
  ethnicity: z.string().min(1, "ብሔር ይምረጡ / Select ethnicity"),
  religion: z.string().min(1, "ኃይማኖት ይምረጡ / Select religion"),
  national_id_no: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine((v) => !v || /^\d{16}$/.test(v), "ልክ 16 አሃዝ መሆን አለበት / Must be exactly 16 digits"),
  phone_digits: phoneDigitsSchema(),

  // Current residence
  current_household_id: z.string().optional().default(""),
  relation_to_head: z.string().trim().max(100).optional().default(""),
  sub_woreda: z.string().trim().max(100).optional().default(""),
  latitude: z.string().optional().default(""),
  longitude: z.string().optional().default(""),
  other_address: z.string().optional().default(""),

  // Birth place
  bp_same_as_current: z.enum(["yes", "no"]).default("no"),
  bp_place_name: z.string().optional().default(""),
  bp_region: z.string().optional().default(""),
  bp_zone: z.string().optional().default(""),
  bp_woreda: z.string().optional().default(""),
  bp_kebele: z.string().optional().default(""),
  bp_house_number: z.string().optional().default(""),
  bp_area_name: z.string().optional().default(""),

  // Work info
  wi_education_level: z.string().optional().default(""),
  wi_occupation_status: z.string().optional().default(""),
  wi_occupation_post: z.string().optional().default(""),
  wi_work_address: z.string().optional().default(""),
  wi_region: z.string().optional().default(""),
  wi_zone: z.string().optional().default(""),
  wi_woreda: z.string().optional().default(""),
  wi_kebele: z.string().optional().default(""),
  wi_house_number: z.string().optional().default(""),
  wi_area_name: z.string().optional().default(""),
  wi_other_address: z.string().optional().default(""),

  // Residency
  residency_start_date: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || v <= todayIso(), "ጊዜ ወደፊት መሆን አይችልም / Cannot be in the future"),

  // Former residence
  has_former_residence: z.enum(["yes", "no"]).default("no"),
  fr_address: z.string().optional().default(""),
  fr_region: z.string().optional().default(""),
  fr_zone: z.string().optional().default(""),
  fr_woreda: z.string().optional().default(""),
  fr_kebele: z.string().optional().default(""),
  fr_house_number: z.string().optional().default(""),
  fr_area_name: z.string().optional().default(""),
  fr_clearance_letter_url: z.string().optional().default(""),
});

export type ResidentFormInput = z.input<typeof residentSchema>;
export type ResidentFormValues = z.output<typeof residentSchema>;

export const RESIDENT_STEP_FIELDS: Record<number, FieldPath<ResidentFormInput>[]> = {
  1: [
    "first_name",
    "full_name",
    "father_name",
    "grandfather_name",
    "mother_full_name",
    "sex",
    "date_of_birth",
    "ethnicity",
    "religion",
    "national_id_no",
    "phone_digits",
  ],
  2: [
    "current_household_id",
    "relation_to_head",
    "sub_woreda",
    "latitude",
    "longitude",
    "other_address",
    "bp_same_as_current",
    "bp_place_name",
    "bp_region",
    "bp_zone",
    "bp_woreda",
    "bp_kebele",
    "bp_house_number",
    "bp_area_name",
  ],
  3: [
    "wi_education_level",
    "wi_occupation_status",
    "wi_occupation_post",
    "wi_work_address",
    "wi_region",
    "wi_zone",
    "wi_woreda",
    "wi_kebele",
    "wi_house_number",
    "wi_area_name",
    "wi_other_address",
  ],
  4: [
    "residency_start_date",
    "has_former_residence",
    "fr_address",
    "fr_region",
    "fr_zone",
    "fr_woreda",
    "fr_kebele",
    "fr_house_number",
    "fr_area_name",
    "fr_clearance_letter_url",
  ],
};

export const RESIDENT_STEPS = [
  { num: 1, am: "የግል መረጃ", en: "Identity" },
  { num: 2, am: "የመኖሪያ እና የትውልድ ሥፍራ", en: "Residence & Birth Place" },
  { num: 3, am: "የትምህርትና ሥራ", en: "Education & Occupation" },
  { num: 4, am: "የመኖሪያ ጊዜ እና የቀድሞ አድራሻ", en: "Residency Time & Former Residence" },
] as const;

export function buildJsonOrNull(
  obj: Record<string, string | number | undefined | null>,
): Record<string, string | number> | null {
  const cleaned: Record<string, string | number> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== "" && v !== null && !(typeof v === "number" && Number.isNaN(v))) {
      cleaned[k] = v;
    }
  });
  return Object.keys(cleaned).length ? cleaned : null;
}

export function buildResidentPayloadCore(values: ResidentFormValues) {
  const current_residence_extra = buildJsonOrNull({
    sub_woreda: values.sub_woreda,
    latitude: values.latitude ? Number(values.latitude) : undefined,
    longitude: values.longitude ? Number(values.longitude) : undefined,
    other_address: values.other_address,
  });
  const birth_place = buildJsonOrNull({
    place_name: values.bp_place_name,
    region: values.bp_region,
    zone: values.bp_zone,
    woreda: values.bp_woreda,
    kebele: values.bp_kebele,
    house_number: values.bp_house_number,
    area_name: values.bp_area_name,
  });
  const work_info = buildJsonOrNull({
    education_level: values.wi_education_level,
    occupation_status: values.wi_occupation_status,
    occupation_post: values.wi_occupation_post,
    work_address: values.wi_work_address,
    region: values.wi_region,
    zone: values.wi_zone,
    woreda: values.wi_woreda,
    kebele: values.wi_kebele,
    house_number: values.wi_house_number,
    area_name: values.wi_area_name,
    other_address: values.wi_other_address,
  });
  const former_residence =
    values.has_former_residence === "yes"
      ? buildJsonOrNull({
          address: values.fr_address,
          region: values.fr_region,
          zone: values.fr_zone,
          woreda: values.fr_woreda,
          kebele: values.fr_kebele,
          house_number: values.fr_house_number,
          area_name: values.fr_area_name,
          clearance_letter_url: values.fr_clearance_letter_url,
        })
      : null;

  const full_name_am = [values.first_name, values.father_name, values.grandfather_name]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  const phone_number = phoneDigitsToE164(values.phone_digits ?? "");

  return {
    first_name: values.first_name,
    full_name: values.full_name,
    full_name_am,
    father_name: values.father_name,
    grandfather_name: values.grandfather_name,
    mother_full_name: values.mother_full_name,
    sex: values.sex,
    date_of_birth: values.date_of_birth,
    ethnicity: values.ethnicity,
    religion: values.religion,
    national_id_no: values.national_id_no || null,
    phone_number,
    photo_url: values.photo_url || null,
    current_household_id: values.current_household_id || null,
    relation_to_head: values.relation_to_head || null,
    residency_start_date: values.residency_start_date || null,
    current_residence_extra,
    birth_place,
    work_info,
    former_residence,
  };
}
