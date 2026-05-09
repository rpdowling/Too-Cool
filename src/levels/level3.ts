/**
 * Level 3 – "Glass Corridor"
 *
 * An 8 × 8 m building arranged in three horizontal bands:
 *
 *   ┌──┬──────────────────────────────────┬──┐  y=0
 *   │  │       Room A  (8 × 3 m)          │  │
 *   │  │       north window + door        │  │
 *   ├──╤══════════════════════════════╤───┤  y=3  (glass + door between A & hall)
 *   │  │   Glass Hallway  (8 × 2 m)  │   │
 *   ├──╧══════════════════════════════╧───┤  y=5  (glass + door between hall & B)
 *   │  │       Room B  (8 × 3 m)          │  │
 *   │  │       south window + door (high  │  │
 *   └──┴──────────────────────────────────┴──┘  y=8   solar load on Room B!)
 *
 * AHU south of building at x=3–5, supply trunk runs straight north
 * through Room B → hallway → Room A.
 */
import type { Level, FloorPlan, AHU, Room, DuctSystem } from '../types';
import { calcFloorplanLoads, totalCFM } from '../game/loadCalc';
import { detectRooms } from '../game/roomDetection';
import { buildOptimalDuctSystem, totalDuctLength } from '../game/steinertree';

// ─── Floor plan ───────────────────────────────────────────────────────────────

const fp: FloorPlan = {
  gridWidth:  8,
  gridHeight: 8,

  walls: [
    // North exterior wall (Room A) — split around door at x=1–2 and window at x=2–6
    { id: 'w-n1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-n2', start: { x: 6, y: 0 }, end: { x: 8, y: 0 }, wallType: 'normal', isExterior: true },
    // South exterior wall (Room B) — split around door at x=2–3 and window at x=5–8
    { id: 'w-s1', start: { x: 0, y: 8 }, end: { x: 2, y: 8 }, wallType: 'normal', isExterior: true },
    { id: 'w-s2', start: { x: 3, y: 8 }, end: { x: 5, y: 8 }, wallType: 'normal', isExterior: true },
    // West and east exterior walls
    { id: 'w-w',  start: { x: 0, y: 0 }, end: { x: 0, y: 8 }, wallType: 'normal', isExterior: true },
    { id: 'w-e',  start: { x: 8, y: 0 }, end: { x: 8, y: 8 }, wallType: 'normal', isExterior: true },
    // Interior wall Room A ↔ Hallway at y=3 (flanking the glass and door)
    { id: 'w-ah1', start: { x: 0, y: 3 }, end: { x: 2, y: 3 }, wallType: 'normal', isExterior: false },
    { id: 'w-ah2', start: { x: 7, y: 3 }, end: { x: 8, y: 3 }, wallType: 'normal', isExterior: false },
    // Interior wall Hallway ↔ Room B at y=5 (flanking the glass and door)
    { id: 'w-hb1', start: { x: 0, y: 5 }, end: { x: 1, y: 5 }, wallType: 'normal', isExterior: false },
    { id: 'w-hb2', start: { x: 6, y: 5 }, end: { x: 8, y: 5 }, wallType: 'normal', isExterior: false },
  ],

  windows: [
    // Room A – north exterior window (4 m, x=2–6, faces north — low solar)
    { id: 'win-a',  start: { x: 2, y: 0 }, end: { x: 6, y: 0 } },
    // Hallway north glass (between Room A and Hallway, 4 m)
    { id: 'win-hn', start: { x: 2, y: 3 }, end: { x: 6, y: 3 } },
    // Hallway south glass (between Hallway and Room B, 4 m)
    { id: 'win-hs', start: { x: 2, y: 5 }, end: { x: 6, y: 5 } },
    // Room B – south exterior window (3 m, x=5–8, faces south — max solar 200 BTU/hr·ft²)
    { id: 'win-b',  start: { x: 5, y: 8 }, end: { x: 8, y: 8 } },
  ],

  doors: [
    // Room A – north exterior door (x=1–2)
    { id: 'door-a',  start: { x: 1, y: 0 }, end: { x: 2, y: 0 }, isExterior: true },
    // Room B – south exterior door (x=2–3)
    { id: 'door-b',  start: { x: 2, y: 8 }, end: { x: 3, y: 8 }, isExterior: true },
    // Interior doorway: Room A ↔ Hallway at y=3, x=6–7
    { id: 'door-ah', start: { x: 6, y: 3 }, end: { x: 7, y: 3 }, isExterior: false },
    // Interior doorway: Hallway ↔ Room B at y=5, x=1–2
    { id: 'door-hb', start: { x: 1, y: 5 }, end: { x: 2, y: 5 }, isExterior: false },
  ],

  vents: [],
};

// ─── AHU ──────────────────────────────────────────────────────────────────────

// Centred below Room B; supply trunk runs straight north through all three zones.
const ahu: AHU = {
  position:   { x: 3, y: 9 },
  totalCFM:   0,
  supplyPort: { x: 4, y: 9 },
  returnPort: { x: 5, y: 9 },
};

// ─── Build level ──────────────────────────────────────────────────────────────

function buildLevel(): Level {
  const rawRooms = detectRooms(fp);
  const rooms: Room[] = calcFloorplanLoads(rawRooms, fp);
  const total = totalCFM(rooms);
  const ahuFinal: AHU = { ...ahu, totalCFM: total };
  const optimal: DuctSystem = buildOptimalDuctSystem(rooms, ahuFinal, fp);
  const optLen = totalDuctLength(optimal);

  return {
    id: 3,
    name: 'Glass Corridor',
    description: 'Two rooms stacked above and below a wide glass hallway — the south-facing window in Room B drives a heavy cooling load. Route a vertical trunk from the AHU through all three zones.',
    floorplan: fp,
    ahu: ahuFinal,
    rooms,
    totalCFM: total,
    optimalDuctSystem: optimal,
    optimalLength: optLen,
  };
}

export const level3: Level = buildLevel();
