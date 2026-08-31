# Woreda Portal User Manual (የወረዳ ፖርታል የተጠቃሚ መመሪያ)

This is the operating manual for woreda staff using `/woreda/*` — the
per-tenant side of the app (as opposed to `/admin/*`, the super-admin
console covered in a separate guide). It documents what each module does,
who can use it, and the day-to-day workflow, not the code that implements
it. For architecture and implementation details, see `CLAUDE.md`.

## Before you start

- **Language and dates.** Screens are Amharic-first with English labels
  alongside (e.g. "ስም / Name"). Dates are entered and displayed in the
  Ethiopian calendar, with the Gregorian date shown as secondary.
- **Your account status matters as much as your role.** A newly invited
  account is `pending` until you set your password — the app finishes
  activating it automatically at that point. An account that is
  `suspended` or `inactive` can still sign in but every list will come back
  empty; if a screen you normally use looks blank, check with your woreda
  administrator before assuming something is broken.
- **You only see your own woreda's data.** The portal is multi-tenant —
  every resident, household, credential, and payment belongs to one woreda,
  and the system enforces that separation for you. There is no setting to
  view another woreda.
- **A missing menu item usually means a missing permission, not a bug.**
  Sidebar items only appear if your role includes the permission they
  require (see the role table below). A module can also be switched off
  for your woreda entirely by an administrator (Rental Houses, Service
  Requests, and Approvals are the ones typically toggled); if a module you
  expect is missing, ask whether it's disabled for your woreda before
  assuming your account is misconfigured.

## Roles

| Role | Amharic-facing purpose |
| --- | --- |
| `tenant_admin` | Full control of this woreda: all data modules plus Woreda Configuration and Users and Permissions. |
| `civil_registrar` | Registers residents, issues credentials, records births/deaths/marriages/divorces, issues service letters. |
| `registry_clerk` | Registers residents and households, issues credentials, creates rental-house records and service requests, manages complaints. |
| `finance_clerk` | Collects payments, prints receipts, reads resident/household/credential records for context. |
| `supervisor` | Approves credentials, civil events, service requests, and rental approvals; reads reports and audit trail; does not create records. |
| `auditor` | Read-only across residents, households, credentials, civil events, payments, rental houses, reports; cannot approve or collect. |
| `viewer` | Narrowest read-only role — residents, households, credentials, civil events, services. |

`super_admin` does not operate inside `/woreda/*` day-to-day; it manages
the platform from `/admin/*` (tenants, platform users, the ID card
template) and is not one of the seven operational roles above.

Ask your `tenant_admin` if you need a permission you don't have — role
assignment happens in **Users and Permissions**, not by a request to
support.

## Dashboard (ዳሽቦርድ)

`/woreda/dashboard` — always visible, no permission required. Operational
summary: resident/household counts, new registrations today, pending
approvals, credentials issued this month, revenue today, expired
credentials, and recent audit activity for your woreda. This is the
landing page after login; start here to see what needs attention.

## Residents (ነዋሪዎች)

`/woreda/residents` — requires `resident.read` (create/update need
`resident.create` / `resident.update`).

- The list supports search, status/kebele filters, sortable columns,
  pagination, and CSV/PDF export — all state is kept in the URL, so a
  filtered/sorted view can be bookmarked or shared.
- **New resident** captures identity, household link, and photo (the photo
  is compressed to WebP in the browser before upload).
- The **resident profile** page shows household membership, issued
  credentials, and civil-event history, and has a printable profile.
- Photos and scanned documents are private; the app only ever shows them
  through signed URLs, never a public link.

## Households (ቤተሰቦች)

`/woreda/households` — requires `household.read` (create/update need
`household.create` / `household.update`).

Register households by kebele and house number, track occupancy status
(occupied/vacant/demolished/transferred), and manage resident membership.
Household detail pages have a printable household profile.

## Residence Credentials (የነዋሪ መታወቂያ)

`/woreda/credentials` — requires `credential.read`; module can be disabled
per tenant (`credentials`).

This is the ID card workflow, and it has the most steps of any module:

1. **New request** (`credential.issue`) — pick a resident, a reason for
   issue, and an issuing kebele.
2. **Approval** (`credential.approve`, typically `supervisor`/`tenant_admin`)
   moves a request from `pending_approval` to `approved`.
3. **Print** (`credential.print`) renders the actual card — a QR code and a
   Code 128 barcode encoding the 13-digit credential number, both signed
   server-side so a scanner can verify authenticity offline against the
   printed data. Only the dedicated print surface is sized correctly for a
   physical card printer; the on-screen preview is not what gets printed.
4. **Revoke / renew** (`credential.revoke` / `credential.renew`) handle a
   lost card or an expiring one; every status change is recorded in the
   credential's history.

**Verify ID** (`/woreda/credentials/verify`, `credential.verify`) is the
staff-facing lookup for checking whether a physical card presented to you
is still valid — separate from the public QR-scan verification page anyone
can reach by scanning a printed card.

## Civil Registration (የኩነት ምዝገባ)

`/woreda/civil` — requires `civil.read`; module can be disabled per tenant
(`civil_registration`).

Registers the four vital events — birth, death, marriage, divorce — each
under its own "new" form linked to the relevant resident(s) and household.
Events go through a pending → approved/rejected workflow gated by
`civil.approve` (supervisor/tenant_admin/civil_registrar), and the detail
page shows the full history for one event.

## Kebele Rental Houses (የቀበሌ የኪራይ ቤቶች)

`/woreda/rental-houses` — requires `rental.view`; module can be disabled
per tenant (`rental_houses`).

Manages government-owned rental housing stock: house records, occupants,
and occupancy requests (a resident applying to occupy or vacate a rental
house). Requests go through their own approval step (`rental.approve`,
supervisor/tenant_admin), and vacating a unit (`rental.vacate`) is a
separate action from approving occupancy. `rental.report` (auditor and
above) covers reporting on the housing stock without granting write access.

## Service Requests and Complaints (አገልግሎት ጥያቄዎች / ቅሬታዎች)

`/woreda/services` and `/woreda/complaints` — both require `service.read`;
module can be disabled per tenant (`services`). These share one list page
with a category filter, not two separate systems.

- **Service catalog is configurable, not hardcoded.** The specific letter
  types your woreda offers (unemployment evidence, income letters, marital
  status, etc.) and complaint categories are defined in Settings, with
  Amharic/English names, fees, and whether they need supervisor approval —
  ask your `tenant_admin` if a letter type you need doesn't appear.
- **Intake** (`service.create`) picks the resident, service type, and
  purpose, and attaches supporting documents.
- Requests move through review → (payment, if the service type has a fee)
  → issuance. `service.verify` and `service.approve` gate the review and
  approval steps; `service.issue` finalizes and, for letters, opens the
  print view — a bilingual letter using your woreda's letterhead, stamp,
  and signature images from Settings.
- A request with a fee automatically creates a linked payment, so it shows
  up in Revenue and daily reconciliation without any separate bookkeeping.
- `complaint.manage` is a separate permission from the letter-issuing ones,
  so a role can handle complaints without being able to issue credentials
  or letters, and vice versa.

## Approval Queue (የማጽደቅ ወረፋ)

`/woreda/approvals` — requires `approval.queue.view`; module can be
disabled per tenant (`approvals`).

A single inbox unioning everything waiting on you across the portal:
service requests, credential requests, civil events, and rental occupancy
requests. Summary chips (My queue, Verification, Approval, Payment,
Returned, Overdue) give live counts; each row deep-links to that item's own
workflow page rather than being actionable inline. Check this page first
if you're not sure what needs attention today — it's faster than checking
each module separately.

## Revenue (ገቢ)

`/woreda/revenue` — requires `revenue.view`; module can be disabled per
tenant (`revenue`). Collection needs `revenue.collect`.

Records payments (service fees, house rent, penalties, credential fees)
and issues receipts. `revenue.receipt_reprint` is a separate permission
from printing a receipt the first time, so re-issuing a receipt can be
restricted independently of normal collection duties.

## Reports (ሪፖርቶች)

`/woreda/reports` — requires `report.view`; module can be disabled per
tenant (`reports`). `report.export` gates CSV/PDF export specifically.

Printable/exportable A4 reports across the portal's modules, all pulling
your woreda's own branding (logo, name, stamp) via the shared reporting
helper — the same branding source as printed credentials and letters.

## Audit Trail (ኦዲት)

`/woreda/audit` — requires `audit.view`; module can be disabled per tenant
(`audit`).

A read-only, append-only log of who did what and when in your woreda —
every create/update/status-change across residents, households,
credentials, civil events, and payments is recorded here automatically.
Nothing in this module can be edited or deleted, by design: it exists to
answer "who changed this and when," not to be corrected after the fact.

## Settings (ቅንብሮች)

Split into two pages, both requiring `tenant.manage`:

- **Woreda Configuration** (`/woreda/settings/woreda-configuration`) — your
  woreda's identity for everything that gets printed or shown publicly:
  name, logo, address, phone, stamp and signature images, letter
  templates, the service catalog, and which optional modules
  (credentials/rental houses/services/approvals/etc.) are switched on.
- **Users and Permissions** (`/woreda/settings/users-permissions`) —
  invite staff, assign one of the seven operational roles above, and
  activate/suspend accounts. Inviting a user sends them a set-password
  link; their account activates itself the moment they use it, so you
  don't need to take a second action after inviting someone.

## Public verification pages

Two pages outside `/woreda/*` exist so anyone — not just staff — can check
whether a document your woreda issued is genuine, by scanning its QR code
or visiting the printed URL directly:

- A printed **residence credential**'s QR points to a page that checks the
  card's signature and its live revocation status — a valid signature
  alone doesn't mean the card hasn't since been revoked.
- A printed **service letter**'s QR points to the equivalent check for
  issued letters.

Neither page requires login; they exist specifically so a third party
(a bank, an employer, another office) can verify a document without staff
involvement.
