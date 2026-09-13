import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Task 12-B (fix-task-production-readiness-v3, 12.2): the spec's F-09 class
// asks for a test proving the preview path and the print path produce
// identical output -- for the service-letter module that's
// sanitizeLetterHtml() applied the same way in both places (already covered
// by its own tests). The credential card has no HTML-sanitization step at
// all (docs/task12-mapping-memo.md's "Print layout" section: it's a
// positioned-field canvas, not HTML), so that specific function has nothing
// to test here -- but the credential module has its OWN version of the same
// risk class: for years-worth of a template-driven card, there are TWO
// React components that can render a card face -- `PrintableCard` (the real,
// field-positioned renderer that the physical card printer output is built
// from) and `CardFront`/`CardBack` (a hand-styled fallback shown only when a
// tenant hasn't uploaded a template background yet, and which never prints
// at all -- see this file's own inline comment at the preview call site).
//
// The actual parity guarantee this file locks: whenever a template
// background exists (the case that will ever actually be printed), the
// on-screen preview pane and the hidden print surface both render through
// the SAME `PrintableCard` component (only the `previewMode` prop differs),
// never the CardFront/CardBack fallback. That is what makes "preview equals
// print" true here -- not two independently-formatted renderings that could
// drift, but one renderer used twice.
//
// Source-scan technique, matching ethiopian-date-formatting.regression.test.ts
// and scripts/check-role-perms-drift.ts: this route calls useQuery/supabase
// at module scope and relies on TanStack Router's file-based routing, so
// rendering it needs a router + query-client + Supabase mock for no benefit
// here -- the invariant is "which component is called," not runtime output.

const ROUTE_PATH = join(__dirname, "..", "woreda.credentials.$requestId.print.tsx");
const src = readFileSync(ROUTE_PATH, "utf-8");

describe("credential print/preview parity (Task 12-B, F-09 class)", () => {
  it("the front preview renders PrintableCard (not CardFront) when a template background exists", () => {
    const section = src.slice(src.indexOf("{frontBgUrl ? ("), src.indexOf("{backBgUrl ? ("));
    expect(section).toMatch(/frontBgUrl \? \(\s*<PrintableCard/);
    expect(section).toMatch(/side="front"/);
    expect(section).toMatch(/previewMode/);
  });

  it("the back preview renders PrintableCard (not CardBack) when a template background exists", () => {
    const section = src.slice(src.indexOf("{backBgUrl ? ("), src.indexOf("Hidden print surface"));
    expect(section).toMatch(/backBgUrl \? \(\s*<PrintableCard/);
    expect(section).toMatch(/side="back"/);
    expect(section).toMatch(/previewMode/);
  });

  it("the hidden print surface renders both faces through PrintableCard, never CardFront/CardBack", () => {
    const printSurface = src.slice(
      src.indexOf("Hidden print surface"),
      src.indexOf("function CardFront"),
    );
    const printableCardCount = [...printSurface.matchAll(/<PrintableCard/g)].length;
    expect(printableCardCount).toBe(2); // front + back
    expect(printSurface).not.toMatch(/<CardFront|<CardBack/);
  });

  it("CardFront/CardBack are defined only as the no-template fallback, never given a bgUrl of their own template kind", () => {
    // Sanity check that the fallback components still exist and are wired to
    // the SAME bgUrl variables PrintableCard's branch checks -- if this ever
    // stops matching, the fallback and the real renderer have diverged on
    // which background gates which component, reopening the exact class of
    // bug this test file locks.
    expect(src).toMatch(/<CardFront[\s\S]{0,600}bgUrl=\{frontBgUrl\}/);
    expect(src).toMatch(/<CardBack[\s\S]{0,600}bgUrl=\{backBgUrl\}/);
  });
});
