import type { LucideIcon } from "lucide-react";
import { Baby, HeartCrack, Heart, ShieldCheck, Gavel, CreditCard, Timer } from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { useCivilKpis, type CivilKpis } from "@/hooks/useCivilKpis";

// Task 14-C: sibling to ServiceKpiWidgetRow (same shared KpiCard primitive
// Task 12-B extracted for the credential queue) -- wired to
// get_civil_kpis() rather than a fork of either existing widget row.
const WIDGETS: {
  key: keyof CivilKpis;
  titleAm: string;
  titleEn: string;
  icon: LucideIcon;
  color: string;
  format?: (v: number | null) => string;
}[] = [
  {
    key: "registered_this_month_birth",
    titleAm: "የተመዘገበ ልደት (ወር)",
    titleEn: "Births Registered (Month)",
    icon: Baby,
    color: "bg-blue-50 text-blue-700",
  },
  {
    key: "registered_this_month_death",
    titleAm: "የተመዘገበ ሞት (ወር)",
    titleEn: "Deaths Registered (Month)",
    icon: HeartCrack,
    color: "bg-slate-100 text-slate-700",
  },
  {
    key: "registered_this_month_marriage",
    titleAm: "የተመዘገበ ጋብቻ (ወር)",
    titleEn: "Marriages Registered (Month)",
    icon: Heart,
    color: "bg-rose-50 text-rose-700",
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
    key: "avg_turnaround_days",
    titleAm: "አማካይ የማጠናቀቂያ ጊዜ",
    titleEn: "Avg. Turnaround (days)",
    icon: Timer,
    color: "bg-slate-100 text-slate-700",
    format: (v) => (v === null ? "—" : String(v)),
  },
];

export function CivilKpiWidgetRow() {
  const kpisQuery = useCivilKpis();

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
