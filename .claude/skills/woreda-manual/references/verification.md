# Verifying the rendered PDF without a display

This environment has no display, so "open the PDF and look at it" means
screenshotting the intermediate HTML with headless Chromium instead. This is
worth doing after any content edit that touches layout-sensitive elements
(a wide table, a long callout, a new figure) — a Markdown typo in this
skill's narrow grammar (see `references/markdown-conventions.md`) doesn't
error, it just silently degrades to a plain paragraph, and the only way to
catch that is to look.

## Screenshot the cover page and TOC

```bash
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # confirm the actual rev dir under /opt/pw-browsers
"$CHROME" --headless=new --disable-gpu --no-sandbox --window-size=1000,1400 \
  --screenshot=/tmp/manual-cover.png \
  "file://$(pwd)/docs/woreda-portal-manual-am.render.html"
```

Then use the `Read` tool on `/tmp/manual-cover.png` to view it.

## Screenshot a specific section

Scrolling requires injecting a tiny script, since headless `--screenshot`
only captures the initial viewport:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('docs/woreda-portal-manual-am.render.html', 'utf8')
  .replace('</body>', '<script>document.getElementById(\"<SECTION-SLUG>\").scrollIntoView();</script></body>');
fs.writeFileSync('/tmp/manual-section.html', html);
"
"$CHROME" --headless=new --disable-gpu --no-sandbox --window-size=1000,1400 \
  --virtual-time-budget=2000 --screenshot=/tmp/manual-section.png \
  "file:///tmp/manual-section.html"
```

Section slugs are auto-generated from heading text by the renderer (lowercase,
non-letters/digits collapsed to `-`) — grep the `.render.html` for `id="` to
find the exact slug for a heading if guessing it wrong.

## What to actually check

- **Cover page**: Amharic title renders as glyphs, not tofu boxes — this is
  the fastest way to notice the embedded font failed to load.
- **TOC**: every chapter you wrote appears, nesting looks right (h2 indented
  under h1, h3 further indented).
- **A section with a table and at least one callout of each color**: tables
  don't overflow the page width, callout colors match (red/amber/green/blue
  for ❌/⚠️/✅/💡), and a screenshot placeholder shows its dashed box with the
  alt text and path legible.

If Amharic text renders as boxes, the embedded font failed to load — check
that `assets/fonts/NotoSansEthiopic-Regular.ttf` and `-Bold.ttf` still exist
in this skill's directory (they're committed binary assets, not fetched at
render time) and that `render-pdf.mjs` is reading them from
`SKILL_ROOT/assets/fonts`, not a stale path.
