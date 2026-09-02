import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-001 — RolesPermissionsTab grouped each permission
// section (by prefix: resident, household, civil, ...) inside a bare `<>`
// shorthand fragment returned from `.map()`. Shorthand fragments can't carry
// a `key`, so React logged "Each child in a list should have a unique key
// prop" on every render of /woreda/settings/users-permissions.
//
// Found by /qa on 2026-09-02
// Report: .gstack/qa-reports/qa-report-woredas-portal-2026-09-02.md
//
// Read as source rather than rendered: RolesPermissionsTab fetches via
// useQuery/supabase at the top of the component, so rendering it needs a
// query-client + Supabase mock for no benefit here -- the bug is a static
// JSX property (shorthand fragment vs. keyed Fragment), not runtime
// behavior that needs a live render to observe.

const SRC = readFileSync(join(__dirname, "..", "RolesPermissionsTab.tsx"), "utf-8");

describe("RolesPermissionsTab (F-QA-2026-09-02 regression lock)", () => {
  it("does not wrap the grouped rows in a bare, unkeyed shorthand fragment", () => {
    // The anti-pattern: `grouped.map(([prefix, keys]) => ( <> ... ))`
    expect(SRC).not.toMatch(/grouped\.map\(\(\[prefix, keys\]\) => \(\s*<>/);
  });

  it("wraps each group in a Fragment keyed by prefix", () => {
    expect(SRC).toMatch(/grouped\.map\(\(\[prefix, keys\]\) => \(\s*<Fragment key=\{prefix\}>/);
  });

  it("imports Fragment from react", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\bFragment\b[^}]*\}\s*from\s*"react"/);
  });

  it("has a matching closing </Fragment> for the opening one (balanced, not left as a bare </>)", () => {
    const opens = [...SRC.matchAll(/<Fragment key=\{prefix\}>/g)].length;
    const closes = [...SRC.matchAll(/<\/Fragment>/g)].length;
    expect(opens).toBe(1);
    expect(closes).toBe(1);
  });
});
