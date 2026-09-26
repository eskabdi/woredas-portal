#!/usr/bin/env bash
#
# Takes a logical backup of the production Supabase project: database
# (roles, schema, data) plus, when S3 credentials are supplied, every Storage
# bucket's objects. Interim control for P0-1 / WP-OPS-002 of the 2026-09-24
# security audit while the project is on the Free plan (no platform backups,
# no PITR). See docs/backup-restore-runbook.md.
#
# Usage:
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@<pooler-host>:5432/postgres?sslmode=require' \
#     scripts/backup/backup.sh <workdir>
#
# Optional (Storage objects; skipped with a warning when unset):
#   SUPABASE_S3_ENDPOINT   https://<ref>.storage.supabase.co/storage/v1/s3
#   SUPABASE_S3_REGION     eu-west-1
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   Storage S3 access key pair
#
# Writes <workdir>/db/{roles,schema,managed-extras,data}.sql, row counts taken before and
# after the dump, Vault secret fingerprints (never values), a Storage mirror under <workdir>/storage/, and a MANIFEST
# of SHA-256 sums. The workdir holds plaintext PII: encrypt it with
# encrypt.sh and delete it; never upload it as-is.
#
# The dump uses the Supabase CLI's `db dump`, the documented path for a
# restorable Supabase backup: it leaves out the platform-managed schemas a
# new project already has and dumps auth/storage data in a form that loads
# into one. The CLI runs pg_dump in the project's own Postgres image, so the
# client version always matches the server (17.x).

set -euo pipefail

WORKDIR="${1:-}"
if [[ -z "$WORKDIR" ]]; then
  echo "usage: $0 <workdir>" >&2
  exit 2
fi
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
SUPABASE_CLI="${SUPABASE_CLI:-npx --yes supabase@2.118.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"

umask 077
mkdir -p "$WORKDIR/db" "$WORKDIR/storage"

count_rows() {
  psql "$SUPABASE_DB_URL" -X -A -t -F $'\t' -v ON_ERROR_STOP=1 -f "$HERE/row-counts.sql"
}

echo "== Row counts before dump"
count_rows >"$WORKDIR/db/row-counts-before.tsv"

echo "== Dumping roles, schema and data"
# shellcheck disable=SC2086  # SUPABASE_CLI is a command line, split on purpose
$SUPABASE_CLI db dump --db-url "$SUPABASE_DB_URL" -f "$WORKDIR/db/roles.sql" --role-only
# shellcheck disable=SC2086
$SUPABASE_CLI db dump --db-url "$SUPABASE_DB_URL" -f "$WORKDIR/db/schema.sql"
# shellcheck disable=SC2086
$SUPABASE_CLI db dump --db-url "$SUPABASE_DB_URL" -f "$WORKDIR/db/data.sql" --use-copy --data-only

# App-owned policies/triggers inside auth/storage (the dump skips those
# schemas): the storage.objects tenant-isolation policies live here.
psql "$SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f "$HERE/managed-schema-extras.sql" \
  >"$WORKDIR/db/managed-extras.sql"

# Vault secrets are NOT in the dump (the CLI skips the vault schema, and a
# new project could not decrypt another project's Vault ciphertext anyway).
# pii_root_key is the one that matters: without it every encrypt_pii_*
# column restores as unreadable ciphertext. Record a SHA-256 fingerprint of
# each secret -- never the value -- so the owner's offline escrow copy can be
# proven to be the right key at restore time. See the runbook.
psql "$SUPABASE_DB_URL" -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 -c \
  "SELECT name, encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') FROM vault.decrypted_secrets ORDER BY 1" \
  >"$WORKDIR/db/vault-secret-fingerprints.tsv"

echo "== Row counts after dump"
count_rows >"$WORKDIR/db/row-counts-after.tsv"

psql "$SUPABASE_DB_URL" -X -A -t -F $'\t' -v ON_ERROR_STOP=1 \
  -c "select bucket_id, count(*) from storage.objects group by 1 order by 1" \
  >"$WORKDIR/storage/object-counts.tsv"

for f in roles schema data; do
  if [[ ! -s "$WORKDIR/db/$f.sql" ]]; then
    echo "::error::db/$f.sql is empty" >&2
    exit 1
  fi
done

if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" && -n "${SUPABASE_S3_ENDPOINT:-}" ]]; then
  echo "== Mirroring Storage buckets"
  export AWS_DEFAULT_REGION="${SUPABASE_S3_REGION:-eu-west-1}"
  s3() { aws --endpoint-url "$SUPABASE_S3_ENDPOINT" "$@"; }
  mapfile -t buckets < <(s3 s3api list-buckets --query 'Buckets[].Name' --output text | tr '\t' '\n' | sed '/^$/d')
  for b in "${buckets[@]}"; do
    mkdir -p "$WORKDIR/storage/objects/$b"
    s3 s3 sync --only-show-errors "s3://$b" "$WORKDIR/storage/objects/$b"
  done
  echo "mirrored" >"$WORKDIR/storage/STATUS"
else
  echo "::warning::Storage S3 credentials not set; Storage objects are NOT in this backup (database only)."
  echo "skipped: no S3 credentials" >"$WORKDIR/storage/STATUS"
fi

echo "== Manifest"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "supabase_cli=$($SUPABASE_CLI --version 2>/dev/null | tail -1)"
  echo "server=$(psql "$SUPABASE_DB_URL" -X -A -t -c 'show server_version')"
  echo "storage=$(cat "$WORKDIR/storage/STATUS")"
  echo
  (cd "$WORKDIR" && find . -type f ! -name MANIFEST -print0 | sort -z | xargs -0 sha256sum)
} >"$WORKDIR/MANIFEST"

echo "Backup written to $WORKDIR ($(du -sh "$WORKDIR" | cut -f1))"
