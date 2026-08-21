---
name: review
description: Review changes to the woreda portal before they merge — routes the diff to the right specialist reviewer and checks the invariants that no build, typecheck or lint run in this repo can catch. Use this whenever asked to review, check over, sanity-check, or give feedback on changes, a branch, a PR or a commit in this repository, and before opening or merging any PR here — even when the change looks small or is "just" a migration, a route, or a config tweak.
---

# Reviewing changes to the woreda portal

## Why this repo needs a real review

Most codebases let automated checks carry the load. This one cannot:

- **There is no test suite.** No vitest, no jest, no `*.test.*` or `*.spec.*`
  anywhere. Nothing fails when behaviour regresses.
- **`bun run lint` has a noise floor of ~3,500 problems**, ~3,459 of them
  `prettier/prettier` formatting. Real findings drown in it, so nobody reads it.
- **`tsc --noEmit` is clean and stays clean** through most of the bugs that
  matter here — a route that renders empty for every user, a query that crosses
  a tenant boundary, and a QR too dense to scan all typecheck perfectly.

So the failure modes that actually reach production in this project are the ones
a compiler is structurally incapable of seeing: **an authorization gate that
opens without its other half, a tenant boundary that depends on a string prefix,
and a physical card whose defect is discovered after it is printed.** Review is
not a second opinion here. It is the only gate.

Read `CLAUDE.md` before reviewing. It documents these invariants and why each
exists; this skill is how you apply them to a diff.

## Step 1 — Scope the diff honestly

```bash
git fetch origin main --quiet
git diff --stat origin/main...HEAD      # or the PR's base
git diff origin/main...HEAD
```

Review what the branch changes against its **merge base** (`...`), not against
whatever `main` looked like when you started. Note which files are generated and
skip them: `src/routeTree.gen.ts` (TanStack Router emits it), `bun.lock`, and
`src/integrations/supabase/types.ts` (regenerated from the schema, never
hand-edited). A diff that hand-edits any of those is itself the finding.

## Step 2 — Route to the specialist reviewers

Four subagents live in `.claude/agents/`, each holding the detailed rules for one
surface. Dispatch by what the diff touches — several can apply to one change, and
they are read-only, so run whichever fit in parallel:

| If the diff touches | Run | It looks for |
|---|---|---|
| `supabase/migrations/`, `permissions.ts`, `seed.sql`, any `.upload(` call, a new table or policy | `tenant-isolation-review` | cross-tenant reads, a client gate without its seed rows, a missing storage path prefix |
| `src/routes/`, a new page, a list or detail view | `portal-conventions-review` | a route missing `ssr: false`, table state in `useState`, Gregorian dates in the woreda portal |
| `sign-credential/`, the print route, `barcode.ts`, `credentialCryptoConfig.ts`, the template editor | `card-print-review` | invariants whose failure is only visible after cards are physically printed |
| deploy tooling, `.claude/`, `.env*`, anything after a migration or deploy | `secret-sweep` | a deploy token reaching a commit |

Always run `secret-sweep` before a push that followed a deploy, whatever else
changed — that is the finding with no upper bound on cost.

If a change touches none of these surfaces (a README edit, a dependency bump),
say so and review it directly. Don't dispatch agents to manufacture findings.

## Step 3 — Rank by blast radius, not by line count

Order findings so the reader hits the expensive ones first. In this project the
ladder is:

1. **Cross-tenant data exposure.** A new table without RLS, or a `SECURITY
   DEFINER` function that trusts a `_woreda_id` argument instead of re-deriving
   it from `get_user_woreda_id()`. This is residents' civil registration data —
   a real-world privacy breach, not a bug report.
2. **A leaked deploy credential.** `SUPABASE_ACCESS_TOKEN` reaches every project
   on the account; `VERCEL_TOKEN` can delete projects. Neither is scoped to this
   repo.
3. **Credential forgery or an unscannable card batch.** The signer trusting a
   request-supplied field, a density guard downgraded to a warning, or a
   revocation check removed. Cards are already in residents' hands by the time
   this surfaces.
4. **A silently empty UI.** A permission added to `ROLE_PERMISSIONS` without its
   `role_permission` seed rows, an upload missing its `${woredaId}/` prefix, or
   a route missing `ssr: false`. Everything renders, nothing works, and no error
   explains why.
5. **Convention drift.** Table state in `useState`, a hand-rolled dialog, a
   monolingual label. Real, but it costs a follow-up commit, not an incident.

A convention nit listed above a missing RLS policy trains people to skim your
reviews. Lead with severity.

## Step 4 — Verify before you assert

A review that guesses is worse than no review, because it gets trusted. Confirm
each claim against the repo:

```bash
# A permission needs BOTH halves — client map and seed rows
grep -n "NEW_PERMISSION" src/config/permissions.ts
grep -n "new.permission" supabase/seed.sql

# Every route must set ssr: false
for f in src/routes/*.tsx; do grep -q "ssr: false" "$f" || echo "MISSING: $f"; done

# Typecheck. If the diff adds or renames a route, run `bun run build` first:
# the router plugin regenerates src/routeTree.gen.ts during build, not during
# tsc, so a stale tree reports bogus "not assignable to type" errors that look
# like a mistake in the new route. Otherwise tsc alone is enough.
bunx tsc --noEmit

# Lint only what changed — the repo-wide run is unreadable.
# Guard the empty case: eslint with no file arguments lints the whole repo and
# buries you in the very noise you are trying to avoid.
CHANGED=$(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx')
[ -n "$CHANGED" ] && bunx eslint $CHANGED || echo "no TS/TSX changed"
```

When you lint a changed file, separate **pre-existing** `prettier/prettier`
noise from anything the diff introduced. Telling an author to fix 200 formatting
errors they did not create is how a review gets ignored.

## Known false positives — do not flag these

Each of these looks wrong and is correct. Flagging them is worse than missing a
real finding, because it teaches the author to discount you:

- **`CREDENTIAL_PUBLIC_KEY_PEM` in `credentialCryptoConfig.ts`** is a *public*
  key and is meant to ship to every verifier. Only the private half is secret.
- **The Supabase publishable/anon key is a JWT** and is designed to be in the
  client bundle. Before flagging a JWT, decode it and read `role`: `anon` is
  fine, `service_role` is an incident.
- **`credential-templates` uploads to a bare `${side}.png`** with no woreda
  prefix. That bucket is platform-level by design — readable by any
  authenticated user, writable only by `is_super_admin()`.
- **The admin portal is English-only.** Bilingual Amharic/English labels are a
  woreda-portal convention; "fixing" `src/routes/admin.*` to bilingual is wrong.
- **A missing `tenant_module_config` row means the module is enabled.** Absence
  is not a disable, so an empty table is not a bug.
- **`client.server.ts` is imported by nothing.** That is the current state, not
  dead code to delete — it is the sanctioned path for future server-side work.

## Output

Write for someone deciding whether to merge, not someone admiring your
thoroughness.

```markdown
## Review: <branch or PR>

**Verdict:** <ship it | fix first | needs a decision>

### Blocking
- `file.ts:42` — <what breaks, and for whom> → <the fix>

### Worth fixing
- `file.tsx:88` — <finding> → <fix>

### Checked and clean
<the invariants you actively verified and found correct — this is signal, not filler>
```

State what you verified and what you did not. "I did not exercise the print
path against a real card" is useful; implying you did is not.

If the change is genuinely fine, say so in a sentence and stop. Padding a clean
review with invented nits is the fastest way to make the next one worthless.
