import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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

export const Route = createFileRoute("/woreda/rental-houses/$houseId/edit")({
  ssr: false,
  component: EditRentalHousePage,
});

const schema = z.object({
  kebele_id: z.string().uuid(),
  house_number: z.string().trim().min(1).max(50),
  address_line: z.string().trim().max(255).optional().default(""),
  monthly_rent_standard: z.string().trim().min(1),
  bedrooms: z.string().trim().optional().default(""),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

function EditRentalHousePage() {
  const { houseId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
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

  const { data: house } = useQuery({
    queryKey: ["rental-house", houseId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kebele_rental_house")
        .select("*")
        .eq("rental_house_id", houseId)
        .eq("woreda_id", woredaId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (house) {
      form.reset({
        kebele_id: house.kebele_id,
        house_number: house.house_number,
        address_line: house.address_line ?? "",
        monthly_rent_standard: String(house.monthly_rent_standard ?? ""),
        bedrooms: house.bedrooms != null ? String(house.bedrooms) : "",
      });
    }
  }, [house, form]);

  const mutation = useMutation({
    mutationFn: async (v: FormValues) => {
      // uniqueness (excluding self)
      const { data: dup } = await supabase
        .from("kebele_rental_house")
        .select("rental_house_id")
        .eq("woreda_id", woredaId!)
        .eq("kebele_id", v.kebele_id)
        .eq("house_number", v.house_number.trim())
        .neq("rental_house_id", houseId)
        .maybeSingle();
      if (dup) throw new Error("የቤት ቁጥር በዚህ ቀበሌ ውስጥ ተመዝግቧል / House number exists");

      // occupancy_status is deliberately not writable from this form (AF-01):
      // it is trigger-maintained from the occupancy create/terminate
      // transactions only, and a manual change here would either be
      // rejected by that guard (while an active occupancy exists) or drift
      // from the occupancy the moment one is next created.
      const { data, error } = await supabase
        .from("kebele_rental_house")
        .update({
          kebele_id: v.kebele_id,
          house_number: v.house_number.trim(),
          address_line: v.address_line || null,
          monthly_rent_standard: Number(v.monthly_rent_standard),
          bedrooms: v.bedrooms ? Number(v.bedrooms) : null,
        })
        .eq("rental_house_id", houseId)
        .select("rental_house_id")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error("ቤቱ አልተገኘም ወይም ማዘመን አልተቻለም / House not found or update did not apply");

      await supabase.from("audit_log").insert({
        woreda_id: woredaId!,
        actor_user_id: actorUserId,
        entity_name: "kebele_rental_house",
        entity_id: houseId,
        action_type: "RENTAL_HOUSE_UPDATED",
        new_value_json: { ...v } as never,
      });
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["rental-house", houseId] });
      qc.invalidateQueries({ queryKey: ["rental-houses"] });
      navigate({ to: "/woreda/rental-houses/$houseId", params: { houseId } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!hasPermission(P.RENTAL_CREATE)) return <Navigate to="/woreda/rental-houses" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Building2}
        titleAm="የኪራይ ቤት አርትዕ"
        titleEn="Edit Rental House"
        backHref={`/woreda/rental-houses/${houseId}`}
      />
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <Section icon={Building2} titleAm="የቤት መረጃ" titleEn="House Information">
          <Grid>
            <FieldWrap labelAm="ቀበሌ" labelEn="Kebele" required>
              <Select {...form.register("kebele_id")}>
                <option value="">— ይምረጡ —</option>
                {(kebeles ?? []).map((k) => (
                  <option key={k.kebele_id} value={k.kebele_id}>
                    {k.kebele_name_am} (#{k.kebele_number})
                  </option>
                ))}
              </Select>
            </FieldWrap>
            <FieldWrap labelAm="የቤት ቁጥር" labelEn="House Number" required>
              <Input {...form.register("house_number")} />
            </FieldWrap>
            <FieldWrap labelAm="አድራሻ" labelEn="Address" colSpan2>
              <Input {...form.register("address_line")} />
            </FieldWrap>
            <FieldWrap labelAm="የቤት ኪራይ መጠን" labelEn="Monthly Rent" required>
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
          </Grid>
        </Section>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/woreda/rental-houses/$houseId", params: { houseId } })}
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
