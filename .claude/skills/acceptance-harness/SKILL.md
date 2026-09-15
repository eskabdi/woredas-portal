---
name: acceptance-harness
description: Turn a "Done means" checkbox into recorded evidence — create per-role test users, drive direct PostgREST calls as each role, record PASS/FAIL with command output, then tear the test data down. Use when verifying the production-readiness fix task's acceptance criteria, or any claim that a database gate actually blocks something.
---

# Proving a gate actually holds

Most acceptance criteria in the production-readiness fix task have this shape:

> A `registry_clerk` holding only clerk-level permissions receives a raised exception on
> `PATCH credential_request {"status":"paid"}` from `submitted`.

**The UI cannot prove that.** The UI is what the attacker skips. Finding F-01 existed
precisely because every maker-checker guarantee was a client-side convention — the
buttons were correct and the database was open. A test that clicks the button proves
nothing about the hole.

So the harness drives **PostgREST directly**, as a real user of a real role, and records
what came back.

## The evidence standard

Borrowed from the audit this fix task answers. Every checkbox resolves to one of:

| Verdict        | Means                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| **PASS**       | Executed. Command and output recorded.                                           |
| **FAIL**       | Executed, wrong result. Command, output, and expected result recorded.           |
| **UNVERIFIED** | Could not execute — **with a stated reason**. Never a synonym for "looks right". |

An assertion with no command output is not evidence. Write the command and its response
into the remediation report, not a summary of them.

## 1. Test users, one per role

`scripts/seed-staging-users.ts` already exists and is the intended path. The fix task
needs at least: `registry_clerk`, `civil_registrar`, `finance_clerk`, `supervisor`,
`auditor`, `viewer`, `tenant_admin`, plus `print_officer` (new, per A2) and one user
holding a **custom** tenant role (Task 13).

Two users must share a role where maker ≠ checker is under test — one to verify, a
second to approve. A single user cannot demonstrate that the check fires.

Keep every test user inside one woreda unless the test is specifically about crossing
tenants, in which case create the second user in a different woreda and record both
`woreda_id` values.

## 2. Get a real session token per user

The gates resolve through `user_has_perm()` keyed on `auth.uid()`, so a service-role key
proves nothing — it bypasses RLS entirely. You need each user's own JWT.

```bash
URL="https://tugzuexfyzbdnghbmrjl.supabase.co"
ANON="<publishable key>"

login() {  # login <email> <password>  -> prints access_token
  curl -sS -X POST "$URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}
CLERK=$(login clerk@test.local '<pw>')
```

If a login returns no token, the account is probably `pending` — `user_has_perm()`
requires `status = 'active'`, and a pending user authenticates fine but sees nothing.
Check that before assuming a permission is misconfigured.

## 3. Drive the transition and record the result

```bash
attempt() {  # attempt <token> <table> <id> <json-body>
  curl -sS -w '\nHTTP %{http_code}\n' -X PATCH \
    "$URL/rest/v1/$2?${3}" \
    -H "apikey: $ANON" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
    -d "$4"
}

# F-01's headline case — must RAISE, not succeed
attempt "$CLERK" credential_request "credential_request_id=eq.$REQ" '{"status":"paid"}'
```

**A blocked call and a no-op look identical unless you check.** PostgREST returns
`error: null` whether the `WHERE` matched one row or zero — this is the repo's own
verify-the-mutation house rule, and it applies to tests too. Use
`Prefer: return=representation` and assert on the **returned row**, not on the absence
of an error. An empty array means the write was silently excluded, which for a negative
test is the right outcome but for a positive test is a failure disguised as a pass.

For a gate that should raise, the expected shape is a `4xx` with the trigger's message.
Record both the status code and the message text.

## 4. Verify the side effects, not just the status

A transition that is blocked must leave nothing behind; a transition that is allowed must
write its full trail. After each attempt, query as `service_role` (read-only) and check:

```bash
q() { python3 -c "import json,sys;open('/tmp/q.json','w').write(json.dumps({'query':sys.argv[1]}))" "$1"
      curl -sS -X POST "https://api.supabase.com/v1/projects/tugzuexfyzbdnghbmrjl/database/query" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
        -H 'Content-Type: application/json' --data-binary @/tmp/q.json; rm -f /tmp/q.json; }

q "select status from credential_request where credential_request_id='$REQ'"
q "select count(*) from residence_credential where credential_request_id='$REQ'"   # must be 0 after a blocked paid
q "select old_status,new_status,changed_by_user_id from credential_request_status_history where credential_request_id='$REQ' order by changed_at"
q "select action_type,actor_user_id from audit_log where entity_id='$REQ' order by action_at"
```

The credential-count check is the one that matters most: F-01's damage was not the status
change, it was the `ready_to_print` government ID the trigger minted behind it.

## 5. Cross-tenant checks need before/after counts

For F-03's criteria ("death approval never modifies another woreda's rows"), a spot check
is not enough — take per-woreda counts before and after:

```bash
q "select woreda_id, count(*) filter (where residency_status='deceased') from resident group by 1 order by 1"
```

Run it, perform the action, run it again, diff. Only the acting woreda's number may move.

## 6. Tear it down

Guardrail 20 — no ad-hoc data left on the live project. Removal goes through repo
scripts, the same way creation did, so the teardown is reviewable:

```bash
# remove test users and any rows they created
bun run scripts/seed-staging-users.ts --teardown   # extend the script if this flag is absent
q "select count(*) from app_user where email like '%@test.local'"   # expect 0
unset SUPABASE_ACCESS_TOKEN
```

Then confirm no test artefact reached the tree: `git status --porcelain`, and run the
`secret-sweep` agent before pushing.

## 7. Write the report

One row per checkbox, mapping to evidence. This is the fix task's final deliverable
("a remediation report maps every checkbox to evidence — test name, migration file, or
executed command output").

```markdown
| Task | Criterion                                    | Verdict    | Evidence                                                                                                                          |
| ---- | -------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1    | clerk cannot PATCH submitted → paid          | PASS       | `HTTP 400` — `transition submitted→paid not permitted for credential.record_payment`; `residence_credential` count unchanged at 0 |
| 1    | approved_by = verified_by raises             | PASS       | `HTTP 400` — `maker and checker must differ`                                                                                      |
| 1b   | resident aged 17y364d rejected               | PASS       | `HTTP 400` — `ነዋሪው 18 ዓመት አልሞላውም`                                                                                                 |
| 3    | anon sequential-number lookup returns no PII | UNVERIFIED | anon key not available in this environment                                                                                        |
```

An UNVERIFIED row with a reason is honest and acceptable. An UNVERIFIED row without one,
or a PASS with no output, is not.

## What this harness does not cover

Runtime UI behaviour — offline queueing, print layout, chip colours, wizard drafts. Those
need a browser: use the `verify` skill, which already has the dev-server-against-live-
Supabase and Playwright-under-xvfb recipe worked out. This harness is for the database
gates, which is where the fix task's Critical and High findings live.
