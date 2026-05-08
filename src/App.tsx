import React, { useState } from 'react';
import type { GameMode, Level, AppSettings } from './types';
import { Menu } from './components/Menu';
import { LevelSelect } from './components/LevelSelect';
import { Game } from './components/Game';
import { LevelMaker } from './components/LevelMaker';
import { Settings } from './components/Settings';

const DEFAULT_SETTINGS: AppSettings = {
  volume: 0.5,
  showGrid: true,
  showCFMLabels: true,
};

export function App() {
  const [mode, setMode] = useState<GameMode>('menu');
  const [currentLevel, setCurrentLevel] = useState<Level | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [highScores, setHighScores] = useState<Record<number, number>>({});

  function handleSelectLevel(level: Level) {
    setCurrentLevel(level);
    setMode('game');
  }

  function handleScore(levelId: number, score: number) {
    setHighScores(prev => {
      if ((prev[levelId] ?? 0) < score) return { ...prev, [levelId]: score };
      return prev;
    });
  }

  return (
    <div className="app">
      {mode === 'menu' && <Menu onNavigate={setMode} />}
      {mode === 'levelSelect' && (
        <LevelSelect
          onSelectLevel={handleSelectLevel}
          onNavigate={setMode}
          highScores={highScores}
        />
      )}
      {mode === 'game' && currentLevel && (
        <Game
          level={currentLevel}
          settings={settings}
          onNavigate={setMode}
          highScores={highScores}
          onScore={handleScore}
        />
      )}
      {mode === 'levelMaker' && <LevelMaker onNavigate={setMode} />}
      {mode === 'settings' && (
        <Settings settings={settings} onUpdate={setSettings} onNavigate={setMode} />
      )}
    </div>
  );
}
