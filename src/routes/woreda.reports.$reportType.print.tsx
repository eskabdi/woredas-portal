import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useAuthStore } from "@/stores/authStore";
import { useWoredaInfo } from "@/hooks/useWoredaInfo";
import { useReportBranding } from "@/hooks/useReportBranding";
import { useReportsAggregate } from "@/hooks/useReportsAggregate";
import { P } from "@/config/permissions";
import {
  formatEthiopianDate,
  formatEthiopianDateShortOnly,
  gregorianToEthiopian,
} from "@/utils/ethiopianCalendar";
import {
  PrintDocumentShell,
  DocSection,
  DocDivider,
  DocStatGrid,
  DocStat,
  DocBarChart,
  DocDonutChart,
  DocDataTable,
  DocSignatureBlock,
  DocRecordFooter,
  SystemAttributionFooter,
} from "@/components/print/PrintDocumentShell";

const REPORT_TYPES = [
  "population",
  "credentials",
  "civil",
  "revenue",
  "rental",
  "services",
] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const TYPE_CODE: Record<ReportType, string> = {
  population: "POP",
  credentials: "CRD",
  civil: "CIV",
  revenue: "REV",
  rental: "RNT",
  services: "SVC",
};

const searchSchema = z.object({
  start: z.string(),
  end: z.string(),
  kebeleId: z.string().optional().default(""),
});

export const Route = createFileRoute("/woreda/reports/$reportType/print")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  component: () => (
    <PermissionGate
      permission={P.REPORT_EXPORT}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to export reports.</p>
        </div>
      }
    >
      <ReportPrintPage />
    </PermissionGate>
  ),
});

function findValue(rows: { name: string; value: number }[], name: string): number {
  return rows.find((r) => r.name === name)?.value ?? 0;
}

/** Which chart (if any) accompanies each report section's table, matching
 * the report designs: a kebele/type breakdown reads as a horizontal bar,
 * a 2-3-way sex/status/channel split reads as a donut with a legend. Keyed
 * by report type + the section's titleEn (the stable identifier
 * useReportsAggregate's tabSections already gives each section). */
const SECTION_CHART: Record<ReportType, Record<string, "bar" | "donut" | undefined>> = {
  population: {
    "Residents by kebele": "bar",
    "Residents by sex": "donut",
    "Residents by residency status": "donut",
    "Residents by ethnicity": "bar",
    "Residents by religion": "bar",
    "Residents by age group": "bar",
    "Residents by education": "bar",
    "Residents by occupation": "bar",
    "Residents by house type": "bar",
    "Households by kebele": "bar",
  },
  credentials: {
    "Credentials by status": "donut",
    "Credentials by type": "bar",
  },
  civil: {
    "Vital events by type": "donut",
  },
  revenue: {
    "Revenue by payment type": "bar",
    "Revenue by channel": "donut",
  },
  rental: {
    "Rental houses by occupancy": "donut",
  },
  services: {
    "Service requests by status": "bar",
    "Service requests by type": "donut",
  },
};

function ReportPrintPage() {
  const { reportType } = Route.useParams();
  const { start, end, kebeleId } = Route.useSearch();
  const woredaId = useAuthStore((s) => s.woredaId);
  const { data: woreda } = useWoredaInfo();
  const branding = useReportBranding();
  const { agg, tabSections, isLoading } = useReportsAggregate({ woredaId, start, end, kebeleId });

  if (!REPORT_TYPES.includes(reportType as ReportType)) {
    return <Navigate to="/woreda/reports" />;
  }
  const type = reportType as ReportType;
  const report = tabSections[type];

  if (isLoading || !report) {
    return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  }

  const now = new Date();
  const ethYear = gregorianToEthiopian(now).year;
  const docNumber = `${woreda?.woreda_code ?? "WRD"}-RPT-${TYPE_CODE[type]}-${ethYear}`;
  const periodLabel = `${formatEthiopianDateShortOnly(start)} – ${formatEthiopianDateShortOnly(end)}`;

  const stats: { labelAm: string; labelEn: string; value: string }[] = (() => {
    switch (type) {
      case "population":
        return [
          {
            labelAm: "ጠቅላላ ነዋሪዎች",
            labelEn: "Total Residents",
            value: agg.totalResidents.toLocaleString(),
          },
          { labelAm: "ቤተሰቦች", labelEn: "Households", value: agg.totalHouseholds.toLocaleString() },
          {
            labelAm: "ወንድ",
            labelEn: "Male",
            value: findValue(agg.residentsBySex, "ወንድ / Male").toLocaleString(),
          },
          {
            labelAm: "ሴት",
            labelEn: "Female",
            value: findValue(agg.residentsBySex, "ሴት / Female").toLocaleString(),
          },
        ];
      case "credentials":
        return [
          {
            labelAm: "በጊዜው የተሰጡ",
            labelEn: "Credentials in Period",
            value: agg.totalCredentials.toLocaleString(),
          },
          {
            labelAm: "ንቁ",
            labelEn: "Active",
            value: findValue(agg.credentialsByStatus, "active").toLocaleString(),
          },
          {
            labelAm: "ለህትመት ዝግጁ",
            labelEn: "Ready to Print",
            value: findValue(agg.credentialsByStatus, "ready_to_print").toLocaleString(),
          },
        ];
      case "civil":
        return [
          {
            labelAm: "ጠቅላላ ምዝገባዎች",
            labelEn: "Total Registrations",
            value: agg.totalEvents.toLocaleString(),
          },
          { labelAm: "የተጠናቀቁ", labelEn: "Issued", value: agg.eventsIssued.toLocaleString() },
          {
            labelAm: "በሂደት ላይ",
            labelEn: "In Progress",
            value: (agg.totalEvents - agg.eventsIssued).toLocaleString(),
          },
        ];
      case "revenue":
        return [
          {
            labelAm: "የተሰበሰበ ገቢ (ብር)",
            labelEn: "Revenue Collected (ETB)",
            value: agg.totalRevenue.toLocaleString(),
          },
          {
            labelAm: "ጠቅላላ ክፍያዎች",
            labelEn: "Total Payments",
            value: agg.paymentsCount.toLocaleString(),
          },
          {
            labelAm: "አማካይ ክፍያ (ብር)",
            labelEn: "Average Payment (ETB)",
            value:
              agg.paymentsCount > 0
                ? Math.round(agg.totalRevenue / agg.paymentsCount).toLocaleString()
                : "0",
          },
        ];
      case "rental":
        return [
          {
            labelAm: "ጠቅላላ የኪራይ ቤቶች",
            labelEn: "Total Rental Houses",
            value: agg.totalRentalHouses.toLocaleString(),
          },
          {
            labelAm: "የተያዙ",
            labelEn: "Occupied",
            value: findValue(agg.rentalByStatus, "ተይዟል / Occupied").toLocaleString(),
          },
          { labelAm: "የተከፈለ", labelEn: "Paid", value: agg.rentalPaid.toLocaleString() },
          {
            labelAm: "ያልተከፈለ",
            labelEn: "Due (Uncollected)",
            value: agg.rentalDue.toLocaleString(),
          },
        ];
      case "services":
        return [
          {
            labelAm: "ጠቅላላ ጥያቄዎች",
            labelEn: "Total Requests",
            value: agg.totalServiceRequests.toLocaleString(),
          },
          { labelAm: "የተጠናቀቁ", labelEn: "Issued", value: agg.serviceIssued.toLocaleString() },
          {
            labelAm: "በሂደት ላይ",
            labelEn: "In Progress",
            value: (agg.totalServiceRequests - agg.serviceIssued).toLocaleString(),
          },
        ];
    }
  })();

  return (
    <PrintDocumentShell
      backButton={
        <Link to="/woreda/reports">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> ተመለስ / Back
          </Button>
        </Link>
      }
      logoDataUrl={branding.data?.logoDataUrl}
      woredaNameAm={branding.data?.nameAm ?? ""}
      woredaNameEn={branding.data?.nameEn ?? ""}
      contactLine={
        [branding.data?.addressLine, branding.data?.contactPhone, branding.data?.contactEmail]
          .filter(Boolean)
          .join(" · ") || null
      }
      docTagAm={report.titleAm}
      docTagEn={report.titleEn}
      docNumberLabelAm="ሪፖርት ቁ."
      docNumberLabelEn="Report No."
      docNumber={docNumber}
      dateEth={formatEthiopianDate(now)}
      dateGreg={now.toLocaleDateString("en-GB")}
      largeTitle
      footer={
        <>
          <DocRecordFooter
            refLabel="የሰነድ ማጣቀሻ / Document Reference"
            refId={docNumber}
            printedOn={now.toLocaleDateString("en-GB")}
            note={`${periodLabel} · ለውስጥ አገልግሎት ብቻ / Internal use only`}
          />
          <div className="mt-4">
            <SystemAttributionFooter woredaNameAm={branding.data?.nameAm ?? ""} />
          </div>
        </>
      }
    >
      <DocSection number="01" titleAm="ማጠቃለያ" titleEn="Summary">
        <DocStatGrid cols={stats.length === 4 ? 4 : 3}>
          {stats.map((s) => (
            <DocStat key={s.labelEn} labelAm={s.labelAm} labelEn={s.labelEn} value={s.value} />
          ))}
        </DocStatGrid>
      </DocSection>

      {report.sections.map((sec, i) => (
        <div key={sec.titleEn}>
          <DocDivider />
          <DocSection
            number={String(i + 2).padStart(2, "0")}
            titleAm={sec.titleAm}
            titleEn={sec.titleEn}
          >
            {SECTION_CHART[type][sec.titleEn] === "bar" && <DocBarChart rows={sec.rows} />}
            {SECTION_CHART[type][sec.titleEn] === "donut" && (
              <DocDonutChart rows={sec.rows} centerLabelAm="ጠቅላላ" centerLabelEn="Total" />
            )}
            <DocDataTable rows={sec.rows} valueLabel={sec.valueLabel} />
          </DocSection>
        </div>
      ))}

      <DocDivider />
      <DocSection
        number={String(report.sections.length + 2).padStart(2, "0")}
        titleAm="ማረጋገጫ"
        titleEn="Certification"
      >
        <DocSignatureBlock
          items={[
            { labelAm: "ፊርማ · አዘጋጅ", labelEn: "Signature — Prepared by" },
            { labelAm: "ፊርማ · ያፀደቀ", labelEn: "Signature — Approved by" },
          ]}
        />
      </DocSection>
    </PrintDocumentShell>
  );
}
