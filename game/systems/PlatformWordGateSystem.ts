import Phaser from 'phaser';
import { level1Config } from '../data/levelConfig';

export interface Round1Result {
  correctCount: number;
  totalCount: number;
  accuracy: number;
  starCount: number;
}

/**
 * Platform Word Gate System
 *
 * Manages answer gates that trigger Round1 quiz scenes.
 * Each gate corresponds to one book from the level configuration.
 */
export class PlatformWordGateSystem {
  private scene: Phaser.Scene;
  private gates: Phaser.GameObjects.Container[] = [];
  private completedGates: boolean[] = [];
  private onGateCompleteCallbacks: ((gateIndex: number, result: Round1Result) => void)[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.completedGates = new Array(level1Config.books.length).fill(false);
  }

  /**
   * Create all gates based on level configuration
   */
  createGates(gatePositions: number[]): void {
    gatePositions.forEach((x, index) => {
      if (index < level1Config.books.length) {
        this.createGate(x, index);
      }
    });
  }

  /**
   * Create a single answer gate at position x
   */
  private createGate(x: number, gateIndex: number): void {
    const { height } = this.scene.scale.gameSize;
    const blockSize = 64;
    const groundY = height - blockSize / 2;
    const groundTop = groundY - blockSize / 2;
    const doorY = groundTop - 32; // 门中心在地面顶部上方 32px

    console.log(`[WordGate] Creating gate ${gateIndex + 1} at x=${x}, doorY=${doorY}`);

    // Closed door - 直接创建，不加入 container
    const door = this.scene.physics.add.staticSprite(x, doorY, 'door_closed');
    door.setDisplaySize(64, 64);
    door.refreshBody();

    // Guide block (黄色闪烁方块) - 放在门前面
    const guideBlockX = x - 80;
    const guideBlock = this.scene.physics.add.staticSprite(guideBlockX, doorY, 'block_yellow');
    guideBlock.setDisplaySize(48, 48);
    guideBlock.refreshBody();

    // 闪烁动画
    const tween = this.scene.tweens.add({
      targets: guideBlock,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    // 碰撞检测 - 玩家撞到引导方块触发答题
    const player = (this.scene as any).player;
    this.scene.physics.add.overlap(
      player,
      guideBlock,
      () => this.onGuideBlockHit(gateIndex, door, guideBlock, tween),
      undefined,
      this
    );

    // 保存引用
    this.gates[gateIndex] = this.scene.add.container(0, 0); // 占位
    this.completedGates[gateIndex] = false;

    console.log(`[WordGate] Gate ${gateIndex + 1} created: door at x=${x}, guideBlock at x=${guideBlockX}`);
  }

  /**
   * Handle guide block collision - show simple quiz popup
   */
  private async onGuideBlockHit(
    gateIndex: number,
    door: Phaser.Physics.Arcade.Sprite,
    guideBlock: Phaser.Physics.Arcade.Sprite,
    tween: Phaser.Tweens.Tween
  ): Promise<void> {
    if (this.completedGates[gateIndex]) return;

    console.log(`[WordGate] Gate ${gateIndex + 1} hit! Showing quiz popup...`);

    // Pause platform scene
    this.scene.physics.pause();
    (this.scene as any).playerControlSystem?.setPaused(true);
    (this.scene as any).enemySystem?.pauseAll();

    // Stop blink animation
    tween.stop();
    guideBlock.setVisible(false);

    // Get book data
    const bookConfig = level1Config.books[gateIndex];

    // Show simple quiz popup
    const result = await this.showSimpleQuiz(bookConfig.questions);

    // Complete the gate
    this.onQuizComplete(gateIndex, result, door);
  }

  /**
   * Show simple quiz popup with words and a button to pass
   */
  private showSimpleQuiz(questions: { question: string }[]): Promise<Round1Result> {
    return new Promise((resolve) => {
      const { width, height } = this.scene.scale.gameSize;
      const centerX = width / 2;
      const centerY = height / 2;

      // Semi-transparent overlay
      const overlay = this.scene.add.rectangle(0, 0, width, height, 0x000000, 0.85)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(100);

      // Quiz card background
      const cardBg = this.scene.add.rectangle(centerX, centerY, 500, 350, 0xffffff, 1)
        .setScrollFactor(0)
        .setDepth(101)
        .setStrokeStyle(6, 0x4CAF50);

      // Title
      const title = this.scene.add.text(centerX, centerY - 130, '答题关卡', {
        fontSize: '32px',
        color: '#333333',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(102);

      // Show first few words from the book
      const wordsToShow = questions.slice(0, 4).map(q => q.question).join(', ');
      const wordText = this.scene.add.text(centerX, centerY - 40, `单词: ${wordsToShow}`, {
        fontSize: '24px',
        color: '#555555',
        fontFamily: 'Arial, sans-serif',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(102);

      // Progress text
      const progressText = this.scene.add.text(centerX, centerY + 20, '点击按钮通过', {
        fontSize: '20px',
        color: '#888888',
        fontFamily: 'Arial, sans-serif',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(102);

      // Pass button
      const buttonBg = this.scene.add.rectangle(centerX, centerY + 100, 200, 60, 0x4CAF50, 1)
        .setScrollFactor(0)
        .setDepth(102);

      const buttonText = this.scene.add.text(centerX, centerY + 100, '✓ 通过', {
        fontSize: '28px',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(103);

      // Make button interactive
      buttonBg.setInteractive({ useHandCursor: true });
      buttonBg.on('pointerdown', () => {
        // Clean up all elements
        overlay.destroy();
        cardBg.destroy();
        title.destroy();
        wordText.destroy();
        progressText.destroy();
        buttonBg.destroy();
        buttonText.destroy();

        // Resolve with a good result (simulate perfect score for now)
        resolve({
          correctCount: questions.length,
          totalCount: questions.length,
          accuracy: 1.0,
          starCount: questions.length,
        });
      });

      // Button hover effect
      buttonBg.on('pointerover', () => buttonBg.setFillStyle(0x66BB6A));
      buttonBg.on('pointerout', () => buttonBg.setFillStyle(0x4CAF50));
    });
  }

  /**
   * Handle quiz completion - open door and grant rewards
   */
  private onQuizComplete(
    gateIndex: number,
    result: Round1Result,
    door: Phaser.Physics.Arcade.Sprite
  ): void {
    console.log(`[WordGate] Quiz completed for gate ${gateIndex + 1}`, result);

    this.completedGates[gateIndex] = true;

    // Open the door
    door.setTexture('door_open');
    door.disableBody(true, false);

    // Calculate and grant shield reward based on accuracy
    const shieldDuration = this.calculateShieldDuration(result.accuracy);
    if (shieldDuration > 0) {
      const shieldLevel = this.getShieldLevel(shieldDuration);
      const playerControlSystem = (this.scene as any).playerControlSystem;

      if (playerControlSystem) {
        playerControlSystem.activateShield(shieldDuration, shieldLevel);
        this.showShieldGetFeedback(shieldLevel, result.accuracy);
      }
    }

    // Emit completion event for HUD/star tracking
    this.onGateCompleteCallbacks.forEach(cb => cb(gateIndex, result));

    // Resume platform scene
    this.scene.physics.resume();
    (this.scene as any).playerControlSystem?.setPaused(false);
    (this.scene as any).enemySystem?.resumeAll();

    console.log(`[WordGate] Gate ${gateIndex + 1} opened!`);
  }

  /**
   * Calculate shield duration based on accuracy
   */
  private calculateShieldDuration(accuracy: number): number {
    if (accuracy >= 1.0) {
      return 6; // 100% → 6s gold shield
    } else if (accuracy >= 0.8) {
      return 5; // 80-99% → 5s green shield
    } else if (accuracy >= 0.6) {
      return 3; // 60-79% → 3s blue shield
    }
    return 0; // Below 60% = no shield
  }

  /**
   * Get shield level based on duration
   */
  private getShieldLevel(duration: number): 'blue' | 'green' | 'gold' {
    if (duration >= 6) return 'gold';
    if (duration >= 5) return 'green';
    return 'blue';
  }

  /**
   * Show "Shield Get!" feedback text and effects
   */
  private showShieldGetFeedback(shieldLevel: 'blue' | 'green' | 'gold', accuracy: number): void {
    const { width, height } = this.scene.scale.gameSize;
    const centerX = width / 2;
    const centerY = height / 2;

    // Color and text mapping
    const feedbackTexts = ['Shield Get!', '护盾获得！'];
    const colorMap = { blue: '#4A90E2', green: '#4CAF50', gold: '#FFD700' };
    const color = colorMap[shieldLevel];

    // Show main feedback text
    const feedbackText = this.scene.add.text(centerX, centerY - 50, feedbackTexts[Math.floor(Math.random() * 2)], {
      fontSize: '48px',
      color: color,
      fontFamily: 'Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    // Bounce in animation
    feedbackText.setScale(0);
    this.scene.tweens.add({
      targets: feedbackText,
      scale: 1.2,
      duration: 300,
      ease: 'Back.out',
      onComplete: () => {
        this.scene.tweens.add({
          targets: feedbackText,
          scale: 1,
          duration: 100,
        });
      }
    });

    // Perfect feedback for 100%
    if (accuracy >= 1.0) {
      const perfectText = this.scene.add.text(centerX, centerY + 20, '✨ Perfect! ✨', {
        fontSize: '36px',
        color: '#FFD700',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0);

      perfectText.setScale(0);
      this.scene.tweens.add({
        targets: perfectText,
        scale: 1,
        duration: 400,
        delay: 200,
        ease: 'Back.out',
      });

      this.scene.time.delayedCall(1500, () => {
        perfectText.destroy();
      });
    }

    // Fade out and destroy
    this.scene.time.delayedCall(1500, () => {
      this.scene.tweens.add({
        targets: feedbackText,
        alpha: 0,
        y: centerY - 100,
        duration: 300,
        onComplete: () => {
          feedbackText.destroy();
        }
      });
    });
  }

  /**
   * Register callback for gate completion (used for star tracking)
   */
  onGateComplete(callback: (gateIndex: number, result: Round1Result) => void): void {
    this.onGateCompleteCallbacks.push(callback);
  }

  /**
   * Check if all gates are completed
   */
  areAllGatesCompleted(): boolean {
    return this.completedGates.every(completed => completed);
  }

  /**
   * Get total stars earned across all completed gates
   */
  getTotalStars(): number {
    // This will be tracked separately when callbacks fire
    return 0; // Placeholder - actual implementation below
  }
}
