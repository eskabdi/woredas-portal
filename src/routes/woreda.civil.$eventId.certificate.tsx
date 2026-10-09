import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
// html2canvas-pro, not html2canvas: the Tailwind v4 build resolves colours to
// oklch(), which plain html2canvas cannot parse (see pdf-print-pipeline skill).
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Printer } from "lucide-react";

import { CertificatePage } from "@/components/certificates/CertificatePage";
import type { Orientation, PlacedField } from "@/components/certificates/certificateLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CERTIFICATE_TYPE_LABELS } from "@/config/certificateFields";
import { P } from "@/config/permissions";
import { isCertificateType, resolveCertificateValues } from "@/lib/certificateData";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/woreda/civil/$eventId/certificate")({
  ssr: false,
  component: CertificateAccessGate,
});

// Readers, printers (print_officer holds civil.print_certificate) and
// reprint authorizers may open the page; what each can do is decided below
// and, authoritatively, by record_civil_certificate_print().
function CertificateAccessGate() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const allowed = [P.CIVIL_READ, P.CIVIL_PRINT_CERTIFICATE, P.CIVIL_AUTHORIZE_REPRINT].some((k) =>
    hasPermission(k),
  );
  if (!allowed) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="font-am-body font-medium">ይህን ለመጠቀም ፈቃድ የለዎትም</p>
        <p className="text-sm">You do not have permission.</p>
      </div>
    );
  }
  return <CertificatePrintPage />;
}

// certificate_template* (migration 101) are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const PRINTABLE = new Set(["registered", "issued"]);

/** Fetch a private-bucket object as a data URL, so html2canvas never needs CORS. */
async function storageDataUrl(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  return await new Promise<string | null>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(data);
  });
}

function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function CertificatePrintPage() {
  const { eventId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const printRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  const dataQuery = useQuery({
    queryKey: ["civil-certificate", eventId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data: ev, error } = await supabase
        .from("vital_event")
        .select(
          "vital_event_id, event_type, event_number, event_date, registration_date, issued_at, status, event_details, issued_by_user_id, approved_by_user_id, certificate_token" as "*",
        )
        .eq("vital_event_id", eventId)
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      if (!ev) return null;
      // certificate_token (migration 102) predates the regenerated types.
      const event = ev as unknown as {
        vital_event_id: string;
        event_type: string;
        event_number: string | null;
        event_date: string | null;
        registration_date: string | null;
        issued_at: string | null;
        status: string;
        event_details: unknown;
        issued_by_user_id: string | null;
        approved_by_user_id: string | null;
        certificate_token: string | null;
      };
      if (!isCertificateType(event.event_type)) return { event, template: null };

      const [tpl, fields, settings, woreda] = await Promise.all([
        db
          .from("certificate_template")
          .select("certificate_type, background_path, orientation, published_at")
          .eq("certificate_type", event.event_type)
          .maybeSingle(),
        db
          .from("certificate_template_field")
          .select(
            "certificate_field_id, certificate_type, field_key, format, binding_mode, static_value, x, y, width, height, font_size, font_weight, font_style, text_align, color, font_family, z_index",
          )
          .eq("certificate_type", event.event_type)
          .order("z_index"),
        supabase
          .from("woreda_settings")
          .select("woreda_name_display, woreda_name_display_en, stamp_url")
          .eq("woreda_id", woredaId!)
          .maybeSingle(),
        supabase
          .from("woreda")
          .select("woreda_name_am, woreda_name_en")
          .eq("woreda_id", woredaId!)
          .maybeSingle(),
      ]);
      if (tpl.error) throw tpl.error;
      if (fields.error) throw fields.error;

      const registrarId = event.issued_by_user_id ?? event.approved_by_user_id ?? null;
      const registrar = registrarId
        ? (
            await supabase
              .from("app_user")
              .select("full_name, signature_path")
              .eq("user_id", registrarId)
              .maybeSingle()
          ).data
        : null;

      const s = settings.data as {
        woreda_name_display: string | null;
        woreda_name_display_en: string | null;
        stamp_url: string | null;
      } | null;
      const [background, signature, seal] = await Promise.all([
        storageDataUrl("certificate-templates", tpl.data?.background_path ?? null),
        storageDataUrl(
          "staff-assets",
          (registrar as { signature_path?: string | null } | null)?.signature_path ?? null,
        ),
        storageDataUrl("tenant-assets", s?.stamp_url ?? null),
      ]);

      return {
        event,
        template: tpl.data as {
          background_path: string | null;
          orientation: Orientation;
          published_at: string | null;
        } | null,
        fields: ((fields.data ?? []) as PlacedField[]).map((f) => ({
          ...f,
          x: Number(f.x),
          y: Number(f.y),
          width: Number(f.width),
          height: Number(f.height),
          font_size: Number(f.font_size),
        })),
        registrar: registrar as { full_name: string | null; signature_path: string | null } | null,
        woreda: {
          name_am: s?.woreda_name_display ?? woreda.data?.woreda_name_am ?? null,
          name_en: s?.woreda_name_display_en ?? woreda.data?.woreda_name_en ?? null,
          stamp_path: s?.stamp_url ?? null,
        },
        images: { background, signature, seal },
      };
    },
  });

  const d = dataQuery.data;
  const type = d?.event && isCertificateType(d.event.event_type) ? d.event.event_type : null;
  // The token is assigned by record_civil_certificate_print() on the first
  // print; until then the QR shows a placeholder in the on-screen preview.
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const token = issuedToken ?? d?.event.certificate_token ?? null;
  const values = useMemo(() => {
    if (!d || !type || !d.template) return null;
    return resolveCertificateValues(type, {
      event: {
        event_type: d.event.event_type,
        event_number: d.event.event_number,
        event_date: d.event.event_date,
        registration_date: d.event.registration_date,
        issued_at: d.event.issued_at,
        event_details: (d.event.event_details ?? {}) as Record<string, unknown>,
        certificate_token: token,
      },
      registrar: d.registrar,
      woreda: d.woreda,
      printedOn: todayIso(),
    });
  }, [d, type, token]);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isReprint = d?.event.status === "issued";
  const canPrint = isReprint
    ? hasPermission(P.CIVIL_AUTHORIZE_REPRINT)
    : hasPermission(P.CIVIL_PRINT_CERTIFICATE);
  const [reason, setReason] = useState("");

  const [docTitle, setDocTitle] = useState("");
  useEffect(() => {
    if (type && d?.event)
      setDocTitle(`${CERTIFICATE_TYPE_LABELS[type].en} ${d.event.event_number ?? ""}`);
  }, [type, d]);

  const nextFrame = () =>
    new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  const handlePrint = async () => {
    if (!printRef.current || !d?.template || !type) return;
    if (isReprint && reason.trim().length < 5) {
      toast.error(
        "የድጋሚ ህትመት ምክንያት ያስገቡ (ቢያንስ 5 ፊደል) / Enter a reprint reason (at least 5 characters)",
      );
      return;
    }
    setPrinting(true);
    try {
      // 1. Issue / log the print server-side first: permission, state,
      //    published template, print number and the QR token are decided
      //    there, in one transaction. No PDF without a logged print.
      const { data: rows, error } = await supabase.rpc(
        "record_civil_certificate_print" as never,
        { _vital_event_id: eventId, _reprint_reason: isReprint ? reason.trim() : null } as never,
      );
      if (error) throw error;
      const row = (
        rows as unknown as { certificate_token: string; print_no: number }[] | null
      )?.[0];
      if (!row?.certificate_token) throw new Error("No certificate token returned");
      setIssuedToken(row.certificate_token);
      // 2. Let React render the QR with the token before capturing.
      await nextFrame();
      if (!printRef.current) throw new Error("Print surface unavailable");
      const canvas = await html2canvas(printRef.current, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const landscape = d.template.orientation === "landscape";
      const pdf = new jsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "mm",
        format: "a4",
      });
      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        0,
        0,
        landscape ? 297 : 210,
        landscape ? 210 : 297,
      );
      pdf.setProperties({ title: `${docTitle} #${row.print_no}` });
      const blobUrl = URL.createObjectURL(pdf.output("blob"));
      // Anchor click, never a pre-opened window: Chromium silently blocks a
      // deferred navigation of an already-open tab to a blob: URL.
      const link = document.createElement("a");
      link.href = blobUrl;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      setReason("");
      toast.success(
        isReprint
          ? `ድጋሚ ታትሟል (#${row.print_no}) / Reprinted (#${row.print_no})`
          : "የምስክር ወረቀቱ ተሰጥቷል / Certificate issued",
      );
      void dataQuery.refetch();
    } catch (e) {
      toast.error(`የምስክር ወረቀቱ አልታተመም / Could not print the certificate: ${(e as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  const back = (
    <Link to="/woreda/civil/$eventId" params={{ eventId }}>
      <Button variant="outline" size="sm">
        <ArrowLeft className="mr-1 h-4 w-4" />
        <span className="font-am-body">ተመለስ</span>
        <span className="ml-1 opacity-80">/ Back</span>
      </Button>
    </Link>
  );

  if (dataQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  const problem = !d
    ? { am: "ኩነቱ አልተገኘም", en: "Event not found." }
    : !type
      ? { am: "ለዚህ ኩነት የምስክር ወረቀት የለም", en: "This event type has no certificate." }
      : !PRINTABLE.has(d.event.status)
        ? {
            am: "የምስክር ወረቀት የሚታተመው ኩነቱ ከተመዘገበ በኋላ ብቻ ነው",
            en: "A certificate prints only once the event is registered.",
          }
        : !d.template?.published_at
          ? {
              am: "ለዚህ የምስክር ወረቀት የታተመ አብነት የለም",
              en: "No published template for this certificate yet.",
            }
          : null;
  if (problem || !d || !type || !d.template) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-am-body font-medium">{problem?.am}</p>
          <p className="text-sm">{problem?.en}</p>
        </div>
      </div>
    );
  }

  const label = CERTIFICATE_TYPE_LABELS[type];
  const orientation = d.template.orientation;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <h1 className="mr-auto text-lg font-semibold text-slate-900">
          <span className="font-am-heading">{label.am}</span>
          <span className="ml-2 text-sm font-normal text-slate-500">/ {label.en}</span>
        </h1>
        {isReprint && canPrint && (
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="የድጋሚ ህትመት ምክንያት / Reprint reason"
            aria-label="Reprint reason"
            className="font-am-body h-9 w-72"
          />
        )}
        {canPrint ? (
          <Button
            type="button"
            size="sm"
            onClick={handlePrint}
            disabled={printing || (isReprint && reason.trim().length < 5)}
            className="rounded-md bg-blue-700 text-white hover:bg-blue-800"
          >
            {printing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            <span className="font-am-body">{isReprint ? "ድጋሚ አትም" : "አትምና ስጥ"}</span>
            <span className="ml-1 opacity-80">/ {isReprint ? "Reprint" : "Print & issue"}</span>
          </Button>
        ) : (
          <span className="font-am-body text-xs text-slate-500">
            {isReprint ? "ድጋሚ ለማተም ፈቃድ የለዎትም" : "ለማተም ፈቃድ የለዎትም"}
            <span className="ml-1">
              / {isReprint ? "You may not reprint" : "You may not print"} this certificate
            </span>
          </span>
        )}
      </div>
      {isReprint && (
        <p className="font-am-body text-xs text-slate-500">
          ይህ የምስክር ወረቀት ተሰጥቷል፤ ድጋሚ ህትመት ከምክንያቱ ጋር ይመዘገባል።
          <span className="ml-1">
            / This certificate was already issued; a reprint is logged with its reason.
          </span>
        </p>
      )}

      <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-4">
        {/* Dedicated capture node at real paper width, not the live page. */}
        <div
          ref={printRef}
          className="mx-auto bg-white shadow-md"
          style={{ width: orientation === "landscape" ? "297mm" : "210mm" }}
        >
          <CertificatePage
            type={type}
            orientation={orientation}
            fields={d.fields ?? []}
            values={values}
            backgroundUrl={d.images.background}
            imageUrls={{ registrar_signature: d.images.signature, seal: d.images.seal }}
          />
        </div>
      </div>
    </div>
  );
}
