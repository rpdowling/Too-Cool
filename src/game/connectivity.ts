import type { DuctSystem, DuctSegment, Diffuser, AHU, GridPoint, Room } from '../types';

function ptKey(p: GridPoint): string { return `${p.x},${p.y}`; }

/** All integer grid points along an orthogonal segment, inclusive of both ends.
 *  For diagonal segments (shouldn't occur in normal play) returns just endpoints. */
function pointsAlongSegment(a: GridPoint, b: GridPoint): GridPoint[] {
  const ddx = b.x - a.x;
  const ddy = b.y - a.y;
  if (ddx !== 0 && ddy !== 0) return [a, b]; // diagonal — use endpoints only
  const pts: GridPoint[] = [a];
  const dx = Math.sign(ddx);
  const dy = Math.sign(ddy);
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    x += dx;
    y += dy;
    pts.push({ x, y });
  }
  return pts;
}

function bfsReachable(segments: DuctSegment[], startPort: GridPoint): Set<string> {
  const adj = new Map<string, GridPoint[]>();

  function link(a: GridPoint, b: GridPoint) {
    const ak = ptKey(a), bk = ptKey(b);
    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push(b);
    adj.get(bk)!.push(a);
  }

  for (const seg of segments) {
    const pts = pointsAlongSegment(seg.start, seg.end);
    for (let i = 0; i < pts.length - 1; i++) link(pts[i], pts[i + 1]);
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

/** Grid point (px,py) is a corner of any of the four adjacent cells in this room. */
function pointTouchesRoom(px: number, py: number, room: Room): boolean {
  return room.cells.some(c =>
    (c.x === px     && c.y === py    ) ||
    (c.x === px - 1 && c.y === py    ) ||
    (c.x === px     && c.y === py - 1) ||
    (c.x === px - 1 && c.y === py - 1)
  );
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
 * Accepts either an exact endpoint match or any reachable point that touches the room
 * (handles cases where the player's duct ends near but not exactly at the diffuser).
 */
export function computeReturnServedRooms(ds: DuctSystem, ahu: AHU, rooms: Room[]): Set<string> {
  const reachable = bfsReachable(ds.segments.filter(s => s.isReturn), ahu.returnPort);
  const served = new Set<string>();
  for (const d of ds.diffusers.filter(d => d.isReturn)) {
    if (reachable.has(ptKey(d.position))) { served.add(d.roomId); continue; }
    const room = rooms.find(r => r.id === d.roomId);
    if (!room) continue;
    for (const ptk of reachable) {
      const comma = ptk.indexOf(',');
      const px = Number(ptk.slice(0, comma));
      const py = Number(ptk.slice(comma + 1));
      if (pointTouchesRoom(px, py, room)) { served.add(d.roomId); break; }
    }
  }
  return served;
}

/**
 * Rooms fully served: supply diffuser connected to AHU supply port AND
 * return grille connected to AHU return port — both via continuous duct paths.
 */
export function computeServedRooms(ds: DuctSystem, ahu: AHU, rooms: Room[]): Set<string> {
  const supply = computeSupplyServedRooms(ds, ahu);
  const ret    = computeReturnServedRooms(ds, ahu, rooms);
  return new Set([...supply].filter(id => ret.has(id)));
}
