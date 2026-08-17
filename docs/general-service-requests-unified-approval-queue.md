# General Service Requests + Unified Approval Queue

Two new modules: a **Service Requests** desk (letters/evidence requests and citizen complaints), and a **unified Approval Queue** inbox that gathers everything waiting for staff action across the whole portal.

## 1. Service Requests (አገልግሎት ጥያቄዎች)

### Service catalog (configurable, not hardcoded)
A new Settings tab lets admins define the service types offered by the woreda, so new letter kinds can be added without code changes. Each service type has:
- Amharic + English name, short code, category (`letter` or `complaint`)
- Fee amount (0 = free), whether it requires payment before issuance
- Whether it requires supervisor approval, required attachment checklist
- Active/inactive flag

Seeded examples: Unemployment Evidence Letter (የስራ አጥነት ማረጋገጫ), Income/No-Income Letter, Marital Status Letter, Guarantee/Warranty Letter, Residence Confirmation, Recommendation Letter, Business Support Letter, plus complaint categories (land/house dispute, service delay, staff misconduct, utility/infrastructure, other).

### Request lifecycle
```text
draft → submitted → under_review → pending_approval → approved
                        ↑ returned        ↑ approval_returned
                                          ↓ rejected
approved → awaiting_payment (if fee > 0) → paid → issued → closed
complaints: approved → in_progress → resolved | closed
```
Same stage/return/reject vocabulary as the existing credential workflow, so staff see a familiar stepper.

### Pages
- `/woreda/services` — list with tabs **Letters** / **Complaints**, plus the standard toolbar the other tables already use (debounced search, status + service-type + kebele filters, sortable columns, URL-persisted pagination, CSV/PDF export, skeleton/empty/error states).
- `/woreda/services/new` — intake form: resident picker (reuses `ResidentSearchPicker`), service type select, purpose/addressed-to ("ለ ማን ይቀርባል"), free-text details, attachment uploads, priority. Complaints add: subject, respondent/party, incident date and place.
- `/woreda/services/$requestId` — workflow detail page with stage stepper, verification checklist, return/reject with reason, approve action, payment + receipt panel, attachments, and a full status-history timeline.
- `/woreda/services/$requestId/print` — printable bilingual letter for letter-type requests: woreda letterhead (logo, name, address, phone from Settings), reference number and Ethiopian date, body text composed from the service type + request fields, stamp and supervisor signature images from Settings, signature block. Print via the existing print/PDF path.

### Money
Fees flow through the existing revenue system: on approval, if the service type has a fee, a payment row is created with the new `service_request_id` link and a receipt is issued, so the request appears in Revenue and daily reconciliation with no separate accounting.

### Navigation
Sidebar entries: **አገልግሎት ጥያቄዎች / Service Requests** and **ቅሬታዎች / Complaints** (same list page, pre-filtered category), gated by the new permissions and by a `services` module flag in tenant module config.

## 2. Unified Approval Queue

`/woreda/approvals` — one inbox of everything awaiting action by the signed-in user, pulled from the five workflow tables (service requests, credential requests, civil events, rental occupancy requests, and returned items needing rework).

- **Summary chips** at the top: My queue, Verification, Approval, Payment, Returned, Overdue — each with a live count.
- **Rows** show: type badge, reference number, subject (resident/house/event), current stage, requester, age in days (SLA colour: green < 3d, amber 3–7d, red > 7d), and an action button that deep-links to the item's own workflow page.
- **Filters**: work type, stage, kebele, date range, service type — plus the shared search/sort/pagination/export toolbar.
- **Role awareness**: users with verify permissions see verification-stage items; users with approve permissions see approval-stage items; finance users see awaiting-payment items. Supervisors see everything in their woreda.
- **Bulk approve** for same-type, same-stage selections, with a confirm dialog and one audit entry per item.
- Dashboard gets a "Pending my action" card linking into the queue, and the sidebar entry shows a badge count.

### How requests flow into the queue
Submitting any request only sets its status; the queue is a **read model** — no duplicated rows to drift out of sync. A database view unions the pending rows from all workflow tables into one shape (work type, id, reference, stage, kebele, requester, created/updated timestamps), filtered by the current user's woreda and permissions. So anything submitted anywhere in the portal appears in the queue immediately, and disappears the moment it is approved, rejected, or closed.

## Technical notes

- **Migration**: `service_type` (catalog), `service_request`, `service_request_attachment`, `service_request_status_history`, `service_request_sequence` + reference-number trigger (`{WOREDA}-SRV-YY-#####`); `service_request_id` column on `payment`. All with GRANTs, RLS scoped by `woreda_id` via `get_user_woreda_id()`, write policies via `user_has_perm`, and `force_actor_columns` triggers on actor/verifier/approver fields so those can't be client-forged. New permission keys (`service.create/read/verify/approve/issue`, `complaint.manage`, `approval.queue.view`) added to `default_role_perms` and the RBAC settings tab.
- **Approval queue view**: `approval_queue_v` as a `security_invoker` view unioning `service_request`, `credential_request`, `vital_event`, and `rental_occupancy_request` pending stages, so existing RLS applies unchanged.
- **Frontend**: reuses `TableToolbar`, `TableStates`, `TablePagination`, `useUrlPagination`/`useUrlSort`/`useUrlSearchTerm`, `KebeleFilter`, `tableExport.ts`, `EthiopianDateInput`, and the existing stage-card pattern from the credentials detail page. Letter printing reuses the branding hook and canvas/print utilities already in place.
- Attachments go to a new private `service-request-documents` bucket with the same `woreda_id/` first-folder tenant isolation as existing buckets.
- Every stage transition writes to `audit_log` and to the request's status history, and the Audit Trail deep-link map gains entries for the new record types.

## Suggested build order
1. Migration (tables, view, permissions, bucket, payment link).
2. Settings tab for the service catalog + fee configuration.
3. Service Requests list, intake form, and workflow detail page.
4. Letter print page.
5. Unified Approval Queue + dashboard card and sidebar badge.
