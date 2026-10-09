/**
 * Layout types and helpers shared by the certificate renderer, the
 * super-admin template builder and the print route.
 */
import {
  certificateField,
  renderFieldText,
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
