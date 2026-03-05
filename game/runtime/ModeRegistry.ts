import type { GameplayModePlugin } from '../modes/core/GameplayModePlugin';
import type { GameplayModeId, ModeContext, ModeTransitionReason } from '../modes/core/types';
import type { Theme } from '../../types';

export class ModeRegistry {
  private readonly plugins: Map<GameplayModeId, GameplayModePlugin> = new Map();
  private activePlugin: GameplayModePlugin | null = null;

  public register(modeId: GameplayModeId, plugin: GameplayModePlugin): void {
    this.plugins.set(modeId, plugin);
  }

  public resolve(modeId: GameplayModeId): GameplayModePlugin {
    const plugin = this.plugins.get(modeId);
    if (!plugin) {
      throw new Error(`[ModeRegistry] Gameplay mode plugin not registered: ${modeId}`);
    }
    return plugin;
  }

  public switchMode(
    context: ModeContext,
    nextModeId: GameplayModeId,
    reason: ModeTransitionReason,
    fallbackModeId: GameplayModeId
  ): GameplayModeId {
    const previousPlugin = this.activePlugin;

    if (previousPlugin?.modeId === nextModeId) {
      context.state.setCurrentMode(nextModeId, reason);
      return nextModeId;
    }

    if (previousPlugin?.exit) {
      try {
        previousPlugin.exit(context, reason);
      } catch (error) {
        context.scene.logModeRuntime('mode-exit-error', {
          modeId: previousPlugin.modeId,
          reason,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const targetPlugin = this.resolve(nextModeId);

    try {
      targetPlugin.enter(context, reason);
      this.activePlugin = targetPlugin;
      context.state.setCurrentMode(targetPlugin.modeId, reason);
      return targetPlugin.modeId;
    } catch (error) {
      context.scene.logModeRuntime('mode-enter-error', {
        modeId: nextModeId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });

      const fallbackPlugin = this.plugins.get(fallbackModeId);
      if (fallbackPlugin) {
        try {
          fallbackPlugin.enter(context, 'fallback');
          this.activePlugin = fallbackPlugin;
          context.state.setCurrentMode(fallbackPlugin.modeId, 'fallback');
          return fallbackPlugin.modeId;
        } catch (fallbackError) {
          context.scene.logModeRuntime('mode-fallback-error', {
            fallbackModeId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          });
        }
      }

      if (previousPlugin) {
        try {
          previousPlugin.enter(context, 'fallback');
          this.activePlugin = previousPlugin;
          context.state.setCurrentMode(previousPlugin.modeId, 'fallback');
          return previousPlugin.modeId;
        } catch (rollbackError) {
          context.scene.logModeRuntime('mode-rollback-error', {
            modeId: previousPlugin.modeId,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
      }

      throw error;
    }
  }

  public update(context: ModeContext, time: number, delta: number): void {
    if (!this.activePlugin) {
      return;
    }

    if (this.activePlugin.update) {
      this.activePlugin.update(context, time, delta);
      return;
    }

    void time;
    void delta;
  }

  public onResize(context: ModeContext, width: number, height: number): void {
    if (!this.activePlugin) {
      context.scene.onModeResize(width, height);
      return;
    }

    if (this.activePlugin.onResize) {
      this.activePlugin.onResize(context, width, height);
      return;
    }

    context.scene.onModeResize(width, height);
  }

  public onPlayerHitBlock(context: ModeContext, player: unknown, block: unknown): void {
    if (!this.activePlugin) {
      return;
    }

    if (this.activePlugin.onPlayerHitBlock) {
      this.activePlugin.onPlayerHitBlock(context, player, block);
      return;
    }

    void player;
    void block;
  }

  public onThemeDataReady(context: ModeContext, theme: Theme): void {
    if (!this.activePlugin) {
      return;
    }
    if (this.activePlugin.onThemeDataReady) {
      this.activePlugin.onThemeDataReady(context, theme);
      return;
    }
    void context;
    void theme;
  }

  public onThemeComplete(context: ModeContext): void {
    if (!this.activePlugin) return;
    if (this.activePlugin.onThemeComplete) {
      this.activePlugin.onThemeComplete(context);
    }
  }

  public shutdown(context: ModeContext, reason: ModeTransitionReason): void {
    if (!this.activePlugin) return;

    if (this.activePlugin.exit) {
      try {
        this.activePlugin.exit(context, reason);
      } catch (error) {
        context.scene.logModeRuntime('mode-shutdown-exit-error', {
          modeId: this.activePlugin.modeId,
          reason,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.activePlugin = null;
  }
}
