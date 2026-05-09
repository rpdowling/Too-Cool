/**
 * DuctCanvas – transparent overlay canvas for duct drawing.
 *
 * Drawing model:
 *   – Click+drag draws an L-shaped route (horizontal-first) made of two
 *     orthogonal segments.  Straight runs stay as one segment.
 *   – Elbows (square fittings) are rendered wherever two segments share an
 *     endpoint.
 *   – Duct size snaps to the selected size; player can resize via double-click
 *     popup.
 *   – Supply = blue, return = red, optimal overlay = green ghost.
 *
 * Interaction:
 *   mousedown  → start draw (duct tool) or place diffuser
 *   mousemove  → preview L-route
 *   mouseup    → commit segment(s); auto-place diffuser when endpoint is inside a room
 *   dblclick   → open size-resize popup on a diffuser
 *   contextmenu→ cancel in-progress draw
 */
import React, { useRef, useEffect, useCallback } from 'react';
import type {
  FloorPlan, Room, AHU, DuctSystem, DuctSegment, Diffuser,
  DrawingTool, DuctSize, GridPoint, Level,
} from '../types';
import {
  GRID_PX, CANVAS_PAD, gridToPixel, pixelToGrid, snapToGridPoint,
  uid, dist, segLen, isOnWallOrDoor,
} from '../game/utils';
import { autoSizeDuct, DUCT_MAX_CFM, ductLineGap, sizeDiffusersForRoom } from '../game/ductSizing';
import { computeServedRooms, computeSupplyServedRooms } from '../game/connectivity';

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

const SUPPLY_COLOR  = '#3b82f6';
const RETURN_COLOR  = '#ef4444';
const OPTIMAL_COLOR = 'rgba(34,197,94,0.75)';
const PREVIEW_COLOR = 'rgba(59,130,246,0.55)';
const LABEL_BG      = 'rgba(255,255,255,0.88)';

// ─── Component ────────────────────────────────────────────────────────────────

export function DuctCanvas({
  width, height, level, ductSystem, activeTool, selectedSize,
  currentLayer, showOptimal, onDuctSystemChange, onLayerChange,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const stateRef    = useRef({
    isDrawing:    false,
    drawStart:    null as GridPoint | null,
    previewEnd:   null as GridPoint | null,
    popupDiffId:  null as string | null,
  });

  // ── render ────────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);

    const s = stateRef.current;

    // Green overlay on rooms that have a supply diffuser connected to the AHU
    drawServedRoomOverlay(ctx, level, ductSystem);

    if (showOptimal) {
      drawDuctSystem(ctx, level.optimalDuctSystem, OPTIMAL_COLOR, OPTIMAL_COLOR, true);
    }

    drawDuctSystem(ctx, ductSystem, SUPPLY_COLOR, RETURN_COLOR, false);

    // Preview L-route
    if (s.isDrawing && s.drawStart && s.previewEnd) {
      const { seg1, seg2, corner } = lRoute(s.drawStart, s.previewEnd);
      const isReturn = activeTool === 'duct_return';
      if (seg1) drawSegPreview(ctx, seg1.start, seg1.end, selectedSize, isReturn);
      if (seg2) drawSegPreview(ctx, seg2.start, seg2.end, selectedSize, isReturn);
      if (corner) drawElbow(ctx, corner, selectedSize, isReturn ? PREVIEW_COLOR : PREVIEW_COLOR, 0.7);
    }

    // Resize popup
    if (s.popupDiffId) {
      const d = ductSystem.diffusers.find(x => x.id === s.popupDiffId);
      if (d) drawSizePopup(ctx, d);
    }
  }, [width, height, level, ductSystem, activeTool, selectedSize, currentLayer, showOptimal]);

  useEffect(() => { render(); }, [render]);

  // ── mouse helpers ─────────────────────────────────────────────────────────

  function gpFromEvent(e: React.MouseEvent<HTMLCanvasElement>): GridPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return snapToGridPoint(pixelToGrid(e.clientX - rect.left, e.clientY - rect.top));
  }

  // ── handlers ──────────────────────────────────────────────────────────────

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;

    // Close popup on any click
    if (stateRef.current.popupDiffId) {
      stateRef.current.popupDiffId = null;
      render();
      return;
    }

    const gp = gpFromEvent(e);

    if (activeTool === 'duct_supply' || activeTool === 'duct_return') {
      stateRef.current.isDrawing  = true;
      stateRef.current.drawStart  = gp;
      stateRef.current.previewEnd = gp;
      return;
    }

    if (activeTool === 'diffuser_supply') { placeDiffuser(gp, false); return; }
    if (activeTool === 'diffuser_return') { placeDiffuser(gp, true);  return; }
    if (activeTool === 'transition_rise') { onLayerChange(Math.min(1, currentLayer + 1)); return; }
    if (activeTool === 'transition_drop') { onLayerChange(Math.max(0, currentLayer - 1)); return; }
    if (activeTool === 'eraser')          { eraseAt(gp); return; }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!stateRef.current.isDrawing || !stateRef.current.drawStart) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    stateRef.current.previewEnd = snapToGridPoint(
      pixelToGrid(e.clientX - rect.left, e.clientY - rect.top)
    );
    render();
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const s = stateRef.current;
    if (!s.isDrawing || !s.drawStart) return;

    const endPt = snapToGridPoint(
      pixelToGrid(
        e.clientX - canvasRef.current!.getBoundingClientRect().left,
        e.clientY - canvasRef.current!.getBoundingClientRect().top,
      )
    );

    s.isDrawing  = false;
    s.previewEnd = null;

    if (dist(s.drawStart, endPt) < 0.1) { s.drawStart = null; render(); return; }

    const isReturn = activeTool === 'duct_return';
    const cfm = estimateCFM(ductSystem, isReturn);

    const { seg1, seg2 } = lRoute(s.drawStart, endPt);
    const newSegs: DuctSegment[] = [];
    if (seg1) newSegs.push({ id: uid(), ...seg1, size: selectedSize, cfm, layer: currentLayer, isReturn });
    if (seg2) newSegs.push({ id: uid(), ...seg2, size: selectedSize, cfm, layer: currentLayer, isReturn });

    const newSystem: DuctSystem = { ...ductSystem, segments: [...ductSystem.segments, ...newSegs] };

    s.drawStart = null;
    onDuctSystemChange(newSystem);
    render();
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const gp = gpFromEvent(e);
    const EPS = 0.6;
    const diff = ductSystem.diffusers.find(d => dist(d.position, gp) < EPS);
    if (diff) { stateRef.current.popupDiffId = diff.id; render(); }
  }

  function handlePopupClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const pid = stateRef.current.popupDiffId;
    if (!pid) return;
    const diff = ductSystem.diffusers.find(d => d.id === pid);
    if (!diff) return;

    const p = gridToPixel(diff.position);
    const sizes: DuctSize[] = [4, 6, 8, 12];
    const bw = 46, bh = 22, gap = 4;
    const totalW = sizes.length * (bw + gap) - gap;
    const ox = p.x - totalW / 2;
    const oy = p.y - 70;

    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    sizes.forEach((s, i) => {
      const bx = ox + i * (bw + gap);
      if (mx >= bx && mx <= bx + bw && my >= oy && my <= oy + bh) {
        resizeDiffuser(pid, s);
      }
    });
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    stateRef.current.isDrawing  = false;
    stateRef.current.drawStart  = null;
    stateRef.current.previewEnd = null;
    render();
  }

  // ── duct operations ───────────────────────────────────────────────────────

  function placeDiffuser(gp: GridPoint, isReturn: boolean) {
    const room = roomAtPoint(gp, level.rooms);
    if (!room) return;
    if (isOnWallOrDoor(gp, level.floorplan)) return;
    // Short-circuit rule: supply and return can't be within 2 grid units of each other
    const opposite = ductSystem.diffusers.filter(d => d.roomId === room.id && d.isReturn !== isReturn);
    if (opposite.some(d => dist(d.position, gp) < 2.0)) return;
    onDuctSystemChange(autoPlaceDiffuser(ductSystem, gp, room, isReturn));
  }

  function eraseAt(gp: GridPoint) {
    const EPS = 0.6;
    const diffIdx = ductSystem.diffusers.findIndex(d => dist(d.position, gp) < EPS);
    if (diffIdx >= 0) {
      onDuctSystemChange({ ...ductSystem, diffusers: ductSystem.diffusers.filter((_, i) => i !== diffIdx) });
      return;
    }
    // Erase segment whose start or end is within EPS
    const segIdx = ductSystem.segments.findIndex(
      s => dist(s.start, gp) < EPS || dist(s.end, gp) < EPS
    );
    if (segIdx >= 0) {
      onDuctSystemChange({ ...ductSystem, segments: ductSystem.segments.filter((_, i) => i !== segIdx) });
    }
  }

  function resizeDiffuser(diffId: string, size: DuctSize) {
    const diff = ductSystem.diffusers.find(d => d.id === diffId);
    if (!diff) return;
    onDuctSystemChange({
      ...ductSystem,
      diffusers: ductSystem.diffusers.map(d =>
        d.id === diffId ? { ...d, size, cfm: Math.min(d.cfm, DUCT_MAX_CFM[size]) } : d
      ),
    });
    stateRef.current.popupDiffId = null;
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="duct-canvas"
      style={{ width, height, position: 'absolute', top: 0, left: 0, cursor: cursorFor(activeTool) }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={e => { handleMouseUp(e); handlePopupClick(e); }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    />
  );
}

// ─── L-route helper ───────────────────────────────────────────────────────────

type PartialSeg = { start: GridPoint; end: GridPoint };

function lRoute(
  from: GridPoint,
  to: GridPoint,
): { seg1: PartialSeg | null; seg2: PartialSeg | null; corner: GridPoint | null } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) return { seg1: null, seg2: null, corner: null };
  if (dx === 0) return { seg1: { start: from, end: to }, seg2: null, corner: null };
  if (dy === 0) return { seg1: { start: from, end: to }, seg2: null, corner: null };

  // Horizontal-first L
  const corner: GridPoint = { x: to.x, y: from.y };
  return {
    seg1:   { start: from, end: corner },
    seg2:   { start: corner, end: to },
    corner,
  };
}

// ─── Canvas drawing functions ─────────────────────────────────────────────────

function drawDuctSystem(
  ctx: CanvasRenderingContext2D,
  ds: DuctSystem,
  supplyColor: string,
  returnColor: string,
  ghost: boolean,
) {
  const alpha = ghost ? 0.5 : 1;

  // Segments (lower-layer ducts are dimmed)
  for (const seg of ds.segments) {
    const a = ghost ? 0.45 : seg.layer > 0 ? 0.35 : 1;
    drawSeg(ctx, seg, seg.isReturn ? returnColor : supplyColor, a, ghost);
  }

  // Elbows at every junction (where two or more segments share an endpoint)
  const elbowPts = findElbowPoints(ds.segments);
  for (const ep of elbowPts) {
    const color = ep.isReturn ? returnColor : supplyColor;
    drawElbow(ctx, ep.point, ep.size, color, ghost ? 0.45 : 1);
  }

  // Diffusers on top
  for (const d of ds.diffusers) {
    drawDiffuser(ctx, d, d.isReturn ? returnColor : supplyColor, alpha);
  }
}

function drawSeg(
  ctx: CanvasRenderingContext2D,
  seg: DuctSegment,
  color: string,
  alpha: number,
  skipLabel = false,
) {
  const pa = gridToPixel(seg.start);
  const pb = gridToPixel(seg.end);
  const gap = ductLineGap(seg.size);
  const len = Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2);
  if (len < 2) return;

  const nx = -(pb.y - pa.y) / len;
  const ny =  (pb.x - pa.x) / len;
  const h = gap / 2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Fill between lines
  ctx.fillStyle = seg.isReturn ? 'rgba(239,68,68,0.07)' : 'rgba(59,130,246,0.07)';
  ctx.beginPath();
  ctx.moveTo(pa.x + nx * h, pa.y + ny * h);
  ctx.lineTo(pb.x + nx * h, pb.y + ny * h);
  ctx.lineTo(pb.x - nx * h, pb.y - ny * h);
  ctx.lineTo(pa.x - nx * h, pa.y - ny * h);
  ctx.closePath();
  ctx.fill();

  // Two outer lines
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'butt';
  for (const sign of [1, -1] as const) {
    ctx.beginPath();
    ctx.moveTo(pa.x + nx * h * sign, pa.y + ny * h * sign);
    ctx.lineTo(pb.x + nx * h * sign, pb.y + ny * h * sign);
    ctx.stroke();
  }

  // CFM / size label at midpoint (skip for optimal ghost)
  if (!skipLabel) {
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    ctx.font = `bold ${GRID_PX * 0.16}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const txt = `${seg.size}" · ${seg.cfm}`;
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = LABEL_BG;
    ctx.fillRect(mx - tw / 2 - 3, my - 8, tw + 6, 16);
    ctx.fillStyle = color;
    ctx.fillText(txt, mx, my);
  }

  ctx.restore();
}

function drawSegPreview(
  ctx: CanvasRenderingContext2D,
  start: GridPoint,
  end: GridPoint,
  size: DuctSize,
  isReturn: boolean,
) {
  const fakeSeg: DuctSegment = { id: '', start, end, size, cfm: 0, layer: 0, isReturn };
  drawSeg(ctx, fakeSeg, PREVIEW_COLOR, 0.7, true);
}

function drawElbow(
  ctx: CanvasRenderingContext2D,
  point: GridPoint,
  size: DuctSize,
  color: string,
  alpha: number,
) {
  const p = gridToPixel(point);
  const r = ductLineGap(size) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color.startsWith('rgba') ? color : color + '18';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.restore();
}

function drawDiffuser(
  ctx: CanvasRenderingContext2D,
  d: Diffuser,
  color: string,
  alpha: number,
) {
  const p = gridToPixel(d.position);
  const r = GRID_PX * 0.22;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.beginPath();
  ctx.moveTo(p.x - r * 0.68, p.y - r * 0.68);
  ctx.lineTo(p.x + r * 0.68, p.y + r * 0.68);
  ctx.moveTo(p.x + r * 0.68, p.y - r * 0.68);
  ctx.lineTo(p.x - r * 0.68, p.y + r * 0.68);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `${GRID_PX * 0.155}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${d.size}"/${d.cfm}`, p.x, p.y + r + 2);
  ctx.restore();
}

function drawSizePopup(ctx: CanvasRenderingContext2D, diff: Diffuser) {
  const p = gridToPixel(diff.position);
  const sizes: DuctSize[] = [4, 6, 8, 12];
  const bw = 46, bh = 24, gap = 4;
  const totalW = sizes.length * (bw + gap) - gap;
  const ox = p.x - totalW / 2;
  const oy = p.y - 76;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.fillRect(ox - 10, oy - 10, totalW + 20, bh + 20);
  ctx.strokeRect(ox - 10, oy - 10, totalW + 20, bh + 20);

  ctx.font = `bold ${GRID_PX * 0.18}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  sizes.forEach((s, i) => {
    const bx = ox + i * (bw + gap);
    ctx.fillStyle = s === diff.size ? '#3b82f6' : '#e2e8f0';
    ctx.fillRect(bx, oy, bw, bh);
    ctx.fillStyle = s === diff.size ? 'white' : '#334155';
    ctx.fillText(`${s}"`, bx + bw / 2, oy + bh / 2);
  });
  ctx.restore();
}

// ─── Served-room overlay ──────────────────────────────────────────────────────

function drawServedRoomOverlay(
  ctx: CanvasRenderingContext2D,
  level: Level,
  ds: DuctSystem,
) {
  const fullyServed = computeServedRooms(ds, level.ahu, level.rooms);
  const supplyOnly  = computeSupplyServedRooms(ds, level.ahu);

  ctx.save();
  for (const room of level.rooms) {
    if (fullyServed.has(room.id)) {
      // Blue: supply + return both connected to AHU
      ctx.fillStyle = 'rgba(59, 130, 246, 0.30)';
    } else if (supplyOnly.has(room.id)) {
      // Amber: supply connected but no return yet
      ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
    } else {
      continue;
    }
    for (const cell of room.cells) {
      const { x, y } = gridToPixel(cell);
      ctx.fillRect(x, y, GRID_PX, GRID_PX);
    }
  }
  ctx.restore();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roomAtPoint(gp: GridPoint, rooms: Room[]): Room | null {
  const cx = Math.floor(gp.x);
  const cy = Math.floor(gp.y);
  return rooms.find(r => r.cells.some(c => c.x === cx && c.y === cy)) ?? null;
}

function autoPlaceDiffuser(
  ds: DuctSystem,
  position: GridPoint,
  room: Room,
  isReturn: boolean,
): DuctSystem {
  const existing = ds.diffusers.filter(d => d.roomId === room.id && d.isReturn === isReturn).length;
  const count = existing + 1;
  const { cfm, size } = sizeDiffusersForRoom(room.cfm, count);
  const newDiff: Diffuser = { id: uid(), position, roomId: room.id, size, cfm, isReturn };
  return {
    ...ds,
    diffusers: [
      ...ds.diffusers.map(d =>
        d.roomId === room.id && d.isReturn === isReturn ? { ...d, cfm, size } : d
      ),
      newDiff,
    ],
  };
}

function estimateCFM(ds: DuctSystem, isReturn: boolean): number {
  const total = ds.diffusers.filter(d => d.isReturn === isReturn).reduce((s, d) => s + d.cfm, 0);
  return total || 100;
}

interface ElbowPoint { point: GridPoint; size: DuctSize; isReturn: boolean }

function findElbowPoints(segs: DuctSegment[]): ElbowPoint[] {
  type Entry = { count: number; size: DuctSize; isReturn: boolean };
  const map = new Map<string, Entry>();

  for (const seg of segs) {
    for (const pt of [seg.start, seg.end]) {
      const k = `${pt.x},${pt.y}`;
      const e = map.get(k);
      if (e) { e.count++; }
      else { map.set(k, { count: 1, size: seg.size, isReturn: seg.isReturn }); }
    }
  }

  const result: ElbowPoint[] = [];
  for (const [key, entry] of map) {
    if (entry.count >= 2) {
      const [x, y] = key.split(',').map(Number);
      result.push({ point: { x, y }, size: entry.size, isReturn: entry.isReturn });
    }
  }
  return result;
}

function cursorFor(tool: DrawingTool): string {
  if (tool === 'duct_supply' || tool === 'duct_return') return 'crosshair';
  if (tool === 'diffuser_supply' || tool === 'diffuser_return') return 'cell';
  if (tool === 'eraser') return 'not-allowed';
  return 'default';
}
