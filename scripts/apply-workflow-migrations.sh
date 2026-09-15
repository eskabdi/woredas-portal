#!/usr/bin/env bash
#
# Applies the workflow-engine migrations to a project FOR REAL:
#
#   supabase/migrations/00000000000025_workflow_engine.sql        (Task 1, closes F-01)
#   supabase/migrations/00000000000026_workflow_engine_fixes.sql  (the review-chain fixes)
#
# BOTH, IN ONE TRANSACTION, ALWAYS. This is the whole point of the script and
# the reason it exists rather than two calls:
#
#   25 alone is a broken state. It makes `approved` a dead end (PaymentCard's
#   body only rendered at `awaiting_payment`, and the only writer of that status
#   sits behind it), it hides `verified`/`approved` requests from the approval
#   queue, and it lets a card still at the printer verify as a valid government
#   ID. 26 is what fixes all of that. Landing 25 and then failing on 26 would
#   leave the credential module in exactly the state the review chain caught.
#
#   26 alone cannot apply: it CREATE OR REPLACEs functions 25 defines and seeds
#   a row into a table 25 creates.
#
# So both are stripped of their own BEGIN/COMMIT and wrapped in a single
# transaction here. Either both land or neither does. This also makes the apply
# byte-for-byte the same SQL as the rehearsal (the dry run wraps the identical
# concatenation in BEGIN ... ROLLBACK), so what was verified is what runs.
#
# Safe to re-run: every statement is CREATE OR REPLACE, ADD CONSTRAINT with a
# preceding DROP ... IF EXISTS, ON CONFLICT DO NOTHING, or an idempotent
# REVOKE/GRANT. The migration also asserts its own invariants before COMMIT --
# notably that no view lost `security_invoker` and that anon holds no grant on
# the two views that carry PII or cross-tenant workflow rows -- so a run that
# would leave the database in a worse state aborts instead.
#
# Rehearse first (never applies, always rolls back):
#   ./scripts/apply-workflow-migrations.sh <project-ref> --dry-run
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...   # never echoed, never committed
#   ./scripts/apply-workflow-migrations.sh tugzuexfyzbdnghbmrjl --dry-run
#   ./scripts/apply-workflow-migrations.sh tugzuexfyzbdnghbmrjl

set -euo pipefail

REF="${1:-}"
MODE="${2:-}"
shift 2 2>/dev/null || true

if [[ -z "$REF" ]]; then
  echo "usage: $0 <project-ref> [--dry-run|--apply] [migration.sql ...]" >&2
  exit 2
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set" >&2
  exit 2
fi
# --apply is accepted as an explicit synonym for "no flag", so a caller can name
# the intent positionally rather than relying on an empty second argument.
if [[ "$MODE" == "--apply" ]]; then MODE=""; fi
if [[ -n "$MODE" && "$MODE" != "--dry-run" ]]; then
  echo "unknown option: $MODE (expected --dry-run or --apply)" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# Default set is 25+26: they must go together (25 alone is a broken state --
# 26 is what fixes the `approved` dead end, the hidden approval-queue rows and
# the green verdict on a card still at the printer). Any other set is passed
# explicitly, and whatever is listed is applied in ONE transaction in the order
# given.
if [[ $# -gt 0 ]]; then
  MIGRATIONS=("$@")
else
  MIGRATIONS=(
    "supabase/migrations/00000000000025_workflow_engine.sql"
    "supabase/migrations/00000000000026_workflow_engine_fixes.sql"
  )
fi

for f in "${MIGRATIONS[@]}"; do
  [[ -f "$f" ]] || { echo "missing migration: $f" >&2; exit 2; }
done

PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT

# Build the payload with a real serializer. These files contain dollar-quoted
# function bodies and single quotes that shell escaping mangles into a
# confusing "syntax error" (CLAUDE.md, sandboxed-environment notes).
#
# The inner BEGIN;/COMMIT; lines are STRIPPED before wrapping. This is
# load-bearing for --dry-run: leaving an inner COMMIT in place would end the
# outer transaction early and commit migration 25 for real, so a "dry run"
# would apply half the change to production before reaching ROLLBACK.
python3 - "$PAYLOAD" "${MODE:-}" "${MIGRATIONS[@]}" <<'PY'
import json, re, sys

out, mode, paths = sys.argv[1], sys.argv[2], sys.argv[3:]

def strip_tx(path):
    body = open(path).read()
    kept = []
    for line in body.split("\n"):
        if re.fullmatch(r"\s*(BEGIN|COMMIT)\s*;\s*", line):
            kept.append("-- [transaction line supplied by apply-workflow-migrations.sh] " + line.strip())
        else:
            kept.append(line)
    return "\n".join(kept)

combined = "\n".join(strip_tx(p) for p in paths)

# Refuse to build a payload that could commit inside the wrapper.
for kw in ("COMMIT", "ROLLBACK"):
    if re.search(r"(?mi)^\s*%s\s*;\s*$" % kw, combined):
        sys.exit("refusing to build payload: a bare %s survived stripping" % kw)

closer = "ROLLBACK;" if mode == "--dry-run" else "COMMIT;"
json.dump({"query": "BEGIN;\n" + combined + "\n" + closer + "\n"}, open(out, "w"))
PY

if [[ "$MODE" == "--dry-run" ]]; then
  echo "==> REHEARSING against $REF (rolls back; nothing is applied):"
else
  echo "==> APPLYING to $REF (real apply -- all listed, or none):"
fi
for f in "${MIGRATIONS[@]}"; do echo "      $(basename "$f")"; done

# -o /dev/null would hide the error body, so capture it and print only what the
# API returned. The token is in a header read from the environment: never on the
# command line, never echoed.
RESPONSE="$(mktemp)"
trap 'rm -f "$PAYLOAD" "$RESPONSE"' EXIT

HTTP="$(curl -sS -o "$RESPONSE" -w '%{http_code}' \
  -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYLOAD")"

python3 - "$RESPONSE" "$HTTP" "${MODE:-}" <<'PY'
import json, sys
path, http, mode = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(path).read()
try:
    result = json.loads(raw)
except ValueError:
    sys.exit("HTTP %s -- unparseable response: %s" % (http, raw[:400]))

if isinstance(result, dict):
    sys.exit("FAILED (HTTP %s): %s" % (http, result.get("message", result)))

if mode == "--dry-run":
    print("==> Rehearsal clean. Nothing was applied; the transaction rolled back.")
else:
    print("==> Applied. Verify with scripts/verify-workflow-migrations.sql queries.")
PY
