# Application security hardening

How the capabilities usually bought as WAF / DDoS protection / SSL-TLS /
API Shield / Page Shield map onto this stack (Vercel + Supabase), what is
implemented in this repository, and what has to be clicked in a dashboard
because no repo change can turn it on.

The short version: those five names are Cloudflare products. This app does not
sit behind Cloudflare — it sits behind Vercel's edge (frontend/SSR) and
Supabase (API, auth, storage, Edge Functions), each of which ships its own
version of most of these capabilities. Putting Cloudflare in front as well is a
legitimate option, listed last, but it requires a custom domain and is not a
repo change.

## What is implemented in this repository

`src/lib/security-headers.ts`, applied to every document response in
`src/server.ts`:

| Header                                       | Value / intent                                                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security`                  | 2 years, includeSubDomains — closes the first-visit HTTP downgrade window                                                                                                                                               |
| `Content-Security-Policy`                    | allow-list of exactly the origins the app uses (Google Fonts, OSM tiles, the Supabase project, data:/blob: for QR/barcode/WebP); blocks foreign script files, `object-src`, base/form hijacks; `frame-ancestors 'self'` |
| `X-Frame-Options`                            | `SAMEORIGIN` (react-to-print stages the card in a same-origin iframe; older-engine backstop for frame-ancestors)                                                                                                        |
| `Permissions-Policy`                         | camera and geolocation to self (QR scanner, map picker), everything else denied                                                                                                                                         |
| `X-Content-Type-Options` / `Referrer-Policy` | nosniff / strict-origin-when-cross-origin                                                                                                                                                                               |

Known limitation, on purpose: `script-src` includes `'unsafe-inline'` because
TanStack Start's SSR emits two inline scripts (stream barrier, scroll
restoration). The upgrade is per-request nonces threaded through the shell
render — do it as its own change and verify against a real login, the print
flow, and a live QR scan before shipping.

Also verified in place (not new, but part of the security posture):

- **RLS coverage is total** — checked against the live project: zero public
  tables with row security disabled, zero with policies missing.
- **All 7 storage buckets private**, reads via signed URLs only.
- **All 4 Edge Functions authenticate internally** (401 without a session,
  `getUser` validation, role check → 403) even though they deploy with
  `verify_jwt:false` — the auth is in the function body, where it also enforces
  _authorization_, not just authentication.
- **Credential signing is ES256 server-side**; the signer reads every field
  from the database, never the request.

## Dashboard actions — cannot be done from the repo

Do these in the consoles. None of them have a code equivalent.

### Vercel (vercel.com → project → Settings)

1. **Firewall / WAF** — Security tab: enable the managed WAF ruleset (OWASP
   core rules) and Attack Challenge Mode for automated-traffic spikes. This is
   the actual "WAF" line item; Vercel's DDoS mitigation at L3/L4 is always on.
2. **Deployment Protection** — leave production public, but set preview
   deployments to require Vercel authentication, so unfinished builds of a
   government portal are not publicly browsable.
3. **HSTS preload** — only after confirming subdomain coverage: submit the
   domain at hstspreload.org, then add `preload` to the header in
   `security-headers.ts`. Hard to undo; do it deliberately.

### Supabase (supabase.com/dashboard → project)

1. **Auth → Rate Limits** — lower the sign-in and OTP rate limits; the
   defaults are permissive for an internal-staff app with 4 users.
2. **Auth → Attack protection** — enable CAPTCHA on sign-in (Turnstile or
   hCaptcha) and **leaked password protection** (HaveIBeenPwned check).
3. **Settings → API** — confirm the `uri_allow_list` stays narrow (see
   CLAUDE.md's warning about wildcard vercel.app patterns receiving auth
   tokens).
4. **Settings → Database → Network Restrictions** — restrict direct Postgres
   connections to known egress IPs, or to none: this app never connects to
   Postgres directly (everything goes through PostgREST/functions), so the
   direct port can be closed to the world.

## The Cloudflare-shaped items, honestly

| Cloudflare product | What it adds                                     | Status on this stack                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAF                | managed OWASP rules at the edge                  | **Covered** by Vercel's WAF once enabled (above)                                                                                                                                                                                          |
| DDoS Protection    | L3–L7 absorption                                 | **Already on** at both Vercel and Supabase; nothing to configure                                                                                                                                                                          |
| SSL/TLS            | cert issuance, TLS termination                   | **Already on** — Vercel auto-provisions and renews certs, TLS 1.2+; HSTS added by this repo                                                                                                                                               |
| API Shield         | mTLS, schema validation, abuse detection on APIs | **Partially equivalent**: RLS + JWT + in-function authorization is the real gate here. True mTLS/schema-validation needs Cloudflare proxying a custom domain in front of Supabase — meaningful only if the API is opened to third parties |
| Page Shield        | monitors scripts running on your pages           | **CSP is the in-repo counterpart** — it _prevents_ foreign scripts rather than monitoring them. Actual Page Shield needs Cloudflare in front of the frontend                                                                              |

To genuinely put Cloudflare in front: buy/attach a custom domain, proxy it
through Cloudflare (orange cloud), set SSL mode **Full (strict)**, then point
it at Vercel per Vercel's Cloudflare guide. Until a custom domain exists, none
of the Cloudflare products can be attached to `*.vercel.app`.

## Verification

After any deploy, confirm the headers survived the platform:

```bash
curl -sSI https://woredas-portal.vercel.app/ | grep -iE \
  "strict-transport|content-security|x-frame|permissions-policy|x-content-type|referrer"
```

Then exercise the three CSP-sensitive flows in a browser with DevTools console
open (violations log there): sign in, print a credential, scan a QR with the
verifier. A CSP regression shows up as a console violation, not a blank page.
