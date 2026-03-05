import type { GameplayModeId, ModeContext, ModeTransitionReason } from './types';
import type { Theme } from '../../../types';

export interface GameplayModePlugin {
  readonly modeId: GameplayModeId;
  enter(context: ModeContext, reason: ModeTransitionReason): void;
  update?(context: ModeContext, time: number, delta: number): void;
  exit?(context: ModeContext, reason: ModeTransitionReason): void;
  onResize?(context: ModeContext, width: number, height: number): void;
  onPlayerHitBlock?(context: ModeContext, player: unknown, block: unknown): void;
  onThemeDataReady?(context: ModeContext, theme: Theme): void;
  onThemeComplete?(context: ModeContext): void;
}
