<!-- Copied verbatim from the audit prompt, Appendix A and Appendix B (audit run 2026-09-24). -->

# APPENDIX A — INSA TECHNICAL DEVELOPMENT CHECKLIST (IMPLEMENTED AS AUDIT CONTROLS)

Source: *INSA Technical Development Enforcer* (Web Application Security Testing Requirements §4.2.1–4.2.5, §5 APIs), aligned to OWASP Top 10, NIST CSF, ISO/IEC 27001. Each control = requirement + how to verify in THIS repo + pass criterion. Copy this appendix verbatim to `docs/audit/<DATE>/reference/INSA-CHECKLIST.md`.

Status values: **PASS · PARTIAL · FAIL · N/A · UNVERIFIED** (N/A requires written justification).

## A. Phase 1 — Technical Architecture & Design

| ID | Requirement | How to verify | PASS when |
|---|---|---|---|
| A-01 | DFD Level 0: external actors + system boundary | Search `docs/` for DFD; else auditor generates as-is | A current DFD L0 exists in repo and matches code actors (8 roles, Super Admin, external services) |
| A-02 | DFD Level 1 & 2: processes, data stores, flows | Compare doc DFD to route + table inventory | L1 covers all modules; L2 for Credentials + Civil Registration; no undocumented stores |
| A-03 | Sensitive data entry points & flows flagged and secured | Cross-check DFD flows vs PII inventory | Every PII/financial flow marked and mapped to a control (TLS, RLS, validation) |
| A-04 | Deployment architecture defined (cloud/on-prem/hybrid) | Docs + hosting config + Supabase project | Deployment diagram exists and matches reality (hosting, Supabase region) |
| A-05 | Component architecture: modules, service-to-service, middleware, integrations | Imports graph, Edge Functions, RPCs | Component diagram lists every Edge Function, RPC group, external integration |
| A-06 | Security layers: DMZ, TLS termination, WAF, IDS/IPS in architecture | Hosting/CDN config, provider docs | Each layer labelled Owned/Inherited with evidence; none silently missing |
| A-07 | ERD: tables, PK/FK, relationships (Users, Roles, Permissions, Transactions…) | Migrations + types.ts + live catalog | ERD in repo matches live schema; all FKs present; no orphan tables |
| A-08 | Sensitive fields marked; AES-256 encryption or bcrypt/Argon2 hashing enforced | Column inventory; pgcrypto/Vault usage; Supabase Auth handles passwords (bcrypt) | Every sensitive column marked; passwords only in `auth.users` (hashed); Restricted PII (e.g. FAN ID) encrypted or justified + access-restricted |

## B. Phase 2 — Technical Stack & Features Inventory

| ID | Requirement | How to verify | PASS when |
|---|---|---|---|
| B-01 | Development frameworks recorded | `package.json`, docs | Documented with exact versions matching lockfile |
| B-02 | All libraries/plugins + versions recorded | `npm ls --all --json` | Inventory complete; no known Critical/High CVEs unaddressed |
| B-03 | Third-party integrations recorded (payment, SMS, external APIs) | `rg` for external URLs/SDKs, Edge Functions | Each integration listed with data shared + auth method + secret location |
| B-04 | Actor types with permission boundaries | `permissions.ts`, `role_permission`, RLS | 8 roles documented with boundaries that match DB enforcement |
| B-05 | Security infrastructure recorded (WAF, LB, IDS/IPS, SIEM) | Hosting/Supabase settings, docs | Each item stated Owned/Inherited/Absent with evidence |

## C. Phase 3 — Coding & Implementation (Active Enforcement)

| ID | Control | How to verify | PASS when |
|---|---|---|---|
| C-01 | SQL injection prevention: parameterized queries/ORM; no string-concatenated SQL | `rg -n "EXECUTE|format\(|\\$\{.*\}" supabase/`; review RPCs/Edge; PostgREST filter strings (`.or(\``, `.filter(`) | Zero concatenated SQL; dynamic SQL uses `format('%I','%L')`/`USING`; no user input interpolated into PostgREST filter strings |
| C-02 | XSS prevention: context-aware output encoding; `dangerouslySetInnerHTML` prohibited without sanitisation | `rg -n "dangerouslySetInnerHTML|innerHTML|bindPopup|javascript:" src` | Zero unsanitised sinks; DOMPurify (or equivalent) wherever HTML rendering is required; strict CSP present |
| C-03 | CSRF protection on every state-changing request | Determine auth transport (bearer vs cookie) | Bearer-only → documented N/A with reasoning; any cookie auth → CSRF token/SameSite=Strict + Origin check |
| C-04 | Cookies `Secure`, `HttpOnly`, `SameSite=Lax/Strict` | Supabase client storage config; any `document.cookie` writes | Session tokens in HttpOnly Secure SameSite cookies. localStorage storage → **PARTIAL** + declared compensating controls |
| C-05 | Session timeout defined (15–30 min inactivity) | Client idle timer code; Supabase Auth session settings; JWT expiry | Server-side inactivity/time-box configured AND client idle logout 15–30 min |
| C-06 | Strict allow-list input validation (regex, enums) | Zod schemas per form; DB CHECK constraints; RPC/Edge validation | Every input validated client AND server (DB constraint/RPC/Edge); enums not free text; FAN/phone/email regex enforced in DB |
| C-07 | Generic client errors; full stack traces logged server-side only | `rg -n "error\.message|toast\(.*error" src`; Edge Function catch blocks | Users see generic messages; details only in server logs; no PII/tokens in logs |
| C-08 | Secure file uploads: type allow-list, scanning, outside web root, random names | Storage buckets config, upload code, `storage.objects` policies | Private buckets, MIME + size allow-list, random object keys, per-woreda storage RLS, SVG blocked or sanitised; scanning in place or declared gap |

## D. Phase 4 — Security Functionality Document

| ID | Section | How to verify | PASS when |
|---|---|---|---|
| D-01 | Access control (RBAC/ABAC): which guard/policy enforces each endpoint | Search for SFD; build route→guard→RLS matrix | SFD exists and matrix matches code for every route/RPC/Edge Function |
| D-02 | Input validation strategy per module | SFD vs Zod/DB constraints | Documented per module and consistent with code |
| D-03 | Session & cookie logic: duration, regeneration on login, flags | SFD vs auth config | Documented values equal actual configuration |
| D-04 | Encryption in transit: TLS 1.2+ enforced | TLS check of deployed domain (ask user if not reachable); HSTS header | TLS ≥ 1.2 only, HSTS enabled, no mixed content (`rg -n "http://" src`) |
| D-05 | Logging: what is logged vs excluded (passwords, PII) | Audit trail table + triggers; `console.*` usage | Logged events defined and implemented; exclusions enforced; audit log append-only |

## E. Phase 5 — API Security Enforcement

| ID | Requirement | How to verify | PASS when |
|---|---|---|---|
| E-01 | Request/response sample files for success and failure (200/400/401…) | `docs/api/**`, `api/samples` | Samples exist for every Edge Function/RPC incl. error cases |
| E-02 | OpenAPI/Swagger spec: endpoints, headers, error codes | Search for `openapi.*`/`swagger.*` | Spec exists, validates, and matches deployed functions |
| E-03 | AuthN: OAuth 2.0 / JWT (short expiry + refresh) / mTLS; JWT has `exp`,`iat`; strong algorithm (e.g. RS256) | Supabase JWT settings; QR token claims; Edge verification code | Short-lived access tokens + rotating refresh; `exp`/`iat` present and checked; asymmetric signing (RS256/ES256) or declared gap if legacy HS256 |
| E-04 | Every route classified Public / Private / Internal in code comments | `rg -n "@classification|Public|Private|Internal" supabase/functions src` | 100% of Edge Functions/RPCs carry a classification comment matching reality |
| E-05 | Third-party keys in env/vault; webhook signatures validated | `Deno.env.get`, `.env` usage, webhook handlers | No keys in code/bundle; all webhooks verify signature + timestamp |
| E-06 | Authorization middleware verifies role/permission before processing (least privilege) | Edge Functions + RPCs: permission check before side effects | Every write path checks caller permission + woreda server-side before acting |

## F. Phase 6 — Testing Scope Artifacts

| ID | Requirement | How to verify | PASS when |
|---|---|---|---|
| F-01 | Structured scope table of all assets | Search docs; auditor generates | Asset table covers web app(s), APIs, Edge Functions, Storage, public endpoints |
| F-02 | Placeholder test accounts per privilege level (Admin, User, Guest) | Docs/seed files | Role × woreda test matrix defined (placeholders, no real secrets) |
| F-03 | Test credentials seeded ONLY in staging | `rg -n "insert into auth.users|seed" supabase/`; migrations | No test users/passwords in production migrations or repo |

## G. Execution Rule — Living Documentation

| ID | Requirement | How to verify | PASS when |
|---|---|---|---|
| G-01 | Every feature ships with updated DFD/ERD/SFD/API docs; missing controls implemented, not deferred | `git log --name-only -50`: feature commits vs doc commits | Docs updated in the same change set for ≥ 80% of feature commits; no documented "TODO: add security later" |

## H. Project-Specific Extensions (mandatory for this repo)

| ID | Requirement | PASS when |
|---|---|---|
| TEN-01 | RLS enabled (and ideally FORCED) on every `public` table | Appendix C query 1 shows `relrowsecurity = true` for all tables |
| TEN-02 | Every tenant table has NOT NULL `woreda_id` and policies scope by caller's woreda (from JWT/profile, not client input) | All policies reference a server-derived woreda helper; no client-trusted `woreda_id` |
| TEN-03 | INSERT/UPDATE policies have `WITH CHECK` preventing row migration across woredas | 100% coverage |
| TEN-04 | Views use `security_invoker`; SECURITY DEFINER functions pin `search_path` and re-check tenant | 100% coverage |
| TEN-05 | `anon` has no access to tenant data | Appendix C query 4 returns no tenant tables for `anon` |
| TEN-06 | Storage objects scoped per woreda | `storage.objects` policies use woreda path prefix/claim |
| CLS-01 | Column-level protection for Restricted PII (FAN ID, phone, GPS, photos) by role | viewer/auditor get masked/limited columns (view or column grants) |
| RBAC-01 | `P` constants ↔ `ROLE_PERMISSIONS` ↔ `role_permission` table ↔ RLS are consistent | Zero mismatches in the authz matrix |
| RBAC-02 | No self-escalation: tenant_admin cannot alter own role, grant super_admin, or edit `role_permission` | Enforced by RLS/trigger with evidence |
| RBAC-03 | Module toggles enforced server-side, not only nav/route | Disabled module rejects writes at DB/RPC level |
| MC-01 | Maker ≠ checker enforced in DB for every approval step | CHECK/trigger/RLS evidence per workflow |
| MC-02 | State transitions enforced server-side (no direct status jumps via PostgREST) | Trigger or RPC-only writes with status guards |
| MC-03 | Waivers, revocations, deletions require privileged role + reason + audit entry | Evidence per action |
| BL-01 | Receipt and credential numbers unique and race-safe | Sequence/locking + UNIQUE constraint |
| BL-02 | Civil-event side effects (birth→resident, death→revoke) atomic and idempotent | Single transaction trigger/RPC; idempotency guard |
| CRY-01 | RS256 private key only in Edge secrets; `kid` + rotation plan | No key in repo/bundle/DB; rotation documented |
| CRY-02 | QR payload English-only, ≤ ~1.8 KB, canonical, includes expiry/status version; verifier pins algorithm | Evidence + test vectors |
| CRY-03 | Revocation strategy for offline verification declared | Online check or short validity + documented residual risk |
| LOG-01 | Audit trail append-only, trigger-written, captures actor/woreda/action/before/after/time | Evidence |
| PRV-01 | PII inventory with classification, access, encryption, retention | Complete table in report |
| SEC-01 | No secrets in working tree or git history; no `service_role` in frontend | Clean scan evidence |
| QA-01 | `tsc --noEmit` clean; lint clean; build succeeds | Command outputs in `raw/` |
| RT-01 | Every dynamic segment with sibling children uses `$id.index.tsx` | Full route list with verdicts |
| OPS-01 | Separate staging and production; backups/PITR; monitoring | Evidence or user confirmation |

---

# APPENDIX B — ETHIOPIAN LOCALE CONVENTIONS (audit-locale)

| ID | Rule | How to verify | PASS when |
|---|---|---|---|
| ET-01 | Ethiopian Calendar is primary display in Woreda portal; Gregorian secondary | Date components, formatters | All user-facing dates render EC first |
| ET-02 | **No Ge'ez numerals** anywhere; EC dates use Arabic numerals 0–9 | `rg -n '[\x{1369}-\x{137C}]' src public supabase` + formatter code review (Intl `ethiopic` numbering disabled) | Zero Ge'ez numeral code points in output paths |
| ET-03 | EC conversion correct incl. Pagumē (5/6 days) and EC leap years | Locate converter; write 6 test vectors (e.g. Meskerem 1, Pagumē 5/6, year boundary) and reason through code | Correct for all vectors; Pagumē selectable in pickers |
| ET-04 | EC fiscal year used where fiscal periods apply (Revenue/Reports) | Revenue/report filters | Fiscal year boundaries follow EC (Hamle 1 – Sene 30) |
| ET-05 | Ethiopian clock where local time is shown: EtHour = ((h + 6) mod 12) or 12 — 7:00 AM → 1:00 ጠዋት; 12:00 PM → 6:00 ቀትር; 7:00 PM → 1:00 ማታ; 12:00 AM → 6:00 ለሊት | Time formatters | Conversion + period labels correct, or local time not displayed (state which) |
| ET-06 | Names: First + Middle (father) + Last (grandfather); short name = First + Middle; no Western first/last assumptions in forms, sorting, search, or display | Resident schema, forms, name formatter | Three-part structure enforced; short-name helper = first + middle |
| ET-07 | Currency always ETB (ብር), never `$`/USD | `rg -n "\\$\\{?[0-9]|USD|currency: ?['\"]USD" src`; `Intl.NumberFormat` currency option | Zero `$`/USD in money display |
| ET-08 | Amharic fonts: Tayitu.ttf primary, Jiret.ttf secondary, with sane fallback | `@font-face`, Tailwind font config, `public/fonts` | Both fonts present and ordered correctly; applied to Amharic text and print/PDF |
| ET-09 | Amharic strings verbatim from approved source; no machine-approximated text | Compare against any source/glossary in repo; flag suspicious strings | No evident approximations; missing translations listed |
| ET-10 | Admin hierarchy Region → Zone → Woreda → Kebele → Gott; kebele = reference only | Schema + UI | No kebele-level workflow authority in code/RLS |
| ET-11 | Woreda IDs 1–6 and 19-kebele mapping exactly as Section 3 | Seed data / constants / DB | Exact match |
| ET-12 | `+251` phone format and 16-digit FAN validation enforced client + DB | Zod + CHECK constraints | Both layers enforce |
| ET-13 | Naming conventions: camelCase TS, snake_case SQL | Sample schema + code | Consistent |

