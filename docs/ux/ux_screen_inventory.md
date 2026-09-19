# UX Screen Inventory — Woreda Portal

Full inventory of every route in both portals, for the Apple HIG restructuring effort. Screen names and
route paths match the app's actual `src/routes/*.tsx` file-based routing. "Current pattern" is the visual
shape (list, form, detail/profile, print document, dashboard); "Current shell/component" is the shared
component the screen renders through today (see `ux_pattern_map.md` for cluster-level detail on each).

Legend: **WS** = `WoredaShell`, **AS** = `AdminShell`, **Wiz** = multi-step wizard
(`ResidentWizardSteps`-style, circle stepper), **Print** = `PrintDocumentShell`, **Public** = no shell,
unauthenticated.

## 1. Login & Dashboard

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Login | `/login` | Form (single card, no shell) | Public |
| Set Password (invite/reset) | `/set-password` | Form (single card, no shell) | Public |
| Woreda Dashboard | `/woreda/dashboard` | Dashboard (KPI cards + charts) | WS, inline Recharts |
| Admin Dashboard | `/admin/dashboard` | Dashboard (KPI cards + chart) | AS, inline Recharts |

## 2. Residents & Households

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Residents List | `/woreda/residents` | List/filter/export | WS, duplicated toolbar markup |
| New Resident | `/woreda/residents/new` | 4-step form | WS, `ResidentWizardSteps` (Wiz) |
| Resident Profile | `/woreda/residents/$id` | Detail w/ 6 tabs | WS |
| Edit Resident | `/woreda/residents/$id/edit` | 4-step form | WS, Wiz |
| Print Resident Profile | `/woreda/residents/$id/print` | Print document | Print |
| Households List | `/woreda/households` | List/filter/export | WS, duplicated toolbar |
| New Household | `/woreda/households/new` | Form (single page, sectioned) | WS |
| Household Detail | `/woreda/households/$id` | Detail w/ 2 tabs | WS |
| Edit Household | `/woreda/households/$id/edit` | Form (single page, sectioned, 2 fields locked) | WS |
| Print Household Profile | `/woreda/households/$id/print` | Print document | Print |

## 3. Credentials

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Credential Requests List | `/woreda/credentials` | List/filter/export | WS, duplicated toolbar |
| New Credential Request | `/woreda/credentials/new` | Form (guarded on resident state, radio-tile type picker) | WS |
| Credential Request Detail | `/woreda/credentials/$id` | Detail, stacked workflow cards (verify→approve→pay→sign→issue→revoke) | WS |
| Credential Print | `/woreda/credentials/$id/print` | Physical CR80 card print (front/back) | Custom print surface, not `PrintDocumentShell` |
| Credential Verify (staff) | `/woreda/credentials/verify` | Scanner tool (camera/upload tabs) | WS |
| Public Card Verify | `/v/$token` | Public verification result | Public |

## 4. Civil Registration

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Civil Events List | `/woreda/civil` | List/filter/export | WS, duplicated toolbar |
| New Birth / Death / Marriage / Divorce | `/woreda/civil/{type}/new` (×4) | Form (sectioned, resident-or-manual picker) | WS |
| Civil Event Detail | `/woreda/civil/$eventId` | Detail, stacked verify→approve cards | WS |

## 5. Service Requests, Complaints & Approvals

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Service Requests List | `/woreda/services` | List/filter/export | WS, duplicated toolbar (shared `ServiceRequestList`) |
| Complaints List | `/woreda/complaints` | Same list, `category=complaint` | WS, same shared component |
| New Service Request/Complaint | `/woreda/services/new` | Form (dynamic service-type dropdown) | WS |
| Service Request Detail | `/woreda/services/$id` | Detail, stepper + stacked action cards | WS |
| Service Letter Print | `/woreda/services/$id/print` | Print document (letterhead) | Print |
| Public Letter Verify | `/verify/letter/$token` | Public verification result | Public |
| Approval Queue (unified inbox) | `/woreda/approvals` | List (read-only triage table, deep-links out) | WS, duplicated toolbar |

## 6. Rental Houses

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Rental Houses List | `/woreda/rental-houses` | List/filter/export | WS, duplicated toolbar |
| New Rental House | `/woreda/rental-houses/new` | Form (single page) | WS |
| Rental House Detail | `/woreda/rental-houses/$id` | Detail + occupancy history table + dialogs | WS |
| Edit Rental House | `/woreda/rental-houses/$id/edit` | Form (single page) | WS |
| New Occupant (full intake) | `/woreda/rental-houses/occupants/new` | Long form (5 sections incl. document upload, dynamic member table) | WS |
| Occupant Profile Print | `/woreda/rental-houses/$id/occupant-print` | Print document | Print |
| Rental Requests List | `/woreda/rental-houses/requests` | List/filter/export | WS, duplicated toolbar |
| Rental Request Detail | `/woreda/rental-houses/requests/$id` | Detail, stepper + verify/approve cards | WS |

## 7. Revenue & Reports

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Revenue List | `/woreda/revenue` | List/filter/export + summary cards | WS, duplicated toolbar |
| Revenue Receipt Print | `/woreda/revenue/$id/receipt` | Print document (receipt) | Print |
| Public Receipt Verify | `/verify/receipt/$token` | Public verification result | Public |
| Reports Dashboard | `/woreda/reports` | Dashboard (6 tabs, charts + presets) | WS, inline Recharts |
| Report Print | `/woreda/reports/$type/print` | Print document | Print |

## 8. Audit & Settings

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Audit Trail | `/woreda/audit` | List/filter/export | WS, duplicated toolbar |
| Settings (redirect) | `/woreda/settings` | — (redirects) | — |
| Users & Permissions | `/woreda/settings/users-permissions` | 2 tabs: permission matrix + user roster | WS |
| Woreda Configuration | `/woreda/settings/woreda-configuration` | 5 tabs (profile, images, numbering, fees, letters) | WS |

## 9. Admin Console (English, per `CLAUDE.md` convention — stays English)

| Screen | Route | Pattern | Shell/Component |
|---|---|---|---|
| Platform Overview | `/admin/dashboard` | Dashboard | AS, inline Recharts |
| Tenant Management | `/admin/tenants` | List + tab (tenants/users) | AS, duplicated toolbar |
| Tenant Detail | `/admin/tenants/$id` | Detail, stacked cards, module toggles | AS |
| Provision Tenant Admin | `/admin/tenants/$id/provision` | 4-step wizard | AS, own stepper (not `ResidentWizardSteps`) |
| ID Card Template Editor | `/admin/credential-template` | Visual drag/resize canvas editor | AS, bespoke canvas UI |
| Console Roles & Users | `/admin/console-roles` | Permission-grid matrix | AS |
| Platform Audit Trail | `/admin/audit` | List/filter/export | AS, duplicated toolbar |

**Totals**: 55 route files. 4 public/unauthenticated screens, ~4 dashboards, ~16 list screens, ~13 forms
(4 of which are multi-step wizards), ~13 detail/profile screens, ~8 print documents, 2 permission-matrix
settings screens, 1 bespoke canvas editor.

See `ux_pattern_map.md` for how these collapse into five reusable clusters, and
`ux_audit_findings.md` for the per-cluster Clarity/Deference/Depth scoring.
