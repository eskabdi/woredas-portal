# Technical stack & features inventory

INSA Enforcer Phase 2 catalog. Source of truth is `package.json` (pinned
versions) — this document narrates it; regenerate the version numbers from
there if this page is ever suspected stale, rather than trusting the copy
below indefinitely.

## Development frameworks

| Layer        | Choice                                                                                     | Version             |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------- |
| UI           | React                                                                                      | 19.2.0              |
| Routing/SSR  | TanStack Start (server entry, build) + TanStack Router (file-based routing)                | 1.168.44 / 1.170.27 |
| Server state | TanStack Query                                                                             | 5.83.0              |
| Client state | Zustand                                                                                    | 5.0.14              |
| Forms        | React Hook Form + Zod (`@hookform/resolvers` bridges the two)                              | 7.71.2 / 3.24.2     |
| Styling      | Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Radix UI primitives, `components.json`) | 4.2.1               |
| Build        | Vite                                                                                       | 8.0.16              |
| Language     | TypeScript, strict mode                                                                    | 5.8.3               |
| Backend      | Supabase (Postgres + RLS, Auth, Storage, Edge Functions) via `@supabase/supabase-js`       | 2.108.2             |

## Libraries & plugins (by function, not exhaustive)

| Function                         | Package(s)                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| PDF generation (print pipeline)  | `jspdf`, `html2canvas-pro`, `react-to-print`                                                      |
| PDF viewing (uploaded documents) | `pdfjs-dist`, `react-pdf`                                                                         |
| QR codes                         | `qrcode.react` (render), `html5-qrcode` (scan)                                                    |
| Barcodes                         | `jsbarcode` (Code 128)                                                                            |
| Maps / GIS                       | `leaflet`, `react-leaflet`                                                                        |
| Charts (dashboards, reports)     | `recharts`                                                                                        |
| Transitions / micro-interactions | `framer-motion`                                                                                   |
| Dates                            | `date-fns`                                                                                        |
| Toasts                           | `sonner`                                                                                          |
| Icons                            | `lucide-react`                                                                                    |
| Misc UI primitives               | `cmdk`, `vaul`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels` |

## Dev tooling

ESLint 9 (`typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
`eslint-plugin-prettier`) · Prettier 3.7 · Vitest 4 + `@testing-library/react` /
`jest-dom` / `user-event` + `jsdom` 30 · `nitro` (server preset — build-only,
never pinned in `vite.config.ts`; see CLAUDE.md's Vercel section for why).
Package manager is **bun** (`bun.lock`, `bunfig.toml`); the repo carried a
second, unused `package-lock.json` until it was removed as dependency-scan
drift (see CLAUDE.md's Commands section). `bun audit` is the dependency-
vulnerability check this repo's actual build reflects.

## Third-party integrations: none

Checked directly against the codebase — no payment gateway, no SMS provider,
no external email service beyond Supabase Auth's own GoTrue mailer (invite
and password-recovery emails). The revenue module (`payment`, `receipt`
tables) records payments **internally only**: cash/bank/mobile is a free-text
`channel` field on a payment row, not an integration with an actual payment
processor. The two external services the app actually calls at runtime are:

- **Google Fonts** — `Noto Sans Ethiopic` (Amharic body text and headings
  across the woreda portal, per `src/styles.css:23`) and `Inter` (English/
  numeric text). Declared in `src/lib/security-headers.ts`'s CSP `font-src`.
- **OpenStreetMap tile servers** — the household/rental-house location
  picker (`src/components/gis/LocationPickerMap.tsx`), via `leaflet`.

If a payment gateway, SMS provider, or other third-party API is ever added,
record it in this table and add its origin to the CSP `connect-src` in
`src/lib/security-headers.ts` — a call that isn't in the allow-list fails
silently as a CSP violation, not a clear error.

## Actor types

Eight tenant roles plus platform-level super admin; full permission
boundaries per role are generated from source into
[`docs/permissions-matrix.md`](./permissions-matrix.md) rather than
duplicated here — see that document for the authoritative, always-current
list. In one line: `super_admin` (platform-wide), `tenant_admin` (full
per-woreda control), `civil_registrar`, `registry_clerk`, `finance_clerk`,
`supervisor`, `auditor`, `viewer` (progressively narrower per-woreda
operational roles). A second, independent permission dimension —
`console_role` / `console_role_permission` — scopes what an individual
`super_admin` can do inside `/admin` itself (see
[`docs/erd.md`](./erd.md#tenancy--rbac)).

## Security infrastructure

No dedicated WAF/IDS-IPS/SIEM product sits in front of this app — see
[`docs/architecture.md`](./architecture.md) and
[`docs/security-hardening.md`](./security-hardening.md) for what Vercel and
Supabase provide natively instead (edge DDoS mitigation, managed TLS, an
optional Vercel WAF ruleset) and what's implemented in-repo (`src/lib/security-headers.ts`:
HSTS, CSP, `X-Frame-Options`, `Permissions-Policy`, `nosniff`,
`Referrer-Policy`).

---

**Superseded:** `README.md`'s original "TECH STACK — USE EXACTLY THIS" section
(the Phase 1 scaffold spec) is stale — it lists React 18 (actual: 19.2), Vite 5
(actual: 8), `react-i18next` and a Workbox-based PWA plugin that were never
adopted. This document reflects what actually shipped; treat the README
section as historical intent, not current fact.
