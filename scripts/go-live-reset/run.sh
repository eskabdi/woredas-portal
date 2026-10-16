#!/usr/bin/env bash
# Runs reset.sql against the production project through the Management API
# (Postgres ports are blocked in sandboxed shells; see CLAUDE.md).
#
#   scripts/go-live-reset/run.sh            # dry run: everything rolls back
#   scripts/go-live-reset/run.sh --apply    # go-live day only, see the runbook
#
# Needs SUPABASE_ACCESS_TOKEN in the environment; never prints it. Output is
# counts only.
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-tugzuexfyzbdnghbmrjl}"
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"

APPLY=""
if [[ "${1:-}" == "--apply" ]]; then
  read -r -p "Type the project ref to confirm a PERMANENT reset of $REF: " answer
  [[ "$answer" == "$REF" ]] || { echo "Not confirmed; nothing done." >&2; exit 1; }
  APPLY="SET LOCAL golive.apply = 'yes';"
fi

PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT
python3 -I -c '
import json, sys
sql = "BEGIN;\n" + sys.argv[2] + "\n" + open(sys.argv[1]).read() + "\nCOMMIT;\n"
json.dump({"query": sql}, open(sys.argv[3], "w"))
' "$DIR/reset.sql" "$APPLY" "$PAYLOAD"

curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @"$PAYLOAD"
echo
