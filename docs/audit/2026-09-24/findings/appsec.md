# Application Security Review (OWASP Top 10): woredas-portal

**Auditor:** audit-appsec (Wave 2) · **Date:** 2026-09-24 · **HEAD:** `9950f16e426eedd586c6fd85f6c328d9923542d1`
**Scope:** injection (SQL and PostgREST filter strings), XSS (including the in-house letter sanitiser and print surfaces), CSRF, input validation, error handling, file upload, security headers and CSP, open redirect, clickjacking, and mass assignment.
**Checklist IDs owned:** C-01, C-02, C-03, C-06, C-07, C-08, D-02.
**Machine-readable output:** `findings/appsec.json`. Raw evidence: `raw/appsec-*.txt`.

## 1. Executive summary

The application has no SQL injection surface. None of the 90 migrations uses dynamic SQL, RPCs take typed parameters, and the Edge Functions use supabase-js builders only. There is no CSRF surface either, because authentication is a bearer token sent in a header, with no cookies and no server functions. The in-house HTML sanitiser for letter templates is better than an in-house sanitiser usually is. It survived 16 targeted mXSS and URL-obfuscation payloads under jsdom. Clickjacking protection, open-redirect hygiene, CSV formula-injection guards and Edge Function error sanitisation are all in place.

Two High findings stand out, and both concern the service-letter feature, which is the second public verification surface:

1. **WP-APP-001, stored XSS.** The template editor renders unsanitised `service_type.letter_body_html` from the database straight into `innerHTML`. The sanitiser protects every other sink, but not this one. The CSP allows `'unsafe-inline'` and tokens are kept in `localStorage`, so the payload leads to session takeover of another tenant administrator.
2. **WP-APP-002, mutable issued letters.** After issuance, any holder of `service.create` (a registry_clerk, for example) can rewrite the fields that the public `/verify/letter/$token` page attests: the summary, subject, issue date, linked resident and even the token. Receipts and credentials have immutability triggers. Letters do not.

The Medium findings cover a non-strict CSP (WP-APP-003), upload constraints enforced only in the client for 8 of 10 buckets with SVG accepted on two paths (WP-APP-004), and allow-list validation of FAN, phone and email that exists only in the UI, with no server-side FAN uniqueness (WP-APP-005).

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | none |
| High | 2 | WP-APP-001, WP-APP-002 |
| Medium | 3 | WP-APP-003, WP-APP-004, WP-APP-005 |
| Low | 4 | WP-APP-006, WP-APP-007, WP-APP-008, WP-APP-009 |
| Info | 1 | WP-APP-010 |

Cross-references (not duplicated here): **WP-BQ-001** (128 raw `error.message` toasts, which feeds the C-07 verdict), **WP-DB-002** (storage policies not permission-gated, which feeds the C-08 verdict), **WP-DB-001** (suspended users keep storage access), and **WP-DB-007** (numbering triggers accept client-supplied values, the same class of problem as the client-chosen letter token in WP-APP-002).

## 2. Method

- **Injection.** I searched all migrations for `EXECUTE` and `format(`, and every `format()` turned out to be a `RAISE` message builder. I enumerated all 14 `.or()`, `.ilike()` and `.like()` constructions in `src/`, traced each interpolated value to its source, and checked every dynamic `.order()` for an allow-list. Output is in `raw/appsec-injection-scan.txt`.
- **XSS.** I enumerated every HTML sink (`raw/appsec-xss-sinks.txt`) and read `sanitizeLetterHtml` line by line. I ran it under jsdom via bun against 16 payloads covering svg/math/noscript/template namespace confusion, table foster-parenting, comment breakout, `java&#x09;script:` and leading-space URLs, event handlers, `<base>`/`<form>`/`<style>`, CSS escaped-semicolon smuggling, and token-in-attribute breakout. The output was re-parsed and scanned for dangerous nodes and attributes. The script and output are in `raw/appsec-sanitiser-fuzz.*`. I also reviewed print surfaces (html2canvas renders to a raster PDF), QR-decoded content, the Leaflet usage (no `bindPopup`) and the shadcn chart style sink (unused).
- **Mass assignment.** A client-side payload spread is not a control in this architecture, because any user can call PostgREST directly. I therefore assessed **database-side column protection** for each class of sensitive column: the tenant (`woreda_id`, pinned by RLS `WITH CHECK`), actors (`force_actor_columns()` on 15 tables), status (the FSM trigger) and post-approval content (per-table immutability triggers). Output is in `raw/appsec-mass-assignment.txt`.
- **Uploads.** I enumerated all 11 `.upload()` call sites and all 10 bucket definitions, including later `UPDATE storage.buckets` statements (`raw/appsec-uploads.txt`).
- **Latest definitions.** For `enforce_workflow_transition()` I used 00046, for `verify_service_letter()` 00064, for the `service_request` policies 00061, and for `payment_amount_check` 00059.
- **Limits.** The live database and the deployed URL were unreachable, so header presence on Vercel and live policy and grant state are marked accordingly.

## 3. Findings

### WP-APP-001 (High): stored XSS through the letter-template editor

**Evidence**
- `src/components/settings/LetterTemplatesTab.tsx:71`: `setHtml(selected.letter_body_html ?? plainTextToHtml(...))`. This is the raw database value. The first letter type is auto-selected at lines 65-67.
- `src/components/ui/rich-text-editor.tsx:46`: `if (el && el.innerHTML !== value) el.innerHTML = value || "";`
- Sanitisation happens only in the saving browser (`LetterTemplatesTab.tsx:79`). The database accepts any HTML from `tenant.manage` holders (`baseline.sql:1649`).
- The CSP is `script-src 'self' 'unsafe-inline'` (`security-headers.ts:52`), and the session is in `localStorage` (`client.ts:24`).

**Why it matters.** Every other sink (the print route, issuance and the preview) runs `sanitizeLetterHtml()` first, and a regression test guards the print and issuance pair. The editor is the one sink that does not, and the test does not cover it. A tenant admin, or any super admin, can PATCH the column directly. The next tenant admin to open *Settings → Letter templates* then runs the payload, which can read that admin's refresh token. The attacker already holds `tenant.manage`, so the gain is impersonation, persistence and audit mis-attribution rather than new privileges. CVSS is therefore 6.1, but stored XSS is rated High under the audit rubric.

**Fix.** Sanitise before every `innerHTML` assignment and in `setHtml`. Switch to DOMPurify with the same allow-list. Add a server-side guard, either a trigger or an RPC, that rejects active content in `letter_body_html`. Extend the parity test to cover the editor and preview.

### WP-APP-002 (High): issued service letters can be rewritten, and the public verifier attests the rewritten values

**Evidence**
- The FSM exits early when status is unchanged: `00000000000046_task10_credential_lifecycle.sql:166`.
- The UPDATE policy admits 13 service permissions, including `service.create` held by registry_clerk: `00000000000061:45-63` and `permissions.ts:373`.
- The fields the public page shows are written by the browser at issuance: `woreda.services.$requestId.index.tsx:293-297` (`issued_at`, `issued_letter_html`, `letter_summary`).
- `verify_service_letter()` returns `subject`, `issued_at`, the resident resolved via `resident_id`, and `COALESCE(letter_summary, purpose)`: `00000000000064:23-47`.
- `verification_token` is accepted from the client on INSERT (`baseline.sql:997`) and never guarded on UPDATE. Compare `receipt` (`00000000000013:87`) and `residence_credential` (`00000000000046:39-47`), which are frozen.
- The print route ignores the snapshot and re-renders from the live template: `woreda.services.$requestId.print.tsx:77-81`.

**Why it matters.** A letter is an official document that third parties verify by scanning its QR code. Once issued, a clerk can change what the QR code attests without touching the status, so the payment, issuance and FSM gates never fire and `workflow_status_history` records nothing. The clerk can change the summary text ("confirms income of …"), backdate `issued_at`, re-point the letter to a different resident, or rotate or choose the token. A reprint after a template edit also no longer matches what was issued.

**Fix.** Add a freeze trigger on `service_request` once `issued_at IS NOT NULL`, generate the token and `issued_at` server-side only, build the snapshot server-side, and have the print route render the snapshot. A sketch is in the JSON. Confidence is *Likely* because the live policies could differ from the migrations.

### WP-APP-003 (Medium): the CSP does not mitigate inline script, and tokens are readable by any injected script

HSTS, frame-ancestors, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy (camera and geolocation limited to self) are all correct in code (`src/lib/security-headers.ts:48-104`, applied in `src/server.ts:46-52`). `script-src 'unsafe-inline'`, however, also permits `on*=` handler attributes, and the project documents it as deliberate because TanStack Start emits two inline scripts. Combined with `localStorage` token storage, any HTML sink becomes a full session compromise. The fix is nonces with `'strict-dynamic'`, followed by Trusted Types. The headers still need to be confirmed on the live Vercel URL, since there is no `vercel.json` and only `server.ts` sets them.

### WP-APP-004 (Medium): upload controls are client-side only for 8 of 10 buckets

**Upload matrix (all 11 call sites)**

| # | Call site | Bucket | Client MIME check | Size | Object name | Bucket-level limits |
|---|---|---|---|---|---|---|
| 1 | `admin.credential-template.tsx:482` | credential-templates | none (super-admin only) | none | `${side}.${ext}` (stable, ext from name if not JPEG/PNG) | none |
| 2 | `woreda.settings.woreda-configuration.tsx:692` | tenant-assets | PNG/JPEG | yes | `${woredaId}/${field}.${ext}` (stable, upsert) | none |
| 3 | `woreda.rental-houses.occupants.new.tsx:362` | rental-request-documents | per-tile list | yes | `${woredaId}/${rid}/${key}-${Date.now()}.${ext}` | **5 MB, PDF/JPEG/PNG** (00072) |
| 4 | `woreda.credentials.new.tsx:373` | attachments | PDF/JPEG/PNG | 5 MB | `${woredaId}/${uuid}.${ext from file.name}` | none |
| 5 | `woreda.credentials.new.tsx:406` | attachments | JPEG/PNG | 5 MB | `${woredaId}/${uuid}.${ext from file.name}` | none |
| 6 | `woreda.services.$requestId.index.tsx:382` | service-request-documents | JPEG/PNG/WEBP/PDF | 5 MB | `${woredaId}/${id}/${Date.now()}-${sanitisedName}` | none |
| 7 | `woreda.services.new.tsx:290` | service-request-documents | same | 5 MB | same | none |
| 8 | `ResidentProfileTabs.tsx:807` | resident-documents | PDF | 10 MB | `${woredaId}/${residentId}/${uuid}.pdf` | **10 MB, PDF** (00004) |
| 9 | `ResidentWizardSteps.tsx:222` | resident-photos | **none** (`image/*`, SVG passes `toWebp`) | 5 MB | `${woredaId}/${uuid}.${ext}` | none |
| 10 | `ResidentWizardSteps.tsx:301` | resident-clearance-letters | PDF/JPEG/PNG | 5 MB | `${woredaId}/${uuid}.${ext from file.name}` | none |
| 11 | `UsersRolesTab.tsx:697` | staff-assets | **none** (`image/*`) | 5 MB | `${woredaId}/${uuid}.${ext}` | none |

A direct Storage API call bypasses every client-side check. No path checks magic bytes, there is no malware scanning, and the client-computed sha256 is never verified. Non-PDF attachments are opened top-level from the storage origin (`woreda.credentials.$requestId.index.tsx:291,330`; `woreda.services.$requestId.index.tsx:421`), so an HTML or SVG object would render as a document there. That origin differs from the app origin, so the app's tokens are not exposed, but it is a credible phishing and malware-distribution path. The remedy is to set `allowed_mime_types` and `file_size_limit` on every bucket, map extensions from MIME type, add MIME checks to paths 9 and 11, serve downloads with `download: true`, and add scanning or record it as an accepted gap. The fact that any staff member can overwrite or delete objects is WP-DB-002.

### WP-APP-005 (Medium): allow-list validation of identifiers is client-only

The client-side validation is good: FAN is 16 digits (`residentSchema.ts:36`), phone is 9 digits under a fixed +251 prefix (`phoneNumber.ts:59`), and email uses a regex. The database checks none of them except `resident.email` (`baseline.sql:597`). `normalize_phone()` never rejects input. No unique index exists on the FAN blind index, and the blind index is computed over the trimmed raw string, so the duplicate-FAN check (`ResidentWizardSteps.tsx:167`) is only an advisory warning and is defeated by reformatting. Free-text lengths are unbounded in the database. Several forms (`woreda.services.new.tsx`, `rental-houses.occupants.new.tsx`, the invite dialogs) do not use Zod. The invite Edge Functions check only that fields are present. The practical risk is duplicate identities and duplicate credentials created through direct PostgREST writes. Fix with CHECK constraints, a partial unique index, FAN normalisation before hashing, and schema validation in Edge Functions (see the JSON for SQL).

### WP-APP-006 (Low): PostgREST `.or()` filter strings are only partially escaped

Eight call sites strip only `%` and `,` before interpolating search text into `.or()` (`woreda.residents.index.tsx:191`, `ServiceRequestList.tsx:195`, `admin.audit.tsx:225`, `woreda.audit.tsx:298`, `woreda.households.index.tsx:127`, `woreda.credentials.index.tsx:120`, `CredentialQueueTable.tsx:180`, `ResidentSearchPicker.tsx:84`). Without commas no sibling predicate can be injected, and RLS bounds every query, so the effect is limited to parse errors and `*` wildcarding. `woreda.rental-houses.occupants.new.tsx:266` already strips `[%,()*]`, and that pattern should be adopted centrally.

### WP-APP-007 (Low): CSV quoting ignores a bare CR and `;`

Both CSV builders prefix leading formula characters, as they should. They quote only when a value contains `"`, `,` or LF, so a value containing `\r=…` or `;=…` is emitted unquoted (`raw/appsec-csv-escape.txt`). Quoting every field unconditionally closes the gap.

### WP-APP-008 (Low): `error_description` is reflected on the landing page

`src/lib/authRedirect.ts:34` and `src/routes/index.tsx:109` render arbitrary URL text on the official domain. React escapes it, so it is not XSS, but it can be used for social engineering. Map known GoTrue error codes to fixed copy instead.

### WP-APP-009 (Low): invite usernames collide globally

`invite-tenant-user/index.ts:134` sets `username = email local part`, but `app_user.username` is globally UNIQUE (`baseline.sql:536`). A collision means the invite email has already been sent before the `app_user` insert fails, which leaves an orphaned auth user and a small cross-tenant existence signal.

### WP-APP-010 (Info): letter sanitiser observations

No browser-side bypass was found. The sanitiser collapses disallowed elements to text nodes, keeps only HTML-namespace tags, checks href schemes after entity decoding, and escapes token values after sanitising. The residual items are hardening only:
- The SSR regex fallback (`letterTemplate.ts:64`) would pass `<img onerror>`. It is unreachable because of `ssr: false`.
- Style values are not validated (an escaped-semicolon payload is kept but is inert).
- `issued_letter_html` is client-produced and currently unread, which makes it a latent sink.

The recommendation is to adopt DOMPurify as a pinned direct dependency.

## 4. Controls verified as correct

- **SQL injection.** Zero dynamic `EXECUTE` in 90 migrations, and every RPC takes typed parameters. Dynamic `.order()` columns are mapped through fixed objects or switches (`SORT_COLUMN`, `sortColumn`), and `.select()` strings are never built from input.
- **CSRF (C-03 N/A).** Tokens are bearer-only (`client.ts:24`, `auth-attacher.ts`). There are no `createServerFn` or cookie-reading endpoints, the only cookie is sidebar UI state, and Edge Functions use an Origin allow-list with `Vary: Origin`.
- **Open redirects.** Every `navigate()` targets a fixed route. Invite and reset `redirectTo` values are server-built from `SITE_URL`. `window.open` is used only with Supabase signed URLs or a fixed internal path.
- **Clickjacking.** `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN`, verified in code.
- **Print surfaces.** `PrintDocumentShell` and the receipt route rasterise through html2canvas into jsPDF. The only HTML injected into a print page is sanitised letter HTML. QR-decoded text and the public verification pages (`v.$token`, `verify.letter.$token`, `verify.receipt.$token`) render through React text nodes.
- **Mass assignment of actor columns and tenant.** `force_actor_columns()` overwrites `*_by_user_id` and `updated_by` with `auth.uid()` on 15 tables. The FSM forbids clearing `verified_by`/`approved_by`. RLS `WITH CHECK` pins `woreda_id`. `residence_credential` number, serial and QR payload, `receipt.verification_token`, and `vital_event.resident_id` are immutable once set.
- **Error handling in Edge Functions.** All 8 outer `catch` blocks return a fixed string through `safeError()`. The SSR crash path renders a static page (`error-page.ts`), and the root `ErrorComponent` is generic. There is no `console.log` of PII or tokens anywhere in `src/`.
- **CSV exports.** All 13 go through the two formula-guarded builders.
- **Service worker.** It intercepts navigations only and never caches Supabase API traffic.

## 5. Checklist verdicts

| ID | Status | Basis |
|---|---|---|
| C-01 | PARTIAL | No SQL injection surface. Fails the literal PostgREST-filter criterion only (WP-APP-006, Low). |
| C-02 | FAIL | Unsanitised editor sink (WP-APP-001), non-strict CSP (WP-APP-003), no DOMPurify (WP-APP-010). |
| C-03 | N/A | Bearer-header auth, no cookie-authenticated endpoints, no server functions (reasoning above). |
| C-06 | FAIL | FAN, phone and household email are not enforced in the DB; FAN uniqueness is advisory; Edge Function bodies are presence-checked only (WP-APP-005, WP-APP-009). |
| C-07 | PARTIAL | Edge Functions and crash pages are generic, and no PII or tokens are logged. PostgREST errors are shown raw in 128 toasts (WP-BQ-001), and login shows raw GoTrue text. |
| C-08 | FAIL | Private buckets, UUID names and prefix RLS pass. MIME and size limits are enforced server-side in only 2 of 10 buckets, SVG is accepted, there is no magic-byte check or scanning (WP-APP-004), and storage writes are not permission-gated (WP-DB-002). |
| D-02 | PARTIAL | The SFD has a platform-level validation section. It is not per module and contains two inaccurate claims. |

## 6. Documentation drift (summary; full list in JSON)

| Claim | Source | Verdict |
|---|---|---|
| Letter HTML is treated as untrusted and sanitised where it renders | CLAUDE.md | CONTRADICTED (editor sink) |
| "Snapshots the rendered letter … so the public QR page can show it" | services.$requestId.index.tsx:252 | CONTRADICTED (mutable, and the print route ignores it) |
| resident-documents is "the one bucket" with bucket-level limits | CLAUDE.md | CONTRADICTED (rental-request-documents too, since 00072) |
| "Nine buckets" / "All 7 storage buckets private" | CLAUDE.md / security-hardening.md:38 | CONTRADICTED (10; all private) |
| Upload paths all follow `${woredaId}/${uuid}.${ext}` | CLAUDE.md | CONTRADICTED (services and rental use timestamps and names) |
| Validation "consistently applied", allow-list at both layers | security-functionality.md | CONTRADICTED |
| `payment.amount` requires `> 0` | security-functionality.md:56-57 | CONTRADICTED (`>= 0` since 00059) |
| CSP "still blocks … the common injection paths after XSS" | security-headers.ts comment | CONTRADICTED |
| Zod in 14 route files; CSRF correctly absent; headers set in server.ts; safeError everywhere; CSV formula guard; no server functions | various | CONFIRMED |

## 7. Leads for other agents

- **workflows:** `enforce_workflow_transition()` ignores all non-status column edits (00046:166). The same post-approval mutability as WP-APP-002 probably applies to `vital_event.event_details`, `event_date` and similar fields after registration, and to `rental_occupancy_request` content after approval. I checked only the letter table because it backs a public verifier.
- **workflows / authz:** `force_actor_columns()` overwrites a column only when it is non-NULL, so an INSERT can leave `requested_by_user_id` NULL (no maker recorded). Assess whether any maker-checker comparison relies on the requester.
- **auth-session:** `login.tsx:100` shows raw GoTrue messages ("Email not confirmed" enumerates accounts). JWT and refresh lifetime matter more given WP-APP-003.
- **ops:** verify the production security headers with `curl -sI` against `/`, a deep link, `/v/<x>` and a 404.

## 8. Artifacts

`raw/appsec-sanitiser-fuzz.txt` and `.ts.txt`, `raw/appsec-csv-escape.txt` and `.ts.txt`, `raw/appsec-xss-sinks.txt`, `raw/appsec-injection-scan.txt`, `raw/appsec-uploads.txt`, `raw/appsec-mass-assignment.txt`.
