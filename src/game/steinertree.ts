/**
 * Steiner-tree approximation for optimal duct routing.
 *
 * Uses a two-phase approach:
 *   1. Prim's MST on terminal nodes (AHU supply port + room centroids)
 *      to get an initial spanning tree.
 *   2. Grid-based Manhattan routing for each MST edge, with optional
 *      45° diagonals.  The routed tree gives the reference duct system
 *      used for scoring.
 *
 * Output is a DuctSystem whose CFMs are assigned by propagating from
 * leaves back toward the root (AHU).
 */
import type { GridPoint, DuctSystem, DuctSegment, Diffuser, Room, AHU } from '../types';
import { uid, dist, segLen } from './utils';
import { autoSizeDuct } from './ductSizing';

// ─── MST via Prim's algorithm ─────────────────────────────────────────────────

interface Terminal {
  id: string;
  point: GridPoint;
  cfm: number;  // 0 for junction/AHU nodes
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
        const d = dist(t.point, u.point);
        if (d < bestDist) { bestDist = d; best = [t, u]; }
      }
    }
    if (!best) break;
    inTree.add(best[1].id);
    edges.push(best);
  }
  return edges;
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

  // Try horizontal-first L-route
  if (dx !== 0 && dy !== 0) {
    const corner: GridPoint = { x: to.x, y: from.y };
    if (Math.abs(dx) > 0) {
      segs.push({ id: uid(), start: from, end: corner, size, cfm, layer: 0, isReturn });
    }
    if (Math.abs(dy) > 0) {
      segs.push({ id: uid(), start: corner, end: to, size, cfm, layer: 0, isReturn });
    }
  } else {
    segs.push({ id: uid(), start: from, end: to, size, cfm, layer: 0, isReturn });
  }

  return segs;
}

// ─── Build optimal duct system ────────────────────────────────────────────────

export function buildOptimalDuctSystem(rooms: Room[], ahu: AHU): DuctSystem {
  const centroid = (cells: GridPoint[]): GridPoint => {
    const s = cells.reduce((a, c) => ({ x: a.x + c.x + 0.5, y: a.y + c.y + 0.5 }), { x: 0, y: 0 });
    return { x: Math.round(s.x / cells.length * 2) / 2, y: Math.round(s.y / cells.length * 2) / 2 };
  };

  // Terminals: AHU supply port + room centroids
  const terminals: Terminal[] = [
    { id: 'ahu', point: ahu.supplyPort, cfm: 0 },
    ...rooms.map(r => ({ id: r.id, point: centroid(r.cells), cfm: r.cfm })),
  ];

  const mstEdges = primMST(terminals);

  // Build adjacency for CFM propagation
  // (parent is whichever node is closer to AHU in MST)
  type Edge = { from: string; to: string; fromPt: GridPoint; toPt: GridPoint };
  const edgeList: Edge[] = mstEdges.map(([a, b]) => ({
    from: a.id,
    to: b.id,
    fromPt: a.point,
    toPt: b.point,
  }));

  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const e of edgeList) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  // BFS from AHU to determine parent-child relationships
  const parent = new Map<string, string>();
  const order: string[] = [];
  const visited = new Set<string>(['ahu']);
  const queue: string[] = ['ahu'];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nb of (adj.get(cur) ?? [])) {
      if (!visited.has(nb)) {
        visited.add(nb);
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
  }

  // Compute subtree CFM (sum of leaf loads)
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

    const segs = routeSegments(parPt, thisPt, cfm);
    allSegments.push(...segs);

    // Place supply diffuser at room centroid
    if (id !== 'ahu') {
      const room = rooms.find(r => r.id === id);
      if (room) {
        const roomCFM = room.cfm;
        diffusers.push({
          id: uid(),
          position: thisPt,
          roomId: id,
          size: autoSizeDuct(roomCFM),
          cfm: roomCFM,
          isReturn: false,
        });
      }
    }
  }

  // Build return system (mirror: return grilles at same centroids, return duct to AHU return port)
  const returnDiffusers: Diffuser[] = [];
  const returnSegments: DuctSegment[] = [];

  for (const room of rooms) {
    const ctr = centroid(room.cells);
    // Offset slightly to avoid overlap with supply
    const retPt: GridPoint = { x: ctr.x + 0.5, y: ctr.y };
    returnDiffusers.push({
      id: uid(),
      position: retPt,
      roomId: room.id,
      size: autoSizeDuct(room.cfm),
      cfm: room.cfm,
      isReturn: true,
    });
    const retSegs = routeSegments(retPt, ahu.returnPort, room.cfm, true);
    returnSegments.push(...retSegs);
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
