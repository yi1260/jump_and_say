import Phaser from 'phaser';

/**
 * 横版平台游戏玩家控制系统
 *
 * 负责处理玩家的左右移动和跳跃控制
 * 支持键盘控制（左右箭头 + 空格跳跃）
 */
export interface ShieldState {
  duration: number;
  remainingTime: number;
  level: 'blue' | 'green' | 'gold';
}

/**
 * 横版平台游戏玩家控制系统
 *
 * 负责处理玩家的左右移动和跳跃控制
 * 支持键盘控制（左右箭头 + 空格跳跃）
 */
export class PlatformPlayerControlSystem {
  private scene: Phaser.Scene;
  private player: Phaser.Physics.Arcade.Sprite;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private isPaused: boolean = false;

  // Shield system
  private shieldActive: boolean = false;
  private shieldState: ShieldState | null = null;
  private shieldSprite: Phaser.GameObjects.Sprite | null = null;
  private shieldUpdateCallback: ((state: ShieldState | null) => void) | null = null;

  // 移动常量
  private readonly PLAYER_SPEED = 300;
  private readonly JUMP_VELOCITY = -1100; // 重力1800下，跳跃高度 = 1100²/(2×1800) ≈ 336px

  constructor(scene: Phaser.Scene, player: Phaser.Physics.Arcade.Sprite) {
    this.scene = scene;
    this.player = player;
    this.cursors = scene.input.keyboard!.createCursorKeys();

    // Create shield sprite (initially invisible)
    this.createShieldSprite();
  }

  private createShieldSprite() {
    // Create shield sprites for each level
    // Blue shield (3s)
    const blueShield = this.scene.add.graphics();
    blueShield.lineStyle(3, 0x4A90E2, 0.6);
    blueShield.strokeCircle(35, 35, 35);
    blueShield.generateTexture('shield_blue', 70, 70);
    blueShield.destroy();

    // Green shield (5s)
    const greenShield = this.scene.add.graphics();
    greenShield.lineStyle(3, 0x4CAF50, 0.7);
    greenShield.strokeCircle(35, 35, 35);
    greenShield.generateTexture('shield_green', 70, 70);
    greenShield.destroy();

    // Gold shield (6s with glow effect)
    const goldShield = this.scene.add.graphics();
    goldShield.lineStyle(4, 0xFFD700, 0.8);
    goldShield.strokeCircle(42, 42, 38);
    goldShield.lineStyle(2, 0xFFA500, 0.4);
    goldShield.strokeCircle(42, 42, 42);
    goldShield.generateTexture('shield_gold', 84, 84);
    goldShield.destroy();
  }

  setPaused(paused: boolean) {
    this.isPaused = paused;
  }

  public update(): void {
    if (!this.player || !this.player.body || this.isPaused) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // 检测是否在地面上
    const isOnGround = body.touching.down || body.blocked.down;

    // 左右移动
    if (this.cursors.left.isDown) {
      body.setVelocityX(-this.PLAYER_SPEED);
      this.player.setFlipX(true); // 面向左

      // 播放行走动画（仅在地面）
      if (isOnGround) {
        this.player.anims.play('player_walk', true);
      }
    } else if (this.cursors.right.isDown) {
      body.setVelocityX(this.PLAYER_SPEED);
      this.player.setFlipX(false); // 面向右

      // 播放行走动画（仅在地面）
      if (isOnGround) {
        this.player.anims.play('player_walk', true);
      }
    } else {
      // 停止移动
      body.setVelocityX(0);

      // 停止动画，显示站立状态
      if (isOnGround) {
        this.player.anims.stop();
        this.player.setTexture('character_beige_idle');
      }
    }

    // 跳跃（仅在地面时）
    if ((this.cursors.up.isDown || this.cursors.space.isDown) && isOnGround) {
      body.setVelocityY(this.JUMP_VELOCITY);
      this.player.setTexture('character_beige_jump');
      this.player.anims.stop();

      // 播放跳跃音效
      try {
        (this.scene as any).jumpSound?.play();
      } catch (e) {
        // 忽略音效错误
      }
    }

    // 空中状态（下落）
    if (!isOnGround && body.velocity.y > 0) {
      this.player.setTexture('character_beige_jump');
    }
  }

  /**
   * 获取玩家当前是否面向右侧
   */
  public isFacingRight(): boolean {
    return !this.player.flipX;
  }

  /**
   * 获取玩家是否在地面上
   */
  public isOnGround(): boolean {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    return body.touching.down || body.blocked.down;
  }

  /**
   * Activate shield for specified duration
   */
  activateShield(duration: number, level: 'blue' | 'green' | 'gold'): void {
    this.shieldActive = true;
    this.shieldState = {
      duration,
      remainingTime: duration,
      level,
    };

    // Show shield sprite
    if (this.shieldSprite) {
      this.shieldSprite.setTexture(`shield_${level}`);
      this.shieldSprite.setPosition(this.player.x, this.player.y - 10);
      this.shieldSprite.setVisible(true);
      this.shieldSprite.setScale(0);

      // Scale in animation
      this.scene.tweens.add({
        targets: this.shieldSprite,
        scale: 1,
        duration: 300,
        ease: 'Back.out',
      });
    }

    console.log(`[Shield] Activated ${level} shield for ${duration}s`);
  }

  /**
   * Deactivate shield
   */
  deactivateShield(): void {
    this.shieldActive = false;
    this.shieldState = null;

    if (this.shieldSprite) {
      // Scale out animation
      this.scene.tweens.add({
        targets: this.shieldSprite,
        scale: 0,
        duration: 200,
        onComplete: () => {
          this.shieldSprite?.setVisible(false);
        }
      });
    }

    console.log('[Shield] Deactivated');
  }

  /**
   * Update shield state (call every frame)
   */
  updateShield(delta: number): void {
    if (!this.shieldActive || !this.shieldState) return;

    this.shieldState.remainingTime -= delta / 1000;

    // Update shield sprite position to follow player
    if (this.shieldSprite && this.shieldSprite.visible) {
      this.shieldSprite.x = this.player.x;
      this.shieldSprite.y = this.player.y - 10;
    }

    // Check if shield expired
    if (this.shieldState.remainingTime <= 0) {
      this.deactivateShield();
    }

    // Notify callback for HUD updates
    if (this.shieldUpdateCallback) {
      this.shieldUpdateCallback(this.shieldState);
    }
  }

  /**
   * Register callback for shield state updates
   */
  onShieldUpdate(callback: (state: ShieldState | null) => void): void {
    this.shieldUpdateCallback = callback;
  }

  /**
   * Check if shield is active
   */
  isShieldActive(): boolean {
    return this.shieldActive;
  }

  /**
   * Get current shield state
   */
  getShieldState(): ShieldState | null {
    return this.shieldState;
  }
}
