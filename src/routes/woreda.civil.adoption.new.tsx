import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList, HandHeart, Save, User, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Section, Grid, FieldWrap } from "@/components/forms/FormSection";
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
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";

const todayIso = () => new Date().toISOString().slice(0, 10);

const schema = z
  .object({
    adoptee_resident_id: z.string().optional().default(""),
    adoptee_name: z.string().trim().max(200).optional().default(""),
    adoption_date: z
      .string()
      .min(1, "የጉዲፈቻ ቀን ያስፈልጋል / Adoption date required")
      .refine((v) => v <= todayIso(), "ወደፊት መሆን አይችልም / Cannot be in future"),
    court_name: z.string().trim().max(200).optional().default(""),
    decree_reference: z.string().trim().max(120).optional().default(""),
    adoptive_mother_name: z.string().trim().max(200).optional().default(""),
    adoptive_father_name: z.string().trim().max(200).optional().default(""),
    notes: z.string().trim().max(1000).optional().default(""),
    informant_name: z
      .string()
      .trim()
      .min(1, "የመረጃ ሰጪ ስም ያስፈልጋል / Informant name required")
      .max(200),
    informant_relation: z.string().trim().max(100).optional().default(""),
    informant_phone: phoneDigitsSchema(),
  })
  .refine((v) => v.adoptee_resident_id || v.adoptee_name.trim().length > 0, {
    message:
      "የተመዘገበ ነዋሪ ይምረጡ ወይም የልጁን ስም ያስገቡ / Select a registered resident or enter the adoptee's name",
    path: ["adoptee_name"],
  })
  .refine((v) => v.adoptive_mother_name || v.adoptive_father_name, {
    message: "ቢያንስ አንድ አሳዳጊ ወላጅ ያስገቡ / Enter at least one adoptive parent",
    path: ["adoptive_mother_name"],
  });

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

function buildAdoptionEventDetails(v: Out) {
  return {
    adoptee_resident_id: v.adoptee_resident_id || null,
    adoptee_name: v.adoptee_name || null,
    court_name: v.court_name || null,
    decree_reference: v.decree_reference || null,
    adoptive_mother_name: v.adoptive_mother_name || null,
    adoptive_father_name: v.adoptive_father_name || null,
    informant: {
      name: v.informant_name,
      relation: v.informant_relation || null,
      phone: phoneDigitsToE164(v.informant_phone ?? ""),
    },
  };
}

function buildAdoptionInsertPayload(woredaId: string, actorUserId: string, v: Out) {
  return {
    woreda_id: woredaId,
    event_type: "adoption" as const,
    event_number: "",
    event_date: v.adoption_date,
    registration_date: todayIso(),
    status: "submitted" as const,
    requested_by_user_id: actorUserId,
    resident_id: v.adoptee_resident_id || null,
    notes: v.notes || null,
    event_details: buildAdoptionEventDetails(v),
  };
}

export const Route = createFileRoute("/woreda/civil/adoption/new")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.CIVIL_REGISTER}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-am-body font-medium">ይህን ለመጠቀም ፈቃድ የለዎትም</p>
          <p className="text-sm">You do not have permission.</p>
        </div>
      }
    >
      <AdoptionNewPage />
    </PermissionGate>
  ),
});

function AdoptionNewPage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const isOnline = useOnlineStatus();
  const { enqueue } = useOfflineQueue(woredaId);

  const form = useForm<In>({
    resolver: zodResolver(schema),
    defaultValues: {
      adoptee_resident_id: "",
      adoptee_name: "",
      adoption_date: "",
      court_name: "",
      decree_reference: "",
      adoptive_mother_name: "",
      adoptive_father_name: "",
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
  const adopteeResidentId = watch("adoptee_resident_id");
  const adoptionDate = watch("adoption_date");

  const mutation = useMutation({
    mutationFn: async (v: Out) => {
      if (!woredaId || !actorUserId) throw new Error("Missing session");
      const insertPayload = buildAdoptionInsertPayload(woredaId, actorUserId, v);
      const { data, error } = await supabase
        .from("vital_event")
        .insert(insertPayload as never)
        .select("vital_event_id")
        .single();
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "vital_event",
        entity_id: data.vital_event_id,
        action_type: "ADOPTION_REGISTERED",
        new_value_json: insertPayload.event_details as never,
        action_at: new Date().toISOString(),
      });
      return data.vital_event_id as string;
    },
    onSuccess: (eventId) => {
      toast.success("የጉዲፈቻ ምዝገባ ተልኳል / Adoption registration submitted");
      navigate({ to: "/woreda/civil/$eventId", params: { eventId } });
    },
    onError: (e) => toast.error(`ማስገባት አልተሳካም / Submit failed: ${(e as Error).message}`),
  });

  const onSubmit = handleSubmit((raw) => {
    const parsed = schema.parse(raw);
    if (!isOnline) {
      if (!woredaId || !actorUserId) {
        toast.error("ክፍለ ጊዜ ጠፍቷል / Missing session");
        return;
      }
      enqueue(
        "vital_event",
        "submit_intake",
        buildAdoptionInsertPayload(woredaId, actorUserId, parsed),
        "civil-adoption-new",
      );
      toast.success(
        "ከመስመር ውጭ ተቀምጧል፣ ሲገናኙ በራስ ሰር ይላካል / Saved offline — will submit automatically once reconnected",
      );
      navigate({ to: "/woreda/civil" });
      return;
    }
    mutation.mutate(parsed);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={HandHeart}
        titleAm="አዲስ የጉዲፈቻ ምዝገባ"
        titleEn="New Adoption Registration"
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> ተመለስ / Back
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6">
        <Section icon={User} titleAm="የጉዲፈቻ ልጁ መረጃ" titleEn="Adoptee">
          <Grid>
            <FieldWrap labelAm="ልጁ (የተመዘገበ)" labelEn="Adoptee (registered resident)" colSpan2>
              <ResidentSearchPicker
                value={adopteeResidentId ?? ""}
                onChange={(id) => setValue("adoptee_resident_id", id)}
                woredaId={woredaId ?? ""}
              />
            </FieldWrap>
            {!adopteeResidentId && (
              <FieldWrap
                labelAm="የልጁ ሙሉ ስም (በእጅ)"
                labelEn="Adoptee's full name (manual)"
                colSpan2
                error={errors.adoptee_name?.message}
                helper="ስም፣ የአባት ስም፣ የአያት ስም / Name, father's name, grandfather's name"
              >
                <Input {...register("adoptee_name")} />
              </FieldWrap>
            )}
            <FieldWrap
              labelAm="የጉዲፈቻ ቀን"
              labelEn="Date of Adoption"
              required
              error={errors.adoption_date?.message}
            >
              <EthiopianDateInput
                value={adoptionDate}
                onChange={(iso) => setValue("adoption_date", iso, { shouldValidate: true })}
              />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={Users} titleAm="አሳዳጊ ወላጆች" titleEn="Adoptive Parents">
          <Grid>
            <FieldWrap
              labelAm="የአሳዳጊ እናት ሙሉ ስም"
              labelEn="Adoptive mother's full name"
              error={errors.adoptive_mother_name?.message}
            >
              <Input {...register("adoptive_mother_name")} />
            </FieldWrap>
            <FieldWrap labelAm="የአሳዳጊ አባት ሙሉ ስም" labelEn="Adoptive father's full name">
              <Input {...register("adoptive_father_name")} />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={ClipboardList} titleAm="የፍርድ ቤት ውሳኔ" titleEn="Court Decision">
          <Grid>
            <FieldWrap labelAm="ፍርድ ቤት" labelEn="Court">
              <Input {...register("court_name")} />
            </FieldWrap>
            <FieldWrap labelAm="የውሳኔ ቁጥር" labelEn="Decree reference">
              <Input {...register("decree_reference")} />
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
            <FieldWrap labelAm="ዝምድና" labelEn="Relation to Adoptee">
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

        <p className="font-am-body rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
          ለምስክር ወረቀቱ የሚያስፈልጉ ዝርዝሮች (ትውልድ ቦታ፣ ዜግነት፣ የእንግሊዝኛ ስም...) ከገቡ በኋላ በኩነቱ ገጽ ላይ ይሞላሉ።
          <span className="ml-1">
            / Certificate details (birth place, nationality, English names…) are completed on the
            event page after submission.
          </span>
        </p>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
            ይቅር / Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="bg-[color:var(--color-shell-header)] text-white hover:bg-[color:var(--color-shell-header)]/90"
          >
            <Save className="mr-2 h-4 w-4" />
            <span className="font-am-body">አስገባ</span>
            <span className="ml-2 opacity-80">/ Submit</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
