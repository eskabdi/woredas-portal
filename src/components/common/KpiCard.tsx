import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiCardProps {
  titleAm: string;
  titleEn: string;
  value: number | string;
  icon: LucideIcon;
  color?: string;
  isLoading?: boolean;
  /** Small corner badge (master_design_system.md §4.2 KPI cards) -- always a
   * real, computed figure (e.g. "+3 this month"), never an invented percentage. */
  badge?: { text: string; tone: "up" | "down" | "neutral" };
  /** One line under the value, e.g. "compared to last month". */
  subtext?: string;
}

const BADGE_TONE_CLASS: Record<NonNullable<KpiCardProps["badge"]>["tone"], string> = {
  up: "bg-emerald-50 text-emerald-700",
  down: "bg-red-50 text-red-700",
  neutral: "bg-slate-100 text-slate-600",
};

export function KpiCard({
  titleAm,
  titleEn,
  value,
  icon: Icon,
  color = "bg-blue-50 text-blue-700",
  isLoading = false,
  badge,
  subtext,
}: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="font-am-body truncate text-sm font-medium text-slate-700">{titleAm}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{titleEn}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          {badge && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONE_CLASS[badge.tone]}`}
            >
              {badge.text}
            </span>
          )}
        </div>
      </div>
      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-3xl font-semibold text-slate-900">{value}</p>
        )}
      </div>
      {subtext && <p className="font-am-body mt-1 text-xs text-slate-400">{subtext}</p>}
    </div>
  );
}
