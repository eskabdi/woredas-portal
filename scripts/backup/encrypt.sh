#!/usr/bin/env bash
#
# Packs a backup workdir into one age-encrypted archive.
#
# Usage:
#   BACKUP_AGE_RECIPIENTS='age1... [age1...]' scripts/backup/encrypt.sh <workdir> <out.tar.gz.age>
#
# age public-key encryption: only the public key(s) live in CI; the private
# key never leaves the owner's custody, so a leaked artifact or a compromised
# workflow cannot read an old backup. Refuses to run without a recipient --
# there is no plaintext fallback. Writes <out>.sha256 next to the archive.

set -euo pipefail

WORKDIR="${1:-}"
OUT="${2:-}"
if [[ -z "$WORKDIR" || -z "$OUT" ]]; then
  echo "usage: $0 <workdir> <out.tar.gz.age>" >&2
  exit 2
fi
: "${BACKUP_AGE_RECIPIENTS:?BACKUP_AGE_RECIPIENTS is not set; refusing to write an unencrypted backup}"

args=()
for r in $BACKUP_AGE_RECIPIENTS; do
  if [[ ! "$r" =~ ^age1[0-9a-z]{58}$ ]]; then
    echo "::error::BACKUP_AGE_RECIPIENTS contains something that is not an age public key" >&2
    exit 1
  fi
  args+=(-r "$r")
done

umask 077
mkdir -p "$(dirname "$OUT")"
tar -C "$WORKDIR" -czf - . | age "${args[@]}" -o "$OUT"
(cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" >"$(basename "$OUT").sha256")
echo "Encrypted archive: $OUT ($(du -h "$OUT" | cut -f1))"
