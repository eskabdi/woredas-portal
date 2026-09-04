import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  FileText,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ClipboardCheck,
  ShieldCheck,
  Send,
  Home,
  User,
  Briefcase,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/forms/FormSection";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { formatEthiopianDateShort, parseDateOnly } from "@/utils/ethiopianCalendar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/woreda/rental-houses/requests/$requestId/")({
  ssr: false,
  component: RentalRequestDetailPage,
});

const CHECKLIST = [
  { key: "identity_verified", labelAm: "የተከራይ ማንነት ተረጋግጧል", labelEn: "Identity verified" },
  { key: "house_available", labelAm: "ቤት ክፍት ነው", labelEn: "House is available" },
  { key: "rent_amount_confirmed", labelAm: "የቤት ኪራይ መጠን ተረጋግጧል", labelEn: "Rent amount confirmed" },
  { key: "documents_complete", labelAm: "ሰነዶች ተሟልተዋል", labelEn: "Documents complete" },
] as const;

type Stage = "submitted" | "verified" | "approved" | "final";

function toEth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDateOnly(iso);
  if (!d) return "—";
  return formatEthiopianDateShort(d);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stepper({
  current,
  isTermination,
  verifiedAt,
  approvedAt,
  status,
}: {
  current: Stage;
  isTermination: boolean;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  status: string;
}) {
  const finalLabel = isTermination ? "Vacated" : "Active";
  const steps = [
    { key: "submitted" as const, icon: Send, am: "ተልኳል", en: "Submitted", ts: undefined },
    {
      key: "verified" as const,
      icon: ClipboardCheck,
      am: "ተረጋግጧል",
      en: "Verified",
      ts: verifiedAt,
    },
    { key: "approved" as const, icon: ShieldCheck, am: "ፀድቋል", en: "Approved", ts: approvedAt },
    {
      key: "final" as const,
      icon: CheckCircle2,
      am: isTermination ? "ተለቋል" : "ንቁ",
      en: finalLabel,
      ts: undefined,
    },
  ];
  const order: Stage[] = ["submitted", "verified", "approved", "final"];
  const currentIdx = order.indexOf(current);
  const isFailed = status === "rejected" || status === "returned";

  return (
    <Card className="p-4">
      <ol className="flex items-center gap-2 overflow-x-auto">
        {steps.map((s, idx) => {
          const done = idx < currentIdx || (idx === currentIdx && current === "final" && !isFailed);
          const active = idx === currentIdx && !isFailed;
          const failedHere = isFailed && idx === currentIdx;
          const Icon = failedHere ? AlertTriangle : s.icon;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-2 transition",
                  done && "bg-blue-700 text-white ring-blue-700",
                  active && "bg-white text-blue-700 ring-blue-700",
                  failedHere && "bg-red-50 text-red-600 ring-red-500",
                  !done && !active && !failedHere && "bg-slate-100 text-slate-400 ring-slate-200",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 leading-tight">
                <div
                  className={cn(
                    "font-noto-ethiopic text-xs font-medium",
                    done || active ? "text-slate-900" : "text-slate-400",
                  )}
                >
                  {s.am}
                </div>
                <div className="text-[10px] text-slate-500">{s.en}</div>
                {s.ts && <div className="text-[10px] text-slate-400">{fmtDateTime(s.ts)}</div>}
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-1 hidden h-0.5 flex-1 md:block",
                    idx < currentIdx ? "bg-blue-700" : "bg-slate-200",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function KV({ am, en, children }: { am: string; en: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs">
        <span className="font-noto-ethiopic text-slate-700">{am}</span>
        <span className="ml-1 text-slate-400">/ {en}</span>
      </div>
      <div className="font-noto-ethiopic mt-0.5 text-sm text-slate-900">{children ?? "—"}</div>
    </div>
  );
}

function RentalRequestDetailPage() {
  const { requestId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { data: req, isLoading } = useQuery({
    queryKey: ["rental-request", requestId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_occupancy_request")
        .select(
          `*,
           house:rental_house_id ( rental_house_id, house_number, monthly_rent_standard, occupancy_status, kebele:kebele_id ( kebele_name_am, kebele_number ) ),
           resident:resident_id ( resident_id, full_name_am, full_name, resident_number, date_of_birth, birth_place, work_info )`,
        )
        .eq("rental_request_id", requestId)
        .eq("woreda_id", woredaId!)
        .single();
      if (error) throw error;

      // rental_occupancy_request_decrypted isn't in the generated types yet
      // (00000000000024_rental_occupancy_request_decrypted_view.sql) -- same
      // untyped-client cast pattern already used elsewhere in this codebase
      // for pre-typegen tables. Queried separately: the select above embeds
      // house/resident via FK-derived PostgREST joins, which are not
      // guaranteed to resolve through a view the same way they do through
      // the base table. Merged back onto the same `rent_amount` key so the
      // inline type below and every render site stay unchanged.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data: amt, error: amtError } = await db
        .from("rental_occupancy_request_decrypted")
        .select("rent_amount_decrypted")
        .eq("rental_request_id", requestId)
        .maybeSingle();
      if (amtError) throw amtError;

      const merged = { ...data, rent_amount: amt?.rent_amount_decrypted ?? null };
      return merged as unknown as {
        rental_request_id: string;
        request_number: string;
        request_type: "new_registration" | "termination";
        rental_house_id: string;
        resident_id: string;
        rent_start_date: string | null;
        rent_amount: number | null;
        termination_date: string | null;
        termination_reason: string | null;
        existing_occupancy_id: string | null;
        status: string;
        verification_checklist: Record<string, boolean> | null;
        return_reason: string | null;
        reject_reason: string | null;
        resulting_occupancy_id: string | null;
        verified_at: string | null;
        approval_decision_at: string | null;
        created_at: string;
        house: {
          rental_house_id: string;
          house_number: string;
          monthly_rent_standard: number | null;
          occupancy_status: string;
          kebele: { kebele_name_am: string | null; kebele_number: number | null } | null;
        } | null;
        resident: {
          resident_id: string;
          full_name_am: string | null;
          full_name: string | null;
          resident_number: string | null;
          date_of_birth: string | null;
          birth_place: Record<string, unknown> | string | null;
          work_info: Record<string, unknown> | null;
        } | null;
      };
    },
  });

  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [returnReason, setReturnReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const passVerification = useMutation({
    mutationFn: async () => {
      if (!CHECKLIST.every((c) => checks[c.key])) {
        throw new Error("ሁሉንም እርምጃዎች ያረጋግጡ / All checks must pass");
      }
      const { error } = await supabase
        .from("rental_occupancy_request")
        .update({
          status: "verified",
          verification_checklist: checks as never,
          verified_by_user_id: actorUserId,
          verified_at: new Date().toISOString(),
        })
        .eq("rental_request_id", requestId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: requestId,
        action_type: "RENTAL_REQUEST_VERIFIED",
        new_value_json: { checklist: checks } as never,
      });
    },
    onSuccess: () => {
      toast.success("ተረጋግጧል / Verified");
      qc.invalidateQueries({ queryKey: ["rental-request", requestId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnRequest = useMutation({
    mutationFn: async () => {
      if (returnReason.trim().length < 3) throw new Error("Reason required");
      const { error } = await supabase
        .from("rental_occupancy_request")
        .update({ status: "returned", return_reason: returnReason.trim() })
        .eq("rental_request_id", requestId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: requestId,
        action_type: "RENTAL_REQUEST_RETURNED",
        new_value_json: { reason: returnReason.trim() } as never,
      });
    },
    onSuccess: () => {
      toast.success("Returned");
      qc.invalidateQueries({ queryKey: ["rental-request", requestId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (req?.request_type === "new_registration" && req?.house?.occupancy_status === "occupied") {
        throw new Error(
          "ቤቱ በሌላ ተከራይ ተይዟል — መጀመሪያ የተከራይ መተውን ያፀድቁ / House is occupied — approve a vacate first",
        );
      }
      if (req?.request_type === "termination" && !req?.existing_occupancy_id) {
        throw new Error("No active occupancy to vacate");
      }
      const { error } = await supabase
        .from("rental_occupancy_request")
        .update({
          status: "approved",
          approved_by_user_id: actorUserId,
          approval_decision_at: new Date().toISOString(),
        })
        .eq("rental_request_id", requestId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: requestId,
        action_type: "RENTAL_REQUEST_APPROVED",
        new_value_json: {
          request_type: req?.request_type,
          rent_amount: req?.rent_amount,
        } as never,
      });
    },
    onSuccess: () => {
      toast.success("Approved");
      qc.invalidateQueries({ queryKey: ["rental-request", requestId] });
      qc.invalidateQueries({ queryKey: ["rental-house"] });
      qc.invalidateQueries({ queryKey: ["rental-occupancies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async () => {
      if (rejectReason.trim().length < 3) throw new Error("Reason required");
      const { error } = await supabase
        .from("rental_occupancy_request")
        .update({
          status: "rejected",
          reject_reason: rejectReason.trim(),
          approved_by_user_id: actorUserId,
          approval_decision_at: new Date().toISOString(),
        })
        .eq("rental_request_id", requestId);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "rental_occupancy_request",
        entity_id: requestId,
        action_type: "RENTAL_REQUEST_REJECTED",
        new_value_json: { reason: rejectReason.trim() } as never,
      });
    },
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["rental-request", requestId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!hasPermission(P.RENTAL_VIEW)) return <Navigate to="/woreda/dashboard" />;
  if (isLoading || !req) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  const canVerify =
    hasPermission(P.RENTAL_CREATE) &&
    (req.status === "submitted" || req.status === "under_review" || req.status === "returned");
  const canApprove = hasPermission(P.RENTAL_APPROVE) && req.status === "verified";
  const isTermination = req.request_type === "termination";
  const currentStage: Stage =
    req.status === "approved"
      ? "final"
      : req.status === "verified"
        ? "approved"
        : req.status === "returned" || req.status === "rejected"
          ? req.verified_at
            ? "approved"
            : "verified"
          : "verified"; // submitted → up next: verified

  const initialStage: Stage =
    req.status === "submitted" || req.status === "under_review" ? "submitted" : currentStage;

  const bp = req.resident?.birth_place;
  const birthPlace =
    typeof bp === "string"
      ? bp
      : bp && typeof bp === "object"
        ? (() => {
            const o = bp as Record<string, unknown>;
            const placeName = typeof o.place_name === "string" ? o.place_name.trim() : "";
            if (placeName) return placeName;
            const parts = [o.kebele, o.woreda].filter(
              (x): x is string => typeof x === "string" && x.trim().length > 0,
            );
            return parts.length ? parts.join(", ") : "—";
          })()
        : "—";
  const workInfo = (req.resident?.work_info ?? {}) as Record<string, unknown>;
  const occupation = String(workInfo.occupation_post ?? "") || "—";
  const workAddress = String(workInfo.work_address ?? "") || "—";
  const houseOccupiedConflict =
    !isTermination && req.house?.occupancy_status === "occupied" && req.status !== "approved";

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FileText}
        titleAm={`የቤት ኪራይ ጥያቄ · ${req.request_number}`}
        titleEn={isTermination ? "Vacate Request" : "Rental Occupancy Request"}
        description={`${isTermination ? "የመተው ጥያቄ" : "የተከራይ ምዝገባ ጥያቄ"}  •  Created ${fmtDateTime(req.created_at)}`}
        actions={
          <Button
            variant="outline"
            onClick={() =>
              req.house
                ? navigate({
                    to: "/woreda/rental-houses/$houseId",
                    params: { houseId: req.house.rental_house_id },
                  })
                : navigate({ to: "/woreda/rental-houses" })
            }
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        }
      />

      <Stepper
        current={initialStage}
        isTermination={isTermination}
        verifiedAt={req.verified_at}
        approvedAt={req.approval_decision_at}
        status={req.status}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* LEFT — Applicant + Property */}
        <div className="space-y-4 lg:col-span-2">
          <Section icon={User} titleAm="የተከራይ መረጃ" titleEn="Applicant Details">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <KV am="ሙሉ ስም" en="Full Name">
                {req.resident ? (
                  <Link
                    to="/woreda/residents/$residentId"
                    params={{ residentId: req.resident.resident_id }}
                    className="text-blue-700 hover:underline"
                  >
                    {req.resident.full_name_am || req.resident.full_name}
                    {req.resident.resident_number && (
                      <span className="ml-1 text-xs text-slate-500">
                        ({req.resident.resident_number})
                      </span>
                    )}
                  </Link>
                ) : (
                  "—"
                )}
              </KV>
              <KV am="የትውልድ ዘመን" en="Date of Birth">
                {toEth(req.resident?.date_of_birth)}
              </KV>
              <KV am="የትውልድ ስፍራ" en="Place of Birth">
                {birthPlace}
              </KV>
              <KV am="ስራ" en="Occupation">
                <span className="inline-flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                  {occupation}
                </span>
              </KV>
              <KV am="የስራ አድራሻ" en="Work Address">
                {workAddress}
              </KV>
            </div>
          </Section>

          <Section icon={Home} titleAm="የቤት ኪራይ ዝርዝር" titleEn="Rental Details">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <KV am="የቤት ቁጥር" en="House">
                {req.house ? (
                  <Link
                    to="/woreda/rental-houses/$houseId"
                    params={{ houseId: req.house.rental_house_id }}
                    className="text-blue-700 hover:underline"
                  >
                    {req.house.house_number}
                    {req.house.kebele?.kebele_name_am && (
                      <span className="ml-1 text-slate-500">
                        · {req.house.kebele.kebele_name_am}
                      </span>
                    )}
                  </Link>
                ) : (
                  "—"
                )}
              </KV>
              <KV am="የቤት ሁኔታ" en="Occupancy Status">
                <Badge variant={req.house?.occupancy_status === "vacant" ? "outline" : "secondary"}>
                  {req.house?.occupancy_status ?? "—"}
                </Badge>
              </KV>
              <KV am="የገባበት ቀን" en="Rent Starting Date">
                {toEth(req.rent_start_date)}
              </KV>
              <KV am="የቤት ኪራይ መጠን" en="Rent Amount">
                {req.rent_amount != null ? `${Number(req.rent_amount).toLocaleString()} ETB` : "—"}
                {req.house?.monthly_rent_standard != null && (
                  <span className="ml-2 text-xs text-slate-400">
                    (standard {Number(req.house.monthly_rent_standard).toLocaleString()})
                  </span>
                )}
              </KV>
              {isTermination && (
                <>
                  <KV am="የመልቀቂያ ቀን" en="Termination Date">
                    {toEth(req.termination_date)}
                  </KV>
                  <KV am="ምክንያት" en="Reason">
                    {req.termination_reason ?? "—"}
                  </KV>
                </>
              )}
            </div>
          </Section>

          {(req.return_reason || req.reject_reason) && (
            <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {req.return_reason && (
                <div>
                  <span className="font-semibold">Return reason: </span>
                  {req.return_reason}
                </div>
              )}
              {req.reject_reason && (
                <div>
                  <span className="font-semibold">Reject reason: </span>
                  {req.reject_reason}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* RIGHT — Actions */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
              <Badge
                className="uppercase"
                variant={req.status === "approved" ? "default" : "outline"}
              >
                {req.status}
              </Badge>
            </div>
            <div className="text-xs text-slate-500">
              {req.request_type === "new_registration"
                ? "Maker–checker: verify identity, house availability, and amount before approval opens the occupancy."
                : "Maker–checker: verify termination details before approval closes the active occupancy."}
            </div>
          </Card>

          {houseOccupiedConflict && (
            <Card className="border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div className="text-sm">
                  <div className="font-semibold text-red-800">House is occupied</div>
                  <div className="mt-1 text-red-700">
                    Approve a vacate on this property first, then this request can be approved.
                  </div>
                  {req.house && (
                    <Link
                      to="/woreda/rental-houses/$houseId"
                      params={{ houseId: req.house.rental_house_id }}
                      className="mt-2 inline-block text-red-700 underline hover:text-red-900"
                    >
                      Open property →
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          )}

          {canVerify && (
            <Section icon={ClipboardCheck} titleAm="ማረጋገጫ" titleEn="Verification">
              <div className="space-y-2">
                {CHECKLIST.map((c) => (
                  <label key={c.key} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={!!checks[c.key]}
                      onCheckedChange={(v) => setChecks((s) => ({ ...s, [c.key]: v === true }))}
                    />
                    <span>
                      <span className="font-noto-ethiopic">{c.labelAm}</span>
                      <span className="ml-1 text-xs text-slate-500">/ {c.labelEn}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                <Label className="text-xs">Return with reason (optional)</Label>
                <Textarea
                  rows={2}
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="Explain what needs correction…"
                />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  onClick={() => passVerification.mutate()}
                  disabled={passVerification.isPending}
                  className="bg-blue-700 hover:bg-blue-800"
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Pass Verification
                </Button>
                <Button
                  variant="outline"
                  onClick={() => returnRequest.mutate()}
                  disabled={returnRequest.isPending}
                >
                  Return to Submitter
                </Button>
              </div>
            </Section>
          )}

          {canApprove && (
            <Section icon={ShieldCheck} titleAm="ማጽደቅ" titleEn="Approval">
              <div className="mb-3 text-xs text-slate-600">
                {isTermination
                  ? "Approving closes the current active occupancy and marks the house vacant."
                  : "Approving opens a new active occupancy on this property."}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Reject reason (only when rejecting)</Label>
                <Textarea
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending || houseOccupiedConflict}
                  className="bg-blue-700 hover:bg-blue-800"
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => reject.mutate()}
                  disabled={reject.isPending}
                >
                  <XCircle className="mr-1 h-4 w-4" /> Reject
                </Button>
              </div>
            </Section>
          )}

          {req.status === "approved" && !isTermination && (
            <Card className="p-4">
              <div className="mb-1 font-noto-ethiopic text-sm font-semibold">የቤት ኪራይ ክፍያ</div>
              <div className="text-xs text-slate-600">
                Collect the initial rent from the Revenue page. A receipt is generated on payment.
              </div>
              <Link
                to="/woreda/revenue"
                className="mt-2 inline-block text-sm text-blue-700 hover:underline"
              >
                Go to Revenue →
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
