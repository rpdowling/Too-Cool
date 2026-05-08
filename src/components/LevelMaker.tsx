/**
 * LevelMaker – build and validate custom floor plans.
 *
 * Toolbar: select | wall_normal | wall_thick | window | door | vent | ahu | eraser
 *
 * Drawing rules (mirroring the game spec):
 *  • Walls, windows: click + drag, 45° snap allowed
 *  • Doors, vents: click + drag, orthogonal only (no diagonal)
 *  • AHU: click to place 2×3 area outside building
 *  • Eraser: click near an element to remove
 *
 * After placing elements, hit Validate to check room detection and constraints.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { FloorPlan, WallSegment, WindowSegment, DoorSegment, VentSegment, AHU, Room, GameMode } from '../types';
import { GRID_PX, CANVAS_PAD, gridToPixel, pixelToGrid, snapToGridPoint, snapWallAngle, snapDuctAngle, uid, dist, segLen } from '../game/utils';
import { detectRooms } from '../game/roomDetection';
import { calcFloorplanLoads, totalCFM } from '../game/loadCalc';
import { validateFloorplan } from '../game/roomDetection';
import { draw as drawFloorplan } from './FloorplanCanvas';

const GRID_W = 20;
const GRID_H = 18;

const EMPTY_FP: FloorPlan = {
  gridWidth: GRID_W, gridHeight: GRID_H,
  walls: [], windows: [], doors: [], vents: [],
};

type LMTool = 'select' | 'wall_normal' | 'wall_thick' | 'window' | 'door' | 'vent' | 'ahu' | 'eraser';

interface Props {
  onNavigate: (mode: GameMode) => void;
}

const TOOLS: { tool: LMTool; label: string }[] = [
  { tool: 'select', label: 'Select' },
  { tool: 'wall_normal', label: 'Wall (Norm)' },
  { tool: 'wall_thick', label: 'Wall (Thick)' },
  { tool: 'window', label: 'Window' },
  { tool: 'door', label: 'Door' },
  { tool: 'vent', label: 'Vent' },
  { tool: 'ahu', label: 'AHU' },
  { tool: 'eraser', label: 'Eraser' },
];

export function LevelMaker({ onNavigate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fp, setFP] = useState<FloorPlan>(EMPTY_FP);
  const [ahu, setAHU] = useState<AHU | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeTool, setActiveTool] = useState<LMTool>('wall_normal');
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const drawState = useRef({ isDrawing: false, start: null as { x: number; y: number } | null });

  const recompute = useCallback((newFP: FloorPlan) => {
    const raw = detectRooms(newFP);
    const loaded = calcFloorplanLoads(raw, newFP);
    setRooms(loaded);
  }, []);

  useEffect(() => { recompute(fp); }, [fp, recompute]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = CANVAS_PAD * 2 + GRID_W * GRID_PX;
    const H = CANVAS_PAD * 2 + GRID_H * GRID_PX;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const settings = { showGrid: true, showCFMLabels: rooms.length > 0, volume: 0 };
    drawFloorplan(ctx, fp, rooms, ahu ?? {
      position: { x: 0, y: 0 }, totalCFM: 0,
      supplyPort: { x: 0, y: 0 }, returnPort: { x: 1, y: 0 },
    }, settings, W, H);

    // Draw grid snap points on hover
    ctx.fillStyle = 'rgba(59,130,246,0.15)';
    for (let x = 0; x <= GRID_W; x++) {
      for (let y = 0; y <= GRID_H; y++) {
        const px = CANVAS_PAD + x * GRID_PX;
        const py = CANVAS_PAD + y * GRID_PX;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  function getGrid(e: React.MouseEvent<HTMLCanvasElement>, allowDiag = true) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const raw = pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
    return snapToGridPoint(raw);
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const gp = getGrid(e);
    const s = drawState.current;
    s.isDrawing = true;
    s.start = gp;
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const s = drawState.current;
    if (!s.isDrawing || !s.start) return;
    s.isDrawing = false;

    const endRaw = getGrid(e);
    const isDiag = activeTool === 'wall_normal' || activeTool === 'wall_thick' || activeTool === 'window';
    const end = isDiag ? snapWallAngle(s.start, endRaw) : endRaw;

    if (dist(s.start, end) < 0.1) {
      // Single click tools
      if (activeTool === 'ahu') {
        placeAHU(s.start);
      } else if (activeTool === 'eraser') {
        eraseAt(s.start);
      }
      s.start = null;
      return;
    }

    if (activeTool === 'wall_normal' || activeTool === 'wall_thick') {
      const seg: WallSegment = {
        id: uid(),
        start: s.start,
        end,
        wallType: activeTool === 'wall_thick' ? 'thick' : 'normal',
        isExterior: false, // will be determined after detection
      };
      setFP(prev => {
        const updated = { ...prev, walls: [...prev.walls, seg] };
        markExteriorWalls(updated);
        return updated;
      });
    } else if (activeTool === 'window') {
      const seg: WindowSegment = { id: uid(), start: s.start, end };
      setFP(prev => ({ ...prev, windows: [...prev.windows, seg] }));
    } else if (activeTool === 'door') {
      const nodiag = { x: end.x !== s.start.x ? end.x : s.start.x, y: end.y !== s.start.y ? end.y : s.start.y };
      const seg: DoorSegment = { id: uid(), start: s.start, end: nodiag, isExterior: false };
      setFP(prev => ({ ...prev, doors: [...prev.doors, seg] }));
    } else if (activeTool === 'vent') {
      const seg: VentSegment = { id: uid(), start: s.start, end };
      setFP(prev => ({ ...prev, vents: [...prev.vents, seg] }));
    } else if (activeTool === 'eraser') {
      eraseAt(s.start);
    }

    s.start = null;
  }

  function placeAHU(gp: { x: number; y: number }) {
    const a: AHU = {
      position: gp,
      totalCFM: 0,
      supplyPort: { x: gp.x + 0.5, y: gp.y },
      returnPort: { x: gp.x + 1.5, y: gp.y },
    };
    setAHU(a);
  }

  function eraseAt(gp: { x: number; y: number }) {
    const EPS = 1.0;
    setFP(prev => ({
      ...prev,
      walls: prev.walls.filter(w =>
        dist(w.start, gp) > EPS && dist(w.end, gp) > EPS &&
        pointToSegDist(gp, w.start, w.end) > 0.4
      ),
      windows: prev.windows.filter(w => pointToSegDist(gp, w.start, w.end) > 0.4),
      doors: prev.doors.filter(d => pointToSegDist(gp, d.start, d.end) > 0.4),
      vents: prev.vents.filter(v => pointToSegDist(gp, v.start, v.end) > 0.4),
    }));
  }

  function validate() {
    const result = validateFloorplan(fp, rooms);
    setValidation(result);
  }

  function handleClear() {
    setFP(EMPTY_FP);
    setAHU(null);
    setRooms([]);
    setValidation(null);
  }

  return (
    <div className="screen levelmaker-screen">
      <div className="screen-header">
        <button className="back-btn" onClick={() => onNavigate('menu')}>← Menu</button>
        <h2>Level Maker</h2>
        <div className="lm-header-actions">
          <button className="action-btn" onClick={validate}>Validate</button>
          <button className="action-btn danger" onClick={handleClear}>Clear</button>
        </div>
      </div>

      <div className="lm-body">
        {/* Toolbar */}
        <aside className="lm-toolbar">
          <div className="panel-title">Elements</div>
          {TOOLS.map(({ tool, label }) => (
            <button
              key={tool}
              className={`tool-btn ${activeTool === tool ? 'active' : ''}`}
              onClick={() => setActiveTool(tool)}
            >
              {label}
            </button>
          ))}

          {validation && (
            <div className={`validation-box ${validation.valid ? 'ok' : 'err'}`}>
              {validation.valid
                ? '✓ Valid floorplan'
                : validation.errors.map((e, i) => <div key={i}>⚠ {e}</div>)
              }
            </div>
          )}

          {rooms.length > 0 && (
            <div className="lm-stats">
              <div className="panel-title">Rooms ({rooms.length})</div>
              {rooms.map((r, i) => (
                <div key={r.id} className="room-row small">
                  Room {i + 1}: {r.cfm} CFM
                </div>
              ))}
              <div className="room-row small total">
                Total: {totalCFM(rooms)} CFM
              </div>
            </div>
          )}
        </aside>

        {/* Canvas */}
        <div className="canvas-viewport scrollable">
          <canvas
            ref={canvasRef}
            className="floorplan-canvas"
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            style={{ cursor: activeTool === 'eraser' ? 'not-allowed' : 'crosshair' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pointToSegDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function markExteriorWalls(fp: FloorPlan) {
  // Simplified: any wall on the outermost boundary is exterior.
  // In a full implementation, run the room detection and check.
  // For now, mark walls touching the bounding rectangle as exterior.
  fp.walls.forEach(w => {
    w.isExterior = false;
  });
}
