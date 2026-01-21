import Phaser from 'phaser';
import React, { useEffect, useRef } from 'react';
import { MainScene } from '../game/scenes/MainScene';
import { PreloadScene } from '../game/scenes/PreloadScene';
import { ThemeId } from '../types';

interface GameCanvasProps {
  onScoreUpdate: (score: number, total: number) => void;
  onGameOver: () => void;
  onGameRestart?: () => void;
  onQuestionUpdate?: (question: string) => void;
  onBackgroundUpdate?: (index: number) => void;
  themes: ThemeId[];
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ 
  onScoreUpdate, 
  onGameOver, 
  onGameRestart,
  onQuestionUpdate,
  onBackgroundUpdate,
  themes 
}) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.WEBGL,
      parent: containerRef.current,
      backgroundColor: 'transparent',
      transparent: true,
      // @ts-ignore - resolution is a valid config property but missing in some type definitions
      resolution: Math.min(window.devicePixelRatio, 2),
      render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false,
        powerPreference: 'high-performance'
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false
        }
      },
      callbacks: {
        preBoot: (game) => {
          game.registry.set('callbacks', {
            onScoreUpdate,
            onGameOver,
            onGameRestart,
            onQuestionUpdate,
            onBackgroundUpdate
          });
          game.registry.set('initialThemes', themes);
          game.registry.set('dpr', window.devicePixelRatio || 1);
        }
      },
      scene: [PreloadScene, MainScene],
      input: {
        keyboard: true
      }
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;
    (window as any).phaserGame = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
};
