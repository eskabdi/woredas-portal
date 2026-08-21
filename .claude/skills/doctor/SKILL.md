---
name: doctor
description: Diagnose why the woreda portal is broken, misbehaving, or set up wrong — workspace, backend deployment, and the project's many silent failure modes. Use whenever something "doesn't work", a screen is unexpectedly empty, a query returns nothing, an Edge Function 404s, a deploy looks applied but isn't, a card prints wrong, or a new environment needs checking out. Also use before a deploy to confirm the tree is sane, and when onboarding to this repo.
---

# Diagnosing the woreda portal

## The one thing to understand first

**This project fails silently far more often than it fails loudly.** That is not
sloppiness — it falls out of the architecture. RLS returns an empty result rather
than an error when a policy denies you. `user_has_perm()` returns false for a
`pending` user with no message. A storage object written without its woreda
prefix is simply invisible. A QR printed too dense produces a card that looks
perfect and scans on nothing.

So the instinct that serves you well elsewhere — "no error, so that part is
fine" — is actively wrong here. An empty screen is not the absence of a
symptom; it _is_ the symptom, and it has at least four distinct causes that look
identical from the browser.

Your job is to turn a silent failure into a named one. Diagnose before you fix,
and say which layer is at fault: the workspace, the schema, the seed data, the
functions, the frontend deploy, or the user's own row.

## Step 1 — Workspace

Always start here. It needs no credentials and no network, so it can never make
things worse:

```bash
bash .claude/skills/doctor/scripts/check-workspace.sh
```

It checks the toolchain, dependencies, whether `routeTree.gen.ts` registers
every route, whether every route sets `ssr: false`, which env vars are set
(**names only — it never prints a value**), secret hygiene, and git state. Exit
0 means no failures; warnings are survivable.

Read its FAILs literally. Each one is a silent failure made loud, and each
message says what breaks and why rather than just naming a rule.

## Step 2 — Backend, only if the workspace is clean

These need `SUPABASE_ACCESS_TOKEN` or the project's publishable key. The rule
from `CLAUDE.md` applies with no exceptions: **read tokens from the environment,
check status codes, never echo a value.** A diagnostic that prints a secret has
created a worse problem than the one it was investigating.

The four deploy artifacts are independent — schema, seed, Edge Functions,
frontend — and nothing deploys the others. A partial deploy looks like a working
system until someone hits the missing piece, so check each at its own surface:

```bash
# Token still valid? (status only — never print the token)
curl -sS -o /dev/null -w 'PAT: %{http_code}\n' https://api.supabase.com/v1/projects \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"     # 200 valid, 401 revoked

# Edge Functions: 401 means DEPLOYED (it rejected you with its own error body),
# 404 {"code":"NOT_FOUND"} means ABSENT. This inversion trips everyone.
for fn in sign-credential invite-tenant-user invite-platform-admin resend-platform-invite; do
  printf '%-24s ' "$fn"
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
    "https://$REF.supabase.co/functions/v1/$fn" \
    -H "apikey: $PUBLISHABLE_KEY" -H 'Content-Type: application/json' -d '{}'
done

# Schema + seed, over HTTPS (Postgres ports are blocked in sandboxes)
python3 -c "import json;json.dump({'query':'select count(*) from role_permission;'},open('p.json','w'))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @p.json
rm -f p.json
```

Useful queries when the schema is up but behaviour is wrong:

```sql
select status, count(*) from app_user group by status;        -- pending users?
select count(*) from role_permission;                          -- seed applied?
select woreda_id, module_key, is_enabled from tenant_module_config where not is_enabled;
select tablename from pg_tables t where schemaname='public'    -- tables without RLS
  and not exists (select 1 from pg_policies p where p.tablename=t.tablename);
```

That last one is the highest-value query in this file: a public table with no
policy is readable across every tenant.

## Step 3 — Symptom index

Match the report to a cause before touching anything. Most of these have a
plausible-but-wrong diagnosis that costs an afternoon.

### "Login works, but every screen is empty"

Check `app_user.status` **first**. `user_has_perm()` requires `status = 'active'`,
so a `pending` user authenticates fine and then every query returns nothing with
no message. It looks exactly like a broken permission map, and people rewrite
`ROLE_PERMISSIONS` chasing it. RLS also lets a user read their own `app_user`
row but not write it, so an account cannot activate itself — activation is an
administrator action by design.

If status is `active`, check that the permission has **both halves**: an entry in
`src/config/permissions.ts` _and_ `role_permission` seed rows. The client gate
opening without the database gate produces exactly this.

### "A module is missing from the sidebar"

`tenant_module_config` with `is_enabled = false`. Remember the polarity: a
**missing row means enabled**, so an empty table is not the cause. Super admins
bypass module gating entirely.

### "`404 {"code":"NOT_FOUND"}` from `/functions/v1/…`"

The Edge Functions were never deployed. `supabase db push` and seed files do not
touch them — they are a separate artifact deployed by
`scripts/deploy-functions.sh`. A `401` from the same URL means the function _is_
deployed and merely rejected an unauthenticated call; that is the healthy answer.

### "ID card issuance fails with `500 {"error":"Signing key not configured"}`"

`HARARI_EC_PRIVATE_KEY` is not set as a secret on the `sign-credential`
function. It is not in this repository. The function deploys and runs fine
without it, which is why this surfaces only at issuance.

### "A new route reports `not assignable to type`"

Stale `src/routeTree.gen.ts`. The router plugin regenerates it during
`bun run build` / `bun run dev`, not during `tsc`. The errors look like a
mistake in the new route and are not. Build, then typecheck.

### "The page is blank or shows signed-out content on first paint"

The route is missing `ssr: false`, or the code treats a null `role` as signed
out instead of gating on `isLoading`. The workspace script catches the first.

### "An upload succeeded but nobody can see the file"

The path is missing its `` `${woredaId}/` `` prefix. `storage_path_woreda_id()`
derives the owning tenant from the path, so the object is invisible to its own
woreda. No error is raised. (`credential-templates` is the deliberate exception —
platform-level, bare filename, super-admin write.)

### "Images are broken everywhere"

All seven buckets are private. Reads must go through `createSignedUrl`;
`getPublicUrl` returns a URL that resolves to nothing.

### "The QR or barcode throws instead of rendering"

**That is correct behaviour, not a bug.** Both carry density guards and throw
rather than print a symbol no scanner can read. Do not catch and swallow it —
fix the size. A caught exception here becomes a batch of unscannable government
ID cards.

### "A field is missing from the printed card"

The print container is sized in pixels rather than real millimetres, so
whatever lands outside 85.6×54mm is clipped with no warning. Also confirm the
change touched `PrintableCard` — the `CardFront`/`CardBack` preview is not what
prints.

### "An auth redirect goes to the wrong place"

Two causes that look identical. Either `redirect_to` was nested under `options`
(the server ignores it and falls back to `site_url`), or the URL is not in
`uri_allow_list` (same silent fallback). Check the parameter position before
suspecting the allow-list.

### "`psql` hangs, or a deploy tool times out"

In a sandbox, ports 5432/6543 are blocked and `db.<ref>.supabase.co` is
IPv6-only. Port 443 to the same host is open, which is the tell that it is a
port policy, not a Supabase outage. Use the Management API. If a Management API
call returns `403` with code `1010`, the caller was Python's `urllib` — use
`curl`; retrying with the same tool will not help.

### "Vercel says the project exists but the URL 404s"

`vercel deploy` died partway through the proxy, leaving a project with zero
deployments. Redeploy with `--archive=tgz`. If SSR is broken instead, the
framework preset was set to `vite` — it must stay "Other" (`framework: null`).

### "`bun run lint` reports thousands of errors"

Expected. ~3,459 of ~3,500 are pre-existing `prettier/prettier` formatting, not
anything you did. Lint only your changed files. `bun run format` fixes them all
but touches nearly every file, so it belongs in its own commit.

### "Module resolution errors in a fresh container"

`node_modules` is missing. `bun install`, or let the SessionStart hook do it.

## Reporting

Lead with the diagnosis, not the evidence trail:

```markdown
## Diagnosis

<the named cause, and which layer owns it>

## Evidence

<the specific check output that pins it — not everything you ran>

## Fix

<the command or change>

## Also noticed

<unrelated findings worth knowing, or omit>
```

Two habits that make this skill trustworthy:

**Distinguish "checked and healthy" from "not checked."** If you had no token
and skipped the backend entirely, say that plainly rather than implying the
backend is fine. A confident all-clear over an unexamined layer is worse than
no diagnosis.

**Diagnose before fixing.** Report what is wrong and propose the fix; apply it
only for something unambiguous and local, or once the user says go. Several
causes here look alike from the symptom, and a fix aimed at the wrong one leaves
the real fault in place while making it harder to see.
