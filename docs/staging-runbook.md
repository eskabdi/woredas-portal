# Staging runbook

INSA Enforcer Phase 6.1/6.2. This is a runbook for a human operator to
provision an isolated second Supabase + Vercel project for testing — nothing
in this document or `scripts/seed-staging-users.ts` provisions any cloud
infrastructure by itself. Running this is a deliberate go-ahead (a new
Supabase + Vercel project, real cost), not something to trigger opportunistically.

**This app has no staging project today.** Local development and every prior
deploy in this repo's history ran against the single production Supabase
project (see `CLAUDE.md`'s sandboxed-environment notes). `docs/testing-scope.md`
flags this gap; this document is what closes it, once an operator decides to.

## Before you start

> [!WARNING]
> Every step below targets a **new, separate** Supabase project and a
> **new, separate** Vercel project. Never substitute the production project
> ref (`tugzuexfyzbdnghbmrjl`, visible throughout `scripts/*.sh` as the
> worked example) for the staging one in any command here. `scripts/seed-staging-users.ts`
> refuses to run against that ref as a backstop, but the deploy steps below
> have no equivalent guard — a copy-pasted wrong `--project-ref` is the real
> risk, not a code defect, since every command here is otherwise correctly
> scoped to whichever ref you give it.

## 1. Provision the two projects

1. **Supabase**: create a new project in the same region as production (the
   dashboard's "New Project" flow). Note its project ref, database password,
   and region.
2. **Vercel**: create a new project pointed at this same GitHub repository,
   with its own deploy target — do not reuse the production Vercel project's
   env vars or add staging as a second domain on it. Framework preset stays
   `Other` (see `CLAUDE.md`'s Vercel section — this holds for staging too).

Neither step is scripted; both are one-time dashboard actions.

## 2. Deploy the four artifacts

This reuses the `/deploy` skill's own ordering and tooling verbatim, pointed
at the staging project ref instead of production. Re-read `.claude/skills/deploy/SKILL.md`
before running this for real — it is the actual source of truth for these
commands, not this summary:

| Artifact                  | Applied by                                                         | Staging-specific note                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema + storage policies | `supabase/migrations/*.sql`, in numbered order                     | Same migrations, same order, no changes needed.                                                                                                                                            |
| Reference data            | `supabase/seed.sql`                                                | Same file — generic reference data (woredas, fee schedules), no PII.                                                                                                                       |
| Real staff accounts       | `supabase/seed-app-users.sql`                                      | **Skip this file entirely.** It seeds three specific real people's production accounts (see its own header comment) — it has no place in a staging project.                                |
| Edge Functions            | `./scripts/deploy-functions.sh <staging-ref>`                      | Also requires two secrets set on the staging project specifically (below).                                                                                                                 |
| Frontend                  | `vercel deploy --prod --yes --archive=tgz --token="$VERCEL_TOKEN"` | Run with Vercel CLI scoped to the **staging** Vercel project (`vercel link` first, or a separate `VERCEL_TOKEN`/org-project pairing) and env vars pointed at the staging Supabase project. |

Edge Function secrets the invite/activation flow needs to even respond
(without `SITE_URL` set, `invite-tenant-user`/`invite-platform-admin` both
500 with `"SITE_URL is not configured"` — see each function's own source):

```bash
supabase secrets set SITE_URL='https://<staging-vercel-domain>' --project-ref "$STAGING_REF"
```

`sign-credential` additionally needs `HARARI_EC_PRIVATE_KEY` to issue
credentials at all — either provision a **separate** staging EC keypair (do
not reuse production's; see `CLAUDE.md`'s card-signing section for the ES256
requirement) or accept that credential issuance/verification is out of scope
for this staging project.

## 3. Verify each artifact

Same checks the `/deploy` skill's "Verify, do not assume" section already
documents, run against the staging ref instead:

```bash
# schema + seed
"select count(*) > 0 and count(*) = (select count(*) from woreda) * (select count(distinct permission_key) from role_permission) * (select count(distinct role_name) from role_permission) from role_permission;"

# edge functions -- 401 means deployed, 404 means absent
curl -X POST "https://$STAGING_REF.supabase.co/functions/v1/invite-tenant-user" \
  -H "apikey: $STAGING_PUBLISHABLE_KEY" -H 'Content-Type: application/json' -d '{}'

# frontend
curl -sSI "https://<staging-vercel-domain>"
```

## 4. Seed synthetic test accounts

```bash
export SUPABASE_URL=https://<staging-ref>.supabase.co
export SUPABASE_PUBLISHABLE_KEY=<staging anon/publishable key>
export SUPABASE_SERVICE_ROLE_KEY=<staging service_role key>
bun run scripts/seed-staging-users.ts <staging-project-ref>
```

This creates one account per privilege level, matching `docs/testing-scope.md`'s
table:

| Role             | Email                                | Covers                                     |
| ---------------- | ------------------------------------ | ------------------------------------------ |
| `super_admin`    | `staging-super-admin@example.com`    | Full platform console                      |
| `tenant_admin`   | `staging-tenant-admin@example.com`   | Full per-woreda console (Aboker woreda)    |
| `registry_clerk` | `staging-registry-clerk@example.com` | A representative mid-tier operational role |
| `viewer`         | `staging-viewer@example.com`         | Read-only baseline                         |

The script prints a freshly generated password (shared across all four
accounts, printed once, never written to a file or logged elsewhere) at the
end of a successful run. Store it in a password manager for the audit
team's use; it is not a secret credential in the deploy-token sense (these
are throwaway accounts on a throwaway project), but treat it the same way
regardless — don't paste it into a commit, an issue, or this document.

**Why this can't be pure SQL** (see the script's own header comment for the
full reasoning): `invite-tenant-user`/`invite-platform-admin` both require
the caller to already be an active admin, so they can mint every account
_except_ the first one. The script bootstraps that one super_admin directly
via the Auth Admin API — the same pattern `supabase/seed-app-users.sql`
already uses for production's own bootstrap admin, not a shortcut invented
for staging — and creates every other account through the real Edge
Functions, signed in as that bootstrap admin, then activates each one by
signing in as it and calling `activate-invited-user`, the same self-service
path a real invited user's first login takes.

## 5. Tear down (if the staging project is temporary)

If this staging project isn't meant to persist, delete it from the Supabase
and Vercel dashboards directly — there's no scripted teardown, and none is
needed: nothing in this runbook writes anything outside the two projects
created in step 1.

## What this runbook does not cover

- Provisioning is entirely manual (step 1) — there is no Terraform/IaC for
  either platform in this repo.
- Dynamic penetration testing, dependency scanning, and load testing remain
  out of scope for this pass, same as `docs/testing-scope.md` already states.
- A staging `HARARI_EC_PRIVATE_KEY` is optional and not provisioned here —
  see step 2's note.
