/**
 * Duct sizing helpers based on simplified ductulator rules.
 *
 * Target: 0.10 in. w.g. / 100 ft friction rate, ≤ 900 FPM velocity.
 * Round duct areas and CFM limits:
 *   4"  → A = 0.0873 ft²  → max ~78 CFM
 *   6"  → A = 0.1963 ft²  → max ~177 CFM
 *   8"  → A = 0.3491 ft²  → max ~314 CFM
 *   12" → A = 0.7854 ft²  → max ~707 CFM
 */
import type { DuctSize, Diffuser, Room } from '../types';
import { uid } from './utils';

export const DUCT_MAX_CFM: Record<DuctSize, number> = {
  4: 78,
  6: 177,
  8: 314,
  12: 707,
};

export const DUCT_SIZES: DuctSize[] = [4, 6, 8, 12];

/** Pick the smallest duct that can handle the given CFM */
export function autoSizeDuct(cfm: number): DuctSize {
  for (const size of DUCT_SIZES) {
    if (cfm <= DUCT_MAX_CFM[size]) return size;
  }
  return 12;
}

/** Canvas render widths for each duct size (px, double-line outer gap) */
export const DUCT_RENDER_PX: Record<DuctSize, number> = {
  4: 8,
  6: 12,
  8: 16,
  12: 24,
};

/** Display label */
export function ductLabel(size: DuctSize): string {
  return `${size}"`;
}

/**
 * Auto-size all diffusers in a room given the total room CFM and diffuser count.
 * Splits load equally, then auto-sizes each diffuser.
 */
export function sizeDiffusersForRoom(
  roomCFM: number,
  count: number,
): { cfm: number; size: DuctSize } {
  const perDiffuser = roomCFM / count;
  return { cfm: Math.round(perDiffuser), size: autoSizeDuct(perDiffuser) };
}

/** Returns the duct draw width in px (the gap between the two lines) */
export function ductLineGap(size: DuctSize): number {
  return DUCT_RENDER_PX[size];
}

/** Transition length in metres — typically 4× diameter */
export function transitionLength(from: DuctSize, to: DuctSize): number {
  return (Math.max(from, to) / 12) * 1.2; // metres, simplified
}

/** Pressure drop per metre at given CFM and size (in. w.g./m) — simplified */
export function frictionLoss(cfm: number, size: DuctSize): number {
  // Based on ASHRAE: ΔP = 0.1 in. w.g. per 100 ft → 0.00328 per metre at design
  // Scale by (actual_velocity / design_velocity)^1.85
  const areaFt2 = Math.PI * ((size / 2 / 12) ** 2);
  const velocityFPM = cfm / areaFt2;
  const designFPM = 700;
  const ratio = velocityFPM / designFPM;
  return 0.00328 * Math.pow(ratio, 1.85);
}
