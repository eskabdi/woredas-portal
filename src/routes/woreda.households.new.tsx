import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Home } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";

import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/woreda/households/new")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.HOUSEHOLD_CREATE}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You don't have permission to create households.</p>
        </div>
      }
    >
      <NewHouseholdPage />
    </PermissionGate>
  ),
});

function NewHouseholdPage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);
  const queryClient = useQueryClient();

  const [houseNumberError, setHouseNumberError] = useState<string | null>(null);

  const form = useForm<HouseholdFormInput, unknown, HouseholdFormValues>({
    resolver: zodResolver(householdSchema),
    defaultValues: {
      occupancy_status: "occupied",
    } as HouseholdFormInput,
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    control,
    setValue,
    watch,
  } = form;

  const checkHouseNumber = async () => {
    setHouseNumberError(null);
    const kebele = watch("kebele_id");
    const house = (watch("house_number") || "").trim();
    if (!kebele || !house) return;
    const { data, error } = await supabase
      .from("household")
      .select("household_id")
      .eq("kebele_id", kebele)
      .eq("house_number", house)
      .limit(1);
    if (error) return;
    if (data && data.length > 0) {
      setHouseNumberError(
        "ይህ የቤት ቁጥር በዚህ ቀበሌ ቀደም ሲል ተመዝግቧል / This house number already exists in this kebele",
      );
    }
  };

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

  const createMutation = useMutation({
    mutationFn: async (values: HouseholdFormValues) => {
      if (!woredaId) throw new Error("Woreda not found in session");
      const payload = buildHouseholdPayload(values, woredaId);
      const { data, error } = await supabase
        .from("household")
        .insert(payload as never)
        .select("household_id, house_number")
        .single();
      if (error) throw error;
      await supabase.from("audit_log").insert({
        woreda_id: woredaId,
        actor_user_id: actorUserId,
        entity_name: "household",
        entity_id: data.household_id,
        action_type: "HOUSEHOLD_CREATED",
        old_value_json: null,
        new_value_json: payload as never,
        action_at: new Date().toISOString(),
      });
      await supabase.from("household_change_log").insert({
        household_id: data.household_id,
        woreda_id: woredaId,
        change_type: "RECORD_CREATED",
        registered_by_user_id: actorUserId,
        old_value_json: null,
        new_value_json: payload as never,
      });
      return data;
    },
    onSuccess: () => {
      toast.success("ቤተሰቡ ተመዝግቧል / Household registered");
      queryClient.invalidateQueries({ queryKey: ["households"] });
      navigate({ to: "/woreda/households" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSubmit = async (values: HouseholdFormValues) => {
    await checkHouseNumber();
    if (houseNumberError) return;
    // double-check immediately
    const { data } = await supabase
      .from("household")
      .select("household_id")
      .eq("kebele_id", values.kebele_id)
      .eq("house_number", values.house_number.trim())
      .limit(1);
    if (data && data.length > 0) {
      setHouseNumberError(
        "ይህ የቤት ቁጥር በዚህ ቀበሌ ቀደም ሲል ተመዝግቧል / This house number already exists in this kebele",
      );
      return;
    }
    createMutation.mutate(values);
  };

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <PageHeader
        icon={Home}
        titleAm="አዲስ ቤተሰብ ምዝገባ"
        titleEn="New Household Registration"
      />

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
        <HouseholdFormFields
          woredaId={woredaId as string}
          control={control}
          register={register}
          errors={errors}
          setValue={setValue}
          watch={watch}
          mode="create"
          houseNumberError={houseNumberError}
          onHouseNumberBlur={checkHouseNumber}
        />

        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => navigate({ to: "/woreda/households" })}>
              <span className="font-noto-ethiopic">ይቅር</span>
              <span className="ml-2 text-xs opacity-70">/ Cancel</span>
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-700 text-white hover:bg-blue-800"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <span className="font-noto-ethiopic">ቤተሰብ መዝግብ</span>
              <span className="ml-2 text-xs opacity-80">/ Register Household</span>
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
