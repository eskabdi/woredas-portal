#!/bin/bash
# Installs dependencies so lint, typecheck and the dev server work from the
# first turn of a Claude Code on the web session. Without this, `bun run lint`
# and `tsc --noEmit` fail with module-resolution errors in a fresh container and
# look like code faults rather than a missing node_modules.
set -euo pipefail

# Local sessions manage their own toolchain; only set up the remote container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# bun is the package manager of record here (bun.lock, bunfig.toml) and is what
# CI and Vercel build with. bunfig.toml sets minimumReleaseAge, a 24h
# supply-chain guard that only `bun install` honours — so npm is a fallback for
# a container without bun, not an equivalent.
BUN=""
if command -v bun >/dev/null 2>&1; then
  BUN="bun"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
  echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"
fi

if [ -n "$BUN" ]; then
  echo "Installing dependencies with $BUN…"
  "$BUN" install
else
  echo "bun not found; falling back to npm (bunfig.toml's release-age guard will not apply)." >&2
  npm install --no-audit --no-fund
fi

echo "Dependencies ready."
