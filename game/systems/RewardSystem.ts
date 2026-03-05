import Phaser from 'phaser';
import type {
  GameplayModeHost,
  GameplayModeId,
  QuizCollisionRewardPayload
} from '../modes/core/types';

const C_GOLD = 0xFFD700;
const C_AMBER = 0xFFA500;
const FONT_STACK = '"FredokaBoot", "FredokaLatin", "Fredoka", "ZCOOL KuaiLe UI", "ZCOOL KuaiLe", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif';

interface RewardRuntimeSceneHost extends GameplayModeHost {
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
  time: Phaser.Time.Clock;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  blockDebrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  blockSmokeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  blockFlashEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  getRewardTrailEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | null;
}

interface QuizRewardItem {
  key: string;
  score: number;
  scale: number;
  surprise: boolean;
}

export class RewardSystem {
  private readonly scene: RewardRuntimeSceneHost;

  constructor(scene: RewardRuntimeSceneHost) {
    this.scene = scene;
  }

  public onModeEnter(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('reward-system-enter', { modeId });
  }

  public onModeExit(modeId: GameplayModeId): void {
    this.scene.logModeRuntime('reward-system-exit', { modeId });
  }

  public playBlockExplosion(x: number, y: number): void {
    if (this.scene.blockDebrisEmitter) {
      this.scene.blockDebrisEmitter.explode(35, x, y);
    }
    if (this.scene.blockSmokeEmitter) {
      this.scene.blockSmokeEmitter.explode(10, x, y);
    }
    if (this.scene.blockFlashEmitter) {
      this.scene.blockFlashEmitter.explode(15, x, y);
    }
  }

  public playQuizCollisionReward(payload: QuizCollisionRewardPayload): number {
    const rewards: QuizRewardItem[] = [
      { key: 'star_gold', score: 1, scale: 1, surprise: false },
      { key: 'mushroom_red', score: 1, scale: 1, surprise: true },
      { key: 'mushroom_brown', score: 1, scale: 1, surprise: true },
      { key: 'gem_blue', score: 1, scale: 1, surprise: true },
      { key: 'gem_red', score: 1, scale: 1, surprise: true },
      { key: 'gem_green', score: 1, scale: 1, surprise: true },
      { key: 'gem_yellow', score: 1, scale: 1, surprise: true },
      { key: 'grass', score: 1, scale: 1, surprise: true },
      { key: 'grass_purple', score: 1, scale: 1, surprise: true }
    ];

    const random = Math.random();
    const reward = random < 0.6
      ? rewards[0]
      : rewards[Phaser.Math.Between(1, rewards.length - 1)];

    const gameScale = this.scene.getGameScaleValue();
    const rewardItem = this.scene.add.image(payload.blockX, payload.blockY, reward.key);
    rewardItem.setDepth(100);
    rewardItem.setScale(0);

    const baseScale = (reward.scale * gameScale) / 4;
    const trailTint = reward.surprise ? [0x00FFFF, 0xFF00FF, 0xFFFF00] : [C_GOLD, C_AMBER, 0xFF4500];
    const rewardTrailEmitter = this.scene.getRewardTrailEmitter();

    if (rewardTrailEmitter) {
      rewardTrailEmitter.setParticleTint(trailTint[0]);
      rewardTrailEmitter.startFollow(rewardItem);
      rewardTrailEmitter.start();
      rewardTrailEmitter.setFrequency(reward.surprise ? 16 : 26);
    }

    const rewardText = this.scene.add.text(payload.blockX, payload.blockY - 50 * gameScale, `+${reward.score}`, {
      fontSize: `${(reward.surprise ? 64 : 48) * gameScale}px`,
      fontFamily: FONT_STACK,
      fontStyle: 'bold',
      color: reward.surprise ? '#FFD700' : '#FFFFFF',
      stroke: '#000',
      strokeThickness: 8 * gameScale
    }).setOrigin(0.5).setDepth(110);

    this.scene.tweens.add({
      targets: rewardText,
      y: rewardText.y - 150 * gameScale,
      alpha: 0,
      scale: reward.surprise ? 1.5 : 1.2,
      duration: 2500,
      ease: 'Cubic.easeOut',
      onComplete: () => rewardText.destroy()
    });

    if (reward.surprise) {
      this.scene.cameras.main.shake(200, 0.01);
    }

    const waitTime = reward.surprise ? 260 : 220;
    const flightDuration = reward.surprise ? 1450 : 1250;
    const launchScaleFactor = reward.surprise ? 2.2 : 1.6;
    const launchHeight = reward.surprise ? 95 : 80;
    const scoreSettleDelayMs = 700 + waitTime + flightDuration;

    this.scene.tweens.add({
      targets: rewardItem,
      y: payload.blockY - launchHeight * gameScale,
      scaleX: baseScale * launchScaleFactor,
      scaleY: baseScale * launchScaleFactor,
      duration: 700,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.time.delayedCall(waitTime, () => {
          const { x: targetX, y: targetY } = this.scene.getScoreHudTargetPoint();
          const startX = rewardItem.x;
          const startY = rewardItem.y;
          const controlXOffset = Phaser.Math.Clamp((startX - targetX) * 0.22, -220 * gameScale, 220 * gameScale);
          const controlX = (startX + targetX) / 2 + controlXOffset;
          const controlY = Math.min(startY, targetY) - (reward.surprise ? 230 : 190) * gameScale;
          const flightCurve = new Phaser.Curves.QuadraticBezier(
            new Phaser.Math.Vector2(startX, startY),
            new Phaser.Math.Vector2(controlX, controlY),
            new Phaser.Math.Vector2(targetX, targetY)
          );

          this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: flightDuration,
            ease: 'Sine.easeInOut',
            onStart: () => {
              if (rewardTrailEmitter) {
                rewardTrailEmitter.setFrequency(reward.surprise ? 10 : 14);
              }
            },
            onUpdate: (tween) => {
              const progress = tween.getValue();
              const point = flightCurve.getPoint(progress);
              rewardItem.setPosition(point.x, point.y);
              rewardItem.setScale(baseScale * Phaser.Math.Linear(launchScaleFactor, 0.38, progress));
              rewardItem.setAlpha(Phaser.Math.Linear(1, 0.45, progress));
              rewardItem.setAngle(Phaser.Math.Linear(0, reward.surprise ? 540 : 360, progress));
            },
            onComplete: () => {
              rewardItem.destroy();
              if (rewardTrailEmitter) {
                rewardTrailEmitter.stop();
                rewardTrailEmitter.stopFollow();
              }
              this.scene.applyScoreDelta(reward.score);
            }
          });
        });
      }
    });

    return scoreSettleDelayMs;
  }

  public destroy(): void {
    // Reward animations are managed by Phaser tweens and auto-disposed with scene lifecycle.
  }
}
