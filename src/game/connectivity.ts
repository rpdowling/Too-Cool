import type { DuctSystem, DuctSegment, Diffuser, AHU, GridPoint } from '../types';

function ptKey(p: GridPoint): string { return `${p.x},${p.y}`; }

function bfsReachable(segments: DuctSegment[], startPort: GridPoint): Set<string> {
  const adj = new Map<string, GridPoint[]>();
  for (const seg of segments) {
    const ak = ptKey(seg.start);
    const bk = ptKey(seg.end);
    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push(seg.end);
    adj.get(bk)!.push(seg.start);
  }

  const visited = new Set<string>();
  const queue: GridPoint[] = [startPort];
  visited.add(ptKey(startPort));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(ptKey(cur)) ?? []) {
      const nk = ptKey(nb);
      if (!visited.has(nk)) { visited.add(nk); queue.push(nb); }
    }
  }
  return visited;
}

function diffuserServedRooms(diffusers: Diffuser[], reachable: Set<string>): Set<string> {
  const served = new Set<string>();
  for (const d of diffusers) {
    if (reachable.has(ptKey(d.position))) served.add(d.roomId);
  }
  return served;
}

/**
 * Rooms whose supply diffuser is reachable from the AHU supply port via supply ducts.
 */
export function computeSupplyServedRooms(ds: DuctSystem, ahu: AHU): Set<string> {
  const reachable = bfsReachable(ds.segments.filter(s => !s.isReturn), ahu.supplyPort);
  return diffuserServedRooms(ds.diffusers.filter(d => !d.isReturn), reachable);
}

/**
 * Rooms whose return grille is reachable from the AHU return port via return ducts.
 */
export function computeReturnServedRooms(ds: DuctSystem, ahu: AHU): Set<string> {
  const reachable = bfsReachable(ds.segments.filter(s => s.isReturn), ahu.returnPort);
  return diffuserServedRooms(ds.diffusers.filter(d => d.isReturn), reachable);
}

/**
 * Rooms fully served: supply diffuser connected to AHU supply port AND
 * return grille connected to AHU return port — both via continuous duct paths.
 */
export function computeServedRooms(ds: DuctSystem, ahu: AHU): Set<string> {
  const supply = computeSupplyServedRooms(ds, ahu);
  const ret    = computeReturnServedRooms(ds, ahu);
  return new Set([...supply].filter(id => ret.has(id)));
}
