import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Users,
  Home,
  UserPlus,
  Clock,
  CreditCard,
  Banknote,
  AlertTriangle,
  LayoutDashboard,
  UserCheck,
  FileWarning,
  ChevronRight,
  UserPlus2,
  Building2,
  ScrollText,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { BarChartCard } from "@/components/charts/BarChartCard";
import { LineChartCard } from "@/components/charts/LineChartCard";
import { PieChartCard } from "@/components/charts/PieChartCard";

import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { PermissionGate } from "@/components/common/PermissionGate";
import { P } from "@/config/permissions";
import { KpiCard } from "@/components/common/KpiCard";
import { ethiopianMonthLabel } from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/woreda/dashboard")({
  ssr: false,
  component: WoredaDashboard,
});

function startOfDayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

type RegPeriod = "weekly" | "monthly" | "quarterly";

// Amharic labels for audit_log.action_type -- covers the action types this
// dashboard's Recent System Activities feed can actually surface (woreda-
// scoped rows only; console/platform-level action types never appear here).
const ACTION_LABELS_AM: Record<string, string> = {
  RESIDENT_CREATED: "ነዋሪ ተመዝግቧል",
  RESIDENT_UPDATED: "የነዋሪ መረጃ ተሻሽሏል",
  RESIDENT_SUSPENDED: "ነዋሪ ታግዷል",
  RESIDENT_REACTIVATED: "ነዋሪ ዳግም ነቅቷል",
  RESIDENT_DEACTIVATED: "ነዋሪ ወደ ኢ-ንቁ ተቀይሯል",
  RESIDENT_ACTIVATED: "ነዋሪ ወደ ንቁ ተመልሷል",
  HOUSEHOLD_CREATED: "ቤተሰብ ተመዝግቧል",
  HOUSEHOLD_UPDATED: "የቤተሰብ መረጃ ተሻሽሏል",
  HOUSEHOLD_ASSIGNED: "ወደ ቤተሰብ ተጨምሯል",
  HOUSEHOLD_DEACTIVATED: "ቤተሰብ ወደ ኢ-ንቁ ተቀይሯል",
  HEAD_CHANGED: "የቤተሰብ አስተዳዳሪ ተቀይሯል",
  CREDENTIAL_ISSUED: "መታወቂያ ተሰጥቷል",
  CREDENTIAL_PRINTED: "መታወቂያ ታትሟል",
  CREDENTIAL_REPRINTED: "መታወቂያ ዳግም ታትሟል",
  CREDENTIAL_REVOKED: "መታወቂያ ተሰርዟል",
  CREDENTIAL_SUSPENDED: "መታወቂያ ታግዷል",
  CREDENTIAL_REACTIVATED: "መታወቂያ ዳግም ነቅቷል",
  BIRTH_REGISTERED: "የልደት ምዝገባ",
  DEATH_REGISTERED: "የሞት ምዝገባ",
  MARRIAGE_REGISTERED: "የጋብቻ ምዝገባ",
  DIVORCE_REGISTERED: "የፍቺ ምዝገባ",
  SERVICE_REQUEST_SUBMITTED: "የአገልግሎት ጥያቄ ገብቷል",
  SERVICE_REQUEST_AWAITING_PAYMENT: "ክፍያ በመጠባበቅ ላይ",
  SERVICE_REQUEST_PAID: "ክፍያ ተፈጽሟል",
  REQUEST_SUBMITTED: "ጥያቄ ገብቷል",
  REQUEST_APPROVED: "ጥያቄ ጸድቋል",
  REQUEST_REJECTED: "ጥያቄ ተቀባይነት አላገኘም",
  REQUEST_RETURNED: "ጥያቄ ተመልሷል",
  REQUEST_RESUBMITTED: "ጥያቄ ዳግም ገብቷል",
  REQUEST_VERIFIED: "ጥያቄ ተረጋግጧል",
  REQUEST_APPROVAL_RETURNED: "ማጽደቅ ተመልሷል",
  RENTAL_HOUSE_CREATED: "የኪራይ ቤት ተመዝግቧል",
  RENTAL_HOUSE_UPDATED: "የኪራይ ቤት መረጃ ተሻሽሏል",
  RENTAL_REQUEST_CREATED: "የኪራይ ጥያቄ ገብቷል",
  RENTAL_REQUEST_APPROVED: "የኪራይ ጥያቄ ጸድቋል",
  RENTAL_REQUEST_REJECTED: "የኪራይ ጥያቄ ተቀባይነት አላገኘም",
  RENTAL_REQUEST_RETURNED: "የኪራይ ጥያቄ ተመልሷል",
  RENTAL_REQUEST_VERIFIED: "የኪራይ ጥያቄ ተረጋግጧል",
  RENTAL_VACATE_REQUESTED: "ቤት የመልቀቅ ጥያቄ ገብቷል",
  RENTAL_PAYMENT_COLLECTED: "የኪራይ ክፍያ ተሰብስቧል",
  PAYMENT_COLLECTED: "ክፍያ ተሰብስቧል",
  PAYMENT_WAIVED: "ክፍያ ተነስቷል",
  RECEIPT_PRINTED: "ደረሰኝ ታትሟል",
  RECEIPT_REPRINTED: "ደረሰኝ ዳግም ታትሟል",
  FEE_SCHEDULE_CREATED: "የክፍያ ተመን ተመዝግቧል",
  FEE_SCHEDULE_UPDATED: "የክፍያ ተመን ተሻሽሏል",
  SERVICE_TYPE_CREATED: "የአገልግሎት አይነት ተመዝግቧል",
  SERVICE_TYPE_UPDATED: "የአገልግሎት አይነት ተሻሽሏል",
  SERVICE_TYPE_DELETED: "የአገልግሎት አይነት ተሰርዟል",
  SETTINGS_UPDATED: "ቅንብሮች ተሻሽለዋል",
  USER_SUSPENDED: "ተጠቃሚ ታግዷል",
  USER_PERMISSION_OVERRIDE_SET: "የተጠቃሚ ፈቃድ ተስተካክሏል",
  USER_PERMISSION_OVERRIDE_CLEARED: "የተጠቃሚ ፈቃድ ማስተካከያ ተነስቷል",
  USER_PERMISSION_OVERRIDES_CLEARED: "የተጠቃሚ ፈቃድ ማስተካከያዎች ተነስተዋል",
  ROLE_PERMISSION_UPDATED: "የሚና ፈቃድ ተሻሽሏል",
  ROLE_PERMISSION_GRANTED: "የሚና ፈቃድ ተሰጥቷል",
  ROLE_PERMISSION_DENIED: "የሚና ፈቃድ ተከልክሏል",
  USER_ROLE_ASSIGNED: "ሚና ለተጠቃሚ ተሰጥቷል",
  USER_ROLE_CHANGED: "የተጠቃሚ ሚና ተቀይሯል",
  ROLE_CREATED: "ሚና ተመዝግቧል",
  ROLE_UPDATED: "ሚና ተሻሽሏል",
  ROLE_DEACTIVATED: "ሚና ተሰርዟል",
  CREDENTIAL_REPLACED: "መታወቂያ ተተክቷል",
  TEMPLATE_PUBLISHED: "ቅጽ ታትሟል",
  TENANT_MODULE_TOGGLED: "ሞጁል ተቀይሯል",
};

function actionLabelAm(action: string): string {
  return ACTION_LABELS_AM[action] ?? action.replaceAll("_", " ");
}

const QUICK_ACTIONS = [
  { am: "አዲስ ነዋሪ ምዝገባ", en: "New Resident", icon: UserPlus2, href: "/woreda/residents/new" },
  { am: "የመታወቂያ ጥያቄ", en: "Credential Request", icon: CreditCard, href: "/woreda/credentials/new" },
  { am: "የቤት ኪራይ", en: "Rental Houses", icon: Building2, href: "/woreda/rental-houses" },
  { am: "አገልግሎት ጥያቄ", en: "Service Request", icon: ScrollText, href: "/woreda/services/new" },
];

function QuickActionsCard() {
  return (
    <div className="rounded-2xl bg-[#0F2038] p-5 text-white shadow-lg">
      <h3 className="font-am-heading text-sm font-semibold">ፈጣን ተግባራት</h3>
      <p className="text-xs text-slate-300">Quick Actions</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            to={a.href}
            className="flex flex-col items-center gap-2 rounded-xl bg-white/5 p-3 text-center ring-1 ring-white/10 transition hover:bg-white/10"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
              <a.icon className="h-4.5 w-4.5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <p className="font-am-body truncate text-xs font-medium text-white">{a.am}</p>
              <p className="truncate text-[10px] text-slate-400">{a.en}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PriorityTaskRow({
  icon: Icon,
  color,
  titleAm,
  titleEn,
  count,
  href,
}: {
  icon: typeof Clock;
  color: string;
  titleAm: string;
  titleEn: string;
  count: number;
  href: string;
}) {
  if (count === 0) return null;
  return (
    <Link
      to={href}
      className="flex items-center gap-3 rounded-xl p-2.5 transition hover:bg-slate-50"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-am-body text-sm font-medium text-slate-800">
          {count} {titleAm}
        </p>
        <p className="text-xs text-slate-400">{titleEn}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </Link>
  );
}

function WoredaDashboard() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewAudit = hasPermission(P.AUDIT_VIEW);
  const [regPeriod, setRegPeriod] = useState<RegPeriod>("monthly");
  const [genderScope, setGenderScope] = useState<"woreda" | "kebele">("woreda");
  const [genderKebeleId, setGenderKebeleId] = useState<string | null>(null);

  const totalResidents = useQuery({
    queryKey: ["dash", woredaId, "residents"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("resident")
        .select("resident_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const activeHouseholds = useQuery({
    queryKey: ["dash", woredaId, "households"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("household")
        .select("household_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string)
        .eq("active_flag", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const newToday = useQuery({
    queryKey: ["dash", woredaId, "new-today"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("resident")
        .select("resident_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string)
        .gte("created_at", startOfDayISO());
      if (error) throw error;
      return count ?? 0;
    },
  });

  const pendingApprovals = useQuery({
    queryKey: ["dash", woredaId, "pending-approvals"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("residence_credential")
        .select("credential_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string)
        .eq("status", "pending_approval");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const credentialsThisMonth = useQuery({
    queryKey: ["dash", woredaId, "credentials-month"],
    enabled: !!woredaId,
    queryFn: async () => {
      const d = new Date();
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      const { count, error } = await supabase
        .from("residence_credential")
        .select("credential_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string)
        .gte("created_at", monthStart);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const revenueToday = useQuery({
    queryKey: ["dash", woredaId, "revenue-today"],
    enabled: !!woredaId,
    queryFn: async () => {
      // payment_decrypted isn't in the generated types yet (00000000000023_
      // pii_encryption.sql) -- same untyped-client cast pattern already used
      // elsewhere in this codebase for pre-typegen tables.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error } = await db
        .from("payment_decrypted")
        .select("amount, amount_decrypted")
        .eq("woreda_id", woredaId as string)
        .gte("payment_date", new Date().toISOString().slice(0, 10));
      if (error) throw error;
      // amount is NOT NULL on the base table -- falling back to it when
      // amount_decrypted comes back NULL (decrypt_pii_numeric failing, fail-
      // soft by design) keeps this KPI from silently under-reporting revenue
      // that /woreda/revenue (which has the same fallback) still shows.
      return (data ?? []).reduce(
        (s: number, r: { amount: number; amount_decrypted: number | null }) =>
          s + Number(r.amount_decrypted ?? r.amount),
        0,
      );
    },
  });

  const expiredCredentials = useQuery({
    queryKey: ["dash", woredaId, "expired"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("residence_credential")
        .select("credential_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string)
        .eq("status", "expired");
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Fetched wide (12 months) once; re-bucketed client-side per the segmented
  // toggle rather than re-querying per click -- weekly/monthly/quarterly are
  // all just different groupings of the same created_at values.
  const registrations = useQuery({
    queryKey: ["dash", woredaId, "registrations-12mo"],
    enabled: !!woredaId,
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("resident")
        .select("created_at")
        .eq("woreda_id", woredaId as string)
        .gte("created_at", since.toISOString());
      if (error) throw error;
      return (data ?? []).map((r) => new Date(r.created_at as string));
    },
  });

  const monthlyRegs = (() => {
    const dates = registrations.data ?? [];
    if (regPeriod === "weekly") {
      const buckets = new Map<string, { label: string; count: number; sort: number }>();
      for (let i = 7; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const key = weekStart.toISOString().slice(0, 10);
        buckets.set(key, {
          label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          count: 0,
          sort: weekStart.getTime(),
        });
      }
      dates.forEach((d) => {
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const b = buckets.get(weekStart.toISOString().slice(0, 10));
        if (b) b.count += 1;
      });
      return Array.from(buckets.values()).sort((a, b) => a.sort - b.sort);
    }
    if (regPeriod === "quarterly") {
      const buckets = new Map<string, { label: string; count: number; sort: number }>();
      for (let i = 3; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i * 3);
        const q = Math.floor(d.getMonth() / 3) + 1;
        const key = `${d.getFullYear()}-Q${q}`;
        buckets.set(key, {
          label: `Q${q} ${d.getFullYear()}`,
          count: 0,
          sort: d.getFullYear() * 4 + q,
        });
      }
      dates.forEach((d) => {
        const q = Math.floor(d.getMonth() / 3) + 1;
        const key = `${d.getFullYear()}-Q${q}`;
        const b = buckets.get(key);
        if (b) b.count += 1;
      });
      return Array.from(buckets.values()).sort((a, b) => a.sort - b.sort);
    }
    // monthly (default) -- last 6 months, Ethiopian month labels
    const buckets = new Map<string, { label: string; count: number; sort: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      buckets.set(key, {
        label: ethiopianMonthLabel(d),
        count: 0,
        sort: d.getFullYear() * 12 + d.getMonth(),
      });
    }
    dates.forEach((d) => {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const b = buckets.get(key);
      if (b) b.count += 1;
    });
    return Array.from(buckets.values()).sort((a, b) => a.sort - b.sort);
  })();

  const dailyRevenue = useQuery({
    queryKey: ["dash", woredaId, "daily-revenue"],
    enabled: !!woredaId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 29);
      since.setHours(0, 0, 0, 0);
      // payment_decrypted isn't in the generated types yet (00000000000023_
      // pii_encryption.sql) -- same untyped-client cast pattern already used
      // elsewhere in this codebase for pre-typegen tables.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error } = await db
        .from("payment_decrypted")
        .select("amount, amount_decrypted, payment_date")
        .eq("woreda_id", woredaId as string)
        .gte("payment_date", since.toISOString().slice(0, 10));
      if (error) throw error;
      const buckets = new Map<string, { day: string; amount: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const k = d.toISOString().slice(0, 10);
        buckets.set(k, { day: k.slice(5), amount: 0 });
      }
      // Same fallback as revenueToday above -- a NULL amount_decrypted means
      // decryption failed, not that the payment was free.
      (data ?? []).forEach(
        (r: { payment_date: string; amount: number; amount_decrypted: number | null }) => {
          const k = r.payment_date;
          const b = buckets.get(k);
          if (b) b.amount += Number(r.amount_decrypted ?? r.amount);
        },
      );
      return Array.from(buckets.values());
    },
  });

  // Service requests awaiting verification -- third Priority Tasks item, same
  // "needs someone's attention now" shape as pendingApprovals/expiredCredentials.
  const serviceRequestsPending = useQuery({
    queryKey: ["dash", woredaId, "service-pending"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("service_request")
        .select("service_request_id", { count: "exact", head: true })
        .eq("woreda_id", woredaId as string)
        .in("status", ["submitted", "under_review"]);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Gender distribution -- real resident.sex split, no fabricated figures.
  const genderSplit = useQuery({
    queryKey: ["dash", woredaId, "gender-split"],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("sex")
        .eq("woreda_id", woredaId as string);
      if (error) throw error;
      let male = 0;
      let female = 0;
      (data ?? []).forEach((r) => {
        if (r.sex === "male") male += 1;
        else if (r.sex === "female") female += 1;
      });
      return [
        { name: "ወንድ / Male", value: male },
        { name: "ሴት / Female", value: female },
      ];
    },
  });

  // Population by kebele -- resident has no direct kebele_id; it's derived
  // through current_household_id -> household.kebele_id, so this is a
  // client-side join (three small queries) rather than one filtered count.
  const populationByKebele = useQuery({
    queryKey: ["dash", woredaId, "population-by-kebele"],
    enabled: !!woredaId,
    queryFn: async () => {
      const [
        { data: kebeles, error: kErr },
        { data: households, error: hErr },
        { data: residents, error: rErr },
      ] = await Promise.all([
        supabase
          .from("kebele")
          .select("kebele_id, kebele_name_am, kebele_name_en")
          .eq("woreda_id", woredaId as string),
        supabase
          .from("household")
          .select("household_id, kebele_id")
          .eq("woreda_id", woredaId as string),
        supabase
          .from("resident")
          .select("current_household_id")
          .eq("woreda_id", woredaId as string),
      ]);
      if (kErr) throw kErr;
      if (hErr) throw hErr;
      if (rErr) throw rErr;

      const householdToKebele = new Map<string, string>();
      (households ?? []).forEach((h) => {
        if (h.household_id && h.kebele_id) householdToKebele.set(h.household_id, h.kebele_id);
      });
      const countByKebele = new Map<string, number>();
      (residents ?? []).forEach((r) => {
        const hid = r.current_household_id as string | null;
        if (!hid) return;
        const kid = householdToKebele.get(hid);
        if (!kid) return;
        countByKebele.set(kid, (countByKebele.get(kid) ?? 0) + 1);
      });
      const total = Array.from(countByKebele.values()).reduce((a, b) => a + b, 0);
      return (kebeles ?? [])
        .map((k) => {
          const count = countByKebele.get(k.kebele_id) ?? 0;
          return {
            kebeleId: k.kebele_id,
            am: k.kebele_name_am,
            en: k.kebele_name_en,
            count,
            pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
          };
        })
        .sort((a, b) => b.count - a.count);
    },
  });

  // Gender distribution by kebele -- same household->kebele join pattern as
  // populationByKebele above, scoped to whichever kebele is selected.
  const genderSplitByKebele = useQuery({
    queryKey: ["dash", woredaId, "gender-split-kebele", genderKebeleId],
    enabled: !!woredaId && genderScope === "kebele" && !!genderKebeleId,
    queryFn: async () => {
      const { data: households, error: hErr } = await supabase
        .from("household")
        .select("household_id")
        .eq("woreda_id", woredaId as string)
        .eq("kebele_id", genderKebeleId as string);
      if (hErr) throw hErr;
      const householdIds = (households ?? [])
        .map((h) => h.household_id)
        .filter((id): id is string => !!id);
      if (householdIds.length === 0) {
        return [
          { name: "ወንድ / Male", value: 0 },
          { name: "ሴት / Female", value: 0 },
        ];
      }
      const { data, error } = await supabase
        .from("resident")
        .select("sex")
        .eq("woreda_id", woredaId as string)
        .in("current_household_id", householdIds);
      if (error) throw error;
      let male = 0;
      let female = 0;
      (data ?? []).forEach((r) => {
        if (r.sex === "male") male += 1;
        else if (r.sex === "female") female += 1;
      });
      return [
        { name: "ወንድ / Male", value: male },
        { name: "ሴት / Female", value: female },
      ];
    },
  });

  // Default the kebele selector to the first kebele once the list loads.
  useEffect(() => {
    if (!genderKebeleId && (populationByKebele.data?.length ?? 0) > 0) {
      setGenderKebeleId(populationByKebele.data![0].kebeleId);
    }
  }, [genderKebeleId, populationByKebele.data]);

  // Recent System Activities -- real audit_log rows, actor name resolved via
  // a second small query rather than a client-side join across many rows
  // (this table is append-only and small per tenant).
  const recentActivity = useQuery({
    queryKey: ["dash", woredaId, "recent-activity"],
    // Same gate as /woreda/audit itself (P.AUDIT_VIEW) -- RLS lets any woreda
    // member SELECT audit_log, so the client-side check here is the only
    // thing standing between a role without audit access (finance_clerk,
    // viewer, ...) and who-approved-what history on their own dashboard.
    enabled: !!woredaId && canViewAudit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("audit_log_id, actor_user_id, entity_name, entity_id, action_type, action_at")
        .eq("woreda_id", woredaId as string)
        .order("action_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      const rows = data ?? [];
      const actorIds = Array.from(
        new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => !!id)),
      );
      const actorNames = new Map<string, string>();
      if (actorIds.length > 0) {
        const { data: actors, error: aErr } = await supabase
          .from("app_user")
          .select("user_id, full_name")
          .in("user_id", actorIds);
        if (aErr) throw aErr;
        (actors ?? []).forEach((a) => actorNames.set(a.user_id, a.full_name));
      }
      return rows.map((r) => ({
        id: r.audit_log_id,
        actor: r.actor_user_id ? (actorNames.get(r.actor_user_id) ?? "—") : "System",
        action: actionLabelAm(r.action_type),
        entity: `${r.entity_name}${r.entity_id ? ` #${r.entity_id.slice(0, 8)}` : ""}`,
        time: new Date(r.action_at as string).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));
    },
  });

  const regPeriodLabel: Record<RegPeriod, { am: string; en: string; btnAm: string }> = {
    weekly: { am: "በሳምንት", en: "Weekly", btnAm: "ሳምንታዊ" },
    monthly: { am: "በወር", en: "Monthly", btnAm: "ወርሃዊ" },
    quarterly: { am: "ሩብ ዓመት", en: "Quarterly", btnAm: "ሩብ አመት" },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        titleAm="የወረዳው ዕለታዊ ሁኔታ"
        titleEn="Operational summary for your woreda"
      />

      {/* Row 1 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          titleAm="ጠቅላላ ነዋሪዎች"
          titleEn="Total Residents"
          value={totalResidents.data ?? 0}
          icon={Users}
          color="bg-blue-50 text-blue-700"
          isLoading={totalResidents.isLoading}
        />
        <KpiCard
          titleAm="ንቁ ቤተሰቦች"
          titleEn="Active Households"
          value={activeHouseholds.data ?? 0}
          icon={Home}
          color="bg-green-50 text-green-700"
          isLoading={activeHouseholds.isLoading}
        />
        <KpiCard
          titleAm="የዛሬ አዲስ ምዝገባዎች"
          titleEn="New Today"
          value={newToday.data ?? 0}
          icon={UserPlus}
          color="bg-purple-50 text-purple-700"
          isLoading={newToday.isLoading}
          badge={newToday.data ? { text: `+${newToday.data} today`, tone: "up" } : undefined}
        />
        <KpiCard
          titleAm="ውሳኔ በመጠባበቅ ያሉ"
          titleEn="Pending Approvals"
          value={pendingApprovals.data ?? 0}
          icon={Clock}
          color="bg-amber-50 text-amber-700"
          isLoading={pendingApprovals.isLoading}
        />
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          titleAm="ምስክር ወረቀቶች (ወር)"
          titleEn="Credentials This Month"
          value={credentialsThisMonth.data ?? 0}
          icon={CreditCard}
          color="bg-indigo-50 text-indigo-700"
          isLoading={credentialsThisMonth.isLoading}
        />
        <KpiCard
          titleAm="ዕለታዊ ገቢ"
          titleEn="Today's Revenue (ETB)"
          value={(revenueToday.data ?? 0).toLocaleString()}
          icon={Banknote}
          color="bg-emerald-50 text-emerald-700"
          isLoading={revenueToday.isLoading}
        />
        <KpiCard
          titleAm="ወቅቱ ያለፋቸው"
          titleEn="Expired Credentials"
          value={expiredCredentials.data ?? 0}
          icon={AlertTriangle}
          color="bg-red-50 text-red-700"
          isLoading={expiredCredentials.isLoading}
        />
      </div>

      {/* Row 3 -- Analytics: registrations bar chart w/ period toggle + Priority Tasks */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-am-heading text-sm font-semibold text-slate-900">
                  የምዝገባ እንቅስቃሴ ({regPeriodLabel[regPeriod].am})
                </h3>
                <p className="text-xs text-slate-400">
                  Registration activity — {regPeriodLabel[regPeriod].en}
                </p>
              </div>
              <div className="flex rounded-full bg-slate-100 p-1">
                {(Object.keys(regPeriodLabel) as RegPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRegPeriod(p)}
                    className={`font-am-body rounded-full px-3 py-1 text-xs font-semibold transition ${
                      regPeriod === p
                        ? "bg-[color:var(--color-shell-header)] text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {regPeriodLabel[p].btnAm}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4" style={{ height: 256 }}>
              <BarChartCard
                titleEn=""
                data={monthlyRegs}
                xKey="label"
                yKey="count"
                loading={registrations.isLoading}
                height={256}
                angledLabels={regPeriod !== "monthly"}
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <h3 className="font-am-heading text-sm font-semibold text-slate-900">
            ቅድሚያ የሚሰጣቸው ተግባራት
          </h3>
          <p className="text-xs text-slate-400">Priority Tasks</p>
          <div className="mt-3 space-y-1">
            <PriorityTaskRow
              icon={Clock}
              color="bg-amber-50 text-amber-600"
              titleAm="ማጽደቅ የሚጠብቁ የመታወቂያ ጥያቄዎች"
              titleEn="Credential requests awaiting approval"
              count={pendingApprovals.data ?? 0}
              href="/woreda/approvals"
            />
            <PriorityTaskRow
              icon={FileWarning}
              color="bg-red-50 text-red-600"
              titleAm="ወቅታቸው ያለፈባቸው መታወቂያዎች"
              titleEn="Expired credentials"
              count={expiredCredentials.data ?? 0}
              href="/woreda/credentials"
            />
            <PriorityTaskRow
              icon={UserCheck}
              color="bg-blue-50 text-blue-600"
              titleAm="ማረጋገጫ የሚጠብቁ የአገልግሎት ጥያቄዎች"
              titleEn="Service requests awaiting review"
              count={serviceRequestsPending.data ?? 0}
              href="/woreda/services"
            />
            {!pendingApprovals.isLoading &&
              !expiredCredentials.isLoading &&
              !serviceRequestsPending.isLoading &&
              !pendingApprovals.data &&
              !expiredCredentials.data &&
              !serviceRequestsPending.data && (
                <p className="font-am-body py-6 text-center text-sm text-slate-400">
                  ምንም አስቸኳይ ተግባር የለም / Nothing needs attention right now
                </p>
              )}
          </div>
        </div>
      </div>

      {/* Row 4 -- Demographics: population by kebele + gender distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <h3 className="font-am-heading text-sm font-semibold text-slate-900">የሕዝብ ብዛት በቀበሌ</h3>
          <p className="text-xs text-slate-400">Population by Kebele</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="py-1.5 font-normal">ቀበሌ / Kebele</th>
                  <th className="py-1.5 font-normal">ነዋሪዎች / Residents</th>
                  <th className="py-1.5 text-right font-normal">%</th>
                </tr>
              </thead>
              <tbody>
                {(populationByKebele.data ?? []).map((k) => (
                  <tr key={k.kebeleId} className="border-b border-slate-50 last:border-0">
                    <td className="py-2">
                      <span className="font-am-body text-slate-800">{k.am}</span>{" "}
                      <span className="text-xs text-slate-400">/ {k.en}</span>
                    </td>
                    <td className="py-2 text-slate-700">{k.count}</td>
                    <td className="py-2 text-right text-slate-500">{k.pct}%</td>
                  </tr>
                ))}
                {populationByKebele.data?.length === 0 && !populationByKebele.isLoading && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-slate-400">
                      ምንም ቀበሌዎች የሉም / No kebeles configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-am-heading text-sm font-semibold text-slate-900">የፆታ ስርጭት</h3>
              <p className="text-xs text-slate-400">Gender Distribution</p>
            </div>
            <div className="flex rounded-full bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setGenderScope("woreda")}
                className={`font-am-body rounded-full px-3 py-1 text-xs font-semibold transition ${
                  genderScope === "woreda"
                    ? "bg-[color:var(--color-shell-header)] text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                በወረዳው
              </button>
              <button
                type="button"
                onClick={() => setGenderScope("kebele")}
                className={`font-am-body rounded-full px-3 py-1 text-xs font-semibold transition ${
                  genderScope === "kebele"
                    ? "bg-[color:var(--color-shell-header)] text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                በቀበሌ
              </button>
            </div>
          </div>
          {genderScope === "kebele" && (
            <select
              value={genderKebeleId ?? ""}
              onChange={(e) => setGenderKebeleId(e.target.value || null)}
              className="font-am-body mt-3 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
            >
              {(populationByKebele.data ?? []).map((k) => (
                <option key={k.kebeleId} value={k.kebeleId}>
                  {k.am} / {k.en}
                </option>
              ))}
            </select>
          )}
          <div className="mt-3" style={{ height: 256 }}>
            <PieChartCard
              titleEn=""
              data={
                genderScope === "kebele"
                  ? (genderSplitByKebele.data ?? [])
                  : (genderSplit.data ?? [])
              }
              nameKey="name"
              valueKey="value"
              loading={
                genderScope === "kebele" ? genderSplitByKebele.isLoading : genderSplit.isLoading
              }
              height={256}
              donut
            />
          </div>
        </div>
      </div>

      {/* Row 5 -- recent system activity (P.AUDIT_VIEW only, same gate as
          /woreda/audit) + quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PermissionGate permission={P.AUDIT_VIEW}>
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] lg:col-span-2">
            <h3 className="font-am-heading text-sm font-semibold text-slate-900">
              የቅርብ ጊዜ እንቅስቃሴዎች
            </h3>
            <p className="text-xs text-slate-400">Recent System Activities</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="py-1.5 font-normal">ፈጻሚ / Executor</th>
                    <th className="py-1.5 font-normal">ተግባር / Action</th>
                    <th className="py-1.5 font-normal">ነገር / Entity</th>
                    <th className="py-1.5 text-right font-normal">ሰዓት / Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentActivity.data ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                            {row.actor[0]?.toUpperCase() ?? "?"}
                          </span>
                          <span className="text-slate-800">{row.actor}</span>
                        </div>
                      </td>
                      <td className="font-am-body py-2 text-slate-600">{row.action}</td>
                      <td className="py-2 text-slate-500">{row.entity}</td>
                      <td className="py-2 text-right text-slate-400">{row.time}</td>
                    </tr>
                  ))}
                  {recentActivity.data?.length === 0 && !recentActivity.isLoading && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                        ምንም እንቅስቃሴ የለም / No recent activity
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </PermissionGate>
        <div className={canViewAudit ? "" : "lg:col-span-3"}>
          <QuickActionsCard />
        </div>
      </div>

      {/* Row 6 -- daily revenue */}
      <LineChartCard
        titleAm="ዕለታዊ ገቢ (30 ቀን)"
        titleEn="Daily revenue — last 30 days"
        data={dailyRevenue.data ?? []}
        xKey="day"
        yKey="amount"
        loading={dailyRevenue.isLoading}
        height={256}
      />
    </div>
  );
}
