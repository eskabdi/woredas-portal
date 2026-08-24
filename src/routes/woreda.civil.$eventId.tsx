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
  Loader2,
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
import { StatusChip } from "@/components/common/StatusChip";
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
import { formatEthiopianDate, parseDateOnly } from "@/utils/ethiopianCalendar";

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

function CivilEventDetailPage() {
  const { eventId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canApprove = hasPermission(P.CIVIL_APPROVE);
  const canRegister = hasPermission(P.CIVIL_REGISTER);

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
           requested_by_user_id, created_at, resident_id,
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
  const [approvalReturnOpen, setApprovalReturnOpen] = useState(false);
  const [approvalReturnReason, setApprovalReturnReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const allChecked = CHECKLIST.every((i) => checklist[i.key]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vital-event", eventId] });
    queryClient.invalidateQueries({ queryKey: ["vital-events"] });
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

  const handlePass = async () => {
    if (!event || !actorUserId || !allChecked) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("vital_event")
        .update({
          status: "pending_approval",
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
      toast.success("ተረጋግጦ ወደ ማጽደቅ ተልኳል / Verified and sent for approval");
      invalidate();
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReturn = async () => {
    if (!event || !actorUserId) return;
    const reason = returnReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
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
      toast.success("ፀድቋል / Approved — new resident record generated");
      invalidate();
    } catch (e) {
      toast.error(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApprovalReturn = async () => {
    if (!event || !actorUserId) return;
    const reason = approvalReturnReason.trim();
    if (reason.length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("vital_event")
        .update({ status: "approval_returned", return_reason: reason })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_APPROVAL_RETURNED", { return_reason: reason });
      toast.success("ተመልሷል / Returned to registrar");
      setApprovalReturnOpen(false);
      setApprovalReturnReason("");
      invalidate();
    } catch (e) {
      toast.error(`Return failed: ${(e as Error).message}`);
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

  const handleClose = async () => {
    if (!event || !actorUserId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("vital_event")
        .update({ status: "issued" })
        .eq("vital_event_id", eventId);
      if (error) throw error;
      await audit("EVENT_CLOSED");
      toast.success("ተዘግቷል / Closed");
      invalidate();
    } catch (e) {
      toast.error(`Close failed: ${(e as Error).message}`);
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
  const isApprovable = status === "pending_approval";

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
                {event.event_date ? formatEthiopianDate(parseDateOnly(event.event_date)!) : "—"}
              </Field>
              <Field labelAm="የተመዘገበበት ቀን" labelEn="Registered">
                {event.registration_date
                  ? formatEthiopianDate(parseDateOnly(event.registration_date)!)
                  : "—"}
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
                          ? formatEthiopianDate(parseDateOnly(divorceD.marriage_date)!)
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

      {/* Card 2 — Verification */}
      {(isVerifiable || status === "returned") && (
        <Card title="ማረጋገጫ" titleEn="Verification" icon={ClipboardCheck}>
          {status === "returned" ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-medium">Returned for correction</div>
                <div className="mt-1 font-noto-ethiopic">ምክንያት: {event.return_reason || "—"}</div>
              </div>
              <PermissionGate permission={P.CIVIL_REGISTER}>
                <Button onClick={handleResubmit} disabled={busy}>
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
                      disabled={!canRegister}
                    />
                    <label htmlFor={item.key} className="cursor-pointer text-sm leading-tight">
                      <div className="font-noto-ethiopic text-slate-800">{item.am}</div>
                      <div className="text-xs text-slate-500">{item.en}</div>
                    </label>
                  </li>
                ))}
              </ul>
              <PermissionGate permission={P.CIVIL_REGISTER}>
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
                  <Button variant="outline" onClick={() => setReturnOpen(true)} disabled={busy}>
                    <span className="font-noto-ethiopic">መልስ</span>
                    <span className="ml-2 opacity-80">/ Return</span>
                  </Button>
                </div>
              </PermissionGate>
            </div>
          )}
        </Card>
      )}

      {/* Card 3 — Approval */}
      {(isApprovable || status === "approval_returned") && (
        <Card title="ማጽደቅ" titleEn="Approval" icon={ShieldCheck}>
          {status === "approval_returned" ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-medium">Returned by supervisor</div>
                <div className="mt-1 font-noto-ethiopic">ምክንያት: {event.return_reason || "—"}</div>
              </div>
              <PermissionGate permission={P.CIVIL_REGISTER}>
                <Button onClick={handleResubmit} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <span className="font-noto-ethiopic">እንደገና ላክ</span>
                  <span className="ml-2 opacity-80">/ Resubmit</span>
                </Button>
              </PermissionGate>
            </div>
          ) : (
            <PermissionGate
              permission={P.CIVIL_APPROVE}
              fallback={
                <p className="text-sm text-slate-500">
                  Awaiting supervisor approval. You do not have approval permission.
                </p>
              }
            >
              <div className="space-y-4">
                {eventType === "birth" && (
                  <>
                    <p className="font-noto-ethiopic text-sm text-slate-700">
                      በዚህ ማጽደቅ ላይ አዲስ የነዋሪ መዝገብ ይፈጠራል።
                    </p>
                    <p className="text-xs text-slate-500">
                      Approving this event will automatically create a new resident record.
                    </p>
                  </>
                )}
                {eventType === "death" && (
                  <>
                    <p className="font-noto-ethiopic text-sm text-slate-700">
                      በዚህ ማጽደቅ ላይ የነዋሪ ሁኔታ "የተሞተ" ተብሎ ይመዘገባል።
                    </p>
                    <p className="text-xs text-slate-500">
                      Approving will mark the linked resident as deceased and revoke any active
                      credentials.
                    </p>
                  </>
                )}
                {(eventType === "marriage" || eventType === "divorce") && (
                  <p className="text-xs text-slate-500">
                    Approving records the event and links it to the parties.
                  </p>
                )}

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
                  <Button
                    variant="outline"
                    onClick={() => setApprovalReturnOpen(true)}
                    disabled={busy}
                  >
                    <span className="font-noto-ethiopic">መልስ</span>
                    <span className="ml-2 opacity-80">/ Return</span>
                  </Button>
                  <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={busy}>
                    <XCircle className="mr-2 h-4 w-4" />
                    <span className="font-noto-ethiopic">ውድቅ</span>
                    <span className="ml-2 opacity-80">/ Reject</span>
                  </Button>
                </div>
              </div>
            </PermissionGate>
          )}
        </Card>
      )}

      {/* Card 4 — Outcome (approved / issued / rejected) */}
      {(status === "approved" || status === "issued" || status === "rejected") && (
        <Card
          title={status === "rejected" ? "ውጤት — ውድቅ" : "ውጤት — ጸድቋል"}
          titleEn={status === "rejected" ? "Outcome — Rejected" : "Outcome — Approved"}
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
                    <span className="font-noto-ethiopic">ክስተቱ ጸድቋል። አዲስ የነዋሪ መዝገብ ተፈጥሯል።</span>
                    <div className="text-xs text-slate-500">
                      Event approved. A new resident record has been generated.
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
                    <span className="font-noto-ethiopic">የሞት ክስተት ጸድቋል። የነዋሪ ሁኔታ ተሻሽሏል።</span>
                    <div className="text-xs text-slate-500">
                      Death approved. Resident status updated and active credentials revoked.
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
                    {eventType === "marriage" ? "የጋብቻ ክስተት ጸድቋል።" : "የፍቺ ክስተት ጸድቋል።"}
                  </span>
                  <div className="text-xs text-slate-500">
                    {eventType === "marriage"
                      ? "Marriage approved and recorded."
                      : "Divorce approved and recorded."}
                  </div>
                </div>
              )}

              {status === "approved" && (
                <PermissionGate permission={P.CIVIL_APPROVE}>
                  <Button variant="outline" onClick={handleClose} disabled={busy} className="mt-2">
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    <span className="font-noto-ethiopic">ዝጋ</span>
                    <span className="ml-2 opacity-80">/ Close</span>
                  </Button>
                </PermissionGate>
              )}

              {status === "issued" && (
                <p className="text-xs text-slate-500">Closed by the office · workflow complete.</p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Return dialog */}
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

      <AlertDialog open={approvalReturnOpen} onOpenChange={setApprovalReturnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return to registrar</AlertDialogTitle>
            <AlertDialogDescription>
              Provide a reason (minimum 5 characters).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={approvalReturnReason}
            onChange={(e) => setApprovalReturnReason(e.target.value)}
            placeholder="Reason…"
            rows={4}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprovalReturn} disabled={busy}>
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
