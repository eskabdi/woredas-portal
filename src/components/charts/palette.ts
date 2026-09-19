/**
 * Shared chart color palette (master_design_system.md §3.E / docs/ux/ux_restructure_plan.md Cluster E:
 * "pre-themed bar/pie/donut presets ... that the three dashboard/report route files import instead of
 * each defining Recharts config inline"). Values match the blue/multi-series palette all three files
 * already converged on independently (`#1d4ed8` for a single-series bar/line, the same 7-color rotation
 * for a pie's series) — consolidated here as the one place that palette is defined, not changed.
 */
export const CHART_PRIMARY = "#1d4ed8";
export const CHART_SECONDARY = "#059669";

export const CHART_SERIES_COLORS = [
  "#1d4ed8",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
];

export const CHART_GRID_COLOR = "#e2e8f0";
