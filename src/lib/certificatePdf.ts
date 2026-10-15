// Certificate PDF assembly: an A4 landscape page from the captured
// certificate image. Kept separate from the html2canvas capture so the page
// geometry and the preview watermark can be unit-tested without a browser.
import jsPDF from "jspdf";

import { PAGE_MM, CERTIFICATE_ORIENTATION } from "@/components/certificates/certificateLayout";

export const PREVIEW_WATERMARK = "PREVIEW - NOT VALID";

export interface CertificatePdfOptions {
  title: string;
  /**
   * A preview is never a valid certificate: it is stamped across the page,
   * so printing it from the viewer cannot bypass the logged
   * record_civil_certificate_print() path.
   */
  preview: boolean;
}

export function buildCertificatePdf(pngDataUrl: string, opts: CertificatePdfOptions): jsPDF {
  const page = PAGE_MM[CERTIFICATE_ORIENTATION];
  const pdf = new jsPDF({ orientation: CERTIFICATE_ORIENTATION, unit: "mm", format: "a4" });
  // Lossless (the QR must stay crisp) but deflate-compressed: an
  // uncompressed 2.5x A4 capture is ~17 MB, too heavy for the viewer.
  pdf.addImage(pngDataUrl, "PNG", 0, 0, page.w, page.h, undefined, "SLOW");
  if (opts.preview) {
    pdf.setGState(pdf.GState({ opacity: 0.22 }));
    pdf.setTextColor(200, 0, 0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(64);
    // jsPDF rotates about the text's start point, so offset the start
    // half the text length back along the rotated baseline to centre it.
    const angle = 25;
    const rad = (angle * Math.PI) / 180;
    const half = pdf.getTextWidth(PREVIEW_WATERMARK) / 2;
    pdf.text(
      PREVIEW_WATERMARK,
      page.w / 2 - half * Math.cos(rad),
      page.h / 2 + half * Math.sin(rad),
      { baseline: "middle", angle },
    );
    pdf.setGState(pdf.GState({ opacity: 1 }));
  }
  pdf.setProperties({ title: opts.preview ? `${opts.title} (preview)` : opts.title });
  return pdf;
}

const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Capture a dedicated, A4-landscape-sized certificate node (never the live
 * page) and return the PDF blob. Waits for fonts and images so the
 * Tayitu/Jiret text and the background are in the capture.
 */
export async function captureCertificatePdf(
  node: HTMLElement,
  opts: CertificatePdfOptions,
): Promise<Blob> {
  // html2canvas-pro, not html2canvas: Tailwind v4 emits oklch() colours
  // (pdf-print-pipeline skill). Loaded lazily: only print screens need it.
  const { default: html2canvas } = await import("html2canvas-pro");
  await nextFrame();
  if (document.fonts) await document.fonts.ready;
  await Promise.all(
    Array.from(node.querySelectorAll("img")).map((img) =>
      img.complete ? Promise.resolve() : img.decode().catch(() => undefined),
    ),
  );
  const canvas = await html2canvas(node, { scale: 2.5, useCORS: true, backgroundColor: "#ffffff" });
  return buildCertificatePdf(canvas.toDataURL("image/png"), opts).output("blob");
}

/** Read a URL (e.g. a signed storage URL) into a data URL so capture never depends on CORS. */
export async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
