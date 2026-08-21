import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, IdCard, CreditCard, LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusChip } from "@/components/common/StatusChip";

export const Route = createFileRoute("/admin/dashboard")({
  ssr: false,
  component: AdminDashboard,
});

function AdminDashboard() {
  const totalWoredas = useQuery({
    queryKey: ["admin-dash", "woredas"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("woreda")
        .select("woreda_id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const totalUsers = useQuery({
    queryKey: ["admin-dash", "users"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("app_user")
        .select("user_id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const totalResidents = useQuery({
    queryKey: ["admin-dash", "residents"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("resident")
        .select("resident_id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const credsToday = useQuery({
    queryKey: ["admin-dash", "creds-today"],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("residence_credential")
        .select("credential_id", { count: "exact", head: true })
        .gte("created_at", start.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });

  const woredaList = useQuery({
    queryKey: ["admin-dash", "woreda-list"],
    queryFn: async () => {
      const { data: woredas, error } = await supabase
        .from("woreda")
        .select("woreda_id, woreda_code, woreda_name_en, woreda_name_am, status")
        .order("woreda_name_en");
      if (error) throw error;

      const ids = (woredas ?? []).map((w) => w.woreda_id);
      const [{ data: residents }, { data: users }] = await Promise.all([
        supabase.from("resident").select("woreda_id").in("woreda_id", ids),
        supabase.from("app_user").select("woreda_id").in("woreda_id", ids),
      ]);
      const residentCount = new Map<string, number>();
      (residents ?? []).forEach((r) => {
        const k = r.woreda_id as string;
        residentCount.set(k, (residentCount.get(k) ?? 0) + 1);
      });
      const userCount = new Map<string, number>();
      (users ?? []).forEach((u) => {
        if (!u.woreda_id) return;
        const k = u.woreda_id as string;
        userCount.set(k, (userCount.get(k) ?? 0) + 1);
      });
      return (woredas ?? []).map((w) => ({
        ...w,
        residents: residentCount.get(w.woreda_id) ?? 0,
        users: userCount.get(w.woreda_id) ?? 0,
      }));
    },
  });

  const chartData = (woredaList.data ?? []).map((w) => ({
    name: w.woreda_name_en,
    residents: w.residents,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        titleAm="የመድረክ አጠቃላይ እይታ"
        titleEn="Platform Overview"
        description="Harari Region — all woredas"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          titleAm="ጠቅላላ ወረዳዎች"
          titleEn="Total Woredas"
          value={totalWoredas.data ?? 0}
          icon={Building2}
          color="bg-blue-50 text-blue-700"
          isLoading={totalWoredas.isLoading}
        />
        <KpiCard
          titleAm="ጠቅላላ ተጠቃሚዎች"
          titleEn="Total Users"
          value={totalUsers.data ?? 0}
          icon={Users}
          color="bg-purple-50 text-purple-700"
          isLoading={totalUsers.isLoading}
        />
        <KpiCard
          titleAm="ጠቅላላ ነዋሪዎች"
          titleEn="Total Residents"
          value={totalResidents.data ?? 0}
          icon={IdCard}
          color="bg-green-50 text-green-700"
          isLoading={totalResidents.isLoading}
        />
        <KpiCard
          titleAm="ዛሬ የተሰጡ መታወቂያዎች"
          titleEn="Credentials Today"
          value={credsToday.data ?? 0}
          icon={CreditCard}
          color="bg-amber-50 text-amber-700"
          isLoading={credsToday.isLoading}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Residents per Woreda</h3>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="residents" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Woredas</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Name</th>
                <th className="font-noto-ethiopic py-2 pr-4">ስም</th>
                <th className="py-2 pr-4">Users</th>
                <th className="py-2 pr-4">Residents</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {(woredaList.data ?? []).map((w) => (
                <tr key={w.woreda_id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs text-slate-600">{w.woreda_code}</td>
                  <td className="py-2 pr-4 text-slate-900">{w.woreda_name_en}</td>
                  <td className="font-noto-ethiopic py-2 pr-4 text-slate-700">
                    {w.woreda_name_am}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{w.users}</td>
                  <td className="py-2 pr-4 text-slate-700">{w.residents}</td>
                  <td className="py-2 pr-4">
                    <StatusChip status={w.status} showAmharic={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
