import type { PronunciationSummary, Theme } from '../../../types';

export type GameplayModeId = 'QUIZ' | 'BLIND_BOX_PRONUNCIATION';
export type ResponsiveLayoutStrategyId = 'round1-pronunciation' | 'round2-quiz';

export interface ModeVisualProfile {
  pronunciationFlowEnabled: boolean;
}

export interface QuizCollisionRewardPayload {
  blockX: number;
  blockY: number;
}

export type ModeTransitionReason =
  | 'scene-init'
  | 'mode-switch'
  | 'scene-restart'
  | 'resize'
  | 'fallback'
  | 'shutdown'
  | 'destroy';

export interface RuntimeCallbackBridge {
  onScoreUpdate?: (score: number, total: number) => void;
  onGameOver?: () => void;
  onBackgroundUpdate?: (index: number) => void;
  onPronunciationProgressUpdate?: (completed: number, total: number, averageConfidence: number) => void;
  onPronunciationComplete?: (summary: PronunciationSummary) => void;
}

export interface ModeRuntimeState {
  readonly initialModeId: GameplayModeId;
  readonly currentModeId: GameplayModeId;
  readonly previousModeId: GameplayModeId | null;
  readonly transitionReason: ModeTransitionReason;
  readonly switchCount: number;
  readonly callbacks: RuntimeCallbackBridge;
  setCurrentMode(modeId: GameplayModeId, reason: ModeTransitionReason): void;
}

export interface GameplayModeHost {
  setModeVisualProfile(profile: ModeVisualProfile): void;
  setModeResponsiveLayoutStrategy(strategyId: ResponsiveLayoutStrategyId): void;
  setLegacyGameplayMode(modeId: GameplayModeId): void;
  onModeEnter(modeId: GameplayModeId, reason: ModeTransitionReason): void;
  onModeExit(modeId: GameplayModeId, reason: ModeTransitionReason): void;
  onModeResize(width: number, height: number): void;
  setupRound1ThemeData(theme: Theme): void;
  setupRound2ThemeData(theme: Theme): void;
  getPronunciationSummarySnapshot(): PronunciationSummary;
  getGameScaleValue(): number;
  getScoreHudTargetPoint(): { x: number; y: number };
  applyScoreDelta(delta: number): void;
  runLegacyUpdateLoop(time: number, delta: number): void;
  handleRound1PlayerHitBlock(player: unknown, block: unknown): void;
  handleRound2PlayerHitBlock(player: unknown, block: unknown): void;
  cleanupBlocksForModeSwitch?(): void;
  resetPronunciationModeUi?(): void;
  logModeRuntime(message: string, extra?: Record<string, unknown>): void;
}

export interface SceneUiSystemContract {
  onModeEnter(modeId: GameplayModeId): void;
  onModeExit(modeId: GameplayModeId): void;
  onResize(width: number, height: number): void;
  syncBeeLayout(width: number, height: number): void;
  updateBeeWord(text: string): void;
  cleanupBlocks(): void;
  destroy(): void;
}

export interface CardSystemContract {
  onModeEnter(modeId: GameplayModeId): void;
  onModeExit(modeId: GameplayModeId): void;
  applyResponsiveAnswerLayouts(
    strategyId: ResponsiveLayoutStrategyId,
    safeWidth: number,
    safeHeight: number
  ): void;
  relayoutBlocks(safeWidth: number, safeHeight: number): void;
  destroy(): void;
}

export interface RewardSystemContract {
  onModeEnter(modeId: GameplayModeId): void;
  onModeExit(modeId: GameplayModeId): void;
  playBlockExplosion(x: number, y: number): void;
  playQuizCollisionReward(payload: QuizCollisionRewardPayload): number;
  destroy(): void;
}

export interface PronunciationSystemContract {
  onModeEnter(modeId: GameplayModeId): void;
  onModeExit(modeId: GameplayModeId): void;
  destroy(): void;
}

export interface ModeSystems {
  ui: SceneUiSystemContract;
  cards: CardSystemContract;
  reward: RewardSystemContract;
  pronunciation: PronunciationSystemContract;
}

export interface ModeContext {
  scene: GameplayModeHost;
  state: ModeRuntimeState;
  systems: ModeSystems;
  callbacks: RuntimeCallbackBridge;
}
