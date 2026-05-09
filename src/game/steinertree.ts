/**
 * Steiner-tree approximation for optimal duct routing.
 *
 * Two-phase approach:
 *   1. Prim's MST on room centroids + AHU supply port (Manhattan distance)
 *      determines the tree structure (which rooms connect to which).
 *   2. For each room, the supply diffuser is placed at the strictly-interior
 *      grid point closest (Manhattan) to the parent node in the MST.
 *      This minimizes total duct length rather than placing at the centroid.
 *
 * Short-circuit rule: return grilles are placed ≥ 2 grid units from the
 * supply diffuser so conditioned air isn't immediately recirculated.
 */
import type { GridPoint, DuctSystem, DuctSegment, Diffuser, Room, AHU, FloorPlan } from '../types';
import { uid, segLen, isOnWallOrDoor } from './utils';
import { autoSizeDuct } from './ductSizing';

// ─── Manhattan distance ───────────────────────────────────────────────────────

function manhattanDist(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// ─── MST via Prim's algorithm ─────────────────────────────────────────────────

interface Terminal {
  id: string;
  point: GridPoint;
  cfm: number;
}

function primMST(terminals: Terminal[]): Array<[Terminal, Terminal]> {
  if (terminals.length <= 1) return [];
  const inTree = new Set<string>([terminals[0].id]);
  const edges: Array<[Terminal, Terminal]> = [];

  while (inTree.size < terminals.length) {
    let best: [Terminal, Terminal] | null = null;
    let bestDist = Infinity;
    for (const t of terminals) {
      if (!inTree.has(t.id)) continue;
      for (const u of terminals) {
        if (inTree.has(u.id)) continue;
        const d = manhattanDist(t.point, u.point);
        if (d < bestDist) { bestDist = d; best = [t, u]; }
      }
    }
    if (!best) break;
    inTree.add(best[1].id);
    edges.push(best);
  }
  return edges;
}

// ─── Grid-point helpers ───────────────────────────────────────────────────────

function makeCellSet(cells: GridPoint[]): Set<string> {
  return new Set(cells.map(c => `${c.x},${c.y}`));
}

/** Integer centroid — used only to seed MST terminal positions. */
function centroid(cells: GridPoint[]): GridPoint {
  const cx = cells.reduce((s, c) => s + c.x + 0.5, 0) / cells.length;
  const cy = cells.reduce((s, c) => s + c.y + 0.5, 0) / cells.length;
  return { x: Math.round(cx), y: Math.round(cy) };
}

/** A grid point (x,y) is strictly interior when all four adjacent cells belong
 *  to the same room — it is not on any room boundary or wall. */
function isStrictlyInterior(x: number, y: number, cellSet: Set<string>): boolean {
  return cellSet.has(`${x - 1},${y - 1}`) && cellSet.has(`${x},${y - 1}`) &&
         cellSet.has(`${x - 1},${y}`)     && cellSet.has(`${x},${y}`);
}

/** Returns the strictly-interior grid point of `room` that minimises
 *  Manhattan distance to `target`, avoiding wall/door/window positions. */
function closestInteriorPoint(room: Room, target: GridPoint, fp: FloorPlan): GridPoint {
  const cellSet = makeCellSet(room.cells);
  const xs = room.cells.map(c => c.x);
  const ys = room.cells.map(c => c.y);
  const x0 = Math.min(...xs) + 1;
  const x1 = Math.max(...xs) + 1;
  const y0 = Math.min(...ys) + 1;
  const y1 = Math.max(...ys) + 1;

  let best: GridPoint = centroid(room.cells); // fallback
  let bestDist = Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!isStrictlyInterior(x, y, cellSet)) continue;
      if (isOnWallOrDoor({ x, y }, fp)) continue;
      const d = manhattanDist({ x, y }, target);
      if (d < bestDist) { bestDist = d; best = { x, y }; }
    }
  }
  return best;
}

// ─── Short-circuit rule ───────────────────────────────────────────────────────

const SHORT_CIRCUIT_MIN = 2;

/** Return grille position that is ≥ SHORT_CIRCUIT_MIN from the supply diffuser
 *  and strictly inside the room (not on any wall). */
function safeReturnPos(supply: GridPoint, room: Room, fp: FloorPlan): GridPoint {
  const cellSet = makeCellSet(room.cells);
  const offsets: [number, number][] = [
    [SHORT_CIRCUIT_MIN, 0], [-SHORT_CIRCUIT_MIN, 0],
    [0, SHORT_CIRCUIT_MIN], [0, -SHORT_CIRCUIT_MIN],
    [SHORT_CIRCUIT_MIN + 1, 0], [-(SHORT_CIRCUIT_MIN + 1), 0],
    [0, SHORT_CIRCUIT_MIN + 1], [0, -(SHORT_CIRCUIT_MIN + 1)],
  ];
  for (const [dx, dy] of offsets) {
    const cand: GridPoint = { x: supply.x + dx, y: supply.y + dy };
    if (isStrictlyInterior(cand.x, cand.y, cellSet) && !isOnWallOrDoor(cand, fp)) {
      return cand;
    }
  }
  // Fallback: scan for any valid interior point at least SHORT_CIRCUIT_MIN away
  return closestInteriorPoint(
    room,
    { x: supply.x - SHORT_CIRCUIT_MIN, y: supply.y },
    fp,
  );
}

// ─── L-shaped Manhattan routing ──────────────────────────────────────────────

function routeSegments(
  from: GridPoint,
  to: GridPoint,
  cfm: number,
  isReturn = false,
): DuctSegment[] {
  const size = autoSizeDuct(cfm);
  const segs: DuctSegment[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) return [];

  if (dx !== 0 && dy !== 0) {
    const corner: GridPoint = { x: to.x, y: from.y };
    segs.push({ id: uid(), start: from, end: corner, size, cfm, layer: 0, isReturn });
    segs.push({ id: uid(), start: corner, end: to,   size, cfm, layer: 0, isReturn });
  } else {
    segs.push({ id: uid(), start: from, end: to, size, cfm, layer: 0, isReturn });
  }
  return segs;
}

// ─── Build optimal duct system ────────────────────────────────────────────────

export function buildOptimalDuctSystem(rooms: Room[], ahu: AHU, fp: FloorPlan): DuctSystem {
  // Phase 1: MST structure from centroids
  const terminals: Terminal[] = [
    { id: 'ahu', point: ahu.supplyPort, cfm: 0 },
    ...rooms.map(r => ({ id: r.id, point: centroid(r.cells), cfm: r.cfm })),
  ];

  const mstEdges = primMST(terminals);

  const adj = new Map<string, string[]>();
  for (const [a, b] of mstEdges) {
    if (!adj.has(a.id)) adj.set(a.id, []);
    if (!adj.has(b.id)) adj.set(b.id, []);
    adj.get(a.id)!.push(b.id);
    adj.get(b.id)!.push(a.id);
  }

  const parent = new Map<string, string>();
  const order: string[] = [];
  const bfsVisited = new Set<string>(['ahu']);
  const bfsQueue: string[] = ['ahu'];
  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!;
    order.push(cur);
    for (const nb of adj.get(cur) ?? []) {
      if (!bfsVisited.has(nb)) {
        bfsVisited.add(nb);
        parent.set(nb, cur);
        bfsQueue.push(nb);
      }
    }
  }

  // Phase 2: Optimal diffuser positions — closest interior point to parent
  const posMap = new Map<string, GridPoint>();
  posMap.set('ahu', ahu.supplyPort);
  for (const id of order) {
    if (id === 'ahu') continue;
    const parentPos = posMap.get(parent.get(id)!)!;
    const room = rooms.find(r => r.id === id)!;
    posMap.set(id, closestInteriorPoint(room, parentPos, fp));
  }

  // Compute subtree CFM (propagated from leaves toward root)
  const termMap = new Map(terminals.map(t => [t.id, t]));
  const subtreeCFM = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const own = termMap.get(id)?.cfm ?? 0;
    const childSum = (adj.get(id) ?? [])
      .filter(nb => parent.get(nb) === id)
      .reduce((s, nb) => s + (subtreeCFM.get(nb) ?? 0), 0);
    subtreeCFM.set(id, own + childSum);
  }

  // Phase 3: Route segments using optimal positions
  const allSegments: DuctSegment[] = [];
  const diffusers: Diffuser[] = [];

  for (const id of order) {
    if (id === 'ahu') continue;
    const parPt  = posMap.get(parent.get(id)!)!;
    const thisPt = posMap.get(id)!;
    const cfm    = subtreeCFM.get(id) ?? 0;

    allSegments.push(...routeSegments(parPt, thisPt, cfm));

    const room = rooms.find(r => r.id === id);
    if (room) {
      diffusers.push({
        id: uid(), position: thisPt, roomId: id,
        size: autoSizeDuct(room.cfm), cfm: room.cfm, isReturn: false,
      });
    }
  }

  // Return system: grille placed ≥ SHORT_CIRCUIT_MIN from supply
  const returnDiffusers: Diffuser[] = [];
  const returnSegments:  DuctSegment[] = [];

  for (const room of rooms) {
    const supplyPt = posMap.get(room.id) ?? centroid(room.cells);
    const retPt    = safeReturnPos(supplyPt, room, fp);
    returnDiffusers.push({
      id: uid(), position: retPt, roomId: room.id,
      size: autoSizeDuct(room.cfm), cfm: room.cfm, isReturn: true,
    });
    returnSegments.push(...routeSegments(retPt, ahu.returnPort, room.cfm, true));
  }

  return {
    segments:    [...allSegments, ...returnSegments],
    transitions: [],
    diffusers:   [...diffusers, ...returnDiffusers],
  };
}

/** Total duct length in grid units (metres) */
export function totalDuctLength(system: DuctSystem): number {
  return system.segments.reduce((s, seg) => s + segLen(seg.start, seg.end), 0);
}
