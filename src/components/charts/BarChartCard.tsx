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
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11 }}
            interval={angledLabels ? 0 : undefined}
            angle={angledLabels ? -20 : undefined}
            height={angledLabels ? 50 : undefined}
            textAnchor={angledLabels ? "end" : undefined}
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
