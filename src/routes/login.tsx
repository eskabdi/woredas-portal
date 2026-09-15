import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import {
  ArrowRight,
  Calendar,
  CreditCard,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
  Shield,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { fetchAuthState } from "@/hooks/useAuthBootstrap";
import { getCurrentEthiopianDate } from "@/utils/ethiopianCalendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: LoginPage,
});

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
type LoginInput = z.infer<typeof loginSchema>;

const FEATURES = [
  {
    icon: Users,
    am: "የዜጎችና ቤተሰብ ምዝገባ",
    en: "Civil Registry",
    description: "Centralized household records, biometric IDs, and vital life statistics ledger.",
  },
  {
    icon: Shield,
    am: "የይዞታና የኪራይ ቤቶች ቁጥጥር",
    en: "Kebele Housing",
    description: "Integrated rental quotas, municipal property credential verifications & audits.",
  },
  {
    icon: CreditCard,
    am: "የገቢ ፋይናንስ አስተዳደር",
    en: "ETB Revenue",
    description:
      "Automated woreda municipal billing, trade license renewals, and regional treasury ledger.",
  },
];

function LoginPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.appUser?.status);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Already signed in: skip the form. A pending account goes to set-password
  // instead of a dashboard, and this guard has to agree with the status check
  // in onSubmit or it would bounce the user straight back out of it.
  if (role && status === "active") {
    return role === "super_admin" ? (
      <Navigate to="/admin/dashboard" />
    ) : (
      <Navigate to="/woreda/dashboard" />
    );
  }
  if (role && status === "pending") {
    return <Navigate to="/set-password" />;
  }

  const onSubmit = async (values: LoginInput) => {
    setSubmitError(null);
    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error || !data.user) {
      setSubmitError(error?.message ?? "Sign-in failed");
      setIsSubmitting(false);
      return;
    }

    // fetchAuthState fetches app_user AND (when console_role_id is non-null)
    // that role's granted console permissions in one call -- reusing this
    // instead of a separate app_user-only query is what keeps this path from
    // populating the store with an empty consolePermissions list that a
    // restricted-role super_admin would see as "denied everywhere" until the
    // ambient USER_UPDATED listener happens to correct it later.
    const { appUser, consolePermissions, permissions } = await fetchAuthState(data.user.id);

    if (!appUser) {
      setSubmitError("Your account is not provisioned in the system. Contact your administrator.");
      await supabase.auth.signOut();
      setIsSubmitting(false);
      return;
    }

    // Only an active account resolves permissions: user_has_perm() checks the
    // status column, so anything else lands on a dashboard where every query
    // returns empty and nothing explains why.
    if (appUser.status !== "active") {
      setAuth(data.user, appUser, consolePermissions, permissions);
      setIsSubmitting(false);
      if (appUser.status === "pending") {
        // Fire-and-forget: last_login_at is a nice-to-have, must never block
        // or fail the sign-in itself. Called here (the one real sign-in
        // event), not from the ambient auth listener -- see the comment in
        // useAuthBootstrap.ts for why that listener is the wrong place.
        supabase.functions.invoke("record-login", { body: {} }).catch(() => {});
        navigate({ to: "/set-password" });
      } else {
        setSubmitError("This account is not active. Contact your administrator.");
        await supabase.auth.signOut();
      }
      return;
    }

    setAuth(data.user, appUser, consolePermissions, permissions);
    supabase.functions.invoke("record-login", { body: {} }).catch(() => {});

    if (appUser.role === "super_admin") {
      navigate({ to: "/admin/dashboard" });
    } else {
      navigate({ to: "/woreda/dashboard" });
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-2">
      {/* Left panel -- brand/feature showcase, hidden below lg */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[color:var(--color-shell-header)] px-10 py-8 text-white lg:flex">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
            <Calendar className="h-3.5 w-3.5" />
            <span className="font-am-body">{getCurrentEthiopianDate()}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium tracking-wide text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            GOV-GRADE SSL 256-BIT
          </span>
        </div>

        <div className="mx-auto flex max-w-md min-w-0 flex-col items-center text-center">
          <img
            src="/images/harari-seal.png"
            alt="Harari Regional State seal"
            className="h-24 w-24 shrink-0 object-contain drop-shadow-lg"
          />
          <p className="font-am-body mt-4 text-sm font-medium text-[color:var(--color-shell-accent-gold)]">
            የሐረሪ ሕዝብ ክልላዊ መንግሥት
          </p>
          <h1 className="font-am-heading mt-2 text-3xl font-bold text-white">
            የወረዳ አስተዳደር ዲጂታል ፖርታል
          </h1>
          <p className="mt-3 text-sm text-white/70">
            Harari Region Woreda Integrated Administration &amp; Citizen Service ERP System
          </p>
        </div>

        <div className="mx-auto w-full max-w-md space-y-3">
          {FEATURES.map((f) => (
            <div
              key={f.en}
              className="flex items-start gap-3 rounded-xl bg-white/5 p-3 ring-1 ring-white/10"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <f.icon className="h-4.5 w-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  <span className="font-am-body">{f.am}</span>{" "}
                  <span className="font-normal text-white/60">({f.en})</span>
                </p>
                <p className="mt-0.5 text-xs leading-snug text-white/60">{f.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-white/50">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-am-body">ሥርዓቱ በሙሉ ዝግጁ ነው</span>
            <span>(System Operational)</span>
          </span>
          <span>ISO 27001 Certified</span>
        </div>
      </div>

      {/* Right panel -- login form */}
      <div className="flex min-w-0 flex-col overflow-x-hidden bg-[color:var(--color-shell-canvas)] px-4 py-6 sm:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-am-body">ሲስተም ዝግጁ ነው</span> / Online
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
            V1.0
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[min(28rem,calc(100vw-2rem))] min-w-0 rounded-2xl bg-white p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <img
                src="/images/harari-seal.png"
                alt="Harari Regional State seal"
                className="h-14 w-14 shrink-0 object-contain"
              />
              {/* amber-700, not the raw --shell-accent-gold token: gold is
                  calibrated as an accent against the dark shell-header
                  background (8.22:1) and fails WCAG AA (2.15:1) on this
                  white card -- see docs/ux/ux_implementation_report.md's
                  Phase 4 contrast audit. */}
              <p className="font-am-body mt-3 text-sm font-medium text-amber-700">
                የሐረሪ ሕዝብ ክልላዊ መንግሥት
              </p>
              <h1 className="font-am-heading text-xl font-bold text-slate-900">የወረዳ አስተዳደር ፖርታል</h1>
              <p className="mt-1 text-sm text-slate-500">
                Harari Regional State Woreda Administration ERP
              </p>
            </div>

            <div className="mt-5 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-am-body">እንኳን ደህና መጡ! እባክዎን የተመደበልዎትን የወረዳ ሠራተኛ መግቢያ መረጃ ያስገቡ።</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-4">
              <div>
                <Label htmlFor="email">
                  <span className="font-am-body">ኢሜይል ወይም የተጠቃሚ ቁጥር</span>{" "}
                  <span className="text-xs font-normal text-slate-400">(email or staff id)</span>
                </Label>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="abkr_admin@eharari.gov.et"
                    {...register("email")}
                    className="pl-9"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="password">
                  <span className="font-am-body">የይለፍ ቃል</span>{" "}
                  <span className="text-xs font-normal text-slate-400">(password)</span>
                </Label>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    {...register("password")}
                    className="px-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
                )}
              </div>

              {submitError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {submitError}
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full gap-2 bg-[color:var(--color-shell-header)] text-white hover:bg-[color:var(--color-shell-header)]/90"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span className="font-am-body">ግባ / Sign In</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>

        <div className="pb-2 text-center text-xs text-slate-500">
          <p>
            <span className="font-am-body">ችግር እያጋጠመዎት ነው? የሲስተም አስተዳዳሪዎን (System Admin) ያግኙ</span>
          </p>
          <p className="mt-1 text-slate-400">
            Official Government Administrative Gateway © {new Date().getFullYear()} Harari Regional
            State. All Rights Reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
