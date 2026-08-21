export interface ReportSection {
  titleAm: string;
  titleEn: string;
  valueLabel?: string;
  rows: { name: string; value: number }[];
}

export interface ReportBranding {
  nameAm: string;
  nameEn: string;
  addressLine?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  logoDataUrl?: string | null;
}

export function sectionsToCsv(sections: ReportSection[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  sections.forEach((sec, i) => {
    if (i > 0) lines.push("");
    lines.push(esc(`${sec.titleAm} / ${sec.titleEn}`));
    lines.push(["Label", sec.valueLabel ?? "Count"].join(","));
    sec.rows.forEach((r) => lines.push([esc(r.name), esc(r.value)].join(",")));
    lines.push([esc("Total"), sec.rows.reduce((s, r) => s + r.value, 0)].join(","));
  });
  return lines.join("\n");
}

export function downloadCsvText(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const W = 1240; // canvas width (A4 portrait @ ~2x)
const PAGE_H = Math.round((W * 842) / 595);
const M = 72; // side margin

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const AM_FONT = `"Noto Sans Ethiopic", "Abyssinica SIL", system-ui, sans-serif`;

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/** Renders the report on a canvas (no CSS parsing) and saves it as a paginated A4 PDF. */
export async function exportSectionsToPdf(opts: {
  fileName: string;
  branding: ReportBranding;
  reportTitleAm: string;
  reportTitleEn: string;
  periodLabel: string;
  sections: ReportSection[];
}) {
  const { jsPDF } = await import("jspdf");
  const logo = opts.branding.logoDataUrl ? await loadImage(opts.branding.logoDataUrl) : null;
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* ignore */
  }

  // ---- measure required height ----
  const rowH = 40;
  let h = 300;
  opts.sections.forEach((sec) => {
    h += 70 + rowH * (Math.max(sec.rows.length, 1) + 2) + 30;
  });
  h += 90;
  const height = Math.max(PAGE_H, Math.ceil(h / PAGE_H) * PAGE_H);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, height);
  ctx.textBaseline = "middle";

  let y = M;
  // header
  if (logo) {
    const size = 84;
    ctx.drawImage(logo, M, y, size, size);
  } else {
    ctx.fillStyle = "#1d4ed8";
    ctx.beginPath();
    ctx.arc(M + 42, y + 42, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 30px ${AM_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("HW", M + 42, y + 44);
    ctx.textAlign = "left";
  }
  const textX = M + 106;
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold 30px ${AM_FONT}`;
  ctx.fillText(truncate(ctx, opts.branding.nameAm, W - textX - M - 200), textX, y + 20);
  ctx.fillStyle = "#475569";
  ctx.font = `20px ${AM_FONT}`;
  ctx.fillText(truncate(ctx, opts.branding.nameEn, W - textX - M - 200), textX, y + 50);
  const contact = [
    opts.branding.addressLine,
    opts.branding.contactPhone,
    opts.branding.contactEmail,
  ]
    .filter(Boolean)
    .join("  •  ");
  if (contact) {
    ctx.fillStyle = "#64748b";
    ctx.font = `16px ${AM_FONT}`;
    ctx.fillText(truncate(ctx, contact, W - textX - M - 180), textX, y + 76);
  }
  ctx.fillStyle = "#64748b";
  ctx.font = `15px ${AM_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`Generated ${new Date().toLocaleString("en-GB", { hour12: false })}`, W - M, y + 14);
  ctx.textAlign = "left";

  y += 100;
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(M, y, W - M * 2, 4);
  y += 40;

  ctx.fillStyle = "#0f172a";
  ctx.font = `bold 26px ${AM_FONT}`;
  ctx.fillText(opts.reportTitleAm, M, y);
  y += 30;
  ctx.fillStyle = "#475569";
  ctx.font = `19px ${AM_FONT}`;
  ctx.fillText(opts.reportTitleEn, M, y);
  y += 28;
  ctx.fillStyle = "#64748b";
  ctx.font = `16px ${AM_FONT}`;
  ctx.fillText(opts.periodLabel, M, y);
  y += 58;

  const colValX = W - M - 220;
  const colPctX = W - M - 20;

  opts.sections.forEach((sec) => {
    const total = sec.rows.reduce((s, r) => s + r.value, 0);

    // keep a section header with at least one row on the same page
    const remaining = PAGE_H - (y % PAGE_H);
    if (remaining < 190) y += remaining + M / 2;

    ctx.fillStyle = "#0f172a";
    ctx.font = `bold 21px ${AM_FONT}`;
    ctx.fillText(sec.titleAm, M, y);
    y += 26;
    ctx.fillStyle = "#64748b";
    ctx.font = `16px ${AM_FONT}`;
    ctx.fillText(sec.titleEn, M, y);
    y += 28;

    // table header
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(M, y, W - M * 2, rowH);
    ctx.fillStyle = "#475569";
    ctx.font = `bold 17px ${AM_FONT}`;
    ctx.fillText("Label", M + 14, y + rowH / 2);
    ctx.textAlign = "right";
    ctx.fillText(sec.valueLabel ?? "Count", colValX, y + rowH / 2);
    ctx.fillText("Share", colPctX, y + rowH / 2);
    ctx.textAlign = "left";
    y += rowH;

    if (sec.rows.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `17px ${AM_FONT}`;
      ctx.fillText("No data for this period", M + 14, y + rowH / 2);
      y += rowH;
    } else {
      sec.rows.forEach((r, i) => {
        if (i % 2 === 1) {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(M, y, W - M * 2, rowH);
        }
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(M, y);
        ctx.lineTo(W - M, y);
        ctx.stroke();
        ctx.fillStyle = "#0f172a";
        ctx.font = `17px ${AM_FONT}`;
        ctx.fillText(truncate(ctx, r.name, colValX - M - 40), M + 14, y + rowH / 2);
        ctx.textAlign = "right";
        ctx.fillText(r.value.toLocaleString(), colValX, y + rowH / 2);
        ctx.fillStyle = "#64748b";
        ctx.fillText(
          total > 0 ? `${((r.value / total) * 100).toFixed(1)}%` : "0.0%",
          colPctX,
          y + rowH / 2,
        );
        ctx.textAlign = "left";
        y += rowH;
      });
    }

    // total row
    ctx.fillStyle = "#eef2ff";
    ctx.fillRect(M, y, W - M * 2, rowH);
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold 17px ${AM_FONT}`;
    ctx.fillText("Total", M + 14, y + rowH / 2);
    ctx.textAlign = "right";
    ctx.fillText(total.toLocaleString(), colValX, y + rowH / 2);
    ctx.textAlign = "left";
    y += rowH + 44;
  });

  ctx.fillStyle = "#94a3b8";
  ctx.font = `14px ${AM_FONT}`;
  ctx.fillText(
    "Generated by the Woreda Administration ERP — official internal report",
    M,
    Math.min(y + 16, height - 30),
  );

  // ---- paginate into the PDF ----
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const pages = Math.ceil(canvas.height / PAGE_H);
  for (let i = 0; i < pages; i++) {
    const sliceH = Math.min(PAGE_H, canvas.height - i * PAGE_H);
    const slice = document.createElement("canvas");
    slice.width = W;
    slice.height = sliceH;
    const sctx = slice.getContext("2d")!;
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, W, sliceH);
    sctx.drawImage(canvas, 0, i * PAGE_H, W, sliceH, 0, 0, W, sliceH);
    if (i > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pageW, (sliceH * pageW) / W);
    if (pages > 1) {
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`Page ${i + 1} of ${pages}`, pageW - 60, pageH - 16);
    }
  }
  pdf.save(opts.fileName);
}
