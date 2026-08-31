# RBAC, Invitations & Tenant Isolation — Forensic Security Review

**Repo:** eskabdi/woredas-portal
**Branch:** claude/rbac-security-forensic-review
**Reviewed:** 2026-08-31
**Scope:** Invitation & activation flow · RBAC engine · Tenant isolation · Localization

A line-by-line audit of the woredas-portal invitation flow, permission engine, and multi-tenant isolation — tracing the reported "Edge Function returned a non-2xx status code" error and the permission-matrix complaints to their exact root causes, and independently testing the tenant-isolation and privilege-escalation paths the brief asked about.

**Severity roll-up:** Critical: 2 · High: 3 · Medium: 4 · Low: 1 · Informational: 1

> **Rev 2 — 2026-08-31 (editorial pass — no finding's substance changed).** Original review date and footer preserved.
> - Fixed a duplicated §3.2 heading; renumbered Architecture subsections 3.1–3.4 and repaired every §3.x cross-reference and anchor to point at the correct subsection.
> - Reconciled F4's "four" vs. five listed permission keys into one verifiable count ("five permission keys across four feature areas"), grounded in `permissions.ts`'s `NAV_PERMISSION_MAP`.
> - Re-labeled F2's severity as unconfirmed pending a live check, without changing its priority.
> - Added a testable "Verify by" step to every P0/P1 finding and mirrored it as a regression-lock bullet in the Action Plan.
> - Added an audit-trail recommendation to §3.1, grounded in `role_permission`'s actual columns.
> - Added an "Open Decisions" block surfacing two policy choices (override precedence, override lifecycle) the report had been silently assuming — these need an owner's sign-off, not an editor's guess.
> - Added a native-speaker-review caveat beneath both localization tables (no Amharic text was altered).
> - Added an "Out of Scope & Limitations" section.
> - Resolved F11's loose end by inspecting the schema directly — closed, not open — and removed it from the action plan accordingly.
> - Fixed a variable-shadowing bug in F1's illustrative code sample.
> - **Pre-merge verification pass:** confirmed the file is complete (no truncation) and re-verified all three Rev 2 citations directly against the repo — all three held exactly as written, no line-number drift. Found and closed one real gap: the P1 "Audit trail" item was missing the regression-lock bullet every other P0/P1 item carries; added.

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. Detailed Findings
   - [F1 — The non-2xx error, root-caused](#f1--edge-function-returned-a-non-2xx-status-code-is-a-library-default-nobody-reads-past)
   - [F2 — Invite links target no page](#f2--invite-emails-never-tell-supabase-where-to-send-the-user)
   - [F3 — No per-user overrides exist](#f3--per-user-permission-overrides-dont-exist-in-the-schema)
   - [F4 — Permission matrix has drifted](#f4--the-tenant-permission-matrix-is-missing-five-permission-keys-across-four-feature-areas-and-every-new-tenant)
   - [F5 — Toggle silently no-ops](#f5--the-permission-matrix-save-button-reports-success-on-writes-that-touch-nothing)
   - [F6 — False-success toasts elsewhere](#f6--the-same-missing-row-check-pattern-repeats-in-role-changes-and-suspensions)
   - [F7 — Client gate ignores DB grants](#f7--the-uis-permission-gate-never-asks-the-database-what-it-actually-granted)
   - [F8 — Three unsynced permission copies](#f8--three-hand-maintained-copies-of-the-same-rolepermission-matrix)
   - [F9 — English-first labels & errors](#f9--permission-labels-and-system-error-text-are-english-first-and-technical)
   - [F10 — CORS wildcard](#f10--every-edge-function-admits-any-origin)
   - [F11 — Escalation paths, closed](#f11--three-plausible-escalation-paths-traced-and-closed)
3. [Architecture & Design Recommendations](#3-architecture--design-recommendations)
   - [3.1 One source of truth, plus a per-user layer](#31-one-source-of-truth-for-rolepermission-plus-a-real-per-user-layer)
   - [3.2 The client asks the database](#32-the-client-asks-the-database-instead-of-guessing)
   - [3.3 House rule: verify every mutation](#33-house-rule-every-admin-mutation-verifies-what-it-actually-changed)
   - [3.4 Localization Mapping Strategy](#34-localization-mapping-strategy)
4. [Action Plan](#4-action-plan)

Also in this revision: [Out of Scope & Limitations](#out-of-scope--limitations) · [Open Decisions — Require Owner Sign-off Before P2](#open-decisions--require-owner-sign-off-before-p2)

---

## 1. Executive Summary

Every symptom in the brief traces to a specific, reproducible defect — not to a broken RBAC design. In order of how much of the reported pain each one explains:

- **The invite flow's error message is real but useless by construction.** Every one of the six Edge Functions returns a descriptive JSON error body on failure — but the Supabase JS client discards that body the instant the HTTP status is non-2xx, and none of the six call sites in this app read the one property (`error.context`) that still has it. So a caller gets the client library's own hardcoded fallback string, verbatim, for every rejection: a duplicate email, an invalid role, a suspended session, a missing field. See [F1](#f1--edge-function-returned-a-non-2xx-status-code-is-a-library-default-nobody-reads-past).
- **Invite emails don't say where to go.** None of the three invite-sending functions pass a `redirectTo` to Supabase's invite API, so every activation link falls back to whatever Site URL happens to be configured in the Supabase dashboard — not necessarily this app's origin, and never explicitly `/set-password`. See [F2](#f2--invite-emails-never-tell-supabase-where-to-send-the-user).
- **The tenant permission matrix is five permission keys (four feature areas) behind its own product.** The Settings screen that lets a tenant admin customize a role's permissions only shows permission keys that already have a database row — and the seed data backing that table predates Service Requests, Rental Houses, Revenue, and the Approval Queue entirely. Any tenant onboarded since mid-July 2026 gets an empty matrix with no explanation. See [F4](#f4--the-tenant-permission-matrix-is-missing-five-permission-keys-across-four-feature-areas-and-every-new-tenant).
- **Its Save button lies when there's nothing to save.** The toggle handler runs a bare `UPDATE … WHERE` with no upsert and no affected-row check, so for every permission key F4 describes as missing, the toast says "Saved" over a write that touched zero rows. The same missing-row-check pattern recurs in role changes and suspensions elsewhere in the same screen. See [F5](#f5--the-permission-matrix-save-button-reports-success-on-writes-that-touch-nothing), [F6](#f6--the-same-missing-row-check-pattern-repeats-in-role-changes-and-suspensions).
- **Per-user overrides were never built.** The database table backing the permission matrix is keyed by *(tenant, role, permission)* — there is no *user* column anywhere in the schema, the authorization function, or the client. "Change one person's permissions independent of their role" describes a feature this codebase doesn't have yet, not one that's misbehaving. See [F3](#f3--per-user-permission-overrides-dont-exist-in-the-schema).
- **The UI and the database don't ask each other anything.** What a user sees (nav items, buttons, gated pages) comes from a permission list hardcoded at build time; what the database actually allows comes from a per-tenant table an admin can edit live. Those two only agree by coincidence, and F4 shows they've already stopped agreeing for five permission keys. The database side stays safe — see F11 — but the UI can show a control that silently does nothing, or hide one that would have worked. See [F7](#f7--the-uis-permission-gate-never-asks-the-database-what-it-actually-granted).

None of the above is a security exposure in the sense the brief also asked about. The database is the actual authorization boundary in this app by design (RLS, not client code), and it stays correct throughout: every silent failure above fails toward the safe default, never toward over-granting. Three concrete escalation paths were traced by hand against the RLS policies and the console-RBAC guard triggers — a tenant admin promoting another account to `super_admin`, a tenant admin moving a user into a different tenant, and a suspended admin's still-live session retaining privilege — and all three are closed by code already in the repository ([F11](#f11--three-plausible-escalation-paths-traced-and-closed)). The work in front of this team is a reliability and UX problem wearing a security-sounding description, plus one genuinely missing feature (per-user overrides) and a localization pass that hasn't happened yet.

---

## 2. Detailed Findings

Ordered by blast radius, not discovery order. Every claim below was verified by reading the actual code or querying the actual seed data — none are inferred from symptoms alone.

### F1 — "Edge Function returned a non-2xx status code" is a library default nobody reads past

| | |
|---|---|
| **Severity** | 🔴 Critical |
| **Location** | All six `supabase.functions.invoke()` call sites: `UsersRolesTab.tsx:608-627`, `PlatformUsersTab.tsx:294-301, 620-639`, `admin.tenants.$woredaId.provision.tsx:152-163`, `harariCredentialCrypto.ts:87-93`, `set-password.tsx:130-133`. Library: `@supabase/functions-js/.../types.js:67-71`. |
| **Exploitability** | This *is* the literal error the report describes. Not attacker-triggered; fires for any legitimate rejection (duplicate email, wrong role, expired session, one missing field). 100% reproducible on the first failed invite. |

**What's actually happening.** Every Edge Function in this repo returns a real, specific JSON error on failure — e.g. `invite-tenant-user` replies `{"error":"Cannot provision this role through tenant self-service."}` with a `400`. But `FunctionsClient.invoke()` in the installed `@supabase/supabase-js@2.108.2` checks `response.ok` *before* it ever parses the body:

```js
if (!response.ok) {
    throw new FunctionsHttpError(response);   // body never read
}
// ...JSON parsing only happens below this line
```
*(`@supabase/functions-js/dist/module/FunctionsClient.js:270-271`)*

And `FunctionsHttpError`'s message is hardcoded in the library itself:

```js
export class FunctionsHttpError extends FunctionsError {
    constructor(context) {
        super('Edge Function returned a non-2xx status code', 'FunctionsHttpError', context);
    }
}
```
*(`@supabase/functions-js/dist/module/types.js:67-71`)*

The call resolves to `{ data: null, error: FunctionsHttpError }`. Every call site in this app then does the same thing:

```js
if (error || data?.error) {
  toast.error(data?.error ?? error?.message ?? "Failed to send invitation");
}
```
*(`UsersRolesTab.tsx:625-627` — repeated near-verbatim at every other call site)*

Since `data` is always `null` on a thrown `FunctionsHttpError`, `data?.error` is always `undefined`, and the toast always falls through to `error.message` — the hardcoded string, every time, regardless of which of the function's own validation checks actually failed. The real body is still sitting on `error.context`, a `Response` object, and recoverable with `await error.context.json()` — nothing in this codebase calls it.

**Root cause.** Misuse of the Functions client API, repeated at every call site rather than centralized once. This is not a Supabase bug; the library's own JSDoc for `invoke()` documents exactly this pattern and this codebase doesn't follow it.

**Recommended fix.** One shared helper, used everywhere `functions.invoke` is called:

```ts
// src/lib/edgeFunction.ts
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { translateError } from "@/lib/errorMessages";

export async function invokeEdgeFunction<T>(
  name: string,
  body: unknown,
): Promise<{ data: T | null; friendlyError: string | null }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return { data, friendlyError: null };

  let raw: string | null = null;
  if (error instanceof FunctionsHttpError) {
    try {
      const errorBody = await error.context.json();
      raw = typeof errorBody?.error === "string" ? errorBody.error : null;
    } catch {
      /* non-JSON body — fall through to the generic message */
    }
  }
  return { data: null, friendlyError: translateError(raw ?? error.message) };
}
```

Then `translateError()` maps the small, known set of strings these functions actually throw (`"Forbidden"`, `"Missing required fields"`, `"Invalid role"`, GoTrue's `"User already registered"`, …) to Amharic-first copy, with a single generic fallback for anything unrecognized — see [§3.4](#34-localization-mapping-strategy).

**Verify by:** an automated (or staging) test that triggers a rejected invite — e.g. re-inviting an email that's already registered — and asserts the surfaced message is the function's own JSON body text (`"Cannot provision this role…"`, `"Forbidden"`, etc.), never the literal string `"Edge Function returned a non-2xx status code"`.

---

### F2 — Invite emails never tell Supabase where to send the user

| | |
|---|---|
| **Severity** | 🔴 Critical (unconfirmed — verification step below) |
| **Location** | `invite-tenant-user/index.ts:108`, `invite-platform-admin/index.ts:112`, `resend-platform-invite/index.ts:66` — all call `admin.auth.admin.inviteUserByEmail(email)` with one argument. |
| **Exploitability** | Matches "activation links may be invalid" and "invited users may not be able to register" verbatim. Not attacker-triggered; self-inflicted by environment/dashboard drift, and currently unverifiable from the code alone. |

**What's actually happening.** `inviteUserByEmail(email, options)` accepts a second argument carrying `options.redirectTo` (`auth-js/GoTrueAdminApi.js:148-155`). None of the three invite/resend functions pass it. Per Supabase Auth — and per this repo's own `CLAUDE.md`, which already documents the sibling gotcha for `generate_link` — an unset `redirect_to` falls back silently to the project's dashboard-configured *Site URL*, and a URL that isn't in the redirect allow-list is *also* silently replaced by Site URL, with no error surfaced anywhere. Nothing in the codebase pins that target to this app's own `/set-password` route, and nothing verifies it matches the deployed origin.

The frontend has exactly this kind of guard already, for a different surface: `VITE_PUBLIC_SITE_URL` is used instead of `window.location.origin` for the credential QR target, specifically so a card printed from a laptop doesn't carry a dead QR. `VITE_PUBLIC_SITE_URL` is a Vite build-time variable, though — `import.meta.env` — and unreachable from a Deno Edge Function. There is currently no equivalent source of truth on the server side for "where does this deploy live."

**Root cause.** Missing argument, and no Edge Function secret carrying the deploy's own origin for the one place that needs it.

**Recommended fix.**

```ts
const SITE_URL = Deno.env.get("SITE_URL")!;   // e.g. supabase secrets set SITE_URL=https://...

const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
  redirectTo: `${SITE_URL}/set-password`,
});
```

Apply the same change at all three call sites. Keep the dashboard's Site URL and redirect allow-list configured correctly regardless — this is a defense-in-depth pin, not a replacement for that configuration.

The 🔴 Critical grade above is carried on the strength of the code (the missing `redirectTo` is undisputed) rather than a confirmed live failure — the actual Supabase dashboard Site URL was not accessible from this static review, so whether it happens to already point somewhere workable is genuinely unknown. That uncertainty doesn't change the priority: the fix is a same-day, no-schema-change code change either way, so it stays in P0 regardless of what the dashboard turns out to show.

**Verify by:** before treating this as fixed, check the Supabase dashboard's Site URL and redirect allow-list directly, and send one staging invite end-to-end to confirm the emailed link resolves to `{SITE_URL}/set-password` rather than a bare origin or a 404 — this is the one fix in this report that code review alone cannot confirm.

---

### F3 — Per-user permission overrides don't exist in the schema

| | |
|---|---|
| **Severity** | 🟠 High |
| **Location** | `role_permission` table, PK `(woreda_id, role_name, permission_key)` — `baseline.sql:374-381, 603`. `user_has_perm()` — `baseline.sql:1390-1407`. `authStore.hasPermission()` — `authStore.ts:48-52`. |
| **Exploitability** | Functional gap. N/A — nothing to exploit; there is no code path this could route through, in either direction. |

**What's actually happening.** No table, function, RLS policy, or component anywhere in this codebase represents "permission X for user Y, independent of their role." `role_permission`'s primary key has no `user_id` column — it customizes a role for an entire tenant, not one person, and its `role_name` CHECK constraint doesn't even admit `tenant_admin` or `super_admin`. `user_has_perm()` resolves a grant purely from `au.role`. On the client, `UsersRolesTab.tsx`'s only per-person action is `changeRole()` — reassigning someone to a different whole role, never toggling one permission for one person.

This means the brief's premise — "when an admin changes the permissions for a specific user, the changes are not saved" — describes a feature that was never built, not a regression in one that exists. There's no UI to attempt this in, and no table for it to land in even if there were.

**Root cause.** Feature not implemented. The console-permissions system (`console_role` / `console_role_permission`, `00000000000009_console_roles.sql`) proves the team knows how to build a real per-account override — it lets one `super_admin` be scoped to a named subset of console permissions — but that pattern was never extended to tenant-side roles.

**Recommended fix.** Outlined in full at [§3.1](#31-one-source-of-truth-for-rolepermission-plus-a-real-per-user-layer): a new `user_permission_override` table, keyed `(user_id, permission_key)`, consulted by `user_has_perm()` before it falls back to `role_permission` and then `default_role_perms()` — the same three-tier COALESCE chain the function already uses, with one more link at the front.

---

### F4 — The tenant permission matrix is missing five permission keys, across four feature areas, and every new tenant

| | |
|---|---|
| **Severity** | 🟠 High |
| **Location** | `seed.sql` (972 `role_permission` rows, dated `2026-07-11`); `permissions.ts:39-53` (`RENTAL_*`, `REVENUE_*`, `SERVICE_*`, `COMPLAINT_MANAGE`, `APPROVAL_QUEUE_VIEW`); `RolesPermissionsTab.tsx:95-99`; `admin.tenants.$woredaId.provision.tsx:141-159`. |
| **Exploitability** | Not attacker-facing — this is the direct, verified cause of "the permission matrix doesn't reflect what I expect" for the newer modules and any tenant onboarded since mid-July 2026. |

**What's actually happening.** Querying `seed.sql` directly for every distinct `permission_key` it actually seeds turns up `resident.*`, `household.*`, `credential.*`, `civil.*`, `payment.*`, `receipt.print`, `report.*`, `audit.view`, `tenant.*`, `user.manage`, and `platform.manage` — and nothing else. `service.*`, `rental.*`, `revenue.*`, `complaint.manage`, and `approval.queue.view` appear zero times, even though all five are first-class permissions in both `permissions.ts` and the SQL `default_role_perms()` function.

That's five distinct permission-key prefixes, which is where the "five permission keys" in this finding's title comes from; the exec summary instead names four *feature areas* ("Service Requests, Rental Houses, Revenue, and the Approval Queue"), and the two counts are both correct at their own level, not in tension. Cross-checked against `NAV_PERMISSION_MAP` (`permissions.ts:241-355`), the "Complaints" nav item and the "Service Requests" nav item both carry `moduleKey: "services"` — the same tenant-module gate — even though `complaint.manage` and `service.*` are separate permission-key prefixes. So the honest count is five permission keys landing in four module-gated feature areas, not five of either.

`RolesPermissionsTab` builds its entire visible matrix from whatever the DB query returns — never from the permission catalog:

```ts
const permissionKeys = useMemo(() => {
  const keys = Array.from(matrix.keys());   // matrix is built only from fetched `rows`
  keys.sort();
  return keys;
}, [matrix]);
```
*(`RolesPermissionsTab.tsx:95-99`)*

So every one of those five permission groups is simply absent from the Settings screen — not greyed out, not shown as "not yet customizable," just not there. An admin looking for "can Registry Clerks approve rental requests?" finds no such row to even look at.

It's worse for a brand-new tenant. The six woredas in `seed.sql` are exactly the six that predate this feature; the tenant-provisioning wizard (`admin.tenants.$woredaId.provision.tsx`) upserts `tenant_module_config` for the new tenant but never touches `role_permission` at all. Any woreda created since has *zero* rows in that table — the whole matrix renders as an empty grid with no rows and no explanatory empty-state message.

The one piece of good news: because `user_has_perm()` `COALESCE`s a missing row to `default_role_perms(role)`, none of this changes what the database actually allows — every affected tenant is still running the shipped defaults. What's broken is exclusively the ability to *customize away from* those defaults for the newer modules, or for any tenant created recently.

**Root cause.** `role_permission` seed data was a one-time snapshot at a point in time, never revisited as new permission groups shipped; no code path seeds default rows when a tenant is created.

**Recommended fix.** Backfill the five missing permission keys into `role_permission` for the six existing seeded tenants (from `default_role_perms()`, so the backfilled rows match current behavior exactly), and add a seeding step to tenant provisioning — either an explicit insert in `admin.tenants.$woredaId.provision.tsx` alongside the module-config upsert, or a trigger on `woreda` insert — so every tenant, past or future, always has a full, editable matrix. Pair with the catalog-driven UI change in [§3.1](#31-one-source-of-truth-for-rolepermission-plus-a-real-per-user-layer) so a future sixth permission key can't repeat this silently.

**Verify by:** for a tenant provisioned after the fix (or one of the six backfilled tenants), query `role_permission` and confirm all five permission keys (`service.*`, `rental.*`, `revenue.*`, `complaint.manage`, `approval.queue.view`) have a row for every editable role, and that `RolesPermissionsTab` renders all five as visible matrix rows rather than omitting them.

---

### F5 — The permission-matrix Save button reports success on writes that touch nothing

| | |
|---|---|
| **Severity** | 🟠 High |
| **Location** | `RolesPermissionsTab.tsx:114-143`, function `toggle()`. |
| **Exploitability** | The exact, reproducible mechanism behind "an admin changes permissions… the changes are not saved." 100% reproducible for any of the five permission keys F4 identifies, or any permission on a tenant created after the original seed. |

**What's actually happening.**

```ts
const { error } = await supabase
  .from("role_permission")
  .update({ is_granted: next })
  .eq("woreda_id", woredaId)
  .eq("role_name", role)
  .eq("permission_key", key);
if (error) {
  toast.error(error.message);
} else {
  // ...
  toast.success("ተቀምጧል / Saved");
}
```
*(`RolesPermissionsTab.tsx:119-136`)*

This is a plain `UPDATE … WHERE`, never an `upsert`, and the result is never checked for affected rows. PostgREST returns `error: null` whether the `WHERE` clause matched one row or zero. Combine that with F4 — most permission keys, for most tenants, have no row at all — and every toggle of a not-yet-seeded permission is a guaranteed no-op that still renders the green "ተቀምጧል / Saved" toast and calls `invalidateQueries`, which simply re-fetches the same (still empty-for-that-key) state and shows the checkbox as if nothing happened.

**Root cause.** `.update()` used where `.upsert()` was required, with no row-count verification as a backstop.

**Recommended fix.**

```ts
const { error } = await supabase
  .from("role_permission")
  .upsert(
    { woreda_id: woredaId, role_name: role, permission_key: key, is_granted: next },
    { onConflict: "woreda_id,role_name,permission_key" },
  );
```

This alone fixes every affected cell without waiting on the F4 backfill, since `upsert` creates the row on first toggle rather than depending on one already existing.

**Verify by:** in a test tenant, toggle a permission key that has no existing `role_permission` row (any of the five from F4), reload the Settings page, and assert the row now exists in the database and the checkbox reflects the new state. Written as a regression test, this must fail against the current `.update()` implementation and pass once it's an `.upsert()`.

---

### F6 — The same missing-row-check pattern repeats in role changes and suspensions

| | |
|---|---|
| **Severity** | 🟡 Medium |
| **Location** | `UsersRolesTab.tsx:160-183` (`changeRole`), `:185-201` (`suspendUserAction`). |
| **Exploitability** | Edge-case/race-driven rather than directly triggerable, but produces the identical "I changed it and it didn't take" symptom class the brief describes, outside the permission matrix specifically. |

**What's actually happening.** Both functions are the same shape as F5: an `.update()` filtered only by `.eq("user_id", …)`, with `error` checked but the affected row count never verified. `app_user`'s RLS (`app_user_tenant_admin_write`) is correctly scoped to the caller's own tenant and excludes touching other `tenant_admin` rows — which means any time that predicate silently filters the target (a stale row in a second open tab, a race with another admin acting on the same user, the target having just become a `tenant_admin` themselves), the write is a no-op that still shows "ሚና ተቀይሯል / Role updated" or "ተጠቃሚው ታግዷል / User suspended."

The codebase already has the correct pattern, just not applied consistently — `record-login/index.ts:52-59` chains `.select("user_id").maybeSingle()` after its update and explicitly returns a `404` when nothing came back.

**Root cause.** Same anti-pattern as F5, repeated independently at other call sites — a project-wide convention gap rather than one file's bug.

**Recommended fix.** Chain `.select("user_id").maybeSingle()` (or equivalent) after every admin-facing mutation and treat a `null` result as a failure with its own message ("this user could no longer be found / you may no longer have permission for this — refresh and try again"), rather than assuming `error === null` means success. Document this as a house rule — see [§3.3](#33-house-rule-every-admin-mutation-verifies-what-it-actually-changed) — so it isn't reintroduced at the next call site.

**Verify by:** construct a case where the RLS predicate silently filters the target row (e.g. call `changeRole()`/`suspendUserAction()` against a `tenant_admin` row, which `app_user_tenant_admin_write` excludes by design) and assert the UI surfaces a failure — not the current success toast — once the fix lands.

---

### F7 — The UI's permission gate never asks the database what it actually granted

| | |
|---|---|
| **Severity** | 🟡 Medium |
| **Location** | `authStore.ts:48-52, 64-73`; `permissions.ts:72-220` (`ROLE_PERMISSIONS`). |
| **Exploitability** | Correctness/UX, not a security hole; the database stays authoritative and safe throughout (see F11). |

**What's actually happening.**

```ts
hasPermission: (permission) => {
  const { role } = get();
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
},
```
*(`authStore.ts:48-52`)*

`hasPermission()` — and therefore every `<PermissionGate>`, every nav item in `NAV_PERMISSION_MAP` — is computed purely from a map hardcoded at build time. It never queries `role_permission`. A tenant admin's customization in Settings changes what the database will actually execute (via `user_has_perm()`) but never changes what the interface shows, in either direction:

- **Revoke a permission via Settings** (for one of the rows that does exist, per F4/F5) → the client still thinks it's granted, so the nav item and button keep appearing to everyone with that role. They click it, and the query silently comes back empty under RLS — no error, just a confusing blank screen, the exact "RLS returns empty, not an error" trap this codebase's own documentation already names as its most common failure mode.
- **Grant a permission via Settings** that isn't in the hardcoded default → nothing appears on screen, because the UI gate that would show the corresponding control never asked the database. The customization is real and the database will honor it, but there is no way to reach it through the interface.

This is the mechanism behind "users assigned to a role do not reliably receive the permissions tied to that role" — read literally, that's true of the *client*, not the database.

**Root cause.** Two independent authorization surfaces — client `PermissionGate` and server `user_has_perm()` — that only agree when a tenant has never customized `role_permission` away from the shipped defaults. Per F4, that's already false for those five permission keys on every tenant.

**Recommended fix.** Outlined at [§3.2](#32-the-client-asks-the-database-instead-of-guessing): a `current_permissions()` RPC mirroring the console-side `current_console_permissions()` that already does exactly this for the admin console, fetched once at auth bootstrap and stored alongside `role`, with `ROLE_PERMISSIONS` kept only as the compiled-in default a fresh/unconfigured tenant falls back to.

**Verify by:** for a tenant with a live `role_permission` customization, assert the client's resolved permission list (`authStore`) equals what `current_permissions()` returns from the database for that same user — any divergence is exactly the bug this fix closes.

---

### F8 — Three hand-maintained copies of the same role→permission matrix

| | |
|---|---|
| **Severity** | 🟡 Medium |
| **Location** | `permissions.ts:72-220` (TS); SQL `default_role_perms()`, `baseline.sql:1177-1195`; `role_permission` seed rows. |
| **Exploitability** | Process risk, not a live bug on its own (see F4/F5 for what's already live). |

**What's actually happening.** Diffed today's TS `ROLE_PERMISSIONS` against the SQL `default_role_perms()` role by role — `registry_clerk`: 18/18 keys match; `supervisor`: 21/21 keys match. This pair is disciplined *today*, entirely by hand, with nothing enforcing it at build or deploy time. The third copy, the seed data, has already drifted — that's F4. `CLAUDE.md` itself names this exact risk in prose ("Adding a permission means editing `ROLE_PERMISSIONS` *and* the `role_permission` seed rows") — which is correct, and exactly the kind of manual step that gets skipped under deadline, as F4 shows it already has been.

**Root cause.** No single source of truth; process discipline substitutes for a mechanism.

**Recommended fix.** See [§3.1](#31-one-source-of-truth-for-rolepermission-plus-a-real-per-user-layer) — generate the SQL default function and the seed-time defaults from `permissions.ts` rather than hand-duplicating a third and fourth time.

---

### F9 — Permission labels and system error text are English-first and technical

| | |
|---|---|
| **Severity** | 🟡 Medium |
| **Location** | `RolesPermissionsTab.tsx:37-65` (`PERMISSION_LABELS`); every `functions.invoke` fallback string; zod messages in `login.tsx:22-24`, `set-password.tsx:23-28`. |
| **Exploitability** | A real, systemic usability gap for the primary user base, distinct from F1. |

**What's actually happening.** Even after F1 is fixed and the real error body reaches the user, most of what would then be shown is still developer-facing English — GoTrue text like `"User already registered"`, Postgres constraint fragments, this codebase's own English-only fallback strings ("Failed to send invitation", "Invalid role"), and zod's default English validation copy. The permission matrix's own row labels (`"Create"`, `"Read"`, `"Approve"`…) are English-only; only the role *column headers* in that same table are bilingual.

**Root cause.** No localization layer for either permission labels or system messages — bilingual copy exists only where a developer wrote it inline, table by table.

**Recommended fix.** A single mapping layer, detailed with concrete examples at [§3.4](#34-localization-mapping-strategy), feeding both `PERMISSION_LABELS` and the `translateError()` function F1 introduces.

---

### F10 — Every Edge Function admits any origin

| | |
|---|---|
| **Severity** | ⚪ Low |
| **Location** | All six `functions/*/index.ts`, `CORS_HEADERS["Access-Control-Allow-Origin"] = "*"`. |
| **Exploitability** | Hardening, not a live hole. Not exploitable today: every function requires a bearer JWT the calling page must already hold, and CORS does not leak or forge that token to a third-party origin. |

**What's actually happening.** All six functions admit cross-origin requests from any page, unconditionally. Harmless given the bearer-token (not cookie) auth model, but inconsistent with the narrow, explicit allow-list discipline this codebase already applies to Supabase Auth redirect URLs.

**Recommended fix.** Replace `"*"` with an explicit allow-list built from `VITE_PUBLIC_SITE_URL`/the deployed origin(s) actually in use, mirroring the redirect-URL allow-list pattern already documented in `CLAUDE.md`.

---

### F11 — Three plausible escalation paths, traced and closed

| | |
|---|---|
| **Severity** | 🔵 Informational |
| **Location** | `00000000000012_enforce_console_rbac.sql` (`guard_console_role_assignment`); `app_user_tenant_admin_write` RLS, `baseline.sql:1551`. |
| **Exploitability** | None found. Recorded so these aren't re-opened as unanswered questions. The one loose end this finding used to flag has since been checked directly and is closed — see below. |

**Paths tested:**

1. **Tenant admin self-escalating to super_admin.** `app_user_tenant_admin_write`'s `WITH CHECK` only excludes setting `role = 'tenant_admin'` — in principle nothing stops a raw `PATCH` setting `role = 'super_admin'` on another account in the same tenant. In practice, `guard_console_role_assignment` intercepts every role transition into `super_admin` (including the `NULL→NULL console_role_id` case that would otherwise slip past its own "column unchanged" short-circuit) and requires the caller to already hold `console.console_users.manage` via `user_has_console_perm()` — which a tenant admin, not being a `super_admin` at all, can never satisfy. **Closed.**
2. **Moving a user into a different tenant.** `app_user_tenant_admin_write`'s `WITH CHECK` pins `woreda_id = get_user_woreda_id()` on the new row, and its `USING` pins the same on the old row — a tenant admin can neither move a user out to another tenant nor reach a user already in one. **Closed.**
3. **A suspended admin's still-live session retaining privilege.** `is_super_admin()` and `is_tenant_admin()` originally checked only `role`; `00000000000011_status_check_admin_helpers.sql` added the `status = 'active'` requirement both functions were missing, matching what `user_has_perm()` already enforced. Applied consistently as the current live definition (later migrations supersede the baseline via `CREATE OR REPLACE`). **Closed.**

**Loose end, now closed.** This finding originally flagged that `app_user_tenant_admin_write`'s `INSERT` path doesn't itself constrain `user_id` to a genuinely new identity — there's no explicit application-level check that the target `auth.users` id doesn't already carry an `app_user` row — and left open whether a `UNIQUE`/PK constraint on `user_id` would catch that collision at the database level regardless. It does: `baseline.sql:533` reads `ALTER TABLE public.app_user ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);`. A `user_id` already present in `app_user` — whether in the caller's own tenant or another — makes any `INSERT` attempting to reuse it fail on the primary key, loudly, regardless of RLS. **Closed**, no migration or follow-up needed.

---

## 3. Architecture & Design Recommendations

Four structural changes. The first two together resolve F3, F4, F5, F7, and F8; the third is F6's fix generalized into a rule; the fourth is F9's mapping strategy in detail.

### 3.1 One source of truth for role→permission, plus a real per-user layer

Make `permissions.ts` the only *hand-written* copy. Generate the SQL `default_role_perms()` function and the initial `role_permission` seed rows from it (a small build/deploy-time script), rather than maintaining three independent copies as today.

- Seed `role_permission` for every tenant — old and new — from `default_role_perms()`: a backfill migration for the six existing woredas, and a seeding step added to tenant provisioning (a DB trigger on `woreda` insert is the more durable option, since it can't be forgotten by a future second provisioning entry point).
- Change `RolesPermissionsTab` to enumerate the *full* `P` catalog, not just existing rows, with a visible "using the default" indicator for any cell that hasn't been explicitly overridden yet — this makes a sixth permission group's arrival self-evident in the UI instead of silently invisible, closing the F4 failure mode structurally rather than just backfilling today's gap.
- Add a real per-user override table:

  ```sql
  CREATE TABLE public.user_permission_override (
    user_id uuid NOT NULL REFERENCES app_user(user_id),
    woreda_id uuid NOT NULL REFERENCES woreda(woreda_id),
    permission_key text NOT NULL,
    is_granted boolean NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES app_user(user_id),
    PRIMARY KEY (user_id, permission_key)
  );
  ```

- Extend `user_has_perm()`'s existing `COALESCE` chain with one more link, checked first:

  ```sql
  COALESCE(
    (SELECT upo.is_granted FROM user_permission_override upo
      WHERE upo.user_id = au.user_id AND upo.permission_key = _perm),
    (SELECT rp.is_granted FROM role_permission rp
      WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
        AND rp.permission_key = _perm),
    _perm = ANY (default_role_perms(au.role))
  )
  ```

  RLS on the new table mirrors `role_permission`'s tenant-admin-writes-own-tenant pattern, scoped further to the target user's own `woreda_id`.

- **Audit trail.** `role_permission`'s own columns (`baseline.sql:374-381`) carry `created_at`/`updated_at` but no `updated_by` — there's no column-level record of *who* changed a grant. The application layer only partially compensates: `RolesPermissionsTab.toggle()` inserts a matching `audit_log` row (`entity_name: "role_permission"`, `action_type: "ROLE_PERMISSION_UPDATED"`) whenever the update call returns `error: null` — but per F5, a silently-no-op update *also* returns `error: null`, so today's audit trail can log a change that never actually happened, which is worse than no trail at all for exactly the toggles F5 breaks. Two changes, both cheap: (1) add `updated_by uuid REFERENCES app_user(user_id)` to `role_permission` itself, so a row carries its own provenance instead of depending entirely on a separate table staying in sync; (2) once F5 lands, gate the `audit_log` insert on the `.upsert()` call's confirmed result, not on `error === null` alone, or the fix for F5 won't fix the audit trail's own version of the same bug. Give the new `user_permission_override` table the same discipline from day one — its sketch above already carries `updated_by`; make sure whatever writes to it also verifies the write before logging it.

### 3.2 The client asks the database, instead of guessing

Add a `current_permissions()` RPC that mirrors `current_console_permissions()` (already shipped for the admin console) — resolves the caller's effective permission list server-side, honoring the same three-tier chain above. Fetch it once at auth bootstrap, store it in `authStore` alongside `role`, and have `hasPermission()` read that list first, falling back to the compiled-in `ROLE_PERMISSIONS[role]` only while the fetch is in flight or for an unconfigured tenant. This closes F7 without weakening RLS — the database stays the enforcement boundary either way; this only fixes what the interface *shows*.

### 3.3 House rule: every admin mutation verifies what it actually changed

Document in `CLAUDE.md`: any `.update()` or `.insert()` in an admin-facing flow that isn't immediately followed by a full page reload must chain `.select(...).maybeSingle()` (or otherwise inspect the returned row/count) and treat an empty result as a failure with its own message — never infer success from `error === null` alone. `record-login/index.ts:52-59` is already the correct example to point to. This single rule prevents F5 and F6 from recurring at the next settings screen someone builds.

### 3.4 Localization Mapping Strategy

Amharic-first, without breaking existing role definitions. Two independent mappings — permission labels and system messages — both keyed off the same stable, existing string identifiers already in the database and the code. Neither requires touching `role_permission`, `P`, or any permission key itself; the keys stay exactly as they are today, only their *display* layer changes.

Permission keys (`resident.create`, `credential.approve`, …) and role names (`registry_clerk`, `tenant_admin`, …) are the identifiers every table, function, and RLS policy already agree on. They should never be translated or renamed — only given a second, Amharic-first label wherever they're rendered. A single lookup file does this for the whole app:

**`src/config/permissionLabels.ts` — excerpt, plain-language not literal**

| Permission key | Amharic (primary) | English (secondary) |
|---|---|---|
| `resident.create` | አዲስ ነዋሪ መመዝገብ | Register a new resident |
| `resident.delete` | የነዋሪ መዝገብ ማጥፋት | Delete a resident's record |
| `credential.issue` | የመታወቂያ ካርድ ማውጣት | Issue an ID card |
| `credential.approve` | የመታወቂያ ጥያቄ ማጽደቅ | Approve a credential request |
| `civil.register` | የልደት/ሞት/ጋብቻ ምዝገባ መመዝገብ | Record a birth, death, or marriage |
| `payment.collect` | ክፍያ መቀበል | Collect a payment |
| `rental.approve` | የኪራይ ቤት ጥያቄ ማጽደቅ | Approve a rental house request |
| `approval.queue.view` | የማጽደቅ ወረፋ ማየት | View the approval queue |

*The Amharic above is illustrative — written for this review, not by a native speaker — and must be reviewed by one before any of it ships. Nothing in this table should be treated as final copy.*

The rule for writing these: name the *action a person recognizes doing*, never the code's own vocabulary — "approve a rental house request," not "rental.approve grant." This is the same discipline the existing bilingual UI already applies to nav items and buttons; it just hasn't been applied to the permission matrix's row labels yet.

System messages need a second, smaller mapping — from the small, finite set of strings the Edge Functions and Supabase Auth actually throw, to friendly Amharic-first copy. This is the dictionary `translateError()` (introduced in F1's fix) consults:

**`src/lib/errorMessages.ts` — excerpt**

| Raw string (from body or GoTrue) | Shown to the user |
|---|---|
| `User already registered` | ይህ ኢሜይል ቀድሞ ተመዝግቧል / This email is already registered |
| `Cannot provision this role through tenant self-service.` | ይህን ሚና በዚህ መንገድ መስጠት አይቻልም — ከወረዳ አስተዳዳሪዎ ይጠይቁ / This role can't be assigned this way — ask your tenant administrator |
| `Forbidden` | ይህን ለማድረግ ፈቃድ የሎትም / You don't have permission to do this |
| `Missing required fields` | እባክዎ ሁሉንም አስፈላጊ መስኮች ይሙሉ / Please fill in all required fields |
| `Edge Function returned a non-2xx status code` | የስርዓት ስህተት ተከስቷል፣ እባክዎ ቆይተው ይሞክሩ / Something went wrong — please try again in a moment |

*Same caveat as the table above: this Amharic is illustrative and unreviewed. A native speaker must check it — including tone and register, not just correctness — before it reaches a real error toast.*

The last row matters: it's the deliberate catch-all for anything `translateError()` doesn't recognize — including the library's own generic string, should it ever surface again through a path this review didn't cover. A user should never see raw library or Postgres text, even from an error nobody anticipated.

---

## Out of Scope & Limitations

This was a static review: code, migrations, and seed data were read; nothing was run against a live environment, and every fix above was specified, not executed or tested against a real deployment. Areas this review did not cover, and that should not be assumed clean on the strength of it:

- **Auth-endpoint rate limiting** — brute-force or enumeration resistance on `login`, `set-password`, or the invite functions was not assessed.
- **Dependency/CVE audit** — no scan of `package.json`/`bun.lock` or the Edge Functions' `esm.sh` imports for known vulnerabilities.
- **Secrets handling** beyond the CORS headers covered in F10 — token storage, rotation, and exposure surfaces outside what F1–F11 happened to touch were not swept.
- **Session-revocation breadth** — whether a suspended/deactivated user's *already-issued* JWT can still authenticate requests until natural expiry, versus being revoked immediately, was not tested end-to-end.
- **Load/performance** — no query plans, index review, or behavior under concurrent writes (the `role_permission` toggle race described in F6 is a correctness concern, not a load one).
- **Live Supabase dashboard configuration** — the Site URL and redirect allow-list behind F2 could not be inspected from this review; see F2's verification step.

## Open Decisions — Require Owner Sign-off Before P2

The §3.1 design sketch makes two choices that are policy, not engineering — an editorial pass can point them out but must not make them silently. Both need an explicit answer from whoever owns this system before the `user_permission_override` table or `user_has_perm()` rewrite gets built.

**D1 — Override precedence: does a user-level grant beat a tenant-level deny?**
The `COALESCE` chain proposed in §3.1 checks `user_permission_override` first, then `role_permission`, then `default_role_perms()` — meaning a per-user *grant* wins even over an explicit tenant-level *deny* for that role. Options:
- **(a) User override wins in both directions** (as sketched) — maximal per-person flexibility, and the only option that actually satisfies F3's motivating complaint (an admin restricting *one person* below their role's default). Risk: a standing per-user grant can quietly survive a later tenant-wide lockdown of that permission.
- **(b) Tenant-level deny dominates** — a `role_permission` deny can never be overridden per-user; overrides can only narrow, never re-open, a role-denied permission. Safer against the lockdown scenario, but needs direction-aware logic instead of one priority order, and partially defeats the "restrict one person, independent of role" use case in the other direction (denying one person something their role grants would still work; re-granting something their role denies would not).
- **(c) Overrides are additive-only** — can only grant beyond the role, never restrict below it. Simplest mental model, but does not support removing a permission from one individual without changing their role — the exact scenario the brief's complaint (and F3) describes. Not recommended for that reason.

*Recommendation:* (a), with the explicit caveat written down: a future tenant-wide "kill switch" permission must be checked unconditionally, outside this chain, not modeled as a `role_permission` deny — otherwise it will be silently bypassable by a leftover per-user grant. **This is the owner's call, not this report's.**

**D2 — Override lifecycle: what happens to a user's overrides on role change or offboarding?**
Undefined today because the feature doesn't exist yet; needs an answer before it does.
- *Suspension* is already handled structurally and doesn't need a new decision: `user_has_perm()`'s outer check already requires `status = 'active'` before any of the chain runs, so a suspended user's overrides are inert automatically.
- *Tenant/user removal* — recommend an ordinary `ON DELETE CASCADE` on the new table's foreign keys; this doesn't need owner sign-off, just inclusion in the migration.
- *Role change* is the real open question. Options: **(a)** persist overrides unchanged across a role change — simplest, but can leave stale, forgotten grants or denies that no longer match anyone's intent; **(b)** auto-clear all overrides the moment a user's role changes — clean, but silently discards a deliberate per-person restriction ("this person is not to issue credentials, regardless of role") that an admin may still want kept; **(c)** persist by default, but surface the user's existing overrides in the role-change UI so the admin reviewing the change explicitly confirms or clears them as part of that action.

*Recommendation:* (c) — best matches least-privilege without silently discarding intent — but it commits to extending the role-change flow with a review step, which is a product decision as much as a technical one. **This is the owner's call, not this report's.**

P2 (`user_permission_override`, F3) is gated on D1 and D2 being decided — building the table and the `user_has_perm()` rewrite against an assumed precedence or lifecycle is how this exact kind of silent policy choice gets baked in as if it were never a choice at all.

---

## 4. Action Plan

### P0 — this week (no schema changes, deploy immediately)

Unblocks the invite funnel and the most-used permission toggles. Each item is a single file's worth of change.

- **F1** — Add the shared `invokeEdgeFunction()` helper and switch all six call sites to it.
  - *Regression lock:* automated test — reject an invite (duplicate email) and assert the surfaced message is the function's real error body, never the library's generic string.
- **F2** — Set a `SITE_URL` Edge Function secret; pass `redirectTo` in all three invite/resend functions. Severity is unconfirmed pending a live check (see F2) — stays in P0 regardless, since the fix is free.
  - *Regression lock:* send one staging invite; confirm the emailed link resolves to `{SITE_URL}/set-password`. Also check the dashboard Site URL/allow-list directly — this is the one item on this list code review can't confirm by itself.
- **F5** — Change `RolesPermissionsTab.toggle()` from `.update()` to `.upsert()`.
  - *Regression lock:* toggle a not-yet-seeded permission key, reload the matrix, assert the row now exists and the checkbox state persists. Must fail before the fix, pass after.

### P1 — next sprint (small migration + UI change)

- **F4** — Backfill the five missing permission keys into `role_permission` for existing tenants; add a seeding step for new ones.
  - *Regression lock:* for a backfilled or newly-provisioned tenant, confirm all five keys have rows for every editable role and all five render in the matrix UI.
- **F6** — Add row-verification to `changeRole()`/`suspendUserAction()`; audit the rest of the app for the same pattern.
  - *Regression lock:* mutate a user RLS will silently filter (e.g. target a `tenant_admin` row); assert the UI reports failure, not success.
- **F7** — Ship `current_permissions()` and switch `authStore` to fetch it, keeping the hardcoded map only as a fallback.
  - *Regression lock:* for a tenant with a live customization, assert the client's permission list equals the DB-resolved list from `current_permissions()`.
- **Audit trail** (new, §3.1) — Add `updated_by` to `role_permission`; gate its `audit_log` insert on the `.upsert()` call's confirmed result rather than on `error === null`. Ships alongside F5, same root cause.
  - *Regression lock:* toggle a not-yet-seeded permission key (a guaranteed no-op under the current code) and confirm no `audit_log` row is written for it; then confirm a real toggle still logs correctly once F5's fix lands. `RolesPermissionsTab.tsx:125-134` today inserts the log unconditionally in the `else` branch — i.e. whenever `error` is `null` — so this must fail before the fix and pass after, exactly like F5's own lock.

### P2 — structural (plan, then execute — gated on D1 and D2 being decided by the system owner; see "Open Decisions" above)

- **F3** — `user_permission_override` table, rewritten `user_has_perm()`, and its own settings UI. Do not start the migration until D1 (override precedence) and D2 (override lifecycle) have an owner-confirmed answer.
- **F8** — Generate the SQL default function and seed defaults from `permissions.ts` instead of hand-duplicating.
- **F9** — Full Amharic-first pass over permission labels and system messages, using the mapping strategy in §3.4.
  - *Sub-task:* have a native Amharic speaker review every string before it ships — the copy in §3.4 is this report's own illustrative draft, not reviewed translation.

### P3 — hardening (no rush, no live exposure)

- **F10** — Replace the CORS wildcard with an explicit origin allow-list.

---

*woredas-portal · forensic review · branch claude/rbac-security-forensic-review · 2026-08-31*
