import type { GridPoint } from '../types';

export const GRID_PX = 64;          // pixels per grid unit (1 m)
export const CANVAS_PAD = 80;       // px padding around content

export function dist(a: GridPoint, b: GridPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function snapGrid(v: number): number {
  return Math.round(v);
}

export function snapHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

export function gridToPixel(p: GridPoint, ox = 0, oy = 0): { x: number; y: number } {
  return { x: CANVAS_PAD + p.x * GRID_PX + ox, y: CANVAS_PAD + p.y * GRID_PX + oy };
}

export function pixelToGrid(px: number, py: number, ox = 0, oy = 0): GridPoint {
  return {
    x: (px - CANVAS_PAD - ox) / GRID_PX,
    y: (py - CANVAS_PAD - oy) / GRID_PX,
  };
}

export function snapToGridPoint(p: GridPoint): GridPoint {
  return { x: snapGrid(p.x), y: snapGrid(p.y) };
}

export function segLen(a: GridPoint, b: GridPoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Return the midpoint of a segment */
export function midpoint(a: GridPoint, b: GridPoint): GridPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Unique ID generator */
let _uid = 1;
export function uid(): string {
  return `id_${(_uid++).toString(36)}`;
}

/** True if two segments share exactly one endpoint (for duct connectivity) */
export function segmentsConnected(
  a: { start: GridPoint; end: GridPoint },
  b: { start: GridPoint; end: GridPoint },
): boolean {
  const eps = 0.01;
  const near = (p: GridPoint, q: GridPoint) =>
    Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;
  return (
    near(a.start, b.start) ||
    near(a.start, b.end) ||
    near(a.end, b.start) ||
    near(a.end, b.end)
  );
}

/** Heat gradient: t=0 → blue (cool), t=1 → red (hot), alpha for fill */
export function heatColor(t: number, alpha = 0.28): string {
  const clamped = Math.max(0, Math.min(1, t));
  const hue = (1 - clamped) * 220; // 220° (blue) → 0° (red)
  return `hsla(${hue.toFixed(1)}, 85%, 55%, ${alpha})`;
}

/** Solid heat color for legend/UI */
export function heatColorSolid(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const hue = (1 - clamped) * 220;
  return `hsl(${hue.toFixed(1)}, 85%, 55%)`;
}

/** Constrain a duct drawing preview to H/V/45° snap */
export function snapDuctAngle(start: GridPoint, raw: GridPoint): GridPoint {
  const dx = raw.x - start.x;
  const dy = raw.y - start.y;
  if (Math.abs(dx) === 0 && Math.abs(dy) === 0) return raw;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  // Snap to nearest of: horizontal, vertical, 45°
  if (adx > ady * 2) return { x: raw.x, y: start.y };           // horizontal
  if (ady > adx * 2) return { x: start.x, y: raw.y };           // vertical
  const diag = Math.min(adx, ady);                               // 45°
  return {
    x: start.x + Math.sign(dx) * diag,
    y: start.y + Math.sign(dy) * diag,
  };
}

/** Same snap for wall drawing (allows 45°) */
export function snapWallAngle(start: GridPoint, raw: GridPoint): GridPoint {
  return snapDuctAngle(start, raw);
}
