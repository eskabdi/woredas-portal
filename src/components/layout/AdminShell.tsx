import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  CreditCard,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { ADMIN_NAV } from "@/config/permissions";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  CreditCard,
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const appUser = useAuthStore((s) => s.appUser);
  const hasConsolePermission = useAuthStore((s) => s.hasConsolePermission);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleNav = ADMIN_NAV.filter((item) => {
    if (item.consolePermission === null) return true;
    const required = Array.isArray(item.consolePermission)
      ? item.consolePermission
      : [item.consolePermission];
    return required.some((p) => hasConsolePermission(p));
  });

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

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
    </div>
  );
}
