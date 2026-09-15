---
name: fsm-migration
description: Write, dry-run, apply and verify an additive SQL migration against the live Supabase project — the working path for this repo, where `supabase db push` and `db diff` do not function. Use for every migration in the production-readiness fix task (workflow_transition seeds, transition triggers, new tables, CHECK extensions, PII encryption stages).
---

# Landing a migration on this project

`supabase db push` and `supabase db diff` **do not work here.** Two independent reasons,
both permanent:

1. The live database has no `supabase_migrations.schema_migrations` table. The schema was
   built through the dashboard before migration files existed (`CLAUDE.md`, "Database
   migrations"). `db push` has no baseline and would try to replay all 25 migrations
   against a schema that already has them.
2. Postgres ports 5432 and 6543 are blocked from sandboxed agent environments. Port 443
   to the same host is open — which is the tell that this is a port policy, not a
   Supabase problem.

The working path is the **Management API over HTTPS**, already proven by
`scripts/phase-c-apply-migration.sh` (which landed migration 23 on this project).

Project ref: `tugzuexfyzbdnghbmrjl` (woreda-portal-DB). Confirm before every run —
the same token also reaches an unrelated project.

---

## 1. Write it additively

Guardrail 1 of the fix task. New file, numbered after the highest existing migration:

```bash
ls supabase/migrations/ | tail -3    # find the next number
```

Rules that have no exceptions:

- **No `DROP`.** No column rewrites, no constraint removal.
- Trigger and function bodies change **only** via `CREATE OR REPLACE`.
- A status `CHECK` extension must be a **superset** — every value that is legal today
  stays legal. Adding `printing` to `residence_credential` is fine; removing
  `approval_returned` from `credential_request` is not, and would break three live UI
  call sites.
- New tables follow the house pattern: `woreda_id`, RLS enabled, `get_user_woreda_id()`
  in **both** `USING` and `WITH CHECK`, actor columns pinned by `force_actor_columns()`.
- Header comment stating what the migration does, which finding or task it closes, and
  why it is safe to apply to a live system.

Wrap the whole migration in `BEGIN; … COMMIT;` so a failure partway leaves nothing
half-applied — the pattern migration 23 uses.

## 2. Dry-run it against the live schema first

Never apply an unrehearsed migration. Run the identical SQL inside a transaction that
always rolls back — `scripts/run-phase-c-dryrun.sh` is the worked example.

```bash
REF=tugzuexfyzbdnghbmrjl
MIG=supabase/migrations/00000000000026_your_migration.sql

# build the payload with a real serializer — migration SQL contains dollar-quoted
# function bodies and quotes that shell escaping mangles into fake syntax errors
python3 -c "
import json,sys
sql = open('$MIG').read()
open('/tmp/dry.json','w').write(json.dumps({'query': 'BEGIN;\n' + sql + '\nROLLBACK;'}))"

curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/dry.json
rm -f /tmp/dry.json
```

An error here is free. An error after `COMMIT` is an incident.

Use `curl`, never Python's `urllib` — Cloudflare returns `403` code `1010` for the
`Python-urllib` User-Agent. That is not an auth or proxy problem and retrying will not
help.

## 3. Apply it

Same call, without the `BEGIN`/`ROLLBACK` wrapper — the migration supplies its own
transaction. Or reuse the script directly:

```bash
./scripts/phase-c-apply-migration.sh $REF     # for the migration it names
```

For a new migration, copy that script's shape rather than hand-rolling the curl: it
already handles the missing-token case, keeps the token out of the process list, and
never echoes it.

## 4. Verify by query, not by `db diff`

`db diff` is unavailable, so verify each object directly. These are the checks that
substitute for it — run the ones your migration touched:

```bash
q() { python3 -c "import json,sys;open('/tmp/q.json','w').write(json.dumps({'query':sys.argv[1]}))" "$1"
      curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
        -H 'Content-Type: application/json' --data-binary @/tmp/q.json; rm -f /tmp/q.json; }

# tables
q "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
# RLS is on, and the table has policies
q "select relname, relrowsecurity from pg_class where relname='your_table'"
q "select policyname, cmd, qual, with_check from pg_policies where tablename='your_table'"
# triggers
q "select trigger_name, event_manipulation, action_timing from information_schema.triggers where event_object_table='credential_request'"
# a CHECK extension actually widened
q "select pg_get_constraintdef(oid) from pg_constraint where conname='credential_request_status_check'"
# FSM seed landed
q "select entity, from_status, to_status, required_permission, is_system from workflow_transition order by 1,2,3"
```

**The whole-schema drift check** — the substitute for the pre-work `db diff` that
guardrail 19 asks for. This was run on 2026-09-07 and came back clean, 42 tables live
matching 42 in the repo:

```bash
q "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" > /tmp/live.json
python3 - <<'PY'
import json,re,glob
live={r['table_name'] for r in json.load(open('/tmp/live.json'))}
sql="".join(open(f).read() for f in sorted(glob.glob('supabase/migrations/*.sql')))
repo=set(re.findall(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(',sql))
print("repo-only:",sorted(repo-live) or "none")
print("live-only:",sorted(live-repo) or "none")
PY
```

Both lists empty means no drift. Record the output — the fix task's live-verification
criteria want evidence, not an assertion.

## 5. Seed changes are a separate artifact

`supabase/seed.sql` is not applied by a migration. When a task adds permissions or roles,
the seed rows are their own step, and the row count is a useful sanity check:

```bash
q "select count(*) from role_permission"
q "select role_name, count(*) from role_permission group by 1 order by 1"
```

The baseline is 1,512 rows — 6 woredas × 42 permissions × 6 roles. Adding the workflow's
granular permissions and `print_officer` takes it past 3,000. A count that did not move
means the seed never ran.

## 6. Tear the credential down — this is part of the job

From `CLAUDE.md`'s hard rule. Not optional, and not only after a failure:

```bash
unset SUPABASE_ACCESS_TOKEN VERCEL_TOKEN
rm -f p.json payload.json /tmp/dry.json /tmp/q.json /tmp/live.json
git status --porcelain          # nothing untracked holding a token
git diff --cached -U0 | grep -nE 'sbp_[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9_-]{20,}'
```

Then run the `secret-sweep` agent before pushing. A token in a commit object is
disclosed whether or not the commit was pushed — revoke first, clean up second.

## 7. Gates before the PR

```bash
bun run test                     # 76 existing must stay green; only add
bun run build                    # regenerates src/routeTree.gen.ts
npx tsc --noEmit                 # run AFTER build if routes changed
bun run check:role-perms-drift
bun run scripts/generate-permissions-doc.ts --check
```

Then dispatch the reviewer that matches what changed — `workflow-fsm-review` for an FSM
or trigger, `rbac-escalation-review` for permissions or roles, `tenant-isolation-review`
for a new table or policy. The `review` skill's dispatch table has the full mapping.

## Common failures

| Symptom                                                           | Cause                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `syntax error at or near "$"`                                     | Payload built with shell escaping instead of a JSON serializer — dollar-quoted function bodies get mangled    |
| `403` with Cloudflare code `1010`                                 | Request sent from Python `urllib`. Use `curl`                                                                 |
| `relation "supabase_migrations.schema_migrations" does not exist` | You reached for `db push`/`db diff`. Use the Management API                                                   |
| Migration applies but the app still fails                         | Seed not run, or Edge Functions not redeployed — they are a separate artifact (`scripts/deploy-functions.sh`) |
| A working button starts raising after an FSM migration            | The seeded FSM omits a status the UI writes. Run `workflow-fsm-review`                                        |
