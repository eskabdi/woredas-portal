# Working notes

Environment-specific gotchas hit while migrating this project to Supabase and
deploying it to Vercel. Each entry is a problem that cost real time and the fix
that actually worked.

## Sandboxed agent environments (Claude Code on the web, CI containers)

Outbound traffic is restricted to HTTPS through a local proxy. Two consequences
that are not obvious from the error messages.

### 1. Headless browsers cannot reach the internet by default

Playwright/Chromium bypasses the shell's proxy settings, so every external
navigation fails with `net::ERR_CONNECTION_RESET` even though `curl` to the
same URL works. The proxy also terminates TLS, so its certificate is not one
Chromium trusts.

Pass the proxy explicitly and accept its certificate:

```js
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY },
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
```

`HTTPS_PROXY` is assigned per shell invocation and the port changes between
calls, so read it from the environment at launch. Never hard-code it, and never
disable TLS verification globally to work around it.

Testing against a *local* service (`127.0.0.1`) needs none of this.

### 2. Postgres ports are blocked; the Management API is the way in

`psql` to either the direct host or the pooler hangs and then times out:

- `db.<ref>.supabase.co` resolves to IPv6 only, which the sandbox has no route
  for, unless the project has the IPv4 add-on.
- `aws-0-<region>.pooler.supabase.com` resolves over IPv4 but ports 5432 and
  6543 are blocked outright. Port 443 to the same host is open, which is the
  tell that this is a port policy and not a Supabase problem.

Run SQL over HTTPS instead:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @payload.json     # {"query": "..."}
```

Build the JSON payload with a real serializer. Migration SQL contains quotes and
dollar-quoted function bodies that shell escaping mangles, and the failure looks
like a SQL syntax error rather than a quoting bug.

## Supabase

### Auth redirect URLs must be top-level, and allow-listed

For `POST /auth/v1/admin/generate_link`, `redirect_to` goes at the **top level**
of the body. Nesting it under `options` — which is where the JS client puts it —
makes the server ignore it silently and fall back to `site_url`:

```jsonc
{"type":"magiclink","email":"...","redirect_to":"https://app.example.com/"}   // honored
{"type":"magiclink","email":"...","options":{"redirect_to":"..."}}            // ignored
```

A URL that is not in `uri_allow_list` is also replaced by `site_url` with no
error. Both failure modes look identical, so when a redirect does not stick,
check the parameter position before assuming the allow-list is wrong.

Allow-list entries need the origin *and* a wildcard to cover both the bare
origin and sub-paths:

```
https://app.example.com/**,http://localhost:5173,http://localhost:5173/**
```

Keep these narrow. A pattern like `https://*.vercel.app/**` would let any site
on that domain receive users' auth tokens.

### Edge Functions are a separate deploy artifact

`supabase db push` and seed files do not touch them. Deploying is a
control-plane operation: a project `service_role` key cannot do it, only
`supabase login` or a Personal Access Token.

The CLI's `functions list` and `functions deploy` fail with `TransportError`
behind the proxy. The Management API works:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=$FN" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F "metadata={\"name\":\"$FN\",\"entrypoint_path\":\"index.ts\",\"verify_jwt\":false};type=application/json" \
  -F 'file=@index.ts;type=application/typescript'
```

To tell a deployed function from a missing one, call it unauthenticated. A
deployed function answers `401` with its own error body; a missing one answers
`404 {"code":"NOT_FOUND"}`. `scripts/deploy-functions.sh` wraps all of this.

## Vercel

### Deploy as an archive

`vercel deploy` uploads many files in parallel and dies partway through the
proxy with `fetch failed`, leaving a project that exists but has zero
deployments — so the URL 404s and it looks like the deploy never started.
`--archive=tgz` sends one tarball and gets through:

```bash
vercel deploy --prod --yes --archive=tgz --token="$VERCEL_TOKEN"
```

### Framework preset must stay "Other"

Nitro detects Vercel from the `VERCEL` env var and emits Build Output API v3
into `.vercel/output`. Setting the framework to `vite` makes Vercel look for a
static `dist/` instead and SSR breaks. Leave `framework: null` with
`buildCommand: bun run build`.

Do not pin a nitro preset in `vite.config.ts`. With none set, nitro builds
`node-server` locally and switches to `vercel` in CI on its own; pinning
`vercel` breaks local builds.

## This project

- Route files under `src/routes/` drive `src/routeTree.gen.ts`, which is
  generated at build time. After adding a route, run `bun run build` before
  `tsc --noEmit` — otherwise typecheck fails against the stale tree with
  "not assignable to type" errors that look like a mistake in the new route.
- `user_has_perm()` requires `app_user.status = 'active'`. A `pending` account
  authenticates fine and then sees every query return empty, with nothing in the
  UI explaining why.
- RLS lets a user read their own `app_user` row but not write it, so an account
  cannot activate itself. Activation is an administrator action by design.
