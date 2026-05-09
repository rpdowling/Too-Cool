import { describe, it, expect } from 'vitest';
import { detectRooms, validateFloorplan } from '../roomDetection';
import type { FloorPlan } from '../../types';

// Level-1 floor plan: 6×6 m square, south door at x=2..3, south window at x=4..5
const LEVEL1_FP: FloorPlan = {
  gridWidth: 6, gridHeight: 6,
  walls: [
    { id: 'w-n', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-e', start: { x: 6, y: 0 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-w', start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s1', start: { x: 0, y: 6 }, end: { x: 2, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s2', start: { x: 3, y: 6 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s3', start: { x: 5, y: 6 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
  ],
  windows: [{ id: 'win-1', start: { x: 4, y: 6 }, end: { x: 5, y: 6 } }],
  doors:   [{ id: 'door-1', start: { x: 2, y: 6 }, end: { x: 3, y: 6 }, isExterior: true }],
  vents:   [],
};

// Level-2 floor plan: 8×6 m, interior wall at x=4 with 1 m doorway at y=2..3
const LEVEL2_FP: FloorPlan = {
  gridWidth: 8, gridHeight: 6,
  walls: [
    { id: 'w-n1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-n2', start: { x: 2, y: 0 }, end: { x: 6, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-n3', start: { x: 7, y: 0 }, end: { x: 8, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-e1', start: { x: 8, y: 0 }, end: { x: 8, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-w1', start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s1', start: { x: 0, y: 6 }, end: { x: 1, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s2', start: { x: 2, y: 6 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s3', start: { x: 7, y: 6 }, end: { x: 8, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-i1', start: { x: 4, y: 0 }, end: { x: 4, y: 2 }, wallType: 'normal', isExterior: false },
    { id: 'w-i2', start: { x: 4, y: 3 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: false },
  ],
  windows: [
    { id: 'win-a', start: { x: 1, y: 0 }, end: { x: 2, y: 0 } },
    { id: 'win-b', start: { x: 6, y: 0 }, end: { x: 7, y: 0 } },
  ],
  doors: [
    { id: 'door-a',   start: { x: 1, y: 6 }, end: { x: 2, y: 6 }, isExterior: true },
    { id: 'door-b',   start: { x: 6, y: 6 }, end: { x: 7, y: 6 }, isExterior: true },
    { id: 'door-int', start: { x: 4, y: 2 }, end: { x: 4, y: 3 }, isExterior: false },
  ],
  vents: [],
};

// Level-3 floor plan: 8×8 m, Room A (top, 3m) + glass hallway (2m) + Room B (bottom, 3m)
const LEVEL3_FP: FloorPlan = {
  gridWidth: 8, gridHeight: 8,
  walls: [
    { id: 'w-n1',  start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-n2',  start: { x: 6, y: 0 }, end: { x: 8, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-s1',  start: { x: 0, y: 8 }, end: { x: 2, y: 8 }, wallType: 'normal', isExterior: true },
    { id: 'w-s2',  start: { x: 3, y: 8 }, end: { x: 5, y: 8 }, wallType: 'normal', isExterior: true },
    { id: 'w-w',   start: { x: 0, y: 0 }, end: { x: 0, y: 8 }, wallType: 'normal', isExterior: true },
    { id: 'w-e',   start: { x: 8, y: 0 }, end: { x: 8, y: 8 }, wallType: 'normal', isExterior: true },
    { id: 'w-ah1', start: { x: 0, y: 3 }, end: { x: 2, y: 3 }, wallType: 'normal', isExterior: false },
    { id: 'w-ah2', start: { x: 7, y: 3 }, end: { x: 8, y: 3 }, wallType: 'normal', isExterior: false },
    { id: 'w-hb1', start: { x: 0, y: 5 }, end: { x: 1, y: 5 }, wallType: 'normal', isExterior: false },
    { id: 'w-hb2', start: { x: 6, y: 5 }, end: { x: 8, y: 5 }, wallType: 'normal', isExterior: false },
  ],
  windows: [
    { id: 'win-a',  start: { x: 2, y: 0 }, end: { x: 6, y: 0 } },
    { id: 'win-hn', start: { x: 2, y: 3 }, end: { x: 6, y: 3 } },
    { id: 'win-hs', start: { x: 2, y: 5 }, end: { x: 6, y: 5 } },
    { id: 'win-b',  start: { x: 5, y: 8 }, end: { x: 8, y: 8 } },
  ],
  doors: [
    { id: 'door-a',  start: { x: 1, y: 0 }, end: { x: 2, y: 0 }, isExterior: true },
    { id: 'door-b',  start: { x: 2, y: 8 }, end: { x: 3, y: 8 }, isExterior: true },
    { id: 'door-ah', start: { x: 6, y: 3 }, end: { x: 7, y: 3 }, isExterior: false },
    { id: 'door-hb', start: { x: 1, y: 5 }, end: { x: 2, y: 5 }, isExterior: false },
  ],
  vents: [],
};

describe('detectRooms — level 1', () => {
  it('detects exactly 1 room', () => {
    expect(detectRooms(LEVEL1_FP)).toHaveLength(1);
  });

  it('room covers all 36 interior cells', () => {
    const [room] = detectRooms(LEVEL1_FP);
    expect(room.cells).toHaveLength(36);
    expect(room.area).toBe(36);
  });

  it('room references all six wall segments', () => {
    const [room] = detectRooms(LEVEL1_FP);
    expect(room.wallIds).toContain('w-n');
    expect(room.wallIds).toContain('w-e');
    expect(room.wallIds).toContain('w-w');
    expect(room.wallIds).toContain('w-s1');
    expect(room.wallIds).toContain('w-s2');
    expect(room.wallIds).toContain('w-s3');
  });

  it('room references the window', () => {
    const [room] = detectRooms(LEVEL1_FP);
    expect(room.windowIds).toContain('win-1');
  });

  it('room references the door', () => {
    const [room] = detectRooms(LEVEL1_FP);
    expect(room.doorIds).toContain('door-1');
  });
});

describe('detectRooms — level 2 (interior wall fix)', () => {
  it('detects exactly 2 rooms separated by the interior wall', () => {
    expect(detectRooms(LEVEL2_FP)).toHaveLength(2);
  });

  it('each room covers exactly 24 cells (4×6 m)', () => {
    const rooms = detectRooms(LEVEL2_FP);
    expect(rooms[0].cells).toHaveLength(24);
    expect(rooms[1].cells).toHaveLength(24);
  });

  it('rooms are on opposite sides of x=4', () => {
    const rooms = detectRooms(LEVEL2_FP);
    const xValues0 = rooms[0].cells.map(c => c.x);
    const xValues1 = rooms[1].cells.map(c => c.x);
    // One room is entirely west of the interior wall, the other east
    const allWest  = (xs: number[]) => xs.every(x => x < 4);
    const allEast  = (xs: number[]) => xs.every(x => x >= 4);
    expect(allWest(xValues0) || allWest(xValues1)).toBe(true);
    expect(allEast(xValues0) || allEast(xValues1)).toBe(true);
  });
});

describe('detectRooms — level 3 (glass corridor)', () => {
  it('detects exactly 3 rooms', () => {
    expect(detectRooms(LEVEL3_FP)).toHaveLength(3);
  });

  it('room cell counts are 16 + 24 + 24 (or permutation)', () => {
    const rooms = detectRooms(LEVEL3_FP);
    const counts = rooms.map(r => r.cells.length).sort((a, b) => a - b);
    expect(counts).toEqual([16, 24, 24]);
  });

  it('hallway room has windows on north and south', () => {
    const rooms = detectRooms(LEVEL3_FP);
    const hallway = rooms.find(r => r.cells.length === 16)!;
    expect(hallway.windowIds).toContain('win-hn');
    expect(hallway.windowIds).toContain('win-hs');
  });
});

describe('validateFloorplan', () => {
  it('passes for valid level-1 layout', () => {
    const rooms = detectRooms(LEVEL1_FP);
    const result = validateFloorplan(LEVEL1_FP, rooms);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails with no rooms', () => {
    const result = validateFloorplan(LEVEL1_FP, []);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
