#!/usr/bin/env bash
#
# Applies supabase/migrations/00000000000024_rental_occupancy_request_decrypted_view.sql
# to a project FOR REAL. This closes a gap found while doing the Phase C
# stage-3 read cutover: migration 23 added rental_occupancy_request.rent_amount_enc
# and its sync trigger alongside the other five encrypted columns, but never
# created the matching decrypting view -- so two real call sites
# (src/routes/woreda.rental-houses.requests.index.tsx and
# .../requests.$requestId.index.tsx) had nowhere to cut over to.
#
# Requires migration 23 already applied (decrypt_pii_numeric must exist).
# Safe to re-run: DROP VIEW IF EXISTS + CREATE VIEW is idempotent, and the
# REVOKE/GRANT pair is unconditional either way.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...   # never echoed, never committed
#   ./scripts/phase-c-apply-migration-024.sh <project-ref>
#   e.g. ./scripts/phase-c-apply-migration-024.sh tugzuexfyzbdnghbmrjl

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

MIGRATION="supabase/migrations/00000000000024_rental_occupancy_request_decrypted_view.sql"
PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT

python3 - "$MIGRATION" "$PAYLOAD" <<'PY'
import json, sys
migration, out = sys.argv[1], sys.argv[2]
body = open(migration).read()
sql = "BEGIN;\n" + body + "\nSELECT count(*) AS row_count FROM public.rental_occupancy_request_decrypted;\nCOMMIT;\n"
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
row_count = result[0]["row_count"]
print(f"==> Applied. rental_occupancy_request_decrypted now visible with row_count={row_count}")
'
