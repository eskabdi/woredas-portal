import { create } from "zustand";
import type { User } from "@supabase/supabase-js";
import {
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
  type ConsolePermission,
} from "@/config/permissions";

export interface AppUser {
  user_id: string;
  woreda_id: string | null;
  role: Role;
  full_name: string;
  username: string;
  status: string;
  /** null = unrestricted console access; see 00000000000009_console_roles.sql. */
  console_role_id: string | null;
}

interface AuthState {
  user: User | null;
  appUser: AppUser | null;
  role: Role | null;
  woredaId: string | null;
  permissions: Permission[];
  consolePermissions: ConsolePermission[];
  isLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
  hasConsolePermission: (permission: ConsolePermission) => boolean;
  setAuth: (
    user: User | null,
    appUser: AppUser | null,
    consolePermissions?: ConsolePermission[],
    permissions?: Permission[],
  ) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  appUser: null,
  role: null,
  woredaId: null,
  permissions: [],
  consolePermissions: [],
  isLoading: true,
  // Reads the resolved `permissions` list, not ROLE_PERMISSIONS directly --
  // setAuth() populates it from current_permissions() (a tenant admin's
  // live role_permission customization) when the fetch succeeds, falling
  // back to the compiled-in default only while that fetch is in flight or
  // for a tenant with no customization at all. See docs/rbac-security-
  // forensic-review.md, F7: this is what keeps the UI's gate from disagreeing
  // with what the database (user_has_perm()) actually grants.
  hasPermission: (permission) => {
    const { role, permissions } = get();
    if (!role) return false;
    return permissions.includes(permission);
  },
  // Mirrors user_has_console_perm()'s logic exactly: only super_admin can
  // hold console permissions at all; console_role_id === null means
  // unrestricted (every permission); otherwise it's whatever
  // consolePermissions was populated with (already filtered to granted
  // permissions of an active role by fetchAppUser/fetchConsolePermissions).
  hasConsolePermission: (permission) => {
    const { appUser, consolePermissions } = get();
    if (!appUser || appUser.role !== "super_admin" || appUser.status !== "active") return false;
    if (appUser.console_role_id === null) return true;
    return consolePermissions.includes(permission);
  },
  setAuth: (user, appUser, consolePermissions = [], permissions) =>
    set({
      user,
      appUser,
      role: appUser?.role ?? null,
      woredaId: appUser?.woreda_id ?? null,
      // permissions is only omitted by callers that haven't fetched
      // current_permissions() yet (or couldn't) -- fall back to the
      // compiled-in default rather than leaving the caller wrong.
      permissions: permissions ?? (appUser ? (ROLE_PERMISSIONS[appUser.role] ?? []) : []),
      consolePermissions,
      isLoading: false,
    }),
  clearAuth: () =>
    set({
      user: null,
      appUser: null,
      role: null,
      woredaId: null,
      permissions: [],
      consolePermissions: [],
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
}));
