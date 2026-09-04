import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Baby, Users, ClipboardList, User, ArrowLeft, Save, AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Section, Grid, FieldWrap, Select } from "@/components/forms/FormSection";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ResidentSearchPicker } from "@/components/forms/ResidentSearchPicker";
import { EthiopianDateInput } from "@/components/common/EthiopianDateInput";
import { PermissionGate } from "@/components/common/PermissionGate";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import { ETHNICITY_OPTIONS, RELIGION_OPTIONS } from "@/lib/residentConstants";
import { phoneDigitsSchema, phoneDigitsToE164 } from "@/lib/phoneNumber";
import { PhoneDigitsInput } from "@/components/forms/PhoneDigitsInput";

const nameRegex = /^[\p{L}\p{M}\s]+$/u;
const nameRule = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} ያስፈልጋል / ${label} required`)
    .max(200)
    .refine((v) => nameRegex.test(v), `${label}: ምልክቶች አይፈቀዱም / Symbols not allowed`);

const todayIso = () => new Date().toISOString().slice(0, 10);

const birthSchema = z.object({
  child_first_name: nameRule("የልጅ ስም"),
  child_father_name: nameRule("የአባት ስም"),
  child_grandfather_name: nameRule("የወንድ አያት ስም"),
  child_full_name_en: z.string().trim().max(200).optional().default(""),
  sex: z.enum(["male", "female"], { message: "ፆታ ይምረጡ / Select sex" }),
  date_of_birth: z
    .string()
    .min(1, "የትውልድ ቀን ያስፈልጋል / DoB required")
    .refine((v) => v <= todayIso(), "ወደፊት መሆን አይችልም / Cannot be in future"),
  ethnicity: z.string().optional().default(""),
  religion: z.string().optional().default(""),

  mother_resident_id: z.string().optional().default(""),
  mother_name: z.string().trim().max(200).optional().default(""),
  father_resident_id: z.string().optional().default(""),
  father_name: z.string().trim().max(200).optional().default(""),

  place_of_birth: z.string().trim().max(200).optional().default(""),
  facility_name: z.string().trim().max(200).optional().default(""),
  attended_by: z.string().trim().max(200).optional().default(""),
  weight_kg: z.string().optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),

  informant_name: z.string().trim().min(1, "የመረጃ ሰጪ ስም ያስፈልጋል / Informant name required").max(200),
  informant_relation: z.string().trim().max(100).optional().default(""),
  informant_phone: phoneDigitsSchema(),
});

type BirthInput = z.input<typeof birthSchema>;
type BirthValues = z.output<typeof birthSchema>;

export const Route = createFileRoute("/woreda/civil/birth/new")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CIVIL_REGISTER}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ለመጠቀም ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission to register civil events.</p>
        </div>
      }
    >
      <BirthNewPage />
    </PermissionGate>
  ),
});

function BirthNewPage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);

  const form = useForm<BirthInput>({
    resolver: zodResolver(birthSchema),
    defaultValues: {
      child_first_name: "",
      child_father_name: "",
      child_grandfather_name: "",
      child_full_name_en: "",
      sex: undefined,
      date_of_birth: "",
      ethnicity: "",
      religion: "",
      mother_resident_id: "",
      mother_name: "",
      father_resident_id: "",
      father_name: "",
      place_of_birth: "",
      facility_name: "",
      attended_by: "",
      weight_kg: "",
      notes: "",
      informant_name: "",
      informant_relation: "",
      informant_phone: "",
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = form;

  const motherResidentId = watch("mother_resident_id");
  const fatherResidentId = watch("father_resident_id");
  const dob = watch("date_of_birth");
  const childFirst = watch("child_first_name");
  const childFather = watch("child_father_name");

  // Scoped duplicate detection: same woreda + same DoB + fuzzy name match.
  // Only fires when we have all three components; keeps false-positives low.
  const normalizedFirst = (childFirst ?? "").trim().toLowerCase();
  const normalizedFather = (childFather ?? "").trim().toLowerCase();
  const dupCheckReady =
    !!woredaId && !!dob && normalizedFirst.length >= 2 && normalizedFather.length >= 2;

  const duplicateQuery = useQuery({
    queryKey: ["birth-dup", woredaId, dob, normalizedFirst, normalizedFather],
    enabled: dupCheckReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vital_event")
        .select("vital_event_id, event_number, status, event_details")
        .eq("woreda_id", woredaId as string)
        .eq("event_type", "birth")
        .eq("event_date", dob)
        .neq("status", "rejected")
        .limit(25);
      if (error) throw error;
      return (data ?? []).filter((r) => {
        const d = (r.event_details ?? {}) as {
          child_first_name?: string;
          child_father_name?: string;
        };
        const f = (d.child_first_name ?? "").trim().toLowerCase();
        const p = (d.child_father_name ?? "").trim().toLowerCase();
        return f === normalizedFirst && p === normalizedFather;
      });
    },
  });

  const duplicates = duplicateQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: async (v: BirthValues) => {
      if (!woredaId || !actorUserId) throw new Error("Missing session");
      if (!v.mother_resident_id && !v.mother_name.trim()) {
        throw new Error("Provide mother (linked resident or manual name)");
      }
      const event_details = {
        child_first_name: v.child_first_name,
        child_father_name: v.child_father_name,
        child_grandfather_name: v.child_grandfather_name,
        child_full_name_en: v.child_full_name_en || null,
        sex: v.sex,
        ethnicity: v.ethnicity || null,
        religion: v.religion || null,
        mother_resident_id: v.mother_resident_id || null,
        mother_name: v.mother_name || null,
        father_resident_id: v.father_resident_id || null,
        father_name: v.father_name || null,
        place_of_birth: v.place_of_birth || null,
        facility_name: v.facility_name || null,
        attended_by: v.attended_by || null,
        weight_kg: v.weight_kg ? Number(v.weight_kg) : null,
        informant: {
          name: v.informant_name,
          relation: v.informant_relation || null,
          phone: phoneDigitsToE164(v.informant_phone ?? ""),
        },
      };

      const { data, error } = await supabase
        .from("vital_event")
        .insert({
          woreda_id: woredaId,
          event_type: "birth",
          event_number: "",
          event_date: v.date_of_birth,
          registration_date: todayIso(),
          status: "submitted",
          requested_by_user_id: actorUserId,
          notes: v.notes || null,
          event_details,
        })
        .select("vital_event_id")
        .single();
      if (error) throw error;

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "vital_event",
        entity_id: data.vital_event_id,
        action_type: "BIRTH_REGISTERED",
        new_value_json: event_details as never,
        action_at: new Date().toISOString(),
      });

      return data.vital_event_id as string;
    },
    onSuccess: (eventId) => {
      toast.success("የልደት ምዝገባ ተልኳል / Birth registration submitted");
      navigate({ to: "/woreda/civil/$eventId", params: { eventId } });
    },
    onError: (e) => toast.error(`Submit failed: ${(e as Error).message}`),
  });

  const onSubmit = handleSubmit((raw) => {
    const parsed = birthSchema.parse(raw);
    mutation.mutate(parsed);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Baby}
        titleAm="አዲስ የልደት ምዝገባ"
        titleEn="New Birth Registration"
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6">
        <Section icon={Baby} titleAm="የልጅ መረጃ" titleEn="Child Information">
          <Grid>
            <FieldWrap
              labelAm="የመጀመሪያ ስም"
              labelEn="First Name"
              required
              error={errors.child_first_name?.message}
            >
              <Input {...register("child_first_name")} />
            </FieldWrap>
            <FieldWrap
              labelAm="የአባት ስም"
              labelEn="Father's Name"
              required
              error={errors.child_father_name?.message}
            >
              <Input {...register("child_father_name")} />
            </FieldWrap>
            <FieldWrap
              labelAm="የወንድ አያት ስም"
              labelEn="Grandfather's Name"
              required
              error={errors.child_grandfather_name?.message}
            >
              <Input {...register("child_grandfather_name")} />
            </FieldWrap>
            <FieldWrap
              labelAm="ሙሉ ስም (English)"
              labelEn="Full Name (English)"
              error={errors.child_full_name_en?.message}
            >
              <Input {...register("child_full_name_en")} />
            </FieldWrap>
            <FieldWrap labelAm="ፆታ" labelEn="Sex" required error={errors.sex?.message}>
              <Select {...register("sex")}>
                <option value="">— ይምረጡ / Select —</option>
                <option value="male">ወንድ / Male</option>
                <option value="female">ሴት / Female</option>
              </Select>
            </FieldWrap>
            <FieldWrap
              labelAm="የትውልድ ቀን"
              labelEn="Date of Birth"
              required
              error={errors.date_of_birth?.message}
            >
              <EthiopianDateInput
                value={dob}
                onChange={(iso) => setValue("date_of_birth", iso, { shouldValidate: true })}
              />
            </FieldWrap>
            <FieldWrap labelAm="ብሔር" labelEn="Ethnicity">
              <Select {...register("ethnicity")}>
                <option value="">— ይምረጡ / Select —</option>
                {ETHNICITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.am} / {o.en}
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap labelAm="ኃይማኖት" labelEn="Religion">
              <Select {...register("religion")}>
                <option value="">— ይምረጡ / Select —</option>
                {RELIGION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.am} / {o.en}
                  </option>
                ))}
              </Select>
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={Users} titleAm="የወላጆች መረጃ" titleEn="Parents">
          <Grid>
            <FieldWrap labelAm="እናት (የተመዘገበች)" labelEn="Mother (registered resident)" colSpan2>
              <ResidentSearchPicker
                value={motherResidentId ?? ""}
                onChange={(id) => setValue("mother_resident_id", id)}
                woredaId={woredaId ?? ""}
              />
            </FieldWrap>
            {!motherResidentId && (
              <FieldWrap
                labelAm="የእናት ስም (በእጅ)"
                labelEn="Mother's name (manual)"
                colSpan2
                helper="ካልተመዘገበች እናት ስም እዚህ ያስገቡ / Enter here if mother is not a registered resident"
              >
                <Input {...register("mother_name")} />
              </FieldWrap>
            )}
            <FieldWrap labelAm="አባት (የተመዘገበ)" labelEn="Father (registered resident)" colSpan2>
              <ResidentSearchPicker
                value={fatherResidentId ?? ""}
                onChange={(id) => setValue("father_resident_id", id)}
                woredaId={woredaId ?? ""}
              />
            </FieldWrap>
            {!fatherResidentId && (
              <FieldWrap labelAm="የአባት ስም (በእጅ)" labelEn="Father's name (manual)" colSpan2>
                <Input {...register("father_name")} />
              </FieldWrap>
            )}
          </Grid>
        </Section>

        <Section icon={ClipboardList} titleAm="ተጨማሪ መረጃ" titleEn="Additional Info">
          <Grid>
            <FieldWrap labelAm="የተወለደበት ስፍራ" labelEn="Place of Birth">
              <Input {...register("place_of_birth")} />
            </FieldWrap>
            <FieldWrap labelAm="የጤና ተቋም" labelEn="Health Facility">
              <Input {...register("facility_name")} />
            </FieldWrap>
            <FieldWrap labelAm="ወሊድ የተከታተለው" labelEn="Attended by">
              <Input {...register("attended_by")} />
            </FieldWrap>
            <FieldWrap labelAm="ክብደት (ኪ.ግ)" labelEn="Weight (kg)">
              <Input type="number" step="0.01" min="0" {...register("weight_kg")} />
            </FieldWrap>
            <FieldWrap labelAm="ማስታወሻ" labelEn="Notes" colSpan2>
              <Textarea rows={3} {...register("notes")} />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={User} titleAm="መረጃ ሰጪ" titleEn="Informant">
          <Grid>
            <FieldWrap
              labelAm="ስም"
              labelEn="Full Name"
              required
              error={errors.informant_name?.message}
            >
              <Input {...register("informant_name")} />
            </FieldWrap>
            <FieldWrap labelAm="ዝምድና" labelEn="Relation to Child">
              <Input placeholder="Mother / Father / Guardian" {...register("informant_relation")} />
            </FieldWrap>
            <FieldWrap
              labelAm="ስልክ"
              labelEn="Phone (9 digits after +251)"
              error={errors.informant_phone?.message}
            >
              <PhoneDigitsInput
                value={watch("informant_phone") ?? ""}
                onChange={(digits) =>
                  setValue("informant_phone", digits, { shouldDirty: true, shouldValidate: true })
                }
              />
            </FieldWrap>
          </Grid>
        </Section>

        {duplicates.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm">
              <p className="font-noto-ethiopic font-semibold">
                ተመሳሳይ ልደት በዚህ ወረዳ ተመዝግቧል / Possible duplicate birth in this woreda
              </p>
              <p className="mt-0.5 text-xs">
                Same child name and date of birth already registered:
              </p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {duplicates.slice(0, 3).map((d) => (
                  <li key={d.vital_event_id} className="font-mono">
                    {d.event_number} · <span className="font-sans">{d.status}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                Verify before submitting; proceed only if this is a different child.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="bg-blue-700 text-white hover:bg-blue-800"
          >
            <Save className="mr-2 h-4 w-4" />
            <span className="font-noto-ethiopic">አስገባ</span>
            <span className="ml-2 opacity-80">/ Submit</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
