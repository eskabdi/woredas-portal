# Amharic Typography Plan — Tayitu & Jiret

Concrete, implementable font-application rules for the two supplied typefaces, replacing today's single
`"Noto Sans Ethiopic"` treatment. This plan is deliberately specific about file paths and CSS so a later
engineer executes it without re-deriving decisions.

## 0. Licensing — resolved

`Tayitu.ttf` is digitally signed and its embedded metadata reads "Copyright 2019 Anbassa Design. All
Rights Reserved." This was flagged as a precondition since self-hosting a commercial, copyrighted font in
a public `@font-face` (served to every visitor, trivially extractable) normally needs a confirmed
web-embedding license. **Resolved by the user**: Tayitu is used only decoratively (headings/titles/nav
labels, per §1's mapping — never body copy at volume), and its use is confirmed acceptable. Phase 0 is
unblocked; proceed with self-hosting as specified in §2. `Jiret.ttf` carries no equivalent
rights-reserved notice in its metadata and was not separately flagged.

## 1. What gets which font

| Element type | Font | Examples in this app |
|---|---|---|
| Amharic page/section titles, `<h1>`–`<h3>` | **Tayitu** | "ነዋሪዎች" page header, `PrintDocumentShell`'s document title, dashboard KPI card titles |
| Amharic sidebar/nav labels | **Tayitu** | `WoredaShell`'s nav item Amharic line (e.g. "ነዋሪዎች" above "Residents") |
| Amharic body copy — everything else | **Jiret** | table cell text, form field labels/hints/validation errors, toast/status messages, print document body paragraphs, blockquote captions, button labels |
| English text, Latin UI chrome, numerals | Design spec's own stack (`SF Pro Text`/`SF Pro Display`, falling back to the current Inter) | admin console (stays English entirely, see `ux_audit_findings.md` cross-cutting finding #3), English subtitle lines in bilingual pairs, resident/request ID numbers |

Rule of thumb for classifying an existing `.font-noto-ethiopic` call site: **is this Amharic text sitting
above/beside its English counterpart as a heading/label, or is it the actual content a user reads line by
line?** Headings/labels → Tayitu. Content → Jiret. When genuinely ambiguous (e.g. a bilingual stacked nav
item where the Amharic line is short and label-like even though it's technically inside body-level
markup), treat it as a heading — nav items are wayfinding, not reading content.

## 2. Where the fonts live and how they're loaded

- Convert both `.ttf` files to `.woff2` (smaller, universally supported by the browsers this app already
  targets) using a standard tool (`fonttools`/`woff2_compress`) as a one-time build step, not at runtime.
- Store the converted files at `public/fonts/Tayitu-Regular.woff2` and `public/fonts/Jiret-Regular.woff2`
  — `public/` (not `src/assets/`) because these are static assets referenced by URL in `@font-face`, not
  imported/processed by Vite's module graph, matching how a Vite app conventionally serves raw static
  files.
- Add `@font-face` rules to `src/styles.css` (the single CSS-first Tailwind v4 config file, per
  `ux_pattern_map.md`'s finding — there is no separate `tailwind.config.*` to touch):

  ```css
  @font-face {
    font-family: "Tayitu";
    src: url("/fonts/Tayitu-Regular.woff2") format("woff2");
    font-display: swap;
    font-weight: 400 700;
  }
  @font-face {
    font-family: "Jiret";
    src: url("/fonts/Jiret-Regular.woff2") format("woff2");
    font-display: swap;
    font-weight: 400 700;
  }
  ```

- Register two new theme tokens in the existing `@theme inline` block, alongside the current
  `--font-noto-ethiopic` and `--font-inter` tokens (do not delete the old token yet — see §4 rollback):

  ```css
  --font-am-heading: "Tayitu", "Noto Sans Ethiopic", sans-serif;
  --font-am-body: "Jiret", "Noto Sans Ethiopic", sans-serif;
  ```

- In `@layer base`, add the corresponding utility-backing rules next to the existing
  `.font-noto-ethiopic` rule:

  ```css
  .font-am-heading { font-family: var(--font-am-heading); }
  .font-am-body { font-family: var(--font-am-body); }
  ```

- Remove the Google Fonts `<link>` for `Noto+Sans+Ethiopic` from `src/routes/__root.tsx` **only after**
  every `.font-noto-ethiopic` call site has been migrated (§3) and the fallback chain in §2 confirms it's
  no longer load-bearing — keep the Inter `<link>` as-is, since English typography isn't changing.

## 3. Migrating the ~40+ existing `.font-noto-ethiopic` call sites

This is not a blind find-and-replace. For each file currently using `.font-noto-ethiopic`
(`grep -rl "font-noto-ethiopic" src/` to enumerate them), classify the specific element per the §1 rule
and replace with `.font-am-heading` or `.font-am-body` accordingly. Known call sites from this audit,
pre-classified as a starting worklist:

- `src/components/layout/WoredaShell.tsx` (nav item Amharic labels, page title) → `.font-am-heading`
- `src/components/common/StatusChip.tsx` (Amharic status label inside a badge) → `.font-am-body` (badges
  are read as content, not wayfinding)
- `src/routes/login.tsx` (main Amharic title "ወረዳ አስተዳደር ሥርዓት") → `.font-am-heading`
- Table header cells across all Cluster A list screens → `.font-am-heading` (column headers are labels)
- Table body cells, toast messages, form validation errors → `.font-am-body`
- `PrintDocumentShell` and its `Doc*` primitives: `DocSection` titles → `.font-am-heading`; `DocField`
  labels, `DocDataTable` cell content, body paragraphs → `.font-am-body` — **but see the Cluster D flag in
  §5 below before applying Jiret at the smallest print label sizes**.

Do this migration cluster by cluster (matching `ux_pattern_map.md`), not file-by-file at random, so a
partial migration never leaves one screen with mixed old/new fonts that looks like a bug rather than
work-in-progress.

## 4. Fallback stack & rollback safety

Both new utilities fall back to `"Noto Sans Ethiopic"` (today's working font) before the generic
`sans-serif`, per §2's token definitions. This means: if `Tayitu.woff2` or `Jiret.woff2` fails to load for
any reason (network issue, a licensing decision reverses mid-project, a build misconfiguration), every
migrated element silently renders in the exact font it uses today — there is no user-facing regression
risk from this migration being technically "live" before it's 100% finished, as long as the Noto Sans
Ethiopic `<link>` in `__root.tsx` stays in place until §2's final cleanup step.

## 5. Verification plan

**Test string set** (pulled from real app content, not lorem ipsum, since Ethiopic rendering bugs often
show up only with real character combinations):

1. `ወረዳ አስተዳደር ሥርዓት` — the login page title (heading weight, largest size in the app)
2. `ነዋሪዎች` / `ቤተሰቦች` / `የመታወቂያ ካርድ` — short nav-label-length strings (heading)
3. `ABOKER-000003`-style resident number mixed with `የነዋሪ ቁጥር` — mixed Amharic/Latin/digit string (body,
   tests whether digit glyphs align in height/baseline)
4. A full civil-registration informant sentence, e.g. `ካልተመዘገበች እናት ስም እዚህ ያስገቡ` — a real long-form
   sentence at form-hint size (body, smallest interactive-UI size)
5. A `PrintDocumentShell` `DocField` label at its actual print size (`text-[9.5px] uppercase
   tracking-wide`) — the specific micro-label size flagged as a risk in `ux_audit_findings.md` Cluster D

**Procedure**: build one throwaway HTML file (not committed to the app) that renders all five strings in
both `Tayitu`/`.font-am-heading` and `Jiret`/`.font-am-body` context at their real production sizes, open
it in a browser at 100% and 150% zoom, and visually check for: (a) tofu boxes (missing glyphs — an
immediate go/no-go blocker for that face), (b) Ethiopic combining-mark/ligature rendering (Ge'ez script
has vowel-order marks that some fonts render incorrectly), (c) line-height/vertical rhythm at each defined
type scale (the design spec's Large Title `32px/36px`, Section Title `18px/22px`, Body `14px`, Caption
`12px`), and (d) specifically for test string 5, whether Jiret stays legible at 9.5px or whether Cluster D
needs a minimum-size exception (bump to 10.5–11px, or keep Noto Sans Ethiopic there — decide from what
the screenshot actually shows, not in advance).

Only mark Phase 0 (see `ux_implementation_roadmap.md`) complete once this verification set passes on the
actual production build (not a dev-server preview) — `font-display: swap` and real network conditions can
behave differently than a local file:// preview.
