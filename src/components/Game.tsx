import React, { useState, useCallback } from 'react';
import type { Level, DuctSystem, DrawingTool, GameMode } from '../types';
import type { ScoreBreakdown } from './HUD';
import { FloorplanCanvas } from './FloorplanCanvas';
import { DuctCanvas } from './DuctCanvas';
import { HUD } from './HUD';
import { scoreSystem } from '../game/scoring';
import { GRID_PX, CANVAS_PAD } from '../game/utils';
import { recalculateDuctSizes } from '../game/ductSizing';

interface Props {
  level: Level;
  settings: { showGrid: boolean; showCFMLabels: boolean; volume: number };
  onNavigate: (mode: GameMode) => void;
  highScores: Record<number, number>;
  onScore: (levelId: number, score: number) => void;
}

const EXTRA_BELOW = 4; // grid rows of space south of building for AHU
const EMPTY_SYSTEM: DuctSystem = { segments: [], transitions: [], diffusers: [] };

export function Game({ level, settings, onNavigate, highScores, onScore }: Props) {
  const [ductSystem, setDuctSystem] = useState<DuctSystem>(EMPTY_SYSTEM);
  const [activeTool, setActiveTool] = useState<DrawingTool>('duct_supply');
  const [currentLayer, setCurrentLayer] = useState(0);
  const [showOptimal, setShowOptimal] = useState(false);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [history, setHistory] = useState<DuctSystem[]>([EMPTY_SYSTEM]);

  // Canvas size is deterministic — compute directly, no callback needed
  const canvasW = CANVAS_PAD * 2 + level.floorplan.gridWidth  * GRID_PX;
  const canvasH = CANVAS_PAD * 2 + (level.floorplan.gridHeight + EXTRA_BELOW) * GRID_PX;

  const handleDuctSystemChange = useCallback((ds: DuctSystem) => {
    const sized = recalculateDuctSizes(ds, level.ahu.supplyPort, level.ahu.returnPort);
    setHistory(h => [...h.slice(-30), sized]);
    setDuctSystem(sized);
    setScore(null);
  }, [level.ahu]);

  function handleUndo() {
    if (history.length <= 1) return;
    const prev = history[history.length - 2];
    setHistory(h => h.slice(0, -1));
    setDuctSystem(prev);
    setScore(null);
  }

  function handleClear() {
    handleDuctSystemChange(EMPTY_SYSTEM);
    setCurrentLayer(0);
    setScore(null);
  }

  function handleSubmit() {
    const s = scoreSystem(level, ductSystem);
    setScore(s);
    if (s.total > (highScores[level.id] ?? 0)) onScore(level.id, s.total);
  }

  return (
    <div className="game-screen">
      <HUD
        level={level}
        ductSystem={ductSystem}
        activeTool={activeTool}
        currentLayer={currentLayer}
        showOptimal={showOptimal}
        score={score}
        onToolChange={setActiveTool}
        onSubmit={handleSubmit}
        onUndo={handleUndo}
        onClear={handleClear}
        onToggleOptimal={() => setShowOptimal(s => !s)}
        onBack={() => onNavigate('levelSelect')}
      />

      <div className="canvas-viewport">
        <div className="canvas-stack" style={{ position: 'relative', width: canvasW, height: canvasH }}>
          <FloorplanCanvas
            floorplan={level.floorplan}
            rooms={level.rooms}
            ahu={level.ahu}
            settings={settings}
            extraBelow={EXTRA_BELOW}
          />
          <DuctCanvas
            width={canvasW}
            height={canvasH}
            level={level}
            ductSystem={ductSystem}
            activeTool={activeTool}
            currentLayer={currentLayer}
            showOptimal={showOptimal}
            onDuctSystemChange={handleDuctSystemChange}
            onLayerChange={setCurrentLayer}
          />
        </div>
      </div>
    </div>
  );
}
