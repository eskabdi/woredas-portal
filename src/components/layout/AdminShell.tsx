import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  CreditCard,
  LogOut,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { ADMIN_NAV } from "@/config/permissions";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { ChangePasswordDialog } from "@/components/common/ChangePasswordDialog";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { clearAllWizardDrafts } from "@/hooks/useFormDraft";
import { clearOfflineQueue } from "@/lib/offlineQueue";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  CreditCard,
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appUser = useAuthStore((s) => s.appUser);
  const hasConsolePermission = useAuthStore((s) => s.hasConsolePermission);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const visibleNav = ADMIN_NAV.filter((item) => {
    if (item.consolePermission === null) return true;
    const required = Array.isArray(item.consolePermission)
      ? item.consolePermission
      : [item.consolePermission];
    return required.some((p) => hasConsolePermission(p));
  });

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // Task 7: see WoredaShell.tsx's identical call for why -- the query
    // cache is a single shared client (src/router.tsx) and nothing else
    // clears it when a session ends.
    queryClient.clear();
    // Task 7: no wizard exists in the admin console today, but the console
    // shares this browser origin's localStorage with the woreda portal, so
    // this sign-out point is where a leftover woreda-portal draft would
    // otherwise still be readable after an admin signs in. See
    // useFormDraft.ts's own comment.
    clearAllWizardDrafts();
    // Task 12-C: same shared-origin reasoning -- no offline queue is ever
    // written from the admin console, but this is still the point where a
    // leftover woreda-portal queue item would otherwise be readable (and
    // syncable) after an admin signs in on the same browser.
    clearOfflineQueue();
    navigate({ to: "/login" });
  };

  // INSA Phase 3 session management: warn at 20 idle minutes, force
  // sign-out at 25 (src/config/idleTimeout.ts). English-only copy -- the
  // admin console is English by convention.
  useIdleTimeout({
    onTimeout: handleSignOut,
    warningMessage: "You'll be signed out soon due to inactivity",
    staySignedInLabel: "Stay signed in",
    signedOutMessage: "Signed out due to inactivity",
  });

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col bg-slate-800">
        <div className="border-b border-slate-700 px-5 py-5">
          <h2 className="text-base font-semibold text-white">⚙ Platform Admin</h2>
          <p className="mt-1 text-xs text-slate-400">Super Admin Console</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {visibleNav.map((item) => {
              const Icon = ICON_MAP[item.icon] ?? LayoutDashboard;
              const active = currentPath === item.href || currentPath.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white transition ${
                      active ? "bg-slate-600" : "hover:bg-slate-700"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="ml-60 flex w-full flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <h1 className="text-base font-semibold text-slate-900">Super Admin Console</h1>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
                {appUser?.full_name?.[0]?.toUpperCase() ?? "A"}
              </div>
              <span className="text-sm font-medium text-slate-900">
                {appUser?.full_name ?? "Admin"}
              </span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setChangePasswordOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <KeyRound className="h-4 w-4" />
                  Change Password
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-auto p-6"
        >
          {children}
        </motion.main>
      </div>

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  );
}
