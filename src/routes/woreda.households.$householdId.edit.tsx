import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Home } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/common/PermissionGate";
import { HouseholdFormFields } from "@/components/forms/HouseholdFormFields";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { P } from "@/config/permissions";
import {
  householdSchema,
  buildHouseholdPayload,
  type HouseholdFormInput,
  type HouseholdFormValues,
} from "@/lib/householdSchema";

export const Route = createFileRoute("/woreda/households/$householdId/edit")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.HOUSEHOLD_UPDATE}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You don't have permission to edit households.</p>
        </div>
      }
    >
      <EditHouseholdPage />
    </PermissionGate>
  ),
});

function EditHouseholdPage() {
  const { householdId } = Route.useParams();
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const queryClient = useQueryClient();

  const householdQuery = useQuery({
    queryKey: ["household", householdId],
    enabled: !!woredaId,
    queryFn: async () => {
      // household_decrypted isn't in the generated types yet (00000000000023_
      // pii_encryption.sql) -- same untyped-client cast pattern already used
      // elsewhere in this codebase for pre-typegen tables.
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error } = await db
        .from("household_decrypted")
        .select("*")
        .eq("household_id", householdId)
        .eq("woreda_id", woredaId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<HouseholdFormInput, unknown, HouseholdFormValues>({
    resolver: zodResolver(householdSchema),
    defaultValues: { occupancy_status: "occupied" } as HouseholdFormInput,
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    control,
    setValue,
    watch,
    reset,
  } = form;

  // Populate form once data loaded
  useEffect(() => {
    if (!householdQuery.data) return;
    const h = householdQuery.data;
    // Falls back to the still-present plaintext column if decryption comes
    // back NULL (fail-soft by design, see 00000000000023_pii_encryption.sql)
    // -- without this, a decrypt failure pre-fills the form with an empty
    // phone/email, and saving overwrites the still-good plaintext with
    // empty/null. At stage 4, once the plaintext columns are dropped, this
    // fallback must be replaced by a hard error that blocks the save.
    const phone = ((h.phone_number_decrypted ?? h.phone_number) as string | null) ?? "";
    reset({
      kebele_id: (h.kebele_id as string) ?? "",
      house_number: (h.house_number as string) ?? "",
      address_line: (h.address_line as string) ?? "",
      occupancy_status:
        (h.occupancy_status as HouseholdFormInput["occupancy_status"]) ?? "occupied",
      sub_woreda: (h.sub_woreda as string) ?? "",
      household_head_resident_id: (h.household_head_resident_id as string) ?? "",
      spouse_resident_id: (h.spouse_resident_id as string) ?? "",
      alternate_head_resident_id: (h.alternate_head_resident_id as string) ?? "",
      phone_digits: phone.startsWith("+251") ? phone.slice(4) : phone.replace(/\D/g, ""),
      po_box: (h.po_box as string) ?? "",
      email: ((h.email_decrypted ?? h.email) as string) ?? "",
      house_type: (h.house_type as HouseholdFormInput["house_type"]) ?? "private",
      house_type_other: (h.house_type_other as string) ?? "",
      rent_amount:
        h.rent_amount !== null && h.rent_amount !== undefined ? String(h.rent_amount) : "",
      gps_lat: (h.gps_lat as number | null) ?? undefined,
      gps_lng: (h.gps_lng as number | null) ?? undefined,
    } as HouseholdFormInput);
  }, [householdQuery.data, reset]);

  const onInvalid = () => {
    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      const el = document.querySelector<HTMLElement>(`[name="${firstKey}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
    }
  };

  const updateMutation = useMutation({
    mutationFn: async (values: HouseholdFormValues) => {
      if (!woredaId || !householdQuery.data) throw new Error("Session error");
      const old = householdQuery.data;
      const payload = buildHouseholdPayload(values, woredaId);
      // Do NOT change kebele_id or house_number on edit — preserve originals.
      payload.kebele_id = old.kebele_id;
      payload.house_number = old.house_number;
      const { error } = await supabase
        .from("household")
        .update(payload as never)
        .eq("household_id", householdId)
        .eq("woreda_id", woredaId);
      if (error) throw error;

      const oldSnapshot: Record<string, unknown> = {
        address_line: old.address_line,
        occupancy_status: old.occupancy_status,
        sub_woreda: old.sub_woreda,
        household_head_resident_id: old.household_head_resident_id,
        spouse_resident_id: old.spouse_resident_id,
        alternate_head_resident_id: old.alternate_head_resident_id,
        phone_number: old.phone_number_decrypted ?? old.phone_number,
        po_box: old.po_box,
        email: old.email_decrypted ?? old.email,
        house_type: old.house_type,
        house_type_other: old.house_type_other,
        rent_amount: old.rent_amount,
      };

      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "household",
        entity_id: householdId,
        action_type: "HOUSEHOLD_UPDATED",
        old_value_json: oldSnapshot as never,
        new_value_json: payload as never,
        action_at: new Date().toISOString(),
      });
      await supabase.from("household_change_log").insert({
        household_id: householdId,
        woreda_id: woredaId,
        change_type: "RECORD_UPDATED",
        registered_by_user_id: actorUserId,
        old_value_json: oldSnapshot as never,
        new_value_json: payload as never,
      });
    },
    onSuccess: () => {
      toast.success("ቤተሰቡ ተስተካክሏል / Household updated");
      queryClient.invalidateQueries({ queryKey: ["households"] });
      queryClient.invalidateQueries({ queryKey: ["household", householdId] });
      // The detail page's decrypted phone/email query -- otherwise a stale
      // value could flash there for a beat after navigating back to it.
      queryClient.invalidateQueries({ queryKey: ["household-contact-decrypted", householdId] });
      navigate({ to: "/woreda/households/$householdId", params: { householdId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (householdQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (householdQuery.error || !householdQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-noto-ethiopic font-medium">ቤተሰብ አልተገኘም / Household not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <PageHeader icon={Home} titleAm="ቤተሰብ አስተካክል" titleEn="Edit Household" />

      <form
        onSubmit={handleSubmit((v) => updateMutation.mutate(v), onInvalid)}
        className="space-y-6"
      >
        <HouseholdFormFields
          woredaId={woredaId as string}
          control={control}
          register={register}
          errors={errors}
          setValue={setValue}
          watch={watch}
          mode="edit"
        />

        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                navigate({ to: "/woreda/households/$householdId", params: { householdId } })
              }
            >
              <span className="font-noto-ethiopic">ይቅር</span>
              <span className="ml-2 text-xs opacity-70">/ Cancel</span>
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-blue-700 text-white hover:bg-blue-800"
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <span className="font-noto-ethiopic">ለውጥ አስቀምጥ</span>
              <span className="ml-2 text-xs opacity-80">/ Save Changes</span>
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
