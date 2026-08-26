---
name: pdf-print-pipeline
description: How to add a new printable PDF document/report to the woreda portal (a print route, an "አትም / Print" button, a PDF export, anything that turns a screen into a document a user prints or downloads). Covers the html2canvas-pro -> jsPDF -> blob pipeline, the shared PrintDocumentShell component and its Doc* primitives, and a real Chromium bug (silently blocked navigation) that this pipeline must avoid regressing. Use this whenever asked to add a print button, a printable profile/report/letter, a "generate PDF" feature, or to fix a print button that opens a blank tab.
---

# PDF print pipeline

Every printable document in this app (residence/household profiles,
rental occupant profiles, service letters, revenue receipts, and the
Reports-page A4 reports) is generated the same way: render the document
as a normal React component, screenshot it client-side, wrap the
screenshot in a PDF, and open that PDF in a new tab so the browser's own
PDF viewer shows it. There is no server-side PDF generation anywhere in
this app.

**Before writing a new print route, read this file, then skim an
existing one for the shape**: `src/routes/woreda.reports.$reportType.print.tsx`
is the most complete recent example (letterhead, KPI stats, data
tables, signature block, footer, all built from the shared shell).
`src/routes/woreda.households.$householdId.print.tsx` is a simpler
one (name/value fields instead of report tables).

## Use the shared shell, don't reimplement the pipeline

`src/components/print/PrintDocumentShell.tsx` owns the letterhead, the
"አትም / Print" button, the html2canvas/jsPDF/blob generation, and a
library of content primitives. A new print route is almost always just:
fetch data, arrange it with the primitives below, done — no new
`html2canvas` or `jsPDF` call needed.

```tsx
import {
  PrintDocumentShell,
  DocSection,
  DocDivider,
  DocFieldGrid,
  DocField,
  DocStatGrid,
  DocStat,
  DocDataTable,
  DocSignatureBlock,
  DocRecordFooter,
  SystemAttributionFooter,
} from "@/components/print/PrintDocumentShell";
```

| Primitive | For | Notes |
|---|---|---|
| `PrintDocumentShell` | The whole page | Letterhead (logo, regional header, woreda name/contact), doc tag + doc number + date on the right, the Print button, your `children` in the middle, your `footer` at the bottom. |
| `DocSection` | A numbered section (`01 —`, `02 —`...) | Bilingual title (`titleAm`/`titleEn`), wraps whatever content goes inside. |
| `DocDivider` | Between sections | Just an `<hr>`. |
| `DocFieldGrid` + `DocField` | Name/value pairs (a profile) | `DocFieldGrid cols={2\|3}`; each `DocField` is one label+value, `span={2\|3}` to widen. |
| `DocStatGrid` + `DocStat` | Big-number KPI tiles (a report's "01 — Summary") | `DocStatGrid cols={2\|3\|4}`; each `DocStat` is one tile. |
| `DocDataTable` | A Label/Count/Share table with an auto-computed Total row | Takes `rows: {name, value}[]` and an optional `valueLabel` (default `"Count"`, use `"ETB"` for money). This is the same row shape (`ReportSection["rows"]`) the Reports dashboard's charts already use — if you're printing something that also has an on-screen chart, reuse that same aggregate array instead of re-deriving it, so the printed numbers can never drift from what the screen showed. |
| `DocSignatureBlock` | "Certification" section | `items` is exactly two `{labelAm, labelEn}` entries (e.g. Prepared by / Approved by); it always renders a third "Official Stamp" box itself. |
| `DocRecordFooter` | Document-reference footer box | `refLabel`, `refId`, `printedOn`, optional `note`. There's no verification token/QR for internal documents (unlike issued letters) — don't invent one. |
| `SystemAttributionFooter` | The closing "system-generated document" line | Takes `woredaNameAm`. |

For branding (`logoDataUrl`, `woredaNameAm`, `woredaNameEn`, contact
line), use `useReportBranding()` (`src/hooks/useReportBranding.ts`) —
it already resolves the tenant's logo to a data URL and reads
`woreda_settings`. Don't write a new branding query.

For the on-screen "Print" trigger elsewhere in the app (a list/detail
page's own button that navigates to the print route, as opposed to the
print route's own internal Print button), match the existing styling:
blue background, `Printer` icon, bilingual label, e.g.

```tsx
<Button
  type="button"
  size="sm"
  onClick={() => navigate({ to: "/woreda/.../print", ... })}
  className="rounded-md bg-blue-700 text-white hover:bg-blue-800"
>
  <Printer className="mr-2 h-4 w-4" />
  <span className="font-noto-ethiopic">አትም</span>
  <span className="ml-1 opacity-80">/ Print</span>
</Button>
```

## If you must generate a PDF outside the shell

The shell's own `handlePrint` (and the one other place in the app that
still has its own copy, `src/routes/woreda.revenue.$paymentId.receipt.tsx`,
kept separate for historical reasons) is the reference implementation.
The pipeline:

```tsx
const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true });
const imgData = canvas.toDataURL("image/png");
const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
const pageWidth = pdf.internal.pageSize.getWidth();
const pageHeight = pdf.internal.pageSize.getHeight();
pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
pdf.setProperties({ title: `${docTagEn} ${docNumber}` });
const blobUrl = URL.createObjectURL(pdf.output("blob"));
```

Two things in there are load-bearing, not incidental:

**Import from `html2canvas-pro`, never plain `html2canvas`.** This
app's Tailwind v4 build resolves computed colors to `oklch(...)`, and
plain `html2canvas` 1.4.1 throws `"Attempting to parse an unsupported
color function"` on that. `html2canvas-pro` is the drop-in fork that
handles it.

**`printRef` should point at a dedicated, hidden-until-print DOM node
built for this document** (see how `PrintDocumentShell` sizes its
capture target: `mx-auto w-full max-w-[820px] border bg-white p-10
shadow-sm`, an A4-proportioned white card) — not at some section of an
already-visible interactive page. Capturing the live app UI is exactly
the bug this pipeline replaced (`window.print()` on the live DOM used
to bleed the sidebar and other chrome into the printout).

## The part that will bite you: opening the result

**Never do this** — it looks correct, builds fine, and is what every
"generate a PDF client-side" tutorial shows:

```tsx
// DON'T: pre-open a blank tab, navigate it later
const win = window.open("", "_blank");
// ...await html2canvas / jsPDF...
win.location.href = blobUrl; // <-- silently becomes "about:blank#blocked"
```

Chromium blocks a *deferred* top-level navigation of an already-open
window to a `blob:`/`data:` URL. The click that opened the window
carries a brief "user activation" window; by the time the async
`html2canvas`/`jsPDF` work finishes and the code tries to navigate that
window, the activation has expired, and Chromium silently refuses the
navigation instead of erroring — the tab just sits on `about:blank`
(inspect `location.href` post-navigation and it reads
`"about:blank#blocked"`). No exception, no console warning, nothing a
`try/catch` around the PDF generation will ever catch, because the PDF
generation itself succeeded. This was confirmed by instrumenting every
step of `handlePrint` and by running the flow in real headed Chromium
(`xvfb-run`) — it reproduced identically on `localhost` and on
production HTTPS, in the exact "works in a quick manual click, fails
under the same code path a moment later" way that made it look
correct for a long time before anyone caught it. It silently affected
every print route in this app until this pipeline was fixed.

**Do this instead** — build the blob URL, then simulate a click on a
real anchor element:

```tsx
const blobUrl = URL.createObjectURL(pdf.output("blob"));
const link = document.createElement("a");
link.href = blobUrl;
link.target = "_blank";
link.rel = "noopener";
document.body.appendChild(link);
link.click();
link.remove();
setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
```

An anchor-click-simulated new-tab-open is *not* subject to the same
block, even from inside the same async continuation — Chromium treats
it as a genuine open request rather than a deferred navigation of an
existing window. This is what `PrintDocumentShell.handlePrint` and the
receipt route both do now; don't reintroduce the `window.open("",
"_blank")` + later-`.location.href` pattern anywhere in this app,
including in a new one-off implementation that doesn't use the shared
shell.

One consequence: because there's no pre-opened window to show a
"popup blocked" message in, a real popup-blocker will just make the
`.click()` silently no-op (no tab opens, no error). This is an
accepted, minor trade-off versus the alternative being outright
broken — don't try to detect it, and don't reintroduce the pre-opened
empty tab to work around it.

## Verifying a print route actually works

Checking that `window.open`/the popup fired, or that a URL string
containing `blob:` appeared, is **not sufficient evidence** — the
bug above passed exactly that check while the tab stayed blank. Two
extra things are worth knowing if you're verifying this by driving a
browser (e.g. Playwright):

- **Screenshot the resulting tab and look at it.** A blob PDF popup
  whose `location.href` is a real `blob:...` string but whose
  screenshot is blank white is not a false alarm — go find out why.
- **Headless Chromium cannot reliably render its native PDF viewer.**
  A blob-PDF tab that looks blank, or whose CDP target has an empty
  `url`/`title`, under `chromium.launch({ headless: true })` can be
  entirely a headless-mode limitation, not an app bug. Re-run the same
  check under `xvfb-run` with `headless: false` before concluding
  anything is broken — that's what surfaced this whole issue in the
  first place, and what confirmed the fix.
