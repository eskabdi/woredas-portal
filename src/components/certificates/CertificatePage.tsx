/**
 * Renders one certificate page: the template background plus every placed
 * field, positioned in percent of the page. Shared by the super-admin
 * template builder (preview) and the woreda print route, so what is
 * designed is what prints.
 *
 * Font sizes are stored in points and rendered in container-query units of
 * the page width, so the same placement is correct on screen at any zoom and
 * on paper at 210 x 297 mm.
 */
import type { CSSProperties, ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";

import {
  certificateField,
  type CertificateType,
  type ResolvedValue,
} from "@/config/certificateFields";
import { certificateVerifyUrl } from "@/config/certificateVerify";

import {
  PAGE_MM,
  PT_TO_MM,
  fontCss,
  placedFieldText,
  type Orientation,
  type PlacedField,
} from "./certificateLayout";

export function CertificatePage({
  type,
  orientation,
  fields,
  values,
  backgroundUrl,
  imageUrls,
  renderOverlay,
  className,
  style,
}: {
  type: CertificateType;
  orientation: Orientation;
  fields: PlacedField[];
  /** Resolved values; null renders each field's label instead (design mode). */
  values: Record<string, ResolvedValue> | null;
  backgroundUrl: string | null;
  /** Signed URLs for image fields, keyed by field key (signature, seal). */
  imageUrls?: Record<string, string | null>;
  /** Editor chrome (selection, handles) drawn over a field. */
  renderOverlay?: (f: PlacedField) => ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const page = PAGE_MM[orientation];
  return (
    <div
      className={`relative overflow-hidden bg-white ${className ?? ""}`}
      style={{ aspectRatio: `${page.w} / ${page.h}`, containerType: "inline-size", ...style }}
    >
      {backgroundUrl && (
        <img
          src={backgroundUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-fill"
          draggable={false}
        />
      )}
      {fields.map((f) => {
        const def = f.binding_mode === "data" ? certificateField(type, f.field_key) : undefined;
        const isImage = def?.kind === "image";
        const label = def ? `${def.am} / ${def.en}` : (f.static_value ?? "");
        const text = values ? placedFieldText(type, f, values) : label;
        const fontMm = f.font_size * PT_TO_MM;
        const box: CSSProperties = {
          left: `${f.x}%`,
          top: `${f.y}%`,
          width: `${f.width}%`,
          height: `${f.height}%`,
          zIndex: 10 + f.z_index,
        };
        const textStyle: CSSProperties = {
          fontFamily: fontCss(f.font_family),
          fontSize: `${(fontMm / page.w) * 100}cqw`,
          fontWeight: f.font_weight === "bold" ? 700 : 400,
          fontStyle: f.font_style,
          color: f.color,
          textAlign: f.text_align,
          lineHeight: 1.2,
        };
        const imgUrl = isImage ? (imageUrls?.[f.field_key] ?? null) : null;
        return (
          <div key={f.certificate_field_id} className="absolute" style={box}>
            {def?.kind === "qr" ? (
              (() => {
                const token = values?.[f.field_key]?.text ?? null;
                if (token) {
                  // Level M, quiet zone included; the SVG keeps its square
                  // aspect inside the box (xMidYMid meet), never stretched.
                  return (
                    <QRCodeSVG
                      value={certificateVerifyUrl(token)}
                      level="M"
                      marginSize={2}
                      style={{ width: "100%", height: "100%" }}
                    />
                  );
                }
                return (
                  <div className="flex h-full w-full items-center justify-center border border-dashed border-slate-400 text-[10px] text-slate-500">
                    QR
                  </div>
                );
              })()
            ) : isImage ? (
              imgUrl ? (
                <img
                  src={imgUrl}
                  alt=""
                  className="pointer-events-none h-full w-full object-contain"
                  draggable={false}
                />
              ) : values ? null : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                  {label}
                </div>
              )
            ) : (
              <div className="h-full w-full overflow-hidden whitespace-pre-wrap" style={textStyle}>
                {text}
              </div>
            )}
            {renderOverlay?.(f)}
          </div>
        );
      })}
    </div>
  );
}
