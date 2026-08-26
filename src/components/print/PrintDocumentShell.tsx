import type { ReactNode } from "react";
import { Printer } from "lucide-react";
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

/** Shared A4 print shell: on-screen preview + browser print (same "preview,
 * then Print" flow as the receipt and credential print surfaces) rather than
 * a separate PDF renderer. */
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
  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between print:hidden">
        {backButton}
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> አትም / Print
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[820px] border bg-white p-10 shadow-sm print:border-0 print:p-0 print:shadow-none">
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
