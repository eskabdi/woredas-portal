import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
// html2canvas-pro, not html2canvas: this app's Tailwind v4 build resolves
// computed colors (e.g. document.body's `color`) to oklch(...) strings, which
// plain html2canvas 1.4.1 throws on ("Attempting to parse an unsupported
// color function") since its color parser predates CSS Color 4. -pro is a
// maintained fork adding oklch/oklab/lab/lch/color() support; same default
// export and call signature otherwise.
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/common/PermissionGate";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import {
  ETHIOPIAN_MONTHS_AM,
  formatEthiopianDate,
  gregorianToEthiopian,
} from "@/utils/ethiopianCalendar";
import { amountInWordsAm, amountInWordsEn } from "@/utils/amountInWords";
import { CHANNEL_LABEL, PAYMENT_TYPE_LABEL } from "@/utils/paymentType";
import { receiptVerifyUrl } from "@/config/receiptVerify";

export const Route = createFileRoute("/woreda/revenue/$paymentId/receipt")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.REVENUE_RECEIPT_REPRINT}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to print receipts.</p>
        </div>
      }
    >
      <ReceiptPrintPage />
    </PermissionGate>
  ),
});

interface PersonRef {
  resident_id: string;
  resident_number: string;
  full_name: string;
  full_name_am: string | null;
}

interface KebeleRef {
  kebele_name_am: string;
  kebele_name_en: string;
  kebele_number: string;
}

interface ReceiptData {
  payment_id: string;
  payment_type: string;
  amount: number;
  payment_date: string;
  channel: string;
  reference_no: string | null;
  status: string;
  resident: PersonRef | null;
  household: { house_number: string; kebele: KebeleRef | null } | null;
  rental_request: {
    resident: PersonRef | null;
    rental_house: { house_number: string; kebele: KebeleRef | null } | null;
  } | null;
  service_request: {
    request_number: string;
    service_type: { name_am: string; name_en: string } | null;
  } | null;
  credential_request: { request_number: string } | null;
  posted_by: { full_name: string } | null;
  receipt: {
    receipt_id: string;
    receipt_number: string;
    receipt_date: string;
    total_amount: number;
    cash_bank_channel: string;
    printed_at: string | null;
    verification_token: string | null;
  } | null;
}

/** Supabase infers some to-one relations as arrays depending on FK direction;
 * normalize before use rather than trusting the shape at each call site. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function ReceiptPrintPage() {
  const { paymentId } = useParams({ from: "/woreda/revenue/$paymentId/receipt" });
  const woredaId = useAuthStore((s) => s.woredaId);

  const dataQuery = useQuery({
    queryKey: ["receipt-print", paymentId],
    enabled: !!paymentId,
    queryFn: async (): Promise<ReceiptData> => {
      const { data, error } = await supabase
        .from("payment")
        .select(
          `payment_id, payment_type, amount, payment_date, channel, reference_no, status,
           resident:resident_id ( resident_id, resident_number, full_name, full_name_am ),
           household:household_id ( house_number, kebele:kebele_id ( kebele_name_am, kebele_name_en, kebele_number ) ),
           rental_request:rental_request_id (
             resident:resident_id ( resident_id, resident_number, full_name, full_name_am ),
             rental_house:rental_house_id ( house_number, kebele:kebele_id ( kebele_name_am, kebele_name_en, kebele_number ) )
           ),
           service_request:service_request_id ( request_number, service_type:service_type_id ( name_am, name_en ) ),
           credential_request:credential_request_id ( request_number ),
           posted_by:posted_by_user_id ( full_name ),
           receipt:receipt!receipt_payment_id_fkey ( receipt_id, receipt_number, receipt_date, total_amount, cash_bank_channel, printed_at, verification_token )`,
        )
        .eq("payment_id", paymentId)
        .single();
      if (error) throw error;
      const row = data as unknown as ReceiptData & {
        rental_request: (ReceiptData["rental_request"] | ReceiptData["rental_request"][]) | null;
      };
      const rentalRequest = one(row.rental_request);
      return {
        ...row,
        resident: one(row.resident),
        household: one(row.household)
          ? { ...one(row.household)!, kebele: one(one(row.household)!.kebele) }
          : null,
        rental_request: rentalRequest
          ? {
              resident: one(rentalRequest.resident),
              rental_house: one(rentalRequest.rental_house)
                ? {
                    ...one(rentalRequest.rental_house)!,
                    kebele: one(one(rentalRequest.rental_house)!.kebele),
                  }
                : null,
            }
          : null,
        service_request: one(row.service_request)
          ? {
              ...one(row.service_request)!,
              service_type: one(one(row.service_request)!.service_type),
            }
          : null,
        credential_request: one(row.credential_request),
        posted_by: one(row.posted_by),
        receipt: one(row.receipt),
      };
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["woreda-settings-for-receipt", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda_settings")
        .select("logo_url, stamp_url, supervisor_signature_url, woreda_name_display")
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const woredaQuery = useQuery({
    queryKey: ["woreda-for-receipt", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_name_am, woreda_name_en")
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const s = settingsQuery.data;
      for (const [path, setUrl] of [
        [s?.logo_url, setLogoUrl],
        [s?.stamp_url, setStampUrl],
        [s?.supervisor_signature_url, setSignatureUrl],
      ] as const) {
        if (path) {
          const { data } = await supabase.storage.from("tenant-assets").createSignedUrl(path, 900);
          if (!cancelled) setUrl(data?.signedUrl ?? null);
        } else if (!cancelled) setUrl(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [settingsQuery.data]);

  const printRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  // Renders the receipt to a real PDF (html2canvas -> jsPDF, the same
  // pipeline woreda.households.$householdId.index.tsx already uses for its
  // "Export PDF" button) and opens it in a new tab, instead of printing the
  // live page via window.print(). A browser's native PDF viewer only ever
  // prints the PDF's own pages -- never the app chrome around it -- which is
  // what window.print() on the live DOM could not reliably guarantee here
  // (the sidebar and other page sections were bleeding into the printout).
  //
  // window.open() is called synchronously, before the first await, so the
  // popup isn't blocked as an unsolicited window -- browsers only allow
  // window.open() without a user-gesture/popup warning when it's a direct,
  // synchronous result of the click. The tab's location is then pointed at
  // the generated PDF once it's ready.
  const handlePrint = async () => {
    if (!printRef.current) return;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Popup blocked — allow popups for this site to view the receipt.");
      return;
    }
    setPrinting(true);
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
      const receiptNumber = dataQuery.data?.receipt?.receipt_number;
      pdf.setProperties({ title: receiptNumber ? `Receipt ${receiptNumber}` : "Receipt" });
      const blobUrl = URL.createObjectURL(pdf.output("blob"));
      win.location.href = blobUrl;
    } catch (e) {
      win.close();
      toast.error(`Failed to generate the receipt PDF: ${(e as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  const resident = dataQuery.data?.resident ?? dataQuery.data?.rental_request?.resident ?? null;
  const kebele =
    dataQuery.data?.household?.kebele ??
    dataQuery.data?.rental_request?.rental_house?.kebele ??
    null;
  const houseNumber =
    dataQuery.data?.household?.house_number ??
    dataQuery.data?.rental_request?.rental_house?.house_number ??
    null;

  const description = useMemo(() => {
    const d = dataQuery.data;
    if (!d) return { am: "", en: "" };
    if (d.payment_type === "rental_rent" || d.payment_type === "house_rent") {
      return {
        am: "የመንግስት ቤት ወርሃዊ ኪራይ",
        en: houseNumber ? `Monthly rent, unit ${houseNumber}` : "Monthly rent",
      };
    }
    if (d.payment_type === "service_fee" && d.service_request?.service_type) {
      return {
        am: d.service_request.service_type.name_am,
        en: `${d.service_request.service_type.name_en}${
          d.service_request.request_number ? ` · ${d.service_request.request_number}` : ""
        }`,
      };
    }
    if (d.payment_type === "credential_fee") {
      return {
        am: "የመታወቂያ ክፍያ",
        en: d.credential_request?.request_number
          ? `Credential fee · ${d.credential_request.request_number}`
          : "Credential fee",
      };
    }
    if (d.payment_type === "penalty") {
      return { am: "ቅጣት", en: "Penalty" };
    }
    return { am: PAYMENT_TYPE_LABEL[d.payment_type] ?? d.payment_type, en: "" };
  }, [dataQuery.data, houseNumber]);

  const period = useMemo(() => {
    const d = dataQuery.data;
    if (!d) return "";
    const e = gregorianToEthiopian(new Date(d.payment_date));
    return `${ETHIOPIAN_MONTHS_AM[e.month - 1]} ${e.year}`;
  }, [dataQuery.data]);

  if (dataQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="font-noto-ethiopic">ደረሰኝ በመጫን ላይ…</span> / Loading receipt…
      </div>
    );
  }
  if (dataQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-noto-ethiopic font-medium">ደረሰኙን መጫን አልተቻለም</p>
        <p className="text-sm">
          Failed to load this receipt:{" "}
          {dataQuery.error instanceof Error ? dataQuery.error.message : "Unknown error"}
        </p>
      </div>
    );
  }
  if (!dataQuery.data || !dataQuery.data.receipt) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-noto-ethiopic font-medium">ለዚህ ክፍያ ደረሰኝ አልተገኘም</p>
        <p className="text-sm">No receipt has been generated for this payment.</p>
      </div>
    );
  }

  const d = dataQuery.data;
  const receipt = d.receipt!;
  const woredaNameAm =
    settingsQuery.data?.woreda_name_display || woredaQuery.data?.woreda_name_am || "ወረዳ አስተዳደር";
  const woredaNameEn = woredaQuery.data?.woreda_name_en || "Woreda Administration";
  const verifyUrl = receipt.verification_token ? receiptVerifyUrl(receipt.verification_token) : "";
  const verifyPath = receipt.verification_token
    ? `/verify/receipt/${receipt.verification_token}`
    : "";

  return (
    <div className="space-y-4">
      <PageHeader
        variant="plain"
        icon={Printer}
        titleAm="ደረሰኝ"
        titleEn="Receipt"
        actions={
          <>
            <Link to="/woreda/revenue">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            </Link>
            <Button onClick={handlePrint} disabled={printing}>
              {printing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Print
            </Button>
          </>
        }
      />

      <div className="flex justify-center overflow-x-auto bg-slate-200 py-6">
        <div ref={printRef}>
          <ReceiptPage
            woredaNameAm={woredaNameAm}
            woredaNameEn={woredaNameEn}
            logoUrl={logoUrl}
            stampUrl={stampUrl}
            signatureUrl={signatureUrl}
            receiptNumber={receipt.receipt_number}
            receiptDate={receipt.receipt_date}
            printedAt={receipt.printed_at}
            paymentId={d.payment_id}
            residentNameAm={resident?.full_name_am ?? null}
            residentNameEn={resident?.full_name ?? null}
            residentNumber={resident?.resident_number ?? null}
            kebeleNameAm={kebele?.kebele_name_am ?? null}
            kebeleNumber={kebele?.kebele_number ?? null}
            houseNumber={houseNumber}
            paymentTypeLabel={PAYMENT_TYPE_LABEL[d.payment_type] ?? d.payment_type}
            paymentStatus={d.status}
            channelLabel={CHANNEL_LABEL[d.channel] ?? d.channel}
            referenceNo={d.reference_no}
            descriptionAm={description.am}
            descriptionEn={description.en}
            period={period}
            amount={receipt.total_amount}
            amountWordsAm={amountInWordsAm(receipt.total_amount)}
            amountWordsEn={amountInWordsEn(receipt.total_amount)}
            collectedByName={d.posted_by?.full_name ?? null}
            verifyUrl={verifyUrl}
            verifyPath={verifyPath}
          />
        </div>
      </div>
    </div>
  );
}

interface ReceiptPageProps {
  woredaNameAm: string;
  woredaNameEn: string;
  logoUrl: string | null;
  stampUrl: string | null;
  signatureUrl: string | null;
  receiptNumber: string;
  receiptDate: string;
  printedAt: string | null;
  paymentId: string;
  residentNameAm: string | null;
  residentNameEn: string | null;
  residentNumber: string | null;
  kebeleNameAm: string | null;
  kebeleNumber: string | null;
  houseNumber: string | null;
  paymentTypeLabel: string;
  paymentStatus: string;
  channelLabel: string;
  referenceNo: string | null;
  descriptionAm: string;
  descriptionEn: string;
  period: string;
  amount: number;
  amountWordsAm: string;
  amountWordsEn: string;
  collectedByName: string | null;
  verifyUrl: string;
  verifyPath: string;
}

/** One physical A4 page -- the customer copy (§1a of the Claude Design
 * mockup this was implemented from). The design's §1b "office stub" page is
 * deliberately not rendered: this receipt is one document, not a choice
 * between two. */
function ReceiptPage({
  woredaNameAm,
  woredaNameEn,
  logoUrl,
  stampUrl,
  signatureUrl,
  receiptNumber,
  receiptDate,
  printedAt,
  paymentId,
  residentNameAm,
  residentNameEn,
  residentNumber,
  kebeleNameAm,
  kebeleNumber,
  houseNumber,
  paymentTypeLabel,
  paymentStatus,
  channelLabel,
  referenceNo,
  descriptionAm,
  descriptionEn,
  period,
  amount,
  amountWordsAm,
  amountWordsEn,
  collectedByName,
  verifyUrl,
  verifyPath,
}: ReceiptPageProps) {
  const receiptDateObj = new Date(receiptDate);
  const dateEc = formatEthiopianDate(receiptDateObj);
  const dateGreg = receiptDateObj.toLocaleDateString("en-CA");
  const printedLabel = printedAt
    ? `${new Date(printedAt).toLocaleDateString("en-CA")} ${new Date(printedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : dateGreg;
  const amountFormatted = Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const seal = (
    <div
      style={{
        width: 66,
        height: 66,
        flex: "none",
        border: "1px dashed #9aa1ad",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 8,
        letterSpacing: ".14em",
        color: "#9aa1ad",
        textAlign: "center",
        lineHeight: 1.4,
        overflow: "hidden",
      }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt="Woreda seal"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <>
          WOREDA
          <br />
          SEAL
        </>
      )}
    </div>
  );

  const stamp = (
    <div
      style={{
        border: "1px dashed #9aa1ad",
        height: 104,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        letterSpacing: ".14em",
        color: "#9aa1ad",
        textAlign: "center",
        lineHeight: 1.6,
        fontFamily: "'Noto Sans Ethiopic',sans-serif",
        overflow: "hidden",
      }}
    >
      {stampUrl ? (
        <img src={stampUrl} alt="Official stamp" style={{ maxWidth: "100%", maxHeight: "100%" }} />
      ) : (
        <>
          የወረዳው ማህተም
          <br />
          OFFICIAL STAMP
        </>
      )}
    </div>
  );

  const qr = (
    <div
      style={{
        width: 100,
        height: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {verifyUrl ? (
        <QRCodeCanvas value={verifyUrl} size={100} level="M" />
      ) : (
        <div
          style={{
            width: 100,
            height: 100,
            border: "1px dashed #9aa1ad",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            letterSpacing: ".12em",
            color: "#9aa1ad",
          }}
        >
          QR
        </div>
      )}
    </div>
  );

  const signature = signatureUrl ? (
    <img src={signatureUrl} alt="Signature" style={{ height: 30, objectFit: "contain" }} />
  ) : (
    <div style={{ borderBottom: "1px solid #141821", height: 30 }} />
  );

  const fontStack = { fontFamily: "'IBM Plex Sans',sans-serif" };

  return (
    <section
      style={{
        width: "210mm",
        minHeight: "297mm",
        boxSizing: "border-box",
        padding: "56px 54px 44px",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        color: "#141821",
        ...fontStack,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 28,
          borderBottom: "2.5px solid #141821",
          paddingBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {seal}
          <div>
            <div
              style={{
                fontFamily: "'Noto Serif Ethiopic',serif",
                fontWeight: 600,
                fontSize: 23,
                lineHeight: 1.2,
              }}
            >
              {woredaNameAm}
            </div>
            <div style={{ fontSize: 12.5, letterSpacing: ".06em", color: "#4b5361", marginTop: 4 }}>
              {woredaNameEn.toUpperCase()}
            </div>
            <div
              style={{
                fontFamily: "'Noto Sans Ethiopic',sans-serif",
                fontSize: 12,
                color: "#4b5361",
                marginTop: 7,
              }}
            >
              የገቢ ክፍል · Revenue Office
            </div>
          </div>
        </div>
        <div style={{ border: "1.5px solid #141821", padding: "10px 14px", minWidth: 214 }}>
          <div style={{ fontSize: 8.5, letterSpacing: ".16em", color: "#6b7280" }}>
            ደረሰኝ ቁጥር · RECEIPT NO.
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 17,
              fontWeight: 600,
              marginTop: 3,
            }}
          >
            {receiptNumber}
          </div>
          <div
            style={{
              display: "flex",
              gap: 18,
              marginTop: 10,
              paddingTop: 9,
              borderTop: "1px solid #d6dae1",
            }}
          >
            <div>
              <div style={{ fontSize: 8.5, letterSpacing: ".14em", color: "#6b7280" }}>
                ቀን · E.C.
              </div>
              <div
                style={{
                  fontFamily: "'Noto Sans Ethiopic',sans-serif",
                  fontSize: 12.5,
                  fontWeight: 500,
                  marginTop: 2,
                }}
              >
                {dateEc}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 8.5, letterSpacing: ".14em", color: "#6b7280" }}>GREG.</div>
              <div
                style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, marginTop: 2 }}
              >
                {dateGreg}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginTop: 20,
        }}
      >
        <div
          style={{
            fontFamily: "'Noto Serif Ethiopic',serif",
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: ".02em",
          }}
        >
          የገቢ ደረሰኝ{" "}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: ".2em",
              color: "#6b7280",
              marginLeft: 8,
            }}
          >
            REVENUE RECEIPT
          </span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#6b7280" }}>
          PAYMENT ID · {paymentId}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          border: "1px solid #141821",
          marginTop: 14,
        }}
      >
        <div style={{ padding: "14px 16px", borderRight: "1px solid #141821" }}>
          <div
            style={{ fontSize: 8.5, letterSpacing: ".16em", color: "#6b7280", marginBottom: 10 }}
          >
            ከፋይ · PAID BY
          </div>
          <div
            style={{ fontFamily: "'Noto Sans Ethiopic',sans-serif", fontSize: 16, fontWeight: 600 }}
          >
            {residentNameAm ?? residentNameEn ?? "—"}
          </div>
          {residentNameEn && (
            <div style={{ fontSize: 12, color: "#4b5361", marginTop: 2 }}>{residentNameEn}</div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 14px",
              marginTop: 12,
              fontSize: 11.5,
            }}
          >
            <DetailPair labelAm="የነዋሪ ቁጥር" labelEn="Resident No." value={residentNumber} mono />
            <DetailPair
              labelAm="ቀበሌ"
              labelEn="Kebele"
              value={kebeleNameAm ? `ቀበሌ ${kebeleNumber ?? ""}` : null}
            />
            <DetailPair labelAm="የቤት ቁጥር" labelEn="House No." value={houseNumber} mono />
          </div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div
            style={{ fontSize: 8.5, letterSpacing: ".16em", color: "#6b7280", marginBottom: 10 }}
          >
            የክፍያ ዝርዝር · PAYMENT DETAIL
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 14px",
              fontSize: 11.5,
            }}
          >
            <DetailPair labelAm="ዓይነት" labelEn="Type" value={paymentTypeLabel} />
            <DetailPair labelAm="ቻናል" labelEn="Channel" value={channelLabel} />
            <DetailPair labelAm="ማጣቀሻ" labelEn="Reference No." value={referenceNo} mono />
            <DetailPair
              labelAm="ሁኔታ"
              labelEn="Status"
              value={paymentStatus.toUpperCase()}
              bold
              color={
                paymentStatus === "confirmed"
                  ? "#1c6b3a"
                  : paymentStatus === "reversed"
                    ? "#b91c1c"
                    : "#a16207"
              }
            />
          </div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20, fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#141821", color: "#fff" }}>
            <Th align="left" width={34}>
              #
            </Th>
            <Th align="left">መግለጫ · DESCRIPTION</Th>
            <Th align="left" width={150}>
              ወር · PERIOD
            </Th>
            <Th align="right" width={130}>
              መጠን (ብር) · AMOUNT
            </Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td mono muted borderBottomWidth={2.5}>
              01
            </Td>
            <Td borderBottomWidth={2.5}>
              <div style={{ fontFamily: "'Noto Sans Ethiopic',sans-serif" }}>{descriptionAm}</div>
              {descriptionEn && (
                <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 2 }}>
                  {descriptionEn}
                </div>
              )}
            </Td>
            <Td borderBottomWidth={2.5}>{period}</Td>
            <Td align="right" mono borderBottomWidth={2.5}>
              {amountFormatted}
            </Td>
          </tr>
          <tr>
            <td
              colSpan={3}
              style={{
                padding: "13px 12px",
                textAlign: "right",
                fontWeight: 600,
                fontSize: 13,
                borderBottom: "2.5px solid #141821",
                fontFamily: "'Noto Sans Ethiopic',sans-serif",
              }}
            >
              ጠቅላላ ድምር · TOTAL PAID
            </td>
            <td
              style={{
                padding: "13px 12px",
                textAlign: "right",
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 17,
                fontWeight: 600,
                borderBottom: "2.5px solid #141821",
              }}
            >
              {amountFormatted}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        style={{
          marginTop: 16,
          padding: "12px 14px",
          background: "#f4f5f7",
          borderLeft: "3px solid #8A1F1F",
        }}
      >
        <div style={{ fontSize: 8.5, letterSpacing: ".16em", color: "#6b7280" }}>
          በፊደል · AMOUNT IN WORDS
        </div>
        <div
          style={{
            fontFamily: "'Noto Serif Ethiopic',serif",
            fontSize: 15,
            fontWeight: 500,
            marginTop: 4,
          }}
        >
          {amountWordsAm}
        </div>
        <div style={{ fontSize: 11, color: "#4b5361", marginTop: 2 }}>{amountWordsEn}</div>
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.15fr 1fr 118px",
          gap: 22,
          alignItems: "end",
          borderTop: "1px solid #141821",
          paddingTop: 18,
          marginTop: 22,
        }}
      >
        <div>
          <div style={{ fontSize: 8.5, letterSpacing: ".16em", color: "#6b7280" }}>
            ገቢ ሰብሳቢ · COLLECTED BY
          </div>
          <div
            style={{
              fontFamily: "'Noto Sans Ethiopic',sans-serif",
              fontSize: 13,
              fontWeight: 600,
              marginTop: 6,
            }}
          >
            {collectedByName ?? "—"}
          </div>
          <div style={{ fontSize: 10.5, color: "#6b7280" }}>Revenue Clerk</div>
          {signature}
          <div style={{ fontSize: 9, letterSpacing: ".12em", color: "#6b7280", marginTop: 5 }}>
            ፊርማ · SIGNATURE
          </div>
        </div>
        {stamp}
        <div>
          {qr}
          <div
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 7.5,
              color: "#6b7280",
              marginTop: 5,
              lineHeight: 1.4,
              wordBreak: "break-all",
            }}
          >
            {verifyPath || "—"}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
          fontSize: 9.5,
          color: "#6b7280",
        }}
      >
        <div style={{ fontFamily: "'Noto Sans Ethiopic',sans-serif" }}>
          ይህ ደረሰኝ ያለ ማህተም እና ፊርማ ተቀባይነት አይኖረውም። · Not valid without official stamp and signature.
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
          ORIGINAL · PRINTED {printedLabel}
        </div>
      </div>
    </section>
  );
}

function DetailPair({
  labelAm,
  labelEn,
  value,
  mono,
  bold,
  color,
}: {
  labelAm: string;
  labelEn: string;
  value: string | null;
  mono?: boolean;
  bold?: boolean;
  color?: string;
}) {
  return (
    <>
      <div style={{ color: "#6b7280", fontFamily: "'Noto Sans Ethiopic',sans-serif" }}>
        {labelAm} · {labelEn}
      </div>
      <div
        style={{
          fontFamily: mono ? "'IBM Plex Mono',monospace" : undefined,
          fontWeight: bold ? 600 : undefined,
          color,
          letterSpacing: bold ? ".08em" : undefined,
        }}
      >
        {value ?? "—"}
      </div>
    </>
  );
}

function Th({
  children,
  align,
  width,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  width?: number;
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "9px 12px",
        fontSize: 9,
        letterSpacing: ".14em",
        fontWeight: 600,
        width,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  mono,
  muted,
  borderBottomWidth,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  muted?: boolean;
  borderBottomWidth?: number;
}) {
  return (
    <td
      style={{
        padding: "11px 12px",
        borderBottom: `${borderBottomWidth ?? 1}px solid #dfe3e9`,
        textAlign: align,
        fontFamily: mono ? "'IBM Plex Mono',monospace" : "'Noto Sans Ethiopic',sans-serif",
        color: muted ? "#6b7280" : undefined,
      }}
    >
      {children}
    </td>
  );
}
