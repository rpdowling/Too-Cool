import { describe, it, expect } from 'vitest';
import { calcRoomLoad, calcFloorplanLoads, totalCFM } from '../loadCalc';
import { detectRooms } from '../roomDetection';
import type { FloorPlan } from '../../types';

const FP: FloorPlan = {
  gridWidth: 6, gridHeight: 6,
  walls: [
    { id: 'w-n',  start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, wallType: 'normal', isExterior: true },
    { id: 'w-e',  start: { x: 6, y: 0 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-w',  start: { x: 0, y: 0 }, end: { x: 0, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s1', start: { x: 0, y: 6 }, end: { x: 2, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s2', start: { x: 3, y: 6 }, end: { x: 4, y: 6 }, wallType: 'normal', isExterior: true },
    { id: 'w-s3', start: { x: 5, y: 6 }, end: { x: 6, y: 6 }, wallType: 'normal', isExterior: true },
  ],
  windows: [{ id: 'win-1', start: { x: 4, y: 6 }, end: { x: 5, y: 6 } }],
  doors:   [{ id: 'door-1', start: { x: 2, y: 6 }, end: { x: 3, y: 6 }, isExterior: true }],
  vents:   [],
};

describe('calcRoomLoad', () => {
  it('returns positive BTU/hr and CFM', () => {
    const rooms = detectRooms(FP);
    expect(rooms).toHaveLength(1);
    const result = calcRoomLoad(rooms[0], FP);
    expect(result.btuh).toBeGreaterThan(0);
    expect(result.cfm).toBeGreaterThan(0);
  });

  it('BTU/hr is within plausible range for a 36 m² room (~2 000–12 000)', () => {
    const rooms = detectRooms(FP);
    const { btuh } = calcRoomLoad(rooms[0], FP);
    expect(btuh).toBeGreaterThan(2_000);
    expect(btuh).toBeLessThan(12_000);
  });

  it('south-facing window increases load vs. no window', () => {
    const fpNoWin: FloorPlan = { ...FP, windows: [] };
    const rooms = detectRooms(FP);
    const withWin    = calcRoomLoad(rooms[0], FP).btuh;
    const withoutWin = calcRoomLoad(rooms[0], fpNoWin).btuh;
    expect(withWin).toBeGreaterThan(withoutWin);
  });
});

describe('calcFloorplanLoads + totalCFM', () => {
  it('assigns non-zero CFM and a color to each room', () => {
    const rooms = calcFloorplanLoads(detectRooms(FP), FP);
    for (const r of rooms) {
      expect(r.cfm).toBeGreaterThan(0);
      expect(r.color).toMatch(/^hsla/);
    }
  });

  it('totalCFM equals the sum of room CFMs', () => {
    const rooms = calcFloorplanLoads(detectRooms(FP), FP);
    const sum = rooms.reduce((s, r) => s + r.cfm, 0);
    expect(totalCFM(rooms)).toBe(sum);
  });
});
