import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Home,
  UserPlus,
  Clock,
  CreditCard,
  Banknote,
  AlertTriangle,
  LayoutDashboard,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
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

function WoredaDashboard() {
  const woredaId = useAuthStore((s) => s.woredaId);

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
      const { data, error } = await supabase
        .from("payment")
        .select("amount")
        .eq("woreda_id", woredaId as string)
        .gte("payment_date", new Date().toISOString().slice(0, 10));
      if (error) throw error;
      return (data ?? []).reduce((s, r) => s + Number(r.amount), 0);
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

  const monthlyRegs = useQuery({
    queryKey: ["dash", woredaId, "monthly-regs"],
    enabled: !!woredaId,
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 5);
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("resident")
        .select("created_at")
        .eq("woreda_id", woredaId as string)
        .gte("created_at", since.toISOString());
      if (error) throw error;
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
      (data ?? []).forEach((r) => {
        const d = new Date(r.created_at as string);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const b = buckets.get(key);
        if (b) b.count += 1;
      });
      return Array.from(buckets.values()).sort((a, b) => a.sort - b.sort);
    },
  });

  const dailyRevenue = useQuery({
    queryKey: ["dash", woredaId, "daily-revenue"],
    enabled: !!woredaId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 29);
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("payment")
        .select("amount, payment_date")
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
      (data ?? []).forEach((r) => {
        const k = r.payment_date as string;
        const b = buckets.get(k);
        if (b) b.amount += Number(r.amount);
      });
      return Array.from(buckets.values());
    },
  });

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
        />
        <KpiCard
          titleAm="በጥበቃ ላይ ያሉ"
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

      {/* Row 3 — charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-noto-ethiopic text-sm font-semibold text-slate-900">
            ወርሃዊ ምዝገባዎች (6 ወር)
          </h3>
          <p className="text-xs text-slate-400">Monthly registrations — last 6 months</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRegs.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "Noto Sans Ethiopic" }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-noto-ethiopic text-sm font-semibold text-slate-900">
            ዕለታዊ ገቢ (30 ቀን)
          </h3>
          <p className="text-xs text-slate-400">Daily revenue — last 30 days</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyRevenue.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
