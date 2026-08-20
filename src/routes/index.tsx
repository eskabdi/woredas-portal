import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

function IndexRedirect() {
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

  // An invitation link redeems its token and lands here, because Supabase sends
  // invites to the project's site URL. Such an account is 'pending' and has no
  // password yet, so send it on to choose one rather than to a dashboard whose
  // queries would all come back empty — user_has_perm() requires 'active'.
  if (status === "pending") return <Navigate to="/set-password" />;

  // Suspended or deactivated accounts get turned away at sign-in.
  if (status !== "active") return <Navigate to="/login" />;

  if (role === "super_admin") return <Navigate to="/admin/dashboard" />;
  return <Navigate to="/woreda/dashboard" />;
}
