/**
 * FloorplanCanvas – renders the building layout on a 2D canvas.
 *
 * Draws (bottom-up):
 *   1. Grid
 *   2. Room heat fills (gradient colours)
 *   3. Walls (normal / thick)
 *   4. Windows (blue)
 *   5. Doors (open rectangle outline)
 *   6. Vents (dashed)
 *   7. AHU box
 *   8. Room CFM overlay text (optional)
 */
import React, { useEffect, useRef } from 'react';
import type { FloorPlan, Room, AHU, AppSettings } from '../types';
import { GRID_PX, CANVAS_PAD, gridToPixel } from '../game/utils';

interface Props {
  floorplan: FloorPlan;
  rooms: Room[];
  ahu: AHU;
  settings: AppSettings;
  /** Extra grid rows to add below the building for AHU area */
  extraBelow?: number;
}

// Colours
const C_WALL_NORMAL = '#1a1a1a';
const C_WALL_THICK = '#0a0a0a';
const C_WINDOW = '#3b82f6';
const C_DOOR = '#78716c';
const C_VENT_DASH = '#a8a29e';
const C_GRID = 'rgba(0,0,0,0.07)';
const C_BG = '#f5f5f0';
const C_AHU_FILL = '#e2e8f0';
const C_AHU_STROKE = '#64748b';
const C_AHU_TEXT = '#334155';

function calcCanvasSize(fp: FloorPlan, extraBelow: number) {
  const w = CANVAS_PAD * 2 + fp.gridWidth * GRID_PX;
  const h = CANVAS_PAD * 2 + (fp.gridHeight + extraBelow) * GRID_PX;
  return { w, h };
}

export function FloorplanCanvas({ floorplan, rooms, ahu, settings, extraBelow = 4 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = calcCanvasSize(floorplan, extraBelow);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, floorplan, rooms, ahu, settings, w, h);
  }, [floorplan, rooms, ahu, settings, extraBelow]);

  const { w, h } = calcCanvasSize(floorplan, extraBelow);

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      className="floorplan-canvas"
      style={{ width: w, height: h }}
    />
  );
}

export function draw(
  ctx: CanvasRenderingContext2D,
  fp: FloorPlan,
  rooms: Room[],
  ahu: AHU,
  settings: AppSettings,
  _w: number,
  _h: number,
) {
  ctx.clearRect(0, 0, _w, _h);

  // 1. Background
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, _w, _h);

  // 2. Grid
  if (settings.showGrid) drawGrid(ctx, fp, _w, _h);

  // 3. Room fills
  for (const room of rooms) drawRoomFill(ctx, room);

  // 4. Walls
  for (const wall of fp.walls) {
    const lw = wall.wallType === 'thick' ? 5 : 2.5;
    drawSeg(ctx, wall.start, wall.end, C_WALL_NORMAL, lw);
  }

  // 5. Windows
  for (const win of fp.windows) {
    drawSeg(ctx, win.start, win.end, C_WINDOW, 3);
  }

  // 6. Doors
  for (const door of fp.doors) {
    drawDoor(ctx, door.start, door.end);
  }

  // 7. Vents
  for (const vent of fp.vents) {
    drawVent(ctx, vent.start, vent.end);
  }

  // 8. AHU
  drawAHU(ctx, ahu);

  // 9. CFM labels
  if (settings.showCFMLabels) {
    for (const room of rooms) drawRoomLabel(ctx, room);
  }
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, fp: FloorPlan, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= fp.gridWidth + 4; x++) {
    const px = CANVAS_PAD + x * GRID_PX;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }
  for (let y = 0; y <= fp.gridHeight + 4; y++) {
    const py = CANVAS_PAD + y * GRID_PX;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }
  ctx.restore();
}

function drawRoomFill(ctx: CanvasRenderingContext2D, room: Room) {
  if (room.cells.length === 0) return;
  // Union of unit squares
  ctx.save();
  for (const cell of room.cells) {
    const { x, y } = gridToPixel(cell);
    ctx.fillStyle = room.color;
    ctx.fillRect(x, y, GRID_PX, GRID_PX);
  }
  ctx.restore();
}

function drawSeg(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
  lw: number,
) {
  const pa = gridToPixel(a);
  const pb = gridToPixel(b);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.restore();
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const pa = gridToPixel(a);
  const pb = gridToPixel(b);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;   // normal (pointing into room)
  const ny = dx / len;

  const depth = GRID_PX * 0.5;

  ctx.save();
  ctx.strokeStyle = C_DOOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(
    Math.min(pa.x, pb.x) + (dx === 0 ? -depth / 2 : 0),
    Math.min(pa.y, pb.y) + (dy === 0 ? -depth / 2 : 0),
    Math.abs(dx) || depth,
    Math.abs(dy) || depth,
  );

  // Swing arc indicator
  ctx.beginPath();
  if (dy === 0) {
    ctx.arc(pa.x, pa.y, Math.abs(dx), 0, Math.PI / 2 * Math.sign(nx || 1));
  } else {
    ctx.arc(pa.x, pa.y, Math.abs(dy), Math.PI * 0.5, Math.PI * 0.5 + Math.PI / 2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawVent(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const pa = gridToPixel(a);
  const pb = gridToPixel(b);
  ctx.save();
  ctx.strokeStyle = C_VENT_DASH;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawAHU(ctx: CanvasRenderingContext2D, ahu: AHU) {
  const p = gridToPixel(ahu.position);
  const w = 2 * GRID_PX;
  const h = 3 * GRID_PX;

  ctx.save();
  // Body
  ctx.fillStyle = C_AHU_FILL;
  ctx.strokeStyle = C_AHU_STROKE;
  ctx.lineWidth = 2;
  ctx.fillRect(p.x, p.y, w, h);
  ctx.strokeRect(p.x, p.y, w, h);

  // Diagonal cross-hatch
  ctx.strokeStyle = 'rgba(100,116,139,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + w, p.y + h);
  ctx.moveTo(p.x + w, p.y); ctx.lineTo(p.x, p.y + h);
  ctx.stroke();

  // Label
  ctx.fillStyle = C_AHU_TEXT;
  ctx.font = `bold ${GRID_PX * 0.28}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AHU', p.x + w / 2, p.y + h / 2);

  // Supply port marker (left side)
  const sp = gridToPixel(ahu.supplyPort);
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
  ctx.fill();

  // Return port marker (right side)
  const rp = gridToPixel(ahu.returnPort);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(rp.x, rp.y, 5, 0, Math.PI * 2);
  ctx.fill();

  // Port labels
  ctx.font = `${GRID_PX * 0.18}px monospace`;
  ctx.fillStyle = C_AHU_TEXT;
  ctx.textAlign = 'center';
  ctx.fillText('S', sp.x, sp.y - 10);
  ctx.fillText('R', rp.x, rp.y - 10);
  ctx.restore();
}

function drawRoomLabel(ctx: CanvasRenderingContext2D, room: Room) {
  if (room.cells.length === 0) return;
  const sumX = room.cells.reduce((s, c) => s + c.x + 0.5, 0) / room.cells.length;
  const sumY = room.cells.reduce((s, c) => s + c.y + 0.5, 0) / room.cells.length;
  const px = CANVAS_PAD + sumX * GRID_PX;
  const py = CANVAS_PAD + sumY * GRID_PX;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.font = `bold ${GRID_PX * 0.22}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${room.cfm} CFM`, px, py);
  ctx.restore();
}
