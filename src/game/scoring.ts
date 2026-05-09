/**
 * Score the player's duct system against the pre-solved optimal.
 *
 * Scoring rubric (100 pts total):
 *   40 pts – room coverage (supply diffuser reachable from AHU via duct path)
 *   40 pts – duct efficiency (closeness to optimal total length)
 *   20 pts – proper duct sizing (no significantly oversized/undersized runs)
 */
import type { DuctSystem, Level } from '../types';
import { totalDuctLength } from './steinertree';
import { DUCT_MAX_CFM } from './ductSizing';
import { computeServedRooms } from './connectivity';

export interface ScoreBreakdown {
  total: number;          // 0–100
  coverage: number;       // 0–40
  efficiency: number;     // 0–40
  sizing: number;         // 0–20
  unservedRooms: string[];
  excessLengthPct: number;
}

/** Score player's duct system */
export function scoreSystem(level: Level, player: DuctSystem): ScoreBreakdown {
  // ── Coverage: requires diffuser connected to AHU via supply duct ──
  const servedRooms = computeServedRooms(player, level.ahu);
  const unservedRooms: string[] = [];
  for (const room of level.rooms) {
    if (!servedRooms.has(room.id)) unservedRooms.push(room.id);
  }
  const servedFraction = (level.rooms.length - unservedRooms.length) / Math.max(1, level.rooms.length);
  const coverage = Math.round(40 * servedFraction);

  // ── Efficiency ──
  const playerLength = totalDuctLength(player);
  const optimalLength = level.optimalLength;
  let efficiency = 0;
  let excessLengthPct = 0;
  if (playerLength > 0) {
    excessLengthPct = Math.max(0, (playerLength - optimalLength) / Math.max(1, optimalLength)) * 100;
    // Full marks if ≤5% over optimal, zero if ≥100% over
    const efficiencyRaw = Math.max(0, 1 - excessLengthPct / 100);
    efficiency = Math.round(40 * efficiencyRaw);
  }

  // ── Sizing ──
  let sizingPenalty = 0;
  for (const seg of player.segments) {
    const maxCFM = DUCT_MAX_CFM[seg.size];
    if (seg.cfm > maxCFM * 1.1) sizingPenalty += 2;      // undersized
    else if (seg.cfm < maxCFM * 0.25) sizingPenalty += 1; // very oversized
  }
  const sizing = Math.max(0, 20 - sizingPenalty);

  return {
    total: coverage + efficiency + sizing,
    coverage,
    efficiency,
    sizing,
    unservedRooms,
    excessLengthPct: Math.round(excessLengthPct),
  };
}

/** Summary string for results screen */
export function scoreSummary(score: ScoreBreakdown): string {
  if (score.total >= 90) return 'Excellent! Near-optimal design.';
  if (score.total >= 70) return 'Good design — some room for efficiency gains.';
  if (score.total >= 50) return 'Acceptable — review duct routing and sizing.';
  return 'Keep practicing — check room coverage and duct lengths.';
}
