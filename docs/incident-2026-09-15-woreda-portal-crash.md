# Incident report: every `/woreda/*` page crashed in production

**Date:** 2026-09-15
**Severity:** Critical — every tenant admin/staff user, every woreda, every page under `/woreda/*`
**Status:** Fixed, verified, PR open ([#77](https://github.com/eskabdi/woredas-portal/pull/77)), pending merge
**Detected by:** Owner-requested live investigation ("go live act as tenant admin ... investigate the issue")
**Reported downtime window:** Unknown start; introduced with Task 12-C (offline queue, PR #73, merged before this session). At minimum affected the entire period between that merge and this fix.

## Impact

Any signed-in `tenant_admin` (or any woreda-portal role) landed on `/woreda/dashboard`
immediately after login, or navigated to any other `/woreda/*` route, and got:

> This page didn't load
> Something went wrong. Try refreshing or head back home.

"Try again" and "Go home" did not help — every route under `/woreda/*` hit the same
crash, because the failing component is mounted once for the whole portal shell, not
per-page. The super-admin console (`/admin/*`) was unaffected, since it uses a
different shell.

## Root cause

`src/hooks/useOfflineQueue.ts` (added in Task 12-C, the offline mutation queue) reads
the queue via React's `useSyncExternalStore`:

```ts
const items = useSyncExternalStore(
  useCallback((cb) => (woredaId ? subscribe(woredaId, cb) : () => {}), [woredaId]),
  useCallback(() => (woredaId ? getQueue(woredaId) : []), [woredaId]),
  useCallback(() => (woredaId ? getQueue(woredaId) : []), [woredaId]),
);
```

`getQueue()` → `readQueue()` (`src/lib/offlineQueue.ts`) re-parsed `localStorage` on
**every** call:

```ts
function readQueue(woredaId: string): QueueItem[] {
  try {
    const raw = localStorage.getItem(keyFor(woredaId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch {
    return [];
  }
}
```

Every call allocates a **new** array — even the empty-queue case returns a fresh `[]`
literal each time. React's contract for `useSyncExternalStore`'s `getSnapshot` requires
returning the *same* reference when the underlying store hasn't changed; a snapshot
that changes identity on every read makes React believe the store updated on every
render, and it schedules another render to re-check — forever. React aborts after too
many nested updates with `Invariant Violation: Maximum update depth exceeded` (minified
as `React error #185` in the production bundle) and hands the subtree to the nearest
error boundary, which is exactly the generic `CatchBoundaryImpl` that renders "This
page didn't load."

`OfflineStatusBar` (`src/components/common/OfflineStatusBar.tsx`) is the component that
calls `useOfflineQueue`, and it's mounted once in `WoredaShell.tsx` — the layout every
`/woreda/*` route renders inside. So the crash wasn't specific to the dashboard or any
one page; it took down the entire portal for every woreda, for every role, the moment
`OfflineStatusBar` first tried to read the queue.

A second, related bug in the same file: `enqueue()` mutated the array `readQueue()`
returned in place (`items.push(item)`) before writing it back. This was already
questionable (two callers holding the same array reference, one of them a
`useSyncExternalStore` snapshot, should never see it change under them), and became an
active landmine once the fix below started caching that reference.

## Why it wasn't caught before shipping

Task 12-C's own verification (per its commit and `docs/task12c-mapping-memo.md`) was
`bun run build` + `tsc --noEmit` + the Vitest unit suite — all of which stayed green,
because none of them render `WoredaShell` in a real browser against a real session.
This is exactly the class of failure `CLAUDE.md`'s "this project fails silently" framing
warns about, except inverted: here the failure was loud (an error boundary), but nothing
in the CI/test suite could have seen it, since `ssr:false` means the page only breaks
once hydrated in a real browser with `useSyncExternalStore` actually running.

## Diagnosis path

1. Logged into production (`https://woredas-portal.vercel.app`) as the real
   `tenant_admin` test account via Playwright, per the investigation request.
   Reproduced immediately: `/woreda/dashboard` → error boundary.
2. Production serves a minified bundle, so the only console signal was
   `Error: Minified React error #185` with no component name — not enough to locate the
   bug.
3. Pulled the client-exposed anon key/URL out of the deployed bundle (these are public,
   not secrets — see `CLAUDE.md`'s known-false-positive list), wrote a temporary
   `.env`, and ran `bun run build && bun run dev` locally against the **same real
   Supabase project**, in dev (non-minified) mode.
4. Reproduced the identical crash locally and got the full message:
   `Maximum update depth exceeded` plus `The result of getSnapshot should be cached to
   avoid an infinite loop`, with React explicitly naming
   `The above error occurred in the <OfflineStatusBar> component.`
5. Traced `OfflineStatusBar` → `useOfflineQueue` → `getQueue()`/`readQueue()` and found
   the always-a-new-array bug described above.
6. Deleted the temporary `.env` immediately after use (gitignored, and deploy tokens
   were never involved in this diagnosis — no `SUPABASE_ACCESS_TOKEN`/`VERCEL_TOKEN`
   needed, since nothing here required the Management API or a deploy).

## Fix

`supabase/../src/lib/offlineQueue.ts`:

- `readQueue()` now caches its parsed result per `woredaId`, keyed by the **raw**
  `localStorage` string. A cache hit (string unchanged since the last read) returns the
  exact same array reference; only a genuine change reparses and allocates a new one.
  This satisfies `useSyncExternalStore`'s stability requirement without changing the
  queue's actual behavior or persistence format.
- `enqueue()` no longer mutates the array `readQueue()` handed back — it spreads into a
  new array (`[...readQueue(woredaId), item]`) before writing, matching the existing
  (already-safe) `filter`/`map` pattern already used by `dequeue()` and `bumpAttempt()`.

No schema, API, or persisted-data format changes. Fully backward compatible with
whatever is already sitting in a user's `localStorage`.

## Verification

- Rebuilt in dev mode against the real Supabase project, logged in as the same
  `tenant_admin` account, confirmed `/woreda/dashboard` renders fully (KPI cards, both
  charts, sidebar) with zero console errors.
- Drove 8 additional `/woreda/*` routes (residents, households, credentials,
  civil-registration, rental-houses, services, revenue, reports, settings) via
  Playwright — all render cleanly, no crash, no loop warning.
- Full local gate suite: `bun run build` clean, `npx tsc --noEmit` clean, `bun run test`
  202/202 passing, `bun run lint` 0 errors (8 pre-existing warnings, unrelated).
- `secret-sweep` run before push: PASS — temporary `.env` deleted, no token or
  credential reached the diff or any tracked file.

## Final status

Fix committed (`a1db585`) and pushed to `claude/fix-offline-queue-infinite-loop`;
[PR #77](https://github.com/eskabdi/woredas-portal/pull/77) open against `main`, CI
running. **Not yet merged or deployed to production as of this report** — the live
Vercel deployment (`https://woredas-portal.vercel.app`) still carries the bug until
this PR merges and a new frontend deploy ships. Merge and redeploy are the two
remaining steps to close this incident.

## Follow-up / prevention (not yet actioned — recorded for the go-live declaration)

- No route in this app is rendered against a real, authenticated session as part of
  CI — `bun run test` is unit-only, by design (`CLAUDE.md`, "Commands"). This class of
  bug (an error only a real browser + real hydration path can produce) will keep
  slipping through the same gap until a live-render smoke check exists. The `verify`
  skill already has the recipe (real Supabase project, saved session, Playwright under
  `xvfb`) — the gap is that nothing runs it automatically on every PR.
- Worth a lint/review-time rule of thumb for future `useSyncExternalStore` call sites in
  this codebase: `getSnapshot` must return a cached/stable reference, never derive a
  fresh array/object inline. This is the same shape of bug regardless of which store it
  is next time.
