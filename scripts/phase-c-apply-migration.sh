#!/usr/bin/env bash
#
# Applies supabase/migrations/00000000000023_pii_encryption.sql to a project
# FOR REAL. This is the same file scripts/run-phase-c-dryrun.sh rehearses
# inside a transaction that always rolls back -- this one ends in COMMIT.
#
# Safe to run before the pii_root_key Vault secret exists: the migration's own
# "Fails soft before the key exists" section is what makes that true --
# encrypt_pii_*() returns NULL and the sync triggers write NULL rather than
# raising, so this cannot break a live write path. Run
# ./scripts/phase-c-create-vault-key.sh afterward to actually turn encryption
# on, then ./scripts/phase-c-backfill.sh to encrypt existing rows.
#
# The whole migration runs as one transaction (BEGIN ... COMMIT) so a failure
# partway through leaves nothing half-applied.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...   # never echoed, never committed
#   ./scripts/phase-c-apply-migration.sh <project-ref>
#   e.g. ./scripts/phase-c-apply-migration.sh tugzuexfyzbdnghbmrjl

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
PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT

# Build the JSON with a real serializer, not shell string interpolation --
# this migration contains dollar-quoted function bodies and single quotes
# that shell escaping mangles into a confusing "syntax error" (see CLAUDE.md's
# sandboxed-environment notes). The final SELECT reports rollout status
# immediately, since a bare COMMIT with no trailing SELECT doesn't reliably
# tell us what came back.
python3 - "$MIGRATION" "$PAYLOAD" <<'PY'
import json, sys
migration, out = sys.argv[1], sys.argv[2]
body = open(migration).read()
sql = "BEGIN;\n" + body + "\nSELECT * FROM public.pii_encryption_status();\nCOMMIT;\n"
json.dump({"query": sql}, open(out, "w"))
PY

echo "==> Applying $MIGRATION to $REF (real apply -- not a dry run)"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYLOAD" \
| python3 -c '
import json, sys
result = json.load(sys.stdin)
if isinstance(result, dict):
    print("MIGRATION APPLY FAILED:", result.get("message", result))
    sys.exit(1)
print("==> Applied. Rollout status right now (key_present should be false -- the")
print("    Vault secret does not exist yet; run phase-c-create-vault-key.sh next):")
for row in result:
    label = row["column_label"]
    key_present = row["key_present"]
    plaintext = row["rows_with_plaintext"]
    encrypted = row["rows_encrypted"]
    print(f"  {label:38s} key_present={key_present!s:5s} plaintext={plaintext:>3} encrypted={encrypted:>3}")
'
