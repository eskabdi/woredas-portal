import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Section, Grid, FieldWrap, Select } from "@/components/forms/FormSection";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import { Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/woreda/rental-houses/new")({
  ssr: false,
  component: NewRentalHousePage,
});

const schema = z.object({
  kebele_id: z.string().uuid("ቀበሌ ይምረጡ / Select a kebele"),
  house_number: z.string().trim().min(1, "የቤት ቁጥር ያስፈልጋል").max(50),
  address_line: z.string().trim().max(255).optional().default(""),
  monthly_rent_standard: z.string().trim().min(1, "የቤት ኪራይ መጠን ያስፈልጋል"),
  bedrooms: z.string().trim().optional().default(""),
  occupancy_status: z.enum(["vacant", "occupied", "under_maintenance"]).default("vacant"),
});

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

function NewRentalHousePage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { data: kebeles } = useQuery({
    queryKey: ["woreda-kebeles", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele")
        .select("kebele_id, kebele_name_am, kebele_number")
        .eq("woreda_id", woredaId!)
        .order("kebele_number");
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { occupancy_status: "vacant" },
  });

  const mutation = useMutation({
    mutationFn: async (v: FormValues) => {
      // Uniqueness pre-check (kebele + house_number scoped to woreda)
      const { data: dup } = await supabase
        .from("kebele_rental_house")
        .select("rental_house_id")
        .eq("woreda_id", woredaId!)
        .eq("kebele_id", v.kebele_id)
        .eq("house_number", v.house_number.trim())
        .maybeSingle();
      if (dup) {
        throw new Error(
          "ይህ የቤት ቁጥር በዚህ ቀበሌ ውስጥ ተመዝግቧል / House number already exists in this kebele",
        );
      }
      const { data, error } = await supabase
        .from("kebele_rental_house")
        .insert({
          woreda_id: woredaId!,
          kebele_id: v.kebele_id,
          house_number: v.house_number.trim(),
          address_line: v.address_line || null,
          monthly_rent_standard: Number(v.monthly_rent_standard),
          bedrooms: v.bedrooms ? Number(v.bedrooms) : null,
          occupancy_status: v.occupancy_status,
        } as never)
        .select("rental_house_id")
        .single();
      if (error) throw error;
      const houseId = (data as { rental_house_id: string }).rental_house_id;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "kebele_rental_house",
        entity_id: houseId,
        action_type: "RENTAL_HOUSE_CREATED",
        new_value_json: {
          house_number: v.house_number.trim(),
          kebele_id: v.kebele_id,
          monthly_rent_standard: Number(v.monthly_rent_standard),
        } as never,
      });
      return houseId;
    },
    onSuccess: (houseId) => {
      toast.success("የቤት መዝገብ ተመዝግቧል / Rental house registered");
      navigate({ to: "/woreda/rental-houses/$houseId", params: { houseId } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!hasPermission(P.RENTAL_CREATE)) return <Navigate to="/woreda/rental-houses" />;

  return (
    <div className="space-y-4">
      <PageHeader icon={Building2} titleAm="አዲስ የኪራይ ቤት ምዝገባ" titleEn="Register New Rental House" />

      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <Section icon={Building2} titleAm="የቤት መረጃ" titleEn="House Information">
          <Grid>
            <FieldWrap
              labelAm="ቀበሌ"
              labelEn="Kebele"
              required
              error={form.formState.errors.kebele_id?.message}
            >
              <Select {...form.register("kebele_id")}>
                <option value="">— ይምረጡ / Select —</option>
                {(kebeles ?? []).map((k) => (
                  <option key={k.kebele_id} value={k.kebele_id}>
                    {k.kebele_name_am} (#{k.kebele_number})
                  </option>
                ))}
              </Select>
            </FieldWrap>

            <FieldWrap
              labelAm="የቤት ቁጥር"
              labelEn="House Number"
              required
              error={form.formState.errors.house_number?.message}
            >
              <Input {...form.register("house_number")} />
            </FieldWrap>

            <FieldWrap labelAm="አድራሻ" labelEn="Address" colSpan2>
              <Input {...form.register("address_line")} />
            </FieldWrap>

            <FieldWrap
              labelAm="የቤት ኪራይ መጠን (ETB / ወር)"
              labelEn="Monthly Rent Amount"
              required
              error={form.formState.errors.monthly_rent_standard?.message}
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                {...form.register("monthly_rent_standard")}
              />
            </FieldWrap>

            <FieldWrap labelAm="የመኝታ ክፍሎች" labelEn="Bedrooms">
              <Input type="number" min="0" {...form.register("bedrooms")} />
            </FieldWrap>

            <FieldWrap labelAm="የተያዥ ሁኔታ" labelEn="Occupancy Status">
              <Select {...form.register("occupancy_status")}>
                <option value="vacant">Vacant</option>
                <option value="occupied">Occupied</option>
                <option value="under_maintenance">Under maintenance</option>
              </Select>
            </FieldWrap>
          </Grid>
        </Section>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/woreda/rental-houses" })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            <Save className="mr-1 h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
