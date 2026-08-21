import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  Printer,
  Receipt as ReceiptIcon,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/woreda/credentials/$requestId/")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CREDENTIAL_READ}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to view credential requests.</p>
        </div>
      }
    >
      <CredentialRequestDetailPage />
    </PermissionGate>
  ),
});

const DocumentViewerDialog = lazy(() => import("@/components/common/DocumentViewerDialog"));

const REQUEST_TYPE_LABEL: Record<string, string> = {
  new_issue: "አዲስ / New Issue",
  renewal: "እድሳት / Renewal",
  reissue_lost: "የጠፋ / Lost",
  reissue_damaged: "የተበላሸ / Damaged",
  reissue_stolen: "የተሰረቀ / Stolen",
  reissue_correction: "እርማት / Correction",
};

const CRED_TYPE_LABEL: Record<string, string> = {
  card: "ካርድ / Card",
  certificate: "ሰርተፍኬት / Certificate",
  both: "ሁለቱም / Both",
};

const CHECKLIST_ITEMS: {
  key: ChecklistKey;
  labelAm: string;
  labelEn: string;
}[] = [
  {
    key: "identity_complete",
    labelAm: "የነዋሪ መረጃ ሙሉ ነው",
    labelEn: "Resident identity data is complete",
  },
  {
    key: "photo_ok",
    labelAm: "ፎቶ ግራፍ ጥራት ተስማሚ ነው",
    labelEn: "Photo present and acceptable quality",
  },
  {
    key: "household_valid",
    labelAm: "ቤተሰብ በትክክል ተረጋግጧል",
    labelEn: "Household validity confirmed",
  },
  {
    key: "request_type_valid",
    labelAm: "የጥያቄ ዓይነት ትክክል ነው",
    labelEn: "Request type is correctly selected",
  },
  {
    key: "documents_ok",
    labelAm: "ደጋፊ ሰነዶች ተያይዘዋል እና ይነበባሉ",
    labelEn: "Supporting documents attached and legible",
  },
  {
    key: "duplicate_reviewed",
    labelAm: "የድግግሞሽ ውጤት ተገምግሟል",
    labelEn: "Duplicate detection result reviewed and resolved",
  },
];

type ChecklistKey =
  | "identity_complete"
  | "photo_ok"
  | "household_valid"
  | "request_type_valid"
  | "documents_ok"
  | "duplicate_reviewed";

type ChecklistState = Record<ChecklistKey, boolean>;

function CredentialRequestDetailPage() {
  const { requestId } = Route.useParams();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAct = hasPermission(P.CREDENTIAL_ISSUE);
  const canApprove = hasPermission(P.CREDENTIAL_APPROVE);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const requestQuery = useQuery({
    queryKey: ["credential-request", requestId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_request")
        .select(
          `credential_request_id, request_number, status, request_type, credential_type,
           resident_id, household_id, issuing_kebele_id, prior_credential_id, credential_id,
           supporting_document_path, supporting_document_name,
           verification_checklist, verified_by_user_id, verified_at,
           return_reason, submitted_at, created_at,
           duplicate_flag, duplicate_notes,
           approved_by_user_id, approval_decision_at, reject_reason, payment_id,
           resident:resident_id (
             resident_id, resident_number, national_id_no, full_name, full_name_am, sex, date_of_birth, photo_url
           ),
           household:household_id (
             household_id, house_number,
             kebele:kebele_id (kebele_id, kebele_name_am, kebele_name_en, kebele_number)
           ),
           prior:prior_credential_id (
             credential_id, credential_number, status, issue_date
           )`,
        )
        .eq("credential_request_id", requestId)
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const request = requestQuery.data;

  // supporting_document_content_type isn't in the generated Supabase types
  // yet (regenerated only after the migration adding it is applied to the
  // live project -- see CLAUDE.md), so it's fetched separately with an
  // explicit cast rather than widening requestQuery's select string, which
  // would collapse that whole query's inference to SelectQueryError.
  const docContentTypeQuery = useQuery({
    queryKey: ["credential-request-doc-content-type", request?.credential_request_id],
    enabled: !!request?.credential_request_id && !!request?.supporting_document_path,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_request")
        .select("supporting_document_content_type")
        .eq("credential_request_id", request!.credential_request_id)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as unknown as { supporting_document_content_type: string | null } | null)
          ?.supporting_document_content_type ?? null
      );
    },
  });

  // Full credential history for this resident (approval-stage review)
  const residentCredsQuery = useQuery({
    queryKey: ["credential-history", request?.resident_id, woredaId],
    enabled: !!request?.resident_id && !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select("credential_id, credential_number, credential_type, status, issue_date")
        .eq("resident_id", request!.resident_id)
        .eq("woreda_id", woredaId!)
        .order("issue_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Signed URLs
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const residentPhotoPath = (request?.resident as any)?.photo_url as string | null | undefined;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (residentPhotoPath) {
        const { data } = await supabase.storage
          .from("resident-photos")
          .createSignedUrl(residentPhotoPath, 600);
        if (!cancelled) setPhotoUrl(data?.signedUrl ?? null);
      } else if (!cancelled) {
        setPhotoUrl(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [residentPhotoPath]);

  const [viewerOpen, setViewerOpen] = useState(false);

  const openDocument = async () => {
    if (!request?.supporting_document_path) return;
    const { data, error } = await supabase.storage
      .from("credential-request-documents")
      .createSignedUrl(request.supporting_document_path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open document");
      return;
    }
    setDocUrl(data.signedUrl);
    if (docContentTypeQuery.data === "application/pdf") {
      setViewerOpen(true);
    } else {
      window.open(data.signedUrl, "_blank", "noopener");
    }
  };

  const status = request?.status ?? "";
  const isEditable = status === "submitted" || status === "under_review";
  const isReturned = status === "returned";

  // Checklist state
  const savedChecklist = useMemo<Partial<ChecklistState> & Record<string, unknown>>(() => {
    const v = request?.verification_checklist;
    return (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Partial<ChecklistState> &
      Record<string, unknown>;
  }, [request?.verification_checklist]);

  const initialChecklist = useMemo<ChecklistState>(() => {
    const hasResidentPhoto = Boolean(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request?.resident as any)?.photo_url,
    );
    const hasDoc = Boolean(request?.supporting_document_path);
    return {
      identity_complete: savedChecklist.identity_complete === true,
      photo_ok:
        savedChecklist.photo_ok === true ||
        (savedChecklist.photo_ok === undefined && hasResidentPhoto),
      household_valid: savedChecklist.household_valid === true,
      request_type_valid: savedChecklist.request_type_valid === true,
      documents_ok:
        savedChecklist.documents_ok === true ||
        (savedChecklist.documents_ok === undefined && hasDoc),
      duplicate_reviewed: savedChecklist.duplicate_reviewed === true,
    };
  }, [savedChecklist, request]);

  const [checklist, setChecklist] = useState<ChecklistState>(initialChecklist);
  const [checklistInitialized, setChecklistInitialized] = useState(false);

  useEffect(() => {
    if (!checklistInitialized && request) {
      setChecklist(initialChecklist);
      setChecklistInitialized(true);
    }
  }, [checklistInitialized, request, initialChecklist]);

  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [approvalReturnOpen, setApprovalReturnOpen] = useState(false);
  const [approvalReturnReason, setApprovalReturnReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const allChecked = CHECKLIST_ITEMS.every((i) => checklist[i.key]);
  const missingCorrectionDoc =
    request?.request_type === "reissue_correction" && !request?.supporting_document_path;

  const dobDisplay = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dob = (request?.resident as any)?.date_of_birth as string | null | undefined;
    if (!dob) return "—";
    return formatEthiopianDate(new Date(dob));
  }, [request]);

  const submittedDisplay = useMemo(() => {
    const s = request?.submitted_at ?? request?.created_at;
    if (!s) return "—";
    return formatEthiopianDate(new Date(s));
  }, [request?.submitted_at, request?.created_at]);

  const handlePass = async () => {
    if (!request || !actorUserId || !woredaId) return;
    if (!allChecked || missingCorrectionDoc) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const payload = {
        status: "pending_approval",
        verified_by_user_id: actorUserId,
        verified_at: nowIso,
        verification_checklist: {
          ...checklist,
          reviewed_by: actorUserId,
          reviewed_at: nowIso,
        } as never,
      };
      const { error } = await supabase
        .from("credential_request")
        .update(payload)
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: status,
        new_status: "pending_approval",
        changed_by_user_id: actorUserId,
        change_reason: "Verification passed — all checklist items confirmed",
      });

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_VERIFIED",
        new_value_json: { checklist } as never,
        action_at: nowIso,
      });

      toast.success("ጥያቄው ተረጋግጦ ወደ ማጽደቅ ተልኳል / Request verified and sent for approval");
      queryClient.invalidateQueries({
        queryKey: ["credential-request", request.credential_request_id],
      });
      queryClient.invalidateQueries({ queryKey: ["credential-requests"] });
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReturn = async () => {
    if (!request || !actorUserId || !woredaId) return;
    const reason = returnReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("credential_request")
        .update({ status: "returned", return_reason: reason })
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: status,
        new_status: "returned",
        changed_by_user_id: actorUserId,
        change_reason: reason,
      });

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_RETURNED",
        new_value_json: { return_reason: reason } as never,
        action_at: nowIso,
      });

      toast.success("ጥያቄው ተመልሷል / Request returned");
      setReturnDialogOpen(false);
      setReturnReason("");
      queryClient.invalidateQueries({
        queryKey: ["credential-request", request.credential_request_id],
      });
      queryClient.invalidateQueries({ queryKey: ["credential-requests"] });
    } catch (e) {
      toast.error(`Return failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResubmit = async () => {
    if (!request || !actorUserId || !woredaId) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("credential_request")
        .update({ status: "under_review", return_reason: null })
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: "returned",
        new_status: "under_review",
        changed_by_user_id: actorUserId,
        change_reason: "Resubmitted for review",
      });

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_RESUBMITTED",
        new_value_json: null,
        action_at: nowIso,
      });

      toast.success("ጥያቄው እንደገና ለክለሳ ተልኳል / Resubmitted for review");
      queryClient.invalidateQueries({
        queryKey: ["credential-request", request.credential_request_id],
      });
      queryClient.invalidateQueries({ queryKey: ["credential-requests"] });
    } catch (e) {
      toast.error(`Resubmit failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const invalidateAll = () => {
    if (!request) return;
    queryClient.invalidateQueries({
      queryKey: ["credential-request", request.credential_request_id],
    });
    queryClient.invalidateQueries({ queryKey: ["credential-requests"] });
  };

  const handleApprove = async () => {
    if (!request || !actorUserId || !woredaId) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("credential_request")
        .update({
          status: "awaiting_payment",
          approved_by_user_id: actorUserId,
          approval_decision_at: nowIso,
        })
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: status,
        new_status: "awaiting_payment",
        changed_by_user_id: actorUserId,
        change_reason: "Approved",
      });
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_APPROVED",
        new_value_json: null,
        action_at: nowIso,
      });

      toast.success("ጥያቄው ጸድቋል፤ ወደ ክፍያ ተልኳል / Request approved, sent for payment");
      invalidateAll();
    } catch (e) {
      toast.error(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApprovalReturn = async () => {
    if (!request || !actorUserId || !woredaId) return;
    const reason = approvalReturnReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("credential_request")
        .update({ status: "approval_returned", return_reason: reason })
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: status,
        new_status: "approval_returned",
        changed_by_user_id: actorUserId,
        change_reason: reason,
      });
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_APPROVAL_RETURNED",
        new_value_json: { return_reason: reason } as never,
        action_at: nowIso,
      });

      toast.success("ጥያቄው በማጽደቅ ደረጃ ተመልሷል / Request returned at approval stage");
      setApprovalReturnOpen(false);
      setApprovalReturnReason("");
      invalidateAll();
    } catch (e) {
      toast.error(`Return failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!request || !actorUserId || !woredaId) return;
    const reason = rejectReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("credential_request")
        .update({ status: "rejected", reject_reason: reason })
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: status,
        new_status: "rejected",
        changed_by_user_id: actorUserId,
        change_reason: reason,
      });
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_REJECTED",
        new_value_json: { reject_reason: reason } as never,
        action_at: nowIso,
      });

      toast.success("ጥያቄው ውድቅ ተደርጓል / Request rejected");
      setRejectOpen(false);
      setRejectReason("");
      invalidateAll();
    } catch (e) {
      toast.error(`Reject failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResubmitForApproval = async () => {
    if (!request || !actorUserId || !woredaId) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("credential_request")
        .update({ status: "pending_approval", return_reason: null })
        .eq("credential_request_id", request.credential_request_id);
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: "approval_returned",
        new_status: "pending_approval",
        changed_by_user_id: actorUserId,
        change_reason: "Resubmitted for approval",
      });
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: "REQUEST_RESUBMITTED_FOR_APPROVAL",
        new_value_json: null,
        action_at: nowIso,
      });

      toast.success("ጥያቄው ለማጽደቅ ዳግም ተልኳል / Resubmitted for approval");
      invalidateAll();
    } catch (e) {
      toast.error(`Resubmit failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (requestQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate({ to: "/woreda/credentials" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          <span className="font-noto-ethiopic">ወደ ኋላ</span>
        </Button>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="font-noto-ethiopic text-lg text-slate-700">ጥያቄ አልተገኘም</p>
          <p className="text-sm text-slate-500">Request not found</p>
        </div>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resident = request.resident as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const household = request.household as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior = request.prior as any;

  return (
    <>
      <div className="space-y-6 pb-24">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/woreda/credentials" })}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            <span className="font-noto-ethiopic">ወደ ዝርዝር</span>
            <span className="ml-1 text-xs opacity-70">/ Back to list</span>
          </Button>
        </div>

        <PageHeader
          icon={CreditCard}
          titleAm="የመታወቂያ ጥያቄ ዝርዝር"
          titleEn="Credential Request Detail"
        />

        {/* Header summary */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
              {photoUrl ? (
                <img src={photoUrl} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                  No photo
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm text-slate-500">{request.request_number}</div>
              <div className="font-noto-ethiopic text-lg font-semibold text-slate-900">
                {resident?.full_name_am || "—"}
              </div>
              <div className="text-sm text-slate-600">{resident?.full_name || ""}</div>
              <div className="mt-1 font-mono text-xs text-slate-500">
                {resident?.resident_number}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusChip status={status} />
              <div className="text-right text-xs text-slate-500">
                <div className="font-noto-ethiopic">ገባ / Submitted</div>
                <div>{submittedDisplay}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Card 1 — Original Submission */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="rounded-t-xl bg-slate-800 px-5 py-3 text-white">
            <span className="font-noto-ethiopic text-base font-semibold">የመጀመሪያ ማመልከቻ</span>
            <span className="ml-2 text-sm text-slate-300">/ Original Submission</span>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <dt className="font-noto-ethiopic text-slate-500">ጾታ / Sex</dt>
                <dd className="font-noto-ethiopic text-slate-800">
                  {resident?.sex === "male"
                    ? "ወንድ / Male"
                    : resident?.sex === "female"
                      ? "ሴት / Female"
                      : "—"}
                </dd>
                <dt className="font-noto-ethiopic text-slate-500">የልደት ቀን / DOB</dt>
                <dd className="font-noto-ethiopic text-slate-800">{dobDisplay}</dd>
                <dt className="font-noto-ethiopic text-slate-500">ቤተሰብ / Household</dt>
                <dd className="font-noto-ethiopic text-slate-800">
                  {household
                    ? `${household.house_number ?? "—"} · ${
                        household.kebele
                          ? `${household.kebele.kebele_number ?? ""} ${household.kebele.kebele_name_am}`
                          : "—"
                      }`
                    : "—"}
                </dd>
              </dl>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <dt className="font-noto-ethiopic text-slate-500">የጥያቄ ዓይነት / Request Type</dt>
              <dd className="font-noto-ethiopic text-slate-800">
                {REQUEST_TYPE_LABEL[request.request_type] ?? request.request_type}
              </dd>
              <dt className="font-noto-ethiopic text-slate-500">የመታወቂያ ዓይነት / Credential Type</dt>
              <dd className="font-noto-ethiopic text-slate-800">
                {CRED_TYPE_LABEL[request.credential_type] ?? request.credential_type}
              </dd>
              {prior && (
                <>
                  <dt className="font-noto-ethiopic text-slate-500">
                    የቀድሞ መታወቂያ / Prior Credential
                  </dt>
                  <dd className="text-slate-800">
                    <span className="font-mono">{prior.credential_number}</span>
                    {" · "}
                    <StatusChip status={prior.status} />
                    {prior.issue_date && (
                      <span className="ml-2 text-xs text-slate-500">
                        {formatEthiopianDate(new Date(prior.issue_date))}
                      </span>
                    )}
                  </dd>
                </>
              )}
            </dl>

            {request.supporting_document_path && (
              <div>
                <Button variant="outline" size="sm" onClick={openDocument}>
                  <FileText className="mr-2 h-4 w-4" />
                  <span className="font-noto-ethiopic">ሰነድ ይመልከቱ</span>
                  <span className="ml-1 text-xs opacity-70">/ View Document</span>
                  {request.supporting_document_name && (
                    <span className="ml-2 text-xs text-slate-500">
                      ({request.supporting_document_name})
                    </span>
                  )}
                </Button>
                {docUrl && (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-blue-600 underline"
                  >
                    reopen
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Card 2 — Verification Checklist */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="rounded-t-xl bg-blue-700 px-5 py-3 text-white">
            <span className="font-noto-ethiopic text-base font-semibold">የማረጋገጫ ዝርዝር</span>
            <span className="ml-2 text-sm text-blue-100">/ Verification Checklist</span>
          </div>
          <div className="space-y-4 p-5">
            {isReturned && request.return_reason && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
                <div className="font-noto-ethiopic text-sm font-semibold">
                  የተመለሰበት ምክንያት / Return Reason
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{request.return_reason}</p>
              </div>
            )}

            {isEditable ? (
              <>
                <ul className="space-y-3">
                  {CHECKLIST_ITEMS.map((item) => (
                    <li key={item.key} className="flex items-start gap-3">
                      <Checkbox
                        id={item.key}
                        checked={checklist[item.key]}
                        onCheckedChange={(v) =>
                          setChecklist((c) => ({ ...c, [item.key]: v === true }))
                        }
                        disabled={!canAct}
                      />
                      <Label htmlFor={item.key} className="cursor-pointer text-sm leading-tight">
                        <span className="font-noto-ethiopic">{item.labelAm}</span>
                        <span className="ml-2 text-slate-500">/ {item.labelEn}</span>
                      </Label>
                    </li>
                  ))}
                </ul>

                {missingCorrectionDoc && (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                    <span className="font-noto-ethiopic">ሰነድ ያስፈልጋል</span> / Document required for
                    corrections
                  </div>
                )}

                {canAct ? (
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setReturnDialogOpen(true)}
                      disabled={busy}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      <span className="font-noto-ethiopic">መልስ</span>
                      <span className="ml-1 text-xs opacity-70">/ Return</span>
                    </Button>
                    <Button
                      onClick={handlePass}
                      disabled={!allChecked || missingCorrectionDoc || busy}
                      className="bg-blue-700 text-white hover:bg-blue-800"
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      <span className="font-noto-ethiopic">አልፏል</span>
                      <span className="ml-1 text-xs opacity-80">/ Pass</span>
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    You don&apos;t have permission to verify this request.
                  </p>
                )}
              </>
            ) : isReturned ? (
              canAct ? (
                <div className="flex justify-end border-t border-slate-200 pt-4">
                  <Button
                    onClick={handleResubmit}
                    disabled={busy}
                    className="bg-blue-700 text-white hover:bg-blue-800"
                  >
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <span className="font-noto-ethiopic">ዳግም ለክለሳ አስገባ</span>
                    <span className="ml-1 text-xs opacity-80">/ Resubmit for Review</span>
                  </Button>
                </div>
              ) : null
            ) : (
              <ReadOnlyChecklist
                checklist={savedChecklist}
                verifiedByUserId={request.verified_by_user_id}
                verifiedAt={request.verified_at}
              />
            )}
          </div>
        </section>

        {/* Card 3 — Approval */}
        {(status === "pending_approval" ||
          status === "approval_returned" ||
          status === "rejected" ||
          status === "awaiting_payment" ||
          status === "paid") && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div
              className={`rounded-t-xl px-5 py-3 text-white ${
                status === "rejected" ? "bg-red-700" : "bg-emerald-700"
              }`}
            >
              <span className="font-noto-ethiopic text-base font-semibold">ማጽደቅ</span>
              <span className="ml-2 text-sm text-white/80">/ Approval</span>
            </div>
            <div className="space-y-4 p-5">
              {/* Review-scope summary */}
              {(status === "pending_approval" || status === "approval_returned") && (
                <div className="space-y-3">
                  <div
                    className={`rounded-md border p-3 text-sm ${
                      request.duplicate_flag
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="font-noto-ethiopic font-medium">
                      {request.duplicate_flag
                        ? `የድግግሞሽ ውጤት: ${request.duplicate_notes ?? ""}`
                        : "ምንም ድግግሞሽ አልተገኘም"}
                    </div>
                    <div className="text-xs opacity-80">
                      {request.duplicate_flag
                        ? `Duplicate check: ${request.duplicate_notes ?? ""}`
                        : "No duplicates found"}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <span className="font-noto-ethiopic">የዚህ ነዋሪ ቀደም ያሉ መታወቂያዎች</span>
                      <span className="ml-2 normal-case">/ Credential history</span>
                    </div>
                    {residentCredsQuery.isLoading ? (
                      <Skeleton className="h-8 w-full" />
                    ) : (residentCredsQuery.data?.length ?? 0) === 0 ? (
                      <p className="font-noto-ethiopic text-sm text-slate-500">
                        ይህ ነዋሪ ቀደም ሲል ምስክርነት የለውም
                        <span className="ml-2 text-slate-400">
                          / This resident has no prior credentials
                        </span>
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm">
                        {residentCredsQuery.data!.map((c) => (
                          <li
                            key={c.credential_id}
                            className="flex flex-wrap items-center gap-3 py-2"
                          >
                            <span className="font-mono text-xs">{c.credential_number}</span>
                            <span className="font-noto-ethiopic text-slate-600">
                              {CRED_TYPE_LABEL[c.credential_type] ?? c.credential_type}
                            </span>
                            <StatusChip status={c.status} />
                            {c.issue_date && (
                              <span className="text-xs text-slate-500">
                                {formatEthiopianDate(new Date(c.issue_date))}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {status === "pending_approval" &&
                (canApprove ? (
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
                    <Button
                      variant="destructive"
                      onClick={() => setRejectOpen(true)}
                      disabled={busy}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      <span className="font-noto-ethiopic">አትቀበል</span>
                      <span className="ml-1 text-xs opacity-80">/ Reject</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setApprovalReturnOpen(true)}
                      disabled={busy}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      <span className="font-noto-ethiopic">መልስ</span>
                      <span className="ml-1 text-xs opacity-70">/ Return</span>
                    </Button>
                    <Button
                      onClick={handleApprove}
                      disabled={busy}
                      className="bg-emerald-700 text-white hover:bg-emerald-800"
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      <span className="font-noto-ethiopic">አጽድቅ</span>
                      <span className="ml-1 text-xs opacity-80">/ Approve</span>
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    You don&apos;t have permission to approve this request.
                  </p>
                ))}

              {status === "approval_returned" && (
                <>
                  {request.return_reason && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
                      <div className="font-noto-ethiopic text-sm font-semibold">
                        በማጽደቅ ደረጃ የተመለሰበት ምክንያት
                      </div>
                      <div className="text-xs opacity-80">
                        / Returned at Approval Stage — Reason
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{request.return_reason}</p>
                    </div>
                  )}
                  {canAct && (
                    <div className="flex justify-end border-t border-slate-200 pt-4">
                      <Button
                        onClick={handleResubmitForApproval}
                        disabled={busy}
                        className="bg-blue-700 text-white hover:bg-blue-800"
                      >
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <span className="font-noto-ethiopic">ለማጽደቅ ዳግም አስገባ</span>
                        <span className="ml-1 text-xs opacity-80">/ Resubmit for Approval</span>
                      </Button>
                    </div>
                  )}
                </>
              )}

              {status === "rejected" && (
                <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-red-900">
                  <div className="font-noto-ethiopic text-sm font-semibold">ጥያቄው ውድቅ ተደርጓል</div>
                  <div className="text-xs opacity-80">/ Request rejected</div>
                  {request.reject_reason && (
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      <span className="font-noto-ethiopic font-medium">ምክንያት: </span>
                      {request.reject_reason}
                    </p>
                  )}
                  {request.approval_decision_at && (
                    <p className="mt-2 text-xs text-red-700/80">
                      Decided on {formatEthiopianDate(new Date(request.approval_decision_at))}
                      {request.approved_by_user_id
                        ? ` by user ${request.approved_by_user_id.slice(0, 8)}…`
                        : ""}
                    </p>
                  )}
                </div>
              )}

              {(status === "awaiting_payment" || status === "paid") && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <div className="font-noto-ethiopic font-semibold">ጥያቄው ጸድቋል</div>
                  <div className="text-xs opacity-80">/ Request approved</div>
                  {request.approval_decision_at && (
                    <p className="mt-1 text-xs">
                      Approved on {formatEthiopianDate(new Date(request.approval_decision_at))}
                      {request.approved_by_user_id
                        ? ` by user ${request.approved_by_user_id.slice(0, 8)}…`
                        : ""}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {(status === "awaiting_payment" || status === "paid") && (
          <PaymentCard request={request} status={status} onDone={invalidateAll} />
        )}

        {status === "paid" && request.credential_id && (
          <CredentialReadinessCard
            credentialRowId={request.credential_id}
            requestId={request.credential_request_id}
            resident={resident}
            household={household}
            photoSignedUrl={photoUrl}
            woredaId={woredaId!}
          />
        )}

        {request.credential_id && (
          <IssuanceCard
            credentialRowId={request.credential_id}
            requestId={request.credential_request_id}
            requestType={request.request_type}
            priorCredentialId={request.prior_credential_id}
            residentFullNameAm={resident?.full_name_am ?? ""}
            onDone={invalidateAll}
          />
        )}

        {request.credential_id && (
          <RevocationCard credentialRowId={request.credential_id} onDone={invalidateAll} />
        )}

        <AlertDialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <span className="font-noto-ethiopic">ጥያቄውን ይመልሱ</span>
                <span className="ml-2 text-sm text-slate-500">/ Return Request</span>
              </AlertDialogTitle>
              <AlertDialogDescription>
                Provide a reason. It will be visible to the intake officer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="return-reason">
                <span className="font-noto-ethiopic">የመመለሻ ምክንያት</span>
                <span className="ml-2 text-slate-500">/ Return Reason</span>
              </Label>
              <Textarea
                id="return-reason"
                rows={4}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Min 5 characters"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleReturn();
                }}
                disabled={busy || returnReason.trim().length < 5}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Return
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={approvalReturnOpen} onOpenChange={setApprovalReturnOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <span className="font-noto-ethiopic">በማጽደቅ ደረጃ ይመልሱ</span>
                <span className="ml-2 text-sm text-slate-500">/ Return at Approval Stage</span>
              </AlertDialogTitle>
              <AlertDialogDescription>
                Provide a reason. It will be visible to the clerk.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="approval-return-reason">
                <span className="font-noto-ethiopic">የማጽደቅ ደረጃ የመመለሻ ምክንያት</span>
                <span className="ml-2 text-slate-500">/ Approval-Stage Return Reason</span>
              </Label>
              <Textarea
                id="approval-return-reason"
                rows={4}
                value={approvalReturnReason}
                onChange={(e) => setApprovalReturnReason(e.target.value)}
                placeholder="Min 5 characters"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleApprovalReturn();
                }}
                disabled={busy || approvalReturnReason.trim().length < 5}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Return
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <span className="font-noto-ethiopic">ጥያቄውን ውድቅ ያድርጉ</span>
                <span className="ml-2 text-sm text-slate-500">/ Reject Request</span>
              </AlertDialogTitle>
              <AlertDialogDescription>
                This is final. The request cannot be reopened.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reject-reason">
                <span className="font-noto-ethiopic">የመቀበል ምክንያት</span>
                <span className="ml-2 text-slate-500">/ Rejection Reason</span>
              </Label>
              <Textarea
                id="reject-reason"
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Min 5 characters"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleReject();
                }}
                disabled={busy || rejectReason.trim().length < 5}
                className="bg-red-600 hover:bg-red-700"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Reject
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {viewerOpen && (
        <Suspense fallback={null}>
          <DocumentViewerDialog
            open={viewerOpen}
            onOpenChange={setViewerOpen}
            signedUrl={docUrl}
            title={request?.supporting_document_name ?? "Document"}
          />
        </Suspense>
      )}
    </>
  );
}

function ReadOnlyChecklist({
  checklist,
  verifiedByUserId,
  verifiedAt,
}: {
  checklist: Partial<ChecklistState> & Record<string, unknown>;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
}) {
  const hasAny = CHECKLIST_ITEMS.some((i) => i.key in checklist);

  if (!hasAny) {
    return (
      <p className="font-noto-ethiopic text-sm text-slate-500">
        ማረጋገጫ አልተመዘገበም / No verification recorded
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {CHECKLIST_ITEMS.map((item) => {
          const val = checklist[item.key] === true;
          return (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              {val ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              )}
              <span>
                <span className="font-noto-ethiopic">{item.labelAm}</span>
                <span className="ml-2 text-slate-500">/ {item.labelEn}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {(verifiedAt || verifiedByUserId) && (
        <p className="text-xs text-slate-500">
          Verified{verifiedAt ? ` on ${formatEthiopianDate(new Date(verifiedAt))}` : ""}
          {verifiedByUserId ? ` by user ${verifiedByUserId.slice(0, 8)}…` : ""}
        </p>
      )}
    </div>
  );
}

const CHANNEL_LABELS: Record<string, { am: string; en: string }> = {
  cash: { am: "ጥሬ ገንዘብ", en: "Cash" },
  bank: { am: "ባንክ", en: "Bank" },
  mobile: { am: "በሞባይል", en: "Mobile" },
};

interface PaymentCardProps {
  request: {
    credential_request_id: string;
    woreda_id?: string;
    resident_id: string;
    household_id: string | null;
    payment_id: string | null;
    request_number: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resident: any;
  };
  status: string;
  onDone: () => void;
}

function PaymentCard({ request, status, onDone }: PaymentCardProps) {
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCollect = hasPermission(P.PAYMENT_COLLECT);

  const feeQuery = useQuery({
    queryKey: ["woreda-settings-fee", woredaId],
    enabled: !!woredaId && status === "awaiting_payment",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda_settings")
        .select("credential_issuance_fee")
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.credential_issuance_fee ?? 0);
    },
  });

  const paidQuery = useQuery({
    queryKey: ["credential-request-payment", request.payment_id],
    enabled: status === "paid" && !!request.payment_id,
    queryFn: async () => {
      const { data: pay, error: payErr } = await supabase
        .from("payment")
        .select("payment_id, amount, channel, payment_date, reference_no")
        .eq("payment_id", request.payment_id!)
        .maybeSingle();
      if (payErr) throw payErr;
      const { data: rec, error: recErr } = await supabase
        .from("receipt")
        .select("receipt_id, receipt_number, receipt_date, total_amount, cash_bank_channel")
        .eq("payment_id", request.payment_id!)
        .maybeSingle();
      if (recErr) throw recErr;
      return { payment: pay, receipt: rec };
    },
  });

  const [waived, setWaived] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");
  const [channel, setChannel] = useState<"cash" | "bank" | "mobile" | "">("");
  const [referenceNo, setReferenceNo] = useState("");
  const [busy, setBusy] = useState(false);

  const fee = feeQuery.data ?? 0;
  const effectiveAmount = waived ? 0 : fee;

  const canSubmit = useMemo(() => {
    if (!canCollect) return false;
    if (busy) return false;
    if (waived) return waiverReason.trim().length >= 5;
    if (!channel) return false;
    if ((channel === "bank" || channel === "mobile") && referenceNo.trim().length === 0)
      return false;
    return true;
  }, [canCollect, busy, waived, waiverReason, channel, referenceNo]);

  const handleRecord = async () => {
    if (!canSubmit || !woredaId || !actorUserId) return;
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const paymentChannel = waived ? "cash" : channel;
      const refNo =
        waived || paymentChannel === "cash" ? referenceNo.trim() || null : referenceNo.trim();

      const { data: pay, error: payErr } = await supabase
        .from("payment")
        .insert({
          woreda_id: woredaId,
          resident_id: request.resident_id,
          household_id: request.household_id,
          payment_type: "credential_fee",
          amount: effectiveAmount,
          payment_date: today,
          channel: paymentChannel as "cash" | "bank" | "mobile",
          reference_no: waived ? null : refNo,
          status: "confirmed",
          posted_by_user_id: actorUserId,
          credential_request_id: request.credential_request_id,
        } as never)
        .select("payment_id")
        .single();
      if (payErr) throw payErr;
      const paymentId = (pay as { payment_id: string }).payment_id;

      const { error: recErr } = await supabase.from("receipt").insert({
        woreda_id: woredaId,
        payment_id: paymentId,
        receipt_date: today,
        total_amount: effectiveAmount,
        cash_bank_channel: paymentChannel,
        receipt_number: "",
      } as never);
      if (recErr) throw recErr;

      const { error: updErr } = await supabase
        .from("credential_request")
        .update({ status: "paid", payment_id: paymentId })
        .eq("credential_request_id", request.credential_request_id);
      if (updErr) throw updErr;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: request.credential_request_id,
        old_status: "awaiting_payment",
        new_status: "paid",
        changed_by_user_id: actorUserId,
        change_reason: waived ? `Payment waived: ${waiverReason.trim()}` : "Payment collected",
      });

      const nowIso = new Date().toISOString();
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: request.credential_request_id,
        action_type: waived ? "PAYMENT_WAIVED" : "PAYMENT_COLLECTED",
        new_value_json: {
          amount: effectiveAmount,
          channel: paymentChannel,
          waived,
        } as never,
        action_at: nowIso,
      });

      toast.success("ክፍያው ተመዝግቧል / Payment recorded");
      onDone();
    } catch (e) {
      toast.error(`Payment failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .credential-receipt-print, .credential-receipt-print * { visibility: visible !important; }
          .credential-receipt-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="no-print rounded-t-xl bg-amber-600 px-5 py-3 text-white">
          <span className="font-noto-ethiopic text-base font-semibold">ክፍያ</span>
          <span className="ml-2 text-sm text-white/80">/ Payment</span>
        </div>
        <div className="space-y-4 p-5">
          {status === "awaiting_payment" && (
            <>
              {feeQuery.isLoading ? (
                <Skeleton className="h-8 w-40" />
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span className="font-noto-ethiopic">የሚከፈል ክፍያ</span>
                    <span className="ml-2 normal-case">/ Applicable Fee</span>
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {fee.toLocaleString()}{" "}
                    <span className="font-noto-ethiopic text-sm text-slate-600">ብር</span>
                    <span className="ml-1 text-sm text-slate-500">/ ETB</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                <Label htmlFor="waived" className="cursor-pointer">
                  <span className="font-noto-ethiopic">ክፍያ ነፃ ነው?</span>
                  <span className="ml-2 text-slate-500">/ Fee Waived?</span>
                </Label>
                <Switch
                  id="waived"
                  checked={waived}
                  onCheckedChange={(v) => {
                    setWaived(v);
                    if (v) {
                      setChannel("");
                      setReferenceNo("");
                    } else {
                      setWaiverReason("");
                    }
                  }}
                  disabled={!canCollect || busy}
                />
              </div>

              {waived ? (
                <div>
                  <Label htmlFor="waiver-reason">
                    <span className="font-noto-ethiopic">የነፃ ምክንያት</span>
                    <span className="ml-2 text-slate-500">/ Waiver Reason</span>
                  </Label>
                  <Textarea
                    id="waiver-reason"
                    rows={3}
                    value={waiverReason}
                    onChange={(e) => setWaiverReason(e.target.value)}
                    placeholder="Min 5 characters"
                    disabled={!canCollect || busy}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <Label>
                      <span className="font-noto-ethiopic">የክፍያ መንገድ</span>
                      <span className="ml-2 text-slate-500">/ Payment Channel</span>
                    </Label>
                    <Select
                      value={channel}
                      onValueChange={(v) => setChannel(v as "cash" | "bank" | "mobile")}
                      disabled={!canCollect || busy}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select channel" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">
                          <span className="font-noto-ethiopic">ጥሬ ገንዘብ</span> / Cash
                        </SelectItem>
                        <SelectItem value="bank">
                          <span className="font-noto-ethiopic">ባንክ</span> / Bank
                        </SelectItem>
                        <SelectItem value="mobile">
                          <span className="font-noto-ethiopic">በሞባይል</span> / Mobile
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(channel === "bank" || channel === "mobile" || channel === "cash") && (
                    <div>
                      <Label htmlFor="ref-no">
                        <span className="font-noto-ethiopic">የማጣቀሻ ቁጥር</span>
                        <span className="ml-2 text-slate-500">
                          / Reference Number
                          {channel === "cash" ? " (optional)" : " (required)"}
                        </span>
                      </Label>
                      <Input
                        id="ref-no"
                        value={referenceNo}
                        onChange={(e) => setReferenceNo(e.target.value)}
                        disabled={!canCollect || busy}
                        placeholder={channel === "cash" ? "Optional" : "Transaction reference"}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span className="font-noto-ethiopic">መጠን</span>
                  <span className="ml-2 normal-case">/ Amount</span>
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {effectiveAmount.toLocaleString()}{" "}
                  <span className="font-noto-ethiopic text-sm text-slate-600">ብር</span>
                  <span className="ml-1 text-sm text-slate-500">/ ETB</span>
                </div>
              </div>

              {canCollect ? (
                <div className="flex justify-end border-t border-slate-200 pt-4">
                  <Button
                    onClick={handleRecord}
                    disabled={!canSubmit}
                    className="bg-blue-700 text-white hover:bg-blue-800"
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ReceiptIcon className="mr-2 h-4 w-4" />
                    )}
                    <span className="font-noto-ethiopic">ክፍያ መዝግብ</span>
                    <span className="ml-1 text-xs opacity-80">/ Record Payment</span>
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  You don&apos;t have permission to collect payments.
                </p>
              )}
            </>
          )}

          {status === "paid" && (
            <>
              {paidQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : paidQuery.data ? (
                <div className="credential-receipt-print space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        <span className="font-noto-ethiopic">ደረሰኝ ቁጥር</span>
                        <span className="ml-2 normal-case">/ Receipt #</span>
                      </div>
                      <div className="font-mono text-base font-semibold text-emerald-900">
                        {paidQuery.data.receipt?.receipt_number ?? "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        <span className="font-noto-ethiopic">መጠን</span>
                        <span className="ml-2 normal-case">/ Amount</span>
                      </div>
                      <div className="text-base font-semibold text-emerald-900">
                        {Number(
                          paidQuery.data.receipt?.total_amount ??
                            paidQuery.data.payment?.amount ??
                            0,
                        ).toLocaleString()}{" "}
                        <span className="font-noto-ethiopic text-sm">ብር</span>
                        <span className="ml-1 text-sm">/ ETB</span>
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <dt className="font-noto-ethiopic text-slate-500">ነዋሪ / Resident</dt>
                    <dd className="font-noto-ethiopic text-slate-800">
                      {request.resident?.full_name_am ?? request.resident?.full_name ?? "—"}
                    </dd>
                    <dt className="font-noto-ethiopic text-slate-500">የጥያቄ ቁጥር / Request #</dt>
                    <dd className="font-mono text-slate-800">{request.request_number}</dd>
                    <dt className="font-noto-ethiopic text-slate-500">ቀን / Date</dt>
                    <dd className="text-slate-800">
                      {paidQuery.data.receipt?.receipt_date
                        ? formatEthiopianDate(new Date(paidQuery.data.receipt.receipt_date))
                        : paidQuery.data.payment?.payment_date
                          ? formatEthiopianDate(new Date(paidQuery.data.payment.payment_date))
                          : "—"}
                    </dd>
                    <dt className="font-noto-ethiopic text-slate-500">የክፍያ መንገድ / Channel</dt>
                    <dd className="text-slate-800">
                      {Number(paidQuery.data.payment?.amount ?? 0) === 0 ? (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          <span className="font-noto-ethiopic">ነፃ ተደርጓል</span>
                          <span className="ml-1">/ Waived</span>
                        </span>
                      ) : (
                        <>
                          <span className="font-noto-ethiopic">
                            {CHANNEL_LABELS[
                              paidQuery.data.receipt?.cash_bank_channel ??
                                paidQuery.data.payment?.channel ??
                                "cash"
                            ]?.am ?? paidQuery.data.receipt?.cash_bank_channel}
                          </span>
                          <span className="ml-2 text-slate-500">
                            /{" "}
                            {CHANNEL_LABELS[
                              paidQuery.data.receipt?.cash_bank_channel ??
                                paidQuery.data.payment?.channel ??
                                "cash"
                            ]?.en ?? ""}
                          </span>
                        </>
                      )}
                    </dd>
                    {paidQuery.data.payment?.reference_no && (
                      <>
                        <dt className="font-noto-ethiopic text-slate-500">ማጣቀሻ / Reference</dt>
                        <dd className="font-mono text-slate-800">
                          {paidQuery.data.payment.reference_no}
                        </dd>
                      </>
                    )}
                  </dl>

                  <div className="no-print flex justify-end border-t border-slate-200 pt-4">
                    <Button variant="outline" onClick={handlePrint}>
                      <Printer className="mr-2 h-4 w-4" />
                      <span className="font-noto-ethiopic">ደረሰኝ አትም</span>
                      <span className="ml-1 text-xs opacity-70">/ Print Receipt</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Payment record not available.</p>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

interface CredentialReadinessCardProps {
  credentialRowId: string;
  requestId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resident: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  household: any;
  photoSignedUrl: string | null;
  woredaId: string;
}

function CredentialReadinessCard({
  credentialRowId,
  requestId,
  resident,
  household,
  photoSignedUrl,
  woredaId,
}: CredentialReadinessCardProps) {
  const queryClient = useQueryClient();
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const credQuery = useQuery({
    queryKey: ["residence-credential-row", credentialRowId],
    enabled: !!credentialRowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select(
          "credential_id, credential_number, serial_number, qr_payload, status, issue_date, expiry_date, credential_type",
        )
        .eq("credential_id", credentialRowId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const woredaQuery = useQuery({
    queryKey: ["woreda-info-for-cred", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woreda")
        .select("woreda_name_am, woreda_name_en, woreda_code")
        .eq("woreda_id", woredaId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const cred = credQuery.data;
  const wor = woredaQuery.data;
  const needsSigning = !!cred && !cred.qr_payload;
  const kebele = household?.kebele;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cred || !wor || !needsSigning || signing) return;
      setSigning(true);
      setSignError(null);
      try {
        const { signCredentialPayload } = await import("@/utils/harariCredentialCrypto");
        // Only the identifiers go over the wire. The Edge Function reads every
        // signed field from the database, so nothing sent from here can reach
        // the signature.
        await signCredentialPayload(cred.credential_id, woredaId);
        if (!cancelled) {
          await queryClient.invalidateQueries({
            queryKey: ["residence-credential-row", credentialRowId],
          });
        }
      } catch (e) {
        if (!cancelled) setSignError((e as Error).message);
      } finally {
        if (!cancelled) setSigning(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cred?.credential_id, cred?.qr_payload, wor?.woreda_name_en]);

  const retry = () => {
    setSignError(null);
    queryClient.invalidateQueries({ queryKey: ["residence-credential-row", credentialRowId] });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="rounded-t-xl bg-indigo-700 px-5 py-3 text-white">
        <span className="font-noto-ethiopic text-base font-semibold">ማስረጃ ዝግጁነት</span>
        <span className="ml-2 text-sm text-white/80">/ Credential Readiness</span>
      </div>
      <div className="space-y-3 p-5">
        {credQuery.isLoading || !cred ? (
          <Skeleton className="h-16 w-full" />
        ) : cred.qr_payload ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <div className="font-noto-ethiopic font-semibold text-emerald-900">ማስረጃ ዝግጁ ነው</div>
                <div className="text-xs text-emerald-800">
                  / Credential ready — <span className="font-mono">{cred.credential_number}</span>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <dt className="text-slate-600">
                    <span className="font-noto-ethiopic">ተከታታይ ቁጥር</span>
                    <span className="ml-1 text-xs text-slate-500">/ Serial</span>
                  </dt>
                  <dd className="font-mono text-slate-900">{cred.serial_number}</dd>
                  <dt className="text-slate-600">
                    <span className="font-noto-ethiopic">የሚያበቃበት ቀን</span>
                    <span className="ml-1 text-xs text-slate-500">/ Expiry</span>
                  </dt>
                  <dd className="text-slate-900">
                    {cred.expiry_date ? formatEthiopianDate(new Date(cred.expiry_date)) : "—"}
                  </dd>
                </dl>
                <div className="mt-4">
                  <Button asChild size="sm" className="bg-blue-700 hover:bg-blue-800">
                    <Link to="/woreda/credentials/$requestId/print" params={{ requestId }}>
                      <Printer className="mr-2 h-4 w-4" />
                      <span className="font-noto-ethiopic">ቅድመ ዕይታ እና ህትመት</span>
                      <span className="ml-2 text-xs text-white/80">/ Preview &amp; Print</span>
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : signError ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div className="flex-1">
                <div className="font-noto-ethiopic text-sm font-semibold text-red-900">
                  ማስረጃ ማዘጋጀት አልተሳካም
                </div>
                <div className="text-xs text-red-800">/ Credential preparation failed</div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-red-700">{signError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={retry}
                  disabled={signing}
                >
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-600" />
            <div>
              <div className="font-noto-ethiopic text-sm font-semibold text-slate-800">
                ማስረጃ በመዘጋጀት ላይ...
              </div>
              <div className="text-xs text-slate-600">/ Preparing credential...</div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
          <ShieldCheck className="h-3 w-3" />
          <span>QR signing (Phase 2e)</span>
        </div>
      </div>
    </section>
  );
}

interface IssuanceCardProps {
  credentialRowId: string;
  requestId: string;
  requestType: string;
  priorCredentialId: string | null;
  residentFullNameAm: string;
  onDone: () => void;
}

function IssuanceCard({
  credentialRowId,
  requestId,
  requestType,
  priorCredentialId,
  residentFullNameAm,
  onDone,
}: IssuanceCardProps) {
  const queryClient = useQueryClient();
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canPrint = hasPermission(P.CREDENTIAL_PRINT);

  const [recipientName, setRecipientName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const credQuery = useQuery({
    queryKey: ["issuance-cred-row", credentialRowId],
    enabled: !!credentialRowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select("credential_id, credential_number, status, activated_at, issued_recipient_name")
        .eq("credential_id", credentialRowId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const printLogQuery = useQuery({
    queryKey: ["issuance-print-log", credentialRowId],
    enabled: !!credentialRowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_print_log")
        .select("printed_at, printed_by_user_id")
        .eq("credential_id", credentialRowId)
        .order("printed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.printed_by_user_id) return data ? { ...data, printer_name: null } : null;
      const { data: user } = await supabase
        .from("app_user")
        .select("full_name")
        .eq("user_id", data.printed_by_user_id)
        .maybeSingle();
      return { ...data, printer_name: user?.full_name ?? null };
    },
  });

  const priorCredQuery = useQuery({
    queryKey: ["issuance-prior-cred", priorCredentialId],
    enabled: !!priorCredentialId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select("credential_id, credential_number, status")
        .eq("credential_id", priorCredentialId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const cred = credQuery.data;
  const printLog = printLogQuery.data as
    | { printed_at: string; printed_by_user_id: string | null; printer_name: string | null }
    | null
    | undefined;

  useEffect(() => {
    if (!prefilled && residentFullNameAm && cred?.status === "printed") {
      setRecipientName(residentFullNameAm);
      setPrefilled(true);
    }
  }, [prefilled, residentFullNameAm, cred?.status]);

  if (credQuery.isLoading || !cred) return null;
  if (cred.status !== "printed" && cred.status !== "active") return null;

  const isActive = cred.status === "active";
  const nameValid = recipientName.trim().length >= 2;
  const canSubmit = canPrint && nameValid && confirmed && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !actorUserId) return;
    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const name = recipientName.trim();

      // 1. Activate this credential
      const { error: credErr } = await supabase
        .from("residence_credential")
        .update({
          status: "active",
          activated_at: nowIso,
          issued_recipient_name: name,
        })
        .eq("credential_id", credentialRowId);
      if (credErr) throw credErr;

      await supabase.from("credential_status_history").insert({
        credential_id: credentialRowId,
        old_status: "printed",
        new_status: "active",
        changed_by_user_id: actorUserId,
        change_reason: `Issued to ${name}`,
      });

      // 3. Prior credential replacement (non-new_issue with prior)
      const priorRow = priorCredQuery.data;
      if (requestType !== "new_issue" && priorCredentialId && priorRow) {
        const priorOldStatus = priorRow.status;
        await supabase
          .from("residence_credential")
          .update({ status: "replaced", replaced_at: nowIso })
          .eq("credential_id", priorCredentialId);

        await supabase.from("credential_status_history").insert({
          credential_id: priorCredentialId,
          old_status: priorOldStatus,
          new_status: "replaced",
          changed_by_user_id: actorUserId,
          change_reason: `Replaced by ${cred.credential_number}`,
        });

        await supabase.from("audit_log").insert({
          actor_user_id: actorUserId,
          entity_name: "residence_credential",
          entity_id: priorCredentialId,
          action_type: "CREDENTIAL_REPLACED",
        });
      }

      // 4. Sync request to active
      await supabase
        .from("credential_request")
        .update({ status: "active" })
        .eq("credential_request_id", requestId);

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: requestId,
        old_status: "printed",
        new_status: "active",
        changed_by_user_id: actorUserId,
        change_reason: `Issued to ${name}`,
      });

      // 5. Audit
      await supabase.from("audit_log").insert({
        actor_user_id: actorUserId,
        entity_name: "residence_credential",
        entity_id: credentialRowId,
        action_type: "CREDENTIAL_ISSUED",
        new_value_json: { recipient_name: name },
      });

      toast.success("ማስረጃው ርክክብ ተደርጓል / Credential issuance confirmed");
      await queryClient.invalidateQueries({ queryKey: ["issuance-cred-row", credentialRowId] });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const printerName = printLog?.printer_name ?? printLog?.printed_by_user_id ?? "—";
  const printedAt = printLog?.printed_at ? formatEthiopianDate(new Date(printLog.printed_at)) : "—";

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="rounded-t-xl bg-blue-700 px-5 py-3 text-white">
        <span className="font-noto-ethiopic text-base font-semibold">ርክክብ</span>
        <span className="ml-2 text-sm text-white/80">/ Issuance</span>
      </div>
      <div className="space-y-4 p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="font-noto-ethiopic text-slate-500">ያተመ / Printed by</dt>
          <dd className="text-slate-800">{printerName}</dd>
          <dt className="font-noto-ethiopic text-slate-500">የህትመት ቀን / Printed at</dt>
          <dd className="text-slate-800">{printedAt}</dd>
        </dl>

        {isActive ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="flex-1 space-y-1 text-sm">
                <div className="font-noto-ethiopic font-semibold text-emerald-900">
                  ማስረጃው ርክክብ ተደርጓል
                </div>
                <div className="text-xs text-emerald-800">/ Credential issued</div>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  <dt className="font-noto-ethiopic text-slate-600">ተረካቢ / Recipient</dt>
                  <dd className="text-slate-900">{cred.issued_recipient_name ?? "—"}</dd>
                  <dt className="font-noto-ethiopic text-slate-600">ቀን / Date</dt>
                  <dd className="text-slate-900">
                    {cred.activated_at ? formatEthiopianDate(new Date(cred.activated_at)) : "—"}
                  </dd>
                </dl>
                {priorCredQuery.data && (
                  <p className="mt-2 text-xs text-slate-700">
                    <span className="font-noto-ethiopic">
                      ቀዳሚ ማስረጃ {priorCredQuery.data.credential_number} ተተክቷል
                    </span>
                    <span className="ml-1 text-slate-500">
                      / Prior credential {priorCredQuery.data.credential_number} replaced
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recipient-name">
                <span className="font-noto-ethiopic">የተረካቢ ስም</span>
                <span className="ml-2 text-slate-500">/ Recipient Name</span>
              </Label>
              <Input
                id="recipient-name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                disabled={!canPrint || submitting}
                placeholder={residentFullNameAm}
              />
              <p className="text-xs text-slate-500">
                <span className="font-noto-ethiopic">የነዋሪውን ወይም የወኪሉን ስም ያስገቡ</span>
                <span className="ml-1">
                  / Enter the resident's or authorized representative's name
                </span>
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                disabled={!canPrint || submitting}
                className="mt-0.5"
              />
              <span>
                <span className="font-noto-ethiopic">ማስረጃው ለተረካቢው በአካል ተላልፏል ብዬ አረጋግጣለሁ</span>
                <span className="ml-2 text-slate-600">
                  / I confirm the credential has been physically handed over to the recipient
                </span>
              </span>
            </label>

            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="bg-blue-700 hover:bg-blue-800"
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <span className="font-noto-ethiopic">ርክክብ አረጋግጥ</span>
                <span className="ml-2 text-xs text-white/80">/ Confirm Issuance</span>
              </Button>
            </div>
            {!canPrint && (
              <p className="text-xs text-amber-700">
                You do not have permission to confirm issuance.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface RevocationCardProps {
  credentialRowId: string;
  onDone: () => void;
}

function RevocationCard({ credentialRowId, onDone }: RevocationCardProps) {
  const queryClient = useQueryClient();
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRevoke = hasPermission(P.CREDENTIAL_REVOKE);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const credQuery = useQuery({
    queryKey: ["revocation-cred-row", credentialRowId],
    enabled: !!credentialRowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select(
          "credential_id, credential_number, status, revoked_at, revoked_reason, revoked_by_user_id",
        )
        .eq("credential_id", credentialRowId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const cred = credQuery.data;

  const revokerQuery = useQuery({
    queryKey: ["revocation-revoker-name", cred?.revoked_by_user_id],
    enabled: !!cred?.revoked_by_user_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_user")
        .select("full_name")
        .eq("user_id", cred!.revoked_by_user_id!)
        .maybeSingle();
      return data?.full_name ?? null;
    },
  });

  if (credQuery.isLoading || !cred) return null;
  if (cred.status !== "active" && cred.status !== "revoked") return null;

  const isRevoked = cred.status === "revoked";
  const reasonValid = reason.trim().length >= 5;
  const canSubmit = canRevoke && reasonValid && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit || !actorUserId) return;
    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const r = reason.trim();

      const { error: credErr } = await supabase
        .from("residence_credential")
        .update({
          status: "revoked",
          revoked_at: nowIso,
          revoked_reason: r,
          revoked_by_user_id: actorUserId,
        })
        .eq("credential_id", credentialRowId);
      if (credErr) throw credErr;

      await supabase.from("credential_status_history").insert({
        credential_id: credentialRowId,
        old_status: "active",
        new_status: "revoked",
        changed_by_user_id: actorUserId,
        change_reason: r,
      });

      await supabase.from("audit_log").insert({
        actor_user_id: actorUserId,
        entity_name: "residence_credential",
        entity_id: credentialRowId,
        action_type: "CREDENTIAL_REVOKED",
        new_value_json: { reason: r },
      });

      toast.success("ማስረጃው ተሽሯል / Credential revoked");
      await queryClient.invalidateQueries({
        queryKey: ["revocation-cred-row", credentialRowId],
      });
      setOpen(false);
      setReason("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border-2 border-red-300 bg-white shadow-sm">
      <div className="flex items-center gap-2 rounded-t-xl bg-red-700 px-5 py-3 text-white">
        <ShieldOff className="h-5 w-5" />
        <span className="font-noto-ethiopic text-base font-semibold">
          {isRevoked ? "ተሽሯል" : "መሻር"}
        </span>
        <span className="ml-1 text-sm text-white/80">/ {isRevoked ? "Revoked" : "Revocation"}</span>
      </div>
      <div className="space-y-4 p-5">
        {isRevoked ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              <dt className="font-noto-ethiopic text-slate-600">ማስረጃ / Credential</dt>
              <dd className="font-mono text-slate-900">{cred.credential_number}</dd>
              <dt className="font-noto-ethiopic text-slate-600">ምክንያት / Reason</dt>
              <dd className="text-slate-900">{cred.revoked_reason ?? "—"}</dd>
              <dt className="font-noto-ethiopic text-slate-600">ያሸረ / Revoked by</dt>
              <dd className="text-slate-900">
                {revokerQuery.data ?? cred.revoked_by_user_id ?? "—"}
              </dd>
              <dt className="font-noto-ethiopic text-slate-600">ቀን / Date</dt>
              <dd className="text-slate-900">
                {cred.revoked_at ? formatEthiopianDate(new Date(cred.revoked_at)) : "—"}
              </dd>
            </dl>
          </div>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-noto-ethiopic text-slate-700">ንቁ ማስረጃ:</span>
              <span className="ml-2 text-slate-500">/ Active Credential:</span>
              <span className="ml-2 font-mono text-slate-900">{cred.credential_number}</span>
            </p>
            <div className="flex justify-end">
              <Button variant="destructive" disabled={!canRevoke} onClick={() => setOpen(true)}>
                <ShieldOff className="mr-2 h-4 w-4" />
                <span className="font-noto-ethiopic">መሻር</span>
                <span className="ml-2 text-xs text-white/80">/ Revoke</span>
              </Button>
            </div>
            {!canRevoke && (
              <p className="text-xs text-amber-700">
                You do not have permission to revoke credentials.
              </p>
            )}
          </>
        )}
      </div>

      <AlertDialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="font-noto-ethiopic">ማስረጃ መሻር ማረጋገጫ</span>
              <span className="ml-2 text-sm text-slate-500">/ Confirm Credential Revocation</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-noto-ethiopic">
                ይህ እርምጃ የማይቀለበስ ነው። ማስረጃው ወዲያውኑ ልክ ያልሆነ ይሆናል።
              </span>
              <span className="ml-1">
                / This action is irreversible. The credential will become immediately invalid.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">
              <span className="font-noto-ethiopic">የመሻሪያ ምክንያት</span>
              <span className="ml-2 text-slate-500">/ Revocation Reason</span>
            </Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              disabled={submitting}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={!canSubmit}
              className="bg-red-700 hover:bg-red-800 focus:ring-red-700"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <span className="font-noto-ethiopic">መሻር አረጋግጥ</span>
              <span className="ml-2 text-xs text-white/80">/ Confirm Revocation</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
