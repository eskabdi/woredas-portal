#!/usr/bin/env bash
#
# Runs the Phase C (PII encryption) dry run against a project, WITHOUT
# committing anything.
#
# It splices supabase/migrations/00000000000023_pii_encryption.sql into
# scripts/phase-c-dryrun.sql and sends the result as a single transaction that
# ends in ROLLBACK -- so the migration is exercised against the real schema and
# real rows, and then unwound. Nothing is added, nothing is dropped, and the
# Vault is never written to.
#
# This exists because the project has no staging environment (INSA Phase D),
# so "rehearse the risky migration somewhere safe first" has to mean "rehearse
# it inside a transaction on the real database".
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=...          # never echoed, never committed
#   ./scripts/run-phase-c-dryrun.sh tugzuexfyzbdnghbmrjl
#
# Postgres ports are blocked from sandboxed shells, so this goes over HTTPS via
# the Management API -- see CLAUDE.md.

set -euo pipefail

REF="${1:-}"
if [[ -z "$REF" ]]; then
  echo "usage: $0 <project-ref>" >&2
  exit 2
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

MIGRATION="supabase/migrations/00000000000023_pii_encryption.sql"
HARNESS="scripts/phase-c-dryrun.sql"
PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT

# Build the JSON with a real serializer: the migration contains dollar-quoted
# function bodies and single quotes that shell escaping mangles into a
# confusing "syntax error" (CLAUDE.md documents this trap).
python3 - "$MIGRATION" "$HARNESS" "$PAYLOAD" <<'PY'
import json, sys
migration, harness, out = sys.argv[1], sys.argv[2], sys.argv[3]
body = open(migration).read()
sql = open(harness).read()
marker = "-- MIGRATION_PLACEHOLDER"
if marker not in sql:
    sys.exit("marker not found in harness")
json.dump({"query": sql.replace(marker, body)}, open(out, "w"))
PY

echo "==> Dry run against $REF (transaction, rolled back)"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYLOAD" \
| python3 -c '
import json, sys
rows = json.load(sys.stdin)
if isinstance(rows, dict):
    print("dry run did not complete:", rows.get("message", rows))
    sys.exit(1)
failed = 0
for r in rows:
    ok = r["passed"]
    failed += 0 if ok else 1
    print(("  PASS  " if ok else "  FAIL  ") + r["check_name"] + "  --  " + (r["detail"] or ""))
print()
print(f"{len(rows) - failed}/{len(rows)} checks passed")
sys.exit(1 if failed else 0)
'
