import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Baby,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Heart,
  HeartCrack,
  History,
  Loader2,
  Receipt as ReceiptIcon,
  Scale,
  ShieldCheck,
  UserCheck,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/common/StatusChip";
import {
  HistoryTimeline,
  useWorkflowHistory,
  useActorNames,
} from "@/components/workflow/HistoryTimeline";
import { PermissionGate } from "@/components/common/PermissionGate";
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
import { formatEthiopianDateOnly } from "@/utils/ethiopianCalendar";

export const Route = createFileRoute("/woreda/civil/$eventId")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CIVIL_READ}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to view civil events.</p>
        </div>
      }
    >
      <CivilEventDetailPage />
    </PermissionGate>
  ),
});

type ChecklistKey =
  | "identity_complete"
  | "parents_confirmed"
  | "dob_reasonable"
  | "informant_verified"
  | "no_duplicate"
  | "documents_ok";

type ChecklistState = Record<ChecklistKey, boolean>;

const CHECKLIST: { key: ChecklistKey; am: string; en: string }[] = [
  { key: "identity_complete", am: "የልጅ መረጃ ሙሉ ነው", en: "Child identity data complete" },
  { key: "parents_confirmed", am: "የወላጆች መረጃ ተረጋግጧል", en: "Parent information confirmed" },
  { key: "dob_reasonable", am: "የትውልድ ቀን ተመጣጣኝ ነው", en: "Date of birth is reasonable" },
  { key: "informant_verified", am: "መረጃ ሰጪ ተረጋግጧል", en: "Informant identity verified" },
  { key: "no_duplicate", am: "ተመሳሳይ ምዝገባ የለም", en: "No duplicate registration exists" },
  { key: "documents_ok", am: "ደጋፊ ሰነዶች በቂ ናቸው", en: "Supporting documents sufficient" },
];

interface BirthDetails {
  child_first_name?: string;
  child_father_name?: string;
  child_grandfather_name?: string;
  child_full_name_en?: string;
  sex?: string;
  ethnicity?: string;
  religion?: string;
  mother_resident_id?: string | null;
  mother_name?: string | null;
  father_resident_id?: string | null;
  father_name?: string | null;
  place_of_birth?: string | null;
  facility_name?: string | null;
  attended_by?: string | null;
  weight_kg?: number | null;
  informant?: { name?: string; relation?: string | null; phone?: string | null };
}

interface DeathDetails {
  deceased_name?: string | null;
  sex?: string | null;
  place_of_death?: string | null;
  cause_of_death?: string | null;
  facility_name?: string | null;
  certified_by?: string | null;
  informant?: { name?: string; relation?: string | null; phone?: string | null };
}

interface UnionParty {
  resident_id?: string | null;
  name?: string | null;
}

interface MarriageDetails {
  spouse1?: UnionParty;
  spouse2?: UnionParty;
  place?: string | null;
  officiant?: string | null;
  witnesses?: string[];
  certificate_reference?: string | null;
  informant?: { name?: string; phone?: string | null };
}

interface DivorceDetails {
  spouse1?: UnionParty;
  spouse2?: UnionParty;
  marriage_date?: string | null;
  court_name?: string | null;
  decree_reference?: string | null;
  grounds?: string | null;
  informant?: { name?: string; phone?: string | null };
}

const EVENT_TITLES: Record<
  string,
  { am: string; en: string; icon: React.ComponentType<{ className?: string }> }
> = {
  birth: { am: "የልደት ማጠቃለያ", en: "Birth Summary", icon: Baby },
  death: { am: "የሞት ማጠቃለያ", en: "Death Summary", icon: HeartCrack },
  marriage: { am: "የጋብቻ ማጠቃለያ", en: "Marriage Summary", icon: Heart },
  divorce: { am: "የፍቺ ማጠቃለያ", en: "Divorce Summary", icon: Scale },
};

// Task 14-A: resolve_civil_fee() (00000000000059) -- same fail-closed,
// tenant-internal RPC pattern as useFeeSchedule() (credential module), but
// keyed by event_type. B2's zero-fee rule means every civil fee_schedule row
// this resolves to is seeded at 0, but the lookup itself still fails closed
// if a woreda's row is ever deleted or deactivated.
function useCivilFee(eventType: string | undefined, enabled: boolean) {
  const woredaId = useAuthStore((s) => s.woredaId);
  return useQuery({
    queryKey: ["civil-fee", woredaId, eventType],
    enabled: enabled && !!woredaId && !!eventType,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("resolve_civil_fee", {
        _event_type: eventType!,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}

function CivilEventDetailPage() {
  const { eventId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canVerify = hasPermission(P.CIVIL_VERIFY);
  const canApprove = hasPermission(P.CIVIL_APPROVE);
  const canReturn = hasPermission(P.CIVIL_RETURN);
  const canReject = hasPermission(P.CIVIL_REJECT);
  const canResubmit = hasPermission(P.CIVIL_RESUBMIT);
  const canRecordPayment = hasPermission(P.CIVIL_RECORD_PAYMENT);

  const eventQuery = useQuery({
    queryKey: ["vital-event", eventId, woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vital_event")
        .select(
          `vital_event_id, event_number, event_type, event_date, registration_date, status, notes,
           event_details, verification_checklist, verified_by_user_id, verified_at,
           approved_by_user_id, approval_decision_at, return_reason, reject_reason,
           requested_by_user_id, created_at, resident_id, payment_id,
           resident:resident_id (resident_id, resident_number, full_name, full_name_am)`,
        )
        .eq("vital_event_id", eventId)
        .eq("woreda_id", woredaId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const event = eventQuery.data;
  const status = event?.status ?? "";
  const eventType = event?.event_type ?? "birth";
  const rawDetails = (event?.event_details ?? {}) as Record<string, unknown>;
  const birthD = rawDetails as BirthDetails;
  const details = birthD; // backwards-compat alias used by birth-specific UI

  const deathD = rawDetails as DeathDetails;
  const marriageD = rawDetails as MarriageDetails;
  const divorceD = rawDetails as DivorceDetails;

  const historyQuery = useWorkflowHistory("vital_event", eventId, !!event);
  const actorNamesQuery = useActorNames((historyQuery.data ?? []).map((h) => h.changed_by_user_id));

  // Fetch linked residents for parent/spouse links (birth parents, marriage/divorce spouses)
  const linkedIds = [
    birthD.mother_resident_id,
    birthD.father_resident_id,
    marriageD.spouse1?.resident_id,
    marriageD.spouse2?.resident_id,
    divorceD.spouse1?.resident_id,
    divorceD.spouse2?.resident_id,
  ].filter((v): v is string => !!v);

  const parentsQuery = useQuery({
    queryKey: ["vital-event-parents", eventId, linkedIds.join(",")],
    enabled: linkedIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select("resident_id, resident_number, full_name, full_name_am")
        .in("resident_id", linkedIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const savedChecklist = useMemo<Partial<ChecklistState>>(() => {
    const v = event?.verification_checklist;
    return (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Partial<ChecklistState>;
  }, [event?.verification_checklist]);

  const [checklist, setChecklist] = useState<ChecklistState>({
    identity_complete: false,
    parents_confirmed: false,
    dob_reasonable: false,
    informant_verified: false,
    no_duplicate: false,
    documents_ok: false,
  });
  const [checklistInit, setChecklistInit] = useState(false);

  useEffect(() => {
    if (!checklistInit && event) {
      setChecklist({
        identity_complete: savedChecklist.identity_complete === true,
        parents_confirmed:
          savedChecklist.parents_confirmed === true ||
          (savedChecklist.parents_confirmed === undefined &&
            Boolean(details.mother_resident_id || details.mother_name)),
        dob_reasonable: savedChecklist.dob_reasonable === true,
        informant_verified: savedChecklist.informant_verified === true,
        no_duplicate: savedChecklist.no_duplicate === true,
        documents_ok: savedChecklist.documents_ok === true,
      });
      setChecklistInit(true);
    }
  }, [checklistInit, event, savedChecklist, details.mother_resident_id, details.mother_name]);

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const allChecked = CHECKLIST.every((i) => checklist[i.key]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vital-event", eventId] });
    queryClient.invalidateQueries({ queryKey: ["vital-events"] });
    queryClient.invalidateQueries({ queryKey: ["vital-event-history", eventId] });
  };

  const audit = async (action_type: string, new_value_json: unknown = null) => {
    if (!woredaId || !actorUserId) return;
    await supabase.from("audit_log").insert({
      woreda_id: woredaId,
      actor_user_id: actorUserId,
      entity_name: "vital_event",
      entity_id: eventId,
      action_type,
      new_value_json: new_value_json as never,
      action_at: new Date().toISOString(),
    });
  };

  // Stage 2: submitted -> under_review -> verified (civil.verify). A single
  // "Pass Verification" action still drives both hops of the seeded FSM
  // (docs/task14a-mapping-memo.md §8) -- one actor, one permission, two
  // persisted transitions so workflow_status_history records both.
  const handlePass = async () => {
    if (!event || !actorUserId || !allChecked) return;
    setBusy(true);
    try {
      if (status === "submitted") {
        const { error: hopErr } = await supabase
          .from("vital_event")
          .update({ status: "under_review" })
          .eq("vital_event_id", eventId);
        if (hopErr) throw hopErr;
      }
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("vital_event")
        .update({
          status: "verified",
          verified_by_user_id: actorUserId,
          verified_at: nowIso,
          verification_checklist: {
            ...checklist,
            reviewed_by: actorUserId,
            reviewed_at: nowIso,
          } as never,
        })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_VERIFIED", { checklist });
      toast.success("ተረጋግጧል / Verified");
      invalidate();
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Return, from either the verification stage (under_review) or the
  // approval stage (pending_approval) -- the seeded FSM only has one
  // `returned` target either way (civil.return), so both call sites land
  // the same way. From `submitted`, hop into `under_review` first since no
  // direct submitted -> returned edge exists.
  const handleReturn = async () => {
    if (!event || !actorUserId) return;
    const reason = returnReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      if (status === "submitted") {
        const { error: hopErr } = await supabase
          .from("vital_event")
          .update({ status: "under_review" })
          .eq("vital_event_id", eventId);
        if (hopErr) throw hopErr;
      }
      const { error } = await supabase
        .from("vital_event")
        .update({ status: "returned", return_reason: reason })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_RETURNED", { return_reason: reason });
      toast.success("ተመልሷል / Returned");
      setReturnOpen(false);
      setReturnReason("");
      invalidate();
    } catch (e) {
      toast.error(`Return failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Stage 3a: verified -> pending_approval (civil.approve) -- the supervisor
  // pulls the item into their own approval queue before deciding on it.
  const handleSendForApproval = async () => {
    if (!event || !actorUserId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("vital_event")
        .update({ status: "pending_approval" })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_SENT_FOR_APPROVAL");
      toast.success("ለማጽደቅ ተልኳል / Sent for approval");
      invalidate();
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Stage 3b: pending_approval -> approved (civil.approve). Side effects no
  // longer fire here (B2) -- they fire only at the system's own `registered`
  // terminal, after payment.
  const handleApprove = async () => {
    if (!event || !actorUserId) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("vital_event")
        .update({
          status: "approved",
          approved_by_user_id: actorUserId,
          approval_decision_at: nowIso,
        })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_APPROVED");
      toast.success("ፀድቋል / Approved — payment collection is next");
      invalidate();
    } catch (e) {
      toast.error(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!event || !actorUserId) return;
    const reason = rejectReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("vital_event")
        .update({ status: "rejected", reject_reason: reason })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_REJECTED", { reject_reason: reason });
      toast.success("ውድቅ ተደርጓል / Rejected");
      setRejectOpen(false);
      setRejectReason("");
      invalidate();
    } catch (e) {
      toast.error(`Reject failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResubmit = async () => {
    if (!event || !actorUserId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("vital_event")
        .update({ status: "under_review", return_reason: null })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_RESUBMITTED");
      toast.success("እንደገና ለክለሳ ተልኳል / Resubmitted");
      invalidate();
    } catch (e) {
      toast.error(`Resubmit failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (eventQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="font-noto-ethiopic text-slate-700">ክስተቱ አልተገኘም</p>
        <p className="text-sm text-slate-500">Event not found</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => navigate({ to: "/woreda/civil" })}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const childName = [
    details.child_first_name,
    details.child_father_name,
    details.child_grandfather_name,
  ]
    .filter(Boolean)
    .join(" ");

  const isVerifiable = status === "submitted" || status === "under_review";
  const isApprovable = status === "verified" || status === "pending_approval";
  const isPayable = status === "approved" || status === "awaiting_payment";

  const findParent = (id?: string | null) => parentsQuery.data?.find((p) => p.resident_id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileText}
        titleAm="የፍትሐ ብሔር ክስተት"
        titleEn="Civil Event"
        description={event.event_number}
        actions={
          <div className="flex items-center gap-3">
            <StatusChip status={status} />
            <Button variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          </div>
        }
      />

      {/* Card 1 — Submission summary (per event type) */}
      {(() => {
        const title = EVENT_TITLES[eventType] ?? EVENT_TITLES.birth;
        return (
          <Card title={title.am} titleEn={title.en} icon={title.icon}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field labelAm="የክስተት ቁጥር" labelEn="Event #">
                <span className="font-mono">{event.event_number}</span>
              </Field>
              <Field labelAm="የክስተት ቀን" labelEn="Event Date">
                {event.event_date ? formatEthiopianDateOnly(event.event_date) : "—"}
              </Field>
              <Field labelAm="የተመዘገበበት ቀን" labelEn="Registered">
                {event.registration_date ? formatEthiopianDateOnly(event.registration_date) : "—"}
              </Field>

              {eventType === "birth" && (
                <>
                  <Field labelAm="የልጅ ሙሉ ስም" labelEn="Child Name">
                    <span className="font-noto-ethiopic">{childName || "—"}</span>
                    {birthD.child_full_name_en && (
                      <div className="text-xs text-slate-500">{birthD.child_full_name_en}</div>
                    )}
                  </Field>
                  <Field labelAm="ፆታ" labelEn="Sex">
                    {birthD.sex === "male"
                      ? "ወንድ / Male"
                      : birthD.sex === "female"
                        ? "ሴት / Female"
                        : "—"}
                  </Field>
                  <Field labelAm="ብሔር" labelEn="Ethnicity">
                    {birthD.ethnicity || "—"}
                  </Field>
                  <Field labelAm="ኃይማኖት" labelEn="Religion">
                    {birthD.religion || "—"}
                  </Field>
                  <Field labelAm="እናት" labelEn="Mother">
                    {birthD.mother_resident_id ? (
                      <Link
                        to="/woreda/residents/$residentId"
                        params={{ residentId: birthD.mother_resident_id }}
                        className="text-blue-700 hover:underline"
                      >
                        <span className="font-noto-ethiopic">
                          {findParent(birthD.mother_resident_id)?.full_name_am ||
                            findParent(birthD.mother_resident_id)?.full_name ||
                            "View"}
                        </span>
                      </Link>
                    ) : (
                      <span className="font-noto-ethiopic">{birthD.mother_name || "—"}</span>
                    )}
                  </Field>
                  <Field labelAm="አባት" labelEn="Father">
                    {birthD.father_resident_id ? (
                      <Link
                        to="/woreda/residents/$residentId"
                        params={{ residentId: birthD.father_resident_id }}
                        className="text-blue-700 hover:underline"
                      >
                        <span className="font-noto-ethiopic">
                          {findParent(birthD.father_resident_id)?.full_name_am ||
                            findParent(birthD.father_resident_id)?.full_name ||
                            "View"}
                        </span>
                      </Link>
                    ) : (
                      <span className="font-noto-ethiopic">{birthD.father_name || "—"}</span>
                    )}
                  </Field>
                  <Field labelAm="የተወለደበት ስፍራ" labelEn="Place of Birth">
                    {birthD.place_of_birth || "—"}
                  </Field>
                  <Field labelAm="የጤና ተቋም" labelEn="Facility">
                    {birthD.facility_name || "—"}
                  </Field>
                </>
              )}

              {eventType === "death" && (
                <>
                  <Field labelAm="ሟች" labelEn="Deceased">
                    {event.resident ? (
                      <Link
                        to="/woreda/residents/$residentId"
                        params={{ residentId: event.resident.resident_id }}
                        className="text-blue-700 hover:underline"
                      >
                        <span className="font-noto-ethiopic">
                          {event.resident.full_name_am || event.resident.full_name || "View"}
                        </span>
                      </Link>
                    ) : (
                      <span className="font-noto-ethiopic">{deathD.deceased_name || "—"}</span>
                    )}
                  </Field>
                  <Field labelAm="ፆታ" labelEn="Sex">
                    {deathD.sex === "male"
                      ? "ወንድ / Male"
                      : deathD.sex === "female"
                        ? "ሴት / Female"
                        : "—"}
                  </Field>
                  <Field labelAm="የሞት ስፍራ" labelEn="Place of Death">
                    {deathD.place_of_death || "—"}
                  </Field>
                  <Field labelAm="የጤና ተቋም" labelEn="Facility">
                    {deathD.facility_name || "—"}
                  </Field>
                  <Field labelAm="የሞት መንስዔ" labelEn="Cause of Death">
                    {deathD.cause_of_death || "—"}
                  </Field>
                  <Field labelAm="ያረጋገጠው" labelEn="Certified by">
                    {deathD.certified_by || "—"}
                  </Field>
                </>
              )}

              {(eventType === "marriage" || eventType === "divorce") && (
                <>
                  <Field labelAm="ተጋቢ 1" labelEn="Party 1">
                    <SpouseView
                      party={
                        (eventType === "marriage" ? marriageD.spouse1 : divorceD.spouse1) ?? {}
                      }
                      findParent={findParent}
                    />
                  </Field>
                  <Field labelAm="ተጋቢ 2" labelEn="Party 2">
                    <SpouseView
                      party={
                        (eventType === "marriage" ? marriageD.spouse2 : divorceD.spouse2) ?? {}
                      }
                      findParent={findParent}
                    />
                  </Field>
                  {eventType === "marriage" && (
                    <>
                      <Field labelAm="ስፍራ" labelEn="Place">
                        {marriageD.place || "—"}
                      </Field>
                      <Field labelAm="ያከናወነው" labelEn="Officiant">
                        {marriageD.officiant || "—"}
                      </Field>
                      <Field labelAm="ምስክሮች" labelEn="Witnesses">
                        {(marriageD.witnesses ?? []).filter(Boolean).join(", ") || "—"}
                      </Field>
                      <Field labelAm="የምስክር ወረቀት" labelEn="Certificate Ref">
                        {marriageD.certificate_reference || "—"}
                      </Field>
                    </>
                  )}
                  {eventType === "divorce" && (
                    <>
                      <Field labelAm="የጋብቻ ቀን" labelEn="Marriage Date">
                        {divorceD.marriage_date
                          ? formatEthiopianDateOnly(divorceD.marriage_date)
                          : "—"}
                      </Field>
                      <Field labelAm="ፍርድ ቤት" labelEn="Court">
                        {divorceD.court_name || "—"}
                      </Field>
                      <Field labelAm="የፍርድ ማጣቀሻ" labelEn="Decree Reference">
                        {divorceD.decree_reference || "—"}
                      </Field>
                      <Field labelAm="ምክንያት" labelEn="Grounds">
                        {divorceD.grounds || "—"}
                      </Field>
                    </>
                  )}
                </>
              )}

              <Field labelAm="መረጃ ሰጪ" labelEn="Informant">
                <span className="font-noto-ethiopic">
                  {(rawDetails.informant as { name?: string } | undefined)?.name || "—"}
                </span>
                {(rawDetails.informant as { relation?: string } | undefined)?.relation && (
                  <div className="text-xs text-slate-500">
                    {(rawDetails.informant as { relation?: string }).relation}
                  </div>
                )}
                {(rawDetails.informant as { phone?: string } | undefined)?.phone && (
                  <div className="text-xs text-slate-500">
                    {(rawDetails.informant as { phone?: string }).phone}
                  </div>
                )}
              </Field>
              {event.notes && (
                <Field labelAm="ማስታወሻ" labelEn="Notes">
                  {event.notes}
                </Field>
              )}
            </div>
          </Card>
        );
      })()}

      {/* Card 2 — Verification (submitted / under_review / returned) */}
      {(isVerifiable || status === "returned") && (
        <Card title="ማረጋገጫ" titleEn="Verification" icon={ClipboardCheck}>
          {status === "returned" ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-medium">Returned for correction</div>
                <div className="mt-1 font-noto-ethiopic">ምክንያት: {event.return_reason || "—"}</div>
              </div>
              <PermissionGate permission={P.CIVIL_RESUBMIT}>
                <Button onClick={handleResubmit} disabled={busy || !canResubmit}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <span className="font-noto-ethiopic">እንደገና ላክ</span>
                  <span className="ml-2 opacity-80">/ Resubmit</span>
                </Button>
              </PermissionGate>
            </div>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-2">
                {CHECKLIST.map((item) => (
                  <li key={item.key} className="flex items-start gap-3">
                    <Checkbox
                      id={item.key}
                      checked={checklist[item.key]}
                      onCheckedChange={(v) =>
                        setChecklist((c) => ({ ...c, [item.key]: v === true }))
                      }
                      disabled={!canVerify}
                    />
                    <label htmlFor={item.key} className="cursor-pointer text-sm leading-tight">
                      <div className="font-noto-ethiopic text-slate-800">{item.am}</div>
                      <div className="text-xs text-slate-500">{item.en}</div>
                    </label>
                  </li>
                ))}
              </ul>
              <PermissionGate permission={P.CIVIL_VERIFY}>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    onClick={handlePass}
                    disabled={!allChecked || busy}
                    className="bg-blue-700 text-white hover:bg-blue-800"
                  >
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    <span className="font-noto-ethiopic">አልፏል</span>
                    <span className="ml-2 opacity-80">/ Pass Verification</span>
                  </Button>
                  {canReturn && (
                    <Button variant="outline" onClick={() => setReturnOpen(true)} disabled={busy}>
                      <span className="font-noto-ethiopic">መልስ</span>
                      <span className="ml-2 opacity-80">/ Return</span>
                    </Button>
                  )}
                </div>
              </PermissionGate>
            </div>
          )}
        </Card>
      )}

      {/* Card 3 — Approval (verified / pending_approval) */}
      {isApprovable && (
        <Card title="ማጽደቅ" titleEn="Approval" icon={ShieldCheck}>
          {status === "verified" ? (
            <PermissionGate
              permission={P.CIVIL_APPROVE}
              fallback={
                <p className="text-sm text-slate-500">
                  Verified — awaiting a supervisor to accept it into the approval queue.
                </p>
              }
            >
              <div className="space-y-3">
                <p className="font-noto-ethiopic text-sm text-slate-700">ተረጋግጧል፤ ለማጽደቅ ይላኩ።</p>
                <p className="text-xs text-slate-500">
                  Verified. Send it into your approval queue to decide.
                </p>
                <Button
                  onClick={handleSendForApproval}
                  disabled={busy || !canApprove}
                  className="bg-blue-700 text-white hover:bg-blue-800"
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <span className="font-noto-ethiopic">ለማጽደቅ ላክ</span>
                  <span className="ml-2 opacity-80">/ Send for Approval</span>
                </Button>
              </div>
            </PermissionGate>
          ) : (
            <div className="space-y-4">
              {eventType === "birth" && (
                <>
                  <p className="font-noto-ethiopic text-sm text-slate-700">
                    ክፍያ ከተጠናቀቀ በኋላ አዲስ የነዋሪ መዝገብ ይፈጠራል።
                  </p>
                  <p className="text-xs text-slate-500">
                    A new resident record is created once payment is completed and the registration
                    is finalized.
                  </p>
                </>
              )}
              {eventType === "death" && (
                <>
                  <p className="font-noto-ethiopic text-sm text-slate-700">
                    ክፍያ ከተጠናቀቀ በኋላ የነዋሪ ሁኔታ "የተሞተ" ተብሎ ይመዘገባል።
                  </p>
                  <p className="text-xs text-slate-500">
                    The resident is marked deceased and any active credentials revoked once payment
                    is completed and the registration is finalized.
                  </p>
                </>
              )}
              {(eventType === "marriage" || eventType === "divorce") && (
                <p className="text-xs text-slate-500">
                  Approving records the event and links it to the parties; payment finalizes
                  registration.
                </p>
              )}

              <PermissionGate
                permission={P.CIVIL_APPROVE}
                fallback={
                  <p className="text-sm text-slate-500">
                    You do not have permission to approve this event.
                  </p>
                }
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleApprove}
                    disabled={busy || !canApprove}
                    className="bg-blue-700 text-white hover:bg-blue-800"
                  >
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    <span className="font-noto-ethiopic">አጽድቅ</span>
                    <span className="ml-2 opacity-80">/ Approve</span>
                  </Button>
                  {canReturn && (
                    <Button variant="outline" onClick={() => setReturnOpen(true)} disabled={busy}>
                      <span className="font-noto-ethiopic">መልስ</span>
                      <span className="ml-2 opacity-80">/ Return</span>
                    </Button>
                  )}
                  {canReject && (
                    <Button
                      variant="destructive"
                      onClick={() => setRejectOpen(true)}
                      disabled={busy}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      <span className="font-noto-ethiopic">ውድቅ</span>
                      <span className="ml-2 opacity-80">/ Reject</span>
                    </Button>
                  )}
                </div>
              </PermissionGate>
            </div>
          )}
        </Card>
      )}

      {/* Card 4 — Payment (approved / awaiting_payment). Registration
          finalizes automatically once paid (system transition to
          `registered`) -- no manual "Close" step. */}
      {isPayable && (
        <PaymentCard
          eventId={eventId}
          eventType={eventType}
          resident={event.resident}
          status={status}
          woredaId={woredaId!}
          actorUserId={actorUserId}
          canRecordPayment={canRecordPayment}
          onDone={invalidate}
        />
      )}

      {/* Card 5 — Outcome (registered / rejected) */}
      {(status === "registered" || status === "rejected") && (
        <Card
          title={status === "rejected" ? "ውጤት — ውድቅ" : "ውጤት — ተመዝግቧል"}
          titleEn={status === "rejected" ? "Outcome — Rejected" : "Outcome — Registered"}
          icon={UserCheck}
          tone={status === "rejected" ? "danger" : "success"}
        >
          {status === "rejected" ? (
            <div className="text-sm text-slate-700">
              <div className="font-noto-ethiopic">ምክንያት: {event.reject_reason || "—"}</div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {eventType === "birth" && (
                <>
                  <div className="text-slate-700">
                    <span className="font-noto-ethiopic">ክስተቱ ተመዝግቧል። አዲስ የነዋሪ መዝገብ ተፈጥሯል።</span>
                    <div className="text-xs text-slate-500">
                      Event registered. A new resident record has been generated.
                    </div>
                  </div>
                  {event.resident_id && (
                    <Link
                      to="/woreda/residents/$residentId"
                      params={{ residentId: event.resident_id }}
                    >
                      <Button className="bg-blue-700 text-white hover:bg-blue-800">
                        <span className="font-noto-ethiopic">የነዋሪ መገለጫ ተመልከት</span>
                        <span className="ml-2 opacity-80">/ View Resident</span>
                      </Button>
                    </Link>
                  )}
                </>
              )}

              {eventType === "death" && (
                <>
                  <div className="text-slate-700">
                    <span className="font-noto-ethiopic">የሞት ክስተት ተመዝግቧል። የነዋሪ ሁኔታ ተሻሽሏል።</span>
                    <div className="text-xs text-slate-500">
                      Death registered. Resident status updated and active credentials revoked.
                    </div>
                  </div>
                  {event.resident_id && (
                    <Link
                      to="/woreda/residents/$residentId"
                      params={{ residentId: event.resident_id }}
                    >
                      <Button variant="outline">
                        <span className="font-noto-ethiopic">የነዋሪ መገለጫ ተመልከት</span>
                        <span className="ml-2 opacity-80">/ View Resident</span>
                      </Button>
                    </Link>
                  )}
                </>
              )}

              {(eventType === "marriage" || eventType === "divorce") && (
                <div className="text-slate-700">
                  <span className="font-noto-ethiopic">
                    {eventType === "marriage" ? "የጋብቻ ክስተት ተመዝግቧል።" : "የፍቺ ክስተት ተመዝግቧል።"}
                  </span>
                  <div className="text-xs text-slate-500">
                    {eventType === "marriage"
                      ? "Marriage registered and recorded."
                      : "Divorce registered and recorded."}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Card 6 — History timeline, read from workflow_status_history.
          Task 14-C: unified onto the shared HistoryTimeline component
          (bilingual StatusChip pairs, Ethiopian-calendar timestamps,
          resolved actor names) instead of this route's own inline
          rendering, which also fixes a real bug -- it rendered
          changed_at via toLocaleString(), i.e. Gregorian, in a portal
          whose dates are Ethiopian-first everywhere else. */}
      <Card title="የሁኔታ ታሪክ" titleEn="Status History" icon={History}>
        <HistoryTimeline rows={historyQuery.data ?? []} actorNames={actorNamesQuery.data} />
      </Card>

      {/* Return dialog (shared by the verification and approval stages) */}
      <AlertDialog open={returnOpen} onOpenChange={setReturnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return for correction</AlertDialogTitle>
            <AlertDialogDescription>
              Provide a reason (minimum 5 characters). The registrar will be able to resubmit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="Reason…"
            rows={4}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReturn} disabled={busy}>
              Return
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject event</AlertDialogTitle>
            <AlertDialogDescription>
              This is a terminal action. Provide a reason (minimum 5 characters).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason…"
            rows={4}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Card({
  title,
  titleEn,
  icon: Icon,
  tone = "primary",
  children,
}: {
  title: string;
  titleEn: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "primary" | "success" | "danger";
  children: React.ReactNode;
}) {
  const headerClass =
    tone === "danger" ? "bg-red-700" : tone === "success" ? "bg-emerald-700" : "bg-blue-700";
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`flex items-center gap-3 px-5 py-4 text-white ${headerClass}`}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
          <Icon className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <h2 className="font-noto-ethiopic text-lg font-semibold">{title}</h2>
          <p className="text-sm text-white/80">{titleEn}</p>
        </div>
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </div>
  );
}

function Field({
  labelAm,
  labelEn,
  children,
}: {
  labelAm: string;
  labelEn: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">
        <span className="font-noto-ethiopic">{labelAm}</span>
        <span className="ml-1">/ {labelEn}</span>
      </div>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function SpouseView({
  party,
  findParent,
}: {
  party: { resident_id?: string | null; name?: string | null };
  findParent: (
    id?: string | null,
  ) => { full_name?: string | null; full_name_am?: string | null } | undefined;
}) {
  if (party.resident_id) {
    const p = findParent(party.resident_id);
    return (
      <Link
        to="/woreda/residents/$residentId"
        params={{ residentId: party.resident_id }}
        className="text-blue-700 hover:underline"
      >
        <span className="font-noto-ethiopic">{p?.full_name_am || p?.full_name || "View"}</span>
      </Link>
    );
  }
  return <span className="font-noto-ethiopic">{party.name || "—"}</span>;
}

interface PaymentCardProps {
  eventId: string;
  eventType: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resident: any;
  status: string;
  woredaId: string;
  actorUserId: string | null;
  canRecordPayment: boolean;
  onDone: () => void;
}

// Mirrors credential's PaymentCard (woreda.credentials.$requestId.index.tsx)
// exactly in shape: raise the fee at `approved` (-> awaiting_payment), then
// record a payment + receipt to reach `paid`. Because every civil
// fee_schedule row is seeded at 0 (B2's zero-fee rule), this always records
// a zero-value payment + receipt rather than offering a waiver toggle --
// there is nothing to waive when the catalog price is already zero.
function PaymentCard({
  eventId,
  eventType,
  resident,
  status,
  woredaId,
  actorUserId,
  canRecordPayment,
  onDone,
}: PaymentCardProps) {
  const feeQuery = useCivilFee(eventType, status === "approved" || status === "awaiting_payment");

  const [channel, setChannel] = useState<"cash" | "bank" | "mobile" | "">("");
  const [referenceNo, setReferenceNo] = useState("");
  const [busy, setBusy] = useState(false);

  const fee = feeQuery.data ?? 0;

  const canSubmit = useMemo(() => {
    if (!canRecordPayment) return false;
    if (busy) return false;
    if (feeQuery.isError) return false;
    if (feeQuery.isLoading || feeQuery.data === undefined) return false;
    if (!channel) return false;
    if ((channel === "bank" || channel === "mobile") && referenceNo.trim().length === 0)
      return false;
    return true;
  }, [
    canRecordPayment,
    busy,
    feeQuery.isError,
    feeQuery.isLoading,
    feeQuery.data,
    channel,
    referenceNo,
  ]);

  const handleRecord = async () => {
    if (!canSubmit || !woredaId || !actorUserId) return;
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);

      // approved -> awaiting_payment is its own transition (civil.record_payment)
      // -- raise the fee before recording it, mirroring credential's hand-off.
      if (status === "approved") {
        const { data: raiseRow, error: raiseErr } = await supabase
          .from("vital_event")
          .update({ status: "awaiting_payment" })
          .eq("vital_event_id", eventId)
          .select("vital_event_id")
          .maybeSingle();
        if (raiseErr) throw raiseErr;
        if (!raiseRow) {
          throw new Error(
            "ክፍያው ሊጠየቅ አልቻለም / Could not raise the fee — the event may have been moved by someone else",
          );
        }
      }

      const { data: pay, error: payErr } = await supabase
        .from("payment")
        .insert({
          woreda_id: woredaId,
          resident_id: resident?.resident_id ?? null,
          household_id: null,
          payment_type: "civil_registration_fee",
          amount: fee,
          payment_date: today,
          channel: channel as "cash" | "bank" | "mobile",
          reference_no: channel === "cash" ? referenceNo.trim() || null : referenceNo.trim(),
          status: "confirmed",
          posted_by_user_id: actorUserId,
          vital_event_id: eventId,
        } as never)
        .select("payment_id")
        .single();
      if (payErr) throw payErr;
      const paymentId = (pay as { payment_id: string }).payment_id;

      const { error: recErr } = await supabase.from("receipt").insert({
        woreda_id: woredaId,
        payment_id: paymentId,
        receipt_date: today,
        total_amount: fee,
        cash_bank_channel: channel,
        receipt_number: "",
      } as never);
      if (recErr) throw recErr;

      // This UPDATE is the payment gate + system transition trigger's own
      // cascade point: by the time this call resolves, the row is already
      // at `registered` (the AFTER UPDATE trigger advances it inside the
      // same transaction) -- invalidating below re-fetches that final state.
      // A payment + receipt now exist, so an empty result here (a stale row,
      // a concurrent edit) must surface as a failure, not a silent no-op --
      // same house rule the `awaiting_payment` raise above already follows.
      const { data: paidRow, error: updErr } = await supabase
        .from("vital_event")
        .update({ status: "paid", payment_id: paymentId })
        .eq("vital_event_id", eventId)
        .select("vital_event_id")
        .maybeSingle();
      if (updErr) throw updErr;
      if (!paidRow) {
        throw new Error(
          "ክፍያው ሊመዘገብ አልቻለም / Payment was collected but the event could not be marked paid — the event may have been moved by someone else. Contact an administrator before recording another payment.",
        );
      }

      toast.success("ክፍያው ተመዝግቧል / Payment recorded");
      onDone();
    } catch (e) {
      toast.error(`Payment failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 bg-amber-600 px-5 py-4 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
          <ReceiptIcon className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <h2 className="font-noto-ethiopic text-lg font-semibold">ክፍያ</h2>
          <p className="text-sm text-white/80">Payment</p>
        </div>
      </div>
      <div className="space-y-4 p-5 md:p-6">
        {feeQuery.isError ? (
          <p className="text-sm text-red-700">{(feeQuery.error as Error).message}</p>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="font-noto-ethiopic font-medium">የክፍያ መጠን</span>
            <span className="ml-2 text-slate-500">/ Fee amount</span>
            <div className="mt-1 text-lg font-semibold">
              {feeQuery.isLoading ? "…" : `${fee.toFixed(2)} ETB`}
            </div>
          </div>
        )}

        <PermissionGate
          permission={P.CIVIL_RECORD_PAYMENT}
          fallback={
            <p className="text-sm text-slate-500">
              You do not have permission to record payment for this event.
            </p>
          }
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="civil-payment-channel">
                <span className="font-noto-ethiopic">የክፍያ መንገድ</span>
                <span className="ml-2 text-slate-500">/ Channel</span>
              </Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger id="civil-payment-channel">
                  <SelectValue placeholder="ይምረጡ / Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">ጥሬ ገንዘብ / Cash</SelectItem>
                  <SelectItem value="bank">ባንክ / Bank</SelectItem>
                  <SelectItem value="mobile">የሞባይል ገንዘብ / Mobile</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(channel === "bank" || channel === "mobile") && (
              <div className="space-y-2">
                <Label htmlFor="civil-payment-ref">
                  <span className="font-noto-ethiopic">የማጣቀሻ ቁጥር</span>
                  <span className="ml-2 text-slate-500">/ Reference No.</span>
                </Label>
                <Input
                  id="civil-payment-ref"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="Reference number"
                />
              </div>
            )}
          </div>
          <Button
            onClick={handleRecord}
            disabled={!canSubmit}
            className="bg-emerald-700 text-white hover:bg-emerald-800"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <CheckCircle2 className="mr-2 h-4 w-4" />
            <span className="font-noto-ethiopic">ክፍያ መዝግብ</span>
            <span className="ml-2 opacity-80">/ Record Payment</span>
          </Button>
        </PermissionGate>
      </div>
    </section>
  );
}
