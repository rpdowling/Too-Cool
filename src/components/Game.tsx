import React, { useState, useCallback } from 'react';
import type { Level, DuctSystem, DrawingTool, DuctSize, GameMode } from '../types';
import type { ScoreBreakdown } from './HUD';
import { FloorplanCanvas } from './FloorplanCanvas';
import { DuctCanvas } from './DuctCanvas';
import { HUD } from './HUD';
import { scoreSystem } from '../game/scoring';

interface Props {
  level: Level;
  settings: { showGrid: boolean; showCFMLabels: boolean; volume: number };
  onNavigate: (mode: GameMode) => void;
  highScores: Record<number, number>;
  onScore: (levelId: number, score: number) => void;
}

const EMPTY_SYSTEM: DuctSystem = { segments: [], transitions: [], diffusers: [] };

export function Game({ level, settings, onNavigate, highScores, onScore }: Props) {
  const [ductSystem, setDuctSystem] = useState<DuctSystem>(EMPTY_SYSTEM);
  const [activeTool, setActiveTool] = useState<DrawingTool>('duct_supply');
  const [selectedSize, setSelectedSize] = useState<DuctSize>(6);
  const [currentLayer, setCurrentLayer] = useState(0);
  const [showOptimal, setShowOptimal] = useState(false);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 700 });

  // History for undo
  const [history, setHistory] = useState<DuctSystem[]>([EMPTY_SYSTEM]);

  const handleDuctSystemChange = useCallback((ds: DuctSystem) => {
    setHistory(h => [...h.slice(-30), ds]);
    setDuctSystem(ds);
    setScore(null); // clear score on change
  }, []);

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
    if (s.total > (highScores[level.id] ?? 0)) {
      onScore(level.id, s.total);
    }
  }

  return (
    <div className="game-screen">
      <HUD
        level={level}
        ductSystem={ductSystem}
        activeTool={activeTool}
        selectedSize={selectedSize}
        currentLayer={currentLayer}
        showOptimal={showOptimal}
        score={score}
        onToolChange={setActiveTool}
        onSizeChange={setSelectedSize}
        onSubmit={handleSubmit}
        onUndo={handleUndo}
        onClear={handleClear}
        onToggleOptimal={() => setShowOptimal(s => !s)}
        onBack={() => onNavigate('levelSelect')}
      />

      <div className="canvas-viewport">
        <div className="canvas-stack" style={{ position: 'relative', width: canvasSize.w, height: canvasSize.h }}>
          <FloorplanCanvas
            floorplan={level.floorplan}
            rooms={level.rooms}
            ahu={level.ahu}
            settings={settings}
            extraBelow={4}
            onSize={(w, h) => setCanvasSize({ w, h })}
          />
          <DuctCanvas
            width={canvasSize.w}
            height={canvasSize.h}
            level={level}
            ductSystem={ductSystem}
            activeTool={activeTool}
            selectedSize={selectedSize}
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
