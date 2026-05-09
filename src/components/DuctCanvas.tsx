/**
 * DuctCanvas – transparent overlay canvas for duct drawing.
 *
 * Drawing model:
 *   – Click+drag draws an L-shaped route (horizontal-first) made of two
 *     orthogonal segments.  Straight runs stay as one segment.
 *   – Elbows (square fittings) are rendered wherever two segments share an
 *     endpoint.
 *   – Duct size is AUTO-SIZED from connected diffuser CFM; no manual selection.
 *   – Supply = blue, return = red, optimal overlay = green ghost.
 *
 * Interaction:
 *   mousedown   → start draw (duct tool) or place diffuser
 *   mousemove   → preview L-route
 *   mouseup     → commit segment(s) if valid
 *   contextmenu → cancel in-progress draw
 *
 * Validation rules:
 *   – Duct may NOT pass through the interior of an existing diffuser.
 *   – Duct may NOT cross interior (non-exterior) walls.
 *   – Duct MAY cross exterior walls (always perpendicular by geometry).
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
import { autoSizeDuct, ductLineGap, sizeDiffusersForRoom } from '../game/ductSizing';
import { computeServedRooms, computeSupplyServedRooms } from '../game/connectivity';

interface Props {
  width: number;
  height: number;
  level: Level;
  ductSystem: DuctSystem;
  activeTool: DrawingTool;
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
  width, height, level, ductSystem, activeTool,
  currentLayer, showOptimal, onDuctSystemChange, onLayerChange,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const errorFlash  = useRef<number>(0);
  const stateRef    = useRef({
    isDrawing:  false,
    drawStart:  null as GridPoint | null,
    previewEnd: null as GridPoint | null,
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

    // Preview L-route with auto-sized preview
    if (s.isDrawing && s.drawStart && s.previewEnd) {
      const { seg1, seg2, corner } = lRoute(s.drawStart, s.previewEnd);
      const isReturn = activeTool === 'duct_return';
      const previewCfm = estimateCFM(ductSystem, isReturn);
      const previewSize = autoSizeDuct(Math.max(1, previewCfm));
      if (seg1) drawSegPreview(ctx, seg1.start, seg1.end, previewSize, isReturn);
      if (seg2) drawSegPreview(ctx, seg2.start, seg2.end, previewSize, isReturn);
      if (corner) drawElbow(ctx, corner, previewSize, PREVIEW_COLOR, 0.7);
    }

    // Error flash
    if (Date.now() - errorFlash.current < 500) {
      ctx.fillStyle = 'rgba(239,68,68,0.22)';
      ctx.fillRect(0, 0, width, height);
    }
  }, [width, height, level, ductSystem, activeTool, currentLayer, showOptimal]);

  useEffect(() => { render(); }, [render]);

  // ── mouse helpers ─────────────────────────────────────────────────────────

  function gpFromEvent(e: React.MouseEvent<HTMLCanvasElement>): GridPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return snapToGridPoint(pixelToGrid(e.clientX - rect.left, e.clientY - rect.top));
  }

  // ── handlers ──────────────────────────────────────────────────────────────

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;

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
    const size = autoSizeDuct(Math.max(1, cfm));

    const { seg1, seg2 } = lRoute(s.drawStart, endPt);
    const newSegs: DuctSegment[] = [];
    if (seg1) newSegs.push({ id: uid(), ...seg1, size: selectedSize, cfm, layer: 0, isReturn });
    if (seg2) newSegs.push({ id: uid(), ...seg2, size: selectedSize, cfm, layer: 0, isReturn });

    const conflicts = newSegs.some(ns => ductSystem.segments.some(es => segmentsConflict(ns, es)));
    s.drawStart = null;
    if (conflicts) { render(); return; }

    onDuctSystemChange({ ...ductSystem, segments: [...ductSystem.segments, ...newSegs] });
    render();
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
    if (isDuctFitting(gp, ductSystem.segments)) return;
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
    const segIdx = ductSystem.segments.findIndex(
      s => dist(s.start, gp) < EPS || dist(s.end, gp) < EPS
    );
    if (segIdx >= 0) {
      onDuctSystemChange({ ...ductSystem, segments: ductSystem.segments.filter((_, i) => i !== segIdx) });
    }
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
      onMouseUp={handleMouseUp}
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
  if (d.isReturn) {
    ctx.moveTo(p.x - r * 0.68, p.y);
    ctx.lineTo(p.x + r * 0.68, p.y);
  } else {
    ctx.moveTo(p.x - r * 0.68, p.y - r * 0.68);
    ctx.lineTo(p.x + r * 0.68, p.y + r * 0.68);
    ctx.moveTo(p.x + r * 0.68, p.y - r * 0.68);
    ctx.lineTo(p.x - r * 0.68, p.y + r * 0.68);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `${GRID_PX * 0.155}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${d.size}"/${d.cfm}`, p.x, p.y + r + 2);
  ctx.restore();
}


// ─── Validation helpers ───────────────────────────────────────────────────────

/** True if the segment passes through a diffuser position in its interior (not at an endpoint). */
function segPassesThroughDiffuser(
  seg: { start: GridPoint; end: GridPoint },
  diffusers: Diffuser[],
): boolean {
  const isH = seg.start.y === seg.end.y;
  const isV = seg.start.x === seg.end.x;
  for (const d of diffusers) {
    const { x, y } = d.position;
    if (isH && y === seg.start.y) {
      const lo = Math.min(seg.start.x, seg.end.x);
      const hi = Math.max(seg.start.x, seg.end.x);
      if (x > lo && x < hi) return true;
    } else if (isV && x === seg.start.x) {
      const lo = Math.min(seg.start.y, seg.end.y);
      const hi = Math.max(seg.start.y, seg.end.y);
      if (y > lo && y < hi) return true;
    }
  }
  return false;
}

/** True if the segment crosses any interior (non-exterior) wall. */
function segCrossesInteriorWall(
  seg: { start: GridPoint; end: GridPoint },
  fp: FloorPlan,
): boolean {
  const isH = seg.start.y === seg.end.y;
  const isV = seg.start.x === seg.end.x;

  for (const wall of fp.walls) {
    if (wall.isExterior) continue;
    const wallV = wall.start.x === wall.end.x;
    const wallH = wall.start.y === wall.end.y;

    if (isH && wallV) {
      const wx = wall.start.x;
      const sMinX = Math.min(seg.start.x, seg.end.x);
      const sMaxX = Math.max(seg.start.x, seg.end.x);
      const sy = seg.start.y;
      const wMinY = Math.min(wall.start.y, wall.end.y);
      const wMaxY = Math.max(wall.start.y, wall.end.y);
      if (wx > sMinX && wx < sMaxX && sy > wMinY && sy < wMaxY) return true;
    } else if (isV && wallH) {
      const wy = wall.start.y;
      const sMinY = Math.min(seg.start.y, seg.end.y);
      const sMaxY = Math.max(seg.start.y, seg.end.y);
      const sx = seg.start.x;
      const wMinX = Math.min(wall.start.x, wall.end.x);
      const wMaxX = Math.max(wall.start.x, wall.end.x);
      if (wy > sMinY && wy < sMaxY && sx > wMinX && sx < wMaxX) return true;
    }
  }
  return false;
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

/** True if new segment a would cross or overlap existing segment b (T-junctions allowed). */
function segmentsConflict(a: DuctSegment, b: DuctSegment): boolean {
  const aHoriz = a.start.y === a.end.y;
  const bHoriz = b.start.y === b.end.y;

  if (aHoriz === bHoriz) {
    if (aHoriz) {
      if (a.start.y !== b.start.y) return false;
      const ax1 = Math.min(a.start.x, a.end.x), ax2 = Math.max(a.start.x, a.end.x);
      const bx1 = Math.min(b.start.x, b.end.x), bx2 = Math.max(b.start.x, b.end.x);
      return ax1 < bx2 && bx1 < ax2;
    } else {
      if (a.start.x !== b.start.x) return false;
      const ay1 = Math.min(a.start.y, a.end.y), ay2 = Math.max(a.start.y, a.end.y);
      const by1 = Math.min(b.start.y, b.end.y), by2 = Math.max(b.start.y, b.end.y);
      return ay1 < by2 && by1 < ay2;
    }
  }

  const [h, v] = aHoriz ? [a, b] : [b, a];
  const hx1 = Math.min(h.start.x, h.end.x), hx2 = Math.max(h.start.x, h.end.x);
  const hy = h.start.y;
  const vx = v.start.x;
  const vy1 = Math.min(v.start.y, v.end.y), vy2 = Math.max(v.start.y, v.end.y);
  return vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2;
}

/** True if gp is a duct fitting: shared by 2 or more segment endpoints (elbow/junction). */
function isDuctFitting(gp: GridPoint, segments: DuctSegment[]): boolean {
  let endpoints = 0;
  for (const seg of segments) {
    if ((seg.start.x === gp.x && seg.start.y === gp.y) ||
        (seg.end.x   === gp.x && seg.end.y   === gp.y)) {
      if (++endpoints >= 2) return true;
    }
  }
  return false;
}
