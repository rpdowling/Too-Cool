import React from 'react';
import type { GameMode } from '../types';

interface Props {
  onNavigate: (mode: GameMode) => void;
}

export function Menu({ onNavigate }: Props) {
  return (
    <div className="screen menu-screen">
      <div className="menu-bg" aria-hidden>
        {/* Blueprint grid lines */}
        <svg className="blueprint-bg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
              <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(96,165,250,0.08)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Decorative duct icon */}
        <svg className="duct-icon" viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="50" width="180" height="20" rx="2" stroke="rgba(96,165,250,0.25)" strokeWidth="2" fill="rgba(96,165,250,0.06)" />
          <rect x="80" y="20" width="20" height="50" rx="2" stroke="rgba(96,165,250,0.25)" strokeWidth="2" fill="rgba(96,165,250,0.06)" />
          <rect x="130" y="10" width="20" height="60" rx="2" stroke="rgba(96,165,250,0.25)" strokeWidth="2" fill="rgba(96,165,250,0.06)" />
          <circle cx="90" cy="50" r="5" fill="rgba(96,165,250,0.3)" />
          <circle cx="140" cy="50" r="5" fill="rgba(96,165,250,0.3)" />
        </svg>
      </div>

      <div className="menu-content">
        <h1 className="menu-title">
          <span className="title-too">Too</span>
          <span className="title-cool">Cool</span>
        </h1>
        <p className="menu-sub">HVAC Design Puzzle</p>

        <nav className="menu-nav">
          <button className="menu-btn primary" onClick={() => onNavigate('levelSelect')}>
            Play
          </button>
          <button className="menu-btn" onClick={() => onNavigate('levelMaker')}>
            Level Maker
          </button>
          <button className="menu-btn" onClick={() => onNavigate('settings')}>
            Settings
          </button>
        </nav>

        <p className="menu-footer">
          Design efficient duct systems. Grade your routes against the optimal solution.
        </p>
      </div>
    </div>
  );
}
