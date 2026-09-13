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
import { Checkbox } from "@/components/ui/checkbox";
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
import { calculateAgeYears, formatEthiopianDate, parseDateOnly } from "@/utils/ethiopianCalendar";
import { sha256Hex } from "@/utils/fileChecksum";
import {
  POLICE_REPORT_REQUIRED_TYPES,
  CORRECTION_FIELD_OPTIONS,
} from "@/lib/credentialWorkflowSchemas";

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
    police_report_number: z.string().max(100).optional().nullable(),
    correction_fields: z.array(z.string()).optional(),
    correction_reason: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => v.request_type === "new_issue" || !!v.prior_credential_id, {
    path: ["prior_credential_id"],
    message: "Select the prior credential",
  })
  .refine((v) => v.request_type !== "reissue_correction" || !!v.supporting_document_path, {
    path: ["supporting_document_path"],
    message: "Supporting document is required for corrections",
  })
  .refine(
    (v) => !POLICE_REPORT_REQUIRED_TYPES.has(v.request_type) || !!v.police_report_number?.trim(),
    { path: ["police_report_number"], message: "Police report number is required" },
  )
  .refine(
    (v) => v.request_type !== "reissue_correction" || (v.correction_fields?.length ?? 0) > 0,
    { path: ["correction_fields"], message: "Select at least one field to correct" },
  )
  .refine((v) => v.request_type !== "reissue_correction" || !!v.correction_reason?.trim(), {
    path: ["correction_reason"],
    message: "A reason is required for a correction",
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
  residency_status: string | null;
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
  // Task 12/11: the actual `attachment` row (checksum, size, mime) can only
  // be written once the credential_request exists (entity_belongs_to_woreda()
  // requires the referenced row to already be there) -- these hold the
  // metadata from the moment of upload until onSubmit inserts the row(s)
  // right after the request itself is created.
  const [supportingDocMeta, setSupportingDocMeta] = useState<{
    checksum: string;
    size: number;
    mime: string;
  } | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoAttachment, setPhotoAttachment] = useState<{
    path: string;
    name: string;
    mime: string;
    checksum: string;
    size: number;
  } | null>(null);

  const {
    control,
    handleSubmit,
    register,
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
      police_report_number: null,
      correction_fields: [],
      correction_reason: null,
    },
  });

  const residentId = watch("resident_id");
  const requestType = watch("request_type");
  const supportingDocPath = watch("supporting_document_path");
  const supportingDocName = watch("supporting_document_name");

  // Reset prior_credential when going back to new_issue, and clear the
  // other request-type-conditional fields so a stale value from a
  // previously-selected type can't slip through if the user switches types
  // after filling them in.
  useEffect(() => {
    if (requestType === "new_issue") setValue("prior_credential_id", null);
    if (requestType !== "reissue_stolen") setValue("police_report_number", null);
    if (requestType !== "reissue_correction") {
      setValue("correction_fields", []);
      setValue("correction_reason", null);
    }
    if (requestType !== "new_issue") setPhotoAttachment(null);
  }, [requestType, setValue]);

  const residentQuery = useQuery({
    queryKey: ["credreq-resident", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select(
          "resident_id, resident_number, full_name, full_name_am, sex, date_of_birth, photo_url, active_flag, residency_status, current_household_id, household:current_household_id(household_id, house_number, kebele:kebele_id(kebele_id, kebele_name_am, kebele_name_en, kebele_number))",
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

  // Task 12.1 PreConditionCard: the spec's five checks. active/household/
  // deceased/age are advisory here (the server is the actual authority --
  // this just gives the officer an early, specific reason instead of a
  // generic rejection after submit); the conflicting-active-credential rule
  // is a warning for renewal/reissue (those exist BECAUSE a credential
  // already exists) but a hard block for new_issue, per spec.
  const notActive = !!resident && !resident.active_flag;
  const notInHousehold = !!resident && !resident.current_household_id;
  const isDeceased = resident?.residency_status === "deceased";
  const age = calculateAgeYears(resident?.date_of_birth ?? null);
  const isUnder18 = age !== null && age < 18;
  const hardBlocked = notActive || notInHousehold || isDeceased || isUnder18;

  const activeCred = activeCredQuery.data ?? null;
  const openReq = openReqQuery.data ?? null;
  const activeCredBlocksNewIssue = !!activeCred && requestType === "new_issue";
  const needsAckCred = !!activeCred && requestType !== "new_issue";
  const needsAckReq = !!openReq;

  const formEnabled =
    !!resident &&
    !hardBlocked &&
    !activeCredBlocksNewIssue &&
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
      const [checksum, uploadResult] = await Promise.all([
        sha256Hex(file),
        supabase.storage
          .from("attachments")
          .upload(path, file, { upsert: false, contentType: file.type }),
      ]);
      if (uploadResult.error) throw uploadResult.error;
      setValue("supporting_document_path", path, { shouldValidate: true });
      setValue("supporting_document_name", file.name);
      setValue("supporting_document_content_type", file.type);
      setSupportingDocMeta({ checksum, size: file.size, mime: file.type });
      toast.success("ሰነድ ተጭኗል / Document uploaded");
    } catch (e) {
      toast.error(`ፋይል መጫን አልተሳካም / Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoUpload = async (file: File) => {
    if (!woredaId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ፋይል ከ5MB መብለጥ የለበትም / File must be under 5MB");
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error("JPG ወይም PNG ብቻ / Only JPG or PNG");
      return;
    }
    setPhotoUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${woredaId}/${crypto.randomUUID()}.${ext}`;
      const [checksum, uploadResult] = await Promise.all([
        sha256Hex(file),
        supabase.storage
          .from("attachments")
          .upload(path, file, { upsert: false, contentType: file.type }),
      ]);
      if (uploadResult.error) throw uploadResult.error;
      setPhotoAttachment({ path, name: file.name, mime: file.type, checksum, size: file.size });
      toast.success("ፎቶ ተጭኗል / Photo uploaded");
    } catch (e) {
      toast.error(`ፎቶ መጫን አልተሳካም / Photo upload failed: ${(e as Error).message}`);
    } finally {
      setPhotoUploading(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!woredaId || !resident || !actorUserId) return;
    if (!resident.current_household_id) {
      toast.error("Resident is not in a household");
      return;
    }
    if (values.request_type === "new_issue" && !photoAttachment) {
      toast.error("ፎቶ ይጫኑ / Upload a photo before submitting");
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
        // Task 12: uploads now go through the attachment table (inserted
        // below, once this row exists) instead of these legacy columns --
        // kept on the table (guardrail 1: no DROP) but no longer written by
        // new requests. See docs/erd.md.
        duplicate_flag: duplicateFlag,
        duplicate_notes: duplicateFlag ? dupNotes.join("; ") : null,
        police_report_number: values.police_report_number?.trim() || null,
        correction_fields:
          values.request_type === "reissue_correction" ? (values.correction_fields ?? []) : null,
        correction_reason: values.correction_reason?.trim() || null,
        // request_number auto-assigned by trigger; provide empty to satisfy NOT NULL — trigger overrides
        request_number: "",
      };

      const { data: inserted, error } = await supabase
        .from("credential_request")
        .insert(insertPayload as never)
        .select("credential_request_id, request_number")
        .single();
      if (error) throw error;

      // Task 11/12: attachment rows can only be written once the request
      // they're about exists (entity_belongs_to_woreda() checks it), so
      // this happens right after the insert above rather than as part of
      // the same statement.
      const attachmentRows: {
        woreda_id: string;
        entity: string;
        entity_id: string;
        file_name: string;
        mime: string;
        size_bytes: number;
        checksum: string;
        storage_path: string;
        attachment_type: string;
        uploaded_by: string;
      }[] = [];
      if (photoAttachment) {
        attachmentRows.push({
          woreda_id: woredaId,
          entity: "credential_request",
          entity_id: inserted.credential_request_id,
          file_name: photoAttachment.name,
          mime: photoAttachment.mime,
          size_bytes: photoAttachment.size,
          checksum: photoAttachment.checksum,
          storage_path: photoAttachment.path,
          attachment_type: "photo",
          uploaded_by: actorUserId,
        });
      }
      if (values.supporting_document_path && supportingDocMeta) {
        attachmentRows.push({
          woreda_id: woredaId,
          entity: "credential_request",
          entity_id: inserted.credential_request_id,
          file_name: values.supporting_document_name ?? "document",
          mime: supportingDocMeta.mime,
          size_bytes: supportingDocMeta.size,
          checksum: supportingDocMeta.checksum,
          storage_path: values.supporting_document_path,
          attachment_type:
            values.request_type === "reissue_correction" ? "correction_evidence" : "supporting_doc",
          uploaded_by: actorUserId,
        });
      }
      if (attachmentRows.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: attErr } = await supabase.from("attachment").insert(attachmentRows as any);
        if (attErr) {
          // The credential_request row above already committed and this
          // officer's role (credential.issue) has no DELETE grant on it
          // (credential_request_delete requires credential.approve), so
          // there is no client-side rollback available -- resubmitting the
          // form would create a duplicate request rather than fixing this
          // one. Surface the request number so the officer can find and
          // report the specific row instead of guessing.
          throw new Error(
            `ጥያቄ ${inserted.request_number} ተፈጥሯል፤ ፎቶ/ሰነድ ማያያዝ አልተሳካም። እባክዎ ይህን ቁጥር ለሱፐርቫይዘር ያሳውቁ፣ እንደገና አያስገቡ / Request ${inserted.request_number} was created but its attachment failed to save (${attErr.message}). Report this request number to a supervisor — do not resubmit.`,
          );
        }
      }

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
    const d = parseDateOnly(resident.date_of_birth);
    return d ? formatEthiopianDate(d) : "—";
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
                  <dd className="font-noto-ethiopic text-slate-800">
                    {dobDisplay}
                    {age !== null && (
                      <span className={isUnder18 ? "ml-2 text-red-600" : "ml-2 text-slate-500"}>
                        ({age} ዓመት / {age} yrs)
                      </span>
                    )}
                  </dd>
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

          {/* Task 12.1 PreConditionCard: five checks, advisory only -- the
              server (Task 1/9) is the actual authority. This just gives the
              officer a specific reason before they hit submit and get a
              generic rejection instead. */}
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
          {isDeceased && !notActive && !notInHousehold && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
              <p className="font-noto-ethiopic font-medium">ይህ ነዋሪ ሟች ተብሎ ተመዝግቧል</p>
              <p className="text-sm">This resident is recorded as deceased.</p>
            </div>
          )}
          {isUnder18 && !notActive && !notInHousehold && !isDeceased && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
              <p className="font-noto-ethiopic font-medium">ይህ ነዋሪ ከ18 ዓመት በታች ነው ({age})</p>
              <p className="text-sm">This resident is under 18 (age {age}).</p>
            </div>
          )}

          {activeCredBlocksNewIssue && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
              <p className="font-noto-ethiopic font-medium">
                ይህ ነዋሪ ቀድሞውኑ ንቁ የመታወቂያ ማስረጃ አለው — “አዲስ አወጣጥ” መጠቀም አይቻልም
              </p>
              <p className="text-sm">
                This resident already has an active credential — a "New Issue" request isn't allowed
                while one is active. Use Renewal or a Reissue type instead.
              </p>
              <p className="mt-1 text-sm">
                <span className="font-mono">{activeCred?.credential_number}</span> ·{" "}
                {activeCred?.credential_type} · <StatusChip status={activeCred?.status ?? ""} />
              </p>
            </div>
          )}

          {needsAckCred && !hardBlocked && (
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
                    <span className="font-mono">{activeCred?.credential_number}</span> ·{" "}
                    {activeCred?.credential_type} · <StatusChip status={activeCred?.status ?? ""} />
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

          {openReq && !hardBlocked && !activeCredBlocksNewIssue && (
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

          {requestType === "reissue_stolen" && (
            <div>
              <Label className="font-noto-ethiopic" htmlFor="police-report-number">
                የፖሊስ ሪፖርት ቁጥር / Police Report Number <span className="text-red-600">*</span>
              </Label>
              <Input
                id="police-report-number"
                className="mt-2"
                {...register("police_report_number")}
                placeholder="e.g. PR-2026-00123"
              />
              {errors.police_report_number && (
                <p className="mt-1 text-sm text-red-600">{errors.police_report_number.message}</p>
              )}
            </div>
          )}

          {requestType === "reissue_correction" && (
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <div>
                <Label className="font-noto-ethiopic">
                  የሚስተካከሉ መስኮች / Fields to Correct <span className="text-red-600">*</span>
                </Label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CORRECTION_FIELD_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm">
                      <Controller
                        control={control}
                        name="correction_fields"
                        render={({ field }) => (
                          <Checkbox
                            checked={(field.value ?? []).includes(opt.value)}
                            onCheckedChange={(checked) => {
                              const current = field.value ?? [];
                              field.onChange(
                                checked
                                  ? [...current, opt.value]
                                  : current.filter((v: string) => v !== opt.value),
                              );
                            }}
                          />
                        )}
                      />
                      <span>
                        {opt.labelAm} / {opt.labelEn}
                      </span>
                    </label>
                  ))}
                </div>
                {errors.correction_fields && (
                  <p className="mt-1 text-sm text-red-600">{errors.correction_fields.message}</p>
                )}
              </div>
              <div>
                <Label className="font-noto-ethiopic" htmlFor="correction-reason">
                  የማስተካከያ ምክንያት / Correction Reason <span className="text-red-600">*</span>
                </Label>
                <Textarea
                  id="correction-reason"
                  rows={3}
                  className="mt-2"
                  {...register("correction_reason")}
                  placeholder="Explain what's wrong and what it should be"
                />
                {errors.correction_reason && (
                  <p className="mt-1 text-sm text-red-600">{errors.correction_reason.message}</p>
                )}
              </div>
            </div>
          )}

          {requestType === "new_issue" && (
            <div>
              <Label className="font-noto-ethiopic">
                ፎቶ / Photo <span className="text-red-600">*</span>
              </Label>
              <p className="mt-0.5 text-xs text-slate-500">JPG or PNG. Max 5MB.</p>
              {photoAttachment ? (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Upload className="h-5 w-5 text-blue-700" />
                    <span className="flex-1 truncate text-sm text-slate-800">
                      {photoAttachment.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPhotoAttachment(null)}
                      className="rounded p-1 text-slate-500 hover:bg-blue-100 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                    SHA-256: {photoAttachment.checksum}
                  </p>
                </div>
              ) : (
                <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 hover:border-blue-400 hover:bg-blue-50">
                  {photoUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="font-noto-ethiopic">
                    {photoUploading ? "በመጫን ላይ… / Uploading…" : "ፎቶ ይምረጡ / Choose photo"}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png"
                    disabled={photoUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoUpload(f);
                      e.target.value = "";
                    }}
                  />
                </label>
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
              <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                <div className="flex items-center gap-3">
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
                      setSupportingDocMeta(null);
                    }}
                    className="rounded p-1 text-slate-500 hover:bg-blue-100 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {supportingDocMeta && (
                  <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                    SHA-256: {supportingDocMeta.checksum}
                  </p>
                )}
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
            disabled={
              !formEnabled ||
              submitting ||
              uploading ||
              photoUploading ||
              (requestType === "new_issue" && !photoAttachment)
            }
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
