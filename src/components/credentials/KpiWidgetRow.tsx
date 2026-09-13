import type { LucideIcon } from "lucide-react";
import {
  FilePlus2,
  ShieldCheck,
  Gavel,
  CreditCard,
  Printer,
  BadgeCheck,
  RotateCcw,
  XCircle,
  Ban,
  Timer,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { useCredentialKpis, type CredentialKpis } from "@/hooks/useCredentialRequests";

const WIDGETS: {
  key: keyof CredentialKpis;
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
    key: "ready_or_printing",
    titleAm: "ለህትመት ዝግጁ/በህትመት ላይ",
    titleEn: "Ready/Printing",
    icon: Printer,
    color: "bg-cyan-50 text-cyan-700",
  },
  {
    key: "issued_this_month",
    titleAm: "በዚህ ወር የተሰጡ",
    titleEn: "Issued This Month",
    icon: BadgeCheck,
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "returned_rate_pct",
    titleAm: "የመመለሻ መጠን",
    titleEn: "Return Rate",
    icon: RotateCcw,
    color: "bg-amber-50 text-amber-700",
    format: (v) => (v === null ? "—" : `${v}%`),
  },
  {
    key: "rejected_this_month",
    titleAm: "በዚህ ወር ውድቅ የተደረጉ",
    titleEn: "Rejected This Month",
    icon: XCircle,
    color: "bg-rose-50 text-rose-700",
  },
  {
    key: "blocked",
    titleAm: "የታገዱ",
    titleEn: "Blocked",
    icon: Ban,
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

/** Task 12.3's 10 KPI widgets for the credential queue, built on the shared
 * `KpiCard` primitive. Counts come from useCredentialKpis()
 * (get_credential_kpis() RPC) -- server-counted, tenant-scoped internally,
 * never derived from a list page's own paginated query result. Exported as
 * a shared component: Task 14 (civil registration + service requests)
 * reuses this row shape rather than forking it, per the 12-A/12-B ordering
 * note in docs/task12-mapping-memo.md. */
export function KpiWidgetRow() {
  const kpisQuery = useCredentialKpis();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
