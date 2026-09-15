import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
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
  credential: { status: string } | null;
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

  // Export must reflect exactly what CredentialQueueTable is showing --
  // reading the same URL params it writes (the same URL-state convention
  // useUrlSort/useUrlFilter already use) rather than a second, independent
  // filter state that could drift from what's on screen.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const strParam = (key: string): string =>
    typeof search[key] === "string" ? (search[key] as string) : "";
  const activeFilters = {
    q: strParam("q"),
    status: strParam("status") || "all",
    type: strParam("type") || "all",
    kebele: strParam("kebele") || "all",
    officer: strParam("officer") || "all",
    from: strParam("from"),
    to: strParam("to"),
  };
  const filterLabel = (() => {
    const parts: string[] = [];
    if (activeFilters.q) parts.push(`Search: "${activeFilters.q}"`);
    if (activeFilters.status !== "all") parts.push(`Status: ${activeFilters.status}`);
    if (activeFilters.type !== "all")
      parts.push(`Type: ${REQUEST_TYPE_LABEL[activeFilters.type] ?? activeFilters.type}`);
    if (activeFilters.kebele !== "all") parts.push(`Kebele: ${activeFilters.kebele}`);
    if (activeFilters.officer !== "all") parts.push(`Officer: ${activeFilters.officer}`);
    if (activeFilters.from) parts.push(`From: ${activeFilters.from}`);
    if (activeFilters.to) parts.push(`To: ${activeFilters.to}`);
    return parts.length ? parts.join(" • ") : "All credential requests";
  })();

  const exportColumns: TableColumn<ExportRow>[] = [
    { header: "የጥያቄ ቁጥር / Request #", value: (r) => r.request_number },
    { header: "ስም / Resident (Am)", value: (r) => r.resident?.full_name_am },
    { header: "Resident (En)", value: (r) => r.resident?.full_name },
    { header: "የነዋሪ ቁጥር / Resident #", value: (r) => r.resident?.resident_number },
    { header: "ዓይነት / Type", value: (r) => REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type },
    {
      header: "ሁኔታ / Status",
      value: (r) => (r.credential?.status === "revoked" ? "revoked" : r.status),
    },
    {
      header: "የቀረበበት ቀን / Submitted",
      value: (r) => formatEthiopianDateShort(new Date(r.submitted_at ?? r.created_at)),
    },
  ];

  const fetchAllForExport = async (): Promise<ExportRow[]> => {
    let q = supabase
      .from("credential_request")
      .select(
        "request_number, request_type, status, submitted_at, created_at, issuing_kebele_id, requested_by_user_id, credential_id, credential:residence_credential!credential_request_credential_id_fkey(status), resident:resident_id(full_name, full_name_am, resident_number)",
      )
      .eq("woreda_id", woredaId as string);

    if (activeFilters.type !== "all") q = q.eq("request_type", activeFilters.type);
    // Mirrors CredentialQueueTable's own revoked-status handling exactly
    // (including its known embedded-resource caveat) so export and the
    // on-screen queue never disagree on what "revoked" matched.
    if (activeFilters.status === "revoked") {
      q = q.eq("credential.status", "revoked").not("credential_id", "is", null);
    } else if (activeFilters.status !== "all") {
      q = q.eq("status", activeFilters.status);
    }
    if (activeFilters.kebele !== "all") q = q.eq("issuing_kebele_id", activeFilters.kebele);
    if (activeFilters.officer !== "all") q = q.eq("requested_by_user_id", activeFilters.officer);
    if (activeFilters.from) q = q.gte("submitted_at", activeFilters.from);
    if (activeFilters.to) q = q.lte("submitted_at", `${activeFilters.to}T23:59:59`);
    if (activeFilters.q) {
      const escaped = activeFilters.q.replace(/[%,]/g, "");
      q = q.or(`request_number.ilike.%${escaped}%`);
    }

    const { data, error } = await q.order("created_at", { ascending: false }).range(0, 4999);
    if (error) throw error;
    let rows = (data ?? []) as unknown as ExportRow[];
    if (activeFilters.q) {
      const term = activeFilters.q.toLowerCase();
      rows = rows.filter((r) => {
        if (r.request_number?.toLowerCase().includes(term)) return true;
        return (
          (r.resident?.full_name ?? "").toLowerCase().includes(term) ||
          (r.resident?.full_name_am ?? "").includes(activeFilters.q)
        );
      });
    }
    return rows;
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      exportRowsToCsv({
        fileName: `credential-requests-${new Date().toISOString().slice(0, 10)}.csv`,
        columns: exportColumns,
        rows,
        filterLabel,
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
        filterLabel,
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
                <span className="font-am-body">ያረጋግጡ</span>
                <span className="ml-2 opacity-80">/ Verify</span>
              </Button>
            </PermissionGate>
            <PermissionGate permission={P.CREDENTIAL_ISSUE}>
              <Button
                onClick={() => navigate({ to: "/woreda/credentials/new" })}
                className="bg-blue-700 text-white hover:bg-blue-800"
              >
                <Plus className="mr-2 h-4 w-4" />
                <span className="font-am-body">አዲስ ጥያቄ</span>
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
