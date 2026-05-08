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

describe('scoreSystem', () => {
  it('scores 0 coverage when no diffusers placed', () => {
    const s = scoreSystem(makeLevel(), EMPTY_SYSTEM);
    expect(s.coverage).toBe(0);
    expect(s.unservedRooms).toContain('r1');
  });

  it('scores full coverage when room has a supply diffuser', () => {
    const ds: DuctSystem = {
      ...EMPTY_SYSTEM,
      diffusers: [{ id: 'd1', position: { x: 3, y: 3 }, roomId: 'r1', size: 6, cfm: 150, isReturn: false }],
    };
    const s = scoreSystem(makeLevel(), ds);
    expect(s.coverage).toBe(40);
  });

  it('efficiency is 0 when no segments placed', () => {
    const s = scoreSystem(makeLevel(), EMPTY_SYSTEM);
    expect(s.efficiency).toBe(0);
  });

  it('total = coverage + efficiency + sizing', () => {
    const s = scoreSystem(makeLevel(), EMPTY_SYSTEM);
    expect(s.total).toBe(s.coverage + s.efficiency + s.sizing);
  });
});

describe('scoreSummary', () => {
  it('returns "Excellent" for score >= 90', () => {
    expect(scoreSummary({ total: 95, coverage: 40, efficiency: 40, sizing: 15, unservedRooms: [], excessLengthPct: 0 }))
      .toMatch(/Excellent/);
  });

  it('returns "Keep practicing" for score < 50', () => {
    expect(scoreSummary({ total: 20, coverage: 0, efficiency: 0, sizing: 20, unservedRooms: ['r1'], excessLengthPct: 0 }))
      .toMatch(/practicing/);
  });
});
