import type { GameplayModePlugin } from '../core/GameplayModePlugin';
import type { GameplayModeId, ModeContext, ModeTransitionReason } from '../core/types';
import type { Theme } from '../../../types';

export class Round3BubblePopMode implements GameplayModePlugin {
  public readonly modeId: GameplayModeId = 'BUBBLE_POP';

  public enter(context: ModeContext, reason: ModeTransitionReason): void {
    context.scene.setLegacyGameplayMode(this.modeId);
    context.scene.setModeVisualProfile({ pronunciationFlowEnabled: false });
    context.scene.setModeResponsiveLayoutStrategy('round3-bubble-pop');
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
    context.scene.handleRound3PlayerHitBubble(player, block);
  }

  public onThemeDataReady(context: ModeContext, theme: Theme): void {
    context.scene.setupRound3ThemeData(theme);
  }
}
