// ─── Geometry ───────────────────────────────────────────────────────────────

export interface GridPoint {
  x: number;
  y: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

// ─── Floor Plan Elements ─────────────────────────────────────────────────────

export type WallType = 'normal' | 'thick';

export interface WallSegment {
  id: string;
  start: GridPoint;
  end: GridPoint;
  wallType: WallType;
  isExterior: boolean;
}

export interface WindowSegment {
  id: string;
  start: GridPoint;
  end: GridPoint;
}

export interface DoorSegment {
  id: string;
  start: GridPoint;
  end: GridPoint;
  isExterior: boolean;
}

export interface VentSegment {
  id: string;
  start: GridPoint;
  end: GridPoint;
}

// ─── Room ────────────────────────────────────────────────────────────────────

export interface Room {
  id: string;
  cells: GridPoint[];
  area: number;        // m²
  cfm: number;         // required supply CFM
  btuh: number;        // cooling load BTU/hr
  color: string;       // heat-gradient CSS color
  wallIds: string[];
  windowIds: string[];
  doorIds: string[];
}

// ─── AHU ─────────────────────────────────────────────────────────────────────

export interface AHU {
  position: GridPoint;  // top-left of 2×3 grid area
  totalCFM: number;
  supplyPort: GridPoint;
  returnPort: GridPoint;
}

// ─── Floor Plan (level layout) ───────────────────────────────────────────────

export interface FloorPlan {
  gridWidth: number;
  gridHeight: number;
  walls: WallSegment[];
  windows: WindowSegment[];
  doors: DoorSegment[];
  vents: VentSegment[];
}

// ─── Ducts ───────────────────────────────────────────────────────────────────

export type DuctSize = 4 | 6 | 8 | 12;

export interface DuctSegment {
  id: string;
  start: GridPoint;
  end: GridPoint;
  size: DuctSize;
  cfm: number;
  layer: number;       // 0 = ceiling plane, 1 = above obstacle
  isReturn: boolean;
}

export interface Transition {
  id: string;
  position: GridPoint;
  fromSize: DuctSize;
  toSize: DuctSize;
  type: 'reduce' | 'expand' | 'rise' | 'drop';
  layer: number;
  isReturn: boolean;
}

export interface Diffuser {
  id: string;
  position: GridPoint;
  roomId: string;
  size: DuctSize;
  cfm: number;
  isReturn: boolean;
}

export interface DuctSystem {
  segments: DuctSegment[];
  transitions: Transition[];
  diffusers: Diffuser[];
}

// ─── Level ───────────────────────────────────────────────────────────────────

export interface Level {
  id: number;
  name: string;
  description: string;
  floorplan: FloorPlan;
  ahu: AHU;
  rooms: Room[];
  totalCFM: number;
  optimalDuctSystem: DuctSystem;
  optimalLength: number;   // total duct meters in optimal solution
}

// ─── Game State ──────────────────────────────────────────────────────────────

export type GameMode = 'menu' | 'levelSelect' | 'game' | 'levelMaker' | 'settings' | 'results';

export type DrawingTool =
  | 'select'
  | 'duct_supply'
  | 'duct_return'
  | 'diffuser_supply'
  | 'diffuser_return'
  | 'transition_rise'
  | 'transition_drop'
  | 'eraser';

export type LevelMakerTool =
  | 'select'
  | 'wall_normal'
  | 'wall_thick'
  | 'window'
  | 'door'
  | 'vent'
  | 'ahu'
  | 'eraser';

export interface GamePlayState {
  level: Level;
  ductSystem: DuctSystem;
  activeTool: DrawingTool;
  selectedDuctSize: DuctSize;
  currentLayer: number;
  isDrawing: boolean;
  drawingStart: GridPoint | null;
  drawingPath: GridPoint[];
  score: number | null;
  showOptimal: boolean;
  hoveredDiffuserId: string | null;
}

export interface LevelMakerState {
  floorplan: FloorPlan;
  ahu: AHU | null;
  activeTool: LevelMakerTool;
  drawStart: GridPoint | null;
  isValid: boolean;
  validationErrors: string[];
}

export interface AppSettings {
  volume: number;        // 0–1
  showGrid: boolean;
  showCFMLabels: boolean;
}
