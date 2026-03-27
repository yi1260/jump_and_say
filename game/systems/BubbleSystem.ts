import Phaser from 'phaser';
import {
  buildBubblePresentation,
  resolveBubbleVisualAngle,
  resolveBubbleFloatVelocity,
  ROUND3_BUBBLE_PALETTE,
  sampleBubbleDrift,
  type BubbleDriftConfig
} from '../modes/round3/bubblePresentation';
import { createBubbleHeadHitImpulse } from '../modes/round3/round3BubblePopLogic';

const FONT_STACK = '"FredokaBoot", "FredokaLatin", "Fredoka", "ZCOOL KuaiLe UI", "ZCOOL KuaiLe", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif';
const BUBBLE_ROTATION_SETTLE_MS = 240;

export interface BubbleSpawnDefinition {
  id: string;
  word: string;
  isCorrect: boolean;
  x: number;
  y: number;
  radius: number;
  textureKey: string | null;
  imageAspectRatio: number;
  visualSeed: number;
}

type BubbleBody = Phaser.Physics.Arcade.Image;

export interface BubbleWaveStateSnapshot {
  active: boolean;
  isCorrect: boolean;
  hasLanded: boolean;
  isPopping: boolean;
}

export class BubbleSystem {
  private readonly scene: Phaser.Scene;
  public readonly bubbleGroup: Phaser.Physics.Arcade.Group;
  private readonly groupCollider: Phaser.Physics.Arcade.Collider;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.bubbleGroup = this.scene.physics.add.group();
    this.groupCollider = this.scene.physics.add.collider(this.bubbleGroup, this.bubbleGroup);
  }

  public spawnWave(entries: BubbleSpawnDefinition[]): void {
    this.clearWave();
    entries.forEach((entry) => {
      this.createBubble(entry);
    });
    this.update(this.scene.time.now);
  }

  public clearWave(): void {
    this.getActiveBubbles().forEach((bubble) => {
      this.destroyBubble(bubble);
    });
  }

  public update(time: number): void {
    this.getActiveBubbles().forEach((bubble) => {
      const body = bubble.body as Phaser.Physics.Arcade.Body;
      const drift = bubble.getData('drift') as BubbleDriftConfig | undefined;
      const spawnedAt = bubble.getData('spawnedAt');
      const spawnedAtMs = typeof spawnedAt === 'number' ? spawnedAt : time;
      const elapsedMs = Math.max(0, time - spawnedAtMs);
      const radiusRaw = bubble.getData('radius');
      const radius = typeof radiusRaw === 'number' && Number.isFinite(radiusRaw)
        ? radiusRaw
        : bubble.displayWidth * 0.5;
      const impulseUntilRaw = bubble.getData('impulseUntil');
      const impulseUntil = typeof impulseUntilRaw === 'number' ? impulseUntilRaw : 0;
      const isUnderImpulse = impulseUntil > time;
      const settleStartedAtRaw = bubble.getData('settleStartedAt');
      const settleStartedAt = typeof settleStartedAtRaw === 'number' ? settleStartedAtRaw : 0;
      const floatAnchorRatioRaw = bubble.getData('floatAnchorRatio');
      const floatAnchorRatio = typeof floatAnchorRatioRaw === 'number'
        ? floatAnchorRatioRaw
        : 0.5;
      const worldBounds = this.scene.physics.world.bounds;
      const floatAnchorY = Phaser.Math.Clamp(
        worldBounds.top + worldBounds.height * floatAnchorRatio,
        worldBounds.top + radius * 1.2,
        worldBounds.bottom - radius * 1.4
      );

      if (
        body.blocked.down ||
        body.touching.down ||
        bubble.y >= this.scene.physics.world.bounds.bottom - radius - 2
      ) {
        bubble.setData('hasLanded', true);
      }

      this.constrainBubbleToHorizontalBounds(bubble, body, radius);
      let driftRotation = 0;

      if (drift) {
        const driftSample = sampleBubbleDrift(drift, elapsedMs);
        driftRotation = driftSample.rotation;

        if (body.enable && !isUnderImpulse) {
          let nextVelocityX = driftSample.velocityX;
          let nextVelocityY = resolveBubbleFloatVelocity({
            bubbleY: bubble.y,
            anchorY: floatAnchorY,
            bubbleRadius: radius,
            fallVelocityY: driftSample.velocityY,
            hoverOffsetY: driftSample.hoverOffsetY
          });

          if (body.blocked.left && nextVelocityX < 0) {
            nextVelocityX = Math.abs(nextVelocityX) * 0.72;
          } else if (body.blocked.right && nextVelocityX > 0) {
            nextVelocityX = -Math.abs(nextVelocityX) * 0.72;
          }

          if (body.blocked.down) {
            nextVelocityY = -Math.max(24, radius * 0.24);
          }

          body.setVelocity(nextVelocityX, nextVelocityY);
        }
      }

      if (body.enable && !isUnderImpulse && impulseUntil !== 0) {
        bubble.setData('impulseUntil', 0);
        bubble.setData('spawnedAt', time);
        bubble.setData('settleStartedAt', time);
      }

      const labelContainer = bubble.getData('labelContainer') as Phaser.GameObjects.Container | undefined;
      if (!labelContainer || !labelContainer.active) {
        return;
      }
      const rotationRecoveryProgress = isUnderImpulse
        ? 0
        : settleStartedAt > 0
          ? Phaser.Math.Clamp((time - settleStartedAt) / BUBBLE_ROTATION_SETTLE_MS, 0, 1)
          : 1;
      labelContainer.setPosition(bubble.x, bubble.y);
      labelContainer.setAngle(
        resolveBubbleVisualAngle(bubble.angle, driftRotation, rotationRecoveryProgress)
      );

      if (!isUnderImpulse && settleStartedAt > 0 && rotationRecoveryProgress >= 1) {
        bubble.setAngularVelocity(0);
        bubble.setAngle(driftRotation);
        bubble.setData('settleStartedAt', 0);
      }
    });
  }

  public clampToViewport(width: number, height: number): void {
    this.getActiveBubbles().forEach((bubble) => {
      const radiusRaw = bubble.getData('radius');
      const radius = typeof radiusRaw === 'number' && Number.isFinite(radiusRaw)
        ? radiusRaw
        : bubble.displayWidth * 0.5;
      const clampedX = Phaser.Math.Clamp(bubble.x, radius, Math.max(radius, width - radius));
      const clampedY = Phaser.Math.Clamp(bubble.y, -radius * 2, Math.max(-radius * 2, height - radius));
      if (clampedX === bubble.x && clampedY === bubble.y) {
        return;
      }

      bubble.setPosition(clampedX, clampedY);
      const body = bubble.body as Phaser.Physics.Arcade.Body;
      body.reset(clampedX, clampedY);
    });

    this.update(this.scene.time.now);
  }

  public getWaveStateSnapshot(): BubbleWaveStateSnapshot[] {
    return this.getActiveBubbles().map((bubble) => ({
      active: bubble.active,
      isCorrect: bubble.getData('isCorrect') === true,
      hasLanded: bubble.getData('hasLanded') === true,
      isPopping: bubble.getData('isPopping') === true
    }));
  }

  public applyWrongHitImpulse(
    bubble: BubbleBody,
    playerX: number,
    playerVelocityY: number
  ): void {
    if (!bubble.active) {
      return;
    }

    const body = bubble.body as Phaser.Physics.Arcade.Body;
    const radiusRaw = bubble.getData('radius');
    const radius = typeof radiusRaw === 'number' && Number.isFinite(radiusRaw)
      ? radiusRaw
      : bubble.displayWidth * 0.5;
    const impulse = createBubbleHeadHitImpulse({
      bubbleX: bubble.x,
      playerX,
      bubbleRadius: radius,
      playerVelocityY
    });

    body.setVelocity(impulse.velocityX, impulse.velocityY);
    bubble.setAngularVelocity(impulse.angularVelocity);
    bubble.setData('impulseUntil', this.scene.time.now + impulse.impulseDurationMs);
    bubble.setData('settleStartedAt', 0);
  }

  public popBubble(bubble: BubbleBody, onComplete?: () => void): void {
    if (!bubble.active) {
      onComplete?.();
      return;
    }

    const body = bubble.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
    bubble.setData('impulseUntil', 0);

    const labelContainer = bubble.getData('labelContainer') as Phaser.GameObjects.Container | undefined;
    const tweenTargets: Array<Phaser.GameObjects.GameObject> = [bubble];
    if (labelContainer && labelContainer.active) {
      tweenTargets.push(labelContainer);
    }

    bubble.setData('isPopping', true);
    this.scene.tweens.killTweensOf(tweenTargets);
    this.scene.tweens.add({
      targets: tweenTargets,
      scaleX: 1.18,
      scaleY: 1.18,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.destroyBubble(bubble);
        onComplete?.();
      }
    });
  }

  public destroy(): void {
    this.clearWave();
    this.groupCollider.destroy();
    this.bubbleGroup.destroy(true);
  }

  private createBubble(entry: BubbleSpawnDefinition): void {
    const presentation = buildBubblePresentation(entry.radius, entry.imageAspectRatio, entry.visualSeed);
    const diameter = presentation.bodyRadius * 2;
    const bubble = this.scene.physics.add.image(entry.x, entry.y, 'bubble_base');
    bubble.setDisplaySize(diameter, diameter);
    bubble.setDepth(22);
    bubble.setAlpha(0.012);
    bubble.setTint(ROUND3_BUBBLE_PALETTE.shellFillColor);

    const body = bubble.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(presentation.bodyRadius, 0, 0);
    body.setBounce(0.96, 0.92);
    bubble.setAngularDrag(Math.round(Math.max(520, presentation.bodyRadius * 4)));
    bubble.setCollideWorldBounds(true, 0.96, 0.92);
    body.setVelocity(0, 0);
    body.setMaxVelocity(
      Math.round(Math.max(320, presentation.bodyRadius * 2.3)),
      Math.round(Math.max(680, presentation.bodyRadius * 4.4))
    );

    // --- 简洁单圆泡泡 ---
    const shellRadius = presentation.bodyRadius;
    const shellDiameter = shellRadius * 2;

    // 主泡泡圆 - 极淡透明填充 + 细边框
    const mainCircle = this.scene.add.ellipse(
      0, 0,
      shellDiameter, shellDiameter,
      ROUND3_BUBBLE_PALETTE.shellFillColor,
      ROUND3_BUBBLE_PALETTE.shellFillAlpha
    );
    mainCircle.setStrokeStyle(
      Math.max(1.5, Math.round(shellRadius * 0.012)),
      ROUND3_BUBBLE_PALETTE.shellStrokeColor,
      ROUND3_BUBBLE_PALETTE.shellStrokeAlpha
    );

    // 高光 - 左上角玻璃反射弧
    const highlightW = Math.round(shellRadius * 0.5);
    const highlightH = Math.round(shellRadius * 0.2);
    const highlight = this.scene.add.ellipse(
      -Math.round(shellRadius * 0.28),
      -Math.round(shellRadius * 0.32),
      highlightW,
      highlightH,
      0xffffff,
      0.32
    );
    highlight.setAngle(-25);

    // 微小星光
    const sparkleSize = Math.max(6, Math.round(shellRadius * 0.05));
    const sparkle = this.scene.add.ellipse(
      Math.round(shellRadius * 0.3),
      -Math.round(shellRadius * 0.15),
      sparkleSize,
      sparkleSize,
      0xffffff,
      0.28
    );

    // 卡片背景
    const cardCornerRadius = Math.round(
      Math.min(presentation.cardWidth, presentation.cardHeight) * 0.18
    );
    const cardStrokeWidth = Math.max(2, Math.round(shellRadius * 0.015));
    const cardBackground = this.scene.add.graphics();
    cardBackground.fillStyle(ROUND3_BUBBLE_PALETTE.cardFillColor, 0.94);
    cardBackground.fillRoundedRect(
      -presentation.cardWidth / 2,
      -presentation.cardHeight / 2,
      presentation.cardWidth,
      presentation.cardHeight,
      cardCornerRadius
    );
    cardBackground.lineStyle(
      cardStrokeWidth,
      ROUND3_BUBBLE_PALETTE.cardStrokeColor,
      ROUND3_BUBBLE_PALETTE.cardStrokeAlpha
    );
    cardBackground.strokeRoundedRect(
      -presentation.cardWidth / 2,
      -presentation.cardHeight / 2,
      presentation.cardWidth,
      presentation.cardHeight,
      cardCornerRadius
    );

    // 卡片内容（图片或文字）
    const content = this.createBubbleCardContent(entry, presentation.imageWidth, presentation.imageHeight);

    const labelContainer = this.scene.add.container(entry.x, entry.y, [
      mainCircle,
      highlight,
      sparkle,
      cardBackground,
      content
    ]);
    labelContainer.setDepth(25);

    // 呼吸动画
    const pulseTween = this.scene.tweens.add({
      targets: labelContainer,
      scaleX: 1.03,
      scaleY: 0.975,
      duration: Phaser.Math.Between(1200, 1800),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    bubble.setData('bubbleId', entry.id);
    bubble.setData('word', entry.word);
    bubble.setData('isCorrect', entry.isCorrect);
    bubble.setData('radius', presentation.bodyRadius);
    bubble.setData('labelContainer', labelContainer);
    bubble.setData('pulseTween', pulseTween);
    bubble.setData('isPopping', false);
    bubble.setData('hitLocked', false);
    bubble.setData('hasLanded', false);
    bubble.setData('impulseUntil', 0);
    bubble.setData('settleStartedAt', 0);
    bubble.setData('drift', presentation.drift);
    bubble.setData('floatAnchorRatio', 0.49 + (entry.visualSeed - 0.5) * 0.05);
    bubble.setData('spawnedAt', this.scene.time.now);

    this.bubbleGroup.add(bubble);
  }

  private createBubbleCardContent(
    entry: BubbleSpawnDefinition,
    width: number,
    height: number
  ): Phaser.GameObjects.GameObject {
    if (entry.textureKey && this.scene.textures.exists(entry.textureKey)) {
      return this.scene.add.image(0, 0, entry.textureKey).setDisplaySize(width, height);
    }

    return this.scene.add.text(0, 0, entry.word, {
      fontFamily: FONT_STACK,
      fontStyle: '900',
      fontSize: `${Math.max(22, Math.round(Math.min(width, height) * 0.28))}px`,
      color: ROUND3_BUBBLE_PALETTE.textColor,
      align: 'center',
      wordWrap: { width: width * 0.92 }
    }).setOrigin(0.5);
  }

  private destroyBubble(bubble: BubbleBody): void {
    const pulseTween = bubble.getData('pulseTween') as Phaser.Tweens.Tween | undefined;
    if (pulseTween) {
      pulseTween.remove();
    }

    const labelContainer = bubble.getData('labelContainer') as Phaser.GameObjects.Container | undefined;
    if (labelContainer && labelContainer.active) {
      this.scene.tweens.killTweensOf(labelContainer);
      labelContainer.destroy();
    }

    this.scene.tweens.killTweensOf(bubble);
    bubble.setAngularVelocity(0);
    bubble.destroy();
  }

  private constrainBubbleToHorizontalBounds(
    bubble: BubbleBody,
    body: Phaser.Physics.Arcade.Body,
    radius: number
  ): void {
    const worldBounds = this.scene.physics.world.bounds;
    const minX = worldBounds.left + radius;
    const maxX = worldBounds.right - radius;
    const clampedX = Phaser.Math.Clamp(bubble.x, minX, Math.max(minX, maxX));

    if (clampedX === bubble.x) {
      return;
    }

    const currentVelocityY = body.velocity.y;
    const currentVelocityX = body.velocity.x;
    body.reset(clampedX, bubble.y);

    if (clampedX <= minX) {
      body.setVelocityX(Math.abs(currentVelocityX));
    } else if (clampedX >= maxX) {
      body.setVelocityX(-Math.abs(currentVelocityX));
    }

    body.setVelocityY(currentVelocityY);
  }

  private getActiveBubbles(): BubbleBody[] {
    const bubbles: BubbleBody[] = [];
    this.bubbleGroup.children.iterate((child) => {
      const bubble = child as BubbleBody | undefined;
      if (bubble && bubble.active) {
        bubbles.push(bubble);
      }
      return true;
    });
    return bubbles;
  }
}
