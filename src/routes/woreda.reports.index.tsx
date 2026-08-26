import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Banknote,
  Building2,
  Download,
  IdCard,
  Loader2,
  Printer,
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
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { formatEthiopianDateShortOnly } from "@/utils/ethiopianCalendar";
import { useReportsAggregate } from "@/hooks/useReportsAggregate";
import { sectionsToCsv, downloadCsvText } from "@/utils/reportExport";
import { toast } from "sonner";

export const Route = createFileRoute("/woreda/reports/")({
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

function ReportsPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(TODAY);
  const [kebeleId, setKebeleId] = useState("");
  const canExport = hasPermission(P.REPORT_EXPORT);
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

  const { data, isLoading, isError, isFetching, refetch, agg, tabSections } = useReportsAggregate({
    woredaId,
    start,
    end,
    kebeleId,
  });

  if (!hasPermission(P.REPORT_VIEW)) return <Navigate to="/woreda/dashboard" />;

  const rangeLabel = `${formatEthiopianDateShortOnly(start)} – ${formatEthiopianDateShortOnly(end)}`;
  const periodLabel = `ጊዜ / Period: ${rangeLabel}  (${start} → ${end})`;

  function tabCsv(tab: string) {
    const t = tabSections[tab]!;
    downloadCsvText(`${tab}-report-${start}_${end}.csv`, sectionsToCsv(t.sections));
    toast.success("CSV downloaded");
  }

  function tabPrint(tab: string) {
    navigate({
      to: "/woreda/reports/$reportType/print",
      params: { reportType: tab },
      search: { start, end, kebeleId },
    });
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
          <TabsTrigger value="services">አገልግሎት / Services</TabsTrigger>
        </TabsList>

        <TabsContent value="population" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            onCsv={() => tabCsv("population")}
            onPrint={() => tabPrint("population")}
          />
          <ChartCard
            titleAm="ነዋሪዎች በቀበሌ"
            titleEn="Residents by kebele"
            rows={agg.residentsByKebele}
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
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="credentials" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            onCsv={() => tabCsv("credentials")}
            onPrint={() => tabPrint("credentials")}
          />
          <ChartCard
            titleAm="መታወቂያዎች በሁኔታ"
            titleEn="Credentials by status"
            rows={agg.credentialsByStatus}
            loading={isLoading}
          />
          <ChartCard
            titleAm="መታወቂያዎች በዓይነት"
            titleEn="Credentials by type"
            rows={agg.credentialsByType}
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="civil" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            onCsv={() => tabCsv("civil")}
            onPrint={() => tabPrint("civil")}
          />
          <ChartCard
            titleAm="የኩነት ምዝገባዎች በዓይነት"
            titleEn="Vital events by type"
            rows={agg.eventsByType}
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="revenue" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            onCsv={() => tabCsv("revenue")}
            onPrint={() => tabPrint("revenue")}
          />
          <ChartCard
            titleAm="ገቢ በዓይነት (ETB)"
            titleEn="Revenue by payment type"
            rows={agg.paymentsByType}
            loading={isLoading}
            valueLabel="ETB"
          />
          <ChartCard
            titleAm="ገቢ በመክፈያ መንገድ (ETB)"
            titleEn="Revenue by channel"
            rows={agg.paymentsByChannel}
            loading={isLoading}
            valueLabel="ETB"
          />
        </TabsContent>

        <TabsContent value="rental" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            onCsv={() => tabCsv("rental")}
            onPrint={() => tabPrint("rental")}
          />
          <ChartCard
            titleAm="የኪራይ ቤቶች ሁኔታ"
            titleEn="Rental houses by occupancy"
            rows={agg.rentalByStatus}
            loading={isLoading}
          />
          <ChartCard
            titleAm="የተያዙ ቤቶች በክፍያ ሁኔታ"
            titleEn="Occupied houses by payment status"
            rows={agg.rentalByPaymentStatus}
            loading={isLoading}
          />
        </TabsContent>

        <TabsContent value="services" className="mt-4 space-y-4">
          <TabExportBar
            canExport={canExport}
            onCsv={() => tabCsv("services")}
            onPrint={() => tabPrint("services")}
          />
          <ChartCard
            titleAm="የአገልግሎት ጥያቄዎች በሁኔታ"
            titleEn="Service requests by status"
            rows={agg.serviceByStatus}
            loading={isLoading}
          />
          <ChartCard
            titleAm="የአገልግሎት ጥያቄዎች በዓይነት"
            titleEn="Service requests by type"
            rows={agg.serviceByType}
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
  loading,
  valueLabel = "Count",
}: {
  titleAm: string;
  titleEn: string;
  rows: { name: string; value: number }[];
  loading: boolean;
  valueLabel?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
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
  onCsv,
  onPrint,
}: {
  canExport: boolean;
  onCsv: () => void;
  onPrint: () => void;
}) {
  if (!canExport) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="font-noto-ethiopic mr-auto text-xs text-slate-500">
        ሙሉ ትንታኔውን አውርድ / Download this tab as a shareable summary
      </span>
      <Button size="sm" variant="outline" onClick={onCsv}>
        <Download className="mr-1.5 h-4 w-4" />
        <span className="font-noto-ethiopic">CSV አውርድ</span>
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onPrint}
        className="rounded-md bg-blue-700 text-white hover:bg-blue-800"
      >
        <Printer className="mr-2 h-4 w-4" />
        <span className="font-noto-ethiopic">አትም</span>
        <span className="ml-1 opacity-80">/ Print</span>
      </Button>
    </div>
  );
}
