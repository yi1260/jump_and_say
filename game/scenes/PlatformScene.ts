import Phaser from 'phaser';
import { PlatformPlayerControlSystem } from '../systems/PlatformPlayerControlSystem';
import { PlatformEnemySystem } from '../systems/PlatformEnemySystem';
import { PlatformWordGateSystem } from '../systems/PlatformWordGateSystem';
import { level1Config, generateLevelElements } from '../data/levelConfig';

/**
 * 横版闯关场景 - 第一关：草原入门
 *
 * 玩家需要：
 * 1. 控制角色左右移动、跳跃躲避史莱姆
 * 2. 收集金币获得积分
 * 3. 遇到"单词方块"时必须正确发音才能通过
 * 4. 到达终点旗帜完成关卡
 */
export class PlatformScene extends Phaser.Scene {
  // 玩家相关
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private playerControlSystem!: PlatformPlayerControlSystem;

  // 敌人系统
  private enemies!: Phaser.Physics.Arcade.Group;
  private enemySystem!: PlatformEnemySystem;

  // 地形相关
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private groundY!: number;

  // 游戏状态
  private score: number = 0;
  private isGameOver: boolean = false;
  private levelWidth: number = 5000; // 关卡总宽度（横向卷轴）
  private currentWord: string = '';

  // Word gate system
  private wordGateSystem!: PlatformWordGateSystem;

  // Star tracking
  private totalStars: number = 0;
  private starsText!: Phaser.GameObjects.Text;

  // Shield HUD
  private shieldIconText!: Phaser.GameObjects.Text;
  private shieldTimerText!: Phaser.GameObjects.Text;
  private shieldHudContainer!: Phaser.GameObjects.Container;

  // Pause state
  private paused: boolean = false;

  // 音效
  private jumpSound!: Phaser.Sound.BaseSound;
  private coinSound!: Phaser.Sound.BaseSound;

  // 物理常量
  private readonly GRAVITY_Y = 1800;
  private readonly PLAYER_SPEED = 300;
  private readonly JUMP_VELOCITY = -1100; // 重力1800下，跳跃高度 = 1100²/(2×1800) ≈ 336px，足以到达最高平台(≈220px)

  constructor() {
    super({ key: 'PlatformScene' });
  }

  init() {
    this.score = 0;
    this.isGameOver = false;
    this.currentWord = '';
    this.totalStars = 0;
    this.paused = false;
    this.levelWidth = level1Config.width;
  }

  preload() {
    // 加载 Kenney 素材
    this.load.svg('terrain_grass_block', '/assets/kenney/Vector/backup/Tiles/terrain_grass_block.svg');
    this.load.svg('terrain_grass_block_top', '/assets/kenney/Vector/backup/Tiles/terrain_grass_block_top.svg');

    // 角色素材
    const charSize = { width: 64, height: 64 };
    this.load.svg('character_beige_idle', '/assets/kenney/Vector/backup/Characters/character_beige_idle.svg', charSize);
    this.load.svg('character_beige_jump', '/assets/kenney/Vector/backup/Characters/character_beige_jump.svg', charSize);
    this.load.svg('character_beige_walk_a', '/assets/kenney/Vector/backup/Characters/character_beige_walk_a.svg', charSize);
    this.load.svg('character_beige_walk_b', '/assets/kenney/Vector/backup/Characters/character_beige_walk_b.svg', charSize);

    // 敌人素材
    this.load.svg('slime_normal_rest', '/assets/kenney/Vector/backup/Enemies/slime_normal_rest.svg');
    this.load.svg('slime_normal_walk_a', '/assets/kenney/Vector/backup/Enemies/slime_normal_walk_a.svg');
    this.load.svg('slime_normal_walk_b', '/assets/kenney/Vector/backup/Enemies/slime_normal_walk_b.svg');

    // 门和方块素材
    this.load.svg('door_closed', '/assets/kenney/Vector/backup/Tiles/door_closed.svg');
    this.load.svg('door_closed_top', '/assets/kenney/Vector/backup/Tiles/door_closed_top.svg');
    this.load.svg('door_open', '/assets/kenney/Vector/backup/Tiles/door_open.svg');
    this.load.svg('door_open_top', '/assets/kenney/Vector/backup/Tiles/door_open_top.svg');
    this.load.svg('block_yellow', '/assets/kenney/Vector/backup/Tiles/block_yellow.svg');
    this.load.svg('key_yellow', '/assets/kenney/Vector/backup/Tiles/key_yellow.svg');
    this.load.svg('terrain_grass_horizontal_overhang_left', '/assets/kenney/Vector/backup/Tiles/terrain_grass_horizontal_overhang_left.svg');
    this.load.svg('terrain_grass_horizontal_overhang_right', '/assets/kenney/Vector/backup/Tiles/terrain_grass_horizontal_overhang_right.svg');

    // 音效（使用可选加载，失败不影响游戏）
    this.load.audio('sfx_jump', '/assets/kenney/Sounds/sfx_jump-high.mp3');
    this.load.audio('sfx_coin', '/assets/kenney/Sounds/sfx_coin.mp3');

    // 创建占位符纹理（用于 Round1 中的问题图片）
    this.createPlaceholderTexture();
  }

  private createPlaceholderTexture() {
    if (this.textures.exists('placeholder_image')) return;

    // 创建一个简单的彩色方框作为占位符
    const graphics = this.add.graphics();
    graphics.fillStyle(0x4CAF50, 1);
    graphics.fillRect(0, 0, 200, 200);
    graphics.lineStyle(4, 0xffffff, 1);
    graphics.strokeRect(0, 0, 200, 200);

    // 添加问号
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(100, 80, 20);
    graphics.fillRect(85, 100, 30, 60);

    // 生成纹理
    graphics.generateTexture('placeholder_image', 200, 200);
    graphics.destroy();
  }

  create() {
    const { width, height } = this.scale.gameSize;

    // 关键修复：地面位置计算
    // 地面方块高度是 64px，地面中心应该在底部上方 32px (blockSize/2)
    const blockSize = 64;
    this.groundY = height - blockSize / 2;

    // 设置世界边界
    this.physics.world.setBounds(0, 0, this.levelWidth, height);

    // 创建地形
    this.createPlatforms();

    // 创建玩家
    this.createPlayer();

    // 初始化控制系统（玩家控制先初始化）
    this.playerControlSystem = new PlatformPlayerControlSystem(this, this.player);

    // 初始化单词门系统
    this.wordGateSystem = new PlatformWordGateSystem(this);

    // 随机生成关卡元素（障碍物、敌人、门位置）
    const levelElements = this.generateLevelElements();

    // 创建敌人
    this.createEnemies(levelElements.enemies);

    // 敌人系统在敌人创建后初始化
    this.enemySystem = new PlatformEnemySystem(this, this.enemies);

    // 创建单词门
    this.wordGateSystem.createGates(levelElements.gatePositions);

    // 监听门完成事件
    this.wordGateSystem.onGateComplete((gateIndex, result) => {
      this.totalStars += result.starCount;
      this.updateStarsHUD();
      console.log(`[PlatformScene] Gate ${gateIndex + 1} completed! Total stars: ${this.totalStars}`);
    });

    // 设置相机跟随
    this.cameras.main.setBounds(0, 0, this.levelWidth, height);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // 碰撞检测
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.overlap(
      this.player,
      this.enemies,
      this.handlePlayerEnemyCollision,
      undefined,
      this
    );

    // 音效初始化
    try {
      this.jumpSound = this.sound.add('sfx_jump', { volume: 0.3 });
      this.coinSound = this.sound.add('sfx_coin', { volume: 0.4 });
    } catch (e) {
      console.warn('[PlatformScene] Audio initialization failed');
      const noop = { play: () => {} } as any;
      this.jumpSound = this.jumpSound || noop;
      this.coinSound = this.coinSound || noop;
    }

    // 键盘控制
    this.cursors = this.input.keyboard!.createCursorKeys();

    // 显示分数和星星 HUD
    this.add.text(16, 16, '分数: 0', { fontSize: '28px', color: '#fff' }).setScrollFactor(0);
    this.starsText = this.add.text(width - 20, 16, '⭐ 0', { fontSize: '28px', color: '#fff', fontFamily: 'Arial' })
      .setOrigin(1, 0)
      .setScrollFactor(0);

    // 护盾 HUD (右上角，星星下方)
    this.shieldHudContainer = this.add.container(width - 20, 50).setScrollFactor(0);
    this.shieldIconText = this.add.text(0, 0, '', { fontSize: '24px' }).setOrigin(1, 0.5);
    this.shieldTimerText = this.add.text(-30, 0, '', { fontSize: '20px', color: '#fff', fontFamily: 'Arial' }).setOrigin(0, 0.5);
    this.shieldHudContainer.add([this.shieldIconText, this.shieldTimerText]);
    this.shieldHudContainer.setVisible(false);

    // 监听护盾状态更新
    this.playerControlSystem.onShieldUpdate((shieldState) => {
      if (shieldState) {
        this.shieldHudContainer.setVisible(true);
        const iconMap = { blue: '🛡️', green: '🛡️', gold: '🛡️' };
        const colorMap = { blue: '#4A90E2', green: '#4CAF50', gold: '#FFD700' };

        this.shieldIconText.setText(iconMap[shieldState.level]);
        this.shieldIconText.setColor(colorMap[shieldState.level]);
        this.shieldTimerText.setText(`${Math.ceil(shieldState.remainingTime)}s`);

        // Flash effect when < 2 seconds remaining
        if (shieldState.remainingTime < 2) {
          this.tweens.add({
            targets: this.shieldHudContainer,
            alpha: 0.3,
            duration: 200,
            yoyo: true,
            repeat: 1,
          });
        } else {
          this.shieldHudContainer.setAlpha(1);
        }
      } else {
        this.shieldHudContainer.setVisible(false);
      }
    });

    // 调试日志
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    const groundTop = this.groundY - blockSize / 2;
    const jumpHeight = (this.JUMP_VELOCITY ** 2) / (2 * this.GRAVITY_Y);
    console.log('[PlatformScene] 屏幕高度:', height, '| 地面顶部 Y:', groundTop);
    console.log('[PlatformScene] 玩家中心 Y:', this.player.y, '| body底部:', playerBody.bottom);
    console.log('[PlatformScene] 跳跃速度:', this.JUMP_VELOCITY, '| 理论跳跃高度:', jumpHeight.toFixed(0), 'px');
  }

  private createPlatforms() {
    this.platforms = this.physics.add.staticGroup();

    const { width, height } = this.scale.gameSize;
    const blockSize = 64;

    // 创建地面 - 使用 staticImage 创建静态物理体
    for (let x = 0; x < this.levelWidth; x += blockSize) {
      const block = this.physics.add.staticImage(
        x + blockSize / 2,
        this.groundY,
        'terrain_grass_block_top'
      );
      block.setDisplaySize(blockSize, blockSize);
      block.refreshBody(); // 必须！让物理体和 displaySize 对齐
      this.platforms.add(block);
    }

    // 创建浮动平台
    // 平台 Y 表示平台方块中心，平台顶面 = pos.y - blockSize/2
    // 跳跃高度约 336px，平台顶面相对地面顶部的高度需 < 336px
    const floatingPlatforms = [
      { x: 400,  y: this.groundY - 130, w: 3 }, // 顶面高出地面 98px
      { x: 730,  y: this.groundY - 210, w: 3 }, // 顶面高出地面 178px
      { x: 1060, y: this.groundY - 160, w: 3 }, // 顶面高出地面 128px
      { x: 1420, y: this.groundY - 220, w: 2 }, // 顶面高出地面 188px（较窄，考验精准度）
      { x: 1750, y: this.groundY - 130, w: 3 }, // 顶面高出地面 98px
    ];

    floatingPlatforms.forEach(pos => {
      const platform = this.physics.add.staticImage(
        pos.x,
        pos.y,
        'terrain_grass_block_top'
      );
      platform.setDisplaySize(blockSize * pos.w, blockSize);
      platform.refreshBody(); // 必须！让物理体和 displaySize 对齐
      this.platforms.add(platform);
    });
  }

  private createPlayer() {
    // SVG 已在 preload 中以 64×64 加载，frame = display = 64，scaleY = 1
    const playerSize = 64;
    const blockSize = 64;

    // 地面顶部（物理碰撞面）
    const groundTop = this.groundY - blockSize / 2;

    // 碰撞体：宽 55%（避免卡墙），高 80%（留头顶余量）
    const bodyWidth  = Math.round(playerSize * 0.55); // 35px
    const bodyHeight = Math.round(playerSize * 0.80); // 51px

    // ===== offset 计算（frame = display = 64, scale = 1，公式简单） =====
    // Phaser 公式（scale=1 时）：
    //   body.y = sprite.y - frameHeight/2 + offsetY
    //   body.bottom = body.y + bodyHeight
    // 目标：body.bottom = sprite.y + playerSize/2（视觉底部）
    //   offsetY + bodyHeight = playerSize  →  offsetY = playerSize - bodyHeight
    const bodyOffsetX = (playerSize - bodyWidth) / 2;
    const bodyOffsetY = playerSize - bodyHeight; // 碰撞体底部对齐 sprite 底部

    // 玩家初始 Y：sprite 底部对齐地面顶部
    const playerY = groundTop - playerSize / 2;

    console.log('[PlatformScene-Player] groundTop:', groundTop, '| playerY:', playerY);
    console.log('[PlatformScene-Player] bodySize:', bodyWidth, 'x', bodyHeight, '| offset:', bodyOffsetX, bodyOffsetY);
    console.log('[PlatformScene-Player] 预期 body.bottom =', playerY - playerSize / 2 + bodyOffsetY + bodyHeight, '(应等于 groundTop:', groundTop, ')');

    // 创建玩家 — 不需要 setDisplaySize（frame 已经是 64×64）
    this.player = this.physics.add.sprite(100, playerY, 'character_beige_idle');
    this.player.setCollideWorldBounds(true);
    this.player.setGravityY(this.GRAVITY_Y);
    this.player.setBounce(0);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(bodyWidth, bodyHeight, false);
    body.setOffset(bodyOffsetX, bodyOffsetY);

    // 创建行走动画（防止场景重启时重复创建）
    if (!this.anims.exists('player_walk')) {
      this.anims.create({
        key: 'player_walk',
        frames: [
          { key: 'character_beige_walk_a' },
          { key: 'character_beige_walk_b' }
        ],
        frameRate: 8,
        repeat: -1
      });
    }
  }

  private createEnemies(enemyDefs: import('../data/levelConfig').EnemyDef[]) {
    this.enemies = this.physics.add.group();

    const blockSize = 64;
    const enemySize = 48;
    // 地面方块的顶部边缘
    const groundTop = this.groundY - blockSize / 2;
    // 敌人精灵中心 Y：地面顶部 - 精灵高度的一半
    const enemyY = groundTop - enemySize / 2;

    console.log('[PlatformScene-Enemy] Creating', enemyDefs.length, 'enemies');
    console.log('[PlatformScene-Enemy] groundY:', this.groundY, '| groundTop:', groundTop, '| enemyY:', enemyY);

    enemyDefs.forEach(def => {
      const slime = this.physics.add.sprite(def.x, enemyY, 'slime_normal_rest');
      slime.setDisplaySize(enemySize, enemySize);
      slime.setGravityY(this.GRAVITY_Y);
      slime.setCollideWorldBounds(true);
      slime.setBounce(0);

      // 添加巡逻数据
      slime.setData('patrolStart', def.x - def.patrolRange);
      slime.setData('patrolEnd', def.x + def.patrolRange);
      slime.setData('direction', 1);

      this.enemies.add(slime);

      // 史莱姆行走动画
      if (!this.anims.exists('slime_walk')) {
        this.anims.create({
          key: 'slime_walk',
          frames: [
            { key: 'slime_normal_walk_a' },
            { key: 'slime_normal_walk_b' }
          ],
          frameRate: 6,
          repeat: -1
        });
      }
      slime.play('slime_walk');
    });
  }

  private handlePlayerEnemyCollision(
    playerObj: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    enemyObj: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const player = playerObj as Phaser.Physics.Arcade.Sprite;
    const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;

    const playerBody = player.body as Phaser.Physics.Arcade.Body;
    const enemyBody = enemy.body as Phaser.Physics.Arcade.Body;

    // Check if shield is active
    if (this.playerControlSystem.isShieldActive()) {
      // Shield active - destroy enemy without dying
      enemy.destroy();
      playerBody.setVelocityY(this.JUMP_VELOCITY * 0.3); // Small bounce
      this.score += 200; // Bonus points for shield kill
      this.coinSound.play();
      console.log('[PlatformScene] Shield destroyed enemy! Score:', this.score);

      // Shield particle effect on collision
      this.createShieldHitEffect(enemy.x, enemy.y);
      return;
    }

    // 修复：使用碰撞体的实际高度而非 displayHeight
    // playerBody.y 是碰撞体顶部的 Y 坐标
    const playerBottom = playerBody.y + playerBody.height;
    const enemyTop = enemyBody.y;

    const isFalling = playerBody.velocity.y > 0;
    // 增加判定容差，让踩敌人更容易
    const isAbove = playerBottom < enemyTop + 15;

    if (isFalling && isAbove) {
      // 踩到敌人 - 消灭敌人并弹跳
      enemy.destroy();
      playerBody.setVelocityY(this.JUMP_VELOCITY * 0.5);
      this.score += 100;
      this.coinSound.play();
      console.log('[PlatformScene] Enemy defeated! Score:', this.score);
    } else {
      // 碰到敌人侧面 - 游戏结束
      console.log('[PlatformScene] Player hit by enemy!');
      this.gameOver();
    }
  }

  private createShieldHitEffect(x: number, y: number) {
    // Create a burst of particles at the enemy position
    const particles = this.add.particles(x, y, 'placeholder_image', {
      speed: { min: 50, max: 150 },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 300,
      quantity: 8,
      blendMode: 'ADD',
    });

    // Auto-destroy emitter after particles finish
    this.time.delayedCall(300, () => {
      particles.destroy();
    });
  }

  private gameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.player.setTint(0xff0000);
    this.physics.pause();
    this.paused = true;

    // 显示游戏结束文本
    const { width, height } = this.scale.gameSize;
    const gameOverText = this.add.text(width / 2, height / 2, '游戏结束', {
      fontSize: '64px',
      color: '#ff0000',
      fontFamily: 'Arial'
    });
    gameOverText.setOrigin(0.5);
    gameOverText.setScrollFactor(0);

    // 重新开始提示
    const restartText = this.add.text(width / 2, height / 2 + 80, '点击屏幕重新开始', {
      fontSize: '32px',
      color: '#ffffff'
    });
    restartText.setOrigin(0.5);
    restartText.setScrollFactor(0);

    // 点击重新开始
    this.input.once('pointerdown', () => {
      this.scene.restart();
    });
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  private createWordGates() {
    // Gate positions are generated in generateLevelElements
    // This method is called from create() after level generation
  }

  private generateLevelElements() {
    const elements = generateLevelElements(level1Config);

    console.log('[PlatformScene] Level elements generated:');
    console.log('  Gate positions:', elements.gatePositions);
    console.log('  Obstacles:', elements.obstacles.length);
    console.log('  Enemies:', elements.enemies.length);

    return elements;
  }

  private updateStarsHUD() {
    this.starsText.setText(`⭐ ${this.totalStars}`);
  }

  update(time: number, delta: number) {
    if (this.isGameOver || this.paused) return;

    this.playerControlSystem.update();
    this.playerControlSystem.updateShield(delta);
    this.enemySystem.update(delta);
  }
}
