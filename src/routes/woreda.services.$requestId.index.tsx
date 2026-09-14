import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
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
import { PermissionGate } from "@/components/common/PermissionGate";
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
  HistoryTimeline,
  useWorkflowHistory,
  useActorNames,
} from "@/components/workflow/HistoryTimeline";
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
  service_type_id: string;
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
          "service_request_id, request_number, category, status, priority, service_type_id, subject, purpose, addressed_to, details, applicant_name, respondent_name, incident_date, incident_place, resolution_notes, return_reason, reject_reason, fee_amount, payment_id, submitted_at, verified_at, approval_decision_at, issued_at, closed_at, resident_id, kebele_id, resident:resident_id(resident_id, resident_number, full_name_am, full_name), kebele:kebele_id(kebele_name_am, kebele_name_en), service_type:service_type_id(name_am, name_en, requires_approval, requires_payment, fee_amount)",
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

  const workflowHistoryQuery = useWorkflowHistory("service_request", requestId, !!requestId);
  const actorNamesQuery = useActorNames(
    (workflowHistoryQuery.data ?? []).map((h) => h.changed_by_user_id),
  );

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
    queryClient.invalidateQueries({ queryKey: ["service-request-workflow-history", requestId] });
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
  const isLetter = category === "letter";
  const { flow, index } = stageIndex(req.status, category);
  const isTerminal = ["rejected", "closed", "completed"].includes(req.status);
  const canVerify = hasPermission(P.SERVICE_VERIFY);
  const canResubmit = hasPermission(P.SERVICE_RESUBMIT);
  const canApprove = hasPermission(P.SERVICE_APPROVE);
  const canIssue = hasPermission(P.SERVICE_ISSUE);
  const canCollect = hasPermission(P.PAYMENT_COLLECT);
  // Task 14-B: granular verbs used only on the letter path (still civil.*-
  // style additive to the coarse verbs above, which keep gating complaints
  // exactly as before -- see docs/task14b-mapping-memo.md §7).
  const canReturn = hasPermission(P.SERVICE_RETURN);
  const canReject = hasPermission(P.SERVICE_REJECT);
  const canRecordPayment = hasPermission(P.SERVICE_RECORD_PAYMENT);
  const canIssueLetter = hasPermission(P.SERVICE_ISSUE_LETTER);
  const canComplete = hasPermission(P.SERVICE_COMPLETE);

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
                ["approved", "paid", "issued", "completed"].includes(req.status) && (
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

            {/* History -- Task 14-C: unified onto workflow_status_history
                (the engine's own DB-trigger-written table, covering both
                categories since 14-B attached the engine to service_request
                generally) via the shared HistoryTimeline component, instead
                of this route's previous two separate cards. The older
                service_request_status_history table is unchanged and still
                written by transition(), but was a client-side duplicate of
                the same transitions for anything post-14-B; no longer read
                here. */}
            <Card className="p-5">
              <h3 className="font-noto-ethiopic mb-3 text-base font-semibold">
                የሂደት ታሪክ / Status history
              </h3>
              {workflowHistoryQuery.isLoading && (
                <p className="text-sm text-slate-500">በመጫን ላይ... / Loading…</p>
              )}
              {workflowHistoryQuery.isError && (
                <p className="text-sm text-rose-600">ታሪኩን መጫን አልተቻለም / Could not load history</p>
              )}
              {!workflowHistoryQuery.isLoading && !workflowHistoryQuery.isError && (
                <HistoryTimeline
                  rows={workflowHistoryQuery.data ?? []}
                  actorNames={actorNamesQuery.data}
                />
              )}
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

              {/* "returned" only has one legal outbound edge in the seeded
                  FSM (returned -> under_review, service.resubmit) -- it must
                  not reuse the under_review-stage Verify button below, which
                  jumps straight to the post-verify target and would raise a
                  workflow-transition error from this status. */}
              {!isTerminal && req.status === "returned" && canResubmit && (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    transition("under_review", {
                      reason: "Resubmitted after return",
                      action: "SERVICE_REQUEST_RESUBMITTED",
                    })
                  }
                >
                  <Undo2 className="mr-1 h-4 w-4" /> እንደገና አቅርብ / Resubmit
                </Button>
              )}

              {!isTerminal && req.status === "under_review" && canVerify && (
                <div className="space-y-3">
                  <Button
                    className="w-full"
                    disabled={busy}
                    onClick={() =>
                      transition(
                        isLetter
                          ? "verified"
                          : req.service_type?.requires_approval
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

              {/* Letter stage 3a: verified -> pending_approval. The
                  supervisor pulls the item into their own approval queue
                  before deciding on it -- same shape as civil's Task 14-A
                  "Send for Approval" step. */}
              {!isTerminal && isLetter && req.status === "verified" && (
                <PermissionGate
                  permission={P.SERVICE_APPROVE}
                  fallback={
                    <p className="font-noto-ethiopic text-sm text-slate-500">
                      ተረጋግጧል፤ ለማጽደቅ በመጠባበቅ ላይ / Verified — awaiting a supervisor to accept it into
                      the approval queue.
                    </p>
                  }
                >
                  <Button
                    className="w-full"
                    disabled={busy}
                    onClick={() =>
                      transition("pending_approval", {
                        reason: "Sent for approval",
                        action: "SERVICE_REQUEST_SENT_FOR_APPROVAL",
                      })
                    }
                  >
                    ለማጽደቅ ላክ / Send for Approval
                  </Button>
                </PermissionGate>
              )}

              {!isTerminal &&
                ["pending_approval", "approval_returned"].includes(req.status) &&
                canApprove && (
                  <div className="space-y-3">
                    <Button
                      className="w-full"
                      disabled={busy}
                      onClick={() =>
                        transition(isLetter ? "approved" : nextAfterApproval(req), {
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
                      {(!isLetter || canReturn) && (
                        <Button
                          variant="outline"
                          disabled={busy || reason.trim().length < 5}
                          onClick={() =>
                            transition(isLetter ? "returned" : "approval_returned", {
                              extra: { return_reason: reason.trim() },
                              reason: reason.trim(),
                              action: "SERVICE_REQUEST_APPROVAL_RETURNED",
                            })
                          }
                        >
                          <Undo2 className="mr-1 h-4 w-4" /> መልስ / Return
                        </Button>
                      )}
                      {(!isLetter || canReject) && (
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
                      )}
                    </div>
                  </div>
                )}

              {/* Letter stage 4: payment card, mirrors civil's PaymentCard
                  (Task 14-A) -- always records a real payment + receipt,
                  amount may be 0 (B3's universal zero-fee rule). Replaces
                  the old fee>0-only collectPayment() block for letters. */}
              {!isTerminal && isLetter && ["approved", "awaiting_payment"].includes(req.status) && (
                <ServiceLetterPaymentCard
                  requestId={req.service_request_id}
                  serviceTypeId={req.service_type_id}
                  status={req.status}
                  residentId={req.resident_id}
                  woredaId={woredaId!}
                  actorUserId={actorUserId}
                  canRecordPayment={canRecordPayment}
                  onDone={invalidate}
                />
              )}

              {!isTerminal && !isLetter && req.status === "awaiting_payment" && canCollect && (
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

              {/* Letters can only issue from 'paid' (server-enforced by
                  enforce_service_request_issuance_gate() -- see mapping
                  memo §2/§3, this task's own core security fix). Complaints
                  keep 'Start handling' visible at approved/paid unchanged. */}
              {!isTerminal && isLetter && req.status === "paid" && canIssueLetter && (
                <div className="space-y-3">
                  <Link to="/woreda/services/$requestId/print" params={{ requestId }}>
                    <Button variant="outline" className="w-full">
                      <Printer className="mr-1 h-4 w-4" /> ደብዳቤ አትም / Print letter
                    </Button>
                  </Link>
                  <Button className="w-full" disabled={busy} onClick={() => void issueLetter()}>
                    <Check className="mr-1 h-4 w-4" /> ተሰጥቷል ብለው መዝግቡ / Mark issued
                  </Button>
                </div>
              )}

              {!isTerminal &&
                !isLetter &&
                ["approved", "paid"].includes(req.status) &&
                canIssue && (
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

              {/* Letter stage 6: issued -> completed (terminal), replacing
                  the old "Close file" button for the letter path only. */}
              {!isTerminal && isLetter && req.status === "issued" && canComplete && (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    transition("completed", {
                      reason: "Request completed",
                      action: "SERVICE_REQUEST_COMPLETED",
                    })
                  }
                >
                  <Check className="mr-1 h-4 w-4" /> አጠናቅቅ / Complete
                </Button>
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

              {!isTerminal &&
                !isLetter &&
                ["issued", "resolved"].includes(req.status) &&
                canIssue && (
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

              {!isTerminal &&
                !canVerify &&
                !canResubmit &&
                !canApprove &&
                !canIssue &&
                !canCollect &&
                !canRecordPayment &&
                !canIssueLetter &&
                !canComplete && (
                  <p className="font-noto-ethiopic text-sm text-slate-500">
                    በዚህ ደረጃ እርምጃ ለመውሰድ ፈቃድ አልተሰጠዎትም / You do not have permission to act at this
                    stage.
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

// Task 14-B: resolve_service_fee() (00000000000062) -- same fail-closed,
// tenant-internal RPC shape as civil's useCivilFee()/credential's
// useFeeSchedule(), but the source of truth stays service_type.fee_amount
// (mapping memo §0.4), not fee_schedule.
function useServiceFee(serviceTypeId: string | undefined, enabled: boolean) {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["service-fee", woredaId, serviceTypeId],
    enabled: enabled && !!woredaId && !!serviceTypeId,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("resolve_service_fee", {
        _service_type_id: serviceTypeId!,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}

interface ServiceLetterPaymentCardProps {
  requestId: string;
  serviceTypeId: string;
  status: string;
  residentId: string | null;
  woredaId: string;
  actorUserId: string | null;
  canRecordPayment: boolean;
  onDone: () => void;
}

// Mirrors civil's PaymentCard (Task 14-A) exactly in shape: raise the fee at
// `approved` (-> awaiting_payment), then record a payment + receipt to reach
// `paid`. Always records a real payment + receipt, amount possibly 0 (B3's
// universal zero-fee rule) -- replaces the old collectPayment()'s hard
// fee>0 refusal for the letter path.
function ServiceLetterPaymentCard({
  requestId,
  serviceTypeId,
  status,
  residentId,
  woredaId,
  actorUserId,
  canRecordPayment,
  onDone,
}: ServiceLetterPaymentCardProps) {
  const feeQuery = useServiceFee(
    serviceTypeId,
    status === "approved" || status === "awaiting_payment",
  );

  const [channel, setChannel] = useState<"cash" | "bank" | "mobile">("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [busy, setBusy] = useState(false);

  const fee = feeQuery.data ?? 0;

  const canSubmit =
    canRecordPayment &&
    !busy &&
    !feeQuery.isError &&
    !feeQuery.isLoading &&
    feeQuery.data !== undefined &&
    (channel === "cash" || referenceNo.trim().length >= 3);

  const handleRecord = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);

      if (status === "approved") {
        const { data: raiseRow, error: raiseErr } = await supabase
          .from("service_request")
          .update({ status: "awaiting_payment" })
          .eq("service_request_id", requestId)
          .select("service_request_id")
          .maybeSingle();
        if (raiseErr) throw raiseErr;
        if (!raiseRow) {
          throw new Error(
            "ክፍያው ሊጠየቅ አልቻለም / Could not raise the fee — the request may have been moved by someone else",
          );
        }

        await supabase.from("service_request_status_history").insert({
          service_request_id: requestId,
          old_status: "approved",
          new_status: "awaiting_payment",
          changed_by_user_id: actorUserId,
          change_reason: "Fee raised for payment",
        } as never);

        await supabase.from("audit_log").insert({
          woreda_id: woredaId,
          actor_user_id: actorUserId,
          entity_name: "service_request",
          entity_id: requestId,
          action_type: "SERVICE_REQUEST_AWAITING_PAYMENT",
          new_value_json: { status: "awaiting_payment", fee } as never,
          action_at: new Date().toISOString(),
        });
      }

      const { data: pay, error: payErr } = await supabase
        .from("payment")
        .insert({
          woreda_id: woredaId,
          resident_id: residentId,
          payment_type: "service_fee",
          amount: fee,
          payment_date: today,
          channel,
          reference_no: channel === "cash" ? null : referenceNo.trim(),
          status: "confirmed",
          posted_by_user_id: actorUserId,
          service_request_id: requestId,
        } as never)
        .select("payment_id")
        .single();
      if (payErr) throw payErr;
      const paymentId = (pay as { payment_id: string }).payment_id;

      const { data: receiptRow, error: recErr } = await supabase
        .from("receipt")
        .insert({
          woreda_id: woredaId,
          payment_id: paymentId,
          receipt_date: today,
          total_amount: fee,
          cash_bank_channel: channel,
          receipt_number: "",
        } as never)
        .select("receipt_id")
        .single();
      if (recErr) throw recErr;
      if (!receiptRow) {
        throw new Error("ደረሰኝ ሊፈጠር አልቻለም / The payment was recorded but no receipt was created");
      }

      const { data: paidRow, error: updErr } = await supabase
        .from("service_request")
        .update({ status: "paid", payment_id: paymentId })
        .eq("service_request_id", requestId)
        .select("service_request_id")
        .maybeSingle();
      if (updErr) throw updErr;
      if (!paidRow) {
        throw new Error(
          "ክፍያው ሊመዘገብ አልቻለም / Payment was collected but the request could not be marked paid — the request may have been moved by someone else. Contact an administrator before recording another payment.",
        );
      }

      await supabase.from("service_request_status_history").insert({
        service_request_id: requestId,
        old_status: "awaiting_payment",
        new_status: "paid",
        changed_by_user_id: actorUserId,
        change_reason: "Payment recorded",
      } as never);

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "service_request",
        entity_id: requestId,
        action_type: "SERVICE_REQUEST_PAID",
        new_value_json: { status: "paid", payment_id: paymentId, amount: fee } as never,
        action_at: new Date().toISOString(),
      });

      toast.success("ክፍያው ተመዝግቧል / Payment recorded");
      onDone();
    } catch (e) {
      toast.error(`Payment failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h4 className="font-noto-ethiopic text-sm font-semibold">ክፍያ / Payment</h4>
      {feeQuery.isError ? (
        <p className="text-sm text-red-700">{(feeQuery.error as Error).message}</p>
      ) : (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
          <div className="font-noto-ethiopic text-xs text-orange-900">የሚከፈል / Amount due</div>
          <div className="font-mono text-lg font-semibold text-orange-900">
            {feeQuery.isLoading ? "…" : `${fee.toFixed(2)} ETB`}
          </div>
        </div>
      )}
      <PermissionGate
        permission={P.SERVICE_RECORD_PAYMENT}
        fallback={
          <p className="font-noto-ethiopic text-sm text-slate-500">
            ክፍያ ለመመዝገብ ፈቃድ የለዎትም / You do not have permission to record payment for this request.
          </p>
        }
      >
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
        <Button className="w-full" disabled={!canSubmit} onClick={handleRecord}>
          <Banknote className="mr-1 h-4 w-4" /> ክፍያ ተቀበል / Collect payment
        </Button>
      </PermissionGate>
    </div>
  );
}
