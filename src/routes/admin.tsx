import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { AdminShell } from "@/components/layout/AdminShell";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminLayout,
});

function AdminLayout() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.appUser?.status);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }
  if (!role) return <Navigate to="/login" />;
  if (role !== "super_admin") return <Navigate to="/woreda/dashboard" />;
  // A suspended/inactive super_admin keeps a live session (suspension
  // doesn't revoke the JWT), and is_super_admin() now requires
  // status = 'active' (00000000000011_status_check_admin_helpers.sql), so
  // without this every query here would silently return empty rather than
  // explaining why. login.tsx already refuses a non-active status at sign-in
  // with a real error; this is the same check for a session that was
  // already active when the account was suspended out from under it.
  if (status !== "active") return <Navigate to="/login" />;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
