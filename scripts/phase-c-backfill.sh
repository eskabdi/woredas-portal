#!/usr/bin/env bash
#
# Backfills the *_enc / blind-index columns for every pre-existing row that
# predates the pii_root_key Vault secret. supabase/migrations/00000000000023_
# pii_encryption.sql's sync triggers only fire on INSERT/UPDATE, so a row
# written before the key existed has NULL in every _enc column until it is
# touched again -- this touches it.
#
# Run ./scripts/phase-c-apply-migration.sh and ./scripts/phase-c-create-vault-key.sh
# first, in that order. This script refuses to run if the Vault secret is
# missing, rather than silently writing NULL ciphertext for every row.
#
# Each UPDATE is a no-op self-assignment (`SET col = col`) filtered to only
# the rows still missing their _enc value, so this is safe to re-run --
# already-backfilled rows are skipped, not re-encrypted (ciphertext is
# randomized, so re-running would still be harmless, just wasted work).
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...   # never echoed, never committed
#   ./scripts/phase-c-backfill.sh <project-ref>

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

PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT

python3 - "$PAYLOAD" <<'PY'
import json, sys
out = sys.argv[1]
sql = """
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pii_root_key') THEN
    RAISE EXCEPTION 'pii_root_key Vault secret does not exist yet -- run phase-c-create-vault-key.sh first';
  END IF;
END $$;

UPDATE public.resident SET phone_number = phone_number
WHERE (phone_number IS NOT NULL AND phone_number_enc IS NULL)
   OR (email IS NOT NULL AND email_enc IS NULL);

UPDATE public.household SET phone_number = phone_number
WHERE (phone_number IS NOT NULL AND phone_number_enc IS NULL)
   OR (email IS NOT NULL AND email_enc IS NULL);

UPDATE public.service_request SET applicant_phone = applicant_phone
WHERE applicant_phone IS NOT NULL AND applicant_phone_enc IS NULL;

UPDATE public.payment SET amount = amount
WHERE amount_enc IS NULL;

UPDATE public.rental_occupancy SET rent_amount = rent_amount
WHERE rent_amount_enc IS NULL;

UPDATE public.rental_occupancy_request SET rent_amount = rent_amount
WHERE rent_amount IS NOT NULL AND rent_amount_enc IS NULL;

SELECT * FROM public.pii_encryption_status();

COMMIT;
"""
json.dump({"query": sql}, open(out, "w"))
PY

echo "==> Backfilling encrypted columns on $REF"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYLOAD" \
| python3 -c '
import json, sys
result = json.load(sys.stdin)
if isinstance(result, dict):
    print("BACKFILL FAILED:", result.get("message", result))
    sys.exit(1)
print("==> Backfill complete. Rollout status (every row should now show")
print("    plaintext == encrypted, and key_present=true):")
all_done = True
for row in result:
    done = row["rows_with_plaintext"] == row["rows_encrypted"]
    all_done = all_done and done
    mark = "OK " if done else "GAP"
    print(f"  [{mark}] {row['column_label']:38s} key_present={row['key_present']!s:5s} "
          f"plaintext={row['rows_with_plaintext']:>3} encrypted={row['rows_encrypted']:>3}")
if not all_done:
    print()
    print("==> Some rows are still unencrypted -- re-run this script; it is safe to repeat.")
    sys.exit(1)
'
