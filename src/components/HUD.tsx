import React, { useState } from 'react';
import type { Level, Room, DuctSystem, DrawingTool } from '../types';
import type { ScoreBreakdown } from '../game/scoring';
import { scoreSummary } from '../game/scoring';

export type { ScoreBreakdown };

interface Props {
  level: Level;
  ductSystem: DuctSystem;
  activeTool: DrawingTool;
  currentLayer: number;
  showOptimal: boolean;
  score: ScoreBreakdown | null;
  onToolChange: (t: DrawingTool) => void;
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
  { tool: 'eraser', label: 'Eraser' },
];

function roomSuppliedCFM(roomId: string, ds: DuctSystem): number {
  return ds.diffusers.filter(d => d.roomId === roomId && !d.isReturn)
    .reduce((s, d) => s + d.cfm, 0);
}

function LoadCalcInfo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="load-calc-info">
      <button className="tool-btn" style={{ marginTop: 12, fontSize: '0.72rem' }} onClick={() => setOpen(o => !o)}>
        {open ? '▲ Hide' : '▼ Load Calc'}
      </button>
      {open && (
        <div className="load-calc-panel">
          <div className="lc-title">Cooling Load Method</div>

          <div className="lc-section">Design conditions</div>
          <div className="lc-row"><span>Room setpoint</span><strong>72 °F</strong></div>
          <div className="lc-row"><span>Supply air</span><strong>55 °F</strong></div>
          <div className="lc-row"><span>ΔT</span><strong>17 °F</strong></div>
          <div className="lc-row"><span>CFM formula</span><strong>BTU/hr ÷ (1.1 × ΔT)</strong></div>

          <div className="lc-section">Envelope — CLTD method</div>
          <div className="lc-row"><span>Wall R-13 (normal)</span><strong>CLTD 20 °F</strong></div>
          <div className="lc-row"><span>Wall R-21 (thick)</span><strong>CLTD 20 °F</strong></div>
          <div className="lc-row"><span>Window (4 ft ht, R-3)</span><strong>CLTD 15 °F + solar</strong></div>
          <div className="lc-row"><span>Ext. door (7 ft ht, R-5)</span><strong>CLTD 15 °F</strong></div>
          <div className="lc-row"><span>Ceiling R-30</span><strong>CLTD 50 °F</strong></div>

          <div className="lc-section">Peak solar (BTU/hr·ft²)</div>
          <div className="lc-row"><span>N / NE / NW</span><strong>30 / 90 / 90</strong></div>
          <div className="lc-row"><span>E / W</span><strong>150 / 150</strong></div>
          <div className="lc-row"><span>SE / SW</span><strong>175 / 175</strong></div>
          <div className="lc-row"><span>S (worst)</span><strong>200</strong></div>
          <div className="lc-row"><span>SHGC</span><strong>0.40 (tinted dbl-pane)</strong></div>

          <div className="lc-section">Internal gains</div>
          <div className="lc-row"><span>Lighting</span><strong>0.75 W/ft²</strong></div>
          <div className="lc-row"><span>Occupancy</span><strong>250 BTU/hr/person</strong></div>
          <div className="lc-row"><span>Density</span><strong>1 person / 10 m²</strong></div>
        </div>
      )}
    </div>
  );
}

export function HUD({
  level, ductSystem, activeTool, currentLayer, showOptimal, score,
  onToolChange, onSubmit, onUndo, onClear, onToggleOptimal, onBack,
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
        {level.rooms.map((room, i) => {
          const needed = room.cfm;
          const supplied = roomSuppliedCFM(room.id, ductSystem);
          const pct = Math.min(1, supplied / Math.max(1, needed));
          const needsReturn = score?.missingReturnRooms.includes(room.id);
          return (
            <div key={room.id} className="room-row">
              <div
                className="room-dot"
                style={{ background: room.color.replace('0.28', '0.9') }}
              />
              <div className="room-info">
                <span className="room-label">Room {i + 1}</span>
                <span className="room-cfm">{supplied}/{needed} CFM</span>
                {needsReturn && <span className="room-return-warn">↩ return</span>}
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

        <LoadCalcInfo />
      </aside>
    </div>
  );
}
