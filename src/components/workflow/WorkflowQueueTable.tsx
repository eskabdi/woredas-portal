import type { ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { PermissionGate } from "@/components/common/PermissionGate";
import {
  TablePagination,
  useUrlPagination,
  useUrlSearchTerm,
} from "@/components/common/TablePagination";
import { TableSkeletonRows, TableEmptyRow, TableErrorRow } from "@/components/common/TableStates";
import { useUrlSort, SortableTh, useClearTableFilters } from "@/components/common/TableToolbar";
import type { Permission } from "@/config/permissions";

/** Task 14-C: the URL-persisted filter/sort/pagination state Task 12-B's
 * CredentialQueueTable owned inline -- extracted so civil registration and
 * service requests get the exact same server-side filter shape (status ·
 * type · kebele · officer · date range) and URL persistence instead of
 * each route re-deriving its own. A route's Supabase query still lives in
 * the route/hook that knows its own joins; this only owns the filter
 * *state*, not the query itself, since the three entities' underlying
 * queries differ too much (different tables, different embeds) to share
 * one query builder without forcing an awkward abstraction over it. */
export function useWorkflowQueueFilters() {
  const { input: searchInput, setInput: setSearchInput, term: search } = useUrlSearchTerm();
  const status = useUrlFilter("status");
  const type = useUrlFilter("type");
  const kebele = useUrlFilter("kebele");
  const officer = useUrlFilter("officer");
  const dateFrom = useUrlFilter("from");
  const dateTo = useUrlFilter("to");
  const sort = useUrlSort("created_at", "desc");
  const { page, setPage, pageSize, setPageSize } = useUrlPagination(
    [
      search,
      status.value,
      type.value,
      kebele.value,
      officer.value,
      dateFrom.value,
      dateTo.value,
      sort.key,
    ].join("|"),
  );

  const resetFilters = () => {
    status.set("all");
    type.set("all");
    kebele.set("all");
    officer.set("all");
    dateFrom.set("");
    dateTo.set("");
    setSearchInput("");
  };
  const clearFilters = useClearTableFilters([], resetFilters);
  const active =
    !!search ||
    status.value !== "all" ||
    type.value !== "all" ||
    kebele.value !== "all" ||
    officer.value !== "all" ||
    !!dateFrom.value ||
    !!dateTo.value;

  return {
    searchInput,
    setSearchInput,
    search,
    status,
    type,
    kebele,
    officer,
    dateFrom,
    dateTo,
    sort,
    page,
    setPage,
    pageSize,
    setPageSize,
    clearFilters,
    active,
  };
}

export type WorkflowQueueFilters = ReturnType<typeof useWorkflowQueueFilters>;

/** A minimal URL-persisted single filter value -- same
 * useSearch()/navigate({search: prev => ...}) convention useUrlSort already
 * uses in this codebase, rather than reading window.location directly. */
function useUrlFilter(paramName: string): { value: string; set: (v: string) => void } {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const isDateParam = paramName === "from" || paramName === "to";
  const raw = search[paramName];
  const value = typeof raw === "string" && raw ? raw : isDateParam ? "" : "all";
  const set = (v: string) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        [paramName]: v === "all" || v === "" ? undefined : v,
        page: undefined,
      }),
      replace: true,
    } as never);
  };
  return { value, set };
}

/** Elapsed whole days since a submitted/created timestamp, bilingual --
 * shared across the three queues instead of each computing its own. */
export function waitingDaysLabel(sinceIso: string | null): string {
  if (!sinceIso) return "—";
  const days = Math.floor((Date.now() - new Date(sinceIso).getTime()) / 86_400_000);
  return `${days} ${days === 1 ? "ቀን" : "ቀናት"}`;
}

export interface QueueColumn<Row> {
  key: string;
  am: string;
  en: string;
  sortField?: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
}

export interface QueueQuickAction {
  icon: React.ComponentType<{ className?: string }>;
  permission: Permission;
  labelAm: string;
  labelEn: string;
}

interface SelectOption {
  value: string;
  label: string;
}

interface WorkflowQueueTableProps<Row> {
  filters: WorkflowQueueFilters;
  searchPlaceholder: string;
  statusOptions: SelectOption[];
  typeOptions?: SelectOption[];
  typeLabel?: string;
  kebeleOptions?: SelectOption[];
  officerOptions?: SelectOption[];
  showDateRange?: boolean;
  columns: QueueColumn<Row>[];
  rows: Row[];
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  rowKey: (row: Row) => string;
  onRowClick: (row: Row) => void;
  quickActionFor?: (row: Row) => QueueQuickAction | null;
  emptyAction?: ReactNode;
}

/** Task 14-C: CredentialQueueTable generalized into one entity-parameterized
 * table component, reused (not forked) by credentials, civil registration,
 * and service requests/complaints. Each caller supplies its own column
 * render functions and its own filter option lists (status/type/kebele/
 * officer come from each entity's own catalog) -- the shared surface is the
 * filter bar layout, sort headers, loading/empty/error states, the
 * permission-gated quick-action button, and pagination. */
export function WorkflowQueueTable<Row>({
  filters,
  searchPlaceholder,
  statusOptions,
  typeOptions,
  typeLabel = "ዓይነት / Type",
  kebeleOptions,
  officerOptions,
  showDateRange = true,
  columns,
  rows,
  totalCount,
  isLoading,
  isError,
  error,
  onRetry,
  rowKey,
  onRowClick,
  quickActionFor,
  emptyAction,
}: WorkflowQueueTableProps<Row>) {
  const cols = columns.length + (quickActionFor ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <Input
          value={filters.searchInput}
          onChange={(e) => filters.setSearchInput(e.target.value)}
          placeholder={searchPlaceholder}
          className="font-noto-ethiopic"
        />
        <div className="flex flex-wrap items-end gap-2">
          <SelectFilter
            label="ሁኔታ / Status"
            value={filters.status.value}
            onChange={(v) => {
              filters.status.set(v);
              filters.setPage(0);
            }}
            options={[{ value: "all", label: "ሁሉም / All" }, ...statusOptions]}
          />
          {typeOptions && (
            <SelectFilter
              label={typeLabel}
              value={filters.type.value}
              onChange={(v) => {
                filters.type.set(v);
                filters.setPage(0);
              }}
              options={[{ value: "all", label: "ሁሉም / All" }, ...typeOptions]}
            />
          )}
          {kebeleOptions && (
            <SelectFilter
              label="ቀበሌ / Kebele"
              value={filters.kebele.value}
              onChange={(v) => {
                filters.kebele.set(v);
                filters.setPage(0);
              }}
              options={[{ value: "all", label: "ሁሉም / All" }, ...kebeleOptions]}
            />
          )}
          {officerOptions && (
            <SelectFilter
              label="ባለሙያ / Officer"
              value={filters.officer.value}
              onChange={(v) => {
                filters.officer.set(v);
                filters.setPage(0);
              }}
              options={[{ value: "all", label: "ሁሉም / All" }, ...officerOptions]}
            />
          )}
          {showDateRange && (
            <>
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="text-xs font-medium text-slate-500">ከ / From:</span>
                <EthiopianDateInput
                  value={filters.dateFrom.value}
                  onChange={(v) => {
                    filters.dateFrom.set(v);
                    filters.setPage(0);
                  }}
                />
              </div>
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="text-xs font-medium text-slate-500">እስከ / To:</span>
                <EthiopianDateInput
                  value={filters.dateTo.value}
                  onChange={(v) => {
                    filters.dateTo.set(v);
                    filters.setPage(0);
                  }}
                />
              </div>
            </>
          )}
          {filters.active && (
            <Button variant="ghost" size="sm" onClick={filters.clearFilters}>
              አጽዳ / Clear
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c) =>
                c.sortField ? (
                  <SortableTh key={c.key} field={c.sortField} sort={filters.sort}>
                    <span className="font-noto-ethiopic">{c.am}</span>
                    <span className="ml-1 text-slate-400 normal-case">/ {c.en}</span>
                  </SortableTh>
                ) : (
                  <Th key={c.key} am={c.am} en={c.en} />
                ),
              )}
              {quickActionFor && <Th am="ፈጣን እርምጃ" en="Quick Action" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <TableSkeletonRows cols={cols} />}
            {isError && <TableErrorRow cols={cols} error={error} onRetry={onRetry} />}
            {!isLoading && !isError && rows.length === 0 && (
              <TableEmptyRow
                cols={cols}
                filtered={filters.active}
                onClearFilters={filters.clearFilters}
              >
                {!filters.active && emptyAction}
              </TableEmptyRow>
            )}
            {rows.map((row) => {
              const action = quickActionFor?.(row) ?? null;
              return (
                <tr
                  key={rowKey(row)}
                  className="cursor-pointer transition hover:bg-blue-50/40"
                  onClick={() => onRowClick(row)}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {quickActionFor && (
                    <td className="px-4 py-3">
                      {action && (
                        <PermissionGate permission={action.permission}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRowClick(row);
                            }}
                          >
                            <action.icon className="mr-1.5 h-3.5 w-3.5" />
                            <span className="font-noto-ethiopic">{action.labelAm}</span>
                            <span className="ml-1 opacity-70">/ {action.labelEn}</span>
                          </Button>
                        </PermissionGate>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TablePagination
        page={filters.page}
        pageSize={filters.pageSize}
        total={totalCount}
        onPageChange={filters.setPage}
        onPageSizeChange={filters.setPageSize}
        className="rounded-lg border bg-white"
      />
    </div>
  );
}

function Th({ am, en }: { am: string; en: string }) {
  return (
    <th className="px-4 py-3">
      <span className="font-noto-ethiopic">{am}</span>
      <span className="ml-1 text-slate-400 normal-case">/ {en}</span>
    </th>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
      <span className="font-noto-ethiopic text-xs font-medium text-slate-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-noto-ethiopic bg-transparent px-1 py-0.5 text-sm focus:outline-none"
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
