import type { DuctSystem, AHU, GridPoint } from '../types';

function ptKey(p: GridPoint): string { return `${p.x},${p.y}`; }

/**
 * BFS from the AHU supply port through supply duct segments.
 * Returns the set of room IDs whose supply diffuser is reachable from the AHU.
 * A diffuser is "connected" only if a continuous supply duct path exists.
 */
export function computeServedRooms(ds: DuctSystem, ahu: AHU): Set<string> {
  const adj = new Map<string, GridPoint[]>();
  for (const seg of ds.segments) {
    if (seg.isReturn) continue;
    const ak = ptKey(seg.start);
    const bk = ptKey(seg.end);
    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push(seg.end);
    adj.get(bk)!.push(seg.start);
  }

  const visited = new Set<string>();
  const queue: GridPoint[] = [ahu.supplyPort];
  visited.add(ptKey(ahu.supplyPort));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(ptKey(cur)) ?? []) {
      const nk = ptKey(nb);
      if (!visited.has(nk)) {
        visited.add(nk);
        queue.push(nb);
      }
    }
  }

  const served = new Set<string>();
  for (const diff of ds.diffusers) {
    if (!diff.isReturn && visited.has(ptKey(diff.position))) {
      served.add(diff.roomId);
    }
  }
  return served;
}
