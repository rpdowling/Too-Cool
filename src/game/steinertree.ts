/**
 * Steiner-tree approximation for optimal duct routing.
 *
 * Uses a two-phase approach:
 *   1. Prim's MST on terminal nodes (AHU supply port + room centroids)
 *      using Manhattan distance, which matches the actual L-shaped routing cost.
 *   2. Grid-based L-shaped Manhattan routing for each MST edge.
 *
 * Short-circuit rule: return grilles are placed at least 2 grid units from
 * the supply diffuser so supply air isn't immediately sucked back by the return.
 */
import type { GridPoint, DuctSystem, DuctSegment, Diffuser, Room, AHU } from '../types';
import { uid, segLen } from './utils';
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

// ─── Short-circuit rule ───────────────────────────────────────────────────────

const SHORT_CIRCUIT_MIN = 2;

/** Return a position for the return grille that is ≥ SHORT_CIRCUIT_MIN grid
 *  units from the supply diffuser and inside the room's cell footprint. */
function safeReturnPos(supply: GridPoint, cells: GridPoint[]): GridPoint {
  const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
  const offsets: [number, number][] = [
    [SHORT_CIRCUIT_MIN, 0], [-SHORT_CIRCUIT_MIN, 0],
    [0, SHORT_CIRCUIT_MIN], [0, -SHORT_CIRCUIT_MIN],
    [SHORT_CIRCUIT_MIN + 1, 0], [-(SHORT_CIRCUIT_MIN + 1), 0],
    [0, SHORT_CIRCUIT_MIN + 1], [0, -(SHORT_CIRCUIT_MIN + 1)],
  ];
  for (const [dx, dy] of offsets) {
    const cand: GridPoint = { x: supply.x + dx, y: supply.y + dy };
    if (cellSet.has(`${Math.floor(cand.x)},${Math.floor(cand.y)}`)) return cand;
  }
  return { x: supply.x + 1, y: supply.y };
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

export function buildOptimalDuctSystem(rooms: Room[], ahu: AHU): DuctSystem {
  const centroid = (cells: GridPoint[]): GridPoint => {
    const cx = cells.reduce((s, c) => s + c.x + 0.5, 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c.y + 0.5, 0) / cells.length;
    return { x: Math.round(cx), y: Math.round(cy) };
  };

  const terminals: Terminal[] = [
    { id: 'ahu', point: ahu.supplyPort, cfm: 0 },
    ...rooms.map(r => ({ id: r.id, point: centroid(r.cells), cfm: r.cfm })),
  ];

  const mstEdges = primMST(terminals);

  type Edge = { from: string; to: string; fromPt: GridPoint; toPt: GridPoint };
  const edgeList: Edge[] = mstEdges.map(([a, b]) => ({
    from: a.id, to: b.id, fromPt: a.point, toPt: b.point,
  }));

  const adj = new Map<string, string[]>();
  for (const e of edgeList) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to))   adj.set(e.to,   []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
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

  const termMap = new Map(terminals.map(t => [t.id, t]));
  const subtreeCFM = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const own = termMap.get(id)?.cfm ?? 0;
    const childSum = (adj.get(id) ?? [])
      .filter(nb => parent.get(nb) === id)
      .reduce((s, nb) => s + (subtreeCFM.get(nb) ?? 0), 0);
    subtreeCFM.set(id, own + childSum);
  }

  const allSegments: DuctSegment[] = [];
  const diffusers: Diffuser[] = [];

  for (const id of order) {
    if (id === 'ahu') continue;
    const par = parent.get(id)!;
    const parPt = termMap.get(par)!.point;
    const thisPt = termMap.get(id)!.point;
    const cfm = subtreeCFM.get(id) ?? 0;

    allSegments.push(...routeSegments(parPt, thisPt, cfm));

    const room = rooms.find(r => r.id === id);
    if (room) {
      diffusers.push({
        id: uid(),
        position: thisPt,
        roomId: id,
        size: autoSizeDuct(room.cfm),
        cfm: room.cfm,
        isReturn: false,
      });
    }
  }

  // Return system: return grille placed ≥ SHORT_CIRCUIT_MIN from supply
  const returnDiffusers: Diffuser[] = [];
  const returnSegments: DuctSegment[] = [];

  for (const room of rooms) {
    const ctr = centroid(room.cells);
    const retPt = safeReturnPos(ctr, room.cells);
    returnDiffusers.push({
      id: uid(),
      position: retPt,
      roomId: room.id,
      size: autoSizeDuct(room.cfm),
      cfm: room.cfm,
      isReturn: true,
    });
    returnSegments.push(...routeSegments(retPt, ahu.returnPort, room.cfm, true));
  }

  return {
    segments: [...allSegments, ...returnSegments],
    transitions: [],
    diffusers: [...diffusers, ...returnDiffusers],
  };
}

/** Total duct length in grid units (metres) */
export function totalDuctLength(system: DuctSystem): number {
  return system.segments.reduce((s, seg) => s + segLen(seg.start, seg.end), 0);
}
