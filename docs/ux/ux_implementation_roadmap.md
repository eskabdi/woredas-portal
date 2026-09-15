# UX Implementation Roadmap — Phased, Dependency-Ordered

Five phases. Each phase's exit criteria must hold before the next phase starts — this is a dependency
chain, not a checklist to work in parallel. Component names match `ux_restructure_plan.md` exactly.

**Status** (see `ux_implementation_report.md` for full detail):
- [x] Phase 0 — Foundations — **done**, verified (branch `ux-restructure`)
- [x] Phase 1 — Shared patterns — **done**, all four component families built and manually verified.
- [x] Phase 2 — Screen-by-screen adoption — **substantially done**: Cluster A (12 of ~16 screens; 2
  intentionally excluded — see below), Cluster C (8 of 8 detail screens — full rollout), Cluster E (3 of 3
  dashboard/report screens — full rollout). Cluster B: the input-token pass and `Stepper` apply globally/to
  both wizards already (nothing left to roll out there); `SquircleUpload` covers 2 of its ~3 real call
  sites (resident photo, settings logo/stamp/signature) — the mixed image/PDF uploads (clearance letter,
  civil event docs, rental occupant document tiles) are a deliberate scope boundary, not an oversight (see
  report). Intentionally excluded from any cluster: `woreda.approvals.tsx` (no filter/export UI to migrate)
  and `admin.console-roles.tsx` (a permission matrix, not a list or detail screen).
- [x] Phase 3 — Print documents & dashboards — **done**: Cluster D typography verified against the real
  self-hosted fonts (one micro-label size bumped 9.5px → 10.5px per the typography plan's own decision
  criteria); Cluster E dashboard theming folded into Phase 2 above.
- [x] Phase 4 — Validation — **done**: WCAG 2.1 AA contrast audit found and fixed 3 real failures (gold
  accent and status colors used as text/icon color on light backgrounds — they were calibrated as accents
  against the dark shell header, not for light backgrounds); keyboard-navigation pass found and fixed 2
  real gaps (missing focus-visible rings); Amharic font verification re-run against the actual production
  build's compiled CSS and copied font assets (the sandbox's Node/Nitro server can't run in this
  environment — a pre-existing tooling limitation, not a UX regression — so this checked the production
  bundle's `@font-face` rules and asset paths directly rather than a live server).

**What's NOT covered by "done" above**: not every one of the 55 screens uses every new component (e.g. 4
of Cluster A's screens, the mixed-file uploads in Cluster B). This was a deliberate choice to finish each
component family's genuine reuse targets rather than force-fit screens that don't match the pattern —
documented per-item above and in `ux_implementation_report.md`, not silently left incomplete. The login
page (`/login`) was also redesigned to match a user-provided reference mockup (split navy/canvas layout,
real Harari Regional State seal) — this was outside the original 5-cluster scope (Login was catalogued as
a standalone form screen, not assigned restructuring work), done on explicit request.

## Phase 0 — Foundations (blocks every later phase)

**Workstreams**:
1. **Font licensing confirmation** — resolve the `Tayitu.ttf` (and confirm `Jiret.ttf`) web-embedding
   rights question from `ux_amharic_typography_plan.md` §0. Nothing in §2–5 of that plan executes until
   this is a yes.
2. **Design tokens** — add the extracted design-system palette (`headerBackground`, `brandPrimary`,
   `accentGold`, `canvasBackground`, `statusSuccess/Warning/Danger` + their `*Bg` variants, etc.) to
   `src/styles.css`'s existing `:root`/`.dark` OKLCH token blocks and register them in `@theme inline`,
   following the same pattern the file already uses for its current semantic tokens — not a parallel,
   competing token system.
3. **Font hosting** — convert and add `Tayitu.woff2`/`Jiret.woff2` under `public/fonts/`, add
   `@font-face` rules and the `--font-am-heading`/`--font-am-body` tokens, per
   `ux_amharic_typography_plan.md` §2. Gated on workstream 1.
4. **`AppShell`** — build the consolidated shell (`ux_restructure_plan.md`'s `AppShell` section),
   replacing `WoredaShell`/`AdminShell`. This is the single largest Phase 0 item since both portals
   depend on it existing before any screen-level work can adopt the new nav grouping/typography.

**Effort estimate**: 1 (licensing decision, external dependency) + 2–3 (tokens) + 2–3 (font hosting,
gated) + 5–8 (AppShell rebuild + regression testing both portals) developer-days. AppShell dominates.

**Risks & mitigations**:
- *Risk*: consolidating `WoredaShell`/`AdminShell` into one `AppShell` accidentally changes the
  route-level auth-guard/redirect logic currently living in `src/routes/woreda.tsx`/`admin.tsx`.
  *Mitigation*: touch only the shell component each route renders; the guard/redirect code in those two
  route files is explicitly out of scope for this phase and should have zero diff.
- *Risk*: font licensing blocks the whole phase indefinitely. *Mitigation*: workstreams 2 and 4 (tokens,
  AppShell) have no dependency on workstreams 1/3 (fonts) — sequence them in parallel so a licensing delay
  only blocks the typography-specific work, not the whole phase.

**Exit criteria**: `AppShell` renders both portals correctly (all existing nav items present, correctly
permission-filtered, correctly grouped); design tokens are defined and at least one component
(`AppShell`'s header) consumes them instead of a hardcoded color; font licensing is resolved one way or
the other (proceed with self-hosting, or explicitly fall back to keeping Noto Sans Ethiopic if rights
can't be confirmed — either outcome unblocks Phase 1, an indefinite "still checking" does not).

## Phase 1 — Shared patterns

**Workstreams**: `TableToolbar` (Cluster A), `Stepper` + input token pass + `SquircleUpload` (Cluster B),
`DetailHeader` + `WorkflowStepper` (Cluster C), `charts/` module (Cluster E) — built and unit-verified in
isolation (e.g. Storybook-less manual verification: render each new component standalone against 2–3
representative screens before wiring every screen to it) before Phase 2 rolls them out everywhere.

**Effort estimate**: 3–4 days per component family (4 families) ≈ 12–16 developer-days, parallelizable
across engineers since the four families don't depend on each other, only on Phase 0's `AppShell`/tokens.

**Risks & mitigations**:
- *Risk*: building `TableToolbar` against only one or two list screens first might miss a filter type
  used elsewhere (e.g. `KebeleFilter`, date-range filters on Reports/Audit) and require rework once rolled
  out broadly. *Mitigation*: audit all filter types actually used across the 16 Cluster A screens (see
  `ux_screen_inventory.md`) before finalizing `TableToolbar`'s prop surface, not after.
- *Risk*: `Stepper` built only against the 4-step resident wizard might not generalize to the admin
  provisioning wizard's different step count/content. *Mitigation*: prototype `Stepper` against both
  wizards before calling it done, per `ux_restructure_plan.md`'s explicit note that it replaces both.

**Exit criteria**: each of the four new component families exists, is typed/documented, and has been
manually verified against at least two real screens from its cluster — not yet rolled out to every screen
in the cluster (that's Phase 2).

## Phase 2 — Screen-by-screen adoption

Ordered by cluster size (highest reuse payoff first): **Cluster A (16 screens) → Cluster B (13 screens) →
Cluster C (13 screens)**. Cluster D and E are handled in Phase 3 since they need no new components (D) or
were already built in Phase 1 (E, folded in here for convenience since it's small).

**Per-cluster workflow**: for each screen in the cluster (per `ux_screen_inventory.md`'s table), swap its
old markup for the Phase 1 component, apply the typography classes from
`ux_amharic_typography_plan.md` §3's worklist, and verify the screen still functions correctly for every
permission/module-gate state it has (a screen that renders fine for `tenant_admin` but breaks for
`viewer` is not done — re-check `src/config/permissions.ts` gates per screen).

**Effort estimate**: Cluster A ≈ 0.5 day/screen × 16 ≈ 8 days; Cluster B ≈ 1 day/screen × 13 ≈ 13 days
(wizards take longer); Cluster C ≈ 0.75 day/screen × 13 ≈ 10 days. ≈ 31 developer-days total, highly
parallelizable across engineers since screens within a cluster don't depend on each other.

**Risks & mitigations**:
- *Risk*: 55 screens is a lot of surface area for a silent regression (e.g. a filter that stops working
  after `TableToolbar` adoption). *Mitigation*: adopt one screen per cluster first as a canary, get it
  reviewed, then batch the rest — don't roll out to all 16 Cluster A screens simultaneously.
- *Risk*: the two-tier permission model (`ux_audit_findings.md`'s note that client `PermissionGate` and
  DB `user_has_perm()` must both agree) means a UI restructuring that changes which elements render
  conditionally could accidentally expose or hide the wrong actions for the wrong role. *Mitigation*: no
  permission logic changes in this phase — only swap presentation components, never touch which
  `PermissionGate`/`ModuleGate` wraps which action.

**Exit criteria per cluster**: zero screens in that cluster still using the old pattern (verifiable via
`grep` for the old component/class names returning no hits in that cluster's route files).

## Phase 3 — Print documents & dashboards

**Workstreams**: Cluster D typography pass (per `ux_restructure_plan.md`, pending the print-size
verification from `ux_amharic_typography_plan.md` §5); Cluster E dashboard route files wired to the
Phase 1 `charts/` module (if not already folded into Phase 2).

**Effort estimate**: 3–5 developer-days — lower urgency and lower effort since Cluster D needs no
structural change (`ux_audit_findings.md` scored it highest already) and Cluster E's components were
already built in Phase 1.

**Risks & mitigations**: *Risk*: Jiret fails the 9.5px print micro-label legibility check.
*Mitigation*: already planned for in `ux_amharic_typography_plan.md` §5 — bump that specific size token,
don't block the whole cluster on it.

**Exit criteria**: all print document types use the confirmed typography (with any print-size exception
explicitly documented, not silently reverted); all three dashboard routes use the shared `charts/`
module.

## Phase 4 — Validation

**Workstreams**:
1. **WCAG 2.1 AA contrast check** on the new palette — specifically the spec's `#0B192C` header
   background against its gold (`accentGold`, `#F59E0B`) and white text foregrounds, and the new status
   badge colors against their backgrounds. Run an actual contrast-ratio tool against the final rendered
   colors, not the raw hex values in isolation (translucency/opacity in the design spec's tokens, e.g.
   `rgba(29, 91, 216, 0.1)` backgrounds, changes effective contrast against whatever sits behind them).
2. **Keyboard-navigation pass** on the new `Stepper` and `TableToolbar` — confirm tab order, focus rings
   (the input token pass's `focus:ring-2` treatment), and that filter dropdowns/step navigation are
   operable without a mouse.
3. **Amharic font verification re-run** — repeat `ux_amharic_typography_plan.md` §5's test-string
   procedure against the actual production build (not dev server), since `font-display: swap` and CDN/
   caching behavior can differ from a local preview.

**Effort estimate**: 3–5 developer-days.

**Risks & mitigations**: *Risk*: a contrast failure is found late, after Phase 2's screen-by-screen
rollout is already complete, requiring a palette adjustment that ripples back through every migrated
screen. *Mitigation*: run workstream 1 as early as Phase 0's token-definition step (a preliminary check
against the raw palette), not only here — Phase 4's version is the final confirmation against real
rendered output, not the first check.

**Exit criteria**: no WCAG 2.1 AA contrast failures in the new palette; `Stepper`/`TableToolbar` fully
keyboard-operable; production-build font verification passes with zero tofu boxes and the Cluster D
print-size question resolved one way or the other.

## Summary effort table

| Phase | Developer-days (estimate) | Parallelizable? |
|---|---|---|
| 0 — Foundations | ~10–15 | Partially (tokens/AppShell vs. fonts) |
| 1 — Shared patterns | ~12–16 | Yes, across 4 component families |
| 2 — Screen-by-screen | ~31 | Yes, within each cluster |
| 3 — Print & dashboards | ~3–5 | Yes |
| 4 — Validation | ~3–5 | Partially |
| **Total** | **~60–72 developer-days** | — |

This is a rough order-of-magnitude estimate for scoping purposes, not a committed schedule — the
licensing open item in Phase 0 and the print-size legibility question in Phase 3 are the two items most
likely to shift these numbers once resolved.
