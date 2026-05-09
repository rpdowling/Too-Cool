import { describe, it, expect } from 'vitest';
import { scoreSystem, scoreSummary } from '../scoring';
import type { Level, DuctSystem, Room, AHU } from '../../types';

// Minimal mock level: 1 room, 10 m optimal length
function makeLevel(roomCFM = 150, optimalLength = 10): Level {
  const room: Room = {
    id: 'r1', cells: [], area: 36,
    cfm: roomCFM, btuh: 2000, color: 'blue',
    wallIds: [], windowIds: [], doorIds: [],
  };
  const ahu: AHU = {
    position: { x: 2, y: 7 }, totalCFM: roomCFM,
    supplyPort: { x: 3, y: 7 }, returnPort: { x: 4, y: 7 },
  };
  return {
    id: 1, name: 'Test', description: '',
    floorplan: { gridWidth: 6, gridHeight: 6, walls: [], windows: [], doors: [], vents: [] },
    ahu, rooms: [room], totalCFM: roomCFM,
    optimalDuctSystem: { segments: [], transitions: [], diffusers: [] },
    optimalLength,
  };
}

const EMPTY_SYSTEM: DuctSystem = { segments: [], transitions: [], diffusers: [] };

// Supply duct + diffuser only — no return
const SUPPLY_ONLY_SYSTEM: DuctSystem = {
  ...EMPTY_SYSTEM,
  segments: [{ id: 's1', start: { x: 3, y: 7 }, end: { x: 3, y: 3 }, size: 6, cfm: 150, layer: 0, isReturn: false }],
  diffusers: [{ id: 'd1', position: { x: 3, y: 3 }, roomId: 'r1', size: 6, cfm: 150, isReturn: false }],
};

// Supply + return both connected to AHU
const FULL_SYSTEM: DuctSystem = {
  ...EMPTY_SYSTEM,
  segments: [
    { id: 's1', start: { x: 3, y: 7 }, end: { x: 3, y: 3 }, size: 6, cfm: 150, layer: 0, isReturn: false },
    { id: 'r1', start: { x: 3, y: 5 }, end: { x: 4, y: 7 }, size: 6, cfm: 150, layer: 0, isReturn: true },
  ],
  diffusers: [
    { id: 'd1', position: { x: 3, y: 3 }, roomId: 'r1', size: 6, cfm: 150, isReturn: false },
    { id: 'd2', position: { x: 3, y: 5 }, roomId: 'r1', size: 6, cfm: 150, isReturn: true },
  ],
};

describe('scoreSystem', () => {
  it('scores 0 coverage when no diffusers placed', () => {
    const s = scoreSystem(makeLevel(), EMPTY_SYSTEM);
    expect(s.coverage).toBe(0);
    expect(s.unservedRooms).toContain('r1');
  });

  it('scores 0 coverage when supply diffuser exists but no duct connects it to AHU', () => {
    const ds: DuctSystem = {
      ...EMPTY_SYSTEM,
      diffusers: [{ id: 'd1', position: { x: 3, y: 3 }, roomId: 'r1', size: 6, cfm: 150, isReturn: false }],
    };
    const s = scoreSystem(makeLevel(), ds);
    expect(s.coverage).toBe(0);
    expect(s.unservedRooms).toContain('r1');
  });

  it('scores 0 coverage when only supply is connected — return duct required', () => {
    const s = scoreSystem(makeLevel(), SUPPLY_ONLY_SYSTEM);
    expect(s.coverage).toBe(0);
    expect(s.missingReturnRooms).toContain('r1');
  });

  it('scores full coverage when room has supply AND return both connected to AHU', () => {
    const s = scoreSystem(makeLevel(), FULL_SYSTEM);
    expect(s.coverage).toBe(40);
    expect(s.missingReturnRooms).toHaveLength(0);
  });

  it('efficiency is 0 when no segments placed', () => {
    const s = scoreSystem(makeLevel(), EMPTY_SYSTEM);
    expect(s.efficiency).toBe(0);
  });

  it('total = coverage + efficiency + sizing', () => {
    const s = scoreSystem(makeLevel(), FULL_SYSTEM);
    expect(s.total).toBe(s.coverage + s.efficiency + s.sizing);
  });
});

describe('scoreSummary', () => {
  it('returns "Excellent" for score >= 90 with all rooms served', () => {
    expect(scoreSummary({ total: 95, coverage: 40, efficiency: 40, sizing: 15, unservedRooms: [], missingReturnRooms: [], excessLengthPct: 0 }))
      .toMatch(/Excellent/);
  });

  it('returns return-duct hint when rooms have supply but no return', () => {
    expect(scoreSummary({ total: 0, coverage: 0, efficiency: 0, sizing: 0, unservedRooms: ['r1'], missingReturnRooms: ['r1'], excessLengthPct: 0 }))
      .toMatch(/return/i);
  });

  it('returns "Keep practicing" for low score with all rooms served', () => {
    expect(scoreSummary({ total: 20, coverage: 40, efficiency: 0, sizing: 0, unservedRooms: [], missingReturnRooms: [], excessLengthPct: 0 }))
      .toMatch(/practicing/);
  });
});
