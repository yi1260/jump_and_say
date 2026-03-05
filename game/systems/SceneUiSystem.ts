import Phaser from 'phaser';
import type { GameplayModeId, GameplayModeHost } from '../modes/core/types';

const FONT_STACK = '"FredokaBoot", "FredokaLatin", "Fredoka", "ZCOOL KuaiLe UI", "ZCOOL KuaiLe", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif';

interface SceneUiRuntimeHost extends GameplayModeHost {
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
  time: Phaser.Time.Clock;
  scale: Phaser.Scale.ScaleManager;
  blocks: Phaser.Physics.Arcade.StaticGroup;
  beeContainer?: Phaser.GameObjects.Container;
  beeSprite?: Phaser.GameObjects.Sprite;
  beeWordText?: Phaser.GameObjects.Text;
  beeCenterY: number;
  blockCenterY: number;
  gameScale: number;
  getCurrentViewportSize(): { width: number; height: number };
  getBeeTextOffsetY(width: number, height: number): number;
  destroyBlockVisual(visuals: Phaser.GameObjects.Container | undefined): void;
  forceDestroyAllBlockVisuals(): void;
}

export class SceneUiSystem {
  private readonly sceneRef: GameplayModeHost;

  constructor(scene: GameplayModeHost) {
    this.sceneRef = scene;
  }

  private get scene(): SceneUiRuntimeHost {
    return this.sceneRef as SceneUiRuntimeHost;
  }

  public onModeEnter(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('scene-ui-enter', { modeId });
  }

  public onModeExit(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('scene-ui-exit', { modeId });
  }

  public onResize(width: number, height: number): void {
    this.scene.onModeResize(width, height);
  }

  public syncBeeLayout(width: number, height: number): void {
    const scene = this.scene;
    if (!scene.beeContainer || !scene.beeContainer.active) return;
    scene.beeContainer.x = width / 2;
    scene.beeContainer.y = scene.beeCenterY;

    const visualBeeSize = 80 * scene.gameScale;
    const fontSize = Math.round(38 * scene.gameScale);
    const textOffsetY = scene.getBeeTextOffsetY(width, height);

    if (scene.beeSprite) {
      scene.beeSprite.setDisplaySize(visualBeeSize, visualBeeSize);
    }
    if (scene.beeWordText) {
      scene.beeWordText.setFontSize(`${fontSize}px`);
      scene.beeWordText.y = textOffsetY;
    }
  }

  public updateBeeWord(text: string): void {
    const scene = this.scene;
    if (!text) return;

    const formattedText = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    const { width } = scene.scale;
    const startY = scene.beeCenterY;

    if (scene.beeContainer && !scene.beeContainer.active) {
      scene.beeContainer = undefined;
    }

    if (!scene.beeContainer) {
      scene.beeContainer = scene.add.container(width / 2, startY);
      scene.beeContainer.setDepth(1000);
      scene.beeContainer.setScale(0);

      scene.beeSprite = scene.add.sprite(0, 0, 'bee_a');
      scene.beeSprite.play('bee_fly');

      scene.beeWordText = scene.add.text(0, 0, formattedText, {
        fontFamily: FONT_STACK,
        fontStyle: 'bold',
        color: '#333333'
      }).setOrigin(0.5);

      scene.beeContainer.add([scene.beeSprite, scene.beeWordText]);
      scene.tweens.add({
        targets: scene.beeSprite,
        y: { from: 0, to: 15 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    } else {
      scene.beeContainer.setVisible(true);
      scene.beeContainer.setAlpha(1);
      scene.beeContainer.setScale(0);
      scene.tweens.killTweensOf(scene.beeContainer);
      scene.beeContainer.y = startY;
      scene.beeWordText?.setText(formattedText);
    }

    const visualBeeSize = 80 * scene.gameScale;
    const fontSize = Math.round(40 * scene.gameScale);
    const viewport = scene.getCurrentViewportSize();
    const textOffsetY = scene.getBeeTextOffsetY(viewport.width, viewport.height);

    if (scene.beeSprite) {
      scene.beeSprite.setDisplaySize(visualBeeSize, visualBeeSize);
    }
    if (scene.beeWordText) {
      scene.beeWordText.setFontSize(`${fontSize}px`);
      scene.beeWordText.setY(textOffsetY);
      scene.tweens.killTweensOf(scene.beeWordText);
      const floatDistance = 15 * scene.gameScale;
      scene.tweens.add({
        targets: scene.beeWordText,
        y: { from: textOffsetY, to: textOffsetY + floatDistance },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    scene.tweens.add({
      targets: scene.beeContainer,
      scaleX: 1,
      scaleY: 1,
      duration: 500,
      ease: 'Back.easeOut'
    });
  }

  public cleanupBlocks(): void {
    const scene = this.scene;
    const blocks = scene.blocks;
    const blockChildren = blocks?.children;
    if (!blocks || !blockChildren || typeof blockChildren.iterate !== 'function') return;

    if (scene.beeContainer && scene.beeContainer.active) {
      scene.tweens.add({
        targets: scene.beeContainer,
        scaleX: 0,
        scaleY: 0,
        duration: 300,
        ease: 'Back.easeIn',
        onComplete: () => {
          if (scene.beeContainer) scene.beeContainer.setVisible(false);
        }
      });
    }

    blockChildren.iterate((rawBlock: unknown) => {
      const block = rawBlock as
        | {
            setData(key: string, value: unknown): void;
            getData(key: string): unknown;
          }
        | undefined;
      if (!block) return true;
      block.setData('isCleaningUp', true);
      const visuals = block.getData('visuals') as Phaser.GameObjects.Container | undefined;
      if (visuals && visuals.active) {
        scene.tweens.add({
          targets: visuals,
          scaleX: 0,
          scaleY: 0,
          duration: 300,
          onComplete: () => {
            scene.destroyBlockVisual(visuals);
            block.setData('visuals', undefined);
          }
        });
      }
      return true;
    });

    scene.time.delayedCall(350, () => {
      const delayedBlocks = scene.blocks;
      if (!delayedBlocks || !delayedBlocks.children || typeof delayedBlocks.clear !== 'function') {
        return;
      }
      scene.forceDestroyAllBlockVisuals();
      delayedBlocks.clear(true, true);
    });
  }

  public destroy(): void {
    if (this.scene.resetPronunciationModeUi) {
      this.scene.resetPronunciationModeUi();
    }
  }
}
