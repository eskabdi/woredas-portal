import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Task 14-B: the letter-issuance security fix (server-side payment gate on
// the transition into 'issued') closes who can reach 'issued', but the
// content itself is still rendered client-side in two independent places:
// issueLetter() (woreda.services.$requestId.index.tsx, snapshots
// issued_letter_html at issuance time) and the print route
// (woreda.services.$requestId.print.tsx, re-renders live from the same
// service_type template every time it's opened -- this is pre-existing,
// unchanged behavior, not something 14-B introduces). Both must run the
// SAME sanitizeLetterHtml() -> renderLetterTemplate() pipeline with the
// SAME token set, or the two paths silently drift (e.g. a future edit adds
// a token to one and not the other, or drops the sanitizer call from one).
// Source-scan technique, matching credential-print-preview-parity's own
// approach (Task 12-B) -- both routes call useQuery/supabase at module
// scope and rely on file-based routing, so rendering them for this
// invariant would need a router + query-client + Supabase mock for no
// benefit: what's being locked is "which functions are called with which
// arguments," not runtime output.

const DETAIL_ROUTE = readFileSync(
  join(__dirname, "..", "woreda.services.$requestId.index.tsx"),
  "utf-8",
);
const PRINT_ROUTE = readFileSync(
  join(__dirname, "..", "woreda.services.$requestId.print.tsx"),
  "utf-8",
);

const TEMPLATE_TOKENS = [
  "APPLICANT_NAME",
  "RESIDENT_NUMBER",
  "KEBELE",
  "WOREDA",
  "PURPOSE",
  "ADDRESSED_TO",
  "LETTER_NO",
  "DATE_ET",
  "DATE_GC",
  "SEX",
  "DETAILS",
];

function extractRenderCall(src: string): string {
  const start = src.indexOf("renderLetterTemplate(sanitizeLetterHtml(");
  expect(start).toBeGreaterThan(-1);
  // Grab a generous window past the call site -- enough to contain the full
  // object literal without needing a real parser for this source-scan check.
  return src.slice(start, start + 900);
}

describe("service letter generation/print sanitizer parity (Task 14-B)", () => {
  it("issueLetter() (generation) sanitizes the template before rendering it", () => {
    expect(DETAIL_ROUTE).toMatch(/renderLetterTemplate\(sanitizeLetterHtml\(template\)/);
  });

  it("the print route sanitizes the template before rendering it", () => {
    expect(PRINT_ROUTE).toMatch(/renderLetterTemplate\(sanitizeLetterHtml\(templateHtml\)/);
  });

  it("both call sites substitute the identical token set", () => {
    const genCall = extractRenderCall(DETAIL_ROUTE);
    const printCall = extractRenderCall(PRINT_ROUTE);
    for (const token of TEMPLATE_TOKENS) {
      expect(genCall, `generation call missing ${token}`).toContain(`${token}:`);
      expect(printCall, `print call missing ${token}`).toContain(`${token}:`);
    }
  });

  it("neither call site bypasses sanitizeLetterHtml by rendering the raw template directly", () => {
    // Guards against a future edit that renders `template`/`templateHtml`
    // straight into renderLetterTemplate() without the sanitizer wrapper.
    expect(DETAIL_ROUTE).not.toMatch(/renderLetterTemplate\(template,/);
    expect(PRINT_ROUTE).not.toMatch(/renderLetterTemplate\(templateHtml,/);
  });
});
