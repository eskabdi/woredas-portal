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
  hasPermission: (permission) => {
    const { role } = get();
    if (!role) return false;
    return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
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
  setAuth: (user, appUser, consolePermissions = []) =>
    set({
      user,
      appUser,
      role: appUser?.role ?? null,
      woredaId: appUser?.woreda_id ?? null,
      permissions: appUser ? (ROLE_PERMISSIONS[appUser.role] ?? []) : [],
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
