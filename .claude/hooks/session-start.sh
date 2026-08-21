#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# bun.lock pins versions; installing from it needs no registry resolution,
# only tarball fetches, so this stays fast even under bunfig.toml's 24h
# minimumReleaseAge guard.
bun install
