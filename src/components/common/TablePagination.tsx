import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const PAGE_SIZE_OPTIONS = [20, 30, 40, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

interface TablePaginationProps {
  /** zero-based page index */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, page * pageSize + pageSize);

  // Guard against an out-of-range page coming from a shared/stale URL.
  useEffect(() => {
    if (total > 0 && page > totalPages - 1) onPageChange(totalPages - 1);
  }, [total, page, totalPages, onPageChange]);


  return (
    <div
      className={
        "flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50/60 px-4 py-3 text-sm " +
        (className ?? "")
      }
    >
      <div className="flex items-center gap-2 text-slate-600">
        <span>Rows per page</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(0);
          }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-slate-500">
          Showing {from}–{to} of {total}
          <span className="font-noto-ethiopic"> ({total} አጠቃላይ)</span>
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            ← Prev
          </Button>
          <span className="text-slate-600">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}

function toInt(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Page index + rows-per-page persisted in the URL (?page=1&size=20) so the
 * selection survives refresh and can be shared.
 *
 * Pass `resetKey` (a string built from the active filters/search) to snap back
 * to page 1 whenever the filters change.
 */
export function useUrlPagination(resetKey?: string) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const page = Math.max(0, toInt(search["page"], 1) - 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(
    toInt(search["size"], DEFAULT_PAGE_SIZE) as (typeof PAGE_SIZE_OPTIONS)[number],
  )
    ? toInt(search["size"], DEFAULT_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  const patch = useCallback(
    (next: Record<string, unknown>) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
        replace: true,
      } as never);
    },
    [navigate],
  );

  const setPage = useCallback(
    (next: number) => patch({ page: next <= 0 ? undefined : next + 1 }),
    [patch],
  );

  const setPageSize = useCallback(
    (next: number) =>
      patch({ size: next === DEFAULT_PAGE_SIZE ? undefined : next, page: undefined }),
    [patch],
  );

  // Reset to the first page whenever filters/search change.
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === undefined) return;
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    if (page !== 0) setPage(0);
  }, [resetKey, page, setPage]);

  return { page, setPage, pageSize, setPageSize };
}

/**
 * Debounced search box state persisted in the URL (?q=term).
 * `input` drives the field, `term` is the debounced value for queries.
 */
export function useUrlSearchTerm(key = "q", delay = 350) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const urlTerm = typeof search[key] === "string" ? (search[key] as string) : "";

  const [input, setInput] = useState(urlTerm);
  const hydrated = useRef(false);

  // Hydrate the field from the URL on first render / external navigation.
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      if (urlTerm !== input) setInput(urlTerm);
    }
  }, [urlTerm, input]);

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = input.trim();
      if (trimmed === urlTerm) return;
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          [key]: trimmed === "" ? undefined : trimmed,
          page: undefined,
        }),
        replace: true,
      } as never);
    }, delay);
    return () => clearTimeout(t);
  }, [input, urlTerm, key, delay, navigate]);

  return { input, setInput, term: urlTerm };
}

/** Client-side pagination helper for pages that already hold the full row set. */
export function useClientPagination<T>(rows: T[], resetKey?: string) {
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(resetKey);

  const total = rows.length;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  useEffect(() => {
    if (page > maxPage) setPage(maxPage);
  }, [page, maxPage]);

  const pageRows = useMemo(
    () => rows.slice(page * pageSize, page * pageSize + pageSize),
    [rows, page, pageSize],
  );

  return { page, setPage, pageSize, setPageSize, total, pageRows };
}
