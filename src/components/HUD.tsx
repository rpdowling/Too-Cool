import React from 'react';
import type { Level, Room, DuctSystem, DrawingTool, DuctSize } from '../types';
import type { ScoreBreakdown } from '../game/scoring';
import { DUCT_MAX_CFM } from '../game/ductSizing';
import { scoreSummary } from '../game/scoring';

export type { ScoreBreakdown };

interface Props {
  level: Level;
  ductSystem: DuctSystem;
  activeTool: DrawingTool;
  selectedSize: DuctSize;
  currentLayer: number;
  showOptimal: boolean;
  score: ScoreBreakdown | null;
  onToolChange: (t: DrawingTool) => void;
  onSizeChange: (s: DuctSize) => void;
  onSubmit: () => void;
  onUndo: () => void;
  onClear: () => void;
  onToggleOptimal: () => void;
  onBack: () => void;
}

const SUPPLY_TOOLS: { tool: DrawingTool; label: string }[] = [
  { tool: 'duct_supply', label: 'Supply Duct' },
  { tool: 'diffuser_supply', label: 'Supply Diff.' },
  { tool: 'duct_return', label: 'Return Duct' },
  { tool: 'diffuser_return', label: 'Return Grille' },
  { tool: 'transition_rise', label: 'Rise ↑' },
  { tool: 'transition_drop', label: 'Drop ↓' },
  { tool: 'eraser', label: 'Eraser' },
];

const SIZES: DuctSize[] = [4, 6, 8, 12];

function roomSuppliedCFM(roomId: string, ds: DuctSystem): number {
  return ds.diffusers.filter(d => d.roomId === roomId && !d.isReturn)
    .reduce((s, d) => s + d.cfm, 0);
}

export function HUD({
  level, ductSystem, activeTool, selectedSize, currentLayer, showOptimal, score,
  onToolChange, onSizeChange, onSubmit, onUndo, onClear, onToggleOptimal, onBack,
}: Props) {
  return (
    <div className="hud">
      {/* ── Left panel: tools ── */}
      <aside className="hud-left">
        <button className="back-btn small" onClick={onBack}>← Back</button>
        <div className="panel-title">Tools</div>

        <div className="tool-group">
          {SUPPLY_TOOLS.map(({ tool, label }) => (
            <button
              key={tool}
              className={`tool-btn ${activeTool === tool ? 'active' : ''}`}
              onClick={() => onToolChange(tool)}
            >
              {label}
            </button>
          ))}
        </div>

        {(activeTool === 'duct_supply' || activeTool === 'duct_return') && (
          <>
            <div className="panel-title" style={{ marginTop: 16 }}>Duct Size</div>
            <div className="tool-group">
              {SIZES.map(s => (
                <button
                  key={s}
                  className={`tool-btn size-btn ${selectedSize === s ? 'active' : ''}`}
                  onClick={() => onSizeChange(s)}
                >
                  {s}"
                  <span className="size-cfm">≤{DUCT_MAX_CFM[s]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {currentLayer > 0 && (
          <div className="layer-badge">Layer {currentLayer + 1} ↑</div>
        )}

        <div className="hud-actions">
          <button className="action-btn submit" onClick={onSubmit}>Submit</button>
          <button className="action-btn" onClick={onUndo}>Undo</button>
          <button className="action-btn danger" onClick={onClear}>Clear</button>
          <button
            className={`action-btn toggle ${showOptimal ? 'on' : ''}`}
            onClick={onToggleOptimal}
          >
            {showOptimal ? 'Hide Optimal' : 'Show Optimal'}
          </button>
        </div>
      </aside>

      {/* ── Right panel: info ── */}
      <aside className="hud-right">
        <div className="panel-title">{level.name}</div>
        <div className="info-row">
          <span>Total CFM</span>
          <strong>{level.totalCFM}</strong>
        </div>

        <div className="panel-title" style={{ marginTop: 12 }}>Rooms</div>
        {level.rooms.map(room => {
          const needed = room.cfm;
          const supplied = roomSuppliedCFM(room.id, ductSystem);
          const pct = Math.min(1, supplied / Math.max(1, needed));
          return (
            <div key={room.id} className="room-row">
              <div
                className="room-dot"
                style={{ background: room.color.replace('0.28', '0.9') }}
              />
              <div className="room-info">
                <span className="room-label">Room</span>
                <span className="room-cfm">{supplied}/{needed} CFM</span>
              </div>
              <div className="room-bar-wrap">
                <div
                  className="room-bar-fill"
                  style={{
                    width: `${pct * 100}%`,
                    background: supplied >= needed ? '#34d399' : '#f59e0b',
                  }}
                />
              </div>
            </div>
          );
        })}

        {score && (
          <div className="score-panel">
            <div className="score-title">Score</div>
            <div className="score-total">{score.total}<span>/100</span></div>
            <div className="score-breakdown">
              <div>Coverage: {score.coverage}/40</div>
              <div>Efficiency: {score.efficiency}/40</div>
              <div>Sizing: {score.sizing}/20</div>
              {score.excessLengthPct > 0 && (
                <div className="score-note">+{score.excessLengthPct}% excess duct</div>
              )}
            </div>
            <div className="score-summary">{scoreSummary(score)}</div>
          </div>
        )}
      </aside>
    </div>
  );
}
