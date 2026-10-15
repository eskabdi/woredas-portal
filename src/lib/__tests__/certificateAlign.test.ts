import { describe, expect, it } from "vitest";

import {
  alignBoxes,
  boxesInRect,
  distributeBoxes,
  matchSize,
  moveBoxes,
  type Box,
} from "@/lib/certificateAlign";

const a: Box = { id: "a", x: 10, y: 10, width: 8, height: 10 };
const b: Box = { id: "b", x: 40, y: 30, width: 20, height: 5 };
const c: Box = { id: "c", x: 70, y: 60, width: 10, height: 10 };

describe("certificate builder alignment", () => {
  it("moves a group by one clamped delta, keeping its shape", () => {
    expect(moveBoxes([a, b], 5, 5)).toEqual({ a: { x: 15, y: 15 }, b: { x: 45, y: 35 } });
    // b's right edge is at 60; the group can move at most 40 to the right.
    expect(moveBoxes([a, b], 90, 0)).toEqual({ a: { x: 50, y: 10 }, b: { x: 80, y: 30 } });
    expect(moveBoxes([a, b], -50, -50)).toEqual({ a: { x: 0, y: 0 }, b: { x: 30, y: 20 } });
  });

  it("aligns several boxes to their common bounds", () => {
    expect(alignBoxes([a, b, c], "left")).toEqual({ a: { x: 10 }, b: { x: 10 }, c: { x: 10 } });
    expect(alignBoxes([a, b, c], "right")).toEqual({ a: { x: 72 }, b: { x: 60 }, c: { x: 70 } });
    expect(alignBoxes([a, b], "top")).toEqual({ a: { y: 10 }, b: { y: 10 } });
    expect(alignBoxes([a, b], "bottom")).toEqual({ a: { y: 25 }, b: { y: 30 } });
    expect(alignBoxes([a, b], "hcenter")).toEqual({ a: { x: 31 }, b: { x: 25 } });
    expect(alignBoxes([a, b], "vmiddle")).toEqual({ a: { y: 17.5 }, b: { y: 20 } });
  });

  it("aligns a single box to the page", () => {
    expect(alignBoxes([a], "hcenter")).toEqual({ a: { x: 46 } });
    expect(alignBoxes([a], "right")).toEqual({ a: { x: 92 } });
    expect(alignBoxes([a], "bottom")).toEqual({ a: { y: 90 } });
  });

  it("distributes three or more boxes with equal gaps", () => {
    const d = distributeBoxes([c, a, b], "horizontal");
    // span 10..80 = 70, sizes 38, gap 16
    expect(d).toEqual({ a: { x: 10 }, b: { x: 34 }, c: { x: 70 } });
    expect(distributeBoxes([a, b], "horizontal")).toEqual({});
  });

  it("matches sizes to the reference box and stays on the page", () => {
    expect(matchSize([a, b, c], "width", "b")).toEqual({
      a: { width: 20, x: 10 },
      c: { width: 20, x: 70 },
    });
    const wide: Box = { id: "w", x: 0, y: 0, width: 50, height: 5 };
    expect(matchSize([wide, c], "width", "w")).toEqual({ c: { width: 50, x: 50 } });
  });

  it("finds boxes touched by a marquee", () => {
    expect(boxesInRect([a, b, c], { x: 0, y: 0, width: 45, height: 32 })).toEqual(["a", "b"]);
    expect(boxesInRect([a, b, c], { x: 85, y: 85, width: 5, height: 5 })).toEqual([]);
  });
});
