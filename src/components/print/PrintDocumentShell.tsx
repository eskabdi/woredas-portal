import { useRef, useState, type ReactNode } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
// html2canvas-pro, not html2canvas: this app's Tailwind v4 build resolves
// computed colors to oklch(...), which plain html2canvas 1.4.1 throws on
// ("Attempting to parse an unsupported color function"). Same pipeline as
// woreda.revenue.$paymentId.receipt.tsx.
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";

/**
 * Fixed regional letterhead line shared by every printed administrative
 * document across tenants — not tenant-configurable, unlike the woreda name
 * below it.
 */
export const REGIONAL_HEADER_AM = "የሐረሪ ብሔራዊ ክልላዊ መንግስት";
export const REGIONAL_HEADER_EN = "Harari People's Regional State";

export interface PrintDocumentShellProps {
  backButton: ReactNode;
  logoDataUrl?: string | null;
  woredaNameAm: string;
  woredaNameEn: string;
  contactLine?: string | null;
  docTagAm: string;
  docTagEn: string;
  docNumberLabelAm: string;
  docNumberLabelEn: string;
  docNumber: string;
  dateEth: string;
  dateGreg: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Shared A4 print shell: on-screen preview, then a generated PDF opened in a
 * new tab (same pipeline as the receipt print surface: html2canvas-pro ->
 * jsPDF -> blob URL) rather than window.print() on the live page. A
 * browser's native PDF viewer only ever prints the PDF's own page, never the
 * app chrome around it -- window.print() on the live DOM can't guarantee
 * that (the sidebar and other page sections bleed into the printout, since
 * this shell has no shared mechanism to hide them, unlike the one-off
 * hidden/print:block overlay the credential print route uses). */
export function PrintDocumentShell({
  backButton,
  logoDataUrl,
  woredaNameAm,
  woredaNameEn,
  contactLine,
  docTagAm,
  docTagEn,
  docNumberLabelAm,
  docNumberLabelEn,
  docNumber,
  dateEth,
  dateGreg,
  children,
  footer,
}: PrintDocumentShellProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  // Chromium blocks a *deferred* top-level navigation of an already-open
  // window to a blob:/data: URL (window.open("", "_blank") then later
  // win.location.href = blobUrl lands on "about:blank#blocked" once the
  // async html2canvas/jsPDF work finishes, because by then the click's user
  // activation no longer covers a fresh navigation). An <a target="_blank">
  // click is exempt from that block -- Chromium treats a simulated click on
  // an anchor as a genuine new-tab-open request even from inside an async
  // continuation, so the PDF opens in that tab's native viewer instead of
  // triggering a download.
  const handlePrint = async () => {
    if (!printRef.current) return;
    setPrinting(true);
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
      pdf.setProperties({ title: `${docTagEn} ${docNumber}` });
      const blobUrl = URL.createObjectURL(pdf.output("blob"));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      toast.error(`Failed to generate the document PDF: ${(e as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between">
        {backButton}
        <Button size="sm" onClick={handlePrint} disabled={printing}>
          {printing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Printer className="mr-1 h-4 w-4" />
          )}
          አትም / Print
        </Button>
      </div>

      <div ref={printRef} className="mx-auto w-full max-w-[820px] border bg-white p-10 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b-2 border-blue-800 pb-4">
          <div className="flex items-start gap-3.5">
            <div className="h-14 w-14 flex-none border border-slate-300">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" className="h-full w-full object-contain grayscale" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-400">
                  Logo
                </div>
              )}
            </div>
            <div>
              <div className="font-noto-ethiopic text-[11px] font-semibold tracking-wide text-blue-800">
                {REGIONAL_HEADER_AM}
              </div>
              <div className="text-[9px] uppercase tracking-wide text-slate-500">
                {REGIONAL_HEADER_EN}
              </div>
              <h1 className="font-noto-ethiopic mt-1.5 text-xl font-bold text-slate-900">
                {woredaNameAm}
              </h1>
              <div className="mt-0.5 text-xs text-slate-600">{woredaNameEn}</div>
              {contactLine && (
                <div className="mt-1.5 text-[11px] text-slate-500">{contactLine}</div>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className="font-noto-ethiopic inline-block rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
              {docTagAm}
            </span>
            <div className="mt-1 text-[9px] uppercase tracking-wide text-slate-400">{docTagEn}</div>
            <div className="mt-2 text-[11px] text-slate-700">
              <span className="font-noto-ethiopic">{docNumberLabelAm}</span>
              <span className="text-slate-400"> / {docNumberLabelEn}</span>:{" "}
              <strong className="font-mono">{docNumber}</strong>
            </div>
            <div className="text-[11px] text-slate-500">
              {dateEth} · {dateGreg}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-5">{children}</div>

        {footer}
      </div>
    </div>
  );
}

export function DocSection({
  number,
  titleAm,
  titleEn,
  children,
}: {
  number: string;
  titleAm: string;
  titleEn: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-noto-ethiopic mb-3.5 text-xs font-semibold tracking-wide text-blue-800">
        {number} — {titleAm}
        <span className="ml-2 font-normal normal-case text-slate-400">{titleEn}</span>
      </h2>
      {children}
    </section>
  );
}

export function DocDivider() {
  return <hr className="border-slate-200" />;
}

export function DocFieldGrid({ cols = 3, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={`grid gap-x-5 gap-y-3.5 ${cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {children}
    </div>
  );
}

export function DocField({
  labelAm,
  labelEn,
  value,
  span,
  mono,
}: {
  labelAm: string;
  labelEn: string;
  value: ReactNode;
  span?: 2 | 3;
  mono?: boolean;
}) {
  return (
    <div className={span === 3 ? "col-span-3" : span === 2 ? "col-span-2" : undefined}>
      <div className="text-[9.5px] font-medium uppercase tracking-wide text-slate-400">
        <span className="font-noto-ethiopic">{labelAm}</span>
        <span className="ml-1 normal-case text-slate-400">/ {labelEn}</span>
      </div>
      <div
        className={`font-noto-ethiopic mt-0.5 text-sm font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/** Big-number KPI tiles -- the "01 — Summary" row on the printable reports. */
export function DocStatGrid({ cols = 3, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const colsClass = cols === 4 ? "grid-cols-4" : cols === 2 ? "grid-cols-2" : "grid-cols-3";
  return <div className={`grid gap-x-5 gap-y-3 ${colsClass}`}>{children}</div>;
}

export function DocStat({
  labelAm,
  labelEn,
  value,
}: {
  labelAm: string;
  labelEn: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-[9.5px] font-medium uppercase tracking-wide text-slate-400">
        <span className="font-noto-ethiopic">{labelAm}</span>
        <span className="ml-1 normal-case text-slate-400">/ {labelEn}</span>
      </div>
      <div className="font-noto-ethiopic mt-0.5 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

/** Label / value(+share) / Total table for one ReportSection, matching the
 * on-screen Reports tab tables so the printed figures never diverge. */
export function DocDataTable({
  rows,
  valueLabel = "Count",
}: {
  rows: { name: string; value: number }[];
  valueLabel?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-slate-300 text-left">
          <th className="pb-1.5 pr-3 font-noto-ethiopic font-semibold text-slate-700">Label</th>
          <th className="pb-1.5 pr-3 text-right font-semibold text-slate-700">{valueLabel}</th>
          <th className="pb-1.5 text-right font-semibold text-slate-700">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="py-3 text-center text-slate-400">
              ለዚህ ጊዜ መረጃ የለም / No data for this period
            </td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.name} className="border-b border-slate-100">
            <td className="py-1.5 pr-3 font-noto-ethiopic text-slate-800">{r.name}</td>
            <td className="py-1.5 pr-3 text-right text-slate-800">{r.value.toLocaleString()}</td>
            <td className="py-1.5 text-right text-slate-500">
              {total > 0 ? `${((r.value / total) * 100).toFixed(1)}%` : "0.0%"}
            </td>
          </tr>
        ))}
        {rows.length > 0 && (
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-1.5 pr-3 text-slate-900">
              ድምር <span className="ml-1 font-normal text-slate-400">Total</span>
            </td>
            <td className="py-1.5 pr-3 text-right text-slate-900">{total.toLocaleString()}</td>
            <td className="py-1.5 text-right text-slate-900">100%</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Fixed hex palette for chart segments -- html2canvas-pro rasterizes the
 * Tailwind/oklch colors used elsewhere in this file fine (that's the whole
 * reason this app uses html2canvas-pro over plain html2canvas), so this
 * isn't a color-function workaround. It's a categorical palette: Tailwind's
 * scale doesn't give 8 easily-distinguishable hues without picking across
 * several color families, so the segments are enumerated directly instead. */
const CHART_COLORS = [
  "#1e40af",
  "#0891b2",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0f766e",
  "#c026d3",
];

/** Horizontal bar chart for a Label/Count breakdown -- rows are expected
 * pre-sorted descending (the `count` helper in useReportsAggregate does
 * this), which is what makes the bar lengths read top-to-bottom. */
export function DocBarChart({ rows }: { rows: { name: string; value: number }[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="mb-4 space-y-2">
      {rows.map((r, i) => (
        <div key={r.name} className="flex items-center gap-2 text-[10.5px]">
          <div className="w-36 flex-none font-noto-ethiopic leading-tight text-slate-700">
            {r.name}
          </div>
          <div className="h-4 flex-1 rounded-sm bg-slate-100">
            <div
              className="h-4 rounded-sm"
              style={{
                width: `${(r.value / max) * 100}%`,
                backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
          </div>
          <div className="w-10 flex-none text-right font-semibold text-slate-800">
            {r.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut chart with a center total and a color-coded legend. Built as an SVG
 * ring (stroke-dasharray per segment) rather than a CSS conic-gradient --
 * html2canvas-pro does not rasterize conic-gradient, so that would print as
 * a blank circle; SVG shapes rasterize reliably through the same pipeline. */
export function DocDonutChart({
  rows,
  centerLabelAm,
  centerLabelEn,
}: {
  rows: { name: string; value: number }[];
  centerLabelAm: string;
  centerLabelEn: string;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.value, 0);
  const r = 15.9155;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <div className="mb-4 flex items-center gap-6">
      <div className="relative h-32 w-32 flex-none">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <circle cx="18" cy="18" r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
          {rows.map((row, i) => {
            const pct = total > 0 ? (row.value / total) * 100 : 0;
            const segment = (pct / 100) * circumference;
            const offset = -((cumulative / 100) * circumference);
            cumulative += pct;
            return (
              <circle
                key={row.name}
                cx="18"
                cy="18"
                r={r}
                fill="none"
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth="4"
                strokeDasharray={`${segment} ${circumference - segment}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-base font-bold text-slate-900">{total.toLocaleString()}</div>
          <div className="font-noto-ethiopic text-[8.5px] text-slate-500">{centerLabelAm}</div>
          <div className="text-[7.5px] text-slate-400">{centerLabelEn}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {rows.map((row, i) => (
          <div key={row.name} className="flex items-center gap-2 text-[10.5px]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-sm"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="font-noto-ethiopic min-w-0 flex-1 break-words text-slate-700">
              {row.name}
            </span>
            <span className="flex-none font-semibold text-slate-800">
              {total > 0 ? `${((row.value / total) * 100).toFixed(1)}%` : "0.0%"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocSignatureBlock({
  items,
}: {
  items: [{ labelAm: string; labelEn: string }, { labelAm: string; labelEn: string }];
}) {
  return (
    <div className="grid grid-cols-3 gap-5">
      {items.map((it) => (
        <div key={it.labelAm} className="mt-10 border-t border-slate-400 pt-1.5 text-[11px]">
          <span className="font-noto-ethiopic">{it.labelAm}</span>
          <div className="text-[10px] text-slate-500">/ {it.labelEn}</div>
        </div>
      ))}
      <div className="flex min-h-[70px] items-center justify-center border border-dashed border-slate-300 text-center text-[9.5px] uppercase tracking-wide text-slate-400">
        ኦፊሴላዊ ማህተም
        <br />
        Official Stamp
      </div>
    </div>
  );
}

/**
 * Record-reference footer for internal documents that have no public
 * verification surface (unlike issued letters, which carry a real
 * verification_token / QR — see verify.letter.$token.tsx). Only asserts what
 * the record actually is: an internal reference id and a print timestamp,
 * never a verification link that doesn't exist for this entity type.
 */
export function DocRecordFooter({
  refLabel,
  refId,
  printedOn,
  note,
}: {
  refLabel: string;
  refId: string;
  printedOn: string;
  note?: ReactNode;
}) {
  return (
    <div className="mt-8 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 px-3.5 py-2.5 text-[10px] text-slate-600">
        <div>
          <strong className="font-noto-ethiopic text-slate-800">{refLabel}</strong>{" "}
          <span className="font-mono">{refId}</span>
        </div>
        <div>የታተመው ቀን / Printed: {printedOn}</div>
      </div>
      {note && <div className="text-center text-[9.5px] text-slate-400">{note}</div>}
    </div>
  );
}

export function SystemAttributionFooter({ woredaNameAm }: { woredaNameAm: string }) {
  return (
    <div className="text-center text-[10px] text-slate-400">
      <div>የሐረሪ ወረዳዎች አስተዳደር ሥርዓት · {woredaNameAm} · በራስ-ሰር የተዘጋጀ ሰነድ</div>
      <div className="mt-0.5">Harari Woreda Administration System · System-generated document</div>
    </div>
  );
}
