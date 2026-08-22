import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuthStore, type AppUser } from "@/stores/authStore";
import { getCurrentEthiopianDate } from "@/utils/ethiopianCalendar";
import type { Role } from "@/config/permissions";
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

function LoginPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.appUser?.status);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    const { data: userRow, error: userErr } = await supabase
      .from("app_user")
      // console_role_id doesn't exist in the generated types yet -- see the
      // cast below, same as useAuthBootstrap.ts's fetchAppUser.
      .select("user_id, woreda_id, role, full_name, username, status, console_role_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (userErr || !userRow) {
      setSubmitError("Your account is not provisioned in the system. Contact your administrator.");
      await supabase.auth.signOut();
      setIsSubmitting(false);
      return;
    }

    const row = userRow as unknown as {
      user_id: string;
      woreda_id: string | null;
      role: string;
      full_name: string;
      username: string;
      status: string;
      console_role_id: string | null;
    };
    const appUser: AppUser = {
      user_id: row.user_id,
      woreda_id: row.woreda_id,
      role: row.role as Role,
      full_name: row.full_name,
      username: row.username,
      status: row.status,
      console_role_id: row.console_role_id,
    };

    // Only an active account resolves permissions: user_has_perm() checks the
    // status column, so anything else lands on a dashboard where every query
    // returns empty and nothing explains why.
    if (appUser.status !== "active") {
      setAuth(data.user, appUser);
      setIsSubmitting(false);
      if (appUser.status === "pending") {
        navigate({ to: "/set-password" });
      } else {
        setSubmitError("This account is not active. Contact your administrator.");
        await supabase.auth.signOut();
      }
      return;
    }

    setAuth(data.user, appUser);

    if (appUser.role === "super_admin") {
      navigate({ to: "/admin/dashboard" });
    } else {
      navigate({ to: "/woreda/dashboard" });
    }
  };

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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                {...register("email")}
                className="mt-1"
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register("password")}
                className="mt-1"
              />
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
              className="w-full bg-blue-700 text-white hover:bg-blue-800"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="font-noto-ethiopic">ግባ / Sign In</span>
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            Forgot your password? Contact your administrator to be re-invited.
          </p>
        </div>
      </div>
    </div>
  );
}
