import type { ReactNode } from "react";
import { useAuthStore } from "@/stores/authStore";
import type { Permission } from "@/config/permissions";

interface PermissionGateProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: PermissionGateProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return <>{hasPermission(permission) ? children : fallback}</>;
}
