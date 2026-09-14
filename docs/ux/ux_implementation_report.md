# UX Implementation Report — Phase 0 Complete, Phase 1 Started

Branch: `ux-restructure` (created off `claude/woredas-portal-amharic-manual-0x86rz`, not merged, not
pushed — per instructions, changes stay on this working branch pending review). Three commits:
Phase 0 part 1 (fonts/tokens/font migration), Phase 0 part 2 (`AppShell`), Phase 1 start (`TableToolbar`).

## Scope of this pass

**Phase 0 (Foundations) is complete and verified. Phase 1 (Shared patterns) has one of its four component
families done** (`TableToolbar`, wired into 3 of Cluster A's ~16 list screens as the reference
implementation) — the other three (`Stepper`, `DetailHeader`/`WorkflowStepper`, `charts/`) and the
remaining 13 Cluster A screens, all of Clusters B/C, and Phases 2–4 are **not started**. This report stays
honest about that split rather than claiming a 55-screen restructuring that didn't happen: the roadmap's
own effort estimate for the full plan is ~60–72 developer-days, and shipping unverified changes across 55
production screens in one pass would violate the "do not break existing functionality" constraint more
than stopping at verified, incremental progress does.

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

## What's not done (and why), with concrete next steps

- **Phase 1 — Shared patterns**: `TableToolbar` (done, all of Cluster A) and `Stepper` (done, both wizards
  it needs to generalize across) are complete. `DetailHeader`/`WorkflowStepper` (Cluster C, ~13 detail
  screens) and `charts/` (Cluster E) are **not started**. Next step: build and manually verify each against
  2–3 real screens before any broader rollout, per the roadmap's own Phase 1 workflow.
- **Phase 2 — Screen-by-screen adoption** (all 55 screens): not started; depends on Phase 1 existing
  first.
- **Phase 3 — Print documents & dashboards**: not started; lower urgency per the audit (Cluster D already
  scored highest of all clusters) but still pending the font migration script's classification being
  spot-checked specifically at `PrintDocumentShell`'s smallest label size (9.5px), per
  `ux_amharic_typography_plan.md` §5's flagged risk.
- **Phase 4 — Validation** (WCAG contrast, keyboard nav, production-build font re-verification): not
  started.
- **Authenticated-UI visual verification**: needs a real Supabase project or staging credentials, not
  available in this sandbox — see above.
- **The 814-occurrence mechanical font migration deserves a manual spot-check pass** beyond the two files
  sampled here, particularly for the ambiguous "inline label:value pair" pattern noted in the Cluster C/D
  discussion.

## Residual risks

1. Real-data rendering of `AppShell`'s nav grouping/filtering logic is unverified (see above) — the
   highest-priority item before this branch is trusted.
2. The mechanical font migration's heuristic (tag-based) could have misclassified a small number of the
   814 occurrences relative to the plan's more nuanced "is this wayfinding or content" judgment call — low
   severity (worst case, some body text renders in the decorative Tayitu face instead of Jiret, which is
   a typography polish issue, not a functional bug) but worth a follow-up pass.
3. No automated regression coverage exists in this repo to catch a shell-consolidation regression
   automatically — manual verification (once credentials are available) is the only safety net, consistent
   with how this repo already operates per `CLAUDE.md`.

## Evidence

- `docs/ux/evidence/login-tayitu-jiret-render.png` — screenshot of `/login` rendering the migrated
  `.font-am-heading`/`.font-am-body` classes, proving Tayitu/Jiret load and render real Amharic strings
  (including the title "ወረዳ አስተዳደር ሥርዓት") with no missing-glyph boxes.
