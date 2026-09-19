import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/charts/ChartCard";
import { CHART_GRID_COLOR, CHART_SECONDARY } from "@/components/charts/palette";

export function LineChartCard<T extends Record<string, unknown>>({
  titleAm,
  titleEn,
  data,
  xKey,
  yKey,
  color = CHART_SECONDARY,
  height,
  loading,
}: {
  titleAm?: string;
  titleEn: string;
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  color?: string;
  height?: number;
  loading?: boolean;
}) {
  return (
    <ChartCard titleAm={titleAm} titleEn={titleEn} loading={loading} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={height ?? "100%"}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
