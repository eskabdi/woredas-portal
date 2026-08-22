import type { ReactNode } from "react";
import { useAuthStore } from "@/stores/authStore";
import type { ConsolePermission } from "@/config/permissions";

interface ConsolePermissionGateProps {
  /** An array is satisfied by any one of the listed permissions. */
  permission: ConsolePermission | ConsolePermission[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function ConsolePermissionGate({
  permission,
  children,
  fallback = null,
}: ConsolePermissionGateProps) {
  const hasConsolePermission = useAuthStore((s) => s.hasConsolePermission);
  const required = Array.isArray(permission) ? permission : [permission];
  const allowed = required.some((p) => hasConsolePermission(p));
  return <>{allowed ? children : fallback}</>;
}

export function InsufficientConsolePermissionNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
      You do not have permission to access this section of the Super Admin Console.
    </div>
  );
}
