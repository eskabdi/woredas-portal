# UX Restructure Plan — Cluster-by-Cluster

One restructuring spec per cluster (`ux_pattern_map.md`), not per individual screen — a 55-screen
per-screen plan would repeat each cluster's fix up to 16 times for no added information. Component names
here are used verbatim in `ux_implementation_roadmap.md`'s phases; keep them in sync if either file
changes.

## New shared shell: `AppShell` (replaces `WoredaShell` + `AdminShell`)

**Layout changes**: one component renders the header bar + sidebar for both portals, parameterized by
portal (`woreda` | `admin`) for the differences that are genuinely different (bilingual vs. English-only
labels, date pill + notification bell present only in the woreda portal, nav source
`NAV_PERMISSION_MAP` vs `ADMIN_NAV`). Built on the existing, currently-unused shadcn `sidebar.tsx`
primitive (`src/components/ui/sidebar.tsx`) instead of the two hand-rolled `<aside>` implementations.
Sidebar nav gains the design spec's grouped/accordion structure (Dashboard; Core Operations; Credential
Management; Kebele Rental Houses; Verification & Approval Queues; Revenue; Administration; Settings)
instead of today's single flat list — this also fixes the audit's "no grouping" clarity gap.

**Typography changes**: header title, sidebar nav labels → `.font-am-heading` (Tayitu) for the woreda
portal; unchanged (system font) for the admin portal per the English-only convention.

**Component changes**: replaces `src/components/layout/WoredaShell.tsx` and
`src/components/layout/AdminShell.tsx` with one `src/components/layout/AppShell.tsx`. The header bar
adopts the design spec's dark navy (`#0B192C`) with the OKLCH token system (fixing the audit's hardcoded
`#1e3a5f` finding) rather than a new hardcoded value — extend `src/styles.css`'s existing `:root`/`.dark`
token blocks with the spec's palette (`headerBackground`, `sidebarBackground`, `brandPrimary`,
`accentGold`, etc. from the extracted design-system tokens) instead of inlining hex values anywhere.

**Navigation/transition changes**: active nav item becomes the spec's rounded pill in System Blue
(`brandPrimary`) rather than today's less-defined active state; category groups get a collapse/expand
transition (reuse the shadcn `Collapsible` primitive already present in `src/components/ui/`).

**Code areas touched**: `src/components/layout/`, `src/routes/woreda.tsx` and `src/routes/admin.tsx`
(only to swap which shell they render — their auth-guard/redirect logic stays untouched, see the risk
note in `ux_implementation_roadmap.md`), `src/config/permissions.ts` (nav config gains a `group` field).

## Cluster A — List / Filter / Export → new shared `TableToolbar` component

**Layout changes**: one floating, translucent toolbar (`bg-white/80 backdrop-blur-md rounded-2xl border
border-slate-200/80 shadow-sm`, per the design spec §3.A) replaces the per-route boxed-pill markup.
Search, filter dropdowns, clear-filters, and export buttons become one cohesive row/wrap instead of a
bordered card with an internal divider.

**Typography changes**: column headers → `.font-am-heading`; cell content, filter labels, empty/error
state captions → `.font-am-body`.

**Component changes**: promotes the currently-duplicated markup into a real
`src/components/common/TableToolbar.tsx` visual component (the file already exists as a hooks/utilities
module — this adds the missing rendered component alongside the existing hooks, rather than creating a
second file). `TableSkeletonRows`/`TableEmptyRow`/`TableErrorRow` get the typography pass only, no
structural change. Status badges get the spec's "vibrant translucent" treatment
(`bg-emerald-500/10 text-emerald-700`-style) instead of today's solid-fill badges.

**Code areas touched**: `src/components/common/TableToolbar.tsx`, `src/components/common/TableStates.tsx`,
and every Cluster A route file listed in `ux_screen_inventory.md` (each swaps its inline toolbar JSX for
`<TableToolbar ... />`).

## Cluster B — Multi-step Forms → new shared `Stepper` component + input token pass

**Layout changes**: replace both the resident wizard's circle-and-line `StepIndicator` and the admin
tenant-provisioning wizard's separate stepper with one `Stepper` component using the design spec's
segmented pill progress bar (a single horizontal bar with N segments, active segment highlighted,
percentage-complete readable at a glance) rather than discrete circles.

**Typography changes**: step names/section headers → `.font-am-heading`; field labels, hints, validation
messages → `.font-am-body`.

**Component changes**: new `src/components/forms/Stepper.tsx` used by both
`ResidentWizardSteps.tsx` (renamed usage, not necessarily a renamed file, to minimize blast radius) and
the admin provisioning wizard. Input styling token pass applied to the shared shadcn `Input`/`Select`
base components (`src/components/ui/input.tsx`, `select.tsx`) — `bg-slate-50/80 border-slate-200
focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 rounded-xl px-3.5 py-2.5` per
the spec — so every form in the app inherits it without per-form changes. Photo/document uploads (resident
photo, occupant documents, civil event supporting docs) become 128×128px squircle upload boxes
(`rounded-3xl border-2 border-dashed`) via one new `src/components/forms/SquircleUpload.tsx`.

**Code areas touched**: `src/components/forms/`, `src/components/ui/input.tsx`, `src/components/ui/select.tsx`, `src/routes/admin.tenants.$woredaId.provision.tsx`.

## Cluster C — Detail / Profile screens → new `DetailHeader` + `WorkflowStepper` components

**Layout changes**: one `DetailHeader` (photo/avatar, bilingual title block, status chip, permission-gated
action button row) replaces ~8 independently hand-rolled header implementations. The four workflow-style
detail screens (Credential, Civil Event, Service Request, Rental Request) gain one shared
`WorkflowStepper`/timeline component showing the current stage persistently (addressing the audit's Depth
gap — "where am I in this process" becomes visible at a glance, not something the user reads badge text
to infer).

**Typography changes**: screen title/section card headers → `.font-am-heading`; body content, table
cells inside detail views → `.font-am-body`.

**Component changes**: new `src/components/common/DetailHeader.tsx` and
`src/components/common/WorkflowStepper.tsx`.

**Code areas touched**: `src/components/common/`, and each Cluster C route file in
`ux_screen_inventory.md` (swaps its hand-rolled header/stepper markup for the shared components).

## Cluster D — Printable Documents → typography pass only

**Layout changes**: none — `PrintDocumentShell` and its `Doc*` primitives already match the design spec's
letterhead intent (see `ux_audit_findings.md` Cluster D, scored highest of all clusters). Verify only that
the dark-header-row/seal/QR pattern (spec §3.C) is applied consistently across all print document types,
filling any gap found (e.g. a document type using a placeholder instead of a real stamp image) rather than
redesigning the shell.

**Typography changes**: `DocSection` titles → `.font-am-heading`; `DocField` labels, `DocDataTable`
content, body paragraphs → `.font-am-body`, **pending the Cluster D print-size verification** in
`ux_amharic_typography_plan.md` §5 — if Jiret doesn't hold up at the current 9.5px micro-label size, bump
that specific size token rather than reverting the whole cluster to Noto Sans Ethiopic.

**Code areas touched**: `src/components/print/PrintDocumentShell.tsx` only (typography classes, no
structural JSX changes).

## Cluster E — Dashboards / Analytics → new shared `charts/` module

**Layout changes**: KPI/summary cards adopt the design spec's Dark Accent Container treatment
(`bg-[#0F2038] text-white rounded-2xl shadow-lg`) where they function as a "quick actions"/summary panel,
consistent with the flat-card treatment elsewhere for plain data display — this distinction (accent
container for actions/summary, plain card for data) is the concrete rule that resolves the audit's
"missing dark accent treatment" finding without turning every card dark.

**Typography changes**: KPI card titles, chart titles → `.font-am-heading`; axis labels, legends, data
labels → `.font-am-body`.

**Component changes**: new `src/components/charts/` module with pre-themed bar/pie/donut presets (using
the design spec's palette tokens, once added to `styles.css`) that `woreda.dashboard.tsx`,
`woreda.reports.index.tsx`, and `admin.dashboard.tsx` import instead of each defining Recharts config
inline.

**Code areas touched**: new `src/components/charts/`, and the three dashboard/report route files
(replace inline chart JSX with the shared presets).
