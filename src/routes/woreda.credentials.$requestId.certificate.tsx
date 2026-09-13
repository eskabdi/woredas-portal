import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/common/PermissionGate";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useReportBranding } from "@/hooks/useReportBranding";
import { P } from "@/config/permissions";
import { formatEthiopianDate, formatEthiopianDateOnly } from "@/utils/ethiopianCalendar";
import { credentialVerifyUrl } from "@/config/credentialCryptoConfig";
import {
  PrintDocumentShell,
  DocSection,
  DocDivider,
  DocFieldGrid,
  DocField,
  DocSignatureBlock,
  DocRecordFooter,
  SystemAttributionFooter,
} from "@/components/print/PrintDocumentShell";

/** Task 12.2's A4 certificate variant -- an archive/print-file copy of an
 * issued credential, distinct from the ID-1 card ($requestId/print.tsx).
 * Built on the same PrintDocumentShell/Doc* pipeline every other A4 document
 * in this app uses (see woreda.residents.$residentId.print.tsx), not a new
 * pipeline of its own. */
export const Route = createFileRoute("/woreda/credentials/$requestId/certificate")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CREDENTIAL_PREVIEW_PRINT}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to view this page.</p>
        </div>
      }
    >
      <CredentialCertificatePage />
    </PermissionGate>
  ),
});

function CredentialCertificatePage() {
  const { requestId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const branding = useReportBranding();

  const { data, isPending } = useQuery({
    queryKey: ["credential-certificate", requestId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_request")
        .select(
          `credential_request_id, request_number, request_type, credential_type,
           resident:resident_id ( full_name, full_name_am, sex ),
           household:household_id (
             kebele:kebele_id ( kebele_name_am, kebele_name_en, kebele_number )
           ),
           office:office_id ( office_name ),
           credential:residence_credential!credential_request_credential_id_fkey (
             credential_id, credential_number, qr_payload, issue_date, expiry_date, status
           )`,
        )
        .eq("credential_request_id", requestId)
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isPending) return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  if (!data) return <div className="py-20 text-center text-sm text-slate-500">Not found</div>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resident = data.resident as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kebele = (data.household as any)?.kebele;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const office = data.office as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cred = data.credential as any;

  const name = resident?.full_name_am || resident?.full_name || "—";
  const now = new Date();
  const verifyUrl = cred?.qr_payload ? credentialVerifyUrl(cred.qr_payload) : null;

  return (
    <PrintDocumentShell
      backButton={
        <Link to="/woreda/credentials/$requestId" params={{ requestId }}>
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
      docTagAm="የመታወቂያ ማረጋገጫ ደብዳቤ"
      docTagEn="Residence Credential Certificate"
      docNumberLabelAm="ቁ."
      docNumberLabelEn="No."
      docNumber={data.request_number}
      dateEth={formatEthiopianDate(now)}
      dateGreg={now.toLocaleDateString("en-GB")}
      footer={
        <>
          <DocRecordFooter
            refLabel="የሰነድ ማጣቀሻ / Document Reference"
            refId={cred?.credential_number ?? data.request_number}
            printedOn={now.toLocaleDateString("en-GB")}
          />
          <div className="mt-4">
            <SystemAttributionFooter woredaNameAm={branding.data?.nameAm ?? ""} />
          </div>
        </>
      }
    >
      <DocSection number="01" titleAm="የመታወቂያ ዝርዝር" titleEn="Credential Details">
        <DocFieldGrid>
          <DocField labelAm="ሙሉ ስም" labelEn="Full Name" value={name} span={3} />
          <DocField
            labelAm="የመታወቂያ ቁጥር"
            labelEn="Credential Number"
            value={cred?.credential_number ?? "—"}
            mono
          />
          <DocField
            labelAm="ጾታ"
            labelEn="Gender"
            value={resident?.sex === "female" ? "ሴት / Female" : "ወንድ / Male"}
          />
          <DocField
            labelAm="የተሰጠበት ቀን"
            labelEn="Issue Date"
            value={
              cred?.issue_date
                ? `${formatEthiopianDateOnly(cred.issue_date)} (${new Date(cred.issue_date).toLocaleDateString("en-GB")})`
                : "—"
            }
          />
          <DocField
            labelAm="የሚያበቃበት ቀን"
            labelEn="Expiry Date"
            value={
              cred?.expiry_date
                ? `${formatEthiopianDateOnly(cred.expiry_date)} (${new Date(cred.expiry_date).toLocaleDateString("en-GB")})`
                : "—"
            }
          />
          <DocField labelAm="ቢሮ" labelEn="Office" value={office?.office_name ?? "—"} />
          <DocField
            labelAm="ቀበሌ"
            labelEn="Kebele"
            value={
              kebele?.kebele_number != null
                ? `${kebele.kebele_number} · ${kebele.kebele_name_am ?? ""}`
                : "—"
            }
          />
        </DocFieldGrid>
      </DocSection>

      <DocDivider />

      <DocSection number="02" titleAm="ማረጋገጫ" titleEn="Verification">
        <div className="flex items-center gap-6">
          {verifyUrl ? (
            <QRCodeCanvas value={verifyUrl} size={96} level="M" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center border border-slate-300 text-[10px] text-slate-400">
              not signed
            </div>
          )}
          <p className="max-w-md text-xs text-slate-600">
            <span className="font-noto-ethiopic">ይህ ደብዳቤ ከላይ ያለውን QR ኮድ በመቃኘት ሊረጋገጥ ይችላል።</span>{" "}
            This certificate can be verified by scanning the QR code above against the woreda's live
            credential status.
          </p>
        </div>
      </DocSection>

      <DocDivider />

      <DocSection number="03" titleAm="ማረጋገጫ ፊርማ" titleEn="Certification">
        <DocSignatureBlock
          items={[
            { labelAm: "ፊርማ · ኃላፊ", labelEn: "Signature — Officer" },
            { labelAm: "ማህተም", labelEn: "Stamp" },
          ]}
        />
      </DocSection>
    </PrintDocumentShell>
  );
}
