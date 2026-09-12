import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, FilterX, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

/* ------------------------------------------------------------- FilterGroup */

/**
 * A single labeled filter dropdown, shared across every list screen instead
 * of each route defining its own local copy (docs/ux/ux_pattern_map.md,
 * Cluster A). Visual style follows TableToolbar's pill treatment below --
 * always used inside a <TableToolbar>, never standalone.
 */
export function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1">
      <span className="font-am-heading text-xs font-medium text-slate-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-am-body bg-transparent px-1 py-0.5 text-sm focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* --------------------------------------------------------------- TableToolbar */

/**
 * The floating, translucent list-screen toolbar from the design system
 * (master_design_system.md §3.A: "Floating Toolbar... bg-slate-100/80
 * focus:bg-white... pill select dropdowns... segmented export pills").
 * Replaces the flat, bordered `rounded-xl border bg-white` card every list
 * screen previously hand-rolled (docs/ux/ux_pattern_map.md, Cluster A;
 * docs/ux/ux_restructure_plan.md, "New shared TableToolbar component").
 *
 * Composition, not configuration: pass `filters` as a row of <FilterGroup>
 * elements (each screen has different filters) rather than a filter-schema
 * prop, since the schema-driven version would need to grow an escape hatch
 * for every screen's one-off filter anyway (date ranges, KebeleFilter, etc.)
 * -- see the screens already migrated for the pattern.
 */
export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  clearActive,
  onClear,
  onExportCsv,
  onExportPdf,
  exportBusy,
  exportDisabled,
}: {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  filters?: React.ReactNode;
  clearActive: boolean;
  onClear: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
  exportBusy?: boolean;
  exportDisabled?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="font-am-body border-slate-200 bg-slate-100/80 pl-10 focus:bg-white"
        />
      </div>
      {filters && <div className="flex flex-wrap gap-2">{filters}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-3">
        <ClearFiltersButton active={clearActive} onClear={onClear} />
        <ExportButtons
          onCsv={onExportCsv}
          onPdf={onExportPdf}
          busy={exportBusy}
          disabled={exportDisabled}
        />
      </div>
    </div>
  );
}
