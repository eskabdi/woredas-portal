import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "@/components/charts/ChartCard";
import { CHART_GRID_COLOR, CHART_PRIMARY } from "@/components/charts/palette";

export function BarChartCard<T extends Record<string, unknown>>({
  titleAm,
  titleEn,
  data,
  xKey,
  yKey,
  valueLabel,
  color = CHART_PRIMARY,
  height,
  loading,
  /** Angle the x-axis labels for long category names (docs/ux Cluster E's report bar charts). */
  angledLabels,
  formatter,
}: {
  titleAm?: string;
  titleEn: string;
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  valueLabel?: string;
  color?: string;
  height?: number;
  loading?: boolean;
  angledLabels?: boolean;
  formatter?: (value: number) => string;
}) {
  return (
    <ChartCard titleAm={titleAm} titleEn={titleEn} loading={loading} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={height ?? "100%"}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={!angledLabels} />
          {/* Recharts' own defaultProps merge only backfills a key that's absent from
              props, not one explicitly set to `undefined` -- passing height={undefined}
              here (instead of omitting it) left the axis height, and everything computed
              from it (the plot area's clip-path height, every bar's height), as NaN. */}
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11 }}
            {...(angledLabels
              ? { interval: 0, angle: -20, height: 50, textAnchor: "end" as const }
              : {})}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={formatter ? (v: number) => formatter(v) : undefined} />
          <Bar
            dataKey={yKey}
            name={valueLabel}
            fill={color}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
