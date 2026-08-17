import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useReportBranding } from "@/hooks/useReportBranding";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";
import {
  plainTextToHtml,
  renderLetterTemplate,
  sanitizeLetterHtml,
} from "@/lib/letterTemplate";

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
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/woreda/services/$requestId" params={{ requestId }}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> ተመለስ / Back
          </Button>
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> አትም / Print
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[820px] border bg-white p-12 shadow-sm print:border-0 print:shadow-none">
        <div className="flex items-center gap-4 border-b-2 border-blue-800 pb-4">
          {branding.data?.logoDataUrl && (
            <img src={branding.data.logoDataUrl} alt="" className="h-20 w-20 object-contain" />
          )}
          <div className="flex-1 text-center">
            <div className="font-noto-ethiopic text-xl font-bold">{branding.data?.nameAm}</div>
            <div className="text-sm text-slate-700">{branding.data?.nameEn}</div>
            <div className="font-noto-ethiopic text-xs text-slate-600">
              {data.kebele ? `${data.kebele.kebele_name_am} ቀበሌ` : ""}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-between text-sm">
          <div className="font-mono">{data.request_number}</div>
          <div className="font-noto-ethiopic">
            ቀን / Date: {formatEthiopianDate(issuedDate)} ({issuedDate.toLocaleDateString("en-GB")})
          </div>
        </div>

        {data.addressed_to && (
          <div className="font-noto-ethiopic mt-6 text-sm font-semibold">ለ: {data.addressed_to}</div>
        )}

        <h1 className="font-noto-ethiopic mt-6 text-center text-base font-bold underline">
          {data.service_type?.name_am} / {data.service_type?.name_en}
        </h1>

        {bodyHtml.trim() ? (
          <div
            className="letter-body font-noto-ethiopic mt-6 text-sm leading-8"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <div className="font-noto-ethiopic mt-6 whitespace-pre-wrap text-sm leading-8">
            {fallbackBody}
          </div>
        )}

        {data.details && !templateHtml.includes("{DETAILS}") && (
          <div className="font-noto-ethiopic mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {data.details}
          </div>
        )}

        <div className="mt-16 flex items-end justify-between text-sm">
          <div>
            <div className="h-16 w-48 border-b border-slate-400" />
            <div className="font-noto-ethiopic mt-1 text-xs">ፊርማ / Signature</div>
          </div>
          <div>
            <div className="h-16 w-48 border-b border-slate-400" />
            <div className="font-noto-ethiopic mt-1 text-xs">ማህተም / Official stamp</div>
          </div>
        </div>

        {verifyUrl && (
          <div className="mt-10 flex items-center gap-4 border-t border-dashed border-slate-300 pt-4">
            <QRCodeSVG value={verifyUrl} size={92} level="M" includeMargin={false} />
            <div className="font-noto-ethiopic text-[11px] leading-5 text-slate-600">
              <div className="font-semibold">ይህን ደብዳቤ ያረጋግጡ / Verify this letter</div>
              <div>QR ኮዱን በስልክዎ ካሜራ ይቅሙ ወይም ይህን አድራሻ ይጎብኙ:</div>
              <div className="break-all font-mono text-[10px] text-slate-700">{verifyUrl}</div>
              <div>
                የማረጋገጫ ኮድ / Code:{" "}
                <span className="font-mono">{data.verification_token}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
