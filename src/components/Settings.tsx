import React from 'react';
import type { AppSettings, GameMode } from '../types';

interface Props {
  settings: AppSettings;
  onUpdate: (s: AppSettings) => void;
  onNavigate: (mode: GameMode) => void;
}

export function Settings({ settings, onUpdate, onNavigate }: Props) {
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    onUpdate({ ...settings, [k]: v });

  return (
    <div className="screen settings-screen">
      <div className="screen-header">
        <button className="back-btn" onClick={() => onNavigate('menu')}>← Menu</button>
        <h2>Settings</h2>
      </div>

      <div className="settings-body">
        <div className="setting-row">
          <label>Show Grid</label>
          <button
            className={`toggle-btn ${settings.showGrid ? 'on' : 'off'}`}
            onClick={() => set('showGrid', !settings.showGrid)}
          >
            {settings.showGrid ? 'On' : 'Off'}
          </button>
        </div>

        <div className="setting-row">
          <label>Show CFM Labels</label>
          <button
            className={`toggle-btn ${settings.showCFMLabels ? 'on' : 'off'}`}
            onClick={() => set('showCFMLabels', !settings.showCFMLabels)}
          >
            {settings.showCFMLabels ? 'On' : 'Off'}
          </button>
        </div>

        <div className="setting-row">
          <label>Volume</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={e => set('volume', parseFloat(e.target.value))}
            className="slider"
          />
          <span className="slider-val">{Math.round(settings.volume * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
