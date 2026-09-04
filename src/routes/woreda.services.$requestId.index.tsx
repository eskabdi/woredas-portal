import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Paperclip,
  Printer,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/forms/FormSection";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";
import {
  letterSummary,
  plainTextToHtml,
  renderLetterTemplate,
  sanitizeLetterHtml,
} from "@/lib/letterTemplate";
import { P } from "@/config/permissions";
import { PriorityBadge, StatusBadge } from "@/components/services/ServiceRequestList";
import {
  DOCUMENT_TYPES,
  MAX_UPLOAD_BYTES,
  ALLOWED_UPLOAD_TYPES,
  stageIndex,
  serviceStatusLabel,
  type ServiceCategory,
} from "@/lib/serviceConstants";

export const Route = createFileRoute("/woreda/services/$requestId/")({
  ssr: false,
  component: ServiceRequestDetailPage,
});

const DocumentViewerDialog = lazy(() => import("@/components/common/DocumentViewerDialog"));

interface Detail {
  service_request_id: string;
  request_number: string;
  category: string;
  status: string;
  priority: string;
  subject: string | null;
  purpose: string | null;
  addressed_to: string | null;
  details: string | null;
  applicant_name: string | null;
  applicant_phone: string | null;
  respondent_name: string | null;
  incident_date: string | null;
  incident_place: string | null;
  resolution_notes: string | null;
  return_reason: string | null;
  reject_reason: string | null;
  fee_amount: number;
  payment_id: string | null;
  submitted_at: string;
  verified_at: string | null;
  approval_decision_at: string | null;
  issued_at: string | null;
  closed_at: string | null;
  resident_id: string | null;
  kebele_id: string | null;
  resident: {
    resident_id: string;
    resident_number: string;
    full_name_am: string | null;
    full_name: string | null;
  } | null;
  kebele: { kebele_name_am: string; kebele_name_en: string } | null;
  service_type: {
    name_am: string;
    name_en: string;
    requires_approval: boolean;
    requires_payment: boolean;
    fee_amount: number;
  } | null;
}

function Row({
  labelAm,
  labelEn,
  value,
}: {
  labelAm: string;
  labelEn: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 py-2 last:border-0">
      <div className="text-xs text-slate-500">
        <span className="font-noto-ethiopic">{labelAm}</span> / {labelEn}
      </div>
      <div className="font-noto-ethiopic text-sm text-slate-900">{value ?? "—"}</div>
    </div>
  );
}

function ServiceRequestDetailPage() {
  const { requestId } = useParams({ from: "/woreda/services/$requestId/" });
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.user?.id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("");
  const [channel, setChannel] = useState<"cash" | "bank" | "mobile">("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [docType, setDocType] = useState("other");

  const detailQuery = useQuery({
    queryKey: ["service-request", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_request")
        .select(
          "service_request_id, request_number, category, status, priority, subject, purpose, addressed_to, details, applicant_name, respondent_name, incident_date, incident_place, resolution_notes, return_reason, reject_reason, fee_amount, payment_id, submitted_at, verified_at, approval_decision_at, issued_at, closed_at, resident_id, kebele_id, resident:resident_id(resident_id, resident_number, full_name_am, full_name), kebele:kebele_id(kebele_name_am, kebele_name_en), service_type:service_type_id(name_am, name_en, requires_approval, requires_payment, fee_amount)",
        )
        .eq("service_request_id", requestId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // service_request_decrypted isn't in the generated types yet
      // (00000000000023_pii_encryption.sql) -- same untyped-client cast
      // pattern already used elsewhere in this codebase for pre-typegen
      // tables. Queried separately: the select above embeds resident/kebele/
      // service_type via FK-derived PostgREST joins, which are not
      // guaranteed to resolve through a view the same way they do through
      // the base table. Merged back onto the same `applicant_phone` key so
      // Detail and every render site below stay unchanged.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data: contact, error: contactError } = await db
        .from("service_request_decrypted")
        .select("applicant_phone_decrypted")
        .eq("service_request_id", requestId)
        .maybeSingle();
      if (contactError) throw contactError;

      return {
        ...data,
        applicant_phone: contact?.applicant_phone_decrypted ?? null,
      } as unknown as Detail;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["service-request-history", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_request_status_history")
        .select("id, old_status, new_status, change_reason, changed_at")
        .eq("service_request_id", requestId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const attachmentsQuery = useQuery({
    queryKey: ["service-request-attachments", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_request_attachment")
        .select(
          "attachment_id, document_type, file_name, storage_path, file_size_bytes, content_type, created_at",
        )
        .eq("service_request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const req = detailQuery.data ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["service-request", requestId] });
    queryClient.invalidateQueries({ queryKey: ["service-request-history", requestId] });
    queryClient.invalidateQueries({ queryKey: ["service-requests"] });
    queryClient.invalidateQueries({ queryKey: ["approval-queue"] });
  };

  const transition = async (
    next: string,
    opts?: {
      extra?: Record<string, unknown>;
      reason?: string;
      action?: string;
      successAm?: string;
    },
  ) => {
    if (!req || !woredaId) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("service_request")
        .update({ ...(opts?.extra ?? {}), status: next } as never)
        .eq("service_request_id", req.service_request_id);
      if (error) throw error;

      await supabase.from("service_request_status_history").insert({
        service_request_id: req.service_request_id,
        old_status: req.status,
        new_status: next,
        changed_by_user_id: actorUserId,
        change_reason: opts?.reason ?? null,
      } as never);

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "service_request",
        entity_id: req.service_request_id,
        action_type: opts?.action ?? `SERVICE_REQUEST_${next.toUpperCase()}`,
        new_value_json: { status: next, reason: opts?.reason ?? null } as never,
        action_at: nowIso,
      });

      toast.success(opts?.successAm ?? `ደረጃው ተቀይሯል / ${serviceStatusLabel(next)}`);
      setReason("");
      invalidate();
    } catch (e) {
      toast.error(`Action failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /** Snapshots the rendered letter + summary so the public QR page can show it. */
  const issueLetter = async () => {
    if (!req) return;
    let issuedHtml = "";
    let summary = "";
    try {
      const { data: st } = await supabase
        .from("service_request")
        .select("service_type:service_type_id(letter_body_html, letter_body_template)")
        .eq("service_request_id", req.service_request_id)
        .maybeSingle();
      const type = (
        st as never as {
          service_type: {
            letter_body_html: string | null;
            letter_body_template: string | null;
          } | null;
        } | null
      )?.service_type;
      const template = type?.letter_body_html ?? plainTextToHtml(type?.letter_body_template ?? "");
      const now = new Date();
      issuedHtml = renderLetterTemplate(sanitizeLetterHtml(template), {
        APPLICANT_NAME:
          req.resident?.full_name_am ?? req.resident?.full_name ?? req.applicant_name ?? "—",
        RESIDENT_NUMBER: req.resident?.resident_number ?? "—",
        KEBELE: req.kebele?.kebele_name_am ?? "—",
        WOREDA: "",
        PURPOSE: req.purpose ?? req.subject ?? "—",
        ADDRESSED_TO: req.addressed_to ?? "",
        LETTER_NO: req.request_number,
        DATE_ET: formatEthiopianDate(now),
        DATE_GC: now.toLocaleDateString("en-GB"),
        SEX: "",
        DETAILS: req.details ?? "",
      });
      summary = letterSummary(issuedHtml) || (req.purpose ?? req.subject ?? "");
    } catch {
      summary = req.purpose ?? req.subject ?? "";
    }

    await transition("issued", {
      extra: {
        issued_by_user_id: actorUserId,
        issued_at: new Date().toISOString(),
        issued_letter_html: issuedHtml || null,
        letter_summary: summary || null,
      },
      reason: "Letter issued to applicant",
      action: "SERVICE_REQUEST_ISSUED",
    });
  };

  const nextAfterApproval = (r: Detail) => {
    if (r.service_type?.requires_payment && Number(r.fee_amount) > 0) return "awaiting_payment";
    return r.category === "complaint" ? "in_progress" : "approved";
  };

  const collectPayment = async () => {
    if (!req || !woredaId) return;
    const amount = Number(req.fee_amount);
    if (!(amount > 0)) {
      toast.error("ክፍያ የማይጠይቅ ጥያቄ / This request has no fee");
      return;
    }
    if (channel !== "cash" && referenceNo.trim().length < 3) {
      toast.error("የክፍያ ማጣቀሻ ያስገቡ / Enter a payment reference");
      return;
    }
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: pay, error: payErr } = await supabase
        .from("payment")
        .insert({
          woreda_id: woredaId,
          resident_id: req.resident_id,
          payment_type: "service_fee",
          amount,
          payment_date: today,
          channel,
          reference_no: channel === "cash" ? null : referenceNo.trim(),
          status: "confirmed",
          posted_by_user_id: actorUserId,
          service_request_id: req.service_request_id,
        } as never)
        .select("payment_id")
        .single();
      if (payErr) throw payErr;
      const paymentId = (pay as { payment_id: string }).payment_id;

      const { error: recErr } = await supabase.from("receipt").insert({
        woreda_id: woredaId,
        payment_id: paymentId,
        receipt_date: today,
        total_amount: amount,
        cash_bank_channel: channel,
        receipt_number: "",
      } as never);
      if (recErr) throw recErr;

      await transition("paid", {
        extra: { payment_id: paymentId },
        reason: `Fee collected (${channel})`,
        action: "SERVICE_FEE_COLLECTED",
        successAm: "ክፍያ ተመዝግቧል / Payment recorded",
      });
      setReferenceNo("");
      queryClient.invalidateQueries({ queryKey: ["revenue"] });
    } catch (e) {
      toast.error(`Payment failed: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const uploadAttachment = async (file: File) => {
    if (!req || !woredaId) return;
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      toast.error("JPG, PNG, WEBP ወይም PDF ብቻ / Only JPG, PNG, WEBP or PDF");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("ከ5MB በላይ / File larger than 5MB");
      return;
    }
    setBusy(true);
    try {
      const safe = file.name.replace(/[^\w.-]/g, "_");
      const path = `${woredaId}/${req.service_request_id}/${Date.now()}-${safe}`;
      const up = await supabase.storage
        .from("service-request-documents")
        .upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { error } = await supabase.from("service_request_attachment").insert({
        woreda_id: woredaId,
        service_request_id: req.service_request_id,
        document_type: docType,
        file_name: file.name,
        storage_path: path,
        file_size_bytes: file.size,
        content_type: file.type,
        uploaded_by_user_id: actorUserId,
      } as never);
      if (error) throw error;
      toast.success("ሰነዱ ተያይዟል / Document attached");
      queryClient.invalidateQueries({ queryKey: ["service-request-attachments", requestId] });
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);

  const openAttachment = async (path: string, fileName: string, contentType: string | null) => {
    const { data, error } = await supabase.storage
      .from("service-request-documents")
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast.error("ፋይሉን መክፈት አልተቻለም / Could not open the file");
      return;
    }
    if (contentType === "application/pdf") {
      setViewerUrl(data.signedUrl);
      setViewerTitle(fileName);
      setViewerOpen(true);
    } else {
      window.open(data.signedUrl, "_blank", "noopener");
    }
  };

  if (detailQuery.isPending) {
    return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;
  }
  if (detailQuery.isError || !req) {
    return (
      <div className="space-y-4 py-20 text-center">
        <p className="font-noto-ethiopic text-sm text-slate-600">ጥያቄው አልተገኘም / Request not found</p>
        <Button variant="outline" onClick={() => navigate({ to: "/woreda/services" })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> ተመለስ / Back
        </Button>
      </div>
    );
  }

  const category = (req.category === "complaint" ? "complaint" : "letter") as ServiceCategory;
  const { flow, index } = stageIndex(req.status, category);
  const isTerminal = ["rejected", "closed"].includes(req.status);
  const canVerify = hasPermission(P.SERVICE_VERIFY);
  const canApprove = hasPermission(P.SERVICE_APPROVE);
  const canIssue = hasPermission(P.SERVICE_ISSUE);
  const canCollect = hasPermission(P.PAYMENT_COLLECT);

  return (
    <>
      <div className="space-y-6 pb-16">
        <PageHeader
          titleAm={req.subject || (category === "complaint" ? "ቅሬታ" : "የአገልግሎት ጥያቄ")}
          titleEn={req.request_number}
          description={
            req.service_type ? `${req.service_type.name_am} / ${req.service_type.name_en}` : ""
          }
          actions={
            <div className="flex items-center gap-2">
              <Link to={category === "complaint" ? "/woreda/complaints" : "/woreda/services"}>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-1 h-4 w-4" /> ተመለስ / Back
                </Button>
              </Link>
              {category === "letter" &&
                ["approved", "paid", "issued", "closed"].includes(req.status) && (
                  <Link to="/woreda/services/$requestId/print" params={{ requestId }}>
                    <Button size="sm">
                      <Printer className="mr-1 h-4 w-4" /> ደብዳቤ አትም / Print letter
                    </Button>
                  </Link>
                )}
            </div>
          }
        />

        {/* Stepper */}
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            {flow.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold " +
                    (isTerminal
                      ? "bg-slate-200 text-slate-500"
                      : i <= index
                        ? "bg-blue-700 text-white"
                        : "bg-slate-100 text-slate-500")
                  }
                >
                  {i < index && !isTerminal ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className="font-noto-ethiopic text-xs text-slate-600">
                  {serviceStatusLabel(s)}
                </span>
                {i < flow.length - 1 && <span className="mx-1 text-slate-300">→</span>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={req.status} />
            <PriorityBadge priority={req.priority} />
            {req.return_reason && (
              <span className="font-noto-ethiopic text-xs text-amber-700">
                የመመለስ ምክንያት: {req.return_reason}
              </span>
            )}
            {req.reject_reason && (
              <span className="font-noto-ethiopic text-xs text-red-700">
                የውድቅ ምክንያት: {req.reject_reason}
              </span>
            )}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="p-5">
              <h3 className="font-noto-ethiopic mb-3 flex items-center gap-2 text-base font-semibold">
                <FileText className="h-4 w-4 text-blue-700" /> የጥያቄ መረጃ / Request information
              </h3>
              <div className="grid gap-x-8 md:grid-cols-2">
                <Row
                  labelAm="አመልካች"
                  labelEn="Applicant"
                  value={
                    req.resident ? (
                      <Link
                        to="/woreda/residents/$residentId"
                        params={{ residentId: req.resident.resident_id }}
                        className="text-blue-700 hover:underline"
                      >
                        {req.resident.full_name_am || req.resident.full_name} (
                        {req.resident.resident_number})
                      </Link>
                    ) : (
                      req.applicant_name
                    )
                  }
                />
                <Row labelAm="ስልክ" labelEn="Phone" value={req.applicant_phone} />
                <Row
                  labelAm="ቀበሌ"
                  labelEn="Kebele"
                  value={
                    req.kebele
                      ? `${req.kebele.kebele_name_am} / ${req.kebele.kebele_name_en}`
                      : null
                  }
                />
                <Row
                  labelAm="የቀረበበት ቀን"
                  labelEn="Submitted"
                  value={new Date(req.submitted_at).toLocaleString("en-GB", { hour12: false })}
                />
                {category === "letter" ? (
                  <>
                    <Row labelAm="ዓላማ" labelEn="Purpose" value={req.purpose} />
                    <Row labelAm="ለማን" labelEn="Addressed to" value={req.addressed_to} />
                  </>
                ) : (
                  <>
                    <Row labelAm="ተከሳሽ" labelEn="Respondent" value={req.respondent_name} />
                    <Row
                      labelAm="የተከሰተበት"
                      labelEn="Incident"
                      value={
                        [req.incident_date, req.incident_place].filter(Boolean).join(" — ") || null
                      }
                    />
                  </>
                )}
                <Row
                  labelAm="ክፍያ"
                  labelEn="Fee"
                  value={
                    Number(req.fee_amount) > 0
                      ? `${Number(req.fee_amount).toFixed(2)} ETB`
                      : "ነጻ / Free"
                  }
                />
              </div>
              <div className="mt-4">
                <div className="text-xs text-slate-500">
                  <span className="font-noto-ethiopic">ማብራሪያ</span> / Description
                </div>
                <p className="font-noto-ethiopic mt-1 whitespace-pre-wrap text-sm text-slate-800">
                  {req.details || "—"}
                </p>
              </div>
              {req.resolution_notes && (
                <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <div className="font-noto-ethiopic text-xs font-medium text-emerald-900">
                    የመፍትሔ ማስታወሻ / Resolution notes
                  </div>
                  <p className="font-noto-ethiopic mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                    {req.resolution_notes}
                  </p>
                </div>
              )}
            </Card>

            {/* Attachments */}
            <Card className="p-5">
              <h3 className="font-noto-ethiopic mb-3 flex items-center gap-2 text-base font-semibold">
                <Paperclip className="h-4 w-4 text-blue-700" /> ማስረጃ ሰነዶች / Attachments
              </h3>
              {(attachmentsQuery.data ?? []).length === 0 ? (
                <p className="font-noto-ethiopic text-sm text-slate-500">
                  ሰነድ አልተያያዘም / No documents attached
                </p>
              ) : (
                <div className="space-y-2">
                  {(attachmentsQuery.data ?? []).map((a) => (
                    <div
                      key={a.attachment_id}
                      className="flex items-center gap-3 rounded-md border bg-slate-50 px-3 py-2"
                    >
                      <Paperclip className="h-4 w-4 text-slate-400" />
                      <span className="flex-1 truncate text-sm">{a.file_name}</span>
                      <span className="font-noto-ethiopic text-xs text-slate-500">
                        {DOCUMENT_TYPES.find((d) => d.value === a.document_type)?.labelAm ??
                          a.document_type}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAttachment(a.storage_path, a.file_name, a.content_type)}
                      >
                        <Download className="mr-1 h-4 w-4" /> ክፈት
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {!isTerminal && canVerify && (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
                  <div>
                    <Label className="font-noto-ethiopic text-xs">የሰነድ ዓይነት / Document type</Label>
                    <Select
                      className="mt-1 w-[200px]"
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                    >
                      {DOCUMENT_TYPES.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.labelAm} / {d.labelEn}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-slate-50">
                    <Upload className="h-4 w-4" />
                    <span className="font-noto-ethiopic">ሰነድ ጨምር / Add document</span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".jpg,.jpeg,.png,.webp,.pdf"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAttachment(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
            </Card>

            {/* History */}
            <Card className="p-5">
              <h3 className="font-noto-ethiopic mb-3 text-base font-semibold">
                የሂደት ታሪክ / Status history
              </h3>
              <ol className="space-y-3">
                {(historyQuery.data ?? []).map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    <div>
                      <div className="font-noto-ethiopic text-sm">
                        {h.old_status ? `${serviceStatusLabel(h.old_status)} → ` : ""}
                        {serviceStatusLabel(h.new_status)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(h.changed_at).toLocaleString("en-GB", { hour12: false })}
                        {h.change_reason ? ` — ${h.change_reason}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
                {(historyQuery.data ?? []).length === 0 && (
                  <li className="text-sm text-slate-500">—</li>
                )}
              </ol>
            </Card>
          </div>

          {/* Workflow actions */}
          <div className="space-y-6">
            <Card className="p-5">
              <h3 className="font-noto-ethiopic mb-3 text-base font-semibold">
                የስራ ሂደት / Workflow actions
              </h3>

              {isTerminal && (
                <p className="font-noto-ethiopic text-sm text-slate-500">
                  ይህ ጥያቄ ተዘግቷል / This request is closed.
                </p>
              )}

              {!isTerminal && req.status === "submitted" && canVerify && (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    transition("under_review", {
                      reason: "Review started",
                      action: "SERVICE_REQUEST_REVIEW_STARTED",
                    })
                  }
                >
                  ክለሳ ጀምር / Start review
                </Button>
              )}

              {!isTerminal && ["under_review", "returned"].includes(req.status) && canVerify && (
                <div className="space-y-3">
                  <Button
                    className="w-full"
                    disabled={busy}
                    onClick={() =>
                      transition(
                        req.service_type?.requires_approval
                          ? "pending_approval"
                          : nextAfterApproval(req),
                        {
                          extra: {
                            verified_by_user_id: actorUserId,
                            verified_at: new Date().toISOString(),
                          },
                          reason: "Verified by clerk",
                          action: "SERVICE_REQUEST_VERIFIED",
                        },
                      )
                    }
                  >
                    <Check className="mr-1 h-4 w-4" /> አረጋግጥ / Verify
                  </Button>
                  <div>
                    <Label className="font-noto-ethiopic text-xs">
                      የመመለስ ምክንያት / Return reason
                    </Label>
                    <Textarea
                      className="font-noto-ethiopic mt-1"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      transition("returned", {
                        extra: { return_reason: reason.trim() },
                        reason: reason.trim(),
                        action: "SERVICE_REQUEST_RETURNED",
                      })
                    }
                  >
                    <Undo2 className="mr-1 h-4 w-4" /> መልስ / Return
                  </Button>
                </div>
              )}

              {!isTerminal &&
                ["pending_approval", "approval_returned"].includes(req.status) &&
                canApprove && (
                  <div className="space-y-3">
                    <Button
                      className="w-full"
                      disabled={busy}
                      onClick={() =>
                        transition(nextAfterApproval(req), {
                          extra: {
                            approved_by_user_id: actorUserId,
                            approval_decision_at: new Date().toISOString(),
                          },
                          reason: "Approved by supervisor",
                          action: "SERVICE_REQUEST_APPROVED",
                        })
                      }
                    >
                      <Check className="mr-1 h-4 w-4" /> አጽድቅ / Approve
                    </Button>
                    <div>
                      <Label className="font-noto-ethiopic text-xs">ምክንያት / Reason</Label>
                      <Textarea
                        className="font-noto-ethiopic mt-1"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Button
                        variant="outline"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          transition("approval_returned", {
                            extra: { return_reason: reason.trim() },
                            reason: reason.trim(),
                            action: "SERVICE_REQUEST_APPROVAL_RETURNED",
                          })
                        }
                      >
                        <Undo2 className="mr-1 h-4 w-4" /> መልስ / Return
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          transition("rejected", {
                            extra: {
                              reject_reason: reason.trim(),
                              closed_at: new Date().toISOString(),
                            },
                            reason: reason.trim(),
                            action: "SERVICE_REQUEST_REJECTED",
                          })
                        }
                      >
                        <X className="mr-1 h-4 w-4" /> ውድቅ አድርግ / Reject
                      </Button>
                    </div>
                  </div>
                )}

              {!isTerminal && req.status === "awaiting_payment" && canCollect && (
                <div className="space-y-3">
                  <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
                    <div className="font-noto-ethiopic text-xs text-orange-900">
                      የሚከፈል / Amount due
                    </div>
                    <div className="font-mono text-lg font-semibold text-orange-900">
                      {Number(req.fee_amount).toFixed(2)} ETB
                    </div>
                  </div>
                  <div>
                    <Label className="font-noto-ethiopic text-xs">የክፍያ መንገድ / Channel</Label>
                    <Select
                      className="mt-1"
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as "cash" | "bank" | "mobile")}
                    >
                      <option value="cash">ጥሬ ገንዘብ / Cash</option>
                      <option value="bank">ባንክ / Bank</option>
                      <option value="mobile">ሞባይል / Mobile</option>
                    </Select>
                  </div>
                  {channel !== "cash" && (
                    <div>
                      <Label className="font-noto-ethiopic text-xs">ማጣቀሻ / Reference</Label>
                      <Input
                        className="mt-1"
                        value={referenceNo}
                        onChange={(e) => setReferenceNo(e.target.value)}
                      />
                    </div>
                  )}
                  <Button className="w-full" disabled={busy} onClick={collectPayment}>
                    <Banknote className="mr-1 h-4 w-4" /> ክፍያ ተቀበል / Collect payment
                  </Button>
                </div>
              )}

              {!isTerminal && ["approved", "paid"].includes(req.status) && canIssue && (
                <div className="space-y-3">
                  {category === "letter" ? (
                    <>
                      <Link to="/woreda/services/$requestId/print" params={{ requestId }}>
                        <Button variant="outline" className="w-full">
                          <Printer className="mr-1 h-4 w-4" /> ደብዳቤ አትም / Print letter
                        </Button>
                      </Link>
                      <Button className="w-full" disabled={busy} onClick={() => void issueLetter()}>
                        <Check className="mr-1 h-4 w-4" /> ተሰጥቷል ብለው መዝግቡ / Mark issued
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={busy}
                      onClick={() =>
                        transition("in_progress", {
                          reason: "Case handling started",
                          action: "SERVICE_REQUEST_IN_PROGRESS",
                        })
                      }
                    >
                      ሂደት ጀምር / Start handling
                    </Button>
                  )}
                </div>
              )}

              {!isTerminal && req.status === "in_progress" && canIssue && (
                <div className="space-y-3">
                  <div>
                    <Label className="font-noto-ethiopic text-xs">
                      የመፍትሔ ማስታወሻ / Resolution notes
                    </Label>
                    <Textarea
                      className="font-noto-ethiopic mt-1"
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full"
                    disabled={busy || resolution.trim().length < 5}
                    onClick={() =>
                      transition("resolved", {
                        extra: { resolution_notes: resolution.trim() },
                        reason: "Complaint resolved",
                        action: "SERVICE_REQUEST_RESOLVED",
                      })
                    }
                  >
                    <Check className="mr-1 h-4 w-4" /> ተፈትቷል / Mark resolved
                  </Button>
                </div>
              )}

              {!isTerminal && ["issued", "resolved"].includes(req.status) && canIssue && (
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  disabled={busy}
                  onClick={() =>
                    transition("closed", {
                      extra: { closed_at: new Date().toISOString() },
                      reason: "File closed",
                      action: "SERVICE_REQUEST_CLOSED",
                    })
                  }
                >
                  መዝገቡን ዘጋ / Close file
                </Button>
              )}

              {!isTerminal && !canVerify && !canApprove && !canIssue && !canCollect && (
                <p className="font-noto-ethiopic text-sm text-slate-500">
                  በዚህ ደረጃ እርምጃ ለመውሰድ ፈቃድ አልተሰጠዎትም / You do not have permission to act at this stage.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
      {viewerOpen && (
        <Suspense fallback={null}>
          <DocumentViewerDialog
            open={viewerOpen}
            onOpenChange={setViewerOpen}
            signedUrl={viewerUrl}
            title={viewerTitle}
          />
        </Suspense>
      )}
    </>
  );
}
