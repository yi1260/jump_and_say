import Phaser from 'phaser';
import React, { useEffect, useRef } from 'react';
import { MainScene } from '../game/scenes/MainScene';
import { ThemeId } from '../types';

interface GameCanvasProps {
  onScoreUpdate: (score: number, total: number) => void;
  onGameOver: () => void;
  onGameRestart?: () => void;
  onQuestionUpdate?: (question: string) => void;
  onBackgroundUpdate?: (index: number) => void;
  theme: ThemeId;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ onScoreUpdate, onGameOver, onGameRestart, onQuestionUpdate, onBackgroundUpdate, theme }) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 1280,
      height: 720,
      backgroundColor: '#000000',
      transparent: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 2500 },
          debug: false
        }
      },
      render: {
        pixelArt: false,
        antialias: true,
        antialiasGL: true,
        roundPixels: false,
        desynchronized: true,
        powerPreference: 'high-performance',
        mipmapFilter: 'LINEAR'
      },
      // @ts-ignore - resolution exists in Phaser config
      resolution: window.devicePixelRatio || 1,
      scene: [MainScene]
    };

    const dpr = window.devicePixelRatio || 1;
    const game = new Phaser.Game(config);
    gameRef.current = game;
    (window as any).phaserGame = game;

    game.events.on('ready', () => {
      const scene = game.scene.getScene('MainScene') as MainScene;
      if (scene) {
        scene.init({ onScoreUpdate, onGameOver, onGameRestart, onQuestionUpdate, onBackgroundUpdate, theme, dpr });
      }
    });

    return () => {
      game.destroy(true);
    };
  }, [onScoreUpdate, onGameOver, onGameRestart, onQuestionUpdate, onBackgroundUpdate, theme]);

  return <div ref={containerRef} className="w-full h-full" />;
};