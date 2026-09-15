import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useState } from "react";
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
  KeyRound,
  ShieldCheck,
  Building2,
  ChevronDown,
  type LucideIcon,
  MailQuestion,
  MessageSquareWarning,
  Inbox,
  UserCog,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { NAV_PERMISSION_MAP, ADMIN_NAV, type NavItem } from "@/config/permissions";
import { NAV_GROUP_LABEL, groupNavItems, type NavGroupKey } from "@/config/navGroups";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentEthiopianDate } from "@/utils/ethiopianCalendar";
import { useWoredaInfo } from "@/hooks/useWoredaInfo";
import { useWoredaLogo } from "@/hooks/useWoredaLogo";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { clearAllWizardDrafts } from "@/hooks/useFormDraft";
import { clearOfflineQueue } from "@/lib/offlineQueue";
import { OfflineStatusBar } from "@/components/common/OfflineStatusBar";
import { ChangePasswordDialog } from "@/components/common/ChangePasswordDialog";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
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
      className="block rounded-md px-2 py-3 transition hover:bg-slate-200/60"
    >
      <div className="flex items-center justify-center gap-3">
        {logoUrl && (
          <img
            src={logoUrl}
            alt={`${titleEn} logo`}
            className="h-11 w-11 shrink-0 rounded-full bg-slate-100 object-contain"
          />
        )}
        <div className="min-w-0 text-center">
          <h2 className="font-am-heading text-xl font-bold leading-snug text-slate-900 [text-wrap:balance]">
            {titleAm}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{titleEn}</p>
        </div>
      </div>
    </Link>
  );
}

/** Groups rendered as an expandable accordion in the sidebar (master_design_system.md
 * §2.B "Nested Accordion Categories") -- everything else renders as a flat list. */
const ACCORDION_GROUPS: NavGroupKey[] = ["credentials", "rental", "queues", "settings"];

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
      className={`relative flex items-center gap-3 rounded-full px-3 py-2.5 text-sm transition-colors ${
        active ? "text-white" : "text-slate-600 hover:bg-slate-200/60"
      }`}
    >
      {active && (
        <motion.span
          layoutId="woreda-nav-active-pill"
          className="absolute inset-0 rounded-full bg-[#1D5BD8] shadow-sm"
          transition={{ type: "spring", bounce: 0, duration: 0.35 }}
        />
      )}
      <Icon className="relative z-10 h-4 w-4 shrink-0" />
      <span className="relative z-10 flex-1">
        <span
          className={`font-am-heading block leading-tight ${
            active ? "text-[16px] font-bold text-white" : "font-semibold text-slate-800"
          }`}
        >
          {item.labelAm}
        </span>
        <span
          className={`block text-[10px] uppercase tracking-wide ${active ? "text-white/80" : "text-slate-400"}`}
        >
          {item.labelEn}
        </span>
      </span>
    </Link>
  );
}

/** Indented sub-item inside an accordion group -- same active/inactive convention
 * as NavLink, one size down, with a bullet standing in for the group's icon. */
function NavSubLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.href}
      className={`flex items-center gap-2.5 rounded-full py-2 pr-3 pl-9 text-sm transition-colors ${
        active ? "bg-[#1D5BD8] text-white shadow-sm" : "text-slate-600 hover:bg-slate-200/60"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-white" : "bg-slate-400"}`}
      />
      <span className="flex-1">
        <span
          className={`font-am-heading block text-[13px] leading-tight ${active ? "font-bold text-white" : "font-semibold text-slate-800"}`}
        >
          {item.labelAm}
        </span>
        <span
          className={`block text-[10px] uppercase tracking-wide ${active ? "text-white/80" : "text-slate-400"}`}
        >
          {item.labelEn}
        </span>
      </span>
    </Link>
  );
}

/** One expandable sidebar category (master_design_system.md §2.B). Defaults open
 * so every sub-item is visible without an extra click, matching the reference. */
function NavAccordionGroup({
  groupKey,
  items,
  currentPath,
}: {
  groupKey: NavGroupKey;
  items: NavItem[];
  currentPath: string;
}) {
  const [open, setOpen] = useState(true);
  const label = NAV_GROUP_LABEL[groupKey];
  const groupActive = items.some(
    (item) => currentPath === item.href || currentPath.startsWith(item.href + "/"),
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm transition-colors ${
            groupActive ? "text-slate-900" : "text-slate-600 hover:bg-slate-200/60"
          }`}
        >
          <span className="flex-1">
            <span className="font-am-heading block text-[11px] leading-tight font-bold tracking-wide text-slate-500 uppercase">
              {label.am}
            </span>
            <span className="block text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
              {label.en}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 pt-0.5">
        {items.map((item) => {
          const active = currentPath === item.href || currentPath.startsWith(item.href + "/");
          return <NavSubLink key={item.href} item={item} active={active} />;
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

function UserMenu({
  name,
  roleLabel,
  onSignOut,
  onChangePassword,
  changePasswordLabel = "Change Password",
  dark,
}: {
  name: string;
  roleLabel?: string;
  onSignOut: () => void;
  onChangePassword?: () => void;
  changePasswordLabel?: React.ReactNode;
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
        {onChangePassword && (
          <DropdownMenuItem onClick={onChangePassword}>
            <KeyRound className="mr-2 h-4 w-4" />
            {changePasswordLabel}
          </DropdownMenuItem>
        )}
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
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const appUser = useAuthStore((s) => s.appUser);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { data: woreda } = useWoredaInfo();
  const { data: logoUrl } = useWoredaLogo();
  const { data: enabledModules } = useTenantModules();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const visibleNav = NAV_PERMISSION_MAP.filter((item) => {
    if (item.permission !== null && !hasPermission(item.permission)) return false;
    if (item.moduleKey && enabledModules && !enabledModules.has(item.moduleKey)) return false;
    return true;
  });
  const groups = groupNavItems(visibleNav);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // Task 7: TanStack Query's cache is a single module-level client shared
    // across the whole app -- nothing clears it on its own when a session
    // ends, so a resident/household/report query cached under the outgoing
    // tenant's data could otherwise flash stale (wrong-tenant) content the
    // instant the next person signs in on the same tab.
    queryClient.clear();
    // Task 7: a half-typed wizard draft is localStorage, not session state.
    clearAllWizardDrafts();
    // Task 12-C: a queued offline submission would otherwise sync under the
    // NEXT person's identity the moment they reconnect on the same browser.
    clearOfflineQueue();
    navigate({ to: "/login" });
  };

  // INSA Phase 3 session management: warn at 20 idle minutes, force
  // sign-out at 25 (src/config/idleTimeout.ts).
  useIdleTimeout({
    onTimeout: handleSignOut,
    warningMessage: "እንቅስቃሴ ስለሌለ በቅርቡ ከስርዓቱ ይወጣሉ / You'll be signed out soon due to inactivity",
    staySignedInLabel: "ልቀጥል / Stay signed in",
    signedOutMessage: "እንቅስቃሴ ስለሌለ ከስርዓቱ ወጥተዋል / Signed out due to inactivity",
  });

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="border-r border-slate-200/80 [--sidebar-width:16rem] [&_[data-sidebar=sidebar]]:bg-[#F8FAFC]"
      >
        <SidebarHeader className="border-b border-slate-200/80 px-2 py-2">
          <SidebarBrand
            titleAm={woreda?.display_name_am ?? "—"}
            titleEn={woreda?.woreda_name_en ?? ""}
            logoUrl={logoUrl}
            href="/woreda/settings"
          />
        </SidebarHeader>
        <SidebarContent className="px-2">
          {groups.map(({ key, items }) =>
            ACCORDION_GROUPS.includes(key) ? (
              <SidebarGroup key={key} className="py-1">
                <NavAccordionGroup groupKey={key} items={items} currentPath={currentPath} />
              </SidebarGroup>
            ) : (
              <SidebarGroup key={key} className="py-1">
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
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
            ),
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-slate-200/80 px-5 py-3 text-xs text-slate-400">
          Harari Regional State
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-2 bg-[#0B192C]/95 px-4 text-white shadow-md backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="text-white hover:bg-white/10 hover:text-white" />
            <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-400 bg-[#11233B] sm:flex">
              <img
                src="/images/harari-seal.png"
                alt="Harari Regional State seal"
                className="h-6 w-6 object-contain"
              />
            </div>
            <div className="min-w-0">
              <h1 className="font-am-heading truncate text-sm font-bold text-amber-300 sm:text-base">
                {woreda?.display_name_am ?? "የወረዳ አስተዳደር"}
              </h1>
              <p className="truncate text-[11px] font-medium text-slate-300">
                {woreda?.woreda_name_en ?? "Woreda"} Administration Portal
              </p>
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-2 rounded-full border border-[#23436B]/60 bg-[#172D4A] px-4 py-1.5 text-xs font-semibold lg:flex">
            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
              {new Date()
                .toLocaleDateString("en-US", { month: "short", day: "numeric" })
                .toUpperCase()}
            </span>
            <span className="font-am-body">{getCurrentEthiopianDate()}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              className="rounded-full p-2 text-amber-400 hover:bg-white/10"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
            </button>
            <div className="hidden h-6 w-px bg-slate-700/80 sm:block" />
            <UserMenu
              name={appUser?.full_name ?? "User"}
              roleLabel={ROLE_LABEL_AM[appUser?.role ?? ""] ?? appUser?.role}
              onSignOut={handleSignOut}
              onChangePassword={() => setChangePasswordOpen(true)}
              changePasswordLabel={
                <>
                  <span className="font-am-body">የይለፍ ቃል ቀይር</span>
                  <span className="ml-1 text-xs opacity-70">/ Change Password</span>
                </>
              }
              dark
            />
          </div>
        </header>

        <OfflineStatusBar />

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
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </SidebarProvider>
  );
}

function AdminAppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appUser = useAuthStore((s) => s.appUser);
  const hasConsolePermission = useAuthStore((s) => s.hasConsolePermission);
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
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
    // Task 7: same shared-query-client reasoning as the woreda shell.
    queryClient.clear();
    // Task 7/12-C: the admin console shares this browser origin's
    // localStorage with the woreda portal -- these clear any leftover
    // woreda-portal draft/queue data that would otherwise still be
    // readable (and syncable) after an admin signs in on the same browser,
    // even though the admin console itself never writes either.
    clearAllWizardDrafts();
    clearOfflineQueue();
    navigate({ to: "/login" });
  };

  // INSA Phase 3 session management: warn at 20 idle minutes, force
  // sign-out at 25. English-only copy -- the admin console is English by
  // convention.
  useIdleTimeout({
    onTimeout: handleSignOut,
    warningMessage: "You'll be signed out soon due to inactivity",
    staySignedInLabel: "Stay signed in",
    signedOutMessage: "Signed out due to inactivity",
  });

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
          <UserMenu
            name={appUser?.full_name ?? "Admin"}
            onSignOut={handleSignOut}
            onChangePassword={() => setChangePasswordOpen(true)}
            dark
          />
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
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </SidebarProvider>
  );
}
