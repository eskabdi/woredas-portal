import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useReportBranding } from "@/hooks/useReportBranding";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";
import { plainTextToHtml, renderLetterTemplate, sanitizeLetterHtml } from "@/lib/letterTemplate";
import {
  PrintDocumentShell,
  DocSignatureBlock,
  SystemAttributionFooter,
} from "@/components/print/PrintDocumentShell";

export const Route = createFileRoute("/woreda/services/$requestId/print")({
  ssr: false,
  component: ServiceLetterPrintPage,
});

interface LetterData {
  request_number: string;
  subject: string | null;
  purpose: string | null;
  addressed_to: string | null;
  details: string | null;
  applicant_name: string | null;
  submitted_at: string;
  issued_at: string | null;
  verification_token: string | null;
  resident: {
    resident_number: string;
    full_name_am: string | null;
    full_name: string | null;
    sex: string | null;
  } | null;
  kebele: { kebele_name_am: string; kebele_name_en: string } | null;
  service_type: {
    name_am: string;
    name_en: string;
    letter_body_template: string | null;
    letter_body_html: string | null;
  } | null;
}

function ServiceLetterPrintPage() {
  const { requestId } = useParams({ from: "/woreda/services/$requestId/print" });
  const branding = useReportBranding();

  const { data, isPending } = useQuery({
    queryKey: ["service-request-letter", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_request")
        .select(
          "request_number, subject, purpose, addressed_to, details, applicant_name, applicant_phone, submitted_at, issued_at, status, verification_token, resident:resident_id(resident_number, full_name_am, full_name, sex, date_of_birth), kebele:kebele_id(kebele_name_am, kebele_name_en), service_type:service_type_id(name_am, name_en, letter_body_template, letter_body_html)",
        )
        .eq("service_request_id", requestId)
        .maybeSingle();
      if (error) throw error;
      return data as never as LetterData | null;
    },
  });

  if (isPending) return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  if (!data) return <div className="py-20 text-center text-sm text-slate-500">Not found</div>;

  const applicant =
    data.resident?.full_name_am || data.resident?.full_name || data.applicant_name || "—";
  const issuedDate = data.issued_at ? new Date(data.issued_at) : new Date();

  const templateHtml =
    data.service_type?.letter_body_html ??
    plainTextToHtml(data.service_type?.letter_body_template ?? "");

  const bodyHtml = renderLetterTemplate(sanitizeLetterHtml(templateHtml), {
    APPLICANT_NAME: applicant,
    RESIDENT_NUMBER: data.resident?.resident_number ?? "—",
    KEBELE: data.kebele?.kebele_name_am ?? "—",
    WOREDA: branding.data?.nameAm ?? "",
    PURPOSE: data.purpose ?? data.subject ?? "—",
    ADDRESSED_TO: data.addressed_to ?? "ለሚመለከተው አካል ሁሉ",
    LETTER_NO: data.request_number,
    DATE_ET: formatEthiopianDate(issuedDate),
    DATE_GC: issuedDate.toLocaleDateString("en-GB"),
    SEX: data.resident?.sex ?? "—",
    DETAILS: data.details ?? "",
  });

  const fallbackBody = `${applicant} (የነዋሪ ቁጥር ${
    data.resident?.resident_number ?? "—"
  }) በዚህ ወረዳ ${data.kebele?.kebele_name_am ?? ""} ቀበሌ ውስጥ ነዋሪ መሆኑን/መሆኗን እናረጋግጣለን። ይህ ደብዳቤ ${
    data.purpose ?? data.subject ?? ""
  } ጉዳይ እንዲያገለግል የተሰጠ ነው።`;

  const verifyUrl = data.verification_token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/verify/letter/${data.verification_token}`
    : null;

  return (
    <PrintDocumentShell
      backButton={
        <Link to="/woreda/services/$requestId" params={{ requestId }}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> ተመለስ / Back
          </Button>
        </Link>
      }
      logoDataUrl={branding.data?.logoDataUrl}
      woredaNameAm={branding.data?.nameAm ?? ""}
      woredaNameEn={branding.data?.nameEn ?? ""}
      contactLine={
        [
          branding.data?.addressLine,
          branding.data?.contactPhone,
          branding.data?.contactEmail,
          data.kebele ? `${data.kebele.kebele_name_am} ቀበሌ` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      }
      docTagAm={data.service_type?.name_am ?? "የአገልግሎት ደብዳቤ"}
      docTagEn={data.service_type?.name_en ?? "Service Letter"}
      docNumberLabelAm="ቁ."
      docNumberLabelEn="No."
      docNumber={data.request_number}
      dateEth={formatEthiopianDate(issuedDate)}
      dateGreg={issuedDate.toLocaleDateString("en-GB")}
      footer={
        <>
          {verifyUrl && (
            <div className="mt-10 flex items-center gap-4 border-t border-dashed border-slate-300 pt-4">
              <QRCodeSVG value={verifyUrl} size={92} level="M" includeMargin={false} />
              <div className="font-noto-ethiopic text-[11px] leading-5 text-slate-600">
                <div className="font-semibold">ይህን ደብዳቤ ያረጋግጡ / Verify this letter</div>
                <div>QR ኮዱን በስልክዎ ካሜራ ይቅሙ ወይም ይህን አድራሻ ይጎብኙ:</div>
                <div className="break-all font-mono text-[10px] text-slate-700">{verifyUrl}</div>
                <div>
                  የማረጋገጫ ኮድ / Code: <span className="font-mono">{data.verification_token}</span>
                </div>
              </div>
            </div>
          )}
          <div className="mt-6">
            <SystemAttributionFooter woredaNameAm={branding.data?.nameAm ?? ""} />
          </div>
        </>
      }
    >
      <div>
        <div className="font-noto-ethiopic text-sm font-semibold">
          {data.addressed_to || "ለሚመለከተው ሁሉ፣"}
        </div>
        <div className="text-xs text-slate-400">
          {data.addressed_to ? "" : "To Whom It May Concern,"}
        </div>
      </div>

      <div>
        <div className="font-noto-ethiopic text-base font-semibold">
          ጉዳይ፦ {data.subject || data.service_type?.name_am}
        </div>
        <div className="text-xs text-slate-400">Re: {data.service_type?.name_en}</div>
      </div>

      {bodyHtml.trim() ? (
        <div
          className="letter-body font-noto-ethiopic text-sm leading-8"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <div className="font-noto-ethiopic whitespace-pre-wrap text-sm leading-8">
          {fallbackBody}
        </div>
      )}

      {data.details && !templateHtml.includes("{DETAILS}") && (
        <div className="font-noto-ethiopic whitespace-pre-wrap text-sm leading-7 text-slate-700">
          {data.details}
        </div>
      )}

      <div>
        <div className="font-noto-ethiopic text-sm font-semibold">በአክብሮት፣</div>
        <div className="text-xs text-slate-400">Sincerely,</div>
      </div>

      <div className="pt-8">
        <DocSignatureBlock
          items={[
            { labelAm: "የቀበሌ ሥራ አስኪያጅ", labelEn: "Kebele Manager" },
            { labelAm: "የወረዳ መዝጋቢ", labelEn: "Woreda Registrar" },
          ]}
        />
      </div>
    </PrintDocumentShell>
  );
}
