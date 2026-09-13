import { describe, expect, it } from "vitest";
import {
  findCatalogProblems,
  parseFeeScheduleRows,
  parseWoredaIds,
  MAPPED_SERVICE_TYPES,
} from "../check-fee-catalog";

const WOREDA_A = "11111111-1111-1111-1111-111111111111";
const WOREDA_B = "22222222-2222-2222-2222-222222222222";

describe("check-fee-catalog", () => {
  it("parses woreda_id out of INSERT INTO public.woreda statements", () => {
    const sql = `INSERT INTO public.woreda (woreda_id, woreda_code, woreda_name_en, woreda_name_am, status, created_at, updated_at, woreda_numeric_code) VALUES ('${WOREDA_A}', 'X', 'X', 'X', 'active', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00', '1') ON CONFLICT DO NOTHING;`;
    expect(parseWoredaIds(sql)).toEqual(new Set([WOREDA_A]));
  });

  it("parses fee_schedule rows including status", () => {
    const sql = `INSERT INTO public.fee_schedule (fee_schedule_id, woreda_id, service_type, standard_fee, penalty_rate, status, created_at, updated_at) VALUES ('33333333-3333-3333-3333-333333333333', '${WOREDA_A}', 'ID Renewal', '50.00', '10.00', 'active', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00') ON CONFLICT DO NOTHING;`;
    const rows = parseFeeScheduleRows(sql);
    expect(rows).toEqual([{ woredaId: WOREDA_A, serviceType: "ID Renewal", status: "active" }]);
  });

  it("flags a woreda missing an active row for a mapped service type", () => {
    // WOREDA_A has all four mapped rows active; WOREDA_B has none.
    const rows = MAPPED_SERVICE_TYPES.map((serviceType) => ({
      woredaId: WOREDA_A,
      serviceType,
      status: "active",
    }));
    const problems = findCatalogProblems(new Set([WOREDA_A, WOREDA_B]), rows);
    expect(problems).toHaveLength(MAPPED_SERVICE_TYPES.length);
    expect(problems.every((p) => p.includes(WOREDA_B))).toBe(true);
  });

  it("flags 'review_required' the same as a missing row (F-05-shaped drift this check exists to catch)", () => {
    const rows = MAPPED_SERVICE_TYPES.map((serviceType) => ({
      woredaId: WOREDA_A,
      serviceType,
      status: serviceType === "Lost ID Replacement" ? "review_required" : "active",
    }));
    const problems = findCatalogProblems(new Set([WOREDA_A]), rows);
    expect(problems).toEqual([`${WOREDA_A} has NO active "Lost ID Replacement" fee_schedule row`]);
  });

  it("flags more than one active row for the same (woreda, service_type) pair", () => {
    const rows = [
      { woredaId: WOREDA_A, serviceType: "ID Renewal", status: "active" },
      { woredaId: WOREDA_A, serviceType: "ID Renewal", status: "active" },
    ];
    const problems = findCatalogProblems(new Set([WOREDA_A]), rows);
    expect(problems).toContain(`${WOREDA_A} has 2 active "ID Renewal" rows (expected exactly 1)`);
  });

  it("reports no problems when every woreda has exactly one active row per mapped service type", () => {
    const rows = [WOREDA_A, WOREDA_B].flatMap((woredaId) =>
      MAPPED_SERVICE_TYPES.map((serviceType) => ({ woredaId, serviceType, status: "active" })),
    );
    expect(findCatalogProblems(new Set([WOREDA_A, WOREDA_B]), rows)).toEqual([]);
  });
});
