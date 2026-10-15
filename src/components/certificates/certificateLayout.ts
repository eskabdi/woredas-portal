/**
 * Layout types and helpers shared by the certificate renderer, the
 * super-admin template builder and the print route.
 */
import {
  certificateField,
  renderFieldText,
  type CertificateField,
  type CertificateType,
  type FieldFormat,
  type ResolvedValue,
} from "@/config/certificateFields";

export interface PlacedField {
  certificate_field_id: string;
  certificate_type: string;
  field_key: string;
  format: FieldFormat;
  binding_mode: "data" | "static";
  static_value: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  font_weight: "normal" | "bold";
  font_style: "normal" | "italic";
  text_align: "left" | "center" | "right";
  color: string;
  font_family: string;
  z_index: number;
}

export type Orientation = "portrait" | "landscape";

export const PAGE_MM: Record<Orientation, { w: number; h: number }> = {
  portrait: { w: 210, h: 297 },
  landscape: { w: 297, h: 210 },
};

/** Every civil certificate is designed and printed on A4 landscape (migration 104). */
export const CERTIFICATE_ORIENTATION: Orientation = "landscape";

export const PT_TO_MM = 25.4 / 72;

export const STATIC_FIELD_KEY = "static_text";

export function fontCss(family: string): string {
  if (family === "Tayitu" || family === "Jiret") return `"${family}", "Noto Sans Ethiopic", serif`;
  return `"${family}", "Noto Sans Ethiopic", sans-serif`;
}

/** Text a placed field prints, from resolved values (or a static string). */
export function placedFieldText(
  type: CertificateType,
  f: PlacedField,
  values: Record<string, ResolvedValue> | null,
): string {
  if (f.binding_mode === "static") return f.static_value ?? "";
  const def = certificateField(type, f.field_key);
  if (!def || !values) return "";
  return renderFieldText(def, values[f.field_key], f.format);
}

const DATE_PART: Record<string, { am: string; en: string }> = {
  day: { am: "ቀን", en: "Day" },
  month: { am: "ወር", en: "Month" },
  year: { am: "ዓመት", en: "Year" },
};

/**
 * The name a placed field shows in design mode: the field's own name, in the
 * language its format prints. An Amharic placement reads "የልጁ ስም", an English
 * one "Child's Name", an Ethiopian-calendar date its Amharic name and a
 * Gregorian one its English name (with the part for a day / month / year
 * box). Language-neutral fields (numbers, images, the QR) keep both names.
 */
export function placeholderLabel(def: CertificateField, format: FieldFormat): string {
  const both = `${def.am} / ${def.en}`;
  switch (format) {
    case "am":
      return def.am;
    case "en":
      return def.en;
    case "am_en":
      return both;
    case "ec_full":
      return def.am;
    case "gc_full":
      return def.en;
    case "ec_day":
    case "ec_month":
    case "ec_year":
      return `${def.am} (${DATE_PART[format.slice(3)].am})`;
    case "gc_day":
    case "gc_month":
    case "gc_year":
      return `${def.en} (${DATE_PART[format.slice(3)].en})`;
    default:
      return both;
  }
}

/** Language a placement prints in, for the palette's per-language chips. */
export type PlacementLanguage = "am" | "en";

/** The format a palette chip places for a field kind and language. */
export function formatForLanguage(
  def: CertificateField,
  lang: PlacementLanguage,
): FieldFormat | null {
  if (def.kind === "bilingual" || def.kind === "sex") return lang;
  if (def.kind === "date") return lang === "am" ? "ec_full" : "gc_full";
  return null;
}

/** Whether a placed format is the given language (Amharic or English side). */
export function formatLanguage(format: FieldFormat): PlacementLanguage | null {
  if (format === "am" || format.startsWith("ec_")) return "am";
  if (format === "en" || format.startsWith("gc_")) return "en";
  return null;
}
