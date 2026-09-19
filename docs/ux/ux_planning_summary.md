# UX Planning Summary — Apple HIG Restructuring, Woreda Portal

Executive summary of the six companion documents in this directory. This is planning only — no
application code changed as part of producing these documents.

## What's here

1. `ux_screen_inventory.md` — all 55 routes across both portals, grouped by module, with current pattern
   and shell/component for each.
2. `ux_pattern_map.md` — the 55 screens collapse into five clusters (List/Filter/Export, Multi-step Forms,
   Detail/Profile, Printable Documents, Dashboards/Analytics), each with one current-state description and
   one restructuring direction.
3. `ux_audit_findings.md` — Clarity/Deference/Depth/Typography scores per cluster against the master
   design system spec, plus four cross-cutting findings (hardcoded colors bypassing the existing token
   system, two duplicated shell implementations, the admin console's English-only convention, and the
   ad-hoc nature of today's Amharic font application).
4. `ux_amharic_typography_plan.md` — the exact Tayitu (headings/titles/nav) / Jiret (body) mapping,
   `@font-face`/token implementation, migration rule for the ~40+ existing font call sites, and a concrete
   verification procedure with real Amharic test strings.
5. `ux_restructure_plan.md` — one restructuring spec per cluster plus a new consolidated `AppShell`,
   naming every new shared component (`AppShell`, `TableToolbar`, `Stepper`, `SquircleUpload`,
   `DetailHeader`, `WorkflowStepper`, `charts/`) and which existing files each touches.
6. `ux_implementation_roadmap.md` — five dependency-ordered phases (Foundations → Shared Patterns →
   Screen-by-screen Adoption → Print & Dashboards → Validation), each with effort estimates, risks/
   mitigations, and exit criteria; ≈60–72 developer-days total, order-of-magnitude.

## One open item, one resolved

1. **Font licensing — resolved**. `Tayitu.ttf`'s embedded metadata reads "Copyright 2019 Anbassa Design.
   All Rights Reserved" (digitally signed), which was flagged as needing confirmation before self-hosting
   it in a public `@font-face`. The user confirmed its use is decorative only (headings/titles/nav labels,
   never body copy) and acceptable — Phase 0's font-hosting workstream is unblocked. Detailed in
   `ux_amharic_typography_plan.md` §0.
2. **Source document format** (informational, not blocking): the supplied `master_design_system.md` is actually a legacy `.doc` file
   (WPS Office / Composite Document Format), not Markdown — it was read via `strings -e l` extraction
   rather than a normal file read. The English content came through completely; the document's own
   Amharic example strings did not survive that extraction method, but every design token, module
   description, and component spec needed for this planning work was in the English scaffolding, so this
   didn't limit the audit itself — flagging only so a future re-read of that source file uses the same
   extraction approach rather than assuming it's plain Markdown.

## What happens next

This plan was approved via the plan-mode workflow with the explicit scope of producing these seven
documents (this summary is the seventh) — not implementing them. The natural next step is a normal
(non-plan-mode) task that begins Phase 0 of `ux_implementation_roadmap.md`: build the design tokens and
the consolidated `AppShell` (font hosting is now unblocked per item 1 above).

(An unrelated git-sync question from an earlier task on this branch was raised during this session and
has been set aside at the user's direction — it has no bearing on this UX planning work.)
