import type {
  GameplayModeId,
  ModeRuntimeState,
  ModeTransitionReason,
  RuntimeCallbackBridge
} from '../modes/core/types';

export class SceneRuntimeState implements ModeRuntimeState {
  public currentModeId: GameplayModeId;
  public previousModeId: GameplayModeId | null = null;
  public transitionReason: ModeTransitionReason = 'scene-init';
  public switchCount = 0;

  public readonly initialModeId: GameplayModeId;
  public readonly callbacks: RuntimeCallbackBridge;

  constructor(initialModeId: GameplayModeId, callbacks: RuntimeCallbackBridge) {
    this.initialModeId = initialModeId;
    this.currentModeId = initialModeId;
    this.callbacks = callbacks;
  }

  public setCurrentMode(modeId: GameplayModeId, reason: ModeTransitionReason): void {
    if (this.currentModeId !== modeId) {
      this.previousModeId = this.currentModeId;
      this.switchCount += 1;
    }
    this.currentModeId = modeId;
    this.transitionReason = reason;
  }
}
