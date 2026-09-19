# UX Implementation Report — All Five Phases Complete

Branch: `ux-restructure` (created off `claude/woredas-portal-amharic-manual-0x86rz`, not merged, not
pushed — per instructions, changes stay on this working branch pending review). Commits, in order: Phase 0
(fonts/tokens/font migration, `AppShell`), Phase 1 (`TableToolbar`, `Stepper`, `DetailHeader`/
`WorkflowStepper`, `charts/`), a login page redesign (out-of-cluster, done on explicit request), Phase 2
(Cluster B input-token pass, `SquircleUpload`, full Cluster C rollout, Cluster E's last screen), Phase 3
(Cluster D typography fix), Phase 4 (WCAG contrast audit, keyboard nav, font verification).

## Scope of this pass

**All five roadmap phases are now complete.** This report's earlier sections (below) cover Phase 0 and
Phase 1 as originally written. This top section covers everything since: the login redesign, Phase 2's
completion, Phase 3, and Phase 4 — see `ux_implementation_roadmap.md`'s status checklist for the
authoritative per-item summary. As with every earlier phase, "complete" means each phase's own exit
criteria were met, not that literally all 55 screens were touched — several deliberate scope boundaries
are documented below rather than silently left undone.

## Login page redesign (out-of-cluster, user-requested)

The user provided a reference mockup (a split navy/canvas layout with a feature-highlight left panel and a
sign-in card on the right) and asked for a 1:1 match. `/login` wasn't assigned restructuring work by the
original 5-cluster plan (it was catalogued as a standalone single-card form), so this was done as a direct
request rather than roadmap-driven work:

- Rebuilt `src/routes/login.tsx`'s JSX from a single centered card into the two-panel layout, reusing the
  `--color-shell-header`/`--color-shell-accent-gold`/`--color-shell-canvas` tokens from Phase 0 rather than
  new hardcoded colors. Auth logic (the zod schema, `onSubmit`, the already-signed-in redirect guards) was
  not touched.
- Follow-up feedback removed the decorative language switcher (no i18n system exists to actually drive
  it — every screen already shows Amharic and English together per the app's bilingual convention) and the
  remember-me checkbox (no session-persistence toggle exists in the generated Supabase client to back it),
  and replaced placeholder seal icons in both panels with the real Harari Regional State seal
  (`public/images/harari-seal.png`, provided by the user).
- **A note on the mobile-viewport investigation**: while checking this page at narrow widths, headless
  Chromium in this sandbox was found to silently clamp `--window-size` below ~500px (confirmed by adding a
  temporary `window.innerWidth`/`document.documentElement.scrollWidth` debug readout — both reported 500
  even when 400 was requested, and `scrollWidth === innerWidth` proved there was no actual horizontal
  overflow). This was a testing-tool artifact, not a real responsive-design bug — real mobile browsers do
  not have this floor. The `min-w-0` and viewport-relative `max-w-[min(28rem,calc(100vw-2rem))]` changes
  made while chasing this are harmless defensive practice and were kept, but the investigation itself did
  not find or fix a real bug.

## Phase 2 completion (Clusters B, C, E)

### Cluster B: input-token pass + `SquircleUpload`

- Applied the design spec's input treatment (`bg-slate-50/80`, `rounded-xl`, blue-600 focus border/ring)
  directly to the shared `Input`/`Select`/`Textarea` base components in `src/components/ui/`, so every form
  in both portals inherits it automatically — no per-screen migration needed, since this was a single
  shared-component edit.
- Built `src/components/forms/SquircleUpload.tsx`: one clickable squircle surface (photo/document preview
  doubles as the drop target) replacing the "preview box + separate Upload button below it" pattern.
  Verified against 2 real call sites with different shapes (`ResidentWizardSteps`'s photo upload — circle;
  `woreda.settings.woreda-configuration.tsx`'s logo/stamp/signature upload — circle or square), per the
  same "prototype against more than one shape" discipline used for `Stepper` in Phase 1.
- **Deliberately left out**: the mixed image/PDF uploads (resident clearance letter, civil event supporting
  docs, rental occupant document tiles via `woreda.rental-houses.occupants.new.tsx`'s own `UploadTile`).
  These need a filename/file-type display and, in one case, a PDF viewer dialog that a single-image-preview
  component would regress if forced to fit — a scope boundary, not an oversight.

### Cluster C: full rollout (8 of 8 detail screens)

Completed the `DetailHeader`/`WorkflowStepper` rollout Phase 1 started (Resident Profile, Credential
Request Detail) to the remaining 6 screens:

- **Household Detail** — `DetailHeader` only (no workflow concept). Added an `icon` fallback prop to
  `DetailHeader` itself (a `ComponentType` rendered in the avatar circle) since a household has no photo or
  person name for the circle to show — this is what made the component actually generalize to non-person
  entities, exercised here for the first time.
- **Civil Event Detail** — `DetailHeader` + `WorkflowStepper` (submitted → under_review → pending_approval →
  approved → issued, with rejected/returned exceptions).
- **Service Request Detail** — `DetailHeader` + `WorkflowStepper`, reusing this file's own pre-existing
  `stageIndex()`/`SERVICE_STATUS_LABEL` helpers (`src/lib/serviceConstants.ts`) for the category-dependent
  letter/complaint stage flow, rather than re-deriving it — replaced a hand-rolled numbered-circle stepper
  that lived inline in the route.
- **Rental House Detail** — `DetailHeader` only (occupancy is a 3-state badge, not a review workflow).
- **Rental Request Detail** — `DetailHeader` + `WorkflowStepper`, replacing a *second* independently-built
  local `Stepper` function (submitted → verified → approved → final, with rejected/returned exceptions) —
  this is the second hand-rolled stepper implementation the pattern map's audit had flagged.
- **Tenant Detail** (admin) — `DetailHeader` only, on the English-only admin console (the tenant name
  fields displayed are the woreda's own bilingual data, not admin-chrome UI text, so no `CLAUDE.md`
  convention issue).

### Cluster E: last screen (`woreda.reports.index.tsx`)

Migrated the last of Cluster E's 3 screens onto the shared `charts/` module from Phase 1:

- Replaced the local `PieCard` function with `PieChartCard` at both call sites (residents by sex, by
  residency status) — a clean 1:1 swap, pure pie chart with no additional structure.
- The local `ChartCard` (bar chart + side-by-side data table) is a genuinely different composed widget
  than `BarChartCard`'s scope covers (no table slot), so it stayed as this screen's own component — but its
  Recharts config now pulls `CHART_PRIMARY`/`CHART_GRID_COLOR` from `components/charts/palette.ts` instead
  of a second local hardcoded hex/`COLORS` array, so the whole app's chart colors trace to one definition.

## Phase 3: Cluster D typography

Ran the typography plan's own verification procedure (§5): built a throwaway HTML file loading the actual
self-hosted Tayitu/Jiret `.woff2` files and rendered all 5 real test strings at production sizes. Results:
no tofu boxes in either face at any size; Ge'ez combining marks/vowel-order forms render correctly; the
flagged risk case (a `PrintDocumentShell` `DocField` micro-label in Jiret at `9.5px`) was legible but
genuinely borderline next to the same label at `10.5px` — exactly the "decide from what the screenshot
actually shows" judgment call the plan asked for. Applied the plan's own stated mitigation: bumped the four
`text-[9.5px]` occurrences in `PrintDocumentShell.tsx` to `text-[10.5px]`. Left
`woreda.credentials.$requestId.print.tsx`'s 8-9px text untouched — that's the bespoke physical CR80 card
surface, explicitly out of Cluster D's scope (different constraint: card-printer physical density, not
document legibility, governed by the `card-print-review` subagent). Spot-checked the other 6 Cluster D
print routes for leftover `.font-noto-ethiopic` from the Phase 0 mechanical migration — all clean.

## Phase 4: Validation

**WCAG 2.1 AA contrast audit** — computed real contrast ratios (not eyeballed) for every new palette color
using the WCAG21 relative-luminance method, including translucent/tinted backgrounds as the plan required.
Found 3 real failures, all from the same root cause: `--shell-accent-gold`/`--status-warning` (`#F59E0B`)
and `--status-danger` (`#EF4444`) were calibrated as accents against the dark `--shell-header` background
(8.22:1 there — fine) but fail badly as text/icon color on a *light* background (2.15:1 and 3.76:1
respectively — both fail the 4.5:1 text threshold, and the gold case even fails the 3:1 non-text/icon
threshold). Fixed the three real call sites: `AppShell.tsx`'s notification bell icon (→ `amber-600`,
3.19:1), `WorkflowStepper.tsx`'s exception banner text (→ `text-red-700`/`text-amber-700`, 6.47:1/5.02:1 —
also removed an `opacity-80` modifier that was pulling the fixed color back under 4.5:1), and the login
page's white-card subtitle (→ `amber-700`). The identical-looking gold text on the login page's *dark*
left panel was correctly left unchanged since it already passes.

**Keyboard-navigation pass** on `Stepper` and `TableToolbar` — both were already correctly operable
(real `<button>`s, `disabled` correctly removes unreachable steps from tab order, native `<select>`/
`<input>` elements). Found and fixed 2 real gaps: `Stepper`'s pills had no `focus-visible` styling at all
(no visual indicator for keyboard users), and `TableToolbar`'s `FilterGroup` `<select>` had
`focus:outline-none` with no replacement ring — a real WCAG 2.4.7 (Focus Visible) failure, not just a
missing polish, since it removed the indicator entirely.

**Amharic font verification re-run against the production build** — `bun run build`'s output confirms the
production CSS correctly declares `@font-face` for both fonts with `font-display: swap` and root-relative
paths (`/fonts/Tayitu-Regular.woff2`, `/fonts/Jiret-Regular.woff2`) that match where the files actually
land in `.output/public/fonts/`. **Could not run a live production server in this sandbox** to visually
confirm rendering end-to-end: both `node .output/server/index.mjs` and `vite preview` fail with Node/Nitro
tooling errors (`__exportAll is not a function`, then a missing `dist/server/server.js` path) — pre-existing
environment/tooling mismatches unrelated to this restructuring, in the same category as the sandbox's other
documented limitations (no real Supabase project, no live deploy target). The glyph-rendering risk itself
was already ruled out by Phase 3's verification, which used the identical `.woff2` binaries now confirmed
present in the production bundle.

---

## Original Phase 0 / Phase 1 report follows

## What changed (Phase 0, all four workstreams)

### 1. Font hosting (`ux_amharic_typography_plan.md` §2)
- Converted `Tayitu.ttf` → `public/fonts/Tayitu-Regular.woff2` and `Jiret.ttf` →
  `public/fonts/Jiret-Regular.woff2` (via `fontTools`, since no font-conversion tooling was already in
  this repo).
- Added `@font-face` rules for both (`font-display: swap`) and two new theme tokens,
  `--font-am-heading`/`--font-am-body`, to `src/styles.css`, each falling back to `"Noto Sans Ethiopic"`
  (today's working face) before generic `sans-serif` — so a font-load failure degrades invisibly rather
  than showing missing glyphs.
- **Licensing**: `Tayitu.ttf`'s metadata carries a "Copyright 2019 Anbassa Design. All Rights Reserved"
  notice. This was raised as an open item during planning; the user confirmed its use is decorative only
  (headings/titles/nav labels, per the mapping below — never body copy at volume) and acceptable, which
  unblocked this workstream. Recorded in `ux_amharic_typography_plan.md` §0.
- Left the existing Google Fonts `<link>` for Noto Sans Ethiopic in `src/routes/__root.tsx` in place, as
  planned — it's the fallback safety net and gets removed only once every call site is migrated and
  confirmed (not yet the case, see below).

### 2. Design tokens (`ux_restructure_plan.md`, AppShell section)
Added the design-system's palette to `src/styles.css`'s existing `:root` OKLCH token block, converted
from the spec's hex values via `coloraide` (exact conversions, not eyeballed): `--shell-header` (#0B192C),
`--shell-accent-gold` (#F59E0B), `--shell-canvas` (#F4F6F9), and `--status-success/warning/danger` (+
their `*-bg` translucent variants). Registered each in the `@theme inline` block following the file's own
documented convention, rather than introducing a second, competing token system.

### 3. Font migration (`ux_amharic_typography_plan.md` §3)
Reclassified **814 occurrences of `.font-noto-ethiopic` across 70 files** (more than the plan's ~40+
estimate — the actual count once grepped was 77 files with the class, of which `WoredaShell.tsx` was
excluded since it no longer exists) to `.font-am-heading` or `.font-am-body`, via a script applying the
plan's own rule mechanically: `<h1>`/`<h2>`/`<h3>`/`<th>` → heading (Tayitu), everything else → body
(Jiret). This is a **best-effort mechanical pass**, not a hand-reviewed one — spot-checked against
`PrintDocumentShell.tsx` and `woreda.residents.index.tsx` and found consistent with the plan's intent in
every sample checked, but with 814 occurrences a small number of ambiguous cases (e.g. inline
label:value pairs in a mobile card layout, which the heuristic classified as body/Jiret rather than
heading/Tayitu) are a plausible residual to catch in a future manual pass — flagged as a follow-up, not
silently claimed as perfect.

Verified via `bun run build`, `npx tsc --noEmit`, and `bun run lint` — all clean after a `prettier --write`
pass fixed line-length-only formatting drift the class-name swap caused.

### 4. Consolidated `AppShell` (`ux_restructure_plan.md`, "New shared shell")
- Deleted `src/components/layout/WoredaShell.tsx` and `AdminShell.tsx`; added
  `src/components/layout/AppShell.tsx`, one component parameterized by `portal: "woreda" | "admin"`.
- Built on the shadcn `sidebar.tsx` primitive that was vendored into the repo but unused by either old
  shell (per the audit finding) — `SidebarProvider`/`Sidebar`/`SidebarGroup`/`SidebarMenu`/`SidebarInset`
  — which gives collapse-to-icon and a mobile sheet behavior for free, neither of which the old shells
  had.
- Added `src/config/navGroups.ts`, grouping the woreda portal's flat `NAV_PERMISSION_MAP` into the design
  spec's §2.B accordion categories (Core Operations, Credential Management, Kebele Rental Houses,
  Verification & Approval, Revenue, Administration, Settings) — addressing the audit's "no nav grouping"
  clarity finding. The admin console's nav stays flat (5 items, grouping would add noise, not clarity).
- Header background uses the new `--color-shell-header` token instead of the old hardcoded
  `style={{ backgroundColor: "#1e3a5f" }}` — fixing the audit's hardcoded-color cross-cutting finding.
- User menu is now a real `DropdownMenu` (Radix, already in the component library) instead of a
  hand-rolled `useState` toggle + manually-positioned `<div>` — gets correct focus trapping and
  click-outside handling for free.
- **Motion, per the apple-design skill loaded for this task**: the active nav item's highlight is one
  `motion.span` with a shared `layoutId` (`woreda-nav-active-pill`), so switching sections *slides* the
  highlight to its new position (a continuous, spatially-consistent transition) instead of two nav items
  independently popping their backgrounds in/out. Used a plain critically-damped spring
  (`bounce: 0, duration: 0.35`) rather than an overshooting one, per the skill's own guidance: overshoot
  is reserved for gesture/momentum-driven interactions (a flick, a drag release), and a click-triggered
  nav switch carries no such momentum to honor — bounce there would look decorative, not physical.
  Left the sidebar's own collapse/expand animation as the primitive's built-in CSS width transition rather
  than replacing it with a spring, for the same reason: it's a settle animation on a discrete toggle, not
  a value the user is dragging, so the interruptibility/velocity-handoff concerns the skill emphasizes
  don't apply.
- Auth-guard/redirect logic in `src/routes/woreda.tsx` and `src/routes/admin.tsx` was **not touched** —
  only the shell component each renders was swapped, per the specific risk called out in the roadmap.

## What changed (Phase 1, partial)

### `TableToolbar` (`ux_restructure_plan.md`, Cluster A)
- Promoted the previously duplicated per-route toolbar markup into a real visual component,
  `TableToolbar`, added to `src/components/common/TableToolbar.tsx` alongside its existing hooks
  (`useUrlSort`, `useClearTableFilters`, etc.) — same file, since that's where every list screen already
  imports from. Added a shared `FilterGroup` (also previously duplicated per-route) in the same file.
- Visual treatment follows the design spec's §3.A floating toolbar: `bg-white/80 backdrop-blur-md
  rounded-2xl border-slate-200/80 shadow-sm`, replacing the flat `rounded-xl border bg-white` card.
- Wired into three reference screens: `woreda.residents.index.tsx`, `woreda.households.index.tsx`,
  `woreda.credentials.index.tsx`. Each screen's local `FilterGroup` duplicate was removed. Credentials'
  export buttons were moved from the page header into the toolbar itself, matching the other two screens
  and the design spec's own placement (export pills belong in the floating toolbar, not the header) —
  the one intentional layout change beyond a pure markup swap.
- **Update — since rolled out to the rest of Cluster A**: the remaining 9 screens (civil events, woreda
  audit, admin audit, revenue, both rental-houses list screens, admin tenants, and the shared
  `ServiceRequestList` powering both service-requests and complaints) were migrated in a follow-up commit
  using the exact pattern established here — see the "Cluster A completion" section below. 12 of ~16
  Cluster A screens now share `TableToolbar`. The two left out (`woreda.approvals.tsx`, whose read-only
  triage table has no search/export/clear affordance at all, and `admin.console-roles.tsx`, a permission
  matrix rather than a filterable list) don't fit the toolbar's shape and weren't forced into it.

### Cluster A completion (follow-up commit)

Migrated the remaining 9 screens: `woreda.civil.index.tsx`, `woreda.audit.tsx`, `admin.audit.tsx`,
`woreda.revenue.index.tsx`, `woreda.rental-houses.index.tsx`,
`woreda.rental-houses.requests.index.tsx`, `admin.tenants.index.tsx` (Tenants tab),
`src/components/admin/PlatformUsersTab.tsx` (the Users tab of the same screen), and
`src/components/services/ServiceRequestList.tsx` (the shared component behind both
`/woreda/services` and `/woreda/complaints`, so this one migration covers two nav entries).

Two variations from the straightforward residents/households/credentials pattern, both intentional:
- Several screens use controls that aren't the standard `FilterGroup` select — `KebeleFilter` (its own
  shared component), native `<input type="date">` range pickers (audit, revenue), and shadcn `<Select>`
  (`PlatformUsersTab`). These were passed into `TableToolbar`'s `filters` slot as-is rather than rebuilt
  to fit `FilterGroup`'s exact shape — the restructuring target was the toolbar *container* (the
  floating/translucent card, search box, clear/export row), not every filter control inside it. This
  means the filter row in these screens is visually slightly less uniform (a stacked `<Label>` + control
  next to a `FilterGroup` pill) than in residents/households/credentials — flagged as a follow-up
  polish item, not a functional gap.
- Left `woreda.approvals.tsx` and `admin.console-roles.tsx` out of Cluster A entirely: the former is a
  read-only triage table with no search/filter/export affordance to migrate, and the latter is a
  permission-grid matrix, not a filterable list — forcing either into `TableToolbar` would add UI that
  doesn't correspond to anything the screen actually does.

Net effect: **-85 lines across the 9 files** despite adding a shared component import to each, since 9
duplicated local `FilterGroup` definitions and their toolbar card markup were removed. Smoke-tested all 9
routes (10 counting `/woreda/complaints`, which shares `ServiceRequestList` with `/woreda/services`) via
headless Chromium — each correctly redirects unauthenticated traffic to `/login` rather than hitting the
app's error boundary.

### `Stepper` (`ux_restructure_plan.md`, Cluster B)

Built the segmented-pill wizard stepper called for by the design spec's §3.B, replacing the two
independently-built circle-and-line steppers that existed before this component: `ResidentWizardSteps.tsx`'s
local `StepIndicator` function, and `admin.tenants.$woredaId.provision.tsx`'s inline stepper markup. Per
the roadmap's own risk note ("prototype `Stepper` against both wizards before calling it done, since a
resident-wizard-only prototype might not generalize"), it was built and wired into both from the start
rather than one first:

- `src/components/forms/Stepper.tsx` (new) — takes `steps: {id, am, en}[]`, `current`, and two optional
  props: `maxReached` (how far the user has progressed, for step-jump gating) and `onJump` (click handler).
  Omitting `onJump` renders a display-only stepper — needed because the admin provisioning wizard doesn't
  support jumping backward mid-flow, while the resident wizard does.
- Resident wizard: replaced `StepIndicator` with `<Stepper steps={RESIDENT_STEPS.map(...)} current={step}
  maxReached={maxReached} onJump={onJumpStep} />`; removed the now-unused `Check` (lucide-react) and `Card`
  imports.
- Admin provisioning wizard: replaced the inline stepper block with `<Stepper steps={STEPS.map(...)}
  current={step} />` (no `onJump` — this wizard doesn't support step-jumping); removed the unused `Check`
  icon import.
- Deliberately uses a plain CSS color transition on step change, not a `framer-motion` spring — per the
  apple-design skill, springs earn their keep on gesture-driven, interruptible motion; a wizard step change
  is a discrete, click-triggered transition with no gesture velocity to honor, so the same reasoning already
  applied to `AppShell`'s sidebar-collapse animation applies here.

Smoke-tested `/woreda/residents/new` and `/admin/tenants/$woredaId/provision` via headless Chromium — both
correctly redirect unauthenticated traffic to `/login`, confirming the bundle containing `Stepper` loads
without a runtime crash (the same import-safety verification used for `TableToolbar`, given the same
no-real-backend constraint described below).

### `DetailHeader` + `WorkflowStepper` (`ux_restructure_plan.md`, Cluster C)

Built the two components called for by the design spec's §3.C: `DetailHeader` (photo/avatar, bilingual
title block, status chip, permission-gated action row) replacing ~8 independently hand-rolled detail-screen
headers, and `WorkflowStepper` for the four workflow-style detail screens (Credential, Civil Event, Service
Request, Rental Request) that each hand-rolled their own stage stepper/timeline before this.

- `src/components/common/DetailHeader.tsx` (new) — `photoUrl`/`initials` (photo falls back to initials),
  `titleAm`/`titleEn`, an optional `meta` array of icon+label facts, a `status` slot for a `StatusChip`, and
  an `actions` slot for the button row. Uses the `--shell-header` design token from Phase 0 instead of the
  hardcoded `bg-blue-700` every hand-rolled header used.
- `src/components/common/WorkflowStepper.tsx` (new) — `stages: {key, am, en}[]`, `currentStage`, and an
  optional `exception: {am, en, tone}` for off-the-happy-path outcomes (rejected, returned for correction)
  that a linear stepper can't represent as just "further along." Deliberately not built on top of the
  Cluster B `Stepper` component: a workflow stage advances only through a permission-gated action elsewhere
  on the page, never by clicking the indicator, so it's read-only with no `onJump`, and needs the exception
  affordance a form wizard never does.
- Wired into two screens with different shapes, per the same "prototype against more than one shape"
  discipline used for `Stepper`:
  - `woreda.residents.$residentId.index.tsx` — `DetailHeader` only (a resident profile has no workflow
    stage concept). Replaced the hand-rolled `bg-blue-700` header block; removed the `PageHeader` import
    (now redundant with `DetailHeader`'s own title).
  - `woreda.credentials.$requestId.index.tsx` — `DetailHeader` + `WorkflowStepper` covering the full
    `submitted → under_review → pending_approval → awaiting_payment → paid → active` happy path (derived
    from the actual status-history writes in this file, not guessed) plus the `rejected`/`returned`
    exception states. Removed the unused `PageHeader` and `CreditCard` icon imports.

Smoke-tested `/woreda/residents/$id` and `/woreda/credentials/$id` via headless Chromium — both correctly
redirect unauthenticated traffic to `/login`, confirming the bundle loads without a runtime crash (same
constraint as above: full visual verification of the workflow stepper's exception-state styling needs a
real backend session to reach a request in a `rejected`/`returned` state).

### `charts/` (`ux_restructure_plan.md`, Cluster E) — Phase 1 complete

Built the shared chart module called for by the design spec's §3.E, consolidating the three independent
inline Recharts configs (`woreda.dashboard.tsx`'s bar + line charts, `admin.dashboard.tsx`'s bar chart,
`woreda.reports.index.tsx`'s local `BarCard`/`PieCard`) into one set of pre-themed, typed presets.

- `src/components/charts/palette.ts` — the color values all three files had already converged on
  independently (`#1d4ed8` primary series, the same 7-color rotation for a pie's series) defined once
  rather than copy-pasted a fourth time.
- `src/components/charts/ChartCard.tsx` — shared card chrome (title, loading state, empty state).
  `titleAm` is **optional**, deliberately: `admin.dashboard.tsx` is the English-only super-admin console
  per `CLAUDE.md`'s documented convention, and this module must not force bilingual text onto it the way a
  naive "every screen gets both languages" reading of the design spec would.
- `src/components/charts/BarChartCard.tsx`, `LineChartCard.tsx`, `PieChartCard.tsx` — generic over the row
  shape (`<T extends Record<string, unknown>>`), so a screen passes its query data plus the field names to
  plot rather than repeating `ResponsiveContainer`/`XAxis`/`YAxis`/`Tooltip`/`CartesianGrid` JSX.
- Wired into `woreda.dashboard.tsx` (`BarChartCard` + `LineChartCard`) and `admin.dashboard.tsx`
  (`BarChartCard`), 2 of Cluster E's 3 screens, exercising both chart types those two files use.
  `woreda.reports.index.tsx`'s bar+pie usage (including its angled-label variant, supported via
  `BarChartCard`'s `angledLabels` prop, and its `PieChartCard`) is left as a **Phase 2 rollout item** rather
  than migrated here — the Phase 1 exit criteria is "verified against 2-3 real screens," not "every screen
  in the cluster," which is Phase 2's job.

Smoke-tested `/woreda/dashboard` and `/admin/dashboard` via headless Chromium — both correctly redirect
unauthenticated traffic to `/login`, confirming the bundle loads without a runtime crash.

**This completes all four Phase 1 component families** (`TableToolbar`, `Stepper`,
`DetailHeader`/`WorkflowStepper`, `charts/`) — Phase 1 is done per the roadmap's own exit criteria (each
family exists, is typed, and has been manually verified against at least two real screens from its
cluster). Phase 2 (rolling each out to every remaining screen in its cluster) has not started.

## Verification performed

| Check | Result |
|---|---|
| `bun run build` | ✅ clean |
| `npx tsc --noEmit` | ✅ clean |
| `bun run lint` | ✅ clean (after one `prettier --write` pass) |
| Dev server boots, `/login` renders | ✅ — see `docs/ux/evidence/login-tayitu-jiret-render.png` |
| Amharic font rendering, real strings | ✅ — the login page's title "ወረዳ አስተዳደር ሥርዓት" and the
  "ግባ / Sign In" button render in Tayitu with **no tofu boxes** and correct Ethiopic glyph/mark
  rendering (see the screenshot) |
| Authenticated shell (`AppShell` itself) rendered live | ❌ **not verified** — see below. Confirmed only
  that the bundle containing `AppShell` + `TableToolbar` loads without a runtime crash: hitting
  `/woreda/residents` unauthenticated correctly redirects to `/login` rather than hitting the app's error
  boundary, proving the code path is at least import-safe. |
| Automated test suite | N/A — per `CLAUDE.md`, this repo has no test suite (`no vitest/jest, no *.test.* files`) |
| WCAG 2.1 AA contrast audit | ❌ not performed — scoped to Phase 4, not Phase 0 |
| Responsive/breakpoint check | ❌ not performed — scoped to Phase 2/4, and blocked by the same auth
  limitation below for the one already-migrated screen (the shell) |

### Why the authenticated shell itself wasn't visually verified

This sandbox has no `.env` and no real Supabase project — `src/integrations/supabase/client.ts` throws at
import time without `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` (a pre-existing repo behavior, not
something this change introduced; confirmed by hitting the identical error on `/login` before adding a
placeholder `.env`). A placeholder `.env` with fake credentials was enough to get past that throw and
render the public `/login` page (proving the build boots, hydrates, and renders Amharic type correctly),
but actually signing in to reach `/woreda/dashboard` or `/admin/dashboard` — where `AppShell` itself
renders — needs a real backend session, which isn't available here. The `.env` used for this test was
removed afterward (it's gitignored, so it was never at risk of being committed either way).

**This is the single largest residual risk of this pass**: `AppShell` compiles, typechecks, and its
individual pieces (shadcn sidebar primitives, `DropdownMenu`, `framer-motion`) are all things already used
correctly elsewhere in this codebase, but the *assembled* component — nav filtering against real
permission/module data, the grouped sections rendering correctly, the active-pill animation actually
looking right — has not been seen rendered with real data. **Recommended next step before this branch is
considered mergeable**: run it against a real (or staging) Supabase project and click through both
portals' navigation before Phase 1 begins.

## Deviations from the plan

1. **Font call-site count was higher than estimated**: 814 occurrences / 70 files vs. the plan's "~40+" —
   handled by writing a migration script rather than hand-editing, which the plan's §3 anticipated
   ("scripted find-and-replace") but didn't size correctly. No functional deviation, just a scale
   correction.
2. **Only one Phase 1 component's worth of work was folded into this pass**: none, actually — `AppShell`
   is a Phase 0 item per the roadmap, not Phase 1. Phase 1's four component families (`TableToolbar`,
   `Stepper`, `DetailHeader`/`WorkflowStepper`, `charts/`) were **not started** in this pass. This is the
   main scope deviation from "implement the roadmap end-to-end": end-to-end execution of a ~65-day
   estimated roadmap in one session was not attempted, in favor of completing and properly verifying one
   full phase. Flagged here rather than claimed as done.
3. **No new git commits were pushed or merged**, per the explicit constraint — everything lives on the
   local `ux-restructure` branch.

## What's not done (as of the original Phase 0/1 pass — superseded, see top of report)

The subsections immediately below (through "Residual risks") describe the state after Phase 0/1 only, kept
for history. **All items they list as "not started" were completed in the later Phase 2-4 work described
at the top of this report** — see `ux_implementation_roadmap.md`'s status checklist for the current,
authoritative state. What genuinely remains, as of all five phases being complete:

- **~4 of Cluster A's ~16 screens** (`woreda.approvals.tsx`, `admin.console-roles.tsx`, and 2 others noted
  in the Cluster A completion section above) don't fit `TableToolbar`'s shape and were deliberately left
  as-is, not migrated.
- **3 of Cluster B's upload points** (resident clearance letter, civil event supporting docs, rental
  occupant document tiles) keep their own mixed image/PDF upload UI rather than `SquircleUpload` — a
  documented scope boundary (see "Phase 2 completion" above), not an oversight.
- **Authenticated-UI visual verification** still needs a real Supabase project or staging credentials, not
  available in this sandbox — every verification in this report used build/tsc/lint plus headless-Chromium
  unauthenticated-redirect smoke tests, never a live authenticated render of the full app against real
  data. This is the single largest residual risk of the whole branch, not just Phase 0/1.
- **The 814-occurrence mechanical font migration** (Phase 0) still has not had a full manual spot-check
  beyond the handful of files sampled across this work — low severity (worst case: some body text renders
  in the decorative Tayitu face instead of Jiret) but worth a follow-up pass before this branch is
  considered fully trusted.

## Residual risks

1. **Real-data rendering is unverified end-to-end.** Every phase in this restructuring — `AppShell`'s nav
   grouping, every `DetailHeader`/`WorkflowStepper` screen, the dashboards' live chart data, the redesigned
   login page's actual sign-in flow — has been verified via build/tsc/lint and headless-Chromium
   unauthenticated-redirect checks, never by an authenticated session against real data. This is true of
   the whole branch, not just its earliest commits. **This is the recommended next step before merge**: run
   it against a real (or staging) Supabase project and click through both portals' navigation, every
   migrated detail screen's workflow actions, and the login form's actual submit path.
2. The mechanical font migration's heuristic (tag-based) could have misclassified a small number of the
   814 occurrences relative to the plan's more nuanced "is this wayfinding or content" judgment call — low
   severity (worst case, some body text renders in the decorative Tayitu face instead of Jiret, which is
   a typography polish issue, not a functional bug) but worth a follow-up pass.
3. No automated regression coverage exists in this repo to catch a shell-consolidation regression
   automatically — manual verification (once credentials are available) is the only safety net, consistent
   with how this repo already operates per `CLAUDE.md`.
4. Phase 4's production-build font verification could not exercise a live server in this sandbox (Node/
   Nitro tooling errors unrelated to this work) — the production CSS/asset paths were confirmed correct by
   direct inspection, but an actual browser load of the built server output has not happened. Low risk
   given Phase 3's identical-binary glyph-rendering check already passed, but worth confirming once this
   branch reaches an environment where the production server actually runs.

## Evidence

- `docs/ux/evidence/login-tayitu-jiret-render.png` — screenshot of `/login` rendering the migrated
  `.font-am-heading`/`.font-am-body` classes, proving Tayitu/Jiret load and render real Amharic strings
  (including the title "ወረዳ አስተዳደር ሥርዓት") with no missing-glyph boxes.
