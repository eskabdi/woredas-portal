import type { LucideIcon } from "lucide-react";
import {
  FilePlus2,
  ShieldCheck,
  Gavel,
  CreditCard,
  BadgeCheck,
  XCircle,
  Timer,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { useServiceKpis, type ServiceKpis } from "@/hooks/useServiceTypes";

// Task 14-B: reuses the same shared `KpiCard` primitive Task 12-B's
// `KpiWidgetRow` extracted for the credential queue (per
// docs/task14a-mapping-memo.md's/12-A's own ordering note on reusing this
// row shape rather than forking it) -- `KpiWidgetRow` itself stays
// credential-specific, so this is a sibling widget row wired to
// get_service_kpis() rather than a fork of it. Scoped to category='letter'
// (get_service_kpis()'s own scope, see docs/task14b-mapping-memo.md §7).
const WIDGETS: {
  key: keyof ServiceKpis;
  titleAm: string;
  titleEn: string;
  icon: LucideIcon;
  color: string;
  format?: (v: number | null) => string;
}[] = [
  {
    key: "new_today",
    titleAm: "ዛሬ የገቡ",
    titleEn: "New Today",
    icon: FilePlus2,
    color: "bg-blue-50 text-blue-700",
  },
  {
    key: "pending_verification",
    titleAm: "በማረጋገጫ ላይ",
    titleEn: "Pending Verification",
    icon: ShieldCheck,
    color: "bg-indigo-50 text-indigo-700",
  },
  {
    key: "pending_approval",
    titleAm: "በማጽደቅ ላይ",
    titleEn: "Pending Approval",
    icon: Gavel,
    color: "bg-violet-50 text-violet-700",
  },
  {
    key: "awaiting_payment",
    titleAm: "ክፍያ በመጠበቅ ላይ",
    titleEn: "Awaiting Payment",
    icon: CreditCard,
    color: "bg-amber-50 text-amber-700",
  },
  {
    key: "issued_this_month",
    titleAm: "በዚህ ወር የተሰጡ",
    titleEn: "Issued This Month",
    icon: BadgeCheck,
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "rejected_this_month",
    titleAm: "በዚህ ወር ውድቅ የተደረጉ",
    titleEn: "Rejected This Month",
    icon: XCircle,
    color: "bg-rose-50 text-rose-700",
  },
  {
    key: "avg_turnaround_days",
    titleAm: "አማካይ የማጠናቀቂያ ጊዜ",
    titleEn: "Avg. Turnaround (days)",
    icon: Timer,
    color: "bg-slate-100 text-slate-700",
    format: (v) => (v === null ? "—" : String(v)),
  },
];

export function ServiceKpiWidgetRow() {
  const kpisQuery = useServiceKpis();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {WIDGETS.map((w) => {
        const raw = kpisQuery.data?.[w.key] ?? null;
        const value = kpisQuery.isError ? "—" : w.format ? w.format(raw) : (raw ?? "—");
        return (
          <KpiCard
            key={w.key}
            titleAm={w.titleAm}
            titleEn={w.titleEn}
            icon={w.icon}
            color={w.color}
            value={value}
            isLoading={kpisQuery.isLoading}
          />
        );
      })}
    </div>
  );
}
