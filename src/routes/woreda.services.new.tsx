import { createFileRoute, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AlertTriangle,
  FileText,
  MessageSquareWarning,
  Paperclip,
  Send,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldWrap, Grid, Section, Select } from "@/components/forms/FormSection";
import { ResidentSearchPicker } from "@/components/forms/ResidentSearchPicker";
import { PhoneDigitsInput } from "@/components/forms/PhoneDigitsInput";
import {
  isValidPhoneDigits,
  phoneDigitsToE164,
  sanitizePhoneDigits,
  PHONE_DIGITS_ERROR,
} from "@/lib/phoneNumber";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { useServiceTypes, requiredDocList } from "@/hooks/useServiceTypes";
import { kebeleOptionLabel, useKebeleOptions } from "@/hooks/useKebeleOptions";
import {
  ALLOWED_UPLOAD_TYPES,
  DOCUMENT_TYPES,
  MAX_UPLOAD_BYTES,
  PRIORITY_LABEL,
  type ServiceCategory,
} from "@/lib/serviceConstants";
import { ethiopianPeriodLabel } from "@/utils/ethiopianCalendar";

const searchSchema = z.object({
  residentId: z.string().optional(),
  category: z.string().optional(),
});

export const Route = createFileRoute("/woreda/services/new")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  component: NewServiceRequestPage,
});

interface PendingFile {
  file: File;
  documentType: string;
}

function NewServiceRequestPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const category: ServiceCategory = search["category"] === "complaint" ? "complaint" : "letter";
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.user?.id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const { enqueue } = useOfflineQueue(woredaId);

  const presetResidentId = typeof search["residentId"] === "string" ? search["residentId"] : "";

  const typesQuery = useServiceTypes({ category });
  const kebelesQuery = useKebeleOptions();

  const [serviceTypeId, setServiceTypeId] = useState("");
  const [residentId, setResidentId] = useState(presetResidentId);
  const [applicantName, setApplicantName] = useState("");
  const [applicantPhone, setApplicantPhone] = useState("");
  const [kebeleId, setKebeleId] = useState("");
  const [subject, setSubject] = useState("");
  const [purpose, setPurpose] = useState("");
  const [addressedTo, setAddressedTo] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("normal");
  const [respondentName, setRespondentName] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentPlace, setIncidentPlace] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkpointOverride, setCheckpointOverride] = useState(false);
  const [checkpointOverrideReason, setCheckpointOverrideReason] = useState("");

  const selectedType = useMemo(
    () => (typesQuery.data ?? []).find((t) => t.service_type_id === serviceTypeId) ?? null,
    [typesQuery.data, serviceTypeId],
  );
  const requiredDocs = requiredDocList(selectedType?.required_documents);

  const residentDetailQuery = useQuery({
    queryKey: ["service-new-resident-detail", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident")
        .select(
          "resident_id, full_name, full_name_am, current_household_id, household:current_household_id(kebele_id)",
        )
        .eq("resident_id", residentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // resident_decrypted isn't in the generated types yet (00000000000023_
      // pii_encryption.sql) -- same untyped-client cast pattern already used
      // elsewhere in this codebase for pre-typegen tables. Queried
      // separately: the select above embeds household via a FK-derived
      // PostgREST join, which is not guaranteed to resolve through a view
      // the same way it does through the base table.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data: contact, error: contactError } = await db
        .from("resident_decrypted")
        .select("phone_number_decrypted")
        .eq("resident_id", residentId)
        .maybeSingle();
      if (contactError) throw contactError;

      return { ...data, phone_number: contact?.phone_number_decrypted ?? null } as {
        resident_id: string;
        full_name: string | null;
        full_name_am: string | null;
        phone_number: string | null;
        household: { kebele_id: string | null } | null;
      };
    },
  });

  useEffect(() => {
    const r = residentDetailQuery.data;
    if (!r) return;
    setApplicantName(r.full_name_am || r.full_name || "");
    setApplicantPhone(sanitizePhoneDigits(r.phone_number || ""));
    setKebeleId(r.household?.kebele_id || "");
  }, [residentDetailQuery.data]);

  const checkpointGated = !!selectedType?.rental_checkpoint_gated;
  const checkpointQuery = useQuery({
    queryKey: ["rental-checkpoint", residentId],
    enabled: checkpointGated && !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_rental_checkpoint", {
        _resident_id: residentId,
      } as never);
      if (error) throw error;
      return data as {
        has_active_occupancy: boolean;
        has_rent_account?: boolean;
        overdue_month_count?: number;
        overdue_total?: number;
        oldest_overdue_period?: string;
        has_active_plan?: boolean;
        active_plan_number?: string;
        emergency_exemption?: boolean;
        would_block: boolean;
      };
    },
  });
  const checkpoint = checkpointGated ? checkpointQuery.data : undefined;

  useEffect(() => {
    setCheckpointOverride(false);
    setCheckpointOverrideReason("");
  }, [residentId, serviceTypeId]);

  if (!hasPermission(P.SERVICE_CREATE)) return <Navigate to="/woreda/dashboard" />;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: PendingFile[] = [];
    for (const file of Array.from(list)) {
      if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
        toast.error(`${file.name}: JPG, PNG, WEBP ወይም PDF ብቻ / Only JPG, PNG, WEBP or PDF`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name}: ከ5MB በላይ / Larger than 5MB`);
        continue;
      }
      next.push({ file, documentType: "other" });
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!serviceTypeId) e["serviceTypeId"] = "አገልግሎቱን ይምረጡ / Select a service type";
    if (!residentId && applicantName.trim().length < 3)
      e["applicantName"] =
        "ነዋሪ ይምረጡ ወይም የአመልካቹን ስም ያስገቡ / Pick a resident or enter the applicant name";
    if (subject.trim().length < 3) e["subject"] = "ጉዳዩን ያስገቡ / Enter a subject";
    if (details.trim().length < 10)
      e["details"] = "ቢያንስ 10 ፊደል ያስገቡ / Provide at least 10 characters";
    if (!isValidPhoneDigits(applicantPhone)) e["applicantPhone"] = PHONE_DIGITS_ERROR;
    if (checkpoint?.would_block) {
      if (!checkpointOverride) {
        e["checkpoint"] = "ያልተከፈለ የኪራይ ዕዳ ስላለ ጥያቄው ታግዷል / Blocked by unresolved rental arrears";
      } else if (checkpointOverrideReason.trim().length === 0) {
        e["checkpointOverrideReason"] =
          "ማለፊያውን ለምን እንደተጠቀሙ ምክንያት ያስፈልጋል / A reason is required to override this checkpoint";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildInsertPayload = () => ({
    woreda_id: woredaId,
    service_type_id: selectedType!.service_type_id,
    category,
    status: "submitted",
    priority,
    resident_id: residentId || null,
    kebele_id: kebeleId || null,
    applicant_name: applicantName.trim() || null,
    applicant_phone: phoneDigitsToE164(applicantPhone),
    subject: subject.trim(),
    purpose: purpose.trim() || null,
    addressed_to: addressedTo.trim() || null,
    details: details.trim(),
    respondent_name: category === "complaint" ? respondentName.trim() || null : null,
    incident_date: category === "complaint" && incidentDate ? incidentDate : null,
    incident_place: category === "complaint" ? incidentPlace.trim() || null : null,
    fee_amount: selectedType!.requires_payment ? selectedType!.fee_amount : 0,
    request_number: "",
    requested_by_user_id: actorUserId,
    checkpoint_override: checkpointGated && !!checkpoint?.would_block && checkpointOverride,
    checkpoint_override_reason:
      checkpointGated && !!checkpoint?.would_block && checkpointOverride
        ? checkpointOverrideReason.trim()
        : null,
  });

  const handleSubmit = async () => {
    if (!woredaId || !selectedType) return;

    if (!isOnline) {
      if (files.length > 0) {
        toast.error(
          "ማስረጃ ሰነድ ያለው ጥያቄ ከመስመር ውጭ ሆኖ ማስገባት አይቻልም / A request with attachments cannot be queued offline",
        );
        return;
      }
      enqueue("service_request", "submit_intake", buildInsertPayload(), "service-new");
      toast.success(
        "ከመስመር ውጭ ተቀምጧል፣ ሲገናኙ በራስ ሰር ይላካል / Saved offline — will submit automatically once reconnected",
      );
      setConfirmOpen(false);
      navigate({ to: isComplaint ? "/woreda/complaints" : "/woreda/services" });
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("service_request")
        .insert(buildInsertPayload() as never)
        .select("service_request_id, request_number")
        .single();
      if (error) throw error;
      const created = data as { service_request_id: string; request_number: string };

      // Attachments
      for (const pf of files) {
        const safe = pf.file.name.replace(/[^\w.-]/g, "_");
        const path = `${woredaId}/${created.service_request_id}/${Date.now()}-${safe}`;
        const up = await supabase.storage
          .from("service-request-documents")
          .upload(path, pf.file, { contentType: pf.file.type, upsert: false });
        if (up.error) {
          toast.error(`${pf.file.name}: ${up.error.message}`);
          continue;
        }
        await supabase.from("service_request_attachment").insert({
          woreda_id: woredaId,
          service_request_id: created.service_request_id,
          document_type: pf.documentType,
          file_name: pf.file.name,
          storage_path: path,
          file_size_bytes: pf.file.size,
          content_type: pf.file.type,
          uploaded_by_user_id: actorUserId,
        } as never);
      }

      await supabase.from("service_request_status_history").insert({
        service_request_id: created.service_request_id,
        old_status: null,
        new_status: "submitted",
        changed_by_user_id: actorUserId,
        change_reason: "Request submitted",
      } as never);

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "service_request",
        entity_id: created.service_request_id,
        action_type: "SERVICE_REQUEST_SUBMITTED",
        new_value_json: { request_number: created.request_number, category } as never,
        action_at: new Date().toISOString(),
      });

      toast.success(`ጥያቄው ተመዝግቧል / Submitted — ${created.request_number}`);
      queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      queryClient.invalidateQueries({ queryKey: ["approval-queue"] });
      setConfirmOpen(false);
      navigate({
        to: "/woreda/services/$requestId",
        params: { requestId: created.service_request_id },
      });
    } catch (e) {
      toast.error(`ማስገባት አልተሳካም / Submit failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const isComplaint = category === "complaint";

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <PageHeader
        titleAm={isComplaint ? "አዲስ ቅሬታ ማስመዝገቢያ" : "አዲስ የአገልግሎት ጥያቄ"}
        titleEn={isComplaint ? "New Complaint" : "New Service Request"}
        description={isComplaint ? "የነዋሪ ቅሬታ በመዝገብ ውስጥ ያስገቡ" : "የደብዳቤ/ማረጃ ጥያቄን በመዝገብ ውስጥ ያስገቡ"}
        backHref={isComplaint ? "/woreda/complaints" : "/woreda/services"}
      />

      <Section
        icon={isComplaint ? MessageSquareWarning : FileText}
        titleAm="የአገልግሎት ዓይነት"
        titleEn="Service type"
      >
        <Grid>
          <FieldWrap
            labelAm="አገልግሎት"
            labelEn="Service"
            required
            error={errors["serviceTypeId"]}
            colSpan2
          >
            <Select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
              <option value="">ይምረጡ / Select…</option>
              {(typesQuery.data ?? []).map((t) => (
                <option key={t.service_type_id} value={t.service_type_id}>
                  {t.name_am}
                  {t.requires_payment ? ` — ${Number(t.fee_amount).toFixed(2)} ETB` : ""}
                </option>
              ))}
            </Select>
          </FieldWrap>
          <FieldWrap labelAm="ቅድሚያ" labelEn="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </FieldWrap>
          <FieldWrap labelAm="ክፍያ" labelEn="Fee">
            <Input
              readOnly
              value={
                selectedType
                  ? selectedType.requires_payment
                    ? `${Number(selectedType.fee_amount).toFixed(2)} ETB`
                    : "ነጻ / Free"
                  : "—"
              }
              className="bg-slate-50 font-mono"
            />
          </FieldWrap>
        </Grid>
        {requiredDocs.length > 0 && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
            <div className="font-am-body text-xs font-medium text-blue-900">
              የሚያስፈልጉ ሰነዶች / Required documents
            </div>
            <ul className="font-am-body mt-1 list-inside list-disc text-xs text-blue-800">
              {requiredDocs.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section icon={User} titleAm="የአመልካች መረጃ" titleEn="Applicant">
        <Grid>
          <FieldWrap labelAm="የተመዘገበ ነዋሪ" labelEn="Registered resident" colSpan2>
            <ResidentSearchPicker
              value={residentId}
              woredaId={woredaId ?? ""}
              onChange={(id, match) => {
                setResidentId(id);
                if (match) setApplicantName(match.full_name_am || match.full_name || "");
              }}
              placeholder="በስም ወይም በነዋሪ ቁጥር ይፈልጉ / Search by name or resident number"
            />
          </FieldWrap>
          <FieldWrap
            labelAm="የአመልካች ስም"
            labelEn="Applicant name"
            required
            error={errors["applicantName"]}
          >
            <Input
              className="font-am-body"
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
            />
          </FieldWrap>
          <FieldWrap labelAm="ስልክ" labelEn="Phone" error={errors["applicantPhone"]}>
            <PhoneDigitsInput value={applicantPhone} onChange={setApplicantPhone} />
          </FieldWrap>
          <FieldWrap labelAm="ቀበሌ" labelEn="Kebele">
            <Select value={kebeleId} onChange={(e) => setKebeleId(e.target.value)}>
              <option value="">ይምረጡ / Select…</option>
              {(kebelesQuery.data ?? []).map((k) => (
                <option key={k.kebele_id} value={k.kebele_id}>
                  {kebeleOptionLabel(k)}
                </option>
              ))}
            </Select>
          </FieldWrap>
        </Grid>

        {checkpointGated && residentId && (
          <div className="mt-4">
            {checkpointQuery.isLoading ? (
              <p className="font-am-body text-xs text-slate-500">
                የኪራይ ሁኔታ በመፈተሽ ላይ… / Checking rental standing…
              </p>
            ) : checkpoint?.has_active_occupancy && checkpoint.would_block ? (
              <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div className="text-sm text-red-900">
                    <p className="font-am-body font-medium">
                      ይህ አመልካች/ቤተሰብ {checkpoint.overdue_month_count} ወራት ያልተከፈለ የኪራይ ዕዳ አለበት (
                      {Number(checkpoint.overdue_total ?? 0).toLocaleString()} ETB) — ከ
                      {checkpoint.oldest_overdue_period
                        ? ethiopianPeriodLabel(checkpoint.oldest_overdue_period)
                        : "—"}{" "}
                      ጀምሮ
                    </p>
                    <p className="mt-0.5 text-xs text-red-700">
                      / {checkpoint.overdue_month_count} unpaid rental month(s), ETB{" "}
                      {Number(checkpoint.overdue_total ?? 0).toLocaleString()}, oldest since{" "}
                      {checkpoint.oldest_overdue_period
                        ? ethiopianPeriodLabel(checkpoint.oldest_overdue_period)
                        : "—"}
                      .{" "}
                      {checkpoint.has_active_plan
                        ? `An active repayment plan (${checkpoint.active_plan_number}) exists but does not clear this block under this woreda's policy.`
                        : "This request is blocked by policy."}
                    </p>
                  </div>
                </div>
                {errors["checkpoint"] && (
                  <p className="font-am-body text-xs text-red-700">{errors["checkpoint"]}</p>
                )}
                {checkpoint.emergency_exemption && hasPermission(P.SERVICE_CHECKPOINT_OVERRIDE) && (
                  <div className="space-y-2 border-t border-red-200 pt-2">
                    <label className="flex items-center gap-2 text-sm text-red-900">
                      <Checkbox
                        checked={checkpointOverride}
                        onCheckedChange={(v) => setCheckpointOverride(Boolean(v))}
                      />
                      <span className="font-am-body">
                        የአስቸኳይ ጊዜ ማለፊያ ተጠቀም / Use emergency override
                      </span>
                    </label>
                    {checkpointOverride && (
                      <div>
                        <Textarea
                          className="font-am-body"
                          placeholder="ምክንያት / Reason"
                          value={checkpointOverrideReason}
                          onChange={(e) => setCheckpointOverrideReason(e.target.value)}
                        />
                        {errors["checkpointOverrideReason"] && (
                          <p className="mt-1 text-xs text-red-700">
                            {errors["checkpointOverrideReason"]}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : checkpoint?.has_active_occupancy && (checkpoint.overdue_month_count ?? 0) > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="font-am-body text-sm text-amber-900">
                  ያልተከፈለ የኪራይ ዕዳ አለ ({checkpoint.overdue_month_count} ወራት) — አግድ አይደለም
                  <span className="ml-1 block text-xs text-amber-700">
                    / {checkpoint.overdue_month_count} unpaid rental month(s) — not blocking, for
                    visibility only.
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <Section
        icon={FileText}
        titleAm={isComplaint ? "የቅሬታ ዝርዝር" : "የጥያቄ ዝርዝር"}
        titleEn={isComplaint ? "Complaint details" : "Request details"}
      >
        <Grid>
          <FieldWrap labelAm="ጉዳይ" labelEn="Subject" required error={errors["subject"]} colSpan2>
            <Input
              className="font-am-body"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </FieldWrap>
          {!isComplaint && (
            <>
              <FieldWrap labelAm="ዓላማ" labelEn="Purpose">
                <Input
                  className="font-am-body"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </FieldWrap>
              <FieldWrap labelAm="ለማን ይቀርባል" labelEn="Addressed to">
                <Input
                  className="font-am-body"
                  value={addressedTo}
                  onChange={(e) => setAddressedTo(e.target.value)}
                  placeholder="ለምሳሌ: ባንክ፣ ፍርድ ቤት፣ አሰሪ / e.g. bank, court, employer"
                />
              </FieldWrap>
            </>
          )}
          {isComplaint && (
            <>
              <FieldWrap labelAm="ተከሳሽ / አቤቱታ የቀረበበት" labelEn="Respondent">
                <Input
                  className="font-am-body"
                  value={respondentName}
                  onChange={(e) => setRespondentName(e.target.value)}
                />
              </FieldWrap>
              <FieldWrap labelAm="የተከሰተበት ቀን" labelEn="Incident date">
                <Input
                  type="date"
                  value={incidentDate}
                  onChange={(e) => setIncidentDate(e.target.value)}
                />
              </FieldWrap>
              <FieldWrap labelAm="የተከሰተበት ቦታ" labelEn="Incident place" colSpan2>
                <Input
                  className="font-am-body"
                  value={incidentPlace}
                  onChange={(e) => setIncidentPlace(e.target.value)}
                />
              </FieldWrap>
            </>
          )}
          <FieldWrap
            labelAm="ማብራሪያ"
            labelEn="Description"
            required
            error={errors["details"]}
            colSpan2
          >
            <Textarea
              className="font-am-body min-h-28"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </FieldWrap>
        </Grid>
      </Section>

      <Section icon={Paperclip} titleAm="ማስረጃ ሰነዶች" titleEn="Supporting documents">
        <input
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
          className="block w-full cursor-pointer rounded-md border border-dashed border-slate-300 p-4 text-sm"
        />
        <p className="font-am-body mt-2 text-xs text-slate-500">
          JPG, PNG, WEBP ወይም PDF — ከ5MB በታች / Max 5MB per file
        </p>
        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map((pf, i) => (
              <div
                key={`${pf.file.name}-${i}`}
                className="flex flex-wrap items-center gap-3 rounded-md border bg-slate-50 px-3 py-2"
              >
                <span className="flex-1 truncate text-sm">{pf.file.name}</span>
                <span className="text-xs text-slate-500">
                  {(pf.file.size / 1024).toFixed(0)} KB
                </span>
                <Select
                  value={pf.documentType}
                  className="h-9 w-[190px]"
                  onChange={(e) =>
                    setFiles((prev) =>
                      prev.map((x, xi) => (xi === i ? { ...x, documentType: e.target.value } : x)),
                    )
                  }
                >
                  {DOCUMENT_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.labelAm} / {d.labelEn}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, xi) => xi !== i))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-red-600"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => navigate({ to: isComplaint ? "/woreda/complaints" : "/woreda/services" })}
        >
          ተመለስ / Cancel
        </Button>
        <Button
          onClick={() => {
            if (validate()) setConfirmOpen(true);
          }}
        >
          <Send className="mr-1 h-4 w-4" />
          <span className="font-am-body">አስገባ / Submit</span>
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-am-body">ማስገባትን ያረጋግጡ / Confirm submission</DialogTitle>
            <DialogDescription className="font-am-body">
              ጥያቄው ወደ ማጽደቅ ወረፋ ይላካል። መረጃው ትክክል መሆኑን ያረጋግጡ።
              <span className="mt-2 block text-xs text-slate-500">
                The request will be sent to the approval queue.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              አይ / No
            </Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy ? "በማስገባት ላይ… / Submitting…" : "አረጋግጥ / Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
