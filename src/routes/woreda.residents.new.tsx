import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { UserCircle2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { ResidentWizardSteps } from "@/components/forms/ResidentWizardSteps";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import {
  residentSchema,
  RESIDENT_STEP_FIELDS,
  buildResidentPayloadCore,
  type ResidentFormInput,
  type ResidentFormValues,
} from "@/lib/residentSchema";

export const Route = createFileRoute("/woreda/residents/new")({
  ssr: false,
  component: NewResidentPage,
});

function NewResidentPage() {
  const navigate = useNavigate();
  const woredaId = useAuthStore((s) => s.woredaId);

  const [step, setStep] = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ResidentFormInput, unknown, ResidentFormValues>({
    resolver: zodResolver(residentSchema),
    defaultValues: {
      bp_same_as_current: "no",
      has_former_residence: "no",
    } as ResidentFormInput,
    mode: "onBlur",
  });

  const { handleSubmit, formState: { errors }, trigger } = form;

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
      const next = step + 1;
      setStep(next);
      setMaxReached((m) => Math.max(m, next));
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
    if (n <= maxReached && n !== step) {
      setStep(n);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const onSubmit = async (values: ResidentFormValues) => {
    if (!woredaId) {
      toast.error("ወረዳ አልተገኘም / Woreda not found in session");
      return;
    }
    setSubmitting(true);
    try {
      const core = buildResidentPayloadCore(values);
      const { error } = await supabase.from("resident").insert({
        woreda_id: woredaId,
        resident_number: "AUTO",
        marital_status: "single",
        residency_status: "active",
        ...core,
      });
      if (error) {
        if (error.message.includes("duplicate") && error.message.includes("national_id")) {
          toast.error("ይህ የመታወቂያ ቁጥር ቀደም ሲል ተመዝግቧል / This ID number is already registered");
        } else {
          toast.error(`ምዝገባ አልተሳካም / Registration failed: ${error.message}`);
        }
        return;
      }
      toast.success("ነዋሪው ተመዝግቧል / Resident registered");
      navigate({ to: "/woreda/residents" });
    } catch (e) {
      toast.error(`ስህተት / Error: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6 pb-28">
      <PageHeader icon={UserCircle2} titleAm="አዲስ ነዋሪ ምዝገባ" titleEn="Register a new resident" />

      <ResidentWizardSteps
        form={form}
        step={step}
        maxReached={maxReached}
        onJumpStep={jumpTo}
        woredaId={woredaId}
      />

      <div className="fixed bottom-0 left-64 right-0 z-30 border-t border-slate-200 bg-white px-6 py-3 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate({ to: "/woreda/residents" })}
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
                <span className="font-noto-ethiopic">ነዋሪ መዝግብ</span>
                <span className="ml-2 opacity-80">/ Register Resident</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
