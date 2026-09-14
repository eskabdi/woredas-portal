import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartCard } from "@/components/charts/ChartCard";
import { CHART_SERIES_COLORS } from "@/components/charts/palette";

export function PieChartCard<T extends Record<string, unknown>>({
  titleAm,
  titleEn,
  data,
  nameKey,
  valueKey,
  height,
  loading,
  formatter,
}: {
  titleAm?: string;
  titleEn: string;
  data: T[];
  nameKey: keyof T & string;
  valueKey: keyof T & string;
  height?: number;
  loading?: boolean;
  formatter?: (value: number) => string;
}) {
  return (
    <ChartCard titleAm={titleAm} titleEn={titleEn} loading={loading} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={height ?? "100%"}>
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={nameKey} outerRadius={80} label>
            {data.map((row, i) => (
              <Cell
                key={String(row[nameKey])}
                fill={CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length]}
              />
            ))}
          </Pie>
          <Legend />
          <Tooltip formatter={formatter ? (v: number) => formatter(v) : undefined} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
