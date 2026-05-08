/**
 * Primitive HVAC cooling load calculation (ASHRAE simplified envelope method).
 * Outputs CFM per room based on envelope heat gains.
 */
import type { FloorPlan, Room, WallSegment, WindowSegment, DoorSegment, GridPoint } from '../types';
import { segLen } from './utils';

// ─── Material R-values & properties ──────────────────────────────────────────

const R = { wallNormal: 13, wallThick: 21, window: 3, door: 5, ceiling: 30 };
const SHGC = 0.40;          // solar heat gain coefficient (double-pane, tinted)
const CEILING_FT = 9;       // ft
const M_TO_FT = 3.28084;
const M2_TO_FT2 = M_TO_FT * M_TO_FT;

// CLTD (cooling load temp diff) per surface type °F
const CLTD = { wall: 20, window: 15, door: 15, ceiling: 50 };

// Peak solar irradiance by wall orientation (BTU/hr·ft²)
const SOLAR: Record<string, number> = {
  N: 30, S: 200, E: 150, W: 150,
  NE: 90, NW: 90, SE: 175, SW: 175,
};

// Supply air conditions
const T_ROOM = 72;   // °F
const T_SUPPLY = 55; // °F
const DT_SA = T_ROOM - T_SUPPLY; // 17°F

function uVal(r: number) { return 1 / r; }

// Determine wall face orientation from wall-normal direction
// A horizontal wall (dy=0) can face N (y-normal negative in screen coords = top = north)
// or S. We infer from whether the room is above or below the wall.
// Since we don't store which side the room is on in WallSegment, we use a heuristic:
// the wall normal 90° CCW from the segment direction points into the room.
function wallOrientation(seg: { start: GridPoint; end: GridPoint }, roomCentroid: GridPoint): string {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  // Normal pointing left of travel direction (CCW) = (-dy, dx)
  // Check if room centroid is on that side
  const mx = (seg.start.x + seg.end.x) / 2;
  const my = (seg.start.y + seg.end.y) / 2;
  const toCentroid = { x: roomCentroid.x - mx, y: roomCentroid.y - my };
  const normalLeft = { x: -dy, y: dx };
  const dot = toCentroid.x * normalLeft.x + toCentroid.y * normalLeft.y;
  // "into room" normal — the exterior faces away from room
  const extNx = dot < 0 ? -normalLeft.x : normalLeft.x;
  const extNy = dot < 0 ? -normalLeft.y : normalLeft.y;

  // Classify exterior normal into compass direction
  const angle = Math.atan2(extNy, extNx) * (180 / Math.PI);
  // In canvas coords Y increases downward, so:
  // angle 0 = east, 90 = south, -90 = north, ±180 = west
  if (angle > -22.5 && angle <= 22.5) return 'E';
  if (angle > 22.5 && angle <= 67.5) return 'SE';
  if (angle > 67.5 && angle <= 112.5) return 'S';
  if (angle > 112.5 && angle <= 157.5) return 'SW';
  if (angle > 157.5 || angle <= -157.5) return 'W';
  if (angle > -157.5 && angle <= -112.5) return 'NW';
  if (angle > -112.5 && angle <= -67.5) return 'N';
  return 'NE';
}

function roomCentroid(cells: GridPoint[]): GridPoint {
  const sum = cells.reduce((a, c) => ({ x: a.x + c.x + 0.5, y: a.y + c.y + 0.5 }), { x: 0, y: 0 });
  return { x: sum.x / cells.length, y: sum.y / cells.length };
}

// ─── Per-room load calculation ────────────────────────────────────────────────

export function calcRoomLoad(
  room: Pick<Room, 'cells' | 'wallIds' | 'windowIds' | 'doorIds'>,
  fp: FloorPlan,
): { btuh: number; cfm: number } {
  const centroid = roomCentroid(room.cells);
  let btuh = 0;

  // ── Walls (exterior only, per WallSegment.isExterior) ──
  for (const wid of room.wallIds) {
    const seg = fp.walls.find(w => w.id === wid);
    if (!seg || !seg.isExterior) continue;
    const lenM = segLen(seg.start, seg.end);
    const areaFt2 = lenM * M_TO_FT * CEILING_FT;
    const rVal = seg.wallType === 'thick' ? R.wallThick : R.wallNormal;
    btuh += uVal(rVal) * areaFt2 * CLTD.wall;
  }

  // ── Windows ──
  for (const wid of room.windowIds) {
    const seg = fp.windows.find(w => w.id === wid);
    if (!seg) continue;
    const lenM = segLen(seg.start, seg.end);
    const areaFt2 = lenM * M_TO_FT * 4; // assume 4 ft window height
    const orient = wallOrientation(seg, centroid);
    // Conduction
    btuh += uVal(R.window) * areaFt2 * CLTD.window;
    // Solar
    btuh += SHGC * areaFt2 * (SOLAR[orient] ?? 100);
  }

  // ── Exterior doors ──
  for (const did of room.doorIds) {
    const seg = fp.doors.find(d => d.id === did);
    if (!seg || !seg.isExterior) continue;
    const lenM = segLen(seg.start, seg.end);
    const areaFt2 = lenM * M_TO_FT * 7; // 7 ft door height
    btuh += uVal(R.door) * areaFt2 * CLTD.door;
  }

  // ── Ceiling ──
  const floorAreaFt2 = room.cells.length * M2_TO_FT2; // each cell = 1 m²
  btuh += uVal(R.ceiling) * floorAreaFt2 * CLTD.ceiling;

  // ── Internal gains (lighting + people) ──
  btuh += 0.75 * 3.41214 * floorAreaFt2;          // 0.75 W/ft² lighting
  const occupants = Math.max(1, Math.floor(room.cells.length / 10));
  btuh += occupants * 250;                          // 250 BTU/hr/person

  const cfm = btuh / (1.1 * DT_SA);
  return { btuh: Math.round(btuh), cfm: Math.round(cfm) };
}

// ─── Full floorplan load ──────────────────────────────────────────────────────

export function calcFloorplanLoads(rooms: Room[], fp: FloorPlan): Room[] {
  let maxCFM = 0;
  const withLoads = rooms.map(room => {
    const { btuh, cfm } = calcRoomLoad(room, fp);
    if (cfm > maxCFM) maxCFM = cfm;
    return { ...room, btuh, cfm };
  });
  // Assign heat colors relative to max load room
  return withLoads.map(room => ({
    ...room,
    color: heatColor(room.cfm / Math.max(1, maxCFM)),
  }));
}

function heatColor(t: number): string {
  const hue = (1 - Math.max(0, Math.min(1, t))) * 220;
  return `hsla(${hue.toFixed(1)}, 85%, 55%, 0.28)`;
}

export function totalCFM(rooms: Room[]): number {
  return rooms.reduce((s, r) => s + r.cfm, 0);
}
