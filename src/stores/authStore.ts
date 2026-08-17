import { create } from "zustand";
import type { User } from "@supabase/supabase-js";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/config/permissions";

export interface AppUser {
  user_id: string;
  woreda_id: string | null;
  role: Role;
  full_name: string;
  username: string;
  status: string;
}

interface AuthState {
  user: User | null;
  appUser: AppUser | null;
  role: Role | null;
  woredaId: string | null;
  permissions: Permission[];
  isLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
  setAuth: (user: User | null, appUser: AppUser | null) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  appUser: null,
  role: null,
  woredaId: null,
  permissions: [],
  isLoading: true,
  hasPermission: (permission) => {
    const { role } = get();
    if (!role) return false;
    return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
  },
  setAuth: (user, appUser) =>
    set({
      user,
      appUser,
      role: appUser?.role ?? null,
      woredaId: appUser?.woreda_id ?? null,
      permissions: appUser ? (ROLE_PERMISSIONS[appUser.role] ?? []) : [],
      isLoading: false,
    }),
  clearAuth: () =>
    set({
      user: null,
      appUser: null,
      role: null,
      woredaId: null,
      permissions: [],
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
}));
