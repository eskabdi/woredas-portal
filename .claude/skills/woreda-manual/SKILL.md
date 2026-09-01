---
name: woreda-manual
description: Generate the end-to-end Amharic user manual for the woreda portal as a professional business PDF — walks every route in src/routes (both the Amharic woreda.* operating system and the English admin.* console), writes a structured Markdown manual with the app's own bilingual "ስም / Name" convention, then renders it to a print-ready PDF with a cover page, table of contents, Ethiopic typography and page numbers. Use this whenever asked to write, update, or export a user manual, user guide, training document, or documentation for the woreda portal, especially in Amharic — including requests like "make a PDF manual for the app", "document how to use the residents module", or "generate the training guide for woreda staff". Screenshot placeholders in the output MUST follow the exact convention in references/markdown-conventions.md.
---

# Woreda portal Amharic user manual

This skill produces `docs/woreda-portal-manual-am.md` (the source of truth,
readable and diffable on its own) and renders it to
`docs/woreda-portal-manual-am.pdf` — a business-grade manual for the woreda
staff who actually use this app day to day, not a developer document. The
audience reads Amharic first; every module the portal ships needs a home in
the manual, in the order a new employee would actually encounter it.

There are two genuinely different jobs bundled here, and treating them as one
step produces a bad manual: **understanding the app** (below) is research —
read the routes, don't guess at them — and **writing the manual** is
authorship that only you can do well, because it means explaining what a
screen is *for*, not restating its field names. The rendering script turns
finished Markdown into a PDF; it has no opinion about content.

## Step 1 — Inventory every screen before writing anything

Do not start drafting prose until you have the full route list, because a
manual assembled section-by-recollection always misses a module — this app
currently has ~55 routes and it is easy to under-cover the ones that don't
show up in the main sidebar nav (verification pages, print routes, settings
sub-pages).

```bash
ls src/routes/ | grep '^woreda\.' | sort   # Amharic-primary operating system
ls src/routes/ | grep '^admin\.'  | sort   # English super-admin console
```

For each route file, a few seconds with `Grep`/`Read` tells you what the page
actually does — its permission gate (`<PermissionGate permission={P.X}>`),
its module gate (`<ModuleGate moduleKey="...">`), and whether it's a list,
detail, form, or print view. Group routes by their shared prefix
(`woreda.residents.*`, `woreda.civil.*`, `woreda.revenue.*`, ...) — that
grouping *is* the manual's chapter structure, because it's also the app's own
information architecture. Cross-check against `README.md` (portal/role/module
overview) and `docs/*.md` (per-module design notes, e.g. the unified approval
queue) for the *why* behind a workflow that the route file alone won't tell
you — a form field is easy to read off the code, but why a service request
routes through `/woreda/approvals` instead of resolving on its own page is
not.

Skip building this list from memory or from the sidebar nav config alone —
several routes (verification pages `v.$token`, `verify.letter.$token`,
print routes, `woreda.credentials.verify`) are reachable but not in any nav
menu, and they still need a manual section since a real user reaches them
(a scanned QR code, a print button) even without a nav link.

## Step 2 — Structure the manual to match the app, not a generic template

Suggested top-level chapters, in the order a woreda employee's first week
would actually touch them — adjust based on what Step 1 turns up, this is a
starting point, not a fixed table:

1. መግቢያ (Introduction) — what the system is, who uses it, the two portals
2. መግቢያ እና ዳሽቦርድ (Login & Dashboard)
3. የነዋሪ አስተዳደር (Residents & Households)
4. የመታወቂያ ካርድ (Residence Credentials) — issuance, printing, verification
5. የሲቪል ምዝገባ (Civil Registration) — birth/death/marriage/divorce
6. የአገልግሎት ጥያቄዎች (General Service Requests) and የማጽደቅ ማዕከል (Approvals)
7. የኪራይ ቤቶች (Rental Houses)
8. ገቢ አስተዳደር (Revenue)
9. ሪፖርቶች (Reports)
10. ቅሬታዎች (Complaints), ኦዲት (Audit)
11. ቅንብሮች (Settings) — users & permissions, woreda configuration
12. አስተዳደር ኮንሶል (Super Admin Console) — kept in English per the app's own
    convention (see `references/known-conventions.md`), but introduced in
    Amharic since the manual's reader may still need to know it exists
13. ቃላት መዝገበ (Glossary) — Amharic⇄English term list; useful in a system this
    bilingual, and cheap to build as you go rather than at the end

Number sections the way the example in the prompt does (`2.2`, `2.2.1`) so
cross-references and the rendered table of contents stay stable — the
renderer builds its TOC from your heading levels (`#`/`##`/`###`), so put the
chapter number in the heading text itself.

## Step 3 — Write each section using the exact Markdown conventions

Read `references/markdown-conventions.md` before writing the first section —
it has the full grammar (screenshot placeholders, callouts, field tables)
with a complete worked example, and the renderer in `scripts/render-pdf.mjs`
only understands *this* subset of Markdown. Straying from it (e.g. fenced
code blocks, nested blockquotes) won't error, it'll just render as an
unstyled paragraph.

The one rule that must never bend: **every screenshot placeholder is exactly**

```
![ስክሪንሾት: <Amharic description> — <route path>]
(assets/screenshots/<slug>.png)
```

This isn't decoration — the human filling in real screenshots later greps
for `![ስክሪንሾት:` to find every slot that needs an image, and the route path
in the placeholder is what tells them which live screen to capture. A
placeholder missing the route, or using a different emoji/wording, is a slot
that gets missed.

For every screen you document, include: the screenshot placeholder, a
`ስክሪንሾት መግለጫ:` blockquote describing what's visible (write this as if the
reader can't see the actual app yet, because they can't), a `ቁጥር:` figure
reference, numbered steps for anything the user *does* on that screen (not
just fields that exist), callouts for the errors/warnings/results/tips that
actually matter (skip callouts that don't apply to a given screen — a
read-only report page has no ❌ error state to document), and a bilingual
field table for any form. A page with no form (a dashboard, a report) doesn't
need a field table — don't force one.

## Step 4 — Render to PDF

```bash
node .claude/skills/woreda-manual/scripts/render-pdf.mjs \
  docs/woreda-portal-manual-am.md \
  docs/woreda-portal-manual-am.pdf \
  --title "የወረዳ ፖርታል የተጠቃሚ መመሪያ" \
  --subtitle "Woreda Portal User Manual"
```

This script needs no npm install — it drives the Chromium binary already
present at `/opt/pw-browsers` directly over the DevTools protocol using
Node's built-in `WebSocket`, specifically so this skill never has to add a
PDF-rendering dependency to the app's own `package.json`. It embeds
`assets/fonts/NotoSansEthiopic-*.ttf` (bundled in this skill, not fetched at
render time) so Ethiopic script renders correctly regardless of what fonts
happen to be installed on the machine running the skill, and produces
page-numbered footers via `Page.printToPDF`'s header/footer templates, which
the CLI's own `--print-to-pdf` flag cannot do.

Every screenshot placeholder renders at a fixed half-A4 height (148mm) regardless of caption length, so the finished PDF reads like a real print-ready manual — a page of dense text next to a thumbnail-sized placeholder looks unfinished, and a reader filling in screenshots later should be able to judge proportion (crop the real screenshot to roughly this shape) from the placeholder alone. This is set once in `assets/manual.css` (`.placeholder-box`) — don't override it per-section.

It writes a `.render.html` file next to the PDF — open that in a browser (or
screenshot it, see below) to sanity-check layout before considering the PDF
done. Re-run the script after every content edit; it's a few seconds, and
catching a broken table or a mis-numbered heading in the HTML is much faster
than noticing it in a 60-page PDF.

To visually verify without a display, screenshot the intermediate HTML with
headless Chromium directly (see `references/verification.md` for the full
recipe) — check at minimum the cover page, the TOC, and one section with a
table and a callout, since those are the places a Markdown-convention typo
shows up as broken layout rather than a script error.

## Updating an existing manual

If `docs/woreda-portal-manual-am.md` already exists, this is an edit job, not
a rewrite: diff the current route list (Step 1) against what the manual
covers, add sections for anything new, and re-render. Don't regenerate
sections that are already accurate just because you're touching the file —
a human may have hand-edited a description after filling in real
screenshots, and a wholesale rewrite throws that away.

## Known conventions worth getting right

See `references/known-conventions.md` for details that are easy to get wrong
on a first pass: the admin console stays in English even inside an Amharic
manual, Ethiopian-calendar dates are what the app actually displays, and the
`credential-templates` storage bucket is a deliberate bare-path exception —
these come up whenever the manual describes a screen that touches them.
