import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/common/KpiCard";
import { TableSkeletonRows, TableEmptyRow, TableErrorRow } from "@/components/common/TableStates";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { ethiopianPeriodLabel, gregorianToEthiopian } from "@/utils/ethiopianCalendar";
import { useState } from "react";

export const Route = createFileRoute("/woreda/rental-reports")({
  ssr: false,
  component: RentalReportsPage,
});

// During Pagume (month 13), the last completed billable month is the
// preceding Nehase (12) -- BR-24's own termination convention, not the
// following Meskerem used for a billing *start*. The aging report's
// "as-of" period is a last-completed-period derivation, so it follows the
// same convention as termination.
function currentEthiopianPeriodKey(): string {
  const eth = gregorianToEthiopian(new Date());
  const month = eth.month === 13 ? 12 : eth.month;
  return `${eth.year}-${String(month).padStart(2, "0")}`;
}

const PLAN_STATUS_LABEL: Record<string, { am: string; en: string }> = {
  submitted: { am: "ቀርቧል", en: "Submitted" },
  returned: { am: "ተመልሷል", en: "Returned" },
  active: { am: "ንቁ", en: "Active" },
  completed: { am: "ተጠናቋል", en: "Completed" },
  defaulted: { am: "አልተከበረም", en: "Defaulted" },
  cancelled: { am: "ተሰርዟል", en: "Cancelled" },
};

function RentalReportsPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [activityStart, setActivityStart] = useState(isoDaysAgo(30));
  const [activityEnd, setActivityEnd] = useState(new Date().toISOString().slice(0, 10));

  const billingQuery = useQuery({
    queryKey: ["rental-report-billing-collection", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_billing_collection_report");
      if (error) throw error;
      return data as {
        period_key: string;
        billed_total: number;
        collected_total: number;
        outstanding_total: number;
      }[];
    },
  });

  const agingPeriodKey = currentEthiopianPeriodKey();
  const agingQuery = useQuery({
    queryKey: ["rental-report-arrears-aging", woredaId, agingPeriodKey],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_arrears_aging_report", {
        _current_period_key: agingPeriodKey,
      } as never);
      if (error) throw error;
      return data as { bucket_label: string; charge_count: number; total_amount: number }[];
    },
  });

  const complianceQuery = useQuery({
    queryKey: ["rental-report-plan-compliance", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_plan_compliance_report");
      if (error) throw error;
      return data as {
        status: string;
        plan_count: number;
        installments_scheduled: number;
        installments_due: number;
        installments_overdue: number;
        installments_paid: number;
        installments_cancelled: number;
      }[];
    },
  });

  const activityQuery = useQuery({
    queryKey: ["rental-report-checkpoint-activity", woredaId, activityStart, activityEnd],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_checkpoint_activity_report", {
        _start_date: activityStart,
        _end_date: activityEnd,
      } as never);
      if (error) throw error;
      return (
        data as {
          total_resolved: number;
          blocked_count: number;
          overridden_count: number;
          passed_count: number;
        }[]
      )[0];
    },
  });

  const reconciliationQuery = useQuery({
    queryKey: ["rental-report-reconciliation", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_reconciliation_report");
      if (error) throw error;
      return (
        data as {
          billed_total: number;
          settled_total: number;
          reversed_total: number;
          exception_count: number;
          exception_total: number;
        }[]
      )[0];
    },
  });

  if (!hasPermission(P.RENTAL_REPORT)) return <Navigate to="/woreda/dashboard" />;

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        icon={BarChart3}
        titleAm="የኪራይ ፋይናንስ ሪፖርቶች"
        titleEn="Rental Financial Reports"
        description="ክፍያ፣ ዕዳ እድሜ፣ የክፍያ ዕቅድ ተገዢነት እና ማስታረቂያ / Billing, arrears aging, plan compliance and reconciliation"
      />

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          ክፍያ እና ስብሰባ በጊዜ (ኢትዮ) / Billing &amp; Collection by EC Period
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-2">ወር / Period</th>
                <th className="px-4 py-2">የተከፈለ / Billed (ETB)</th>
                <th className="px-4 py-2">የተሰበሰበ / Collected (ETB)</th>
                <th className="px-4 py-2">ያልተከፈለ / Outstanding (ETB)</th>
              </tr>
            </thead>
            <tbody>
              {billingQuery.isLoading && <TableSkeletonRows cols={4} />}
              {billingQuery.isError && (
                <TableErrorRow cols={4} error={billingQuery.error} onRetry={billingQuery.refetch} />
              )}
              {!billingQuery.isLoading &&
                !billingQuery.isError &&
                (billingQuery.data ?? []).length === 0 && (
                  <TableEmptyRow cols={4} labelAm="ገና ክፍያ የለም" labelEn="No billing yet" />
                )}
              {(billingQuery.data ?? []).map((r) => (
                <tr key={r.period_key} className="border-t">
                  <td className="px-4 py-2">{ethiopianPeriodLabel(r.period_key)}</td>
                  <td className="px-4 py-2">{Number(r.billed_total).toLocaleString()}</td>
                  <td className="px-4 py-2">{Number(r.collected_total).toLocaleString()}</td>
                  <td className="px-4 py-2">{Number(r.outstanding_total).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          የዕዳ እድሜ ({ethiopianPeriodLabel(agingPeriodKey)} ድረስ) / Arrears Aging (as of{" "}
          {ethiopianPeriodLabel(agingPeriodKey)})
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-2">ወራት ያለፈ / Months overdue</th>
                <th className="px-4 py-2">የክፍያ ብዛት / Charge count</th>
                <th className="px-4 py-2">ጠቅላላ / Total (ETB)</th>
              </tr>
            </thead>
            <tbody>
              {agingQuery.isLoading && <TableSkeletonRows cols={3} />}
              {agingQuery.isError && (
                <TableErrorRow cols={3} error={agingQuery.error} onRetry={agingQuery.refetch} />
              )}
              {!agingQuery.isLoading &&
                !agingQuery.isError &&
                (agingQuery.data ?? []).length === 0 && (
                  <TableEmptyRow cols={3} labelAm="ያለፈ ጊዜ ክፍያ የለም" labelEn="No overdue charges" />
                )}
              {(agingQuery.data ?? []).map((r) => (
                <tr key={r.bucket_label} className="border-t">
                  <td className="px-4 py-2">{r.bucket_label}</td>
                  <td className="px-4 py-2">{Number(r.charge_count).toLocaleString()}</td>
                  <td className="px-4 py-2">{Number(r.total_amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          የክፍያ ዕቅድ ተገዢነት / Repayment Plan Compliance
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-2">ሁኔታ / Status</th>
                <th className="px-4 py-2">ዕቅዶች / Plans</th>
                <th className="px-4 py-2">የታቀደ / Scheduled</th>
                <th className="px-4 py-2">የሚከፈል / Due</th>
                <th className="px-4 py-2">ያለፈ ጊዜ / Overdue</th>
                <th className="px-4 py-2">ተከፍሏል / Paid</th>
                <th className="px-4 py-2">ተሰርዟል / Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {complianceQuery.isLoading && <TableSkeletonRows cols={7} />}
              {complianceQuery.isError && (
                <TableErrorRow
                  cols={7}
                  error={complianceQuery.error}
                  onRetry={complianceQuery.refetch}
                />
              )}
              {!complianceQuery.isLoading &&
                !complianceQuery.isError &&
                (complianceQuery.data ?? []).length === 0 && (
                  <TableEmptyRow
                    cols={7}
                    labelAm="ገና የክፍያ ዕቅድ የለም"
                    labelEn="No repayment plans yet"
                  />
                )}
              {(complianceQuery.data ?? []).map((r) => (
                <tr key={r.status} className="border-t">
                  <td className="px-4 py-2">
                    {PLAN_STATUS_LABEL[r.status]?.am ?? r.status} /{" "}
                    {PLAN_STATUS_LABEL[r.status]?.en ?? r.status}
                  </td>
                  <td className="px-4 py-2">{r.plan_count}</td>
                  <td className="px-4 py-2">{r.installments_scheduled}</td>
                  <td className="px-4 py-2">{r.installments_due}</td>
                  <td className="px-4 py-2">{r.installments_overdue}</td>
                  <td className="px-4 py-2">{r.installments_paid}</td>
                  <td className="px-4 py-2">{r.installments_cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">
            የማረጋገጫ እንቅስቃሴ / Checkpoint Activity
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="font-am-body text-xs">ከ / From</Label>
              <EthiopianDateInput
                value={activityStart}
                onChange={(iso) => setActivityStart(iso > activityEnd ? activityEnd : iso)}
              />
            </div>
            <div>
              <Label className="font-am-body text-xs">እስከ / To</Label>
              <EthiopianDateInput
                value={activityEnd}
                onChange={(iso) => setActivityEnd(iso < activityStart ? activityStart : iso)}
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            titleAm="ጠቅላላ የተፈተሸ"
            titleEn="Total resolved"
            value={(activityQuery.data?.total_resolved ?? 0).toLocaleString()}
            icon={ShieldAlert}
            isLoading={activityQuery.isLoading}
          />
          <KpiCard
            titleAm="ታግዷል"
            titleEn="Blocked"
            value={(activityQuery.data?.blocked_count ?? 0).toLocaleString()}
            icon={ShieldAlert}
            color="bg-red-50 text-red-700"
            isLoading={activityQuery.isLoading}
          />
          <KpiCard
            titleAm="በማለፊያ ታልፏል"
            titleEn="Overridden"
            value={(activityQuery.data?.overridden_count ?? 0).toLocaleString()}
            icon={ShieldAlert}
            color="bg-amber-50 text-amber-700"
            isLoading={activityQuery.isLoading}
          />
          <KpiCard
            titleAm="አልፏል"
            titleEn="Passed"
            value={(activityQuery.data?.passed_count ?? 0).toLocaleString()}
            icon={ShieldAlert}
            color="bg-emerald-50 text-emerald-700"
            isLoading={activityQuery.isLoading}
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold text-slate-700">
          ማስታረቂያ / Charges vs. Settlements vs. Exceptions
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <KpiCard
            titleAm="የተከፈለ ጠቅላላ"
            titleEn="Billed total"
            value={Number(reconciliationQuery.data?.billed_total ?? 0).toLocaleString()}
            icon={BarChart3}
            isLoading={reconciliationQuery.isLoading}
          />
          <KpiCard
            titleAm="የተስማማ ክፍያ"
            titleEn="Settled"
            value={Number(reconciliationQuery.data?.settled_total ?? 0).toLocaleString()}
            icon={BarChart3}
            color="bg-emerald-50 text-emerald-700"
            isLoading={reconciliationQuery.isLoading}
          />
          <KpiCard
            titleAm="ተመላሽ የተደረገ"
            titleEn="Reversed"
            value={Number(reconciliationQuery.data?.reversed_total ?? 0).toLocaleString()}
            icon={BarChart3}
            color="bg-slate-100 text-slate-700"
            isLoading={reconciliationQuery.isLoading}
          />
          <KpiCard
            titleAm="ልዩነቶች ብዛት"
            titleEn="Exceptions"
            value={(reconciliationQuery.data?.exception_count ?? 0).toLocaleString()}
            icon={BarChart3}
            color="bg-amber-50 text-amber-700"
            isLoading={reconciliationQuery.isLoading}
          />
          <KpiCard
            titleAm="የልዩነት ጠቅላላ"
            titleEn="Exception total"
            value={Number(reconciliationQuery.data?.exception_total ?? 0).toLocaleString()}
            icon={BarChart3}
            color="bg-amber-50 text-amber-700"
            isLoading={reconciliationQuery.isLoading}
          />
        </div>
      </Card>
    </div>
  );
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
