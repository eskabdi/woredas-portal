/**
 * Geometry for the certificate template builder's multi-selection: moving a
 * group, aligning, distributing and matching sizes. Every box is in percent
 * of the page (0..100 on each axis), the unit certificate_template_field
 * stores, and every result stays inside the page.
 *
 * Pure functions so Vitest covers them; the builder only maps the returned
 * patches onto its draft state.
 */

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoxPatch = Partial<Pick<Box, "x" | "y" | "width" | "height">>;
export type AlignMode = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom";
export type Axis = "horizontal" | "vertical";

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function selectionBounds(boxes: Box[]): Omit<Box, "id"> {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Move every box by the same delta. The delta is clamped for the group as a
 * whole, so the selection keeps its shape at the page edge instead of
 * squashing against it.
 */
export function moveBoxes(boxes: Box[], dx: number, dy: number): Record<string, BoxPatch> {
  if (!boxes.length) return {};
  const b = selectionBounds(boxes);
  const cdx = clamp(dx, -b.x, 100 - (b.x + b.width));
  const cdy = clamp(dy, -b.y, 100 - (b.y + b.height));
  const out: Record<string, BoxPatch> = {};
  for (const box of boxes) out[box.id] = { x: r2(box.x + cdx), y: r2(box.y + cdy) };
  return out;
}

/**
 * One box aligns to the page; several align to the edges (or centre) of
 * their common bounding box.
 */
export function alignBoxes(boxes: Box[], mode: AlignMode): Record<string, BoxPatch> {
  if (!boxes.length) return {};
  const ref = boxes.length === 1 ? { x: 0, y: 0, width: 100, height: 100 } : selectionBounds(boxes);
  const out: Record<string, BoxPatch> = {};
  for (const b of boxes) {
    switch (mode) {
      case "left":
        out[b.id] = { x: r2(clamp(ref.x, 0, 100 - b.width)) };
        break;
      case "hcenter":
        out[b.id] = { x: r2(clamp(ref.x + (ref.width - b.width) / 2, 0, 100 - b.width)) };
        break;
      case "right":
        out[b.id] = { x: r2(clamp(ref.x + ref.width - b.width, 0, 100 - b.width)) };
        break;
      case "top":
        out[b.id] = { y: r2(clamp(ref.y, 0, 100 - b.height)) };
        break;
      case "vmiddle":
        out[b.id] = { y: r2(clamp(ref.y + (ref.height - b.height) / 2, 0, 100 - b.height)) };
        break;
      case "bottom":
        out[b.id] = { y: r2(clamp(ref.y + ref.height - b.height, 0, 100 - b.height)) };
        break;
    }
  }
  return out;
}

/**
 * Equal gaps between three or more boxes along one axis; the first and last
 * box (by position) stay where they are.
 */
export function distributeBoxes(boxes: Box[], axis: Axis): Record<string, BoxPatch> {
  if (boxes.length < 3) return {};
  const pos = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "width" : "height";
  const sorted = [...boxes].sort((a, b) => a[pos] - b[pos]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[pos] + last[size] - first[pos];
  const total = sorted.reduce((s, b) => s + b[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  const out: Record<string, BoxPatch> = {};
  let cursor = first[pos];
  for (const b of sorted) {
    out[b.id] = { [pos]: r2(clamp(cursor, 0, 100 - b[size])) };
    cursor += b[size] + gap;
  }
  return out;
}

/** Give every box the width (or height) of the reference box. */
export function matchSize(
  boxes: Box[],
  dim: "width" | "height",
  refId: string,
): Record<string, BoxPatch> {
  const ref = boxes.find((b) => b.id === refId);
  if (!ref) return {};
  const pos = dim === "width" ? "x" : "y";
  const out: Record<string, BoxPatch> = {};
  for (const b of boxes) {
    if (b.id === ref.id) continue;
    const value = ref[dim];
    // Shift the box back onto the page rather than cut the new size.
    out[b.id] = { [dim]: r2(value), [pos]: r2(clamp(b[pos], 0, 100 - value)) };
  }
  return out;
}

/** Boxes that intersect a marquee rectangle (percent units). */
export function boxesInRect(boxes: Box[], rect: Omit<Box, "id">): string[] {
  return boxes
    .filter(
      (b) =>
        b.x < rect.x + rect.width &&
        b.x + b.width > rect.x &&
        b.y < rect.y + rect.height &&
        b.y + b.height > rect.y,
    )
    .map((b) => b.id);
}
