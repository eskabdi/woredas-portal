import type { ReportBranding } from "./reportExport";
import { downloadCsvText } from "./reportExport";

export interface TableColumn<T> {
  /** Column header text (bilingual allowed, e.g. "ስም / Name"). */
  header: string;
  /** Cell value for a record — always rendered as plain text. */
  value: (row: T) => string | number | null | undefined;
  /** Relative width weight used in the PDF layout (default 1). */
  width?: number;
  align?: "left" | "right";
}

function cell<T>(col: TableColumn<T>, row: T): string {
  const v = col.value(row);
  if (v === null || v === undefined) return "—";
  return String(v);
}

/* ---------------------------------------------------------------------- CSV */

// CSV formula injection (OWASP): a cell opened by Excel/Sheets/LibreOffice
// starting with =, +, -, @, tab, or CR is evaluated as a formula, not shown
// as text. This table exports plenty of values a spreadsheet would treat as
// numeric-looking (amounts, phone numbers) but every one of them still comes
// from a TableColumn<T>'s value() as this app's own data -- the actual risk
// this guards is one field pulled from something request-supplied
// (audit_log.source_ip, populated from x-forwarded-for by the Edge
// Functions since INSA remediation Phase B) reaching an export unescaped.
// The single-quote prefix is the standard mitigation across every major
// spreadsheet app; it costs a literal leading `'` in tools that don't treat
// it as a text marker (rare, and still inert, unlike an executed formula).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function rowsToCsv<T>(columns: TableColumn<T>[], rows: T[]): string {
  const esc = (s: string) => {
    const safe = FORMULA_PREFIX.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => esc(cell(c, row))).join(","));
  return lines.join("\n");
}

export function exportRowsToCsv<T>(opts: {
  fileName: string;
  columns: TableColumn<T>[];
  rows: T[];
  /** Human readable summary of the active filters, written above the header. */
  filterLabel?: string;
  titleEn?: string;
}) {
  const preamble: string[] = [];
  if (opts.titleEn) preamble.push(`"${opts.titleEn}"`);
  if (opts.filterLabel) preamble.push(`"Filters: ${opts.filterLabel.replace(/"/g, '""')}"`);
  preamble.push(`"Exported: ${new Date().toLocaleString("en-GB", { hour12: false })}"`);
  preamble.push(`"Records: ${opts.rows.length}"`);
  preamble.push("");
  downloadCsvText(opts.fileName, preamble.join("\n") + rowsToCsv(opts.columns, opts.rows));
}

/* ---------------------------------------------------------------------- PDF */

const W = 1684; // A4 landscape @ ~2x
const PAGE_H = Math.round((W * 595) / 842);
const M = 56;
const AM_FONT = `"Noto Sans Ethiopic", "Abyssinica SIL", system-ui, sans-serif`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/**
 * Renders the currently filtered records as a professionally formatted,
 * paginated A4 landscape PDF with the tenant header, filter summary and
 * repeated column headers on every page.
 */
export async function exportRowsToPdf<T>(opts: {
  fileName: string;
  branding: ReportBranding;
  titleAm: string;
  titleEn: string;
  filterLabel?: string;
  columns: TableColumn<T>[];
  rows: T[];
}) {
  const { jsPDF } = await import("jspdf");
  const logo = opts.branding.logoDataUrl ? await loadImage(opts.branding.logoDataUrl) : null;
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* ignore */
  }

  const rowH = 34;
  const headerBlock = 190; // branding + title block on page 1
  const pageHeaderBlock = 92; // compact header on later pages
  const tableW = W - M * 2;
  const weights = opts.columns.map((c) => c.width ?? 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((w) => (w / weightSum) * tableW);
  const colX = colW.reduce<number[]>((acc, w, i) => {
    acc.push(i === 0 ? M : acc[i - 1] + colW[i - 1]);
    return acc;
  }, []);

  const rowsPerFirst = Math.max(1, Math.floor((PAGE_H - headerBlock - rowH - M) / rowH));
  const rowsPerNext = Math.max(1, Math.floor((PAGE_H - pageHeaderBlock - rowH - M) / rowH));

  const chunks: T[][] = [];
  const data = opts.rows;
  if (data.length === 0) {
    chunks.push([]);
  } else {
    chunks.push(data.slice(0, rowsPerFirst));
    let i = rowsPerFirst;
    while (i < data.length) {
      chunks.push(data.slice(i, i + rowsPerNext));
      i += rowsPerNext;
    }
  }

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const generated = new Date().toLocaleString("en-GB", { hour12: false });

  chunks.forEach((chunk, pageIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, PAGE_H);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    let y = M;

    if (pageIndex === 0) {
      if (logo) {
        ctx.drawImage(logo, M, y, 78, 78);
      } else {
        ctx.fillStyle = "#1d4ed8";
        ctx.beginPath();
        ctx.arc(M + 39, y + 39, 39, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 26px ${AM_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText("HW", M + 39, y + 41);
        ctx.textAlign = "left";
      }
      const tx = M + 98;
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold 27px ${AM_FONT}`;
      ctx.fillText(truncate(ctx, opts.branding.nameAm, tableW - 98 - 300), tx, y + 18);
      ctx.fillStyle = "#475569";
      ctx.font = `18px ${AM_FONT}`;
      ctx.fillText(truncate(ctx, opts.branding.nameEn, tableW - 98 - 300), tx, y + 46);
      const contact = [
        opts.branding.addressLine,
        opts.branding.contactPhone,
        opts.branding.contactEmail,
      ]
        .filter(Boolean)
        .join("  •  ");
      if (contact) {
        ctx.fillStyle = "#64748b";
        ctx.font = `15px ${AM_FONT}`;
        ctx.fillText(truncate(ctx, contact, tableW - 98 - 280), tx, y + 70);
      }
      ctx.fillStyle = "#64748b";
      ctx.font = `14px ${AM_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`Generated ${generated}`, W - M, y + 12);
      ctx.fillText(`${opts.rows.length} record(s)`, W - M, y + 34);
      ctx.textAlign = "left";

      y += 94;
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(M, y, tableW, 3);
      y += 30;

      ctx.fillStyle = "#0f172a";
      ctx.font = `bold 23px ${AM_FONT}`;
      ctx.fillText(opts.titleAm, M, y);
      y += 26;
      ctx.fillStyle = "#475569";
      ctx.font = `17px ${AM_FONT}`;
      ctx.fillText(opts.titleEn, M, y);
      y += 24;
      if (opts.filterLabel) {
        ctx.fillStyle = "#64748b";
        ctx.font = `14px ${AM_FONT}`;
        ctx.fillText(truncate(ctx, `Filters: ${opts.filterLabel}`, tableW), M, y);
      }
      y = headerBlock;
    } else {
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold 19px ${AM_FONT}`;
      ctx.fillText(truncate(ctx, `${opts.titleAm} — ${opts.titleEn}`, tableW - 240), M, y + 8);
      ctx.fillStyle = "#64748b";
      ctx.font = `14px ${AM_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(truncate(ctx, opts.branding.nameEn, 240), W - M, y + 8);
      ctx.textAlign = "left";
      y += 30;
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(M, y, tableW, 2);
      y = pageHeaderBlock;
    }

    // column headers
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(M, y, tableW, rowH);
    ctx.fillStyle = "#475569";
    ctx.font = `bold 15px ${AM_FONT}`;
    opts.columns.forEach((c, i) => {
      if (c.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(truncate(ctx, c.header, colW[i] - 20), colX[i] + colW[i] - 10, y + rowH / 2);
        ctx.textAlign = "left";
      } else {
        ctx.fillText(truncate(ctx, c.header, colW[i] - 20), colX[i] + 10, y + rowH / 2);
      }
    });
    y += rowH;

    if (chunk.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `15px ${AM_FONT}`;
      ctx.fillText("No records match the current filters", M + 10, y + rowH / 2);
      y += rowH;
    }

    chunk.forEach((row, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(M, y, tableW, rowH);
      }
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M, y);
      ctx.lineTo(W - M, y);
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.font = `15px ${AM_FONT}`;
      opts.columns.forEach((c, ci) => {
        const text = cell(c, row);
        if (c.align === "right") {
          ctx.textAlign = "right";
          ctx.fillText(truncate(ctx, text, colW[ci] - 20), colX[ci] + colW[ci] - 10, y + rowH / 2);
          ctx.textAlign = "left";
        } else {
          ctx.fillText(truncate(ctx, text, colW[ci] - 20), colX[ci] + 10, y + rowH / 2);
        }
      });
      y += rowH;
    });

    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = `13px ${AM_FONT}`;
    ctx.fillText("Woreda Administration ERP — official internal export", M, PAGE_H - 28);

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pageW, pageH);
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Page ${pageIndex + 1} of ${chunks.length}`, pageW - 70, pageH - 14);
  });

  pdf.save(opts.fileName);
}
