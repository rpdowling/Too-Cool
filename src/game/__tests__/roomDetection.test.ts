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
