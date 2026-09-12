# UX Audit Findings — Apple HIG (Clarity, Deference, Depth) + Typography

Scored per cluster (see `ux_pattern_map.md`), not per individual screen — within a cluster the same
component produces the same score everywhere it's used, so per-screen re-scoring would just repeat
itself. Score scale: 1 (severe gap) – 5 (meets HIG intent) per dimension.

## Cluster A — List / Filter / Export screens

| Dimension | Score | Finding |
|---|---|---|
| Clarity | 3/5 | Column headers and status badges are legible and bilingual; but boxed filter pills with tiny native `<select>` chrome read as dense/technical rather than clear at a glance. |
| Deference | 2/5 | Flat white bordered cards with visible `rounded-md`/`rounded-xl` borders everywhere compete with the data instead of receding — chrome is as visually loud as content. |
| Depth | 2/5 | No elevation hierarchy: toolbar, table, and pagination bar all sit at the same flat visual plane (`shadow-sm` at most, no blur/translucency to signal "this floats above the content"). |
| Typography | 3/5 | Bilingual "ስም / Name" convention followed correctly throughout; but Amharic and English share one weight/size scale with no Tayitu/Jiret distinction — headers and body text look the same register. |

**Root cause**: the toolbar markup is duplicated per-route (`ux_pattern_map.md` Cluster A), so this score
applies identically to all ~16 screens and won't improve until the shared `TableToolbar` exists.

## Cluster B — Multi-step Forms

| Dimension | Score | Finding |
|---|---|---|
| Clarity | 3/5 | Section grouping (`Section`/`Grid`/`FieldWrap`) keeps related fields together; but two independently-built steppers (resident wizard vs. admin provisioning wizard) mean the "how many steps, where am I" affordance isn't consistent across the app. |
| Deference | 2/5 | Filled-circle-and-bar stepper is a strong, attention-grabbing UI element (Material-style) that competes with the form content below it rather than quietly indicating progress. |
| Depth | 2/5 | No transition/motion between steps (content swaps via `className={hidden}` toggling, no animated depth cue for "moving forward"). |
| Typography | 3/5 | Same Amharic/English weight-parity issue as Cluster A; form labels and section headers read at the same visual weight. |

**Specific defect, not stylistic**: the resident wizard and the admin tenant-provisioning wizard are two
separate implementations of the same stepper concept — this is a code-duplication finding as much as a
visual one, and the restructuring plan collapses both onto one `Stepper` component.

## Cluster C — Detail / Profile screens

| Dimension | Score | Finding |
|---|---|---|
| Clarity | 3/5 | Status chips and action-button gating (permission-aware) communicate state correctly; but each screen's header layout is independently hand-rolled, so photo/title/status/actions are positioned slightly differently screen to screen — a user re-learns the layout each time. |
| Deference | 3/5 | Stacked white cards are reasonably quiet; workflow screens' inline verify/approve/pay/issue cards are dense but functionally necessary (maker-checker requires seeing the full trail). |
| Depth | 2/5 | Workflow stage (submitted → verified → approved → …) is communicated via badge text and conditional card visibility, not a persistent stepper/timeline the user can see at a glance — depth here means "where am I in this process," which today requires reading, not glancing. |
| Typography | 3/5 | Consistent with Clusters A/B — no heading/body font distinction yet. |

**Specific defect**: ~12 independent header implementations across the 8 workflow-style detail screens is
a real maintenance and consistency cost — this is the strongest case in the whole audit for a shared
`DetailHeader`/`WorkflowStepper` pair.

## Cluster D — Printable Documents

| Dimension | Score | Finding |
|---|---|---|
| Clarity | 4/5 | `PrintDocumentShell`'s numbered `DocSection`s, bilingual header, and `DocDataTable` are already clear and well-organized — closest cluster to "done." |
| Deference | 4/5 | Print documents correctly defer to governmental-letterhead convention rather than app chrome — appropriate for what they are (official documents, not app screens). |
| Depth | 3/5 | Flat single-page layout is appropriate for print (depth/elevation is a screen concept, not a print one) — scored slightly down only because the design spec's "purple seal graphic" isn't consistently present across all document types yet (some use a real stamp image, some a placeholder). |
| Typography | 2/5 | This is the cluster most exposed to the typography change: dense uppercase micro-labels (`text-[9.5px] uppercase`) at print resolution need the Amharic body face (Jiret) to stay legible at that size — this is a real risk to flag, not just an upgrade, since Jiret hasn't been verified at sub-10px sizes. |

**Flag for `ux_amharic_typography_plan.md`**: verify Jiret legibility specifically at the print
micro-label size before applying it here — if it doesn't hold up, this cluster may need to keep Noto Sans
Ethiopic (or a slightly larger minimum size) as an exception.

## Cluster E — Dashboards / Analytics

| Dimension | Score | Finding |
|---|---|---|
| Clarity | 3/5 | KPI cards communicate headline numbers clearly; but three independent inline chart configs mean color/style consistency across dashboards isn't guaranteed (e.g. no confirmed shared color-per-series convention between the woreda dashboard and the reports dashboard). |
| Deference | 3/5 | Charts are appropriately understated (no gratuitous 3D/gradient effects observed); scored down only because KPI cards use the same flat-bordered-card style as Cluster A, missing the Dark Accent Container treatment the spec calls for on quick-actions/summary panels. |
| Depth | 3/5 | Some depth already present via the design spec's called-for Dark Navy Quick Actions card pattern partially exists in dashboard layouts; formalizing it as a shared component would make it consistent everywhere it should appear. |
| Typography | 3/5 | Same Amharic/English parity issue. |

## Cross-cutting findings (not cluster-specific)

1. **Hardcoded colors bypass the existing token system**: `WoredaShell.tsx`'s sidebar uses an inline
   `style={{ backgroundColor: "#1e3a5f" }}` instead of the `--sidebar*` OKLCH tokens already defined in
   `src/styles.css`. This is a real defect independent of the HIG restructuring — the token system exists
   and isn't being used consistently even today.
2. **Two independently-built shells** (`WoredaShell`, `AdminShell`) duplicate ~80% of their structure
   (header bar, user menu, sign-out, nav-item rendering) while a shadcn `sidebar.tsx` primitive sits
   unused in `src/components/ui/` — the biggest single consolidation opportunity in the whole audit.
3. **Admin console must stay English** — per `CLAUDE.md`'s documented convention, `/admin/*` is
   intentionally English-only. Any Amharic text found on an admin-console screen during implementation is
   a defect to fix toward English, not toward Amharic; the typography plan's Tayitu/Jiret work applies
   only to the woreda portal's Amharic content, never to the admin console's UI chrome.
4. **`font-noto-ethiopic` is opt-in, not automatic**: applied as a manual utility class in ~40+ files
   rather than an automatic locale-based rule. Every one of those call sites needs to be individually
   re-classified as heading-weight (→ Tayitu) or body-weight (→ Jiret) — this is not a one-line
   find-and-replace, see `ux_amharic_typography_plan.md` for the exact rule.
