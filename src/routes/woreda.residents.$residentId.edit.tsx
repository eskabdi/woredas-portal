import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserCircle2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { PermissionGate } from "@/components/common/PermissionGate";
import { ResidentWizardSteps } from "@/components/forms/ResidentWizardSteps";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { P } from "@/config/permissions";
import {
  residentSchema,
  RESIDENT_STEP_FIELDS,
  buildResidentPayloadCore,
  type ResidentFormInput,
  type ResidentFormValues,
} from "@/lib/residentSchema";

export const Route = createFileRoute("/woreda/residents/$residentId/edit")({
  ssr: false,
  component: () => (
    <PermissionGate
      permission={P.RESIDENT_UPDATE}
      fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <p className="font-noto-ethiopic font-medium">ይህን ገጽ ለማየት ፈቃድ የለዎትም</p>
          <p className="text-sm">You don't have permission to edit residents.</p>
        </div>
      }
    >
      <EditResidentPage />
    </PermissionGate>
  ),
});

type JsonRec = Record<string, unknown> | null;

function readJson(v: unknown): JsonRec {
  return v && typeof v === "object" ? (v as JsonRec) : null;
}
function strField(rec: JsonRec, key: string): string {
  const v = rec?.[key];
  return v === null || v === undefined ? "" : String(v);
}

// resident_decrypted isn't in the generated types yet (00000000000023_
// pii_encryption.sql) -- same untyped-client cast pattern already used
// elsewhere in this codebase for pre-typegen tables (console_role,
// user_permission_override).
const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

function EditResidentPage() {
  const { residentId } = Route.useParams();
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);
  const actorUserId = useAuthStore((s) => s.appUser?.user_id ?? null);

  const [step, setStep] = useState(1);
  const [maxReached] = useState(4); // all steps reachable in edit
  const [submitting, setSubmitting] = useState(false);

  const residentQuery = useQuery({
    queryKey: ["resident", residentId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await db
        .from("resident_decrypted")
        .select("*")
        .eq("resident_id", residentId)
        .eq("woreda_id", woredaId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<ResidentFormInput, unknown, ResidentFormValues>({
    resolver: zodResolver(residentSchema),
    defaultValues: {
      bp_same_as_current: "no",
      has_former_residence: "no",
    } as ResidentFormInput,
    mode: "onBlur",
  });

  const {
    handleSubmit,
    formState: { errors },
    trigger,
    reset,
  } = form;

  useEffect(() => {
    const r = residentQuery.data;
    if (!r) return;
    const cre = readJson(r.current_residence_extra);
    const bp = readJson(r.birth_place);
    const wi = readJson(r.work_info);
    const fr = readJson(r.former_residence);
    // Falls back to the still-present plaintext column if decryption comes
    // back NULL (fail-soft by design, see 00000000000023_pii_encryption.sql)
    // -- without this, a decrypt failure pre-fills the form with an empty
    // phone number, and saving overwrites the still-good plaintext with
    // empty/null. At stage 4, once the plaintext column is dropped, this
    // fallback must be replaced by a hard error that blocks the save.
    const phone = ((r.phone_number_decrypted ?? r.phone_number) as string | null) ?? "";
    const phoneDigits = phone.startsWith("+251") ? phone.slice(4) : phone.replace(/\D/g, "");

    reset({
      first_name: (r.first_name as string) ?? "",
      full_name: (r.full_name as string) ?? "",
      father_name: (r.father_name as string) ?? "",
      grandfather_name: (r.grandfather_name as string) ?? "",
      mother_full_name: (r.mother_full_name as string) ?? "",
      sex: (r.sex as ResidentFormInput["sex"]) ?? "male",
      date_of_birth: (r.date_of_birth as string) ?? "",
      photo_url: (r.photo_url as string) ?? "",
      ethnicity: (r.ethnicity as string) ?? "",
      religion: (r.religion as string) ?? "",
      national_id_no: (r.national_id_no as string) ?? "",
      phone_digits: phoneDigits,
      current_household_id: (r.current_household_id as string) ?? "",
      relation_to_head: (r.relation_to_head as string) ?? "",
      sub_woreda: strField(cre, "sub_woreda"),
      latitude: strField(cre, "latitude"),
      longitude: strField(cre, "longitude"),
      other_address: strField(cre, "other_address"),
      bp_same_as_current: "no",
      bp_place_name: strField(bp, "place_name"),
      bp_region: strField(bp, "region"),
      bp_zone: strField(bp, "zone"),
      bp_woreda: strField(bp, "woreda"),
      bp_kebele: strField(bp, "kebele"),
      bp_house_number: strField(bp, "house_number"),
      bp_area_name: strField(bp, "area_name"),
      wi_education_level: strField(wi, "education_level"),
      wi_occupation_status: strField(wi, "occupation_status"),
      wi_occupation_post: strField(wi, "occupation_post"),
      wi_work_address: strField(wi, "work_address"),
      wi_region: strField(wi, "region"),
      wi_zone: strField(wi, "zone"),
      wi_woreda: strField(wi, "woreda"),
      wi_kebele: strField(wi, "kebele"),
      wi_house_number: strField(wi, "house_number"),
      wi_area_name: strField(wi, "area_name"),
      wi_other_address: strField(wi, "other_address"),
      residency_start_date: (r.residency_start_date as string) ?? "",
      has_former_residence: fr ? "yes" : "no",
      fr_address: strField(fr, "address"),
      fr_region: strField(fr, "region"),
      fr_zone: strField(fr, "zone"),
      fr_woreda: strField(fr, "woreda"),
      fr_kebele: strField(fr, "kebele"),
      fr_house_number: strField(fr, "house_number"),
      fr_area_name: strField(fr, "area_name"),
      fr_clearance_letter_url: strField(fr, "clearance_letter_url"),
    } as ResidentFormInput);
  }, [residentQuery.data, reset]);

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

  const goNext = async () => {
    const ok = await trigger(RESIDENT_STEP_FIELDS[step], { shouldFocus: true });
    if (!ok) return;
    if (step < 4) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const goBack = () => {
    if (step > 1) {
      setStep(step - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const jumpTo = (n: number) => {
    if (n !== step) {
      setStep(n);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const onSubmit = async (values: ResidentFormValues) => {
    if (!woredaId || !residentQuery.data) {
      toast.error("Session error");
      return;
    }
    setSubmitting(true);
    try {
      const core = buildResidentPayloadCore(values);
      const { error } = await supabase
        .from("resident")
        .update(core)
        .eq("resident_id", residentId)
        .eq("woreda_id", woredaId);
      if (error) {
        toast.error(`ማዘመን አልተሳካም / Update failed: ${error.message}`);
        return;
      }

      // Diff — record only changed fields
      const old = residentQuery.data as Record<string, unknown>;
      const oldChanged: Record<string, unknown> = {};
      const newChanged: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(core)) {
        const prev = old[k];
        const eq = JSON.stringify(prev ?? null) === JSON.stringify(v ?? null);
        if (!eq) {
          oldChanged[k] = prev ?? null;
          newChanged[k] = v;
        }
      }
      if (Object.keys(newChanged).length > 0) {
        await supabase.from("audit_log").insert({
          woreda_id: woredaId,
          actor_user_id: actorUserId,
          entity_name: "resident",
          entity_id: residentId,
          action_type: "RESIDENT_UPDATED",
          old_value_json: oldChanged as never,
          new_value_json: newChanged as never,
          action_at: new Date().toISOString(),
        });
      }

      toast.success("ነዋሪው ተሻሻለ / Resident updated");
      navigate({ to: "/woreda/residents/$residentId", params: { residentId } });
    } catch (e) {
      toast.error(`ስህተት / Error: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (residentQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (residentQuery.error || !residentQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-noto-ethiopic font-medium">ነዋሪ አልተገኘም / Resident not found</p>
        <Button variant="link" onClick={() => navigate({ to: "/woreda/residents" })}>
          ← Back to list
        </Button>
      </div>
    );
  }

  const residentNumber = (residentQuery.data.resident_number as string) ?? "";

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6 pb-28">
      <PageHeader icon={UserCircle2} titleAm="ነዋሪ አስተካክል" titleEn="Edit Resident" />

      <ResidentWizardSteps
        form={form}
        step={step}
        maxReached={maxReached}
        onJumpStep={jumpTo}
        woredaId={woredaId}
        excludeResidentId={residentId}
        residentNumber={residentNumber}
      />

      <div className="fixed bottom-0 left-64 right-0 z-30 border-t border-slate-200 bg-white px-6 py-3 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              navigate({ to: "/woreda/residents/$residentId", params: { residentId } })
            }
            disabled={submitting}
          >
            <span className="font-noto-ethiopic">ይቅር</span>
            <span className="ml-1 opacity-70">/ Cancel</span>
          </Button>
          <div className="flex items-center gap-3">
            {step > 1 && (
              <Button type="button" variant="outline" onClick={goBack} disabled={submitting}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                <span className="font-noto-ethiopic">ወደ ኋላ</span>
                <span className="ml-1 opacity-70">/ Back</span>
              </Button>
            )}
            {step < 4 ? (
              <Button
                type="button"
                onClick={goNext}
                className="bg-blue-700 text-white hover:bg-blue-800"
              >
                <span className="font-noto-ethiopic">ቀጣይ</span>
                <span className="ml-1 opacity-80">/ Next</span>
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={submitting}
                className="bg-blue-700 text-white hover:bg-blue-800"
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <span className="font-noto-ethiopic">ለውጦችን አስቀምጥ</span>
                <span className="ml-2 opacity-80">/ Save Changes</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
