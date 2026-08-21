import type { ReactNode } from "react";
import { AlertTriangle, FilterX, Inbox, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeleton rows that keep the table layout stable while fetching. */
export function TableSkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton
                className="h-4"
                style={{ width: `${c === 0 ? 70 : 45 + ((c * 13) % 40)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Friendly empty state; offers to clear filters when some are active. */
export function TableEmptyRow({
  cols,
  filtered,
  onClearFilters,
  labelAm = "መዝገብ አልተገኘም",
  labelEn = "No records yet",
  filteredLabelAm = "በዚህ ማጣሪያ ምንም አልተገኘም",
  filteredLabelEn = "No records match your search or filters",
  children,
}: {
  cols: number;
  filtered?: boolean;
  onClearFilters?: () => void;
  labelAm?: string;
  labelEn?: string;
  filteredLabelAm?: string;
  filteredLabelEn?: string;
  children?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          {filtered ? (
            <FilterX className="h-8 w-8 text-slate-300" />
          ) : (
            <Inbox className="h-8 w-8 text-slate-300" />
          )}
          <div className="font-noto-ethiopic text-sm font-medium text-slate-700">
            {filtered ? filteredLabelAm : labelAm}
          </div>
          <div className="text-sm text-slate-500">{filtered ? filteredLabelEn : labelEn}</div>
          {filtered && onClearFilters && (
            <Button variant="outline" size="sm" className="mt-2" onClick={onClearFilters}>
              <FilterX className="mr-1 h-4 w-4" /> Clear filters
            </Button>
          )}
          {children}
        </div>
      </td>
    </tr>
  );
}

/** Friendly error state with a retry action. */
export function TableErrorRow({
  cols,
  error,
  onRetry,
}: {
  cols: number;
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Something went wrong loading this table.";
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/70" />
          <div className="font-noto-ethiopic text-sm font-medium text-slate-700">
            መረጃውን መጫን አልተቻለም
          </div>
          <div className="max-w-md text-sm text-slate-500">{message}</div>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              <RotateCcw className="mr-1 h-4 w-4" /> Try again
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
