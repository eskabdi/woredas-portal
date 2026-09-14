# Task 12-C — offline queue and sync mapping memo

Committed before the code, per the task's own step 1. Two premise
corrections found while investigating, both of which shrank scope in a
real way rather than adding to it — recorded here before the design that
follows, since they explain why the delivered surface differs from a
literal reading of the task brief.

## 0. Premise corrections

1. **"Stack includes PWA/Workbox" is not true today.** Grepped the whole
   repo: no `vite-plugin-pwa`, no `workbox`, no `manifest.webmanifest`, no
   service worker of any kind. This PR builds that infrastructure from
   scratch rather than "wiring" something already there. Given
   `vite.config.ts`'s own documented plugin-order sensitivity (Tailwind →
   TanStack Start → nitro (build only) → React, per `CLAUDE.md`) and that
   `vite-plugin-pwa`'s Vite-integration mode would need to slot into that
   order untested against this exact TanStack Start + Nitro + Vercel
   pipeline, this PR hand-writes a minimal service worker
   (`public/sw.js`, ~40 lines) registered from the client entry, instead
   of adding a new build-time dependency for what the spec actually asks
   for (app-shell precache only, no API caching — a small, auditable
   surface a library would mostly get in the way of controlling
   precisely). This follows the reuse ladder's own ordering: a new
   dependency is the last rung, not the first, for a feature this narrow.
2. **"Stage-2 checklist saves" don't exist as an independent mutation.**
   `ReadOnlyChecklist` (credential detail page) holds checkbox state as
   ephemeral local component state — nothing persists it until the
   officer clicks **Verify**, which writes `verification_checklist`
   together with the status transition in one call
   (`woreda.credentials.$requestId.index.tsx:413`). There is no
   "save checklist without transitioning" action anywhere in this
   codebase to queue. Since Verify is itself an authoritative,
   permission-and-FSM-gated action already on the offline-blocked list,
   queueing "the checklist" separately would mean inventing a mutation
   this app doesn't have. **Scoped out, not implemented** — the checklist
   remains local UI state until the officer is online and clicks Verify,
   exactly as today.

## 1. Persistence: localStorage, not IndexedDB

Chosen by data size, as the task's own step 1 asks: a queued item is a
plain intake-form's field values (strings, numbers, booleans, a handful of
nested objects) or a payment-draft's channel/reference/waiver fields —
never a file blob (uploads require a live network call to Supabase
Storage in every intake form already, so they cannot happen offline
regardless of queue design; an offline submission is created **without**
its attachment, and the officer attaches it after reconnecting once the
row exists — see §2). At that size, IndexedDB's async API and schema
migrations buy nothing a synchronous `localStorage.getItem`/`setItem`
doesn't already give more simply, and this repo already has exactly this
precedent: `src/hooks/useFormDraft.ts`'s wizard-draft persistence
(`wizard-draft:` prefix, per-woreda-namespaced keys, a `clearAll*()`
swept from both shells' sign-out handlers). The offline queue
(`src/lib/offlineQueue.ts`) mirrors that pattern exactly —
`offline-queue:<woredaId>` as the single storage key holding a JSON array,
`clearOfflineQueue()` called from the same two sign-out handlers
alongside `clearAllWizardDrafts()`.

localStorage's known limits (5–10MB depending on browser, synchronous,
per-origin not per-tab) are all acceptable here: a realistic queue depth
(a few dozen intake submissions before a clerk reconnects) is a few KB,
and per-origin (not per-tenant) is why every queue key and every queued
item carries `woredaId` explicitly and the whole queue is wiped on
sign-out — the same cross-tenant-leak reasoning `useFormDraft.ts` already
documents for wizard drafts on a shared kiosk machine.

## 2. Queue item shape

```ts
interface QueueItem {
  id: string; // crypto.randomUUID(), the queue's own key, not a DB id
  woredaId: string;
  entity: "credential_request" | "vital_event" | "service_request";
  action: "submit_intake" | "record_payment_draft";
  payload: Record<string, unknown>; // Zod-validated before enqueue; no File/Blob values ever
  formId: string; // which intake form produced this (e.g. "credential-new", "civil-birth-new")
  createdAt: string; // ISO, for FIFO ordering and display
  attemptCount: number; // incremented on each failed sync attempt, for the status bar
}
```

`submit_intake` payloads are exactly the insert object each online submit
handler already builds (see e.g. `woreda.credentials.new.tsx:429-452`'s
`insertPayload`), **minus** any `storage_path`/attachment fields — those
are set to `null` and the officer is told at sync-success time to attach
the document from the now-existing request's detail page.
`record_payment_draft` payloads carry channel, reference number, and
waiver fields only — never an amount. The fee itself is resolved
server-side at sync time via the same `resolve_*_fee()` RPC the online
path already calls, per the guardrail that nothing client-derived is
trusted; a queued payment cannot "lock in" a fee from before it went
stale.

## 3. Sync ordering and conflict policy

**FIFO, strictly sequential** — `offlineSync.ts` processes one item at a
time, `await`s its result before starting the next, and never runs two
items concurrently. Sequential (not parallel) matters here for a reason
beyond simplicity: several queued submissions can reference the same
resident, and running them out of order or concurrently could let a
later-created dependency (e.g. a household) race a submission that needs
it. FIFO by `createdAt` is also just what a user expects from "my queued
items," displayed in the same order in the status bar.

**Conflict policy: server is the sole authority, unconditionally.** Each
item's handler is a real Supabase call — the exact insert the online path
would have made — so the same triggers, RLS policies, FSM guards, and the
payment-hardening PR's fee/precondition checks all re-run in full. A
rejection (RLS denial, a `RAISE EXCEPTION` from a precondition trigger,
`check_violation`, etc.) is caught, the item is **removed from the queue**
(retrying a request the server has already definitively refused would
just loop the same rejection), and the rejection reason — the server's own
bilingual message where the guard supplies one — is surfaced in a toast
naming the specific queued item's `formId`/subject, never a generic
"sync failed." A transient failure (network error mid-sync, distinct from
a server rejection) leaves the item in the queue for the next sync
attempt instead, with `attemptCount` incremented so the status bar can
show it's been retried.

## 4. Offline-blocked (never queued) actions

Verify, approve, reject, return, record-payment-**confirm** is queued (see
§2) but issuance, print confirmation, activation, revoke, and suspend are
not — every one of these is a `PermissionGate`-wrapped button already;
this PR adds a sibling `useOfflineGuard()` check that disables the same
buttons with a bilingual "ከመስመር ውጭ ነዎት / You are offline" reason when
`navigator.onLine` is false or a lightweight reachability probe to the
Supabase project fails (catches "online per the OS, but this network
blocks the Supabase host" — a captive portal, a corporate proxy). Wired
fully on the credential detail page (every authoritative button); noted
as a fast-follow for civil/service detail pages rather than done in this
PR, since the task's own step 3 scope line ("intake queueing wired for
civil + services") frames those two modules' offline surface as intake
only.

## 5. Lifecycle

- **Sign-out**: `clearOfflineQueue()` added to both shells' `handleSignOut`
  alongside the existing `queryClient.clear()` (F-08) and
  `clearAllWizardDrafts()` — same call site, same reasoning.
- **Auth expired while offline**: sync only ever runs from
  `useOfflineQueue`'s reconnect handler, which calls
  `supabase.auth.getSession()` before touching the queue. A `null` session
  (expired, or never re-authenticated after a long offline stretch) skips
  the sync attempt entirely and leaves the queue untouched — no partial
  sync, no silent drop — and the status bar shows "ለማመሳሰል ይግቡ / Sign in to
  sync" instead of a spinner that never resolves.

## 6. PWA scope actually delivered

`public/sw.js`: precaches only `/` and `/favicon.png` on `install` —
**not** the built JS/CSS chunks. Those are Vite content-hashed and this
file is static (no build-time codegen step generates it), so it cannot
know their per-build filenames without adding exactly the kind of
build-time dependency §0.1 argues against for this narrow a feature; those
hashed bundles are already long-cache-headered and content-addressed, so
the ordinary HTTP cache serves them offline just as well once a client has
loaded them once. The service worker's job is narrower than originally
sketched: fall back to the cached shell document only for a top-level
navigation (`event.request.mode === "navigate"`) when the network request
fails, so a client that has the shell cached can still open the app
offline and let the rest of this PR's own localStorage-backed queue and
auth state take over from there. Every other request — in particular
anything to the Supabase project (`/rest/v1/`, `/auth/v1/`,
`/functions/v1/`, `/storage/v1/`) — is never intercepted at all, which is
what makes "no API response caching" a property of the code, not a policy
note. `CACHE_NAME` is a manually-bumped version string rather than an
auto-embedded build hash (`woreda-portal-shell-v1`) — the browser diffs
this file byte-for-byte on each navigation and only re-runs
install/activate when it changes, and `activate` evicts any cache whose
name doesn't match the current constant. Registered once, client-side
only, from `useServiceWorker()` (mounted in `__root.tsx` alongside
`useAuthBootstrap`); failure to register is swallowed silently since the
app must work identically without a service worker at all.

## 6a. Review findings and how each was handled

`portal-conventions-review` and `tenant-isolation-review` were both dispatched
against this diff. Tenant isolation itself came back clean (per-woreda
localStorage scoping is real, every replayed insert still goes through the
same RLS `WITH CHECK` clause the online path hits, no permission or
authorization shortcut exists) — but both surfaced real correctness bugs in
`offlineSync.ts`, all fixed before this PR:

- **High, fixed**: `syncSubmitIntake`'s `.select()` named both
  `request_number` and `event_number` for every entity, but no table has
  both (`credential_request`/`service_request` have `request_number` only,
  `vital_event` has `event_number` only) — PostgREST's
  `42703 column ... does not exist` made **every** queued intake sync fail,
  and since that error carries a `code`, `isTransient()` treated it as a
  definitive rejection and discarded the item. Fixed by selecting the
  correct column per entity (`ENTITY_NUMBER_COLUMN`); locked in with a new
  `it.each` regression test asserting the exact `.select()` string per
  entity.
- **Medium, fixed**: `syncRecordPaymentDraft`'s two status-transition
  updates (`approved -> awaiting_payment`, `awaiting_payment -> paid`) only
  checked `error`, not the returned row — a repeat of the exact bug CLAUDE.md's
  house rule exists to prevent, and the online `PaymentCard.handleRecord()`
  this function replays already gets right. Both now chain
  `.select(...).maybeSingle()` and fail with a specific message when the row
  didn't match, matching the online path.
- **Medium, fixed**: `syncRecordPaymentDraft` wrote a status-history row but
  no `audit_log` row, unlike the online path (`PAYMENT_COLLECTED`/
  `PAYMENT_WAIVED`) — every offline-originated payment or waiver was invisible
  in `/woreda/audit`. Added the matching audit insert.
- **Low, fixed**: the synced credential-request audit `action_type` was
  `CREDENTIAL_REQUEST_SUBMITTED`; the online form actually writes
  `REQUEST_SUBMITTED` (`woreda.credentials.new.tsx`). Corrected to match.
- **Medium, fixed**: `isTransient()` treated any error carrying a `code` as a
  definitive rejection, which would also discard an item on a JWT-expiry or
  transient Postgres condition (connection/resource/operator-intervention
  classes `08*`/`53*`/`57*`, or `PGRST301`/`PGRST302`). Narrowed to only
  those specific classes; everything else with a code (a real FSM/precondition
  `RAISE EXCEPTION`, a `check_violation`, an RLS denial) is still treated as
  definitive.
- **Low, fixed**: `PaymentCard`'s `canSubmit` gated the Record button behind
  `feeQuery` succeeding, which never happens offline (`resolve_credential_fee`
  needs a network) — the payment-draft offline branch was unreachable. Split
  `canSubmit` so the fee-related checks only apply online; offline gates on
  the same channel/waiver-reason validity the sync engine will itself expect.
- **Low, fixed**: the credential-intake refactor's
  `resident.household.kebele?.kebele_id ?? null` could feed `null` into
  `issuing_kebele_id`, a `NOT NULL` column — previously a live re-fetch made
  this essentially unreachable; now guarded with an explicit pre-submit check
  and a clear bilingual message instead of a raw not-null-violation (which,
  offline, would only surface at sync time as a discarded item).
- **Medium, accepted as a documented limitation, not fixed**: no
  idempotency key ties a queued item to the row it creates. If the app is
  killed between the primary insert succeeding and the item being dequeued,
  the next sync could in principle re-insert. Mitigated (not eliminated) by
  moving the `dequeue()` call to immediately after the row-creating write in
  both `syncSubmitIntake` and `syncRecordPaymentDraft`, before the
  history/audit follow-ups — this shrinks the interruption window to a single
  await, but a true fix needs a server-side idempotency key + unique index,
  which is a schema change out of this PR's scope (client-only, no
  migration). **Watch-list item**: add a `client_queue_item_id` column with a
  unique constraint on the three intake tables in a future migration if this
  proves to matter in practice.
- **Info, not a bug**: while offline, permission resolution falls back to
  the compiled `ROLE_PERMISSIONS` default (F7's existing, documented
  behavior — `current_permissions()` can't be called without a network).
  A user whose tenant or per-user override specifically *denies* a
  permission the compiled default grants could still reach an intake form
  and enqueue an item offline; it is rejected at sync time by the same
  `user_has_any_perm()` check every online insert already goes through, so
  this is not an authorization bypass, but the rejection surfaces through the
  generic sync-rejection toast rather than a permission-specific message.
  Noted for awareness, not treated as a defect.
- **Portal-conventions findings, fixed**: four newly-introduced English-only
  toasts (`"Missing session"` ×4 in the civil forms' offline branches,
  `"Provide mother..."` in the birth form) made bilingual; the hand-rolled
  `<button>` in `OfflineStatusBar`'s "Sync now" control replaced with the
  shared `Button` component for consistency with the rest of `src/components/common/`.

## 7. Auth-expired-while-offline UI

`runSync()` returns `"no-session"` when `supabase.auth.getSession()` comes
back null, distinct from having synced zero items because the queue was
empty. `OfflineStatusBar`'s sync handler (auto-triggered on reconnect, or
the manual "Sync now" button) surfaces that case as its own toast —
"ለማመሳሰል ይግቡ / Sign in to sync — your queued items are still saved" —
instead of the sync button silently doing nothing. The queue itself is
untouched either way: nothing is dequeued or attempted until a session
exists again.
