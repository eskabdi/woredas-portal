import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Scale, Users, ArrowLeft, Save, FileText } from "lucide-react";
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

const todayIso = () => new Date().toISOString().slice(0, 10);

const partySchema = z
  .object({
    resident_id: z.string().optional().default(""),
    name: z.string().trim().max(200).optional().default(""),
  })
  .refine((v) => v.resident_id || v.name.trim().length > 0, {
    message: "Select a resident or enter a name",
    path: ["name"],
  });

const schema = z
  .object({
    spouse1: partySchema,
    spouse2: partySchema,
    marriage_date: z.string().optional().default(""),
    event_date: z
      .string()
      .min(1, "ቀን ያስፈልጋል / Date required")
      .refine((v) => v <= todayIso(), "ወደፊት መሆን አይችልም / Cannot be in future"),
    court_name: z.string().trim().max(200).optional().default(""),
    decree_reference: z
      .string()
      .trim()
      .min(1, "የፍርድ ቤት ማጣቀሻ ያስፈልጋል / Decree reference required")
      .max(120),
    grounds: z.string().trim().max(1000).optional().default(""),
    notes: z.string().trim().max(1000).optional().default(""),
    informant_name: z
      .string()
      .trim()
      .min(1, "የመረጃ ሰጪ ስም ያስፈልጋል / Informant required")
      .max(200),
    informant_phone: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine((v) => !v || /^\d{9}$/.test(v), "9 አሃዝ / 9 digits"),
  })
  .refine((v) => !v.marriage_date || v.marriage_date <= v.event_date, {
    message: "Marriage date must be before divorce date",
    path: ["marriage_date"],
  });

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export const Route = createFileRoute("/woreda/civil/divorce/new")({
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
      <DivorceNewPage />
    </PermissionGate>
  ),
});

function DivorceNewPage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);

  const form = useForm<In>({
    resolver: zodResolver(schema),
    defaultValues: {
      spouse1: { resident_id: "", name: "" },
      spouse2: { resident_id: "", name: "" },
      marriage_date: "",
      event_date: "",
      court_name: "",
      decree_reference: "",
      grounds: "",
      notes: "",
      informant_name: "",
      informant_phone: "",
    },
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = form;
  const s1 = watch("spouse1");
  const s2 = watch("spouse2");
  const eventDate = watch("event_date");
  const marriageDate = watch("marriage_date");

  const mutation = useMutation({
    mutationFn: async (v: Out) => {
      if (!woredaId || !actorUserId) throw new Error("Missing session");

      const event_details = {
        spouse1: {
          resident_id: v.spouse1.resident_id || null,
          name: v.spouse1.name || null,
        },
        spouse2: {
          resident_id: v.spouse2.resident_id || null,
          name: v.spouse2.name || null,
        },
        marriage_date: v.marriage_date || null,
        court_name: v.court_name || null,
        decree_reference: v.decree_reference,
        grounds: v.grounds || null,
        informant: {
          name: v.informant_name,
          phone: v.informant_phone ? `+251${v.informant_phone}` : null,
        },
      };

      const { data, error } = await supabase
        .from("vital_event")
        .insert({
          woreda_id: woredaId,
          event_type: "divorce",
          event_number: "",
          event_date: v.event_date,
          registration_date: todayIso(),
          status: "submitted",
          requested_by_user_id: actorUserId,
          resident_id: v.spouse1.resident_id || v.spouse2.resident_id || null,
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
        action_type: "DIVORCE_REGISTERED",
        new_value_json: event_details as never,
        action_at: new Date().toISOString(),
      });

      return data.vital_event_id as string;
    },
    onSuccess: (eventId) => {
      toast.success("የፍቺ ምዝገባ ተልኳል / Divorce submitted");
      navigate({ to: "/woreda/civil/$eventId", params: { eventId } });
    },
    onError: (e) => toast.error(`Submit failed: ${(e as Error).message}`),
  });

  const onSubmit = handleSubmit((raw) => mutation.mutate(schema.parse(raw)));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scale}
        titleAm="አዲስ የፍቺ ምዝገባ"
        titleEn="New Divorce Registration"
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/woreda/civil" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6">
        <Section icon={Users} titleAm="ተጋቢዎች" titleEn="Parties">
          <Grid>
            <FieldWrap labelAm="ተጋቢ 1 (የተመዘገበ)" labelEn="Party 1 (registered)" colSpan2>
              <ResidentSearchPicker
                value={s1?.resident_id ?? ""}
                onChange={(id) => setValue("spouse1.resident_id", id)}
                woredaId={woredaId ?? ""}
              />
            </FieldWrap>
            {!s1?.resident_id && (
              <FieldWrap
                labelAm="ተጋቢ 1 ስም"
                labelEn="Party 1 name (manual)"
                colSpan2
                error={errors.spouse1?.name?.message}
              >
                <Input {...register("spouse1.name")} />
              </FieldWrap>
            )}
            <FieldWrap labelAm="ተጋቢ 2 (የተመዘገበ)" labelEn="Party 2 (registered)" colSpan2>
              <ResidentSearchPicker
                value={s2?.resident_id ?? ""}
                onChange={(id) => setValue("spouse2.resident_id", id)}
                woredaId={woredaId ?? ""}
                excludeResidentIds={s1?.resident_id ? [s1.resident_id] : []}
              />
            </FieldWrap>
            {!s2?.resident_id && (
              <FieldWrap
                labelAm="ተጋቢ 2 ስም"
                labelEn="Party 2 name (manual)"
                colSpan2
                error={errors.spouse2?.name?.message}
              >
                <Input {...register("spouse2.name")} />
              </FieldWrap>
            )}
          </Grid>
        </Section>

        <Section icon={FileText} titleAm="የፍቺ ዝርዝር" titleEn="Divorce Details">
          <Grid>
            <FieldWrap labelAm="የጋብቻ ቀን (ካለ)" labelEn="Marriage Date (if known)" error={errors.marriage_date?.message}>
              <EthiopianDateInput
                value={marriageDate ?? ""}
                onChange={(iso) => setValue("marriage_date", iso, { shouldValidate: true })}
              />
            </FieldWrap>
            <FieldWrap
              labelAm="የፍቺ ቀን"
              labelEn="Divorce Date"
              required
              error={errors.event_date?.message}
            >
              <EthiopianDateInput
                value={eventDate}
                onChange={(iso) => setValue("event_date", iso, { shouldValidate: true })}
              />
            </FieldWrap>
            <FieldWrap labelAm="ፍርድ ቤት" labelEn="Court">
              <Input {...register("court_name")} />
            </FieldWrap>
            <FieldWrap
              labelAm="የፍርድ ማጣቀሻ"
              labelEn="Decree Reference"
              required
              error={errors.decree_reference?.message}
            >
              <Input {...register("decree_reference")} />
            </FieldWrap>
            <FieldWrap labelAm="ምክንያት" labelEn="Grounds" colSpan2>
              <Textarea rows={2} {...register("grounds")} />
            </FieldWrap>
            <FieldWrap labelAm="ማስታወሻ" labelEn="Notes" colSpan2>
              <Textarea rows={3} {...register("notes")} />
            </FieldWrap>
          </Grid>
        </Section>

        <Section icon={Users} titleAm="መረጃ ሰጪ" titleEn="Informant">
          <Grid>
            <FieldWrap
              labelAm="ስም"
              labelEn="Full Name"
              required
              error={errors.informant_name?.message}
            >
              <Input {...register("informant_name")} />
            </FieldWrap>
            <FieldWrap
              labelAm="ስልክ"
              labelEn="Phone (9 digits after +251)"
              error={errors.informant_phone?.message}
            >
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-slate-50 px-3 text-sm text-slate-600">
                  +251
                </span>
                <Input
                  className="rounded-l-none"
                  inputMode="numeric"
                  maxLength={9}
                  {...register("informant_phone")}
                />
              </div>
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
