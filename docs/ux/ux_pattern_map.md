# UX Pattern Map — Woreda Portal

Every one of the 55 screens in `ux_screen_inventory.md` belongs to one of five recurring patterns. This
map exists so the restructuring plan fixes each pattern once instead of finding (and re-finding) the same
defect 15 times across 15 nearly-identical list screens. `ux_audit_findings.md` scores each cluster
against Apple HIG; `ux_restructure_plan.md` gives each cluster one restructuring spec.

## Cluster A — List / Filter / Export screens (~16 screens)

**Members**: Residents, Households, Credential Requests, Civil Events, Service Requests/Complaints,
Approval Queue, Rental Houses, Rental Requests, Revenue, Audit Trail (woreda), Tenant Management,
Platform Audit Trail (admin).

**Current shared logic, no shared visual component**: `src/components/common/TableToolbar.tsx` and
`TablePagination.tsx` supply hooks (`useUrlSort`, `useClearTableFilters`, `useUrlPagination`,
`useUrlSearchTerm`) and small pieces (`ClearFiltersButton`, `ExportButtons`, `SortableTh`), but the actual
toolbar markup — search input, filter-pill row, divider, export row — is copy-pasted into each route file
(e.g. `src/routes/woreda.residents.index.tsx:293-353`). Visually: flat white `rounded-xl border
border-slate-200` card, boxed filter pills (`rounded-md border bg-slate-50`), sharp corners throughout,
`shadow-sm` at most — no translucency, no blur, no floating feel.

**Restructuring pattern**: extract the copy-pasted markup into one `TableToolbar` visual component
(floating, `bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-sm`, per the
design spec's §3.A), used by all ~16 screens. `TableSkeletonRows`/`TableEmptyRow`/`TableErrorRow`
(`src/components/common/TableStates.tsx`) already are shared components — they need a token/typography
pass, not restructuring.

## Cluster B — Multi-step Forms (4 wizards + ~9 single-page sectioned forms)

**Wizard members**: New/Edit Resident (`ResidentWizardSteps`, 4 steps), Provision Tenant Admin (admin
console, its own separate 4-step stepper — a second, independently-built wizard implementation).

**Single-page form members**: New Household, Edit Household, New Credential Request, New Civil Event
(×4), New Rental House, Edit Rental House, New Occupant (5 sections, the longest form in the app), New
Service Request.

**Current pattern**: `src/components/forms/ResidentWizardSteps.tsx` implements a classic filled-circle
stepper (`StepIndicator`, lines ~888-941) — numbered circles, connecting bars, current step
`bg-blue-700 ring-4`. Single-page forms use `Section`/`Grid`/`FieldWrap` primitives
(`src/components/forms/FormSection.tsx`) — bordered card sections with icons, no stepper needed since
they're one page. Inputs across both are plain shadcn `Input`/`Select` with default styling, not yet
matching the spec's soft-grey-background/focus-ring treatment.

**Restructuring pattern**: replace the two independent circle-steppers (resident wizard + admin
provisioning wizard) with one shared `Stepper` component using the spec's segmented pill progress bar.
Apply the spec's input styling (`bg-slate-50/80 border-slate-200 focus:bg-white focus:border-blue-600
focus:ring-2 focus:ring-blue-600/20 rounded-xl`) globally via the shadcn `Input`/`Select` base components
rather than per-form, so both wizard and single-page forms inherit it automatically. Photo/document
upload inputs (resident photo, rental occupant documents, civil event supporting docs) become the
spec's squircle upload boxes.

## Cluster C — Detail / Profile screens with stacked cards or tabs (~13 screens)

**Members**: Resident Profile (6 tabs), Household Detail (2 tabs), Credential Request Detail
(stacked workflow cards), Civil Event Detail (stacked cards), Service Request Detail (stepper + cards),
Rental House Detail (history table + dialogs), Rental Request Detail (stepper + cards), Tenant Detail
(admin).

**Current pattern**: each detail screen hand-rolls its own header (photo/title/status/action buttons)
and its own card layout — no shared `DetailHeader` or `WorkflowStepper` component, so the same "header
with photo, bilingual name, status chip, action buttons" shape is implemented ~8 separate times with
minor variations. Workflow screens (credential, civil, service, rental request) each hand-roll their own
stage stepper/timeline rather than sharing one.

**Restructuring pattern**: extract one `DetailHeader` component (photo/avatar, bilingual title block,
status chip, action button row) and one `WorkflowStepper`/timeline component for the four workflow-style
detail screens, replacing ~12 hand-rolled implementations with 2 shared ones.

## Cluster D — Printable Documents (~8 screens + credential card print)

**Members**: Resident Print, Household Print, Service Letter Print, Occupant Profile Print, Revenue
Receipt Print, Report Print (×6 report types share one route/component) — all via
`src/components/print/PrintDocumentShell.tsx`. Credential Print (`/woreda/credentials/$id/print`) is a
**separate, bespoke print surface** (physical CR80 card, not `PrintDocumentShell`) — it stays out of
this cluster's restructuring since its constraints are physical-card printing, not document layout (see
the `card-print-review` subagent and `pdf-print-pipeline` skill for why it's handled separately).

**Current pattern**: `PrintDocumentShell` is already a coherent, letterhead-style document shell — small
square logo, bilingual header text, doc-tag pill, numbered `DocSection`s, `DocDataTable`,
`DocSignatureBlock`. This is the most "finished" cluster relative to the design spec already; the spec's
§3.C (dark header row, purple seal graphic, QR verification) is nearly what's already built.

**Restructuring pattern**: typography-only pass (Tayitu/Jiret per the typography plan) plus verifying the
existing dark-header/QR/signature pattern matches the spec's receipt example exactly — this cluster does
not need new components, only a token/font pass.

## Cluster E — Dashboards / Analytics (4 screens)

**Members**: Woreda Dashboard, Admin Dashboard, Reports Dashboard (6 tabs), and the KPI-card row pattern
reused inside several detail screens (e.g. resident profile's summary strip).

**Current pattern**: no shared `components/charts` module — Recharts configs are written inline in
`src/routes/woreda.dashboard.tsx`, `src/routes/woreda.reports.index.tsx`, and
`src/routes/admin.dashboard.tsx` independently. The shadcn `ChartContainer` wrapper
(`src/components/ui/chart.tsx`) exists but each route defines its own bar/pie/axis/color config rather
than sharing one theming layer, so the three dashboards' charts don't necessarily look consistent with
each other today.

**Restructuring pattern**: build one shared `charts/` module (bar/pie/donut presets pre-themed to the new
palette) that all three dashboard routes import instead of defining chart config inline three times.
