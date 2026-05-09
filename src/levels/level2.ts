/**
 * Level 2 – "Two Rooms"
 *
 * An 8 × 6 m building split by an interior wall into two equal zones:
 *   • Living Room (west):  4 × 6 m, cells (0,0)–(3,5)
 *   • Bedroom (east):      4 × 6 m, cells (4,0)–(7,5)
 *   • Interior wall at x=4, doorway at y=2–4
 *   • Each room has one south exterior door and one north window
 *   • AHU centred below the building
 *
 * Optimal route: trunk from AHU to Living Room centroid, branch east to Bedroom.
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
    // North wall (split around two windows)
    { id: 'w-n1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-n2', start: { x: 2, y: 0 }, end: { x: 6, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-n3', start: { x: 7, y: 0 }, end: { x: 8, y: 0 }, wallType: 'normal', isExterior: true },
    // East wall
    { id: 'w-e1', start: { x: 8, y: 0 }, end: { x: 8, y: 6 }, wallType: 'normal', isExterior: true },
    // West wall
    { id: 'w-w1', start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    // South wall (split around two doors)
    { id: 'w-s1', start: { x: 0, y: 6 }, end: { x: 1, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s2', start: { x: 2, y: 6 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s3', start: { x: 7, y: 6 }, end: { x: 8, y: 6 }, wallType: 'normal', isExterior: true },
    // Interior wall (split around 1 m doorway at y=2–3)
    { id: 'w-i1', start: { x: 4, y: 0 }, end: { x: 4, y: 2 }, wallType: 'normal', isExterior: false },
    { id: 'w-i2', start: { x: 4, y: 3 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: false },
  ],

  windows: [
    { id: 'win-a', start: { x: 1, y: 0 }, end: { x: 2, y: 0 } }, // Living Room north
    { id: 'win-b', start: { x: 6, y: 0 }, end: { x: 7, y: 0 } }, // Bedroom north
  ],

  doors: [
    { id: 'door-a',   start: { x: 1, y: 6 }, end: { x: 2, y: 6 }, isExterior: true  }, // Living Room south
    { id: 'door-b',   start: { x: 6, y: 6 }, end: { x: 7, y: 6 }, isExterior: true  }, // Bedroom south
    { id: 'door-int', start: { x: 4, y: 2 }, end: { x: 4, y: 3 }, isExterior: false }, // Interior doorway (1 m)
  ],

  vents: [],
};

// ─── AHU ──────────────────────────────────────────────────────────────────────

const ahu: AHU = {
  position:   { x: 3, y: 7 },
  totalCFM:   0,
  supplyPort: { x: 4, y: 7 }, // centre-top, aligned with interior wall
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
    id: 2,
    name: 'Two Rooms',
    description: 'Two zones split by an interior wall — master trunk-and-branch routing.',
    floorplan: fp,
    ahu: ahuFinal,
    rooms,
    totalCFM: total,
    optimalDuctSystem: optimal,
    optimalLength: optLen,
  };
}

export const level2: Level = buildLevel();
