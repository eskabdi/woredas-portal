# Harari Woreda Connect

# ወረዳ አስተዳደር ሥርዓት — Woreda Administration ERP

## Foundation Build — Phase 1: Project Scaffold, Auth, Dual Portal, RBAC, Navigation

---

## PROJECT IDENTITY

**Product name:** Woreda Administration ERP (ወረዳ አስተዳደር ሥርዓት)
**Region:** Harari People's National Regional State, Ethiopia
**Model:** Multi-tenant SaaS — each woreda is an isolated tenant
**Purpose:** Digitize resident registration, household management, residence credentials, civil registration (vital events), revenue collection, and reporting for all six Harari woreda administration offices.

---

## TECH STACK

> **Superseded.** This was the Phase 1 scaffold spec and is stale (React 18,
> Vite 5, `react-i18next` and a Workbox PWA plugin were never adopted or were
> since replaced). See [`docs/tech-stack.md`](docs/tech-stack.md) for the
> actual, current stack with real pinned versions.

---

## PORTAL ARCHITECTURE — TWO FULLY SEPARATE PORTALS

### Portal 1: Super Admin Console

- Route prefix: `/admin`
- Language: English
- Users: `super_admin` role only
- Purpose: Platform oversight, tenant management, user management, certificate template management, audit, security
- Branding: dark sidebar (#1e293b slate-800), white content area

### Portal 2: Woreda Administration Operating System (Woreda OS)

- Route prefix: `/woreda`
- Language: Amharic (primary) — all labels, navigation, form fields, status chips must be in Amharic
- Users: All roles except `super_admin`
- Purpose: All operational workflows — resident registry, household management, residence credentials, civil registration, revenue, housing, service delivery
- Branding: deep blue sidebar (#1e3a5f), white content area
- Ethiopian calendar: ALL dates in the Woreda portal use Ethiopian calendar as primary input and display. Gregorian shown as secondary only.

---

## HARARI ADMINISTRATIVE STRUCTURE (TENANT DATA)

Six woreda tenants. Seed these into the database:

| Woreda ID | Woreda Code | Woreda Name (EN) | Woreda Name (AM) | Kebeles        |
| --------- | ----------- | ---------------- | ---------------- | -------------- |
| 1         | AMIR_NUR    | Amir Nur         | አሚር ኑር           | 01, 02, 07     |
| 2         | ABADIR      | Abadir           | አባዲር             | 03, 04, 05, 06 |
| 3         | SHENKOR     | Shenkor          | ሸንኮር             | 08, 09, 10     |
| 4         | ABOKER      | Aboker           | አቦከር             | 11, 12, 13     |
| 5         | JINEALA     | Jineala          | ጂናኤላ             | 14, 15, 16     |
| 6         | HAKIM       | Hakim            | ሃኪም              | 17, 18, 19     |

---

## RBAC — 8 CANONICAL ROLES

> **Superseded.** This was the Phase 1 scaffold spec and is stale — the live
> `src/config/permissions.ts` has grown to include the rental, revenue,
> service-request, and approval-queue permission categories plus an entire
> second permission dimension (`CP.*` console permissions) that this sample
> never had. See the generated, always-current
> [`docs/permissions-matrix.md`](docs/permissions-matrix.md) instead —
> regenerate it with `bun run generate:permissions-doc` after any change to
> `permissions.ts`, and CI fails (`--check`) if it's ever left stale.
>
> Navigation visibility is still driven by `NAV_PERMISSION_MAP`/`ADMIN_NAV` —
> never show/hide nav based on role name directly — see the same generated
> doc for the current nav-to-permission mapping.

---

## SUPABASE DATABASE SCHEMA

> **Superseded.** This was the Phase 1 scaffold spec (9 tables) and is stale
> — the live schema has 42 tables across 7 domains, with materially different
> constraints (e.g. `payment` gained a `service_request_id` FK and a
> mutual-exclusivity check the sample below never had). See
> [`docs/erd.md`](docs/erd.md) for the current, accurate schema and
> relationships. RLS is still enabled on every table, scoped by `woreda_id`
> matching the authenticated user's `app_user.woreda_id`; `super_admin`
> bypasses via explicit `is_super_admin()` checks in each policy, not a
> blanket RLS bypass.

---

## DESIGN SYSTEM — VISUAL TOKENS

### Color Palette

```typescript
// Woreda OS Portal
const woredaTokens = {
  sidebarBg: "#1e3a5f", // deep navy blue
  sidebarText: "#e2e8f0", // slate-200
  sidebarActive: "#3b82f6", // blue-500
  primaryAction: "#1d4ed8", // blue-700
  background: "#f8fafc", // slate-50
  cardBg: "#ffffff",
  border: "#e2e8f0", // slate-200
  textPrimary: "#0f172a", // slate-900
  textSecondary: "#64748b", // slate-500
};

// Status chips
const statusColors = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-600",
  revoked: "bg-red-200 text-red-900",
  draft: "bg-slate-100 text-slate-600",
  printed: "bg-purple-100 text-purple-800",
};
```

### Typography

- Use `Noto Sans Ethiopic` (Google Fonts) for Amharic text
- Use `Inter` (Google Fonts) for English/numeric text
- Apply `font-noto-ethiopic` class to all Amharic content
- Line height: 1.6 minimum for Amharic text

---

## ROUTING ARCHITECTURE

```
/                          → redirect based on role
/login                     → shared login page

/admin                     → Super Admin Console shell
/admin/dashboard           → platform overview
/admin/tenants             → woreda tenant list
/admin/tenants/:id         → tenant detail
/admin/users               → platform user management
/admin/audit               → platform audit logs
/admin/settings            → platform settings

/woreda                    → Woreda OS shell (tenant-scoped)
/woreda/dashboard          → operational dashboard
/woreda/residents          → resident registry list
/woreda/residents/new      → new resident form
/woreda/residents/:id      → resident profile
/woreda/households         → household registry list
/woreda/households/new     → new household form
/woreda/households/:id     → household detail
/woreda/credentials        → residence credentials list
/woreda/credentials/new    → new credential request
/woreda/credentials/:id    → credential detail
/woreda/civil              → civil registration (vital events)
/woreda/revenue            → revenue & receipts
/woreda/reports            → reports & analytics
/woreda/settings           → woreda settings
/woreda/audit              → woreda audit trail
```

---

## PHASE 1 DELIVERABLES — BUILD THESE NOW

### 1. Login Page (`/login`)

A clean, government-grade login screen:

- White centered card on a slate-50 background
- Header: "ወረዳ አስተዳደር ሥርዓት" (large, Amharic, Noto Sans Ethiopic font)
- Subtitle: "Woreda Administration ERP — Harari Region" (English, smaller)
- Form: Email + Password fields with React Hook Form + Zod validation
- Submit button: "ግባ / Sign In" (Amharic + English)
- Show current Ethiopian date in top right (format: e.g. "11 ሰኔ 2016")
- On login success: redirect `super_admin` → `/admin/dashboard`, all others → `/woreda/dashboard`
- On error: show clear error message below the form
- Use Supabase Auth (`signInWithPassword`)

### 2. Auth State (Zustand)

Create `src/stores/authStore.ts`:

```typescript
interface AuthState {
  user: SupabaseUser | null;
  appUser: AppUser | null; // from app_user table
  role: Role | null;
  woredaId: string | null;
  permissions: Permission[];
  isLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
  setUser: (user: SupabaseUser | null, appUser: AppUser | null) => void;
  signOut: () => void;
}
```

`hasPermission` checks against `ROLE_PERMISSIONS[role]`.

### 3. Super Admin Console Shell (`/admin/*`)

- Left sidebar: 240px, `bg-slate-800` background
- Logo area: "⚙ Platform Admin" in white, top of sidebar
- Navigation items with Lucide icons:
  - Dashboard (LayoutDashboard)
  - Tenants (Building2)
  - Users (Users)
  - Audit Logs (ScrollText)
  - Settings (Settings)
- Top bar: 64px height, white, shows "Super Admin Console" + user menu
- Content area: renders child routes
- Protected: redirect to `/login` if not `super_admin`

### 4. Woreda OS Shell (`/woreda/*`)

- Left sidebar: 256px, `bg-[#1e3a5f]` background
- Logo area: "ወረዳ አስተዳደር" (Amharic, white, Noto Sans Ethiopic) — top of sidebar
- Below logo: current woreda name from `authStore.appUser.woredaId`
- Navigation items (Amharic labels, Lucide icons), visible based on `NAV_PERMISSION_MAP`:

```typescript
export const NAV_PERMISSION_MAP = [
  {
    labelAm: "ዳሽቦርድ",
    labelEn: "Dashboard",
    icon: "LayoutDashboard",
    href: "/woreda/dashboard",
    permission: null,
  }, // always visible
  {
    labelAm: "ነዋሪዎች",
    labelEn: "Residents",
    icon: "Users",
    href: "/woreda/residents",
    permission: P.RESIDENT_READ,
  },
  {
    labelAm: "ቤተሰቦች",
    labelEn: "Households",
    icon: "Home",
    href: "/woreda/households",
    permission: P.HOUSEHOLD_READ,
  },
  {
    labelAm: "የነዋሪ መታወቂያ",
    labelEn: "Credentials",
    icon: "CreditCard",
    href: "/woreda/credentials",
    permission: P.CREDENTIAL_READ,
  },
  {
    labelAm: "የፍትሐ ብሔር ምዝገባ",
    labelEn: "Civil Registration",
    icon: "FileText",
    href: "/woreda/civil",
    permission: P.CIVIL_READ,
  },
  {
    labelAm: "ገቢ",
    labelEn: "Revenue",
    icon: "Banknote",
    href: "/woreda/revenue",
    permission: P.PAYMENT_READ,
  },
  {
    labelAm: "ሪፖርቶች",
    labelEn: "Reports",
    icon: "BarChart3",
    href: "/woreda/reports",
    permission: P.REPORT_VIEW,
  },
  {
    labelAm: "ኦዲት",
    labelEn: "Audit Trail",
    icon: "ScrollText",
    href: "/woreda/audit",
    permission: P.AUDIT_VIEW,
  },
  {
    labelAm: "ቅንብሮች",
    labelEn: "Settings",
    icon: "Settings",
    href: "/woreda/settings",
    permission: P.TENANT_MANAGE,
  },
];
```

- Top bar: 64px, white
  - Left: current page title in Amharic
  - Center: current Ethiopian date display (format: "ዕለት MM DD YYYY")
  - Right: notification bell + user profile menu with name + role chip + sign out
- Sidebar has active state highlight in `#3b82f6`
- Protected: redirect to `/login` if not authenticated; redirect to `/admin` if `super_admin`

### 5. Woreda OS Dashboard (`/woreda/dashboard`)

Operational summary dashboard with Amharic labels:

**KPI row** (4 cards):

- ጠቅላላ ነዋሪዎች | Total Residents (count from `resident` where `woreda_id = current`)
- ንቁ ቤተሰቦች | Active Households
- የዛሬ አዲስ ምዝገባዎች | New Registrations Today
- በጥበቃ ላይ ያሉ | Pending Approvals

**Second row** (3 cards):

- የተሰጡ ምስክር ወረቀቶች | Credentials Issued (this month)
- ዕለታዊ ገቢ | Revenue Today (sum of payments today)
- ወቅቱ ያለፋቸው ምስክር ወረቀቶች | Expired Credentials (count)

**Charts row** (2 charts):

- Recharts BarChart: Monthly resident registrations (last 6 months) — label: "ወርሃዊ ምዝገባ"
- Recharts LineChart: Daily revenue last 30 days — label: "ዕለታዊ ገቢ"

**Recent Activity table**:

- Last 10 audit log entries for this woreda
- Columns: ጊዜ (Time), ተጠቃሚ (User), ድርጊት (Action), አካል (Entity)

All data via TanStack Query with proper `woreda_id` scoping. Show skeleton loading states while fetching.

### 6. Super Admin Dashboard (`/admin/dashboard`)

Platform-level KPIs:

- Total Tenants (woreda count)
- Total Users across all tenants
- Total Residents across all tenants
- Total Credentials issued today

Recharts BarChart: Credentials issued per woreda (grouped bar)
Recent tenants table with status chips

### 7. Ethiopian Calendar Utility

Create `src/utils/ethiopianCalendar.ts`:

```typescript
// Ethiopian calendar uses Ge'ez 13-month system
// Months: መስከረም, ጥቅምት, ኅዳር, ታኅሣሥ, ጥር, የካቲት, መጋቢት, ሚያዝያ, ግንቦት, ሰኔ, ሐምሌ, ነሐሴ, ጳጉሜ

export const ETHIOPIAN_MONTHS_AM = [
  "መስከረም",
  "ጥቅምት",
  "ኅዳር",
  "ታኅሣሥ",
  "ጥር",
  "የካቲት",
  "መጋቢት",
  "ሚያዝያ",
  "ግንቦት",
  "ሰኔ",
  "ሐምሌ",
  "ነሐሴ",
  "ጳጉሜ",
];

// Conversion functions:
export function gregorianToEthiopian(date: Date): { year: number; month: number; day: number };
export function ethiopianToGregorian(year: number, month: number, day: number): Date;
export function formatEthiopianDate(date: Date, includeMonth?: boolean): string;
// Returns e.g.: "12 ሕዳር 2016"
```

Implement the actual conversion algorithm (Ethiopian calendar offset from Gregorian is ~7–8 years depending on month; Ethiopian New Year is ~September 11 Gregorian).

---

## FILE STRUCTURE

```
src/
  components/
    layout/
      AdminShell.tsx
      WorkedaShell.tsx
      Sidebar.tsx
      TopBar.tsx
    ui/           (shadcn/ui components — auto-generated)
    common/
      StatusChip.tsx
      EthiopianDateDisplay.tsx
      PermissionGate.tsx
      KpiCard.tsx
      LoadingSkeleton.tsx
  pages/
    LoginPage.tsx
    admin/
      AdminDashboard.tsx
      TenantsPage.tsx
      UsersPage.tsx
      AuditPage.tsx
    woreda/
      WorkedaDashboard.tsx
      residents/
        ResidentsListPage.tsx
        ResidentDetailPage.tsx
        NewResidentPage.tsx
      households/
        HouseholdsListPage.tsx
        HouseholdDetailPage.tsx
      credentials/
        CredentialsListPage.tsx
        CredentialDetailPage.tsx
      civil/
        CivilEventsPage.tsx
      revenue/
        RevenuePage.tsx
      reports/
        ReportsPage.tsx
      audit/
        AuditPage.tsx
      settings/
        SettingsPage.tsx
  stores/
    authStore.ts
  hooks/
    useAuth.ts
    useWoredaData.ts
    usePermission.ts
  utils/
    ethiopianCalendar.ts
    permissions.ts
  config/
    permissions.ts   (P constants + ROLE_PERMISSIONS + NAV_PERMISSION_MAP)
    tenants.ts       (Harari woreda seed data)
  integrations/
    supabase/
      client.ts
      types.ts
  i18n/
    am/
      common.json    (Amharic translations)
      navigation.json
    en/
      common.json
  App.tsx
  main.tsx
```

---

## SEED DATA

On first run, seed the database with:

1. Six woreda records (from the table above)
2. 19 kebele records (mapped to correct woredas)
3. One `super_admin` user: email `admin@harari-erp.gov.et`, linked to no woreda
4. One demo `tenant_admin` user per woreda for testing

---

## COMPONENT REQUIREMENTS

### `PermissionGate.tsx`

```typescript
interface PermissionGateProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}
// Renders children only if hasPermission(permission) === true
// Otherwise renders fallback (default: null)
```

### `StatusChip.tsx`

```typescript
interface StatusChipProps {
  status: string;
  labelAm?: string; // Amharic label override
  labelEn?: string; // English label override
}
// Uses statusColors mapping above
// Shows "AM / EN" dual label if both provided
```

### `EthiopianDateDisplay.tsx`

```typescript
interface EthiopianDateDisplayProps {
  gregorianDate: Date | string;
  showGregorian?: boolean; // default true (secondary)
  className?: string;
}
// Primary: Ethiopian date in Noto Sans Ethiopic
// Secondary (lighter): Gregorian in parentheses
```

### `KpiCard.tsx`

```typescript
interface KpiCardProps {
  titleAm: string; // Amharic title
  titleEn: string; // English subtitle
  value: number | string;
  icon: LucideIcon;
  trend?: { value: number; direction: "up" | "down" };
  isLoading?: boolean;
}
```

---

## CRITICAL RULES

1. Every database query in the Woreda OS must include a `woreda_id` filter matching the authenticated user's woreda. Never allow cross-tenant data access.
2. The `audit_log` table is insert-only. Never update or delete audit records.
3. Navigation items in the Woreda OS sidebar are rendered exclusively from `NAV_PERMISSION_MAP` + `hasPermission()`. Never hardcode role checks in nav rendering.
4. All dates in the Woreda OS are displayed in Ethiopian calendar format first, Gregorian second.
5. Do not invent routes, pages, or components not listed above for Phase 1. Build exactly what is specified.
6. TypeScript must compile with zero errors. No `any` types. Use Zod schemas for all form validation.
7. Supabase RLS must be enabled on all tables.
8. Import Noto Sans Ethiopic from Google Fonts in `index.html`.

---

Build this foundation completely and correctly. This is Phase 1 of a multi-phase ERP. Subsequent phases will add full CRUD pages, print workflows, QR credentials, civil registration, and revenue modules on top of this foundation.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
