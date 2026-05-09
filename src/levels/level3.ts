/**
 * Level 3 – "Glass Corridor"
 *
 * An 8 × 6 m building: two solid rooms flanking a 2 m glass hallway.
 *
 *   ┌────────┬════╤════╤════┬────────┐  y=0
 *   │        ║         ║             │
 *   │  Room A║  Hallway║   Room B    │
 *   │  (3×6) ║  (2×6)  ║    (3×6)   │
 *   │        ║  glass  ║             │
 *   └───┬────╧════╤════╧────┬────────┘  y=6
 *        door    glass      door
 *
 *  ═ = window segment (north & south hallway walls fully glazed)
 *  Interior walls at x=3 (with 2 m doorway y=2–4) and x=5 (same).
 *
 * Load characteristics:
 *   – Hallway: full south glass wall → very high solar gain → hottest zone
 *   – Room A / B: one north window each + exterior door on south
 *
 * Optimal route: trunk from AHU up to hallway, then branch west to A and east to B.
 */
import type { Level, FloorPlan, AHU, Room, DuctSystem } from '../types';
import { calcFloorplanLoads, totalCFM } from '../game/loadCalc';
import { detectRooms } from '../game/roomDetection';
import { buildOptimalDuctSystem, totalDuctLength } from '../game/steinertree';

// ─── Floor plan ───────────────────────────────────────────────────────────────

const fp: FloorPlan = {
  gridWidth:  8,
  gridHeight: 6,

  walls: [
    // North wall – Room A (split around 1 m window at x=1–2)
    { id: 'w-an1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-an2', start: { x: 2, y: 0 }, end: { x: 3, y: 0 }, wallType: 'normal', isExterior: true },
    // North wall – Room B (split around 1 m window at x=6–7)
    { id: 'w-bn1', start: { x: 5, y: 0 }, end: { x: 6, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-bn2', start: { x: 7, y: 0 }, end: { x: 8, y: 0 }, wallType: 'normal', isExterior: true },
    // West wall
    { id: 'w-w',   start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    // East wall
    { id: 'w-e',   start: { x: 8, y: 0 }, end: { x: 8, y: 6 }, wallType: 'normal', isExterior: true },
    // South wall – Room A (split around 1 m door at x=1–2)
    { id: 'w-as1', start: { x: 0, y: 6 }, end: { x: 1, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-as2', start: { x: 2, y: 6 }, end: { x: 3, y: 6 }, wallType: 'normal', isExterior: true },
    // South wall – Room B (split around 1 m door at x=6–7)
    { id: 'w-bs1', start: { x: 5, y: 6 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-bs2', start: { x: 7, y: 6 }, end: { x: 8, y: 6 }, wallType: 'normal', isExterior: true },
    // Interior wall: Room A ↔ Hallway at x=3 (doorway y=2–4)
    { id: 'w-ah1', start: { x: 3, y: 0 }, end: { x: 3, y: 2 }, wallType: 'normal', isExterior: false },
    { id: 'w-ah2', start: { x: 3, y: 4 }, end: { x: 3, y: 6 }, wallType: 'normal', isExterior: false },
    // Interior wall: Hallway ↔ Room B at x=5 (doorway y=2–4)
    { id: 'w-hb1', start: { x: 5, y: 0 }, end: { x: 5, y: 2 }, wallType: 'normal', isExterior: false },
    { id: 'w-hb2', start: { x: 5, y: 4 }, end: { x: 5, y: 6 }, wallType: 'normal', isExterior: false },
  ],

  windows: [
    // Room A – north window (1 m)
    { id: 'win-a',  start: { x: 1, y: 0 }, end: { x: 2, y: 0 } },
    // Hallway – full north glass wall (2 m)
    { id: 'win-hn', start: { x: 3, y: 0 }, end: { x: 5, y: 0 } },
    // Hallway – full south glass wall (2 m) — faces south = high solar
    { id: 'win-hs', start: { x: 3, y: 6 }, end: { x: 5, y: 6 } },
    // Room B – north window (1 m)
    { id: 'win-b',  start: { x: 6, y: 0 }, end: { x: 7, y: 0 } },
  ],

  doors: [
    // Room A – south exterior door
    { id: 'door-a',  start: { x: 1, y: 6 }, end: { x: 2, y: 6 }, isExterior: true },
    // Room B – south exterior door
    { id: 'door-b',  start: { x: 6, y: 6 }, end: { x: 7, y: 6 }, isExterior: true },
    // Interior doorway: Room A ↔ Hallway (y=2–4)
    { id: 'door-ah', start: { x: 3, y: 2 }, end: { x: 3, y: 4 }, isExterior: false },
    // Interior doorway: Hallway ↔ Room B (y=2–4)
    { id: 'door-hb', start: { x: 5, y: 2 }, end: { x: 5, y: 4 }, isExterior: false },
  ],

  vents: [],
};

// ─── AHU ──────────────────────────────────────────────────────────────────────

// Centred below the hallway (x=3–5), supply feeds trunk up to hallway.
const ahu: AHU = {
  position:   { x: 3, y: 7 },
  totalCFM:   0,
  supplyPort: { x: 4, y: 7 },
  returnPort: { x: 5, y: 7 },
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
    description: 'Two rooms linked by a glass hallway — the south-facing glazing drives a high hallway load. Route a trunk through the corridor then branch to each room.',
    floorplan: fp,
    ahu: ahuFinal,
    rooms,
    totalCFM: total,
    optimalDuctSystem: optimal,
    optimalLength: optLen,
  };
}

export const level3: Level = buildLevel();
