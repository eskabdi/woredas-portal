import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { RolesPermissionsTab } from "./RolesPermissionsTab";
import { useAuthStore } from "@/stores/authStore";
import { P, ROLE_PERMISSIONS, type Role } from "@/config/permissions";

// A key the mocked backend below deliberately never seeds a role_permission
// row for — standing in for "a permission group added to the catalog after
// this tenant was seeded." civil.read is a plain (non-locked) permission
// whose default grant differs by role (true for most, false for
// finance_clerk), so the test also exercises the fallback picking up a
// per-role default rather than one constant value.
const UNSEEDED_KEY = P.CIVIL_READ;

const EDITABLE_ROLE_KEYS: Role[] = [
  "registry_clerk",
  "civil_registrar",
  "finance_clerk",
  "supervisor",
  "auditor",
  "viewer",
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => {
          const rows: { role_name: string; permission_key: string; is_granted: boolean }[] = [];
          for (const key of Object.values(P)) {
            if (key === UNSEEDED_KEY) continue;
            for (const role of EDITABLE_ROLE_KEYS) {
              rows.push({
                role_name: role,
                permission_key: key,
                is_granted: (ROLE_PERMISSIONS[role] as string[]).includes(key),
              });
            }
          }
          return { data: rows, error: null };
        }),
      })),
    })),
  },
}));

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

function renderMatrix() {
  useAuthStore.setState({ woredaId: "test-woreda-id", user: { id: "test-user-id" } as User });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RolesPermissionsTab />
    </QueryClientProvider>,
  );
}

describe("RolesPermissionsTab", () => {
  // F4 regression: the matrix used to build its row list from fetched
  // role_permission rows only, so a catalog permission with zero seeded
  // rows for the tenant (e.g. a newly added permission group, before any
  // seed backfill) never rendered at all — no row, no error, nothing to
  // click. It must always appear, using the code default until someone
  // saves an explicit override.
  it("renders a catalog permission that has no seeded role_permission row", async () => {
    renderMatrix();

    const keyCell = await screen.findByText(UNSEEDED_KEY);
    const row = keyCell.closest("tr");
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);

    // Flagged as a code default, not a saved grant.
    expect(rowScope.getAllByText(/default/i).length).toBeGreaterThan(0);

    // Checkbox state reflects ROLE_PERMISSIONS, not a blanket false —
    // civil.read defaults true for registry_clerk, false for finance_clerk.
    const checkboxes = rowScope.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(EDITABLE_ROLE_KEYS.length + 1); // +1 read-only tenant-admin column
    EDITABLE_ROLE_KEYS.forEach((role, i) => {
      const expected = (ROLE_PERMISSIONS[role] as string[]).includes(UNSEEDED_KEY);
      expect(checkboxes[i].getAttribute("aria-checked")).toBe(String(expected));
    });
  });
});
