#!/usr/bin/env bash
#
# One-time: creates the pii_root_key Vault secret that
# supabase/migrations/00000000000023_pii_encryption.sql's pii_root_key()
# reads. Until this exists, every encrypt_pii_*() call returns NULL -- this
# is the step that actually turns encryption on. Run
# ./scripts/phase-c-apply-migration.sh first if you haven't already.
#
# THE KEY VALUE IS GENERATED INSIDE THIS SQL STATEMENT, BY POSTGRES ITSELF
# (pgcrypto's gen_random_bytes), AND NEVER LEAVES THE DATABASE. It is not
# constructed here, not passed as an argument, not printed, and never
# touches this script, your shell, or Claude's output -- only the new
# secret's id (a UUID, not the key) and a row count come back.
#
# Idempotent: if a secret named pii_root_key already exists, this is a no-op
# rather than creating a second one. pii_root_key() resolves it with
# `... WHERE name = 'pii_root_key' LIMIT 1` -- a second same-named secret
# would make "which one is the real key" an unspecified, unstable choice,
# which is a far worse failure mode than "did nothing."
#
# LOSING THIS KEY MEANS LOSING EVERY ROW OF CIPHERTEXT IT EVER ENCRYPTED. It
# is not recoverable from a database backup -- Vault's own root secret is
# held outside this database by the Supabase platform, which is what makes
# it safe against a stolen database dump in the first place, but also means
# there is no "restore from backup" path if the project itself is ever
# deleted or the Vault is ever cleared. Treat this project's Vault as the
# durable, sole source of truth for it going forward, the same way
# HARARI_EC_PRIVATE_KEY is treated for credential signing.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...   # never echoed, never committed
#   ./scripts/phase-c-create-vault-key.sh <project-ref>

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
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'pii_root_key',
      'INSA Phase C PII encryption root key -- created by phase-c-create-vault-key.sh'
    );
  END IF;
END $$;

SELECT id, name, created_at,
       (SELECT count(*) FROM vault.secrets WHERE name = 'pii_root_key') AS secrets_with_this_name
FROM vault.secrets
WHERE name = 'pii_root_key';

COMMIT;
"""
json.dump({"query": sql}, open(out, "w"))
PY

echo "==> Creating pii_root_key Vault secret on $REF (idempotent -- safe if already present)"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYLOAD" \
| python3 -c '
import json, sys
result = json.load(sys.stdin)
if isinstance(result, dict):
    print("VAULT KEY CREATION FAILED:", result.get("message", result))
    sys.exit(1)
if not result:
    print("VAULT KEY CREATION FAILED: no secret found after running -- unexpected, investigate before backfilling")
    sys.exit(1)
row = result[0]
count = row["secrets_with_this_name"]
secret_id = row["id"]
created_at = row["created_at"]
print(f"==> pii_root_key secret id={secret_id} created_at={created_at}")
if count == 1:
    print("==> Exactly one secret named pii_root_key exists. Safe to run phase-c-backfill.sh next.")
else:
    print(f"==> WARNING: {count} secrets named pii_root_key exist -- this should never happen. Investigate before backfilling; pii_root_key() will pick one arbitrarily.")
    sys.exit(1)
'
