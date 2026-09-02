import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-002/003/004/005 — several woreda-portal list pages
// rendered a domain date (civil registration event_date, resident
// date_of_birth) or an updated/submitted timestamp via plain
// `new Date(x).toLocaleDateString()`, a Gregorian-locale date, instead of
// the shared Ethiopian calendar formatter every other date field in this
// Amharic-primary portal uses (CLAUDE.md: "Dates are Ethiopian-first in the
// woreda portal"). Each affected file had the bug in two places: the
// on-screen table cell AND the CSV/PDF export column definition for the
// same field, so the exported file disagreed with what the screen showed.
//
// Found by /qa on 2026-09-02
// Report: .gstack/qa-reports/qa-report-woredas-portal-2026-09-02.md
//
// This test reads the route source directly rather than rendering the
// component: these route files call `useQuery`/`supabase` at module scope
// and rely on TanStack Router's file-based `createFileRoute`, so rendering
// them requires a router + query-client + Supabase mock for no benefit here
// -- the bug was "the wrong formatter was called," not a runtime behavior
// that needs a live render to observe. Same technique as
// scripts/check-role-perms-drift.ts, which parses migration SQL as text
// instead of running it against a database.

const ROUTES_DIR = join(__dirname, "..");

function readRoute(file: string): string {
  return readFileSync(join(ROUTES_DIR, file), "utf-8");
}

// The exact Gregorian-locale anti-pattern this bug class introduces.
const GREGORIAN_TOLOCALE_DATE = /new Date\([^)]*\)\.toLocaleDateString\(\)/;

describe("Ethiopian date formatting (F-QA-2026-09-02 regression lock)", () => {
  describe("woreda.civil.index.tsx — event_date (ISSUE-002)", () => {
    const src = readRoute("woreda.civil.index.tsx");

    it("does not reintroduce a raw toLocaleDateString() call for event_date", () => {
      expect(src).not.toMatch(
        /r\.event_date\s*\?\s*new Date\(r\.event_date\)\.toLocaleDateString\(\)/,
      );
    });

    it("formats the export column's Event Date with the Ethiopian formatter", () => {
      const exportSection = src.slice(
        src.indexOf('header: "የክስተት ቀን / Event Date"'),
        src.indexOf('header: "የክስተት ቀን / Event Date"') + 200,
      );
      expect(exportSection).toContain("formatEthiopianDateShortOnly(r.event_date");
    });

    it("formats the on-screen Event Date cell with the Ethiopian formatter", () => {
      const cellMatches = [...src.matchAll(/formatEthiopianDateShortOnly\(r\.event_date[^)]*\)/g)];
      // One in the export column definition, one in the on-screen <td>.
      expect(cellMatches.length).toBe(2);
    });

    it("imports formatEthiopianDateShortOnly from the shared calendar util", () => {
      expect(src).toMatch(
        /import\s*\{\s*formatEthiopianDateShortOnly\s*\}\s*from\s*"@\/utils\/ethiopianCalendar"/,
      );
    });
  });

  describe("woreda.residents.index.tsx — date_of_birth + updated_at (ISSUE-003)", () => {
    const src = readRoute("woreda.residents.index.tsx");

    it("does not reintroduce raw toLocaleDateString() for date_of_birth or updated_at", () => {
      expect(src).not.toMatch(/new Date\(r\.date_of_birth\)\.toLocaleDateString\(\)/);
      expect(src).not.toMatch(/new Date\(r\.updated_at\)\.toLocaleDateString\(\)/);
    });

    it("exports DOB with the Ethiopian formatter", () => {
      expect(src).toMatch(/formatEthiopianDateShortOnly\(r\.date_of_birth\s*\?\?\s*""/);
    });

    it("formats Updated (on-screen and export) with the Ethiopian short formatter, twice", () => {
      const matches = [...src.matchAll(/formatEthiopianDateShort\(new Date\(r\.updated_at\)\)/g)];
      expect(matches.length).toBe(2);
    });
  });

  describe("woreda.households.index.tsx — updated_at (ISSUE-004)", () => {
    const src = readRoute("woreda.households.index.tsx");

    it("does not reintroduce raw toLocaleDateString() for updated_at", () => {
      expect(src).not.toMatch(/new Date\(h\.updated_at\)\.toLocaleDateString\(\)/);
    });

    it("formats Updated (on-screen and export) with the Ethiopian short formatter, twice", () => {
      const matches = [...src.matchAll(/formatEthiopianDateShort\(new Date\(h\.updated_at\)\)/g)];
      expect(matches.length).toBe(2);
    });
  });

  describe("woreda.credentials.index.tsx — submitted_at/created_at (ISSUE-005)", () => {
    const src = readRoute("woreda.credentials.index.tsx");

    it("does not reintroduce raw toLocaleDateString() for submitted_at/created_at", () => {
      expect(src).not.toMatch(GREGORIAN_TOLOCALE_DATE);
    });

    it("formats Submitted (on-screen and export) with the Ethiopian short formatter, falling back to created_at, twice", () => {
      const matches = [
        ...src.matchAll(
          /formatEthiopianDateShort\(new Date\(r\.submitted_at\s*\?\?\s*r\.created_at\)\)/g,
        ),
      ];
      expect(matches.length).toBe(2);
    });
  });
});
