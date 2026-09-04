import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { HeartCrack, ClipboardList, User, ArrowLeft, Save, UserX } from "lucide-react";
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
import { phoneDigitsSchema, phoneDigitsToE164 } from "@/lib/phoneNumber";
import { PhoneDigitsInput } from "@/components/forms/PhoneDigitsInput";

const todayIso = () => new Date().toISOString().slice(0, 10);

const schema = z
  .object({
    deceased_resident_id: z.string().optional().default(""),
    deceased_name: z.string().trim().max(200).optional().default(""),
    sex: z.enum(["male", "female", ""]).optional().default(""),
    date_of_death: z
      .string()
      .min(1, "የሞት ቀን ያስፈልጋል / Date of death required")
      .refine((v) => v <= todayIso(), "ወደፊት መሆን አይችልም / Cannot be in future"),
    place_of_death: z.string().trim().max(200).optional().default(""),
    cause_of_death: z.string().trim().max(500).optional().default(""),
    facility_name: z.string().trim().max(200).optional().default(""),
    certified_by: z.string().trim().max(200).optional().default(""),
    notes: z.string().trim().max(1000).optional().default(""),
    informant_name: z
      .string()
      .trim()
      .min(1, "የመረጃ ሰጪ ስም ያስፈልጋል / Informant name required")
      .max(200),
    informant_relation: z.string().trim().max(100).optional().default(""),
    informant_phone: phoneDigitsSchema(),
  })
  .refine((v) => v.deceased_resident_id || v.deceased_name.trim().length > 0, {
    message: "Select a registered resident or enter the deceased's name",
    path: ["deceased_name"],
  });

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export const Route = createFileRoute("/woreda/civil/death/new")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CIVIL_REGISTER}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ለመጠቀም ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission.</p>
        </div>
      }
    >
      <DeathNewPage />
    </PermissionGate>
  ),
});

function DeathNewPage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);

  const form = useForm<In>({
    resolver: zodResolver(schema),
    defaultValues: {
      deceased_resident_id: "",
      deceased_name: "",
      sex: "",
      date_of_death: "",
      place_of_death: "",
      cause_of_death: "",
      facility_name: "",
      certified_by: "",
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
  const deceasedResidentId = watch("deceased_resident_id");
  const dod = watch("date_of_death");

  const mutation = useMutation({
    mutationFn: async (v: Out) => {
      if (!woredaId || !actorUserId) throw new Error("Missing session");

      const event_details = {
        deceased_resident_id: v.deceased_resident_id || null,
        deceased_name: v.deceased_name || null,
        sex: v.sex || null,
        place_of_death: v.place_of_death || null,
        cause_of_death: v.cause_of_death || null,
        facility_name: v.facility_name || null,
        certified_by: v.certified_by || null,
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
          event_type: "death",
          event_number: "",
          event_date: v.date_of_death,
          registration_date: todayIso(),
          status: "submitted",
          requested_by_user_id: actorUserId,
          resident_id: v.deceased_resident_id || null,
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
        action_type: "DEATH_REGISTERED",
        new_value_json: event_details as never,
        action_at: new Date().toISOString(),
      });

      return data.vital_event_id as string;
    },
    onSuccess: (eventId) => {
      toast.success("የሞት ምዝገባ ተልኳል / Death registration submitted");
      navigate({ to: "/woreda/civil/$eventId", params: { eventId } });
    },
    onError: (e) => toast.error(`Submit failed: ${(e as Error).message}`),
  });

  const onSubmit = handleSubmit((raw) => mutation.mutate(schema.parse(raw)));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={HeartCrack}
        titleAm="አዲስ የሞት ምዝገባ"
        titleEn="New Death Registration"
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6">
        <Section icon={UserX} titleAm="የሟች መረጃ" titleEn="Deceased Information">
          <Grid>
            <FieldWrap labelAm="ሟች (የተመዘገበ)" labelEn="Deceased (registered resident)" colSpan2>
              <ResidentSearchPicker
                value={deceasedResidentId ?? ""}
                onChange={(id) => setValue("deceased_resident_id", id)}
                woredaId={woredaId ?? ""}
              />
            </FieldWrap>
            {!deceasedResidentId && (
              <FieldWrap
                labelAm="የሟች ስም (በእጅ)"
                labelEn="Deceased's name (manual)"
                colSpan2
                error={errors.deceased_name?.message}
                helper="ካልተመዘገበ ስም እዚህ ያስገቡ / Enter here if not a registered resident"
              >
                <Input {...register("deceased_name")} />
              </FieldWrap>
            )}
            <FieldWrap labelAm="ፆታ" labelEn="Sex">
              <Select {...register("sex")}>
                <option value="">— ይምረጡ / Select —</option>
                <option value="male">ወንድ / Male</option>
                <option value="female">ሴት / Female</option>
              </Select>
            </FieldWrap>
            <FieldWrap
              labelAm="የሞት ቀን"
              labelEn="Date of Death"
              required
              error={errors.date_of_death?.message}
            >
              <EthiopianDateInput
                value={dod}
                onChange={(iso) => setValue("date_of_death", iso, { shouldValidate: true })}
              />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={ClipboardList} titleAm="የሞት ዝርዝር" titleEn="Death Details">
          <Grid>
            <FieldWrap labelAm="የሞት ስፍራ" labelEn="Place of Death">
              <Input {...register("place_of_death")} />
            </FieldWrap>
            <FieldWrap labelAm="የጤና ተቋም" labelEn="Health Facility">
              <Input {...register("facility_name")} />
            </FieldWrap>
            <FieldWrap labelAm="የሞት መንስዔ" labelEn="Cause of Death" colSpan2>
              <Textarea rows={2} {...register("cause_of_death")} />
            </FieldWrap>
            <FieldWrap labelAm="ያረጋገጠው" labelEn="Certified by (physician / official)">
              <Input {...register("certified_by")} />
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
            <FieldWrap labelAm="ዝምድና" labelEn="Relation to Deceased">
              <Input {...register("informant_relation")} />
            </FieldWrap>
            <FieldWrap
              labelAm="ስልክ"
              labelEn="Phone (9 digits after +251)"
              error={errors.informant_phone?.message}
            >
              <PhoneDigitsInput
                value={watch("informant_phone") ?? ""}
                onChange={(digits) => setValue("informant_phone", digits, { shouldDirty: true })}
                onBlur={() =>
                  setValue("informant_phone", watch("informant_phone") ?? "", {
                    shouldValidate: true,
                  })
                }
              />
            </FieldWrap>
          </Grid>
        </Section>

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
