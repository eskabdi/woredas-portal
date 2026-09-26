#!/usr/bin/env bash
#
# Restores a backup.sh workdir into an EMPTY Supabase database and proves the
# restore is complete: every dumped table's row count must fall between the
# source counts taken just before and just after the dump, every public table
# plus auth.users/auth.identities/storage.buckets/storage.objects must be in
# the dump, and (when Storage was mirrored) each bucket's file count must
# match storage.objects. Prints a Markdown report; exits non-zero on any gap.
#
# Usage:
#   RESTORE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     scripts/backup/restore-verify.sh <workdir>
#
# The restore target must be a fresh Supabase project or `supabase start`
# stack (it provides the platform-managed schemas the dump leaves out).
# NEVER point RESTORE_DB_URL at production. The restore sequence is the one
# Supabase documents for moving a CLI backup into a new project.

set -euo pipefail

WORKDIR="${1:-}"
if [[ -z "$WORKDIR" ]]; then
  echo "usage: $0 <workdir>" >&2
  exit 2
fi
: "${RESTORE_DB_URL:?RESTORE_DB_URL is not set}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ "$RESTORE_DB_URL" == *supabase.com* || "$RESTORE_DB_URL" == *supabase.co* ]]; then
  if [[ "${ALLOW_REMOTE_RESTORE:-}" != "yes" ]]; then
    echo "RESTORE_DB_URL points at a hosted Supabase project. Set ALLOW_REMOTE_RESTORE=yes only for a NEW, empty project, never production." >&2
    exit 2
  fi
fi

db="$WORKDIR/db"
# `GRANT SET ON PARAMETER` lines are platform grants (e.g. to
# supabase_realtime_admin) that every new project already carries and that
# only a superuser can issue; `postgres` is not one, so they are dropped.
roles_restore="$WORKDIR/roles.restore.sql"
grep -v '^GRANT SET ON PARAMETER ' "$db/roles.sql" >"$roles_restore" || true
skipped_grants=$(grep -c '^GRANT SET ON PARAMETER ' "$db/roles.sql" || true)
# A COPY block with no rows carries no data, but still needs INSERT on its
# table -- which `postgres` lacks on some platform-internal tables (e.g.
# storage.buckets_vectors). Empty blocks are dropped; any block that has rows
# is kept, so a table we genuinely cannot load still fails the restore.
data_restore="$WORKDIR/data.restore.sql"
awk '
  /^COPY .* FROM stdin;$/ { buf = $0; n = 0; inblk = 1; next }
  inblk && /^\\\.$/ { if (n > 0) { print buf; print $0 } inblk = 0; next }
  inblk { buf = buf "\n" $0; n++; next }
  { print }
' "$db/data.sql" >"$data_restore"
report="$WORKDIR/restore-report.md"
# psql's error output can quote row data (a failing COPY line, a duplicate
# key's value), and this script's stdout lands in a PUBLIC workflow log. The
# full text goes to restore-errors.log inside the workdir (encrypted with the
# archive); stdout only ever names a file:line location.
if ! psql --single-transaction -X -q -v ON_ERROR_STOP=1 \
  --file "$roles_restore" \
  --file "$db/schema.sql" \
  --file "$db/managed-extras.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$data_restore" \
  --dbname "$RESTORE_DB_URL" >/dev/null 2>"$WORKDIR/restore-errors.log"; then
  where=$(sed -nE 's|^psql:[^ ]*/([^/:]+:[0-9]+): ERROR:.*|\1|p' "$WORKDIR/restore-errors.log" | head -1)
  {
    echo "## Backup restore test"
    echo
    echo "**Result: FAIL** — the restore aborted at \`${where:-unknown location}\`."
    echo "The full error is in \`restore-errors.log\` inside the encrypted archive (kept out of this public log because it can quote row data)."
  } | tee "$report"
  exit 1
fi

psql "$RESTORE_DB_URL" -X -A -t -F $'\t' -v ON_ERROR_STOP=1 -f "$HERE/row-counts.sql" \
  >"$WORKDIR/row-counts-restored.tsv"

declare -A before after restored dumped
while IFS=$'\t' read -r t n; do before[$t]=$n; done <"$db/row-counts-before.tsv"
while IFS=$'\t' read -r t n; do after[$t]=$n; done <"$db/row-counts-after.tsv"
while IFS=$'\t' read -r t n; do restored[$t]=$n; done <"$WORKDIR/row-counts-restored.tsv"
# Tables the data dump carries: one COPY per table, identifiers quoted.
while read -r t; do dumped[$t]=1; done < <(
  sed -nE 's/^COPY "?([A-Za-z0-9_]+)"?\."?([A-Za-z0-9_]+)"? .*/\1.\2/p' "$db/data.sql" | sort -u
)

# Two views of every problem: `rows` (with counts) goes only into the
# encrypted report; `pub_rows` (table + problem, no counts) is printed.
fail=0
rows=""
pub_rows=""
objects=""
checked=0
total_rows=0
problem() { # table, source, restored, text
  rows+="| \`$1\` | $2 | $3 | **FAIL: $4** |"$'\n'
  pub_rows+="| \`$1\` | **FAIL: $4** |"$'\n'
  fail=1
}
for t in $(printf '%s\n' "${!before[@]}" | sort); do
  b=${before[$t]}
  a=${after[$t]:-$b}
  lo=$((b < a ? b : a))
  hi=$((b > a ? b : a))
  critical=0
  case "$t" in
    public.* | auth.users | auth.identities | storage.buckets | storage.objects) critical=1 ;;
    "~"*)
      # Schema-object counts: must match the source exactly. These are
      # derivable from the public migrations, so they are safe to print.
      r=${restored[$t]:-missing}
      if [[ "$r" != "$b" || "$a" != "$b" ]]; then
        problem "${t#\~}" "$b" "$r" "schema objects differ"
      else
        objects+="${t#\~}=$r "
      fi
      continue
      ;;
  esac
  if [[ -z "${dumped[$t]:-}" ]]; then
    ((critical)) && problem "$t" "$b" "—" "not in dump"
    continue
  fi
  r=${restored[$t]:-}
  checked=$((checked + 1))
  if [[ -z "$r" ]]; then
    problem "$t" "$b" "missing" "table not restored"
  elif ((r < lo || r > hi)); then
    problem "$t" "$lo–$hi" "$r" "row count mismatch"
  else
    total_rows=$((total_rows + r))
  fi
done

storage_pub="Storage objects: not mirrored in this backup (no S3 credentials)."
storage_full="$storage_pub"
if [[ "$(cat "$WORKDIR/storage/STATUS" 2>/dev/null)" == "mirrored" ]]; then
  storage_ok=1
  storage_files=0
  buckets_checked=0
  while IFS=$'\t' read -r bucket n; do
    [[ -z "$bucket" ]] && continue
    buckets_checked=$((buckets_checked + 1))
    got=$(find "$WORKDIR/storage/objects/$bucket" -type f 2>/dev/null | wc -l)
    storage_files=$((storage_files + got))
    if ((got != n)); then
      problem "storage bucket $bucket" "$n objects" "$got files" "object mirror incomplete"
      storage_ok=0
    fi
  done <"$WORKDIR/storage/object-counts.tsv"
  if ((storage_ok)); then
    storage_pub="Storage objects: every non-empty bucket ($buckets_checked) matches \`storage.objects\`."
    storage_full="Storage objects: $storage_files files in $buckets_checked buckets; every bucket matches \`storage.objects\`."
  fi
fi

vault_names=$(cut -f1 "$db/vault-secret-fingerprints.tsv" 2>/dev/null | paste -sd, - | sed 's/,/, /g')

summary() { # $1 = full|public
  echo "## Backup restore test"
  echo
  echo "- Restored into a fresh Supabase stack: roles → schema → auth/storage policies and app triggers → data (single transaction, \`ON_ERROR_STOP\`)."
  echo "- Platform parameter grants skipped from \`roles.sql\` (already present in any new project): $skipped_grants."
  if [[ $1 == full ]]; then
    echo "- Tables compared: $checked; rows restored in matching tables: $total_rows."
    echo "- $storage_full"
  else
    echo "- Tables compared: $checked (row counts are in the encrypted archive's \`restore-report.md\`)."
    echo "- $storage_pub"
  fi
  echo "- Schema objects matching the source: ${objects:-none}"
  echo "- Vault secrets are not in the dump by design; re-create from the owner's offline escrow and check against \`vault-secret-fingerprints.tsv\`: ${vault_names:-none recorded}."
  echo
  if ((fail)); then
    echo "**Result: FAIL**"
    echo
    if [[ $1 == full ]]; then
      echo "| Table | Source | Restored | Problem |"
      echo "|---|---|---|---|"
      printf '%s' "$rows"
    else
      echo "| Table | Problem |"
      echo "|---|---|"
      printf '%s' "$pub_rows"
    fi
  else
    echo "**Result: PASS** — every table's restored row count is within the source counts taken before and after the dump."
  fi
}
summary full >"$report"
summary public
((fail)) && exit 1
exit 0
