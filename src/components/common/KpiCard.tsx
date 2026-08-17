import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiCardProps {
  titleAm: string;
  titleEn: string;
  value: number | string;
  icon: LucideIcon;
  color?: string;
  isLoading?: boolean;
}

export function KpiCard({
  titleAm,
  titleEn,
  value,
  icon: Icon,
  color = "bg-blue-50 text-blue-700",
  isLoading = false,
}: KpiCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="font-noto-ethiopic text-sm font-medium text-slate-700 truncate">
            {titleAm}
          </p>
          <p className="mt-0.5 text-xs text-slate-400 truncate">{titleEn}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-3xl font-semibold text-slate-900">{value}</p>
        )}
      </div>
    </div>
  );
}
