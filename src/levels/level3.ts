/**
 * Level 3 – "Glass Corridor"
 *
 * A dumbbell-shaped 14 × 6 m building:
 *
 *   ┌──────────┐                    ┌──────────┐
 *   │          │  ╔══════════════╗  │          │
 *   │  Room A  ╠══╣ Glass Hall  ╠══╣  Room B  │
 *   │  (4×6)   │  ║   (6×2)    ║  │  (4×6)   │
 *   └──────────┘  ╚══════════════╝  └──────────┘
 *
 * ══ = window (hallway north & south walls are fully glazed)
 *
 * Room A (left) — x=0–3, y=0–5 — north window + south door
 * Hallway (centre) — x=4–9, y=2–3 — north & south glass exterior
 * Room B (right) — x=10–13, y=0–5 — north window + south door
 *
 * The south-facing hallway glass carries 200 BTU/hr·ft² solar — hottest zone.
 * AHU sits south of Room A; optimal trunk: Room A → corridor → Room B.
 */
import type { Level, FloorPlan, AHU, Room, DuctSystem } from '../types';
import { calcFloorplanLoads, totalCFM } from '../game/loadCalc';
import { detectRooms } from '../game/roomDetection';
import { buildOptimalDuctSystem, totalDuctLength } from '../game/steinertree';

// ─── Floor plan ───────────────────────────────────────────────────────────────

const fp: FloorPlan = {
  gridWidth:  14,
  gridHeight: 6,

  walls: [
    // Room A – north exterior wall (split around 2 m window at x=2–4)
    { id: 'w-an1', start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, wallType: 'normal', isExterior: true },
    // Room A – south exterior wall (split around 1 m door at x=1–2)
    { id: 'w-as1', start: { x: 0, y: 6 }, end: { x: 1, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-as2', start: { x: 2, y: 6 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: true },
    // West exterior wall
    { id: 'w-w',   start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    // Interior wall Room A ↔ Hallway (x=4), split around 2 m doorway at y=2–4
    { id: 'w-ah1', start: { x: 4, y: 0 }, end: { x: 4, y: 2 }, wallType: 'normal', isExterior: false },
    { id: 'w-ah2', start: { x: 4, y: 4 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: false },
    // Interior wall Hallway ↔ Room B (x=10), split around 2 m doorway at y=2–4
    { id: 'w-hb1', start: { x: 10, y: 0 }, end: { x: 10, y: 2 }, wallType: 'normal', isExterior: false },
    { id: 'w-hb2', start: { x: 10, y: 4 }, end: { x: 10, y: 6 }, wallType: 'normal', isExterior: false },
    // Room B – north exterior wall (split around 2 m window at x=12–14)
    { id: 'w-bn1', start: { x: 10, y: 0 }, end: { x: 12, y: 0 }, wallType: 'normal', isExterior: true },
    // Room B – south exterior wall (split around 1 m door at x=12–13)
    { id: 'w-bs1', start: { x: 10, y: 6 }, end: { x: 12, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-bs2', start: { x: 13, y: 6 }, end: { x: 14, y: 6 }, wallType: 'normal', isExterior: true },
    // East exterior wall
    { id: 'w-e',   start: { x: 14, y: 0 }, end: { x: 14, y: 6 }, wallType: 'normal', isExterior: true },
  ],

  windows: [
    // Room A – north window (2 m)
    { id: 'win-a',  start: { x: 2,  y: 0 }, end: { x: 4,  y: 0 } },
    // Hallway – north exterior glass (6 m, faces north, low solar 30)
    { id: 'win-hn', start: { x: 4,  y: 2 }, end: { x: 10, y: 2 } },
    // Hallway – south exterior glass (6 m, faces south, max solar 200)
    { id: 'win-hs', start: { x: 4,  y: 4 }, end: { x: 10, y: 4 } },
    // Room B – north window (2 m)
    { id: 'win-b',  start: { x: 12, y: 0 }, end: { x: 14, y: 0 } },
  ],

  doors: [
    // Room A – south exterior door (1 m, x=1–2)
    { id: 'door-a',  start: { x: 1,  y: 6 }, end: { x: 2,  y: 6 }, isExterior: true },
    // Room B – south exterior door (1 m, x=12–13)
    { id: 'door-b',  start: { x: 12, y: 6 }, end: { x: 13, y: 6 }, isExterior: true },
    // Interior doorway: Room A ↔ Hallway (2 m, y=2–4)
    { id: 'door-ah', start: { x: 4,  y: 2 }, end: { x: 4,  y: 4 }, isExterior: false },
    // Interior doorway: Hallway ↔ Room B (2 m, y=2–4)
    { id: 'door-hb', start: { x: 10, y: 2 }, end: { x: 10, y: 4 }, isExterior: false },
  ],

  vents: [],
};

// ─── AHU ──────────────────────────────────────────────────────────────────────

// South of Room A — supply trunk runs east through the corridor to Room B.
const ahu: AHU = {
  position:   { x: 1, y: 7 },
  totalCFM:   0,
  supplyPort: { x: 2, y: 7 },
  returnPort: { x: 3, y: 7 },
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
    description: 'Two large rooms connected by a long glass hallway — the south-facing corridor glass cranks up the hallway load. Route your trunk east through the corridor and branch into each room.',
    floorplan: fp,
    ahu: ahuFinal,
    rooms,
    totalCFM: total,
    optimalDuctSystem: optimal,
    optimalLength: optLen,
  };
}

export const level3: Level = buildLevel();
