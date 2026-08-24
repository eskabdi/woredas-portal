import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Banknote,
  Building2,
  Download,
  IdCard,
  Loader2,
  Users,
  HeartHandshake,
  BookmarkPlus,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { ModuleGate } from "@/components/common/ModuleGate";
import { KebeleFilter } from "@/components/common/KebeleFilter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadPresets, savePresets, type ReportPreset } from "@/utils/reportPresets";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { formatEthiopianDateShort, parseDateOnly } from "@/utils/ethiopianCalendar";
import { useReportBranding } from "@/hooks/useReportBranding";
import {
  exportSectionsToPdf,
  sectionsToCsv,
  downloadCsvText,
  type ReportSection,
} from "@/utils/reportExport";
import { toast } from "sonner";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/woreda/reports")({
  ssr: false,
  component: () => (
    <ModuleGate moduleKey="reports">
      <ReportsPage />
    </ModuleGate>
  ),
});

const COLORS = ["#1d4ed8", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

interface ReportData {
  residents: { kebele: string; sex: string; status: string; created_at: string }[];
  households: { kebele: string; occupancy: string }[];
  credentials: { status: string; type: string; created_at: string }[];
  events: { type: string; status: string; event_date: string }[];
  payments: { type: string; amount: number; channel: string; date: string }[];
  rental: { status: string }[];
}

/** Keeps only rows whose derived kebele matches the selected filter. */
function byKebele<T extends { _kebeleId: string | null }>(rows: T[], kebeleId: string): T[] {
  return kebeleId ? rows.filter((r) => r._kebeleId === kebeleId) : rows;
}

function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ].join("\n");
}

function downloadCsv(name: string, rows: Record<string, string | number>[]) {
  const csv = toCsv(rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${TODAY}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(TODAY);
  const [kebeleId, setKebeleId] = useState("");
  const canExport = hasPermission(P.REPORT_EXPORT);
  const { data: branding } = useReportBranding();
  const [exportingTab, setExportingTab] = useState<string | null>(null);
  const [tab, setTab] = useState("population");
  const [presets, setPresets] = useState<ReportPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  function persistPresets(next: ReportPreset[]) {
    setPresets(next);
    savePresets(next);
  }

  function applyPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setStart(preset.start);
    setEnd(preset.end);
    setTab(preset.tab);
    toast.success(`Preset applied: ${preset.name}`);
  }

  function createPreset() {
    const name = presetName.trim();
    if (!name) {
      toast.error("Give the preset a name");
      return;
    }
    const next = [
      ...presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()),
      { id: `${Date.now()}`, name, start, end, tab },
    ];
    persistPresets(next);
    setPresetName("");
    setPresetDialogOpen(false);
    toast.success(`Preset saved: ${name}`);
  }

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["woreda-reports", woredaId, start, end, kebeleId],
    enabled: !!woredaId,
    queryFn: async (): Promise<ReportData> => {
      const from = `${start}T00:00:00.000Z`;
      const to = `${end}T23:59:59.999Z`;

      const [res, hh, cred, ev, pay, rent] = await Promise.all([
        supabase
          .from("resident")
          .select(
            "sex, residency_status, active_flag, created_at, household:current_household_id ( kebele_id, kebele:kebele_id ( kebele_name_am, kebele_number ) )",
          )
          .eq("woreda_id", woredaId!)
          .limit(5000),
        supabase
          .from("household")
          .select("occupancy_status, kebele_id, kebele:kebele_id ( kebele_name_am, kebele_number )")
          .eq("woreda_id", woredaId!)
          .limit(5000),
        supabase
          .from("residence_credential")
          .select("status, credential_type, created_at, issuing_kebele_id")
          .eq("woreda_id", woredaId!)
          .gte("created_at", from)
          .lte("created_at", to)
          .limit(5000),
        supabase
          .from("vital_event")
          .select("event_type, status, event_date, household:household_id ( kebele_id )")
          .eq("woreda_id", woredaId!)
          .gte("event_date", start)
          .lte("event_date", end)
          .limit(5000),
        supabase
          .from("payment")
          .select(
            "payment_type, amount, channel, payment_date, status, household:household_id ( kebele_id ), rental_request:rental_request_id ( rental_house:rental_house_id ( kebele_id ) )",
          )
          .eq("woreda_id", woredaId!)
          .gte("payment_date", start)
          .lte("payment_date", end)
          .limit(5000),
        supabase
          .from("kebele_rental_house")
          .select("occupancy_status, kebele_id")
          .eq("woreda_id", woredaId!)
          .limit(5000),
      ]);

      const firstError = res.error || hh.error || cred.error || ev.error || pay.error || rent.error;
      if (firstError) throw firstError;

      const kebeleLabel = (
        k: { kebele_name_am?: string | null; kebele_number?: number | null } | null,
      ) =>
        k
          ? `${k.kebele_name_am ?? "—"}${k.kebele_number != null ? ` (#${k.kebele_number})` : ""}`
          : "ያልተመደበ / Unassigned";

      return {
        residents: byKebele(
          (res.data ?? []).map((r) => {
            const row = r as unknown as {
              sex: string;
              residency_status: string;
              active_flag: boolean;
              created_at: string;
              household: {
                kebele_id: string | null;
                kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
              } | null;
            };
            return {
              _kebeleId: row.household?.kebele_id ?? null,
              kebele: kebeleLabel(row.household?.kebele ?? null),
              sex: row.sex ?? "—",
              status: row.active_flag ? row.residency_status : "inactive",
              created_at: row.created_at,
            };
          }),
          kebeleId,
        ),
        households: byKebele(
          (hh.data ?? []).map((h) => {
            const row = h as unknown as {
              occupancy_status: string;
              kebele_id: string | null;
              kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
            };
            return {
              _kebeleId: row.kebele_id ?? null,
              kebele: kebeleLabel(row.kebele),
              occupancy: row.occupancy_status,
            };
          }),
          kebeleId,
        ),
        credentials: byKebele(
          (cred.data ?? []).map((c) => {
            const row = c as unknown as {
              status: string;
              credential_type: string;
              created_at: string;
              issuing_kebele_id: string | null;
            };
            return {
              _kebeleId: row.issuing_kebele_id ?? null,
              status: row.status,
              type: row.credential_type,
              created_at: row.created_at,
            };
          }),
          kebeleId,
        ),
        events: byKebele(
          (ev.data ?? []).map((e) => {
            const row = e as unknown as {
              event_type: string;
              status: string;
              event_date: string;
              household: { kebele_id: string | null } | null;
            };
            return {
              _kebeleId: row.household?.kebele_id ?? null,
              type: row.event_type,
              status: row.status,
              event_date: row.event_date,
            };
          }),
          kebeleId,
        ),
        payments: byKebele(
          (pay.data ?? [])
            .map(
              (p) =>
                p as unknown as {
                  payment_type: string;
                  amount: number;
                  channel: string;
                  payment_date: string;
                  status: string;
                  household: { kebele_id: string | null } | null;
                  rental_request: { rental_house: { kebele_id: string | null } | null } | null;
                },
            )
            .filter((p) => p.status !== "voided")
            .map((p) => ({
              _kebeleId:
                p.household?.kebele_id ?? p.rental_request?.rental_house?.kebele_id ?? null,
              type: p.payment_type,
              amount: Number(p.amount ?? 0),
              channel: p.channel,
              date: p.payment_date,
            })),
          kebeleId,
        ),
        rental: byKebele(
          (rent.data ?? []).map((r) => {
            const row = r as unknown as { occupancy_status: string; kebele_id: string | null };
            return { _kebeleId: row.kebele_id ?? null, status: row.occupancy_status };
          }),
          kebeleId,
        ),
      };
    },
  });

  const agg = useMemo(() => {
    const d = data;
    const count = <T,>(items: T[], key: (t: T) => string) => {
      const m = new Map<string, number>();
      items.forEach((i) => {
        const k = key(i) || "—";
        m.set(k, (m.get(k) ?? 0) + 1);
      });
      return [...m.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };
    if (!d) {
      return {
        residentsByKebele: [],
        residentsBySex: [],
        residentsByStatus: [],
        householdsByKebele: [],
        credentialsByStatus: [],
        credentialsByType: [],
        eventsByType: [],
        paymentsByType: [] as { name: string; value: number }[],
        paymentsByChannel: [] as { name: string; value: number }[],
        rentalByStatus: [],
        totalRevenue: 0,
        newResidents: 0,
      };
    }
    const sumBy = (key: (p: ReportData["payments"][number]) => string) => {
      const m = new Map<string, number>();
      d.payments.forEach((p) => m.set(key(p), (m.get(key(p)) ?? 0) + p.amount));
      return [...m.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };
    return {
      residentsByKebele: count(d.residents, (r) => r.kebele),
      residentsBySex: count(d.residents, (r) => r.sex),
      residentsByStatus: count(d.residents, (r) => r.status),
      householdsByKebele: count(d.households, (h) => h.kebele),
      credentialsByStatus: count(d.credentials, (c) => c.status),
      credentialsByType: count(d.credentials, (c) => c.type),
      eventsByType: count(d.events, (e) => e.type),
      paymentsByType: sumBy((p) => p.type),
      paymentsByChannel: sumBy((p) => p.channel),
      rentalByStatus: count(d.rental, (r) => r.status),
      totalRevenue: d.payments.reduce((s, p) => s + p.amount, 0),
      newResidents: d.residents.filter((r) => r.created_at >= `${start}T00:00:00`).length,
    };
  }, [data, start]);

  const tabSections = useMemo<
    Record<string, { titleAm: string; titleEn: string; sections: ReportSection[] }>
  >(
    () => ({
      population: {
        titleAm: "የሕዝብ ሪፖርት",
        titleEn: "Population report",
        sections: [
          { titleAm: "ነዋሪዎች በቀበሌ", titleEn: "Residents by kebele", rows: agg.residentsByKebele },
          { titleAm: "ነዋሪዎች በጾታ", titleEn: "Residents by sex", rows: agg.residentsBySex },
          {
            titleAm: "ነዋሪዎች በሁኔታ",
            titleEn: "Residents by residency status",
            rows: agg.residentsByStatus,
          },
          { titleAm: "ቤተሰቦች በቀበሌ", titleEn: "Households by kebele", rows: agg.householdsByKebele },
        ],
      },
      credentials: {
        titleAm: "የመታወቂያ ሪፖርት",
        titleEn: "Credentials report",
        sections: [
          {
            titleAm: "መታወቂያዎች በሁኔታ",
            titleEn: "Credentials by status",
            rows: agg.credentialsByStatus,
          },
          { titleAm: "መታወቂያዎች በዓይነት", titleEn: "Credentials by type", rows: agg.credentialsByType },
        ],
      },
      civil: {
        titleAm: "የኩነት ምዝገባ ሪፖርት",
        titleEn: "Civil registration report",
        sections: [
          { titleAm: "የኩነት ምዝገባዎች በዓይነት", titleEn: "Vital events by type", rows: agg.eventsByType },
        ],
      },
      revenue: {
        titleAm: "የገቢ ሪፖርት",
        titleEn: "Revenue report",
        sections: [
          {
            titleAm: "ገቢ በዓይነት",
            titleEn: "Revenue by payment type",
            rows: agg.paymentsByType,
            valueLabel: "ETB",
          },
          {
            titleAm: "ገቢ በመክፈያ መንገድ",
            titleEn: "Revenue by channel",
            rows: agg.paymentsByChannel,
            valueLabel: "ETB",
          },
        ],
      },
      rental: {
        titleAm: "የኪራይ ቤቶች ሪፖርት",
        titleEn: "Rental houses report",
        sections: [
          {
            titleAm: "የኪራይ ቤቶች ሁኔታ",
            titleEn: "Rental houses by occupancy",
            rows: agg.rentalByStatus,
          },
        ],
      },
    }),
    [agg],
  );

  if (!hasPermission(P.REPORT_VIEW)) return <Navigate to="/woreda/dashboard" />;

  const rangeLabel = `${formatEthiopianDateShort(parseDateOnly(start)!)} – ${formatEthiopianDateShort(parseDateOnly(end)!)}`;
  const periodLabel = `ጊዜ / Period: ${rangeLabel}  (${start} → ${end})`;

  function tabCsv(tab: string) {
    const t = tabSections[tab]!;
    downloadCsvText(`${tab}-report-${start}_${end}.csv`, sectionsToCsv(t.sections));
    toast.success("CSV downloaded");
  }

  async function tabPdf(tab: string) {
    const t = tabSections[tab]!;
    setExportingTab(tab);
    try {
      await exportSectionsToPdf({
        fileName: `${tab}-report-${start}_${end}.pdf`,
        branding: branding ?? {
          nameAm: "ወረዳ አስተዳደር",
          nameEn: "Woreda Administration",
          logoDataUrl: null,
        },
        reportTitleAm: t.titleAm,
        reportTitleEn: t.titleEn,
        periodLabel,
        sections: t.sections,
      });
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingTab(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BarChart3}
        titleAm="ሪፖርቶች"
        titleEn="Reports"
        description={`የተመረጠው ጊዜ / Period: ${rangeLabel}`}
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="font-noto-ethiopic text-xs">ከ / From</Label>
            <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label className="font-noto-ethiopic text-xs">እስከ / To</Label>
            <Input
              type="date"
              value={end}
              min={start}
              max={TODAY}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <KebeleFilter value={kebeleId} onChange={setKebeleId} />
          <div className="flex gap-2">
            {[
              { label: "7d", days: 7 },
              { label: "30d", days: 30 },
              { label: "90d", days: 90 },
              { label: "1y", days: 365 },
            ].map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStart(isoDaysAgo(p.days));
                  setEnd(TODAY);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-end gap-2">
            <div>
              <Label className="font-noto-ethiopic text-xs">የተቀመጡ ማጣሪያዎች / Saved presets</Label>
              <select
                className="h-10 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
                value=""
                onChange={(e) => e.target.value && applyPreset(e.target.value)}
              >
                <option value="">
                  {presets.length ? "Switch to preset…" : "No presets saved yet"}
                </option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.start} → {p.end})
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={() => setPresetDialogOpen(true)}>
              <BookmarkPlus className="mr-1.5 h-4 w-4" /> Save preset
            </Button>
          </div>
        </div>

        {presets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
            {presets.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full border bg-slate-50 py-1 pl-3 pr-1 text-xs"
              >
                <button type="button" className="font-medium" onClick={() => applyPreset(p.id)}>
                  {p.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600"
                  onClick={() => persistPresets(presets.filter((x) => x.id !== p.id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-noto-ethiopic">
              ማጣሪያ አስቀምጥ / Save filter preset
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Preset name</Label>
              <Input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g. Monthly revenue review"
                onKeyDown={(e) => e.key === "Enter" && createPreset()}
              />
            </div>
            <p className="text-xs text-slate-500">
              Saves period {start} → {end} and the {tab} tab.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPresetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createPreset}>Save preset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isError && (
        <Card className="p-4 text-sm text-red-600">
          Failed to load report data.{" "}
          <button className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          titleAm="ጠቅላላ ነዋሪዎች"
          titleEn="Total residents"
          value={(data?.residents.length ?? 0).toLocaleString()}
          icon={Users}
          isLoading={isLoading}
        />
        <KpiCard
          titleAm="ቤተሰቦች"
          titleEn="Households"
          value={(data?.households.length ?? 0).toLocaleString()}
          icon={Building2}
          color="bg-emerald-50 text-emerald-700"
          isLoading={isLoading}
        />
        <KpiCard
          titleAm="መታወቂያዎች"
          titleEn="Credentials in period"
          value={(data?.credentials.length ?? 0).toLocaleString()}
          icon={IdCard}
          color="bg-violet-50 text-violet-700"
          isLoading={isLoading}
        />
        <KpiCard
          titleAm="የኩነት ምዝገባዎች"
          titleEn="Vital events"
          value={(data?.events.length ?? 0).toLocaleString()}
          icon={HeartHandshake}
          color="bg-amber-50 text-amber-700"
          isLoading={isLoading}
        />
        <KpiCard
          titleAm="የተሰበሰበ ገቢ"
          titleEn="Revenue collected (ETB)"
          value={agg.totalRevenue.toLocaleString()}
          icon={Banknote}
          color="bg-sky-50 text-sky-700"
          isLoading={isLoading}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="population">ሕዝብ / Population</TabsTrigger>
          <TabsTrigger value="credentials">መታወቂያ / Credentials</TabsTrigger>
          <TabsTrigger value="civil">ኩነት / Civil</TabsTrigger>
          <TabsTrigger value="revenue">ገቢ / Revenue</TabsTrigger>
          <TabsTrigger value="rental">ኪራይ / Rental</TabsTrigger>
        </TabsList>

        <TabsContent value="population" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            exporting={exportingTab === "population"}
            onCsv={() => tabCsv("population")}
            onPdf={() => tabPdf("population")}
          />
          <ChartCard
            titleAm="ነዋሪዎች በቀበሌ"
            titleEn="Residents by kebele"
            rows={agg.residentsByKebele}
            canExport={canExport}
            exportName="residents-by-kebele"
            loading={isLoading}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PieCard titleAm="በጾታ" titleEn="By sex" rows={agg.residentsBySex} loading={isLoading} />
            <PieCard
              titleAm="በሁኔታ"
              titleEn="By residency status"
              rows={agg.residentsByStatus}
              loading={isLoading}
            />
          </div>
          <ChartCard
            titleAm="ቤተሰቦች በቀበሌ"
            titleEn="Households by kebele"
            rows={agg.householdsByKebele}
            canExport={canExport}
            exportName="households-by-kebele"
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="credentials" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            exporting={exportingTab === "credentials"}
            onCsv={() => tabCsv("credentials")}
            onPdf={() => tabPdf("credentials")}
          />
          <ChartCard
            titleAm="መታወቂያዎች በሁኔታ"
            titleEn="Credentials by status"
            rows={agg.credentialsByStatus}
            canExport={canExport}
            exportName="credentials-by-status"
            loading={isLoading}
          />
          <ChartCard
            titleAm="መታወቂያዎች በዓይነት"
            titleEn="Credentials by type"
            rows={agg.credentialsByType}
            canExport={canExport}
            exportName="credentials-by-type"
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="civil" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            exporting={exportingTab === "civil"}
            onCsv={() => tabCsv("civil")}
            onPdf={() => tabPdf("civil")}
          />
          <ChartCard
            titleAm="የኩነት ምዝገባዎች በዓይነት"
            titleEn="Vital events by type"
            rows={agg.eventsByType}
            canExport={canExport}
            exportName="vital-events-by-type"
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="revenue" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            exporting={exportingTab === "revenue"}
            onCsv={() => tabCsv("revenue")}
            onPdf={() => tabPdf("revenue")}
          />
          <ChartCard
            titleAm="ገቢ በዓይነት (ETB)"
            titleEn="Revenue by payment type"
            rows={agg.paymentsByType}
            canExport={canExport}
            exportName="revenue-by-type"
            loading={isLoading}
            valueLabel="ETB"
          />
          <ChartCard
            titleAm="ገቢ በመክፈያ መንገድ (ETB)"
            titleEn="Revenue by channel"
            rows={agg.paymentsByChannel}
            canExport={canExport}
            exportName="revenue-by-channel"
            loading={isLoading}
            valueLabel="ETB"
          />
        </TabsContent>

        <TabsContent value="rental" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            exporting={exportingTab === "rental"}
            onCsv={() => tabCsv("rental")}
            onPdf={() => tabPdf("rental")}
          />
          <ChartCard
            titleAm="የኪራይ ቤቶች ሁኔታ"
            titleEn="Rental houses by occupancy"
            rows={agg.rentalByStatus}
            canExport={canExport}
            exportName="rental-by-status"
            loading={isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChartCard({
  titleAm,
  titleEn,
  rows,
  canExport,
  exportName,
  loading,
  valueLabel = "Count",
}: {
  titleAm: string;
  titleEn: string;
  rows: { name: string; value: number }[];
  canExport: boolean;
  exportName: string;
  loading: boolean;
  valueLabel?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-4 py-3">
        <div>
          <h2 className="font-noto-ethiopic text-sm font-semibold text-slate-900">{titleAm}</h2>
          <p className="text-xs text-slate-500">{titleEn}</p>
        </div>
        {canExport && rows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv(
                exportName,
                rows.map((r) => ({ name: r.name, value: r.value })),
              )
            }
          >
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
        )}
      </div>
      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500 font-noto-ethiopic">
          ለዚህ ጊዜ መረጃ የለም / No data for this period
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows.slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-20}
                  height={50}
                  textAnchor="end"
                />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip formatter={(v: number) => v.toLocaleString()} />
                <Bar
                  dataKey="value"
                  name={valueLabel}
                  fill="#1d4ed8"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={56}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2 text-right">{valueLabel}</th>
                  <th className="px-3 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t">
                    <td className="px-3 py-2 font-noto-ethiopic">{r.name}</td>
                    <td className="px-3 py-2 text-right">{r.value.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {total ? ((r.value / total) * 100).toFixed(1) : "0.0"}%
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-slate-50 font-medium">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function PieCard({
  titleAm,
  titleEn,
  rows,
  loading,
}: {
  titleAm: string;
  titleEn: string;
  rows: { name: string; value: number }[];
  loading: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-slate-50 px-4 py-3">
        <h2 className="font-noto-ethiopic text-sm font-semibold text-slate-900">{titleAm}</h2>
        <p className="text-xs text-slate-500">{titleEn}</p>
      </div>
      {loading ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500 font-noto-ethiopic">
          መረጃ የለም / No data
        </div>
      ) : (
        <div className="h-64 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="name" outerRadius={80} label>
                {rows.map((r, i) => (
                  <Cell key={r.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <RTooltip formatter={(v: number) => v.toLocaleString()} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function TabExportBar({
  canExport,
  exporting,
  onCsv,
  onPdf,
}: {
  canExport: boolean;
  exporting: boolean;
  onCsv: () => void;
  onPdf: () => void;
}) {
  if (!canExport) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="font-noto-ethiopic mr-auto text-xs text-slate-500">
        ሙሉ ትንታኔውን አውርድ / Download this tab as a shareable summary
      </span>
      <Button size="sm" variant="outline" onClick={onCsv}>
        <Download className="mr-1.5 h-4 w-4" /> CSV
      </Button>
      <Button size="sm" onClick={onPdf} disabled={exporting}>
        {exporting ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <FileText className="mr-1.5 h-4 w-4" />
        )}
        PDF
      </Button>
    </div>
  );
}
