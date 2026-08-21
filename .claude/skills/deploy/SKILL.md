---
name: deploy
description: Deploy this project — database migrations and seed data to Supabase, Edge Functions, and the frontend to Vercel. Use when asked to deploy, ship, release, push to production, apply migrations, or deploy Edge Functions.
---

# Deploying the woreda portal

Four independent artifacts. Nothing deploys the others, and a partial deploy
looks like a working system until someone hits the missing piece.

| Artifact | Applied by | Missing looks like |
|---|---|---|
| Schema + storage policies | `supabase/migrations/*.sql` | relation does not exist |
| Reference data | `supabase/seed.sql` | login works, no permissions resolve |
| Edge Functions | `scripts/deploy-functions.sh` | `404 NOT_FOUND` from `/functions/v1/*` |
| Frontend | `vercel deploy` | stale UI, or a project with no deployments |

Read `CLAUDE.md` first if you are in a sandboxed environment — Postgres ports
are blocked there and the CLIs fail in ways whose error messages point at the
wrong cause.

## Credentials

- `SUPABASE_ACCESS_TOKEN` — Personal Access Token, account-level. Needed for
  migrations via the Management API and for Edge Functions. A project
  `service_role` key **cannot** deploy functions.
- `service_role` key — data-plane only: Auth admin, Storage, PostgREST.
- `VERCEL_TOKEN` — frontend deploys.

**Both `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` are session environment
variables and must never be written into a tracked file, a commit message, or
any output.** See "Deployment credentials never enter the repository" in
`CLAUDE.md` — that rule governs this skill, and the teardown at the bottom of
this file is part of finishing a deploy, not an optional extra.

Confirm a token before using it; a revoked one returns `401` on every endpoint,
including ones that worked minutes earlier. Check the status code, never echo
the token.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://api.supabase.com/v1/projects \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

## Order matters

`app_user` rows reference `woreda`, so seed data comes before users. Storage
policies call `is_super_admin()` and `storage_path_woreda_id()`, so the baseline
comes before the storage migration.

```
00000000000000_baseline.sql → 00000000000001_storage.sql → seed.sql → seed-app-users.sql
```

## Database

Normal path:

```bash
supabase link --project-ref "$REF"
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

Where Postgres ports are blocked, send the same SQL over HTTPS. Serialize the
payload with a real JSON encoder — migration SQL contains quotes and
dollar-quoted function bodies that shell escaping corrupts, and it surfaces as a
confusing SQL syntax error:

```bash
python3 -c "import json;json.dump({'query':open('$FILE').read()},open('p.json','w'))"
curl -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @p.json
rm -f p.json
```

`p.json` is gitignored, but delete it anyway — ignored is not absent, and the
next person to run `git add -f` or archive the directory picks it up.

## Edge Functions

```bash
./scripts/deploy-functions.sh "$REF"
```

`sign-credential` also needs `HARARI_EC_PRIVATE_KEY`, which is not in this
repository. Without it the function deploys and runs but returns
`500 {"error":"Signing key not configured"}`, and ID card issuance fails.

```bash
supabase secrets set HARARI_EC_PRIVATE_KEY='...' --project-ref "$REF"
```

## Frontend

```bash
vercel deploy --prod --yes --archive=tgz --token="$VERCEL_TOKEN"
```

Env vars the build needs: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, plus server-side `SUPABASE_URL`,
`SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Mark the service-role key sensitive; Vercel rejects sensitive vars targeting
`development`, so scope it to production and preview.

## Verify, do not assume

A `201` on a deploy call means it was accepted, not that it works. Check each
artifact at its own surface:

```bash
# schema + seed
"select count(*) from role_permission;"          # expect 972

# edge functions — 401 means deployed, 404 means absent
curl -X POST "https://$REF.supabase.co/functions/v1/invite-tenant-user" \
  -H "apikey: $PUBLISHABLE_KEY" -H 'Content-Type: application/json' -d '{}'

# frontend — confirm the build baked in the right backend
curl -s https://<app>.vercel.app/assets/<entry>.js | grep -c "$REF"
```

For anything auth-related, drive it in a browser with a real session rather
than reading config back. Config that echoes correctly can still behave
differently — see the `redirect_to` note in `CLAUDE.md`.

## Teardown — part of the deploy, not optional

A deploy is not finished when the artifacts are live. It is finished when the
credentials that deployed them are gone from the session:

```bash
unset SUPABASE_ACCESS_TOKEN VERCEL_TOKEN
rm -f p.json payload.json
git status --porcelain --untracked-files=all   # nothing left holding a token
```

Then run the `secret-sweep` subagent before pushing anything from this session.
If a token did reach a commit, **revoke it first and clean up second** — a
secret in a commit object is disclosed whether or not the commit was pushed.
