import Phaser from 'phaser';
import type { GameplayModeId, GameplayModeHost, ResponsiveLayoutStrategyId } from '../modes/core/types';

interface AnswerCardLayout {
  centerX: number;
  cardWidth: number;
  cardHeight: number;
  iconWidth: number;
  iconHeight: number;
  imageRatio: number;
}

interface CardSystemSceneHost extends GameplayModeHost {
  blocks: Phaser.Physics.Arcade.StaticGroup;
  activeCardLayouts: AnswerCardLayout[];
  currentAnswerRatios: number[];
  LANE_X_POSITIONS: number[];
  blockCenterY: number;
  gameScale: number;
  getLaneXPosition(index: number): number;
  getBlindBoxLayoutForResize(
    width: number,
    height: number,
    imageRatio: number
  ): { centerX: number; width: number; height: number; imageWidth: number; imageHeight: number };
  applyBlockVisualLayout(
    block: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    visuals: Phaser.GameObjects.Container | undefined,
    layout: AnswerCardLayout
  ): void;
  computeAnswerCardLayouts(answerRatios: number[], safeWidth: number, safeHeight: number): AnswerCardLayout[];
  getMaxCardHeight(layouts: AnswerCardLayout[]): number;
  updateJumpVelocityByCardHeight(cardHeight: number): void;
}

export class CardSystem {
  private readonly sceneRef: GameplayModeHost;

  constructor(scene: GameplayModeHost) {
    this.sceneRef = scene;
  }

  private get scene(): CardSystemSceneHost {
    return this.sceneRef as CardSystemSceneHost;
  }

  public onModeEnter(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('card-system-enter', { modeId });
  }

  public onModeExit(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('card-system-exit', { modeId });
    if (this.scene.cleanupBlocksForModeSwitch) {
      this.scene.cleanupBlocksForModeSwitch();
    }
  }

  public applyResponsiveAnswerLayouts(
    strategyId: ResponsiveLayoutStrategyId,
    safeWidth: number,
    safeHeight: number
  ): void {
    const scene = this.scene;
    if (strategyId === 'round1-pronunciation') {
      if (scene.currentAnswerRatios.length <= 0) {
        this.resetResponsiveAnswerLayouts(safeWidth);
        return;
      }
      scene.activeCardLayouts = scene.computeAnswerCardLayouts(scene.currentAnswerRatios, safeWidth, safeHeight);
      scene.LANE_X_POSITIONS = scene.activeCardLayouts.map((layout) => layout.centerX);
      if (scene.activeCardLayouts.length > 0) {
        scene.updateJumpVelocityByCardHeight(scene.getMaxCardHeight(scene.activeCardLayouts));
      }
      return;
    }

    if (scene.currentAnswerRatios.length !== 3) {
      this.resetResponsiveAnswerLayouts(safeWidth);
      return;
    }

    scene.activeCardLayouts = scene.computeAnswerCardLayouts(scene.currentAnswerRatios, safeWidth, safeHeight);
    scene.LANE_X_POSITIONS = scene.activeCardLayouts.map((layout) => layout.centerX);
    if (scene.activeCardLayouts.length > 0) {
      scene.updateJumpVelocityByCardHeight(scene.getMaxCardHeight(scene.activeCardLayouts));
    }
  }

  public relayoutBlocks(safeWidth: number, safeHeight: number): void {
    const scene = this.scene;
    if (!scene.blocks) return;
    scene.blocks.children.iterate((rawBlock) => {
      const block = rawBlock as Phaser.Types.Physics.Arcade.GameObjectWithBody | undefined;
      if (!block || !(block as { active?: boolean }).active) return true;

      const rawGetData = (block as { getData?: unknown }).getData;
      const rawSetData = (block as { setData?: unknown }).setData;
      if (typeof rawGetData !== 'function' || typeof rawSetData !== 'function') return true;

      const getData = (key: string): unknown => rawGetData.call(block, key);
      const setData = (key: string, value: unknown): void => {
        rawSetData.call(block, key, value);
      };
      if (getData('isCleaningUp')) return true;

      const answerIndex = getData('answerIndex');
      const visuals = getData('visuals') as Phaser.GameObjects.Container | undefined;
      const blockWithBody = block as Phaser.Types.Physics.Arcade.GameObjectWithBody & {
        x: number;
        y: number;
        setDisplaySize(width: number, height: number): void;
        refreshBody(): void;
      };

      if (getData('blindBox')) {
        const blindImageRatioRaw = getData('blindImageRatio');
        const blindImageRatio = typeof blindImageRatioRaw === 'number' && Number.isFinite(blindImageRatioRaw)
          ? blindImageRatioRaw
          : 1;
        const blindLayout = (
          typeof answerIndex === 'number' && scene.activeCardLayouts[answerIndex]
        )
          ? scene.activeCardLayouts[answerIndex]
          : scene.getBlindBoxLayoutForResize(safeWidth, safeHeight, blindImageRatio);
        const blindCenterX = Math.round(blindLayout.centerX);
        const blindCenterY = Math.round(scene.blockCenterY);
        const blindWidth = Math.round('cardWidth' in blindLayout ? blindLayout.cardWidth : blindLayout.width);
        const blindHeight = Math.round('cardHeight' in blindLayout ? blindLayout.cardHeight : blindLayout.height);
        const blindImageWidth = Math.round('iconWidth' in blindLayout ? blindLayout.iconWidth : blindLayout.imageWidth);
        const blindImageHeight = Math.round('iconHeight' in blindLayout ? blindLayout.iconHeight : blindLayout.imageHeight);

        blockWithBody.x = blindCenterX;
        blockWithBody.y = blindCenterY;
        blockWithBody.setDisplaySize(blindWidth, blindHeight);
        blockWithBody.refreshBody();
        setData('blindImageWidth', blindImageWidth);
        setData('blindImageHeight', blindImageHeight);

        if (visuals) {
          visuals.setPosition(blindCenterX, blindCenterY);
          const cardFrame = getData('blindCardFrame') as Phaser.GameObjects.Image | undefined;
          const cardGlow = getData('blindCardGlow') as Phaser.GameObjects.Rectangle | undefined;
          const revealIcon = getData('answerIcon') as Phaser.GameObjects.Image | undefined;
          const questionMark = getData('blindQuestionMark') as Phaser.GameObjects.Text | undefined;
          const sparkleLeft = getData('blindSparkleLeft') as Phaser.GameObjects.Ellipse | undefined;
          const sparkleRight = getData('blindSparkleRight') as Phaser.GameObjects.Ellipse | undefined;
          if (cardFrame) {
            cardFrame.setDisplaySize(blindWidth, blindHeight);
          }
          if (cardGlow) {
            cardGlow.setSize(blindWidth * 0.98, blindHeight * 0.98);
          }
          if (revealIcon) {
            revealIcon.setDisplaySize(blindImageWidth, blindImageHeight);
          }
          if (questionMark) questionMark.setVisible(false);
          if (sparkleLeft) sparkleLeft.setVisible(false);
          if (sparkleRight) sparkleRight.setVisible(false);
        }
        return true;
      }

      if (typeof answerIndex === 'number' && scene.activeCardLayouts[answerIndex]) {
        const layout = scene.activeCardLayouts[answerIndex];
        scene.applyBlockVisualLayout(blockWithBody, visuals, layout);
        return true;
      }

      const optionId = getData('optionId') as string | undefined;
      if (optionId) {
        const optionX = optionId === 'retry' ? scene.getLaneXPosition(0) : scene.getLaneXPosition(2);
        const optionSize = 240 * scene.gameScale;
        blockWithBody.x = optionX;
        blockWithBody.y = scene.blockCenterY;
        blockWithBody.setDisplaySize(optionSize, optionSize);
        blockWithBody.refreshBody();

        if (visuals) {
          visuals.x = optionX;
          visuals.y = scene.blockCenterY;
          const bubble = visuals.list[0] as Phaser.GameObjects.Image | undefined;
          const icon = visuals.list[1] as Phaser.GameObjects.Image | undefined;
          if (bubble) bubble.setDisplaySize(optionSize, optionSize);
          if (icon) {
            const iconSize = optionSize * 0.5;
            icon.setDisplaySize(iconSize, iconSize);
          }
        }
      }
      return true;
    });
  }

  public destroy(): void {
    if (this.scene.cleanupBlocksForModeSwitch) {
      this.scene.cleanupBlocksForModeSwitch();
    }
  }

  private resetResponsiveAnswerLayouts(safeWidth: number): void {
    const scene = this.scene;
    scene.activeCardLayouts = [];
    scene.LANE_X_POSITIONS = [safeWidth * 0.20, safeWidth * 0.5, safeWidth * 0.80];
  }
}
