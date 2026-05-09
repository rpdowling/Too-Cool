/**
 * Level 1 – "The Basics"
 *
 * A 6 × 6 m square building:
 *   • Normal exterior walls on all four sides
 *   • One exterior door (south wall, x = 2–3)
 *   • One window     (south wall, x = 4–5)
 *   • AHU placed south of building (2 × 3 m area)
 *
 * Grid coords: Y increases downward.  Building interior cells (0,0)–(5,5).
 * South wall sits at y = 6.  AHU at x = 2–4, y = 7–10 (2 wide, 3 tall).
 *
 * Load: computed once and hardcoded below (see calcRoomLoad).
 * Optimal duct: 8" supply trunk, straight north from AHU to room centre.
 */
import type { Level, FloorPlan, AHU, Room, DuctSystem } from '../types';
import { calcFloorplanLoads, totalCFM } from '../game/loadCalc';
import { detectRooms } from '../game/roomDetection';
import { buildOptimalDuctSystem, totalDuctLength } from '../game/steinertree';

// ─── Floor plan definition ────────────────────────────────────────────────────

const fp: FloorPlan = {
  gridWidth: 6,
  gridHeight: 6,

  walls: [
    // North wall: (0,0)→(6,0)
    { id: 'w-n1', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, wallType: 'normal', isExterior: true },
    // East wall:  (6,0)→(6,6)
    { id: 'w-e1', start: { x: 6, y: 0 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
    // West wall:  (0,0)→(0,6)
    { id: 'w-w1', start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    // South wall segments (split around door & window)
    { id: 'w-s1', start: { x: 0, y: 6 }, end: { x: 2, y: 6 }, wallType: 'normal', isExterior: true },
    // Gap x=2–3 → door
    { id: 'w-s2', start: { x: 3, y: 6 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: true },
    // Gap x=4–5 → window
    { id: 'w-s3', start: { x: 5, y: 6 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
  ],

  windows: [
    { id: 'win-1', start: { x: 4, y: 6 }, end: { x: 5, y: 6 } },
  ],

  doors: [
    { id: 'door-1', start: { x: 2, y: 6 }, end: { x: 3, y: 6 }, isExterior: true },
  ],

  vents: [],
};

// ─── AHU ──────────────────────────────────────────────────────────────────────

const ahu: AHU = {
  position:   { x: 2, y: 7 },   // top-left of 2 × 3 area
  totalCFM:   0,                 // filled in below
  supplyPort: { x: 3, y: 7 },   // center-top of AHU — integer grid, routes straight north to room
  returnPort: { x: 4, y: 7 },   // right-top of AHU — integer grid
};

// ─── Build level at module load ───────────────────────────────────────────────

function buildLevel(): Level {
  // 1. Detect rooms
  const rawRooms = detectRooms(fp);

  // 2. Calculate loads
  const rooms: Room[] = calcFloorplanLoads(rawRooms, fp);

  // 3. Total CFM
  const total = totalCFM(rooms);

  // 4. Patch AHU CFM
  const ahuFinal: AHU = { ...ahu, totalCFM: total };

  // 5. Optimal duct system
  const optimal: DuctSystem = buildOptimalDuctSystem(rooms, ahuFinal);
  const optLen = totalDuctLength(optimal);

  return {
    id: 1,
    name: 'The Basics',
    description: 'A simple 6 × 6 m room — master supply routing before tackling complex layouts.',
    floorplan: fp,
    ahu: ahuFinal,
    rooms,
    totalCFM: total,
    optimalDuctSystem: optimal,
    optimalLength: optLen,
  };
}

export const level1: Level = buildLevel();

import { level2 } from './level2';
export const ALL_LEVELS: Level[] = [level1, level2];
