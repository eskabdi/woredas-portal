import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Plus, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/common/PermissionGate";
import { ExportButtons } from "@/components/common/TableToolbar";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { exportRowsToCsv, exportRowsToPdf, type TableColumn } from "@/utils/tableExport";
import { useReportBranding } from "@/hooks/useReportBranding";
import { formatEthiopianDateShort } from "@/utils/ethiopianCalendar";
import { KpiWidgetRow } from "@/components/credentials/KpiWidgetRow";
import { CredentialQueueTable } from "@/components/credentials/CredentialQueueTable";

export const Route = createFileRoute("/woreda/credentials/")({
  ssr: false,
  component: CredentialsListPage,
});

const REQUEST_TYPE_LABEL: Record<string, string> = {
  new_issue: "አዲስ / New",
  renewal: "እድሳት / Renewal",
  reissue_lost: "የጠፋ / Lost",
  reissue_damaged: "የተበላሸ / Damaged",
  reissue_stolen: "የተሰረቀ / Stolen",
  reissue_correction: "እርማት / Correction",
};

interface ExportRow {
  request_number: string;
  request_type: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  resident: {
    full_name: string | null;
    full_name_am: string | null;
    resident_number: string | null;
  } | null;
}

function CredentialsListPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const brandingQuery = useReportBranding();

  const exportColumns: TableColumn<ExportRow>[] = [
    { header: "የጥያቄ ቁጥር / Request #", value: (r) => r.request_number },
    { header: "ስም / Resident (Am)", value: (r) => r.resident?.full_name_am },
    { header: "Resident (En)", value: (r) => r.resident?.full_name },
    { header: "የነዋሪ ቁጥር / Resident #", value: (r) => r.resident?.resident_number },
    { header: "ዓይነት / Type", value: (r) => REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type },
    { header: "ሁኔታ / Status", value: (r) => r.status },
    {
      header: "የቀረበበት ቀን / Submitted",
      value: (r) => formatEthiopianDateShort(new Date(r.submitted_at ?? r.created_at)),
    },
  ];

  const fetchAllForExport = async (): Promise<ExportRow[]> => {
    const { data, error } = await supabase
      .from("credential_request")
      .select(
        "request_number, request_type, status, submitted_at, created_at, resident:resident_id(full_name, full_name_am, resident_number)",
      )
      .eq("woreda_id", woredaId as string)
      .order("created_at", { ascending: false })
      .range(0, 4999);
    if (error) throw error;
    return (data ?? []) as unknown as ExportRow[];
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      exportRowsToCsv({
        fileName: `credential-requests-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows,
        filterLabel: "All credential requests",
        titleEn: "Credential Requests",
      });
      toast.success("CSV export ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      await exportRowsToPdf({
        fileName: `credential-requests-${new Date().toISOString().slice(0, 10)}.pdf`,
        branding: brandingQuery.data ?? { nameAm: "ወረዳ አስተዳደር", nameEn: "Woreda Administration" },
        titleAm: "የመታወቂያ ጥያቄዎች",
        titleEn: "Credential Requests",
        filterLabel: "All credential requests",
        columns: exportColumns,
        rows,
      });
      toast.success("PDF export ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CreditCard}
        titleAm="የመታወቂያ ጥያቄዎች"
        titleEn="Credential Requests"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons onCsv={handleExportCsv} onPdf={handleExportPdf} busy={exporting} />
            <PermissionGate permission={P.CREDENTIAL_VERIFY}>
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/woreda/credentials/verify" })}
                className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                <span className="font-noto-ethiopic">ያረጋግጡ</span>
                <span className="ml-2 opacity-80">/ Verify</span>
              </Button>
            </PermissionGate>
            <PermissionGate permission={P.CREDENTIAL_ISSUE}>
              <Button
                onClick={() => navigate({ to: "/woreda/credentials/new" })}
                className="bg-blue-700 text-white hover:bg-blue-800"
              >
                <Plus className="mr-2 h-4 w-4" />
                <span className="font-noto-ethiopic">አዲስ ጥያቄ</span>
                <span className="ml-2 opacity-80">/ New Request</span>
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <KpiWidgetRow />

      <CredentialQueueTable />
    </div>
  );
}
