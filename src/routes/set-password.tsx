import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { useAuthStore } from "@/stores/authStore";
import { fetchAppUser } from "@/hooks/useAuthBootstrap";
import { getCurrentEthiopianDate } from "@/utils/ethiopianCalendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/set-password")({
  ssr: false,
  component: SetPasswordPage,
});

const schema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });
type SetPasswordInput = z.infer<typeof schema>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-slate-50 px-4 py-12">
      <div className="absolute right-4 top-4">
        <span className="font-noto-ethiopic rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">
          {getCurrentEthiopianDate()}
        </span>
      </div>
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <div className="w-full rounded-xl bg-white p-8 shadow-lg">
          <div className="text-center">
            <h1 className="font-noto-ethiopic text-2xl font-bold text-slate-900">
              ወረዳ አስተዳደር ሥርዓት
            </h1>
            <p className="mt-1 text-sm text-slate-500">Woreda Administration ERP — Harari Region</p>
          </div>
          <div className="my-6 border-t border-slate-200" />
          {children}
        </div>
      </div>
    </div>
  );
}

function SetPasswordPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const appUser = useAuthStore((s) => s.appUser);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordInput>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  // An invite or recovery link drops the user here with a session but no
  // usable password. Once the password is set and the account is active,
  // there is nothing left to do on this page.
  useEffect(() => {
    if (done && appUser?.status === "active") {
      const t = setTimeout(() => {
        navigate({
          to: appUser.role === "super_admin" ? "/admin/dashboard" : "/woreda/dashboard",
        });
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [done, appUser?.status, appUser?.role, navigate]);

  if (isLoading) {
    return (
      <Shell>
        <p className="text-center text-sm text-slate-500">Loading…</p>
      </Shell>
    );
  }

  // Reaching this page without a session means the link was never redeemed
  // (expired, already used, or opened in a different browser).
  if (!user) {
    return (
      <Shell>
        <h2 className="text-center text-lg font-semibold text-slate-900">
          This link is no longer valid
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          Invitation and reset links expire after a short time and can only be used once. Ask an
          administrator to send a new one.
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/login" })}>
          Back to sign in
        </Button>
      </Shell>
    );
  }

  const onSubmit = async (values: SetPasswordInput) => {
    setSubmitError(null);
    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }
    // Best-effort: the password is already set regardless of whether this
    // succeeds. Non-fatal on error -- falls through to the existing "contact
    // an administrator" messaging below if activation didn't happen.
    await invokeEdgeFunction("activate-invited-user", {});
    // Explicitly refetch rather than trusting the ambient USER_UPDATED
    // listener in useAuthBootstrap.ts, which defers via setTimeout(0) and
    // isn't guaranteed to have landed before the `done` branch below reads
    // appUser.status.
    if (user) {
      const freshAppUser = await fetchAppUser(user.id);
      setAuth(user, freshAppUser);
    }
    setIsSubmitting(false);
    setDone(true);
  };

  if (done) {
    // The activate-invited-user call in onSubmit above should have already
    // flipped a pending account to active. This still reads false if that
    // call failed (network blip, function not deployed) or if the account is
    // suspended/inactive rather than pending -- those statuses are left
    // untouched on purpose and still require an administrator.
    const pending = appUser?.status !== "active";
    return (
      <Shell>
        <h2 className="text-center text-lg font-semibold text-slate-900">Password set</h2>
        {pending ? (
          <>
            <p className="mt-2 text-center text-sm text-slate-600">
              Your account is not active yet. An administrator has to activate it before you can use
              the system. You can sign in with your new password once that is done.
            </p>
            <Button
              variant="outline"
              className="mt-6 w-full"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login" });
              }}
            >
              Back to sign in
            </Button>
          </>
        ) : (
          <p className="mt-2 text-center text-sm text-slate-600">Taking you to your dashboard…</p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Choose a password</h2>
        <p className="mt-1 text-sm text-slate-500">{user.email}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            {...register("confirm")}
          />
          {errors.confirm && <p className="mt-1 text-sm text-red-600">{errors.confirm.message}</p>}
        </div>

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          አስቀምጥ / Save password
        </Button>
      </form>
    </Shell>
  );
}
