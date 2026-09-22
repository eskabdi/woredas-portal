/**
 * Nav grouping for the woreda portal sidebar, per the design system's §2.B
 * accordion categories and docs/ux/ux_restructure_plan.md's AppShell spec.
 * Grouping lives here (not inline in AppShell) so it stays next to the
 * NavItem data it groups, in config/permissions.ts.
 */
import type { NavItem } from "@/config/permissions";

export type NavGroupKey =
  | "top" // Dashboard -- ungrouped, always first
  | "core"
  | "credentials"
  | "rental"
  | "queues"
  | "revenue"
  | "administration"
  | "settings";

export const NAV_GROUP_LABEL: Record<NavGroupKey, { am: string; en: string }> = {
  top: { am: "", en: "" },
  core: { am: "ዋና ስራዎች", en: "Core Operations" },
  credentials: { am: "የመታወቂያ አስተዳደር", en: "Credential Management" },
  rental: { am: "የቀበሌ የኪራይ ቤቶች", en: "Kebele Rental Houses" },
  queues: { am: "ማረጋገጫ እና ማጽደቅ", en: "Verification & Approval" },
  revenue: { am: "ገቢ", en: "Revenue" },
  administration: { am: "አስተዳደር", en: "Administration" },
  settings: { am: "ቅንብሮች", en: "Settings" },
};

const HREF_TO_GROUP: Record<string, NavGroupKey> = {
  "/woreda/dashboard": "top",
  "/woreda/residents": "core",
  "/woreda/households": "core",
  "/woreda/civil": "core",
  "/woreda/services": "core",
  "/woreda/complaints": "core",
  "/woreda/credentials": "credentials",
  "/woreda/credentials/verify": "credentials",
  "/woreda/rental-houses": "rental",
  "/woreda/rental-reports": "rental",
  "/woreda/approvals": "queues",
  "/woreda/revenue": "revenue",
  "/woreda/reports": "administration",
  "/woreda/audit": "administration",
  "/woreda/settings/woreda-configuration": "settings",
  "/woreda/settings/users-permissions": "settings",
};

export function groupOf(item: NavItem): NavGroupKey {
  return HREF_TO_GROUP[item.href] ?? "core";
}

export function groupNavItems(items: NavItem[]): Array<{ key: NavGroupKey; items: NavItem[] }> {
  const order: NavGroupKey[] = [
    "top",
    "core",
    "credentials",
    "rental",
    "queues",
    "revenue",
    "administration",
    "settings",
  ];
  const buckets = new Map<NavGroupKey, NavItem[]>();
  for (const item of items) {
    const g = groupOf(item);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(item);
  }
  return order.filter((g) => buckets.has(g)).map((g) => ({ key: g, items: buckets.get(g)! }));
}
