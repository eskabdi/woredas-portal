#!/usr/bin/env bash
# Local workspace diagnostics for the woreda portal.
#
# Checks only what can be verified without credentials or network access, so it
# is always safe to run. Backend checks live in SKILL.md because they need a
# token and judgement.
#
# Never prints the VALUE of an environment variable — only whether it is set.
# Printing a secret to diagnose it is how it ends up in a log or a transcript.
#
# Exit: 0 = no failures (warnings allowed), 1 = at least one FAIL.

set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"

PASS=0; WARN=0; FAIL=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; WARN=$((WARN+1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

section "Toolchain"
if command -v bun >/dev/null 2>&1; then
  pass "bun $(bun --version)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  warn "bun exists at \$HOME/.bun/bin/bun but is not on PATH — add it, or the hook's fallback runs npm and skips bunfig.toml's release-age guard"
else
  fail "bun not found. It is the package manager of record here (bun.lock, bunfig.toml) and what CI/Vercel build with"
fi
command -v node >/dev/null 2>&1 && pass "node $(node --version)" || warn "node not found (bun covers most of it, but tsc/eslint expect it)"

section "Dependencies"
if [ -d node_modules ]; then
  pass "node_modules present ($(find node_modules -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ') entries)"
  [ -d node_modules/jsbarcode ] || warn "jsbarcode missing though package.json declares it — run 'bun install'"
else
  fail "node_modules missing. 'bun run lint' and 'tsc --noEmit' will fail with module-resolution errors that read as code faults, not a missing install. Run 'bun install'"
fi

section "Generated files"
if [ -f src/routeTree.gen.ts ]; then
  # Compare by CONTENT, not mtime. A fresh clone gives every file an arbitrary
  # checkout timestamp, so an mtime test warns on a perfectly good tree and
  # trains people to ignore this check. What actually matters is whether every
  # route file has an import in the generated tree.
  unregistered=""
  for f in src/routes/*.tsx; do
    case "$f" in */__root.tsx) continue ;; esac
    mod=$(basename "$f" .tsx)
    grep -q "from './routes/${mod}'" src/routeTree.gen.ts 2>/dev/null || unregistered="$unregistered $f"
  done
  if [ -n "$unregistered" ]; then
    warn "route file(s) absent from src/routeTree.gen.ts. Run 'bun run build' before 'tsc --noEmit' — the router plugin regenerates the tree during build, not during tsc, so a stale tree reports \"not assignable to type\" errors that look like a bug in the new route:"
    printf '         %s\n' $unregistered
  else
    pass "src/routeTree.gen.ts registers all $(ls src/routes/*.tsx | grep -vc __root) routes"
  fi
else
  fail "src/routeTree.gen.ts missing — run 'bun run build' or 'bun run dev' to generate it"
fi

section "Route conventions"
missing_ssr=""
for f in src/routes/*.tsx; do
  case "$f" in */__root.tsx) continue ;; esac
  grep -q "ssr: false" "$f" 2>/dev/null || missing_ssr="$missing_ssr $f"
done
if [ -n "$missing_ssr" ]; then
  fail "route(s) missing 'ssr: false'. Auth bootstraps in the browser, so a server-rendered pass has no session or permissions — the page renders its signed-out state and flips after hydration. Fails only against a real login:"
  printf '         %s\n' $missing_ssr
else
  pass "every route sets 'ssr: false' ($(ls src/routes/*.tsx | grep -vc __root) routes)"
fi

section "Environment (names only, never values)"
if [ -f .env ]; then
  pass ".env present"
  for v in VITE_SUPABASE_URL VITE_SUPABASE_PROJECT_ID VITE_SUPABASE_PUBLISHABLE_KEY; do
    if grep -qE "^${v}=.+" .env 2>/dev/null; then pass "$v is set"; else warn "$v is empty or absent — the build needs it"; fi
  done
  grep -qE "^VITE_PUBLIC_SITE_URL=.+" .env 2>/dev/null \
    && pass "VITE_PUBLIC_SITE_URL is set" \
    || warn "VITE_PUBLIC_SITE_URL unset — ID card QRs fall back to the production origin. A card printed from localhost with this wrong carries a QR nobody can open, and it only surfaces after printing"
  for t in SUPABASE_ACCESS_TOKEN VERCEL_TOKEN; do
    grep -qE "^${t}=.+" .env 2>/dev/null && fail "$t is in .env. It is an account-level deploy credential, not a build input — a local build never needs it. Supply it as a session env var at deploy time and remove this line (see CLAUDE.md)"
  done
else
  warn ".env absent — 'bun run dev' will not reach Supabase. Copy .env.example and fill it in"
fi

section "Secret hygiene"
leaks=$(git grep -nIE 'sbp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY' -- . 2>/dev/null | grep -vE '^(CLAUDE\.md|\.claude/)' | head -5)
if [ -n "$leaks" ]; then
  fail "possible secret in a TRACKED file. Revoke it first, then clean up — a secret in a commit object is disclosed whether or not it was pushed:"
  printf '         %s\n' "$leaks"
else
  pass "no token or private key in tracked files"
fi
for p in .env .claude/settings.local.json supabase/.temp p.json payload.json; do
  # A directory-only pattern ("supabase/.temp/") does not match the bare path,
  # so fall back to the trailing-slash form before declaring it unignored.
  if ! git check-ignore -q "$p" 2>/dev/null && ! git check-ignore -q "$p/" 2>/dev/null; then
    warn "$p is NOT gitignored — it is a known credential-leak path (see CLAUDE.md)"
  fi
done
for f in p.json payload.json; do
  [ -f "$f" ] && warn "$f left over from a Management API call — gitignored, but delete it; ignored is not absent"
done

section "Backend artifacts (files only — deployment state needs SKILL.md's checks)"
[ -f supabase/migrations/00000000000000_baseline.sql ] && pass "baseline migration present" || fail "baseline migration missing"
[ -f supabase/seed.sql ] && pass "seed.sql present" || fail "seed.sql missing — without it login works but no permission resolves"
fn_count=$(ls -d supabase/functions/*/ 2>/dev/null | wc -l | tr -d ' ')
[ "$fn_count" = "4" ] && pass "4 Edge Function sources present" || warn "expected 4 Edge Function sources, found $fn_count"

section "Git"
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
pass "on branch $branch"
[ "$branch" = "main" ] && warn "you are on main — develop on a feature branch"
dirty=$(git status --porcelain | wc -l | tr -d ' ')
[ "$dirty" = "0" ] && pass "working tree clean" || warn "$dirty uncommitted change(s)"

printf '\n\033[1mSummary:\033[0m %d ok, %d warn, %d FAIL\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Fix the FAILs first — each one is a silent failure in this project, not a loud one.\n'
  exit 1
fi
exit 0
