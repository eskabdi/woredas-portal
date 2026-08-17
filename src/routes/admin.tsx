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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }
  if (!role) return <Navigate to="/login" />;
  if (role !== "super_admin") return <Navigate to="/woreda/dashboard" />;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
