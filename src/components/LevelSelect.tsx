import React from 'react';
import type { Level, GameMode } from '../types';
import { ALL_LEVELS } from '../levels/level1';

interface Props {
  onSelectLevel: (level: Level) => void;
  onNavigate: (mode: GameMode) => void;
  highScores: Record<number, number>;
}

export function LevelSelect({ onSelectLevel, onNavigate, highScores }: Props) {
  return (
    <div className="screen levelselect-screen">
      <div className="screen-header">
        <button className="back-btn" onClick={() => onNavigate('menu')}>← Menu</button>
        <h2>Select Level</h2>
      </div>

      <div className="level-grid">
        {ALL_LEVELS.map(level => {
          const best = highScores[level.id];
          return (
            <button
              key={level.id}
              className="level-card"
              onClick={() => onSelectLevel(level)}
            >
              <div className="level-num">Level {level.id}</div>
              <div className="level-name">{level.name}</div>
              <div className="level-desc">{level.description}</div>
              <div className="level-meta">
                <span className="level-cfm">{level.totalCFM} CFM total</span>
                <span className="level-rooms">{level.rooms.length} room{level.rooms.length !== 1 ? 's' : ''}</span>
              </div>
              {best !== undefined && (
                <div className={`level-score ${best >= 90 ? 'gold' : best >= 70 ? 'silver' : 'bronze'}`}>
                  Best: {best}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
