import Phaser from 'phaser';
import { motionController } from '../../services/motionController';

interface PlayerControlSceneHost {
  player: Phaser.Physics.Arcade.Sprite;
  floorSurfaceY: number;
  stableViewportWidth: number;
  stableViewportHeight: number;
  playerHeight: number;
  gameScale: number;
  targetLaneIndex: number;
  jumpVelocity: number;
  isInteractionActive: boolean;
  isPronunciationFlowEnabled(): boolean;
  getLaneXPosition(index: number): number;
  getScaledPhysicsValue(baseValue: number): number;
  GRAVITY_Y: number;
  PLAYER_MAX_LEAN_ANGLE: number;
  PLAYER_LEAN_LERP: number;
  POS_FROM_LEFT: number;
  POS_FROM_RIGHT: number;
  POS_TO_LEFT: number;
  POS_TO_RIGHT: number;
  input: Phaser.Input.InputPlugin;
  jumpSound: Phaser.Sound.BaseSound;
  jumpBurstEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class PlayerControlSystem {
  private readonly sceneRef: unknown;

  constructor(scene: unknown) {
    this.sceneRef = scene;
  }

  private get scene(): PlayerControlSceneHost {
    return this.sceneRef as PlayerControlSceneHost;
  }

  public update(): void {
    const scene = this.scene;
    if (!scene.player || !scene.player.body) return;
    if (scene.isPronunciationFlowEnabled() && !scene.player.visible) {
      const hiddenBody = scene.player.body as Phaser.Physics.Arcade.Body;
      hiddenBody.setVelocity(0, 0);
      scene.player.setAngle(0);
      return;
    }

    this.recoverPlayerIfCorrupted();
    this.stabilizePlayerOnFloor();

    const body = scene.player.body as Phaser.Physics.Arcade.Body;
    const nearFloor = Math.abs(scene.player.y - scene.floorSurfaceY) <= Math.max(1.5, 4 * scene.gameScale);
    const isSlowVertical = Math.abs(body.velocity.y) <= scene.getScaledPhysicsValue(30);
    const isOnGround = (
      body.touching.down ||
      body.blocked.down ||
      body.wasTouching.down ||
      (nearFloor && isSlowVertical)
    );

    const motionState = motionController.state;
    const effectiveState = motionController.smoothedState || motionState;
    if (isOnGround) {
      const bodyX = Phaser.Math.Clamp(
        typeof effectiveState.bodyX === 'number' ? effectiveState.bodyX : (1 - effectiveState.rawNoseX),
        0,
        1
      );
      const newLane = this.getHysteresisLane(bodyX, scene.targetLaneIndex);
      scene.targetLaneIndex = newLane;
      const targetX = scene.getLaneXPosition(scene.targetLaneIndex);
      scene.player.x = Phaser.Math.Linear(scene.player.x, targetX, 0.28);

      if (scene.player.anims.currentAnim?.key !== 'p1_walk') {
        scene.player.play('p1_walk', true);
      }

      if (effectiveState.isJumping && scene.isInteractionActive) {
        scene.player.setVelocityY(-scene.jumpVelocity);
        scene.player.setTexture('p1_jump');
        scene.player.anims.stop();
        scene.jumpSound.play();
        scene.jumpBurstEmitter.emitParticleAt(scene.player.x, scene.player.y, 1);
        scene.jumpBurstEmitter.explode(20, scene.player.x, scene.player.y);
      }
    } else if (body.velocity.y > 0) {
      scene.player.setTexture('p1_stand');
    }

    scene.player.setVelocityX(0);

    const targetXForAngle = scene.getLaneXPosition(scene.targetLaneIndex);
    const diff = targetXForAngle - scene.player.x;
    const laneSpacing = Math.max(1, Math.abs(scene.getLaneXPosition(1) - scene.getLaneXPosition(0)));
    const normalizedDiff = Phaser.Math.Clamp(diff / laneSpacing, -1, 1);
    const targetLeanAngle = normalizedDiff * scene.PLAYER_MAX_LEAN_ANGLE;
    const nextLeanAngle = Phaser.Math.Linear(scene.player.angle, targetLeanAngle, scene.PLAYER_LEAN_LERP);
    scene.player.setAngle(nextLeanAngle);

    const cursors = scene.input.keyboard?.createCursorKeys();
    if (!cursors) return;
    if (Phaser.Input.Keyboard.JustDown(cursors.left)) {
      scene.targetLaneIndex = Math.max(0, scene.targetLaneIndex - 1);
    } else if (Phaser.Input.Keyboard.JustDown(cursors.right)) {
      scene.targetLaneIndex = Math.min(2, scene.targetLaneIndex + 1);
    }
    if ((Phaser.Input.Keyboard.JustDown(cursors.up) || Phaser.Input.Keyboard.JustDown(cursors.space)) && isOnGround) {
      scene.player.setVelocityY(-scene.jumpVelocity);
      scene.player.setTexture('p1_jump');
      scene.player.anims.stop();
      scene.jumpSound.play();
      scene.jumpBurstEmitter.explode(20, scene.player.x, scene.player.y);
    }
  }

  private recoverPlayerIfCorrupted(): void {
    const scene = this.scene;
    if (!scene.player || !scene.player.body) return;
    const laneTargetX = scene.getLaneXPosition(scene.targetLaneIndex);
    const isCorruptedX = (
      !Number.isFinite(scene.player.x) ||
      scene.player.x < -scene.stableViewportWidth ||
      scene.player.x > scene.stableViewportWidth * 2
    );
    const isCorruptedY = (
      !Number.isFinite(scene.player.y) ||
      scene.player.y < -scene.playerHeight * 2 ||
      scene.player.y > scene.stableViewportHeight * 2
    );
    const isPinnedToTopLeft = scene.player.x <= 2 && scene.player.y <= 2;
    if (!isCorruptedX && !isCorruptedY && !isPinnedToTopLeft) {
      return;
    }

    const safeX = laneTargetX;
    const safeY = scene.floorSurfaceY;
    scene.player.setPosition(safeX, safeY);
    const body = scene.player.body as Phaser.Physics.Arcade.Body;
    body.reset(safeX, safeY);
    body.setVelocity(0, 0);
    scene.player.setAngle(0);
  }

  private stabilizePlayerOnFloor(): void {
    const scene = this.scene;
    if (!scene.player || !scene.player.body) return;
    const body = scene.player.body as Phaser.Physics.Arcade.Body;
    const laneSpacing = Math.max(1, Math.abs(scene.getLaneXPosition(1) - scene.getLaneXPosition(0)));
    const clampedX = Phaser.Math.Clamp(
      scene.player.x,
      scene.getLaneXPosition(0) - laneSpacing,
      scene.getLaneXPosition(2) + laneSpacing
    );

    const hardOutOfBounds = (
      !Number.isFinite(scene.player.y) ||
      !Number.isFinite(body.bottom) ||
      scene.player.y > scene.floorSurfaceY + Math.max(scene.playerHeight, 36 * scene.gameScale) ||
      body.top > scene.stableViewportHeight + Math.max(scene.playerHeight, 36 * scene.gameScale)
    );
    if (!hardOutOfBounds) return;

    scene.player.setPosition(clampedX, scene.floorSurfaceY);
    body.reset(clampedX, scene.floorSurfaceY);
    body.setVelocity(0, 0);
    scene.player.setAngle(0);
  }

  private getHysteresisLane(bodyX: number, currentLaneIndex: number): number {
    const scene = this.scene;
    if (currentLaneIndex === 0) {
      return bodyX > scene.POS_FROM_LEFT ? 1 : 0;
    }
    if (currentLaneIndex === 2) {
      return bodyX < scene.POS_FROM_RIGHT ? 1 : 2;
    }
    if (bodyX < scene.POS_TO_LEFT) return 0;
    if (bodyX > scene.POS_TO_RIGHT) return 2;
    return 1;
  }
}

