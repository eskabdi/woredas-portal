import { Navigate, Outlet } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { useTenantModules } from "@/hooks/useTenantModules";
import type { ModuleKey } from "@/config/permissions";

interface Props {
  moduleKey: ModuleKey;
  children?: ReactNode;
}

/**
 * Route-level module gate. Redirects to /woreda/dashboard with a toast when
 * the given module is disabled for the current tenant.
 */
export function ModuleGate({ moduleKey, children }: Props) {
  const role = useAuthStore((s) => s.role);
  const isLoading = useAuthStore((s) => s.isLoading);
  const { data: enabledModules, isLoading: modulesLoading } = useTenantModules();
  const toastFired = useRef(false);

  const disabled =
    !isLoading &&
    !modulesLoading &&
    role !== null &&
    role !== "super_admin" &&
    !!enabledModules &&
    !enabledModules.has(moduleKey);

  useEffect(() => {
    if (disabled && !toastFired.current) {
      toastFired.current = true;
      toast.error("ይህ ሞጁል ለዚህ ወረዳ አልነቃም / This module is not enabled for this woreda.");
    }
  }, [disabled]);

  if (isLoading || modulesLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  if (disabled) return <Navigate to="/woreda/dashboard" />;

  return <>{children ?? <Outlet />}</>;
}
