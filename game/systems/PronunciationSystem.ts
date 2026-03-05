import type { GameplayModeId, GameplayModeHost } from '../modes/core/types';

export class PronunciationSystem {
  private readonly scene: GameplayModeHost;

  constructor(scene: GameplayModeHost) {
    this.scene = scene;
  }

  public onModeEnter(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('pronunciation-system-enter', { modeId });
  }

  public onModeExit(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('pronunciation-system-exit', { modeId });
    if (this.scene.resetPronunciationModeUi) {
      this.scene.resetPronunciationModeUi();
    }
  }

  public destroy(): void {
    if (this.scene.resetPronunciationModeUi) {
      this.scene.resetPronunciationModeUi();
    }
  }
}
