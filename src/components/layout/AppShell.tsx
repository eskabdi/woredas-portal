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
import { NAV_PERMISSION_MAP, ADMIN_NAV, type NavItem } from "@/config/permissions";
import { NAV_GROUP_LABEL, groupNavItems } from "@/config/navGroups";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentEthiopianDate } from "@/utils/ethiopianCalendar";
import { useWoredaInfo } from "@/hooks/useWoredaInfo";
import { useWoredaLogo } from "@/hooks/useWoredaLogo";
import { useTenantModules } from "@/hooks/useTenantModules";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

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

/**
 * Consolidated shell for both portals (docs/ux/ux_restructure_plan.md,
 * "New shared shell: AppShell"). Replaces the independently hand-rolled
 * WoredaShell/AdminShell -- the two portals differ only in nav source,
 * bilingual vs. English-only labels, and which header widgets show, all
 * handled by the `portal` prop. Auth-guard/redirect logic stays entirely
 * in src/routes/woreda.tsx and src/routes/admin.tsx; this component only
 * renders the chrome those routes wrap their content in.
 */
export function AppShell({
  portal,
  children,
}: {
  portal: "woreda" | "admin";
  children: React.ReactNode;
}) {
  return portal === "woreda" ? (
    <WoredaAppShell>{children}</WoredaAppShell>
  ) : (
    <AdminAppShell>{children}</AdminAppShell>
  );
}

function SidebarBrand({
  titleAm,
  titleEn,
  logoUrl,
  href,
}: {
  titleAm: string;
  titleEn: string;
  logoUrl?: string | null;
  href: string;
}) {
  return (
    <Link
      to={href}
      aria-label="Tenant profile & settings"
      className="block rounded-md px-2 py-3 transition hover:bg-white/5"
    >
      <div className="flex items-center justify-center gap-3">
        {logoUrl && (
          <img
            src={logoUrl}
            alt={`${titleEn} logo`}
            className="h-11 w-11 shrink-0 rounded-full bg-white/10 object-contain"
          />
        )}
        <div className="min-w-0 text-center">
          <h2 className="font-am-heading text-xl font-bold leading-snug text-white [text-wrap:balance]">
            {titleAm}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">{titleEn}</p>
        </div>
      </div>
    </Link>
  );
}

/**
 * The active item's highlight is one motion.div with a shared `layoutId`,
 * so switching sections slides the pill to its new position instead of
 * two nav items independently popping their own backgrounds in/out --
 * the "hint in the direction of the gesture" and spatial-continuity
 * principles from the apple-design skill, applied to a click-driven
 * (not gesture-driven) transition, so a plain critically-damped spring
 * is the right choice rather than momentum/velocity handoff.
 */
function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = ICON_MAP[item.icon] ?? LayoutDashboard;
  return (
    <Link
      to={item.href}
      className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
        active ? "text-white" : "text-slate-300 hover:bg-slate-700/30"
      }`}
    >
      {active && (
        <motion.span
          layoutId="woreda-nav-active-pill"
          className="absolute inset-0 rounded-md bg-[color:var(--color-primary)]"
          transition={{ type: "spring", bounce: 0, duration: 0.35 }}
        />
      )}
      <Icon className="relative z-10 h-4 w-4 shrink-0" />
      <span className="relative z-10 flex-1">
        <span
          className={`font-am-heading block leading-tight ${
            active ? "text-[16px] font-bold" : "font-semibold"
          }`}
        >
          {item.labelAm}
        </span>
        <span className="block text-[10px] uppercase tracking-wide text-slate-400">
          {item.labelEn}
        </span>
      </span>
    </Link>
  );
}

function UserMenu({
  name,
  roleLabel,
  onSignOut,
  dark,
}: {
  name: string;
  roleLabel?: string;
  onSignOut: () => void;
  dark?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-sm transition ${
            dark
              ? "border-slate-700/60 bg-[#172D4A] text-white hover:bg-[#1d3a5c]"
              : "border-slate-200 bg-white hover:bg-slate-50"
          }`}
        >
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              dark ? "bg-[color:var(--color-primary)] text-white" : "bg-blue-100 text-blue-700"
            }`}
          >
            {name[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="text-left leading-none">
            <div className={`text-sm font-medium ${dark ? "text-white" : "text-slate-900"}`}>
              {name}
            </div>
            {roleLabel && (
              <div
                className={`font-am-body mt-0.5 text-[10px] ${dark ? "text-slate-300" : "text-slate-500"}`}
              >
                {roleLabel}
              </div>
            )}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WoredaAppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const appUser = useAuthStore((s) => s.appUser);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { data: woreda } = useWoredaInfo();
  const { data: logoUrl } = useWoredaLogo();
  const { data: enabledModules } = useTenantModules();

  const visibleNav = NAV_PERMISSION_MAP.filter((item) => {
    if (item.permission !== null && !hasPermission(item.permission)) return false;
    if (item.moduleKey && enabledModules && !enabledModules.has(item.moduleKey)) return false;
    return true;
  });
  const groups = groupNavItems(visibleNav);
  const currentItem = visibleNav.find(
    (n) => currentPath === n.href || currentPath.startsWith(n.href + "/"),
  );

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="border-r-0 [--sidebar-width:16rem] [&_[data-sidebar=sidebar]]:bg-[color:var(--color-shell-header)]"
      >
        <SidebarHeader className="border-b border-white/10 px-2 py-2">
          <SidebarBrand
            titleAm={woreda?.display_name_am ?? "—"}
            titleEn={woreda?.woreda_name_en ?? ""}
            logoUrl={logoUrl}
            href="/woreda/settings"
          />
        </SidebarHeader>
        <SidebarContent className="px-1">
          {groups.map(({ key, items }) => (
            <SidebarGroup key={key}>
              {NAV_GROUP_LABEL[key].en && (
                <SidebarGroupLabel className="font-am-heading px-3 text-[10px] uppercase tracking-wide text-slate-400">
                  {NAV_GROUP_LABEL[key].am} / {NAV_GROUP_LABEL[key].en}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active =
                      currentPath === item.href || currentPath.startsWith(item.href + "/");
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild className="h-auto p-0 hover:bg-transparent">
                          <NavLink item={item} active={active} />
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t border-white/10 px-5 py-3 text-xs text-slate-400">
          Harari Regional State
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <div>
              <h1 className="font-am-heading text-base font-semibold text-slate-900">
                {currentItem?.labelAm ?? "ዳሽቦርድ"}
              </h1>
              <p className="text-xs text-slate-400">{currentItem?.labelEn ?? "Dashboard"}</p>
            </div>
          </div>

          <span className="font-am-body rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">
            {getCurrentEthiopianDate()}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 text-[color:var(--color-shell-accent-gold)] hover:bg-slate-100"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
            </button>
            <UserMenu
              name={appUser?.full_name ?? "User"}
              roleLabel={ROLE_LABEL_AM[appUser?.role ?? ""] ?? appUser?.role}
              onSignOut={handleSignOut}
            />
          </div>
        </header>

        <motion.main
          key={currentPath}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-auto bg-[color:var(--color-shell-canvas)] p-6"
        >
          {children}
        </motion.main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AdminAppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const appUser = useAuthStore((s) => s.appUser);
  const hasConsolePermission = useAuthStore((s) => s.hasConsolePermission);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

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
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="border-r-0 [--sidebar-width:15rem] [&_[data-sidebar=sidebar]]:bg-[color:var(--color-shell-header)]"
      >
        <SidebarHeader className="border-b border-white/10 px-4 py-5">
          <h2 className="text-base font-semibold text-white">⚙ Platform Admin</h2>
          <p className="mt-1 text-xs text-slate-400">Super Admin Console</p>
        </SidebarHeader>
        <SidebarContent className="px-1">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNav.map((item) => {
                  const Icon = ICON_MAP[item.icon] ?? LayoutDashboard;
                  const active =
                    currentPath === item.href || currentPath.startsWith(item.href + "/");
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.href} className="text-white hover:text-white">
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h1 className="text-base font-semibold text-slate-900">Super Admin Console</h1>
          </div>
          <UserMenu name={appUser?.full_name ?? "Admin"} onSignOut={handleSignOut} dark />
        </header>
        <motion.main
          key={currentPath}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-auto p-6"
        >
          {children}
        </motion.main>
      </SidebarInset>
    </SidebarProvider>
  );
}
