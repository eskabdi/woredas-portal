import type { ReactNode } from "react";

/**
 * Shared card chrome for a chart: bilingual title, loading and empty states.
 * Extracted from the pattern `woreda.reports.index.tsx`'s local `BarCard`/`PieCard`
 * already used, so `woreda.dashboard.tsx` and `admin.dashboard.tsx` (which previously
 * had no loading/empty state on their charts at all) get the same treatment for free.
 */
export function ChartCard({
  titleAm,
  titleEn,
  loading,
  empty,
  emptyMessageAm = "ለዚህ ጊዜ መረጃ የለም",
  emptyMessageEn = "No data for this period",
  height = 256,
  children,
}: {
  /** Omit for the English-only admin console (CLAUDE.md: admin.* stays English, never bilingual). */
  titleAm?: string;
  titleEn: string;
  loading?: boolean;
  empty?: boolean;
  emptyMessageAm?: string;
  emptyMessageEn?: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {titleAm && (
        <h3 className="font-am-heading text-sm font-semibold text-slate-900">{titleAm}</h3>
      )}
      <p className={titleAm ? "text-xs text-slate-400" : "text-sm font-semibold text-slate-900"}>
        {titleEn}
      </p>
      <div className="mt-4" style={{ height }}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Loading…
          </div>
        ) : empty ? (
          <div
            className={`flex h-full items-center justify-center text-center text-sm text-slate-500 ${titleAm ? "font-am-body" : ""}`}
          >
            {titleAm ? `${emptyMessageAm} / ${emptyMessageEn}` : emptyMessageEn}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
