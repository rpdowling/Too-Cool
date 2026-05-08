/**
 * DuctCanvas – transparent overlay canvas for duct drawing interaction.
 *
 * Renders (on top of FloorplanCanvas):
 *   • Placed duct segments (double-line Revit style)
 *   • Diffusers (supply = blue square-X, return = red square-X)
 *   • Transitions
 *   • In-progress drawing preview
 *   • Optimal solution overlay (when toggled)
 *   • Hover popup for diffuser resize
 *
 * Interaction model:
 *   supply/return duct tool:
 *     mousedown → start segment at snapped grid point
 *     mousemove → preview with orthogonal/45° snap
 *     mouseup   → place segment, auto-size, check if ends on room → place diffuser
 *   diffuser tool:
 *     click in room → place/cycle diffuser
 *   eraser:
 *     click near segment/diffuser → remove
 */
import React, { useRef, useEffect, useCallback } from 'react';
import type {
  FloorPlan, Room, AHU, DuctSystem, DuctSegment, Diffuser, Transition,
  DrawingTool, DuctSize, GridPoint, Level,
} from '../types';
import { GRID_PX, CANVAS_PAD, gridToPixel, pixelToGrid, snapToGridPoint, snapDuctAngle, uid, dist, segLen } from '../game/utils';
import { autoSizeDuct, DUCT_MAX_CFM, ductLineGap, sizeDiffusersForRoom } from '../game/ductSizing';

interface Props {
  width: number;
  height: number;
  level: Level;
  ductSystem: DuctSystem;
  activeTool: DrawingTool;
  selectedSize: DuctSize;
  currentLayer: number;
  showOptimal: boolean;
  onDuctSystemChange: (ds: DuctSystem) => void;
  onLayerChange: (layer: number) => void;
}

// Rendering constants
const SUPPLY_COLOR = '#3b82f6';
const RETURN_COLOR = '#ef4444';
const OPTIMAL_COLOR = 'rgba(34,197,94,0.6)';
const PREVIEW_COLOR = 'rgba(59,130,246,0.5)';
const LABEL_BG = 'rgba(255,255,255,0.85)';

// ─── Main component ────────────────────────────────────────────────────────────

export function DuctCanvas({
  width, height, level, ductSystem, activeTool, selectedSize,
  currentLayer, showOptimal, onDuctSystemChange, onLayerChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    isDrawing: false,
    drawStart: null as GridPoint | null,
    previewEnd: null as GridPoint | null,
    hoveredDiffId: null as string | null,
    popupDiffId: null as string | null,
  });

  // ─── render ──────────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);

    const s = stateRef.current;

    // Optimal overlay
    if (showOptimal) drawDuctSystem(ctx, level.optimalDuctSystem, OPTIMAL_COLOR, 'rgba(34,197,94,0.35)', true);

    // Player system
    drawDuctSystem(ctx, ductSystem, SUPPLY_COLOR, RETURN_COLOR, false);

    // Preview
    if (s.isDrawing && s.drawStart && s.previewEnd) {
      const cfm = estimateCFMForPreview(ductSystem, s.drawStart, activeTool === 'duct_return');
      drawDuctSegPreview(ctx, s.drawStart, s.previewEnd, selectedSize, cfm);
    }

    // Diffuser popups
    if (s.popupDiffId) {
      const diff = ductSystem.diffusers.find(d => d.id === s.popupDiffId);
      if (diff) drawSizePopup(ctx, diff);
    }
  }, [width, height, level, ductSystem, activeTool, selectedSize, currentLayer, showOptimal]);

  useEffect(() => { render(); }, [render]);

  // ─── event handlers ───────────────────────────────────────────────────────────

  function getGridPos(e: React.MouseEvent<HTMLCanvasElement>): GridPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    const raw = pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
    return snapToGridPoint(raw);
  }

  function getGridPosHalf(e: React.MouseEvent<HTMLCanvasElement>): GridPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    const raw = pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
    return { x: Math.round(raw.x * 2) / 2, y: Math.round(raw.y * 2) / 2 };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;

    // Close popup if open
    if (stateRef.current.popupDiffId) {
      stateRef.current.popupDiffId = null;
      render();
      return;
    }

    const gp = getGridPos(e);

    if (activeTool === 'duct_supply' || activeTool === 'duct_return') {
      stateRef.current.isDrawing = true;
      stateRef.current.drawStart = gp;
      stateRef.current.previewEnd = gp;
    }

    if (activeTool === 'diffuser_supply' || activeTool === 'diffuser_return') {
      const isReturn = activeTool === 'diffuser_return';
      placeDiffuser(gp, isReturn);
    }

    if (activeTool === 'transition_rise') {
      onLayerChange(Math.min(1, currentLayer + 1));
    }
    if (activeTool === 'transition_drop') {
      onLayerChange(Math.max(0, currentLayer - 1));
    }

    if (activeTool === 'eraser') {
      eraseAt(gp);
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!stateRef.current.isDrawing || !stateRef.current.drawStart) return;
    const raw = pixelToGrid(
      e.clientX - canvasRef.current!.getBoundingClientRect().left,
      e.clientY - canvasRef.current!.getBoundingClientRect().top,
    );
    const snapped = snapToGridPoint(raw);
    stateRef.current.previewEnd = snapDuctAngle(stateRef.current.drawStart, snapped);
    render();
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const s = stateRef.current;
    if (!s.isDrawing || !s.drawStart) return;

    const endRaw = pixelToGrid(
      e.clientX - canvasRef.current!.getBoundingClientRect().left,
      e.clientY - canvasRef.current!.getBoundingClientRect().top,
    );
    const endSnapped = snapToGridPoint(endRaw);
    const endPos = snapDuctAngle(s.drawStart, endSnapped);

    s.isDrawing = false;

    if (dist(s.drawStart, endPos) < 0.1) {
      render();
      return;
    }

    const isReturn = activeTool === 'duct_return';
    const cfm = estimateCFMForSegment(ductSystem, s.drawStart, endPos, isReturn);

    const newSeg: DuctSegment = {
      id: uid(),
      start: s.drawStart,
      end: endPos,
      size: selectedSize,
      cfm,
      layer: currentLayer,
      isReturn,
    };

    const newSystem = { ...ductSystem, segments: [...ductSystem.segments, newSeg] };

    // Auto-place diffuser if endpoint is inside a room
    const room = findRoomAtPoint(endPos, level.rooms);
    if (room && !isReturn) {
      const existing = newSystem.diffusers.filter(d => d.roomId === room.id && !d.isReturn).length;
      const count = existing + 1;
      const { cfm: dCFM, size } = sizeDiffusersForRoom(room.cfm, count);
      const newDiff: Diffuser = {
        id: uid(),
        position: endPos,
        roomId: room.id,
        size,
        cfm: dCFM,
        isReturn: false,
      };
      newSystem.diffusers = [...newSystem.diffusers, newDiff];
      // Re-size existing supply diffusers in same room
      newSystem.diffusers = newSystem.diffusers.map(d =>
        d.roomId === room.id && !d.isReturn ? { ...d, ...sizeDiffusersForRoom(room.cfm, count) } : d
      );
    }
    if (room && isReturn) {
      const existing = newSystem.diffusers.filter(d => d.roomId === room.id && d.isReturn).length;
      const count = existing + 1;
      const { cfm: dCFM, size } = sizeDiffusersForRoom(room.cfm, count);
      const retGrille: Diffuser = {
        id: uid(),
        position: endPos,
        roomId: room.id,
        size,
        cfm: dCFM,
        isReturn: true,
      };
      newSystem.diffusers = [...newSystem.diffusers, retGrille];
    }

    onDuctSystemChange(newSystem);
    s.drawStart = null;
    render();
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const gp = getGridPosHalf(e);
    const diff = findDiffuserAt(gp, ductSystem.diffusers);
    if (diff) {
      stateRef.current.popupDiffId = diff.id;
      render();
    }
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    stateRef.current.isDrawing = false;
    stateRef.current.drawStart = null;
    render();
  }

  // ─── Duct operations ──────────────────────────────────────────────────────────

  function placeDiffuser(gp: GridPoint, isReturn: boolean) {
    const room = findRoomAtPoint(gp, level.rooms);
    if (!room) return;
    const existing = ductSystem.diffusers.filter(d => d.roomId === room.id && d.isReturn === isReturn).length;
    const count = existing + 1;
    const { cfm, size } = sizeDiffusersForRoom(room.cfm, count);
    const newDiff: Diffuser = { id: uid(), position: gp, roomId: room.id, size, cfm, isReturn };
    const updated = {
      ...ductSystem,
      diffusers: [
        ...ductSystem.diffusers.map(d =>
          d.roomId === room.id && d.isReturn === isReturn
            ? { ...d, cfm, size } : d
        ),
        newDiff,
      ],
    };
    onDuctSystemChange(updated);
  }

  function eraseAt(gp: GridPoint) {
    const EPS = 0.6;
    const diffIdx = ductSystem.diffusers.findIndex(d => dist(d.position, gp) < EPS);
    if (diffIdx >= 0) {
      const newDiffs = ductSystem.diffusers.filter((_, i) => i !== diffIdx);
      onDuctSystemChange({ ...ductSystem, diffusers: newDiffs });
      return;
    }
    // Find closest segment endpoint
    const segIdx = ductSystem.segments.findIndex(
      s => dist(s.start, gp) < EPS || dist(s.end, gp) < EPS
    );
    if (segIdx >= 0) {
      const newSegs = ductSystem.segments.filter((_, i) => i !== segIdx);
      onDuctSystemChange({ ...ductSystem, segments: newSegs });
    }
  }

  function resizeDiffuser(diffId: string, size: DuctSize) {
    const diff = ductSystem.diffusers.find(d => d.id === diffId);
    if (!diff) return;
    const newCFM = Math.min(diff.cfm, DUCT_MAX_CFM[size]);
    onDuctSystemChange({
      ...ductSystem,
      diffusers: ductSystem.diffusers.map(d =>
        d.id === diffId ? { ...d, size, cfm: newCFM } : d
      ),
    });
    stateRef.current.popupDiffId = null;
  }

  // ─── Render helpers ───────────────────────────────────────────────────────────

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="duct-canvas"
      style={{ width, height, position: 'absolute', top: 0, left: 0, cursor: getCursor(activeTool) }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    />
  );
}

// ─── Canvas drawing functions ─────────────────────────────────────────────────

function drawDuctSystem(
  ctx: CanvasRenderingContext2D,
  ds: DuctSystem,
  supplyColor: string,
  returnColor: string,
  ghost: boolean,
) {
  // Draw lower-layer segments dimmed
  for (const seg of ds.segments) {
    const alpha = ghost ? 0.4 : seg.layer > 0 ? 0.35 : 1;
    drawDuctSeg(ctx, seg, seg.isReturn ? returnColor : supplyColor, alpha);
  }
  // Diffusers on top
  for (const diff of ds.diffusers) {
    drawDiffuser(ctx, diff, diff.isReturn ? returnColor : supplyColor, ghost ? 0.5 : 1);
  }
}

function drawDuctSeg(
  ctx: CanvasRenderingContext2D,
  seg: DuctSegment,
  color: string,
  alpha: number,
) {
  const pa = gridToPixel(seg.start);
  const pb = gridToPixel(seg.end);
  const gap = ductLineGap(seg.size);

  ctx.save();
  ctx.globalAlpha = alpha;

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) { ctx.restore(); return; }

  const nx = -dy / len;
  const ny = dx / len;
  const half = gap / 2;

  // Fill between lines
  ctx.fillStyle = seg.isReturn ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)';
  ctx.beginPath();
  ctx.moveTo(pa.x + nx * half, pa.y + ny * half);
  ctx.lineTo(pb.x + nx * half, pb.y + ny * half);
  ctx.lineTo(pb.x - nx * half, pb.y - ny * half);
  ctx.lineTo(pa.x - nx * half, pa.y - ny * half);
  ctx.closePath();
  ctx.fill();

  // Double lines
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pa.x + nx * half, pa.y + ny * half);
  ctx.lineTo(pb.x + nx * half, pb.y + ny * half);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pa.x - nx * half, pa.y - ny * half);
  ctx.lineTo(pb.x - nx * half, pb.y - ny * half);
  ctx.stroke();

  // Size label at midpoint
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  ctx.fillStyle = color;
  ctx.font = `bold ${GRID_PX * 0.17}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = LABEL_BG;
  ctx.fillRect(mx - 18, my - 8, 36, 16);
  ctx.fillStyle = color;
  ctx.fillText(`${seg.size}" | ${seg.cfm}`, mx, my);

  ctx.restore();
}

function drawDuctSegPreview(
  ctx: CanvasRenderingContext2D,
  start: GridPoint,
  end: GridPoint,
  size: DuctSize,
  cfm: number,
) {
  const fakeSeg: DuctSegment = { id: '', start, end, size, cfm, layer: 0, isReturn: false };
  drawDuctSeg(ctx, fakeSeg, PREVIEW_COLOR, 0.7);
}

function drawDiffuser(
  ctx: CanvasRenderingContext2D,
  diff: Diffuser,
  color: string,
  alpha: number,
) {
  const p = gridToPixel(diff.position);
  const r = GRID_PX * 0.22;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Square body
  ctx.fillStyle = 'white';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);

  // X cross
  ctx.beginPath();
  ctx.moveTo(p.x - r * 0.7, p.y - r * 0.7);
  ctx.lineTo(p.x + r * 0.7, p.y + r * 0.7);
  ctx.moveTo(p.x + r * 0.7, p.y - r * 0.7);
  ctx.lineTo(p.x - r * 0.7, p.y + r * 0.7);
  ctx.stroke();

  // CFM label below
  ctx.fillStyle = color;
  ctx.font = `${GRID_PX * 0.16}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${diff.size}"/${diff.cfm}`, p.x, p.y + r + 2);

  ctx.restore();
}

function drawSizePopup(ctx: CanvasRenderingContext2D, diff: Diffuser) {
  const p = gridToPixel(diff.position);
  const sizes: DuctSize[] = [4, 6, 8, 12];
  const bw = 46, bh = 22, gap = 4;
  const totalW = sizes.length * (bw + gap) - gap;
  const ox = p.x - totalW / 2;
  const oy = p.y - 70;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.roundRect?.(ox - 8, oy - 8, totalW + 16, bh + 16, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold ${GRID_PX * 0.18}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  sizes.forEach((s, i) => {
    const bx = ox + i * (bw + gap);
    const active = s === diff.size;
    ctx.fillStyle = active ? '#3b82f6' : '#e2e8f0';
    ctx.roundRect?.(bx, oy, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = active ? 'white' : '#334155';
    ctx.fillText(`${s}"`, bx + bw / 2, oy + bh / 2);
  });

  ctx.restore();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findRoomAtPoint(gp: GridPoint, rooms: Room[]): Room | null {
  const cellX = Math.floor(gp.x);
  const cellY = Math.floor(gp.y);
  return rooms.find(r => r.cells.some(c => c.x === cellX && c.y === cellY)) ?? null;
}

function findDiffuserAt(gp: GridPoint, diffs: Diffuser[]): Diffuser | null {
  const EPS = 0.5;
  return diffs.find(d => dist(d.position, gp) < EPS) ?? null;
}

function estimateCFMForPreview(ds: DuctSystem, start: GridPoint, isReturn: boolean): number {
  // Simple: count diffuser CFMs that this run might be feeding
  return ds.diffusers.filter(d => d.isReturn === isReturn).reduce((s, d) => s + d.cfm, 0) || 100;
}

function estimateCFMForSegment(
  ds: DuctSystem,
  start: GridPoint,
  end: GridPoint,
  isReturn: boolean,
): number {
  return estimateCFMForPreview(ds, start, isReturn);
}

function getCursor(tool: DrawingTool): string {
  switch (tool) {
    case 'duct_supply': case 'duct_return': return 'crosshair';
    case 'diffuser_supply': case 'diffuser_return': return 'cell';
    case 'eraser': return 'not-allowed';
    default: return 'default';
  }
}
