import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ sorting */

export type SortDir = "asc" | "desc";

export interface UrlSort {
  field: string;
  dir: SortDir;
  toggle: (field: string) => void;
  isDefault: boolean;
  key: string;
}

/**
 * Sort field + direction persisted in the URL (?sort=field&dir=asc).
 * Clicking the active column flips the direction; a new column starts at the
 * provided default direction.
 */
export function useUrlSort(
  defaultField: string,
  defaultDir: SortDir = "desc",
  newColumnDir: SortDir = "asc",
): UrlSort {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const field =
    typeof search["sort"] === "string" && search["sort"] ? search["sort"] : defaultField;
  const dir: SortDir =
    search["dir"] === "asc" ? "asc" : search["dir"] === "desc" ? "desc" : defaultDir;

  const toggle = useCallback(
    (next: string) => {
      const nextDir: SortDir = next === field ? (dir === "asc" ? "desc" : "asc") : newColumnDir;
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          sort: next === defaultField && nextDir === defaultDir ? undefined : next,
          dir: next === defaultField && nextDir === defaultDir ? undefined : nextDir,
          page: undefined,
        }),
        replace: true,
      } as never);
    },
    [field, dir, navigate, defaultField, defaultDir, newColumnDir],
  );

  return {
    field,
    dir,
    toggle,
    isDefault: field === defaultField && dir === defaultDir,
    key: `${field}:${dir}`,
  };
}

/** Clickable sortable table header cell. */
export function SortableTh({
  field,
  sort,
  children,
  className = "",
  align = "left",
}: {
  field: string;
  sort: UrlSort;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sort.field === field;
  return (
    <th className={`px-4 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(field)}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={
          "group inline-flex items-center gap-1 rounded font-inherit hover:text-primary " +
          (align === "right" ? "flex-row-reverse" : "") +
          (active ? " text-primary" : "")
        }
      >
        <span>{children}</span>
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60" />
        )}
      </button>
    </th>
  );
}

/* --------------------------------------------------------- clear filters */

/**
 * Returns a callback that removes every table state param from the URL
 * (search term, sort, direction, page, size and any extra keys passed in).
 * Pass `onReset` to also clear local (non-URL) filter state.
 */
export function useClearTableFilters(extraKeys: string[] = [], onReset?: () => void) {
  const navigate = useNavigate();
  return useCallback(() => {
    onReset?.();
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        for (const k of ["q", "uq", "sort", "dir", "page", "size", ...extraKeys]) delete next[k];
        return next;
      },
      replace: true,
    } as never);
  }, [navigate, extraKeys, onReset]);
}

export function ClearFiltersButton({
  active,
  onClear,
  className,
}: {
  active: boolean;
  onClear: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!active}
      onClick={onClear}
      className={className}
      title="Reset search, filters and sorting"
    >
      <FilterX className="mr-1 h-4 w-4" /> Clear filters
    </Button>
  );
}

/* ------------------------------------------------------------------ exports */

export function ExportButtons({
  onCsv,
  onPdf,
  busy,
  disabled,
}: {
  onCsv: () => void;
  onPdf: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onCsv} disabled={busy || disabled}>
        <Download className="mr-1 h-4 w-4" /> CSV
      </Button>
      <Button variant="outline" size="sm" onClick={onPdf} disabled={busy || disabled}>
        <FileText className="mr-1 h-4 w-4" /> PDF
      </Button>
    </div>
  );
}
