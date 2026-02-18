import Phaser from 'phaser';
import React, { useEffect, useRef } from 'react';
import { MainScene } from '../game/scenes/MainScene';
import { PreloadScene } from '../game/scenes/PreloadScene';
import { Theme, ThemeId } from '../types';

interface GameCanvasProps {
  onScoreUpdate: (score: number, total: number) => void;
  onGameOver: () => void;
  onGameRestart?: () => void;
  onQuestionUpdate?: (question: string) => void;
  onBackgroundUpdate?: (index: number) => void;
  themes: ThemeId[];
  allThemes: Theme[];
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ 
  onScoreUpdate, 
  onGameOver, 
  onGameRestart,
  onQuestionUpdate,
  onBackgroundUpdate,
  themes,
  allThemes
}) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let isUnmounted = false;

    const waitForFredokaFont = async (): Promise<void> => {
      if (!('fonts' in document)) return;

      const fontSet = document.fonts;
      const fontSpecs = [
        '400 24px "FredokaBoot"',
        '700 24px "FredokaBoot"',
        '900 24px "FredokaBoot"'
      ];

      const fontLoads: Array<Promise<FontFace[]>> = [
        fontSet.load('400 24px "FredokaBoot"'),
        fontSet.load('700 24px "FredokaBoot"'),
        fontSet.load('900 24px "FredokaBoot"')
      ];

      await Promise.race([
        Promise.allSettled(fontLoads).then(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2000))
      ]);

      const missingSpecs = fontSpecs.filter((spec) => !fontSet.check(spec));
      if (missingSpecs.length > 0) {
        await Promise.allSettled(missingSpecs.map((spec) => fontSet.load(spec)));
      }

      const stillMissingSpecs = fontSpecs.filter((spec) => !fontSet.check(spec));
      if (stillMissingSpecs.length > 0) {
        console.warn('[Font] FredokaBoot not fully ready before Phaser init.', { missingSpecs: stillMissingSpecs });
      }
    };

    const initializeGame = async (): Promise<void> => {
      await waitForFredokaFont();
      if (isUnmounted || !containerRef.current) return;
      const isIPadDevice = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;

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
          roundPixels: isIPadDevice,
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
            game.registry.set('allThemes', allThemes);
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
      (window as Window & { phaserGame?: Phaser.Game }).phaserGame = game;
    };

    void initializeGame();

    return () => {
      isUnmounted = true;
      const game = gameRef.current;
      if (!game) return;
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
};
