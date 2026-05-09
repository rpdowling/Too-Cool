/**
 * Duct sizing helpers based on simplified ductulator rules.
 *
 * Target: 0.10 in. w.g. / 100 ft friction rate, ≤ 900 FPM velocity.
 * Round duct areas and CFM limits:
 *   4"  → A = 0.0873 ft²  → max ~78 CFM
 *   6"  → A = 0.1963 ft²  → max ~177 CFM
 *   8"  → A = 0.3491 ft²  → max ~314 CFM
 *   12" → A = 0.7854 ft²  → max ~707 CFM
 */
import type { DuctSize, Diffuser, Room, DuctSystem, DuctSegment, GridPoint } from '../types';
import { uid } from './utils';

export const DUCT_MAX_CFM: Record<DuctSize, number> = {
  4: 78,
  6: 177,
  8: 314,
  12: 707,
};

export const DUCT_SIZES: DuctSize[] = [4, 6, 8, 12];

/** Pick the smallest duct that can handle the given CFM */
export function autoSizeDuct(cfm: number): DuctSize {
  for (const size of DUCT_SIZES) {
    if (cfm <= DUCT_MAX_CFM[size]) return size;
  }
  return 12;
}

/** Canvas render widths for each duct size (px, double-line outer gap) */
export const DUCT_RENDER_PX: Record<DuctSize, number> = {
  4: 8,
  6: 12,
  8: 16,
  12: 24,
};

/** Display label */
export function ductLabel(size: DuctSize): string {
  return `${size}"`;
}

/**
 * Auto-size all diffusers in a room given the total room CFM and diffuser count.
 * Splits load equally, then auto-sizes each diffuser.
 */
export function sizeDiffusersForRoom(
  roomCFM: number,
  count: number,
): { cfm: number; size: DuctSize } {
  const perDiffuser = roomCFM / count;
  return { cfm: Math.round(perDiffuser), size: autoSizeDuct(perDiffuser) };
}

/** Returns the duct draw width in px (the gap between the two lines) */
export function ductLineGap(size: DuctSize): number {
  return DUCT_RENDER_PX[size];
}

/** Transition length in metres — typically 4× diameter */
export function transitionLength(from: DuctSize, to: DuctSize): number {
  return (Math.max(from, to) / 12) * 1.2; // metres, simplified
}

// ─── Auto-recalculation of segment sizes ─────────────────────────────────────

function ptKey(p: GridPoint): string { return `${p.x},${p.y}`; }

function recalcSide(
  segments: DuctSegment[],
  diffusers: Diffuser[],
  startPort: GridPoint,
  isReturn: boolean,
): DuctSegment[] {
  if (segments.length === 0) return segments;

  // Build adjacency from segments
  const adj = new Map<string, string[]>();
  for (const seg of segments) {
    const ak = ptKey(seg.start), bk = ptKey(seg.end);
    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push(bk);
    adj.get(bk)!.push(ak);
  }

  // BFS from startPort to build spanning tree and visit order
  const parent = new Map<string, string | null>();
  const bfsOrder: string[] = [];
  const queue: string[] = [ptKey(startPort)];
  parent.set(ptKey(startPort), null);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    bfsOrder.push(cur);
    for (const nb of adj.get(cur) ?? []) {
      if (!parent.has(nb)) {
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
  }

  // Sum diffuser CFMs per grid point
  const diffCFM = new Map<string, number>();
  for (const d of diffusers) {
    const k = ptKey(d.position);
    diffCFM.set(k, (diffCFM.get(k) ?? 0) + d.cfm);
  }

  // Propagate CFM from leaves to root (reverse BFS order)
  const subtree = new Map<string, number>();
  for (const k of bfsOrder) subtree.set(k, diffCFM.get(k) ?? 0);
  for (const k of [...bfsOrder].reverse()) {
    const p = parent.get(k);
    if (p !== null && p !== undefined) {
      subtree.set(p, (subtree.get(p) ?? 0) + (subtree.get(k) ?? 0));
    }
  }

  return segments.map(seg => {
    const ak = ptKey(seg.start), bk = ptKey(seg.end);
    // Downstream end = the child in the BFS tree
    const downstreamKey = parent.get(bk) === ak ? bk : ak;
    const cfm = subtree.get(downstreamKey) ?? seg.cfm;
    if (cfm <= 0) return seg;
    return { ...seg, cfm, size: autoSizeDuct(cfm), isReturn };
  });
}

/**
 * Recalculates every segment's CFM and size based on which diffusers are
 * reachable downstream from the AHU ports.  Call after any duct system change.
 */
export function recalculateDuctSizes(
  ds: DuctSystem,
  supplyPort: GridPoint,
  returnPort: GridPoint,
): DuctSystem {
  const supplySegs = recalcSide(
    ds.segments.filter(s => !s.isReturn),
    ds.diffusers.filter(d => !d.isReturn),
    supplyPort,
    false,
  );
  const returnSegs = recalcSide(
    ds.segments.filter(s => s.isReturn),
    ds.diffusers.filter(d => d.isReturn),
    returnPort,
    true,
  );
  return { ...ds, segments: [...supplySegs, ...returnSegs] };
}

/** Pressure drop per metre at given CFM and size (in. w.g./m) — simplified */
export function frictionLoss(cfm: number, size: DuctSize): number {
  // Based on ASHRAE: ΔP = 0.1 in. w.g. per 100 ft → 0.00328 per metre at design
  // Scale by (actual_velocity / design_velocity)^1.85
  const areaFt2 = Math.PI * ((size / 2 / 12) ** 2);
  const velocityFPM = cfm / areaFt2;
  const designFPM = 700;
  const ratio = velocityFPM / designFPM;
  return 0.00328 * Math.pow(ratio, 1.85);
}
