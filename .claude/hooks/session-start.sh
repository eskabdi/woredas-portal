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
# supply-chain guard that only `bun install` honours -- an npm fallback would
# install dependencies with no such guard at all, silently. So a container
# without bun gets bun installed, not routed around it (see issue #41).
BUN=""
if command -v bun >/dev/null 2>&1; then
  BUN="bun"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
  echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"
else
  echo "bun not found; installing it (bunfig.toml's release-age guard requires bun install)." >&2
  curl -fsSL https://bun.sh/install | bash
  BUN="$HOME/.bun/bin/bun"
  echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"
fi

echo "Installing dependencies with $BUN…"
"$BUN" install

echo "Dependencies ready."
