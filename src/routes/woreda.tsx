import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/woreda")({
  ssr: false,
  component: WoredaLayout,
});

function WoredaLayout() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.appUser?.status);

  // P0-4: a session that was live when the account was suspended (or set
  // inactive) keeps working until its access token expires. The database
  // already returns nothing for it (get_user_woreda_id() requires
  // status = 'active', migration 97) and set-staff-status bans the auth user
  // so it cannot refresh -- this ends the session now and says why, instead
  // of leaving a portal where every page is silently empty.
  const disabledNow =
    !isLoading && !!role && !!status && status !== "active" && status !== "pending";
  // Sticky: signOut() clears the auth store, which would otherwise flip this
  // straight to the "/login" redirect before the message is read.
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    if (!disabledNow) return;
    setDisabled(true);
    void supabase.auth.signOut();
  }, [disabledNow]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }
  if (disabled || disabledNow) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <p className="font-am-heading text-lg">መለያዎ ንቁ አይደለም</p>
          <p className="text-sm">Your account is not active.</p>
          <p className="font-am-body mt-3 text-sm">እባክዎ አስተዳዳሪዎን ያነጋግሩ።</p>
          <p className="text-sm">Please contact your administrator.</p>
          <Link to="/login" className="mt-4 inline-block text-sm font-medium underline">
            ወደ መግቢያ ገጽ / Back to sign in
          </Link>
        </div>
      </div>
    );
  }
  if (!role) return <Navigate to="/login" />;
  if (role === "super_admin") return <Navigate to="/admin/dashboard" />;
  if (status === "pending") return <Navigate to="/set-password" />;

  return (
    <AppShell portal="woreda">
      <Outlet />
    </AppShell>
  );
}
