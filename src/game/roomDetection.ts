/**
 * Room detection via flood-fill on a grid-edge wall graph.
 *
 * Walls live on grid edges between cells.  We flood-fill from outside the
 * bounding box.  Any cell not reached is interior.  Each connected interior
 * component = one room.
 *
 * Limitations: diagonal walls are treated as opaque but only block the two
 * cells they straddle (approximated as both half-cells).
 */
import type { FloorPlan, Room, WallSegment, GridPoint } from '../types';
import { uid } from './utils';

// ─── Edge encoding ────────────────────────────────────────────────────────────

// A horizontal edge between cell (cx, cy-1) and cell (cx, cy) → key `h:cx,cy`
// A vertical edge between cell (cx-1, cy) and cell (cx, cy)  → key `v:cx,cy`

function hEdgeKey(cx: number, cy: number) { return `h:${cx},${cy}`; }
function vEdgeKey(cx: number, cy: number) { return `v:${cx},${cy}`; }

/** Build a set of blocked edges from wall segments */
function buildEdgeSet(walls: WallSegment[], doors: FloorPlan['doors']): Set<string> {
  const blocked = new Set<string>();

  for (const w of walls) {
    addEdgesForSegment(w.start, w.end, blocked);
  }
  // Doors create openings — we subtract them (not added to blocked set)
  // Walls with doors are split in the level data, so doors don't overlap walls

  return blocked;
}

function addEdgesForSegment(a: GridPoint, b: GridPoint, out: Set<string>) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dx === 0) {
    // Vertical line segment (x constant) — vertical edges between cells
    const x = a.x;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (let y = minY; y < maxY; y++) {
      out.add(vEdgeKey(x, y));  // edge between cell (x-1,y) and cell (x,y)
    }
  } else if (dy === 0) {
    // Horizontal line segment (y constant) — horizontal edges between cells
    const y = a.y;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    for (let x = minX; x < maxX; x++) {
      out.add(hEdgeKey(x, y));  // edge between cell (x,y-1) and cell (x,y)
    }
  } else if (Math.abs(dx) === Math.abs(dy)) {
    // 45° diagonal — block both horizontal and vertical edges along path
    const steps = Math.abs(dx);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    for (let i = 0; i < steps; i++) {
      const cx = a.x + i * sx;
      const cy = a.y + i * sy;
      // Diagonal creates an impassable barrier; block both cross-edges
      out.add(hEdgeKey(cx, cy + (sy > 0 ? 0 : 1)));
      out.add(vEdgeKey(cx + (sx > 0 ? 0 : 1), cy));
    }
  }
}

// ─── Flood fill ───────────────────────────────────────────────────────────────

/** Returns a 2D map (cell key → boolean) of cells reachable from outside */
function floodFillOutside(
  walls: WallSegment[],
  doors: FloorPlan['doors'],
  maxX: number,
  maxY: number,
): Set<string> {
  const blocked = buildEdgeSet(walls, doors);
  const visited = new Set<string>();

  function key(x: number, y: number) { return `${x},${y}`; }

  function canMove(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx === 1 && dy === 0) return !blocked.has(vEdgeKey(toX, fromY));
    if (dx === -1 && dy === 0) return !blocked.has(vEdgeKey(fromX, fromY));
    if (dx === 0 && dy === 1) return !blocked.has(hEdgeKey(fromX, toY));
    if (dx === 0 && dy === -1) return !blocked.has(hEdgeKey(fromX, fromY));
    return false;
  }

  const queue: Array<[number, number]> = [[-1, -1]];
  visited.add(key(-1, -1));

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < -1 || ny < -1 || nx > maxX + 1 || ny > maxY + 1) continue;
      if (visited.has(key(nx, ny))) continue;
      if (!canMove(cx, cy, nx, ny)) continue;
      visited.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }

  return visited;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect enclosed rooms from the given floor plan.
 * Returns Room objects with cells, area, and associated element IDs.
 * Load (btuh/cfm/color) is left at 0 — call calcFloorplanLoads() afterwards.
 */
export function detectRooms(fp: FloorPlan): Room[] {
  const maxX = fp.gridWidth;
  const maxY = fp.gridHeight;

  const outside = floodFillOutside(fp.walls, fp.doors, maxX, maxY);

  // Find all interior cells
  const interior = new Set<string>();
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < maxX; x++) {
      if (!outside.has(`${x},${y}`)) interior.add(`${x},${y}`);
    }
  }

  // Connected components of interior cells = rooms
  const visited = new Set<string>();
  const rooms: Room[] = [];

  for (const cellKey of interior) {
    if (visited.has(cellKey)) continue;
    const [cx, cy] = cellKey.split(',').map(Number);
    const component: GridPoint[] = [];
    const queue: Array<[number, number]> = [[cx, cy]];
    visited.add(cellKey);

    while (queue.length > 0) {
      const [qx, qy] = queue.shift()!;
      component.push({ x: qx, y: qy });
      for (const [nx, ny] of [[qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]]) {
        const nk = `${nx},${ny}`;
        if (!interior.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        queue.push([nx, ny]);
      }
    }

    // Find walls, windows, doors bordering this component
    const cellSet = new Set(component.map(c => `${c.x},${c.y}`));

    const wallIds = fp.walls
      .filter(w => segmentBordersRoom(w.start, w.end, cellSet))
      .map(w => w.id);

    const windowIds = fp.windows
      .filter(w => segmentBordersRoom(w.start, w.end, cellSet))
      .map(w => w.id);

    const doorIds = fp.doors
      .filter(d => segmentBordersRoom(d.start, d.end, cellSet))
      .map(d => d.id);

    rooms.push({
      id: uid(),
      cells: component,
      area: component.length,
      btuh: 0,
      cfm: 0,
      color: 'hsla(220, 85%, 55%, 0.28)',
      wallIds,
      windowIds,
      doorIds,
    });
  }

  return rooms;
}

/** True if a segment's edge lies on the boundary of any cell in the set */
function segmentBordersRoom(a: GridPoint, b: GridPoint, cells: Set<string>): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dy === 0) {
    // Horizontal segment at y=b.y — borders cells at (x, y-1) and (x, y)
    const y = a.y;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    for (let x = minX; x < maxX; x++) {
      if (cells.has(`${x},${y}`) || cells.has(`${x},${y - 1}`)) return true;
    }
  } else if (dx === 0) {
    // Vertical segment at x=a.x
    const x = a.x;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (let y = minY; y < maxY; y++) {
      if (cells.has(`${x},${y}`) || cells.has(`${x - 1},${y}`)) return true;
    }
  } else {
    // Diagonal — check cells along the diagonal path
    const steps = Math.abs(dx);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    for (let i = 0; i < steps; i++) {
      const cx = Math.min(a.x, b.x) + i * Math.abs(sx);
      const cy = Math.min(a.y, b.y) + i * Math.abs(sy);
      if (cells.has(`${cx},${cy}`)) return true;
    }
  }
  return false;
}

/** Validate floorplan before play / save */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateFloorplan(fp: FloorPlan, rooms: Room[]): ValidationResult {
  const errors: string[] = [];

  if (rooms.length === 0) errors.push('No enclosed rooms detected.');

  for (const room of rooms) {
    if (room.area < 9) errors.push(`Room is too small (< 3×3 m²).`);
    if (room.doorIds.length === 0) errors.push(`A room has no door access.`);
  }

  const exteriorDoors = fp.doors.filter(d => d.isExterior);
  if (exteriorDoors.length === 0) errors.push('No exterior door — add at least one entry.');

  return { valid: errors.length === 0, errors };
}
