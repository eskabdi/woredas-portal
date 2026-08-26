import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Home,
  CreditCard,
  FileText,
  Banknote,
  BarChart3,
  ScrollText,
  Settings,
  Bell,
  LogOut,
  ShieldCheck,
  Building2,
  type LucideIcon,
  MailQuestion,
  MessageSquareWarning,
  Inbox,
  UserCog,
} from "lucide-react";
import { useState } from "react";

import { NAV_PERMISSION_MAP } from "@/config/permissions";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentEthiopianDate } from "@/utils/ethiopianCalendar";
import { useWoredaInfo } from "@/hooks/useWoredaInfo";
import { useWoredaLogo } from "@/hooks/useWoredaLogo";
import { useTenantModules } from "@/hooks/useTenantModules";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Home,
  CreditCard,
  FileText,
  Banknote,
  BarChart3,
  ScrollText,
  Settings,
  ShieldCheck,
  Building2,
  MailQuestion,
  MessageSquareWarning,
  Inbox,
  UserCog,
};

const ROLE_LABEL_AM: Record<string, string> = {
  super_admin: "ሱፐር አስተዳዳሪ",
  tenant_admin: "የወረዳ አስተዳዳሪ",
  civil_registrar: "የፍትሐ ብሔር መዝጋቢ",
  registry_clerk: "የመመዝገቢያ ሰራተኛ",
  finance_clerk: "የፋይናንስ ሰራተኛ",
  supervisor: "ተቆጣጣሪ",
  auditor: "ኦዲተር",
  viewer: "ተመልካች",
};

export function WoredaShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const appUser = useAuthStore((s) => s.appUser);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { data: woreda } = useWoredaInfo();
  const { data: logoUrl } = useWoredaLogo();
  const { data: enabledModules } = useTenantModules();
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleNav = NAV_PERMISSION_MAP.filter((item) => {
    if (item.permission !== null && !hasPermission(item.permission)) return false;
    if (item.moduleKey && enabledModules && !enabledModules.has(item.moduleKey)) return false;
    return true;
  });

  const currentItem = visibleNav.find((n) => currentPath.startsWith(n.href));

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className="fixed inset-y-0 left-0 flex w-64 flex-col"
        style={{ backgroundColor: "#1e3a5f" }}
      >
        <Link
          to="/woreda/settings"
          aria-label="Tenant profile & settings"
          className="block border-b border-white/10 px-4 py-5 transition hover:bg-white/5"
        >
          <div className="flex items-center justify-center gap-3">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={`${woreda?.woreda_name_en ?? "Woreda"} logo`}
                className="h-11 w-11 shrink-0 rounded-full bg-white/10 object-contain"
              />
            )}
            <div className="min-w-0 text-center">
              <h2 className="font-noto-ethiopic text-xl font-bold leading-snug text-white [text-wrap:balance]">
                {woreda?.display_name_am ?? "—"}
              </h2>
              <p className="font-noto-ethiopic mt-1 text-sm text-slate-300">አስተዳደር ፖርታል</p>
              <p className="mt-0.5 text-xs text-slate-400">{woreda?.woreda_name_en ?? ""}</p>
            </div>
          </div>
        </Link>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {visibleNav.map((item) => {
              const Icon = ICON_MAP[item.icon] ?? LayoutDashboard;
              const active = currentPath === item.href || currentPath.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition ${
                      active
                        ? "border-l-4 border-blue-300 bg-blue-500 text-white"
                        : "text-slate-300 hover:bg-slate-700/30"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">
                      <span className="font-noto-ethiopic block leading-tight">{item.labelAm}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-slate-400">
                        {item.labelEn}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-400">
          Harari Regional State
        </div>
      </aside>

      {/* Main */}
      <div className="ml-64 flex w-full flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div>
            <h1 className="font-noto-ethiopic text-base font-semibold text-slate-900">
              {currentItem?.labelAm ?? "ዳሽቦርድ"}
            </h1>
            <p className="text-xs text-slate-400">{currentItem?.labelEn ?? "Dashboard"}</p>
          </div>

          <span className="font-noto-ethiopic rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">
            {getCurrentEthiopianDate()}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {appUser?.full_name?.[0]?.toUpperCase() ?? "U"}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-slate-900">
                    {appUser?.full_name ?? "User"}
                  </div>
                  <div className="font-noto-ethiopic text-[10px] text-slate-500">
                    {ROLE_LABEL_AM[appUser?.role ?? ""] ?? appUser?.role}
                  </div>
                </div>
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
          </div>
        </header>

        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-auto bg-slate-50 p-6"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
