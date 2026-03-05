import type { GameplayModePlugin } from '../core/GameplayModePlugin';
import type { GameplayModeId, ModeContext, ModeTransitionReason } from '../core/types';
import type { Theme } from '../../../types';

export class Round1PronunciationMode implements GameplayModePlugin {
  public readonly modeId: GameplayModeId = 'BLIND_BOX_PRONUNCIATION';

  public enter(context: ModeContext, reason: ModeTransitionReason): void {
    context.scene.setModeVisualProfile({ pronunciationFlowEnabled: true });
    context.scene.setModeResponsiveLayoutStrategy('round1-pronunciation');
    context.scene.setLegacyGameplayMode(this.modeId);
    context.systems.ui.onModeEnter(this.modeId);
    context.systems.cards.onModeEnter(this.modeId);
    context.systems.reward.onModeEnter(this.modeId);
    context.systems.pronunciation.onModeEnter(this.modeId);
    context.scene.onModeEnter(this.modeId, reason);
  }

  public update(context: ModeContext, time: number, delta: number): void {
    context.scene.runLegacyUpdateLoop(time, delta);
  }

  public exit(context: ModeContext, reason: ModeTransitionReason): void {
    context.systems.pronunciation.onModeExit(this.modeId);
    context.systems.reward.onModeExit(this.modeId);
    context.systems.cards.onModeExit(this.modeId);
    context.systems.ui.onModeExit(this.modeId);
    context.scene.onModeExit(this.modeId, reason);
  }

  public onResize(context: ModeContext, width: number, height: number): void {
    context.systems.ui.onResize(width, height);
  }

  public onPlayerHitBlock(context: ModeContext, player: unknown, block: unknown): void {
    context.scene.handleRound1PlayerHitBlock(player, block);
  }

  public onThemeDataReady(context: ModeContext, theme: Theme): void {
    context.scene.setupRound1ThemeData(theme);
  }

  public onThemeComplete(context: ModeContext): void {
    const summary = context.scene.getPronunciationSummarySnapshot();
    if (context.callbacks.onPronunciationComplete) {
      context.callbacks.onPronunciationComplete(summary);
    }
  }
}
