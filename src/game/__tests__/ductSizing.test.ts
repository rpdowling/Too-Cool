import { describe, it, expect } from 'vitest';
import { autoSizeDuct, sizeDiffusersForRoom, DUCT_MAX_CFM, DUCT_SIZES } from '../ductSizing';

describe('autoSizeDuct', () => {
  it('picks 4" for CFM at or below 78', () => {
    expect(autoSizeDuct(50)).toBe(4);
    expect(autoSizeDuct(78)).toBe(4);
  });

  it('picks 6" for CFM 79–177', () => {
    expect(autoSizeDuct(79)).toBe(6);
    expect(autoSizeDuct(177)).toBe(6);
  });

  it('picks 8" for CFM 178–314', () => {
    expect(autoSizeDuct(200)).toBe(8);
    expect(autoSizeDuct(314)).toBe(8);
  });

  it('picks 12" for CFM above 314', () => {
    expect(autoSizeDuct(500)).toBe(12);
    expect(autoSizeDuct(707)).toBe(12);
  });

  it('DUCT_MAX_CFM values are strictly increasing', () => {
    for (let i = 0; i < DUCT_SIZES.length - 1; i++) {
      expect(DUCT_MAX_CFM[DUCT_SIZES[i]]).toBeLessThan(DUCT_MAX_CFM[DUCT_SIZES[i + 1]]);
    }
  });
});

describe('sizeDiffusersForRoom', () => {
  it('splits 200 CFM equally across 2 diffusers → 100 CFM each, 6" duct', () => {
    const result = sizeDiffusersForRoom(200, 2);
    expect(result.cfm).toBe(100);
    expect(result.size).toBe(6);
  });

  it('a single diffuser for a 300 CFM room gets 8" duct', () => {
    const result = sizeDiffusersForRoom(300, 1);
    expect(result.size).toBe(8);
  });
});
