# Supply Chain and Secret Hygiene: woredas-portal audit, 2026-09-24

**Agent:** audit-supplychain · **HEAD:** `9950f16` · **Checklist items owned:** INSA B-02 (CVE part), SEC-01
**Machine-readable:** `findings/supplychain.json` · **Raw evidence:** `raw/supplychain-*.txt|json`

## Summary

The dependency supply chain is in good shape. There is a single package manager (bun 1.3.11) and a
single lockfile (`bun.lock`). All 582 lockfile entries carry sha512 integrity hashes, and there are no
git, URL or file-path dependencies. CI installs with `--frozen-lockfile`. `bunfig.toml` enforces a
24-hour minimum release age. Only one dependency has an install-time lifecycle script (`core-js`
postinstall, a banner), and bun blocks it by default.

**No secrets were found in the working tree or in the full git history.** The local clone is
shallow, so history was scanned against a full mirror of all 77 branches and 83 PR refs, 417 commits
in total. The service-role key is referenced only by name in a server-only module that nothing
imports.

The gaps are about process rather than any exposed flaw. Vulnerability and secret scanning run only
when someone remembers to run them. As a result, one High advisory (js-yaml, build-time only) is
currently unaddressed, and a documented "no vulnerabilities" claim has gone stale. One runtime
dependency (react-leaflet) carries a non-OSI ethical-use licence that should get legal review for a
government system.

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | none |
| High | 0 | none |
| Medium | 1 | WP-SUP-001 |
| Low | 5 | WP-SUP-002, 003, 004, 005, 006 |
| Info | 2 | WP-SUP-007, 008 |

| Checklist | Status | Basis |
|---|---|---|
| B-02 (CVE part) | **PARTIAL** | Inventory and lockfile integrity complete; 1 High advisory open (build-time only, WP-SUP-002); no automated scanning (WP-SUP-001) |
| SEC-01 | **PASS** | Clean working tree, full history (417 commits, all refs) and commit messages; no `service_role` in the frontend |

## Method

| Step | Command / source | Output |
|---|---|---|
| Vulnerabilities | `bun audit`, `bun audit --json` (npm audit not applicable: no package-lock.json by design) | `raw/supplychain-bun-audit.{txt,json}` |
| Freshness | `bun outdated` | `raw/supplychain-bun-outdated.txt` |
| Licences | Walked every `node_modules/**/package.json` (524 packages; `license-checker` not used, to avoid network installs) | `raw/supplychain-licenses.txt` |
| Lockfile integrity | Counted entries against sha512 hashes; grepped for `git+`, `github:`, `http(s)://`, `file:`, `link:` | 582/582, 0 non-registry |
| Install scripts | Inventoried `preinstall`/`install`/`postinstall`/`prepare` scripts; `bun pm untrusted` | `raw/supplychain-install-scripts.txt` |
| Secrets (tree) | `rg --hidden` for `service_role`, `SUPABASE_SERVICE_ROLE`, PEM private-key headers, JWTs, `sbp_`, `sb_secret_`, `sk_live`, `AKIA`, `ghp_`, `password=`, `apikey`, JWK `d`, hard-coded secret literals; this covered `public/`, `.claude/`, `docs/` and the built `.output/` | `raw/supplychain-secrets-scan.txt` |
| Secrets (history) | `git clone --mirror` into the session scratchpad (outside the repo), then `git log --all -G/-S` per pattern, `--diff-filter=A` for sensitive filenames, and a scan of commit messages | same file |

`gitleaks` and `trufflehog` are not installed, so scanning used the regex fallback the method
prescribes. A high-entropy secret with no recognizable prefix could evade it (see WP-SUP-001's
recommendation). No tracked file was modified. `git status` showed only the untracked
`docs/audit/` and `.claude/agents/audit-*` files throughout.

## Findings

### WP-SUP-001: Dependency and secret scanning are not automated (Medium)

`.github/workflows/ci.yml:30-41` runs install, lint, build, tsc, tests and the three drift/catalog
checks. It never runs `bun audit` or a secret scanner. The repo has no `dependabot.yml` or Renovate
config. The effect is already visible: `docs/testing-scope.md:83-85` says `bun audit` "reports no
vulnerabilities as of this pass", but today it reports a High advisory (WP-SUP-002) and nothing
surfaced the change. The clean SEC-01 result likewise depends on someone manually running the
`secret-sweep` subagent.

**Recommendation:** add `bun audit --audit-level=high` to CI, or to a scheduled workflow so that
build-only advisories don't block every PR. Enable Dependabot or Renovate (keep `minimumReleaseAge`).
Add a SHA-pinned gitleaks step, and turn on GitHub secret scanning with push protection.

### WP-SUP-002: js-yaml 4.3.1, GHSA-2883-xcg3-v3hh (Low; advisory rated High)

The only advisory `bun audit` reports is a CPU-exhaustion flaw (CWE-400/407) in js-yaml `<4.3.2`.
It reaches the tree through `eslint > @eslint/eslintrc` (`bun.lock:173`) and through
`@tanstack/react-start > start-plugin-core > xmlbuilder2` (`bun.lock:1173`), which is used only by the
Vite build's `build-sitemap.js`. Neither path is in the browser bundle or the Nitro runtime, and
neither parses untrusted YAML, so the environmental risk is negligible. The advisory still makes
B-02's "no known High CVE unaddressed" criterion fail literally. **Fix:** `bun update js-yaml`.
Both parent ranges already admit 4.3.2, so no `package.json` change is needed. Alternatively, record
a formal risk acceptance.

### WP-SUP-003: Hippocratic-2.1 licence on react-leaflet (Low)

The licence mix is overwhelmingly permissive: 435 MIT, 28 ISC, 24 Apache-2.0 and 16 BSD. There is
**no GPL, AGPL, LGPL, SSPL or BUSL** anywhere in the tree. The exception is `react-leaflet@5.0.0` and
`@react-leaflet/core@3.0.0` (`package.json:73`), which are runtime dependencies bundled into the
map pickers in `src/components/gis/`. They are licensed Hippocratic-2.1, a non-OSI licence that
conditions use on human-rights compliance and reserves termination rights to the licensor. For a
state resident and ID registry, the system owner's counsel should review it. If it is rejected, the
fallback is plain `leaflet` (BSD-2-Clause, already a dependency) behind a small hook.

Other non-permissive entries are informational only:

- MPL-2.0 `lightningcss` (build-time, unmodified)
- CC-BY-4.0 `caniuse-lite` (build data)
- Python-2.0 `argparse` (dev)
- `dompurify` (MPL-2.0 OR Apache-2.0, transitive via jspdf)

### WP-SUP-004: `actions/checkout@v4` is not SHA-pinned (Low)

`ci.yml:16-19` states the policy (pin by SHA because of tag-move compromises) and applies it to
`oven-sh/setup-bun` at line 20. `actions/checkout` at line 15 still uses the mutable tag. The blast
radius is limited because the workflow has `contents: read` and no secrets.

### WP-SUP-005: SessionStart hook uses unpinned `curl | bash` and a non-frozen install (Low)

When bun is absent, `.claude/hooks/session-start.sh:28` installs the latest bun from `bun.sh/install`
with no version pin and no checksum. `package.json:6` and CI pin 1.3.11. Line 34 then runs `bun install`
without `--frozen-lockfile`. This affects agent and developer containers only, but those containers
may hold account-level deploy tokens during deploy work. **Fix:** pass `bash -s "bun-v1.3.11"` to the
installer and use `bun install --frozen-lockfile`.

### WP-SUP-006: Deploy token placed in process argv (Low)

The operator scripts follow the repo's credential rule: they read tokens from the environment and
never print or hard-code them. However, seven scripts pass
`-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"` on the curl command line:

- `phase-c-create-vault-key.sh:78`
- `phase-c-apply-migration.sh:56`
- `phase-c-backfill.sh:81`
- `phase-c-apply-migration-024.sh:48`
- `run-phase-c-dryrun.sh:58`
- `apply-workflow-migrations.sh:135`
- `run-live-probes.py:74`

The deploy skill passes `--token="$VERCEL_TOKEN"` the same way (`.claude/skills/deploy/SKILL.md:98`).
On a shared host, any local user can read these arguments from `ps` or `/proc/<pid>/cmdline`.
`run-live-probes.py:63` also writes to a fixed `/tmp/_probe_payload.json`. **Fix:** feed the header
through stdin (`curl -H @-`), rely on the Vercel CLI's native `VERCEL_TOKEN` env var, and use
`tempfile.mkstemp()`.

### WP-SUP-007: Pre-release and unmaintained components (Info)

- `nitro 3.0.260603-beta` (`package.json:104`) builds the production server entry.
- `html5-qrcode 2.3.8` has had no release since 2023-04-15 and decodes camera input in
  `HararildScanner.tsx`.
- 39 packages are outdated. Several are a major version behind: zod 3 to 4, recharts 2 to 3,
  pdfjs-dist 5 to 6, TypeScript 5.9 to 7.0 and vitest 4 to 5.
- None of these versions has a known advisory today.

### WP-SUP-008: `.gitignore` negation shadowed; project ref in a skill (Info)

`.gitignore:59` (`.env*`) overrides the negation `!.env.example` at `:27`, as
`git check-ignore --no-index` confirms. The template remains in the repo only because it is already
tracked. This is fail-safe but confusing. The Supabase project ref (`tugz…`) is hard-coded in
`.claude/skills/acceptance-harness/SKILL.md:54`. It is not a secret, because it appears in every
client bundle.

## Secret-scan results (SEC-01)

| Area | Result |
|---|---|
| Working tree (incl. `.claude/`, `docs/`, `public/`) | 0 real secrets. Hits are the detection-pattern tables in `.claude/agents/secret-sweep.md`, regex text in CLAUDE.md and skills, header *names* (`apikey`), and empty `.env.example` values |
| `src/config/credentialCryptoConfig.ts` | ES256 **public** verification key. Known false positive |
| Frontend `service_role` | None. `src/integrations/supabase/client.server.ts:10` reads `process.env.SUPABASE_SERVICE_ROLE_KEY`, is imported by nothing, and appears in no `.output/public` asset. Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_PUBLIC_SITE_URL` reach the client |
| Built `.output/` (gitignored) | Only supabase-js library string literals (`sb_secret_` prefix detection); no keys |
| History, all 417 commits and refs | 0 JWTs, `sbp_`, `sb_secret_`, `sb_publishable_`, `sk_live`, `AKIA`, `ghp_`, `vcp_`, PEM private keys, JWK `d` members or `KEY=value` secrets. `MII…` blobs in `4bf20c1`/`2844171` are the original RSA **public** key (SPKI). 0 matches in commit messages |
| Files ever committed | `.env.example` (3 versions, all values empty) and `package-lock.json` (later removed). Never `.env`, `.pem`, `.key`, `p.json`, `payload.json`, `settings.local.json`, `supabase/.temp` or `.vercel` |

## Documentation drift

| Claim | Source | Verdict |
|---|---|---|
| `bun audit` reports no vulnerabilities | `docs/testing-scope.md:83-85` | **CONTRADICTED**: 1 High today |
| package-lock.json removed; bun.lock is the only lockfile | `CLAUDE.md:77-84` | CONFIRMED (but `bun audit` is not in CI) |
| `client.server.ts` imported by nothing | `CLAUDE.md:213` | CONFIRMED |
| SessionStart hook has an npm fallback | `CLAUDE.md:973-975` | **CONTRADICTED**: the hook now installs bun instead |
| "this repo has no test suite" | `CLAUDE.md:902` | **CONTRADICTED**: Vitest suite runs in CI (`ci.yml:37`) |
| Third-party actions SHA-pinned | `ci.yml:16-19` | **CONTRADICTED** for `actions/checkout@v4` |
| Deploy tokens never enter the repo | `CLAUDE.md:6-60` | CONFIRMED across the full history |
| Stack versions and dompurify transitive-only | `shared-context.md:52-57` | CONFIRMED |
