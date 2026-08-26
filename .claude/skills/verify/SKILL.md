---
name: verify
description: Build/launch/drive recipe for runtime-verifying a change in the woreda portal against real data — start the dev server against the live Supabase project, reuse a saved browser session, and drive the UI with Playwright under xvfb. Use this before reporting a change verified; it's the cold-start recipe already worked out, not a new investigation.
---

# Runtime-verifying a change in this repo

This app has no test suite (see `CLAUDE.md`). "Verified" means driven live in
a browser against the real Supabase project — there is no separate
staging/sandbox project.

## 1. Point local dev at the real project

`bun run dev` needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` and
there's no `.env` checked in. These two values are the client-exposed anon
key and project URL — not secrets (see CLAUDE.md's known-false-positive
list) — so pull them straight from the deployed bundle rather than asking for
credentials:

```bash
curl -sS https://woredas-portal.vercel.app/ -a "" | strings | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
curl -sS "https://woredas-portal.vercel.app/assets/<that-file>" | grep -oE 'https://[a-z0-9]+\.supabase\.co'
curl -sS "https://woredas-portal.vercel.app/assets/<that-file>" -o /tmp/bundle.js
grep -oE 'sb_publishable_[A-Za-z0-9_.-]+' /tmp/bundle.js
```

Write a local `.env` (gitignored) with those two values plus
`VITE_SUPABASE_PROJECT_ID`, then `bun run build && bun run dev`. Delete `.env`
when done — it's fine to recreate each time, cheaper than tracking it.

**Starting/stopping the dev server:** `pkill -f "vite dev"` can match the
Bash tool's own command line and kill the calling shell instead (exit 144).
Start with `(nohup bun run dev > logfile 2>&1 &)`, stop by PID
(`pgrep -f "node.*vite dev"` then `kill <pid>`), not by pattern.

## 2. Get a real logged-in session

A saved Playwright `storageState` JSON (captured from a real tenant_admin
login) lives in the session scratchpad from earlier work — reuse it rather
than re-authenticating. It's scoped to the production origin; rewrite the
`origin` field to `http://localhost:5173` before loading it into a local
context:

```python
import json
d = json.load(open("auth_state.json"))
for o in d["origins"]: o["origin"] = "http://localhost:5173"
json.dump(d, open("auth_state_local.json", "w"))
```

If no saved session exists, driving a fresh login is the fallback — but check
for one first, this repo's sessions have consistently kept one warm.

## 3. Playwright launch flags that actually matter here

```js
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: false, // headless can't render/introspect blob: PDF tabs -- see pdf-print-pipeline skill
});
const context = await browser.newContext({
  storageState: "auth_state_local.json",
  ignoreHTTPSErrors: true, // sandbox TLS interception -- ERR_CERT_AUTHORITY_INVALID otherwise
});
```

Run under `NO_PROXY=* no_proxy=* xvfb-run -a node script.mjs`. The proxy
(`HTTPS_PROXY`, explicitly passed to `proxy:` in launch options) sometimes
works and sometimes doesn't reach the real Supabase project from this
sandbox; `NO_PROXY=*` (direct connection, no `proxy:` option at all) has been
the reliable one for both localhost and the real production origin.

Playwright isn't a project devDependency; symlink the global install instead
of trying to install it:

```bash
mkdir -p <scratchpad>/node_modules
ln -sfn /opt/node22/lib/node_modules/playwright <scratchpad>/node_modules/playwright
```

## Gotchas hit while driving this app specifically

- `ResidentSearchPicker` only fires its query at 2+ characters — a 1-char
  search term silently returns zero results, not a slow/empty state.
- Table row navigation is usually `<tr onClick={...}>`, not `<a href>` — a
  `locator('a[href*=...]')` will time out on list pages; click the row
  instead.
- Resident work-info fields (`occupation_status`/`occupation_post`,
  `work_address`, `birth_place`) are frequently null for real residents —
  before treating an empty auto-filled field as a bug, cross-check the same
  resident's own profile page display to see if the source data is actually
  there.
- `service_type.category` categories are `letter` (shown as "Services" in
  the UI) and `complaint` — don't confuse the DB value with the UI label.

## Test-data hygiene

There's no delete UI for rental houses. If a flow needs a *vacant* house
(e.g. the "Assign occupant" dialog only renders for non-occupied houses) and
none exists, creating one is a real, permanent write to production — ask the
user first, and label it unambiguously (e.g. house number `TEST-VERIFY-01`)
so it's easy to spot and remove manually later. Prefer read-only or
cancel-before-submit flows (fill a dialog, observe, hit Cancel) over anything
that writes a row you can't clean up yourself.
