import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, Loader2, Upload, X, FileText } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/common/StatusChip";
import { PermissionGate } from "@/components/common/PermissionGate";
import { ResidentSearchPicker } from "@/components/forms/ResidentSearchPicker";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";

const searchSchema = z.object({
  residentId: z.string().optional(),
});

export const Route = createFileRoute("/woreda/credentials/new")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  component: () => (
    <PermissionGate
      permission={P.CREDENTIAL_ISSUE}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to submit credential requests.</p>
        </div>
      }
    >
      <NewCredentialRequestPage />
    </PermissionGate>
  ),
});

const REQUEST_TYPES = [
  { value: "new_issue", labelAm: "አዲስ አወጣጥ", labelEn: "New Issue" },
  { value: "renewal", labelAm: "እድሳት", labelEn: "Renewal" },
  { value: "reissue_lost", labelAm: "የጠፋ", labelEn: "Lost" },
  { value: "reissue_damaged", labelAm: "የተበላሸ", labelEn: "Damaged" },
  { value: "reissue_stolen", labelAm: "የተሰረቀ", labelEn: "Stolen" },
  { value: "reissue_correction", labelAm: "እርማት", labelEn: "Correction" },
] as const;

const CRED_TYPES = [
  { value: "card", labelAm: "ካርድ", labelEn: "Card" },
  { value: "certificate", labelAm: "ሰርተፍኬት", labelEn: "Certificate" },
  { value: "both", labelAm: "ሁለቱም", labelEn: "Both" },
] as const;

const formSchema = z
  .object({
    resident_id: z.string().uuid("Select a resident"),
    request_type: z.enum([
      "new_issue",
      "renewal",
      "reissue_lost",
      "reissue_damaged",
      "reissue_stolen",
      "reissue_correction",
    ]),
    credential_type: z.enum(["card", "certificate", "both"]),
    prior_credential_id: z.string().uuid().nullable().optional(),
    supporting_document_path: z.string().nullable().optional(),
    supporting_document_name: z.string().nullable().optional(),
    supporting_document_content_type: z.string().nullable().optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => v.request_type === "new_issue" || !!v.prior_credential_id, {
    path: ["prior_credential_id"],
    message: "Select the prior credential",
  })
  .refine((v) => v.request_type !== "reissue_correction" || !!v.supporting_document_path, {
    path: ["supporting_document_path"],
    message: "Supporting document is required for corrections",
  });

type FormValues = z.infer<typeof formSchema>;

interface ResidentDetail {
  resident_id: string;
  resident_number: string;
  full_name: string | null;
  full_name_am: string | null;
  sex: string | null;
  date_of_birth: string | null;
  photo_url: string | null;
  active_flag: boolean;
  current_household_id: string | null;
  household: {
    household_id: string;
    house_number: string | null;
    kebele: {
      kebele_id: string;
      kebele_name_am: string;
      kebele_name_en: string;
      kebele_number: number | null;
    } | null;
  } | null;
}

function NewCredentialRequestPage() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { residentId: presetResidentId } = Route.useSearch();

  const [ackExistingCred, setAckExistingCred] = useState(false);
  const [ackExistingReq, setAckExistingReq] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      resident_id: presetResidentId ?? "",
      request_type: "new_issue",
      credential_type: "card",
      prior_credential_id: null,
      supporting_document_path: null,
      supporting_document_name: null,
      supporting_document_content_type: null,
      notes: "",
    },
  });

  const residentId = watch("resident_id");
  const requestType = watch("request_type");
  const supportingDocPath = watch("supporting_document_path");
  const supportingDocName = watch("supporting_document_name");

  // Reset prior_credential when going back to new_issue
  useEffect(() => {
    if (requestType === "new_issue") setValue("prior_credential_id", null);
  }, [requestType, setValue]);

  const residentQuery = useQuery({
    queryKey: ["credreq-resident", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select(
          "resident_id, resident_number, full_name, full_name_am, sex, date_of_birth, photo_url, active_flag, current_household_id, household:current_household_id(household_id, house_number, kebele:kebele_id(kebele_id, kebele_name_am, kebele_name_en, kebele_number))",
        )
        .eq("resident_id", residentId)
        .maybeSingle();
      if (error) throw error;
      return data as ResidentDetail | null;
    },
  });

  const resident = residentQuery.data ?? null;

  // Active credential lookup
  const activeCredQuery = useQuery({
    queryKey: ["credreq-active-cred", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select("credential_id, credential_number, credential_type, status, issue_date")
        .eq("resident_id", residentId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Open request lookup
  const openReqQuery = useQuery({
    queryKey: ["credreq-open-req", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credential_request")
        .select("credential_request_id, request_number, status")
        .eq("resident_id", residentId)
        .not("status", "in", "(rejected,closed)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Prior credential list (for reissue/renewal)
  const priorCredsQuery = useQuery({
    queryKey: ["credreq-prior", residentId],
    enabled: !!residentId && requestType !== "new_issue",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residence_credential")
        .select("credential_id, credential_number, credential_type, status, issue_date")
        .eq("resident_id", residentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Signed URL for resident photo
  const [photoSignedUrl, setPhotoSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!resident?.photo_url) {
        setPhotoSignedUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from("resident-photos")
        .createSignedUrl(resident.photo_url, 600);
      if (!cancelled) setPhotoSignedUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [resident?.photo_url]);

  // Preconditions
  const notActive = !!resident && !resident.active_flag;
  const notInHousehold = !!resident && !resident.current_household_id;
  const hardBlocked = notActive || notInHousehold;

  const activeCred = activeCredQuery.data ?? null;
  const openReq = openReqQuery.data ?? null;
  const needsAckCred = !!activeCred;
  const needsAckReq = !!openReq;

  const formEnabled =
    !!resident &&
    !hardBlocked &&
    (!needsAckCred || ackExistingCred) &&
    (!needsAckReq || ackExistingReq);

  // Reset acknowledgements when resident changes
  useEffect(() => {
    setAckExistingCred(false);
    setAckExistingReq(false);
  }, [residentId]);

  const handleFileUpload = async (file: File) => {
    if (!woredaId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ፋይል ከ5MB መብለጥ የለበትም / File must be under 5MB");
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      toast.error("PDF፣ JPG ወይም PNG ብቻ / Only PDF, JPG or PNG");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${woredaId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("credential-request-documents")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      setValue("supporting_document_path", path, { shouldValidate: true });
      setValue("supporting_document_name", file.name);
      setValue("supporting_document_content_type", file.type);
      toast.success("ሰነድ ተጭኗል / Document uploaded");
    } catch (e) {
      toast.error(`ፋይል መጫን አልተሳካም / Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!woredaId || !resident || !actorUserId) return;
    if (!resident.current_household_id) {
      toast.error("Resident is not in a household");
      return;
    }
    // Fetch kebele from household
    const { data: hh, error: hhErr } = await supabase
      .from("household")
      .select("household_id, kebele_id")
      .eq("household_id", resident.current_household_id)
      .maybeSingle();
    if (hhErr || !hh) {
      toast.error("Could not resolve household");
      return;
    }

    setSubmitting(true);
    try {
      const dupNotes: string[] = [];
      if (activeCred) {
        dupNotes.push(
          `Active credential ${activeCred.credential_number} already exists (acknowledged)`,
        );
      }
      if (openReq) {
        dupNotes.push(`Open request ${openReq.request_number} already exists (acknowledged)`);
      }
      const duplicateFlag = dupNotes.length > 0;

      const insertPayload = {
        woreda_id: woredaId,
        resident_id: values.resident_id,
        household_id: hh.household_id,
        issuing_kebele_id: hh.kebele_id,
        request_type: values.request_type,
        credential_type: values.credential_type,
        prior_credential_id: values.prior_credential_id ?? null,
        requested_by_user_id: actorUserId,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        supporting_document_path: values.supporting_document_path ?? null,
        supporting_document_name: values.supporting_document_name ?? null,
        supporting_document_content_type: values.supporting_document_content_type ?? null,
        duplicate_flag: duplicateFlag,
        duplicate_notes: duplicateFlag ? dupNotes.join("; ") : null,
        // request_number auto-assigned by trigger; provide empty to satisfy NOT NULL — trigger overrides
        request_number: "",
      };

      const { data: inserted, error } = await supabase
        .from("credential_request")
        .insert(insertPayload as never)
        .select("credential_request_id, request_number")
        .single();
      if (error) throw error;

      await supabase.from("credential_request_status_history").insert({
        credential_request_id: inserted.credential_request_id,
        old_status: null,
        new_status: "submitted",
        changed_by_user_id: actorUserId,
      });

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "credential_request",
        entity_id: inserted.credential_request_id,
        action_type: "REQUEST_SUBMITTED",
        new_value_json: {
          request_number: inserted.request_number,
          resident_id: values.resident_id,
          request_type: values.request_type,
          credential_type: values.credential_type,
        } as never,
        action_at: new Date().toISOString(),
      });

      toast.success("ጥያቄው ገብቷል / Request submitted");
      queryClient.invalidateQueries({ queryKey: ["credential-requests"] });
      navigate({ to: "/woreda/credentials" });
    } catch (e) {
      toast.error(`Submit failed: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  });

  const dobDisplay = useMemo(() => {
    if (!resident?.date_of_birth) return "—";
    return formatEthiopianDate(new Date(resident.date_of_birth));
  }, [resident?.date_of_birth]);

  return (
    <div className="space-y-6 pb-32">
      <PageHeader icon={CreditCard} titleAm="አዲስ የመታወቂያ ጥያቄ" titleEn="New Credential Request" />

      {/* Section A — Resident selection */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 rounded-t-xl bg-blue-700 px-5 py-3 text-white">
          <span className="font-noto-ethiopic text-base font-semibold">ነዋሪ ይምረጡ</span>
          <span className="text-sm text-blue-100">/ Select Resident</span>
        </div>
        <div className="space-y-4 p-5">
          {woredaId && (
            <Controller
              control={control}
              name="resident_id"
              render={({ field }) => (
                <ResidentSearchPicker
                  value={field.value}
                  onChange={(id) => field.onChange(id)}
                  woredaId={woredaId}
                />
              )}
            />
          )}
          {errors.resident_id && (
            <p className="text-sm text-red-600">{errors.resident_id.message}</p>
          )}

          {residentQuery.isLoading && residentId && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading resident…
            </div>
          )}

          {resident && (
            <div className="flex items-start gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                {photoSignedUrl ? (
                  <img src={photoSignedUrl} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                    No photo
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-noto-ethiopic text-lg font-semibold text-slate-900">
                  {resident.full_name_am || "—"}
                </div>
                <div className="text-sm text-slate-600">{resident.full_name}</div>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  {resident.resident_number}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="font-noto-ethiopic text-slate-500">ጾታ / Sex</dt>
                  <dd className="font-noto-ethiopic text-slate-800">
                    {resident.sex === "male"
                      ? "ወንድ / Male"
                      : resident.sex === "female"
                        ? "ሴት / Female"
                        : "—"}
                  </dd>
                  <dt className="font-noto-ethiopic text-slate-500">የልደት ቀን / DOB</dt>
                  <dd className="font-noto-ethiopic text-slate-800">{dobDisplay}</dd>
                  <dt className="font-noto-ethiopic text-slate-500">ቤተሰብ / Household</dt>
                  <dd className="font-noto-ethiopic text-slate-800">
                    {resident.household
                      ? `${resident.household.house_number ?? "—"} · ${
                          resident.household.kebele
                            ? `${resident.household.kebele.kebele_number ?? ""} ${resident.household.kebele.kebele_name_am}`
                            : "—"
                        }`
                      : "—"}
                  </dd>
                </dl>
              </div>
            </div>
          )}

          {notActive && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
              <p className="font-noto-ethiopic font-medium">ይህ ነዋሪ ንቁ አይደለም</p>
              <p className="text-sm">This resident is not active.</p>
            </div>
          )}
          {notInHousehold && !notActive && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
              <p className="font-noto-ethiopic font-medium">
                ይህ ነዋሪ ወደ ቤተሰብ አልተመደበም፤ መጀመሪያ ወደ ቤተሰብ ይመድቡ
              </p>
              <p className="text-sm">
                This resident is not assigned to a household — assign one first.
              </p>
              <Link
                to="/woreda/residents/$residentId"
                params={{ residentId: resident!.resident_id }}
                className="mt-2 inline-block text-sm font-medium text-red-900 underline"
              >
                Open resident profile →
              </Link>
            </div>
          )}

          {activeCred && !hardBlocked && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div className="flex-1">
                  <p className="font-noto-ethiopic font-medium text-amber-900">
                    ይህ ነዋሪ ቀድሞውኑ ንቁ የመታወቂያ ማስረጃ አለው
                  </p>
                  <p className="text-sm text-amber-800">
                    This resident already has an active credential.
                  </p>
                  <p className="mt-1 text-sm text-amber-900">
                    <span className="font-mono">{activeCred.credential_number}</span> ·{" "}
                    {activeCred.credential_type} · <StatusChip status={activeCred.status} />
                  </p>
                  <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={ackExistingCred}
                      onChange={(e) => setAckExistingCred(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="font-noto-ethiopic">
                      ቢሆንም ለመቀጠል እወቅበታለሁ / I acknowledge and want to proceed anyway
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {openReq && !hardBlocked && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div className="flex-1">
                  <p className="font-noto-ethiopic font-medium text-amber-900">
                    ይህ ነዋሪ ቀድሞውኑ ክፍት ጥያቄ አለው
                  </p>
                  <p className="text-sm text-amber-800">
                    This resident already has an open request.
                  </p>
                  <p className="mt-1 text-sm text-amber-900">
                    <span className="font-mono">{openReq.request_number}</span> ·{" "}
                    <StatusChip status={openReq.status} />
                  </p>
                  <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={ackExistingReq}
                      onChange={(e) => setAckExistingReq(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="font-noto-ethiopic">
                      ቢሆንም ለመቀጠል እወቅበታለሁ / I acknowledge and want to proceed anyway
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Section B — Request details */}
      <section
        className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
          formEnabled ? "" : "pointer-events-none opacity-50"
        }`}
        aria-disabled={!formEnabled}
      >
        <div className="flex items-center gap-3 rounded-t-xl bg-blue-700 px-5 py-3 text-white">
          <span className="font-noto-ethiopic text-base font-semibold">የጥያቄ ዝርዝር</span>
          <span className="text-sm text-blue-100">/ Request Details</span>
        </div>
        <div className="space-y-5 p-5">
          <div>
            <Label className="font-noto-ethiopic">
              ዓይነት / Request Type <span className="text-red-600">*</span>
            </Label>
            <Controller
              control={control}
              name="request_type"
              render={({ field }) => (
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {REQUEST_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => field.onChange(t.value)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        field.value === t.value
                          ? "border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-500"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <div className="font-noto-ethiopic font-medium">{t.labelAm}</div>
                      <div className="text-xs text-slate-500">{t.labelEn}</div>
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          <div>
            <Label className="font-noto-ethiopic">
              የምስክርነት ዓይነት / Credential Type <span className="text-red-600">*</span>
            </Label>
            <Controller
              control={control}
              name="credential_type"
              render={({ field }) => (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {CRED_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => field.onChange(t.value)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        field.value === t.value
                          ? "border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-500"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <div className="font-noto-ethiopic font-medium">{t.labelAm}</div>
                      <div className="text-xs text-slate-500">{t.labelEn}</div>
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          {requestType !== "new_issue" && (
            <div>
              <Label className="font-noto-ethiopic">
                ቀዳሚ ማስረጃ / Prior Credential <span className="text-red-600">*</span>
              </Label>
              <Controller
                control={control}
                name="prior_credential_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v || null)}
                  >
                    <SelectTrigger className="mt-2 font-mono">
                      <SelectValue placeholder="Select prior credential…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(priorCredsQuery.data ?? []).map((c) => (
                        <SelectItem key={c.credential_id} value={c.credential_id}>
                          <span className="font-mono">{c.credential_number}</span> ·{" "}
                          {c.credential_type} · {c.status}
                          {c.issue_date ? ` · ${c.issue_date}` : ""}
                        </SelectItem>
                      ))}
                      {(priorCredsQuery.data ?? []).length === 0 && (
                        <div className="p-3 text-sm text-slate-500">
                          No prior credentials found for this resident.
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.prior_credential_id && (
                <p className="mt-1 text-sm text-red-600">{errors.prior_credential_id.message}</p>
              )}
            </div>
          )}

          <div>
            <Label className="font-noto-ethiopic">
              ደጋፊ ሰነድ / Supporting Document{" "}
              {requestType === "reissue_correction" && <span className="text-red-600">*</span>}
            </Label>
            <p className="mt-0.5 text-xs text-slate-500">PDF, JPG, or PNG. Max 5MB.</p>
            {supportingDocPath ? (
              <div className="mt-2 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                <FileText className="h-5 w-5 text-blue-700" />
                <span className="flex-1 truncate text-sm text-slate-800">
                  {supportingDocName ?? supportingDocPath}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setValue("supporting_document_path", null, { shouldValidate: true });
                    setValue("supporting_document_name", null);
                    setValue("supporting_document_content_type", null);
                  }}
                  className="rounded p-1 text-slate-500 hover:bg-blue-100 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 hover:border-blue-400 hover:bg-blue-50">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span className="font-noto-ethiopic">
                  {uploading ? "በመጫን ላይ… / Uploading…" : "ፋይል ይምረጡ / Choose file"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {errors.supporting_document_path && (
              <p className="mt-1 text-sm text-red-600">{errors.supporting_document_path.message}</p>
            )}
          </div>

          <div>
            <Label className="font-noto-ethiopic">ማስታወሻ / Notes</Label>
            <Controller
              control={control}
              name="notes"
              render={({ field }) => (
                <Textarea
                  {...field}
                  value={field.value ?? ""}
                  rows={3}
                  className="font-noto-ethiopic mt-2"
                  placeholder="Optional notes…"
                />
              )}
            />
          </div>
        </div>
      </section>

      {/* Sticky footer */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate({ to: "/woreda/credentials" })}
            disabled={submitting}
          >
            <span className="font-noto-ethiopic">ይቅር</span>
            <span className="ml-2 opacity-70">/ Cancel</span>
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!formEnabled || submitting || uploading}
            className="bg-blue-700 text-white hover:bg-blue-800"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <span className="font-noto-ethiopic">ጥያቄ አስገባ</span>
            <span className="ml-2 opacity-80">/ Submit Request</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
