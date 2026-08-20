#!/usr/bin/env bash
#
# Deploys the Edge Functions to a Supabase project.
#
# These are the one piece of the migration that neither `supabase db push` nor
# the seed files cover: Edge Functions are a separate deploy artifact, and
# deploying them is a control-plane operation. A project-scoped service_role
# key cannot do it -- it needs account-level auth, so either `supabase login`
# or a Personal Access Token in SUPABASE_ACCESS_TOKEN.
#
# Usage:
#   supabase login                       # or: export SUPABASE_ACCESS_TOKEN=sbp_...
#   ./scripts/deploy-functions.sh <project-ref>
#
# --use-api bundles server-side, so Docker is not required.

set -euo pipefail

REF="${1:-}"
if [[ -z "$REF" ]]; then
  echo "usage: $0 <project-ref>" >&2
  echo "  e.g. $0 tugzuexfyzbdnghbmrjl" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

FUNCTIONS=(
  invite-platform-admin
  invite-tenant-user
  resend-platform-invite
  sign-credential
)

echo "==> Deploying ${#FUNCTIONS[@]} function(s) to $REF"
supabase functions deploy "${FUNCTIONS[@]}" --use-api --project-ref "$REF"

cat <<'EOF'

==> Deployed. One secret still has to be set by hand.

sign-credential reads HARARI_RSA_PRIVATE_KEY from its function environment.
It is not in this repository -- it lives in the SOURCE project's Edge Function
secrets (Dashboard -> Edge Functions -> Secrets). Without it the function
deploys but fails at runtime, and it is the function behind ID card issuance.

  supabase secrets set HARARI_RSA_PRIVATE_KEY='<value from the old project>' \
    --project-ref <project-ref>

SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
automatically and do not need setting.

==> To confirm the deploy took, call an endpoint unauthenticated:

  curl -X POST https://<project-ref>.supabase.co/functions/v1/invite-tenant-user \
    -H "apikey: <publishable key>" -H 'Content-Type: application/json' -d '{}'

A deployed function answers 401 with its own error body, e.g.
{"error":"Unauthorized"}. A 404 {"code":"NOT_FOUND"} means it is still absent.
EOF
