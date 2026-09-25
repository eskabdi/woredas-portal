# Build Quality, Routing, Dead Code, Bundle, Accessibility, i18n and Design-System State

**Agent:** `audit-build-quality` (Wave 1) · **Audit date:** 2026-09-24 · **Repository HEAD:** `9950f16` (branch `claude/read-and-execute-ipi0yo`, identical to `main`)
**Checklist IDs owned:** QA-01, RT-01 · **Mode:** read-only; no database access; nothing committed.

## 1. Summary

The build pipeline is in better shape than the project's own documentation says. The typecheck exits
clean, ESLint reports **0 errors and 8 warnings** (CLAUDE.md still says about 49 problems), all **202 Vitest tests in 23
files pass**, the static drift and catalog checks pass, and the production build succeeds. The committed
`src/routeTree.gen.ts` did not drift when the build regenerated it. **RT-01 passes.** All 24 dynamic-segment
route files follow the `$param.index.tsx` pattern wherever the segment has sibling children. The two
layout routes that looked like they swallowed their children (`woreda.civil.tsx`, `woreda.services.tsx`) turned
out to be correct, because `ModuleGate` itself renders `<Outlet />`.

The weaknesses are mostly quality debt rather than security defects:

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 8 |
| Info | 5 |

The one Medium is a consistency problem. **128 toast call sites send a raw backend `error.message` to the user's
screen.** None of them go through the project's own `translateError()` sanitiser, so the server-side `safeError()`
hardening applies only to Edge Functions, not to direct PostgREST/RPC calls. Several findings also show that
"clean" tooling output hides gaps. The typecheck never covers Edge Functions or `scripts/`. The lint result is clean
because 56 inline `eslint-disable` directives and 23 stale "untyped client" casts suppress the issues. There is no
coverage tooling, and the client-side QR signature verifier has no tests.

## 2. Command results (raw output under `docs/audit/2026-09-24/raw/`)

| Command | Result | Raw file |
|---|---|---|
| `bunx tsc --noEmit` | exit 0, **0 errors** (26 s) | `build-quality-tsc.txt` |
| `bun run lint` | exit 0, **0 errors, 8 warnings** (all `react-refresh/only-export-components`) | `build-quality-lint.txt` |
| `bun run test` | **23 files / 202 tests passed**, 0 failed | `build-quality-test.txt` |
| `bun run check:role-perms-drift` | OK, every role agrees | `build-quality-role-perms-drift.txt` |
| `bun run check:fee-catalog` | OK: 6 woredas × 7 mapped service types | `build-quality-fee-catalog.txt` |
| `bun run check:service-type-catalog` | OK: 78 rows, no drift | `build-quality-service-type-catalog.txt` |
| `bun run scripts/generate-permissions-doc.ts --check` | OK: the doc matches | `build-quality-permissions-doc.txt` |
| `bunx vite build --outDir /tmp/audit-build` | exit 0. Client 6.67 s, SSR 5.70 s, nitro 1.29 s. **`--outDir` was ignored**: output went to `.output/` (gitignored), which was removed afterwards | `build-quality-build.txt` |
| `bunx knip@5` (dead code) | 52 "unused files", 21+2 unused deps, 27 unused exports. Triaged manually below | `build-quality-knip.txt` |
| Heuristic a11y scan (script in agent scratchpad) | See §6 | `build-quality-a11y-scan.json` |

**Generated-file drift:** `src/routeTree.gen.ts` had md5 `a6eea1d8…` before and after the build. `git status --porcelain` showed
no modified tracked file, so **no restore was needed and the committed route tree matches the route files.**

**Build warnings:** there were three. The TanStack Router generator treats the test files in `src/routes/__tests__/*.test.ts` as route
candidates, because no `routeFileIgnorePattern` is set (see WP-BQ-009). There was also one nitro advisory about builder OS/arch. No chunk-size warning was emitted.

## 3. RT-01: dynamic-segment routing verdicts (all 24 files enumerated)

| Dynamic segment | Files | Sibling children? | Verdict |
|---|---|---|---|
| `admin.tenants.$woredaId` | `.index.tsx`, `.provision.tsx` | yes | PASS (`$id.index`) |
| `v.$token` | `v.$token.tsx` | no (leaf) | PASS |
| `verify.letter.$token` | leaf | no | PASS |
| `verify.receipt.$token` | leaf | no | PASS |
| `woreda.civil.$eventId` | `woreda.civil.$eventId.tsx` | no (leaf) | PASS |
| `woreda.credentials.$requestId` | `.index`, `.certificate`, `.print` | yes | PASS |
| `woreda.households.$householdId` | `.index`, `.edit`, `.print` | yes | PASS |
| `woreda.rental-accounts.$occupancyId` | leaf | no | PASS |
| `woreda.rental-houses.$houseId` | `.index`, `.edit`, `.occupant-print` | yes | PASS |
| `woreda.rental-houses.requests.$requestId` | `.index` only | no | PASS |
| `woreda.reports.$reportType` | `.print` only (no `/woreda/reports/:type` page) | no | PASS (by design, print-only) |
| `woreda.residents.$residentId` | `.index`, `.edit`, `.print` | yes | PASS |
| `woreda.revenue.$paymentId` | `.receipt` only (no `/woreda/revenue/:id` page) | no | PASS (by design) |
| `woreda.services.$requestId` | `.index`, `.print` | yes | PASS |

I also checked the parent layout routes. Every non-index parent with children renders an outlet:
`admin.tsx`, `woreda.tsx`, `woreda.credentials.tsx`, `woreda.households.tsx`, `woreda.reports.tsx`, `woreda.residents.tsx`
and `woreda.revenue.tsx` render `<Outlet />` directly. `woreda.civil.tsx:6` and `woreda.services.tsx:6` render
`<ModuleGate moduleKey=… />`, which falls through to `<Outlet />` (`src/components/common/ModuleGate.tsx:48`).
Static siblings such as `credentials.new`, `credentials.verify`, `rental-houses.requests` and `rental-houses.occupants` outrank the dynamic
segment in TanStack's route ranking, so there is no shadowing. 69 of 70 route files set `ssr: false`. The exception is `__root.tsx`, as intended.

## 4. Findings

### WP-BQ-001 — 128 toasts show raw backend `error.message`, bypassing `translateError()` (Medium, Confirmed)
**Evidence:**
- `src/routes/woreda.residents.index.tsx:658`: `onError: (e: Error) => toast.error(e.message),`
- `src/routes/woreda.rental-accounts.$occupancyId.tsx:278`: same pattern. There are 10 such sites in that file.
- `src/routes/woreda.credentials.$requestId.index.tsx:475`: ``toast.error(`Update failed: ${(e as Error).message}`);``
- `src/lib/errorMessages.ts:120`: `export function translateError(…)`. Its only importers are `src/lib/edgeFunction.ts` and its test.

The full list is in `raw/build-quality-raw-error-toasts.txt`. It covers 128 sites and none of them call `translateError`.

The project hardened Edge Functions with `safeError()` so raw driver text never reaches the wire as user copy (CLAUDE.md §"Edge Function errors"). Direct
PostgREST/RPC calls from the browser make up most writes, and they print Postgres/PostgREST messages verbatim in toasts. Those messages include constraint names,
trigger `RAISE` text, RLS "new row violates row-level security policy for table …" and column names. They are also English-only in the Amharic-first portal.

**Impact:** there is minor schema disclosure to authenticated staff, which is an INSA C-07 deviation. Workflow/fee-guard rejections arrive as untranslated
English, which hurts usability. Severity stays Medium because the information goes only to authenticated users, and the same text is available on the wire anyway.

**Recommendation:** route every `onError` through a shared `toastError(e)` helper that calls `translateError()`. Extend the lookup for common Postgres
codes (23505, 23514, 42501, P0001).

### WP-BQ-002 — Edge Functions and `scripts/` are outside every typecheck (Low, Confirmed)
**Evidence:** `tsconfig.json:2`: `"include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "eslint.config.js"]`. No `deno` binary exists in the
environment, and `.github/workflows/ci.yml:31-41` has no `deno check`/`deno lint` step.

All 8 functions under `supabase/functions/` are privileged service-role code. They cover signing, invites and password reset. The `scripts/*.ts`
drift checkers run under bun's transpile-only mode. A type error in any of them would pass CI.

**Recommendation:** add a CI step that runs `deno check supabase/functions/*/index.ts`, or a separate `tsconfig.functions.json` with Deno types. Add `scripts/` to a
node-typed tsconfig.

### WP-BQ-003 — "Clean" lint is achieved partly through suppression; 23 stale untyped-client casts (Low, Confirmed)
**Evidence:**
- 56 `eslint-disable` directives in `src/`, for example `src/routes/woreda.credentials.$requestId.index.tsx` has 13 of them.
- 26 explicit `any` usages outside generated files.
- 83 `as unknown as` casts.
- 23 sites use the pattern `supabase as unknown as { from: (t: string) => any }`, for example
  `src/routes/woreda.residents.$residentId.edit.tsx:58`, `src/routes/woreda.dashboard.tsx:274,404` and `src/components/residents/ResidentProfileTabs.tsx:229`.

Every table and view reached through these casts is present in the generated types. Examples are `resident_decrypted`, `household_decrypted`
at `types.ts:5089`, `payment_decrypted` at `:5314`, `service_request_decrypted` at `:6467` and `console_role_permission` at `:620`. The CLAUDE.md
justification ("pre-typegen tables") therefore no longer holds.

The config also weakens detection. `eslint.config.js:45` sets `"@typescript-eslint/no-unused-vars": "off"` and `tsconfig.json` sets
`noUnusedLocals: false`.

**Impact:** a renamed or dropped column on a PII `*_decrypted` view fails at runtime as a silent empty or `undefined` field instead of at build time.

**Recommendation:** remove the casts and use the typed client. Reinstate `no-unused-vars` as a warning.

### WP-BQ-004 — Form labels not programmatically associated; unnamed icon buttons (Low, Confirmed for the shared wrapper; counts heuristic)
**Evidence:**
- `src/components/forms/FormSection.tsx:58`: `<Label className="mb-1.5 block">`. There is no `htmlFor`, the child input gets no `id`, and the error `<p>` has no `aria-describedby` link.
  `FieldWrap` is the shared wrapper for resident, household and rental forms.
- The heuristic scan found 187 of 213 `Input/input/Textarea` elements and 18 of 21 `SelectTrigger` elements with no `id`↔`htmlFor`, `aria-label` or `FormControl` wiring.
- 6 icon-only `size="icon"` buttons have no accessible name: `DocumentViewerDialog.tsx:47,60` (pager chevrons), `woreda.households.$householdId.index.tsx:259,450`,
  `woreda.households.index.tsx:565` and `ResidentProfileTabs.tsx:957`.
- One `<img>` has no `alt`: `src/routes/woreda.credentials.new.tsx:654`.

`StatusChip` always renders a text label (`StatusChip.tsx:98-109`), so status is **not** colour-only.

**Recommendation:** have `FieldWrap` generate an `id` with `useId()` and pass it to its child, plus `aria-describedby` and `aria-invalid`. Add `aria-label` to icon buttons.

### WP-BQ-005 — Document language is `en` in an Amharic-first portal (Low, Confirmed)
**Evidence:** `src/routes/__root.tsx:136`: `<html lang="en">`. There are zero `lang="am"` attributes in `src/`, so the `:lang(am)` rule at `src/styles.css:195` never matches.
Screen readers will read Ge'ez-script text with an English voice, and browsers pick the wrong hyphenation and line-breaking rules.

**Recommendation:** set `lang="am"` on the woreda shell, keep `en` on the `/admin` shell, or wrap English sub-captions in `lang="en"`.

### WP-BQ-006 — No i18n framework; bilingual copy hard-coded; English-only strings remain in the woreda portal (Low, Confirmed)
**Evidence:** `package.json` has no i18n library (react-i18next/i18next/lingui/formatjs). There is no `src/locales`. There are 3,135 source lines containing Ethiopic across 117 files, all inline literals.
There are 37 English-only toast literals in woreda routes and components (`raw/build-quality-english-only-toasts.txt`). Examples:
- `src/routes/woreda.civil.index.tsx:305`: `toast.success("CSV export ready")`
- `src/routes/woreda.credentials.$requestId.index.tsx:653`: `toast.error("Reason must be at least 5 characters")`

The pattern is also visible in the admin portal: all 7 non-layout admin routes contain Amharic literals, even though the admin portal is documented as English-only.

**Impact:** Amharic copy cannot be reviewed as one catalogue (INSA ET-09), and the percentage of untranslated strings cannot be measured mechanically.

**Recommendation:** at minimum, extract a typed `strings.am.ts`/`strings.en.ts` catalogue. Adopting i18next is optional.

### WP-BQ-007 — Critical client logic untested; no coverage tooling (Low, Confirmed)
**Evidence:**
- `vitest.config.ts` has no `coverage` block, and there is no `@vitest/coverage-*` package in `package.json`/`node_modules/@vitest`.
- No test imports `src/utils/harariCredentialCrypto.ts` (the public QR signature verifier), `src/utils/barcode.ts` (the density guard `MIN_X_DIMENSION_UM`),
  `src/lib/security-headers.ts`, `src/utils/tableExport.ts` (the CSV-formula-injection guard), `ModuleGate` or `PermissionGate`.
- There is no `supabase/tests` (pgTAP) for RLS/FSM, and there are no Edge Function tests.
- The 3 `src/routes/__tests__/*` regression tests are source-text regex assertions (`readFileSync`), not behavioural tests.

**Recommendation:** add test vectors for ES256 verification (valid, tampered, wrong algorithm), barcode density, CSV injection and header values. Add `@vitest/coverage-v8` with a floor.

### WP-BQ-008 — Dead code and unused dependencies (Low, Confirmed after triage)
**Evidence (knip, manually verified):**
- 21 runtime dependencies are imported only by unused shadcn primitives, or not at all. `date-fns` (`package.json:57`) has **zero** imports. `react-day-picker` (`:70`) is used
  only by the unused `ui/calendar.tsx`. The same applies to `cmdk` (`:56`), `vaul` (`:82`), `embla-carousel-react` (`:58`), `input-otp` (`:62`), `react-resizable-panels` (`:75`),
  and 13 `@radix-ui/*` packages such as `react-popover` (`:35`). There are also 2 dev dependencies: `@testing-library/user-event` and `lightningcss`. `lightningcss` is used by `vite.config.ts`
  (`css.transformer`), so it is a knip false positive.
- 19 unused `src/components/ui/*` files, `src/components/common/ComingSoon.tsx`, and `exportSectionsToPdf` at `src/utils/reportExport.ts:74`, which has zero callers.
- 27 unused exports.

knip false positives that I excluded: `public/sw.js` (registered at `src/hooks/useServiceWorker.ts:14`), `src/server.ts`, `security-headers.ts` and `error-capture.ts` (the nitro entry),
the Edge Functions (Deno), `client.server.ts` (reserved by design) and `@tanstack/router-plugin` (a peer of start).

**Impact:** a larger install footprint and supply-chain surface (install scripts, advisories) with no benefit.

**Recommendation:** remove the unused dependencies and primitives; `shadcn add` can restore them when needed.

### WP-BQ-009 — Route generator scans test files (Info, Confirmed)
**Evidence:** `raw/build-quality-build.txt:1-26` has 3 warnings: `Route file ".../src/routes/__tests__/*.test.ts" does not export a Route`, with `routeFileIgnorePattern: undefined`.
The warnings are harmless now, but future test files will keep adding noise. Fix by setting `routeFileIgnorePattern: "__tests__"` or moving the tests.

### WP-BQ-010 — Bundle profile (Info, Confirmed)
The root route preloads 15 chunks totalling **706 KB raw / 203 KB gzip** of JavaScript before any page renders. That includes `index-*.js` (404 KB) and `supabase-vendor` (209 KB).
Heavy libraries are route-split correctly:

| Library | Chunk size |
|---|---|
| `pdf.worker.min` | 1,046 KB |
| `DocumentViewerDialog` (pdfjs) | 421 KB |
| `woreda.credentials.verify` (html5-qrcode) | 401 KB |
| `jspdf` | 400 KB |
| `recharts` (`palette-*`) | 371 KB |
| `html2canvas-pro` | 248 KB |

Both `html2canvas` (199 KB, pulled lazily by jspdf's `.html()`) and `html2canvas-pro` (the one the app imports, `PrintDocumentShell.tsx:8`) are emitted.
CSS is 132 KB. The total client asset directory is 6.3 MB across 242 JS files. There is no performance budget in CI.

### WP-BQ-011 — Design tokens are stock shadcn "slate"; about 90% of colour usage bypasses tokens (Info, Confirmed)
**Evidence:** the values in `src/styles.css:103-134` are the unmodified shadcn slate preset. For example, `--foreground: oklch(0.129 0.042 264.695)` and `--primary: oklch(0.208 0.042 265.755)`.
Custom additions are limited to 10 shell and status tokens (`styles.css:137-146`). The string "Academic Curator" appears nowhere in the repository.

In `.tsx` files there are **2,465 raw Tailwind palette classes** (`bg-slate-50`, `text-red-600`, …) across 105 files, against 258 semantic-token classes, plus 83 hex literals.
The files with the most raw palette classes are:

| File | Raw palette classes |
|---|---|
| `woreda.credentials.$requestId.index.tsx` | 236 |
| `woreda.credentials.new.tsx` | 124 |
| `woreda.credentials.$requestId.print.tsx` | 102 |
| `woreda.rental-houses.occupants.new.tsx` | 85 |
| `woreda.settings.woreda-configuration.tsx` | 76 |
| `UsersRolesTab.tsx` | 72 |

The `.dark` theme exists but cannot work across these screens. The `.font-noto-ethiopic` → Tayitu/Jiret migration is complete, with 0 call sites remaining.

### WP-BQ-012 — CLAUDE.md is stale on build/quality facts (Low, Docs, Confirmed)
See `drift[]`. The main items:
- The lint count is claimed as "~49 real problems … `no-img-element`" (`CLAUDE.md:981-982`). The actual result is 0 errors and 8 warnings, and `no-img-element` is a Next.js rule that is not configured.
- `CLAUDE.md:902` says "this repo has no test suite", which contradicts the same file's Commands section. There are 202 tests.
- `CLAUDE.md:773-779` says the UX restructure is "not yet merged". It was merged in PR #79 (`0bd0c30`).
- `CLAUDE.md:410` places the idle-timeout mount in `WoredaShell.tsx`/`AdminShell.tsx`. Neither file exists; the mount is at `src/components/layout/AppShell.tsx:406,566`.
- `CLAUDE.md:176` says "All 67 route files". There are 70 route files, 69 of them with `ssr: false`.

Agents and reviewers that act on this file will make wrong assumptions.

### WP-BQ-013 — CI quality gates narrower than they appear (Info, Confirmed)
**Evidence:** `.github/workflows/ci.yml:35-36` runs `bun run build` then `npx tsc --noEmit`, but it never checks that `src/routeTree.gen.ts` is committed in sync (no `git diff --exit-code`).
There is also no coverage threshold, no bundle budget and no Deno check (see WP-BQ-002). `actions/checkout@v4` (line 15) is tag-pinned, while `setup-bun` is SHA-pinned. The supply-chain agent owns that point.

### WP-BQ-014 — Monolithic route components (Info, Confirmed)
**Evidence:** `woreda.credentials.$requestId.index.tsx` is 2,988 lines, `woreda.credentials.$requestId.print.tsx` 1,973, `woreda.settings.woreda-configuration.tsx` 1,521 and `UsersRolesTab.tsx` 1,411.
There are 58.5k lines of non-generated source in total. The largest files also hold the most `any` and eslint-disable directives, which concentrates review risk in the credential workflow.

## 5. Checklist

| ID | Status | Note |
|---|---|---|
| QA-01 | **PARTIAL** | The commands all pass: tsc exits 0 with 0 errors, lint has 0 errors, the build succeeds and 202/202 tests pass. It is PARTIAL because lint still emits 8 warnings, the typecheck scope excludes the Edge Functions and `scripts/` (WP-BQ-002), and cleanliness partly relies on 56 suppressions (WP-BQ-003). |
| RT-01 | **PASS** | 24/24 dynamic-segment files are compliant (see §3). The committed route tree is in sync. |

## 6. Accessibility scan method

A Node script parsed each JSX opening tag, handling multi-line tags and brace depth, in `src/**/*.tsx`. It excluded `src/components/ui/*` and tests. It checked:
- `<img>` elements for `alt`
- `size="icon"` Buttons for `aria-label`, `title` or `sr-only` children
- inputs and `SelectTrigger`s for `aria-label`, `aria-labelledby`, a matching `id`/`htmlFor` in the same file, a `<FormControl>` wrapper or an enclosing `<label>`

This is a heuristic. I manually confirmed the shared `FieldWrap` defect that drives most of the input count. Output: `raw/build-quality-a11y-scan.json`.
