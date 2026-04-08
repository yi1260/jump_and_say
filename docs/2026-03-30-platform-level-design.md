# 横版闯关 - 发音闯关模式设计

> 创建日期: 2026-04-05
> 最后更新: 2026-04-05
> 状态: 草稿，待修订（Spec Review 第 1 轮）
> 核心理念: **英语学习是核心驱动力，游戏是载体**

---

## 一、核心设计理念

### 1.1 问题反思

之前的设计太复杂：
- ❌ 道具太多（金币、钥匙、弹簧、宝箱...），没有实际意义
- ❌ 敌人系统过于复杂（多种行为、多种类型）
- ❌ 关卡主题脱离现有素材
- ❌ 学习内容和游戏玩法分离

### 1.2 新设计原则

| 原则 | 说明 |
|------|------|
| 极简 | 只保留核心元素：地形、角色、障碍门、引导方块、史莱姆 |
| 学习驱动 | 不发音就无法前进，发音是通关的唯一方式 |
| 素材复用 | 只使用 `public/assets/kenney/Vector/backup/` 中已有的素材 |
| 流程清晰 | 闯关 → 遇障碍 → 撞击方块 → 听音跟读 → 开门 → 继续 |

---

## 二、核心玩法流程

### 2.1 整体流程

```
闯关开始
    ↓
跑跳前进（体感控制：左右移动 + 跳跃）
    ↓
遇到不可跳跃通过的障碍门（door_closed）
    ↓
门旁出现引导方块（block_yellow，闪烁提示）
    ↓
玩家跳跃撞击引导方块
    ↓
游戏暂停 + 弹出单词大卡片
    ├── 显示图片
    ├── 播放音频（如 "cat"）
    └── 等待玩家跟读
    ↓
发音评分
    ├── HIGH / MEDIUM → 成功！卡片消失 → 门打开 → 游戏恢复 → 继续闯关
    └── LOW → 提示"再试一次" → 重新播放音频 → 重新发音
    ↓
继续前进 → 下一个障碍门
    ↓
到达终点旗帜 → 显示完成界面 → 返回菜单 / 下一关
```

### 2.2 游戏状态机

```
PLAYING（闯关中）
    ↓ 撞击引导方块
PRONUNCIATION（发音中）
    ├── 暂停物理引擎
    ├── 暂停玩家控制
    ├── 暂停敌人AI
    ├── 显示发音卡片
    └── 等待发音结果
    ↓ 发音完成
CELEBRATION（庆祝中，1秒）
    ├── 播放开门动画
    ├── 播放庆祝音效
    └── 恢复游戏
    ↓
PLAYING（继续闯关）
    ↓ 到达终点
LEVEL_COMPLETE（关卡完成）
    ├── 显示完成界面
    └── 返回菜单
```

### 2.3 姿势映射

| 姿势 | 游戏动作 | 用途 |
|------|---------|------|
| **左右移动** | 角色左右探索 | 在关卡中移动 |
| **跳跃** | 跳跃、撞击引导方块 | 触发学习流程 |
| **读音** | 跟读单词 | 核心学习机制 |

> 注：目前 motionController 只实现了左右移动和跳跃检测，暂不支持下蹲。

### 2.4 发音期间的暂停/恢复机制

**关键问题**：当玩家进入发音流程时，`motionController` 仍在运行。如果玩家身体晃动，`state.x` 会变化，导致角色在发音卡片弹出后仍在移动。

**解决方案**：

```typescript
// 进入发音流程时
async function startPronunciation(gate: WordGate) {
  // 1. 暂停物理引擎
  this.physics.pause();

  // 2. 暂停玩家控制系统
  this.playerControlSystem.setPaused(true);

  // 3. 暂停敌人AI
  this.enemySystem.pauseAll();

  // 4. 弹出单词卡片
  const result = await this.pronunciationPopup.show(gate.word);

  // 5. 恢复游戏
  this.physics.resume();
  this.playerControlSystem.setPaused(false);
  this.enemySystem.resumeAll();

  // 6. 处理结果
  if (result.success) {
    this.openGate(gate);
  }
}
```

---

## 三、关卡内元素

### 3.1 素材清单（只使用 vector 中已有的）

| 元素 | 素材文件 | 用途 |
|------|---------|------|
| **地面** | `terrain_grass_block_top.svg` | 第一关草原地面 |
| **浮动平台** | `terrain_grass_block.svg` | 空中平台 |
| **角色** | `character_beige_idle.svg`<br>`character_beige_jump.svg`<br>`character_beige_walk_a.svg`<br>`character_beige_walk_b.svg` | 玩家角色 |
| **敌人** | `slime_normal_rest.svg`<br>`slime_normal_walk_a.svg`<br>`slime_normal_walk_b.svg` | 可踩死的史莱姆 |
| **障碍门** | `door_closed.svg`<br>`door_closed_top.svg`<br>`door_open.svg`<br>`door_open_top.svg` | 发音正确后打开 |
| **引导方块** | `block_yellow.svg`<br>`block_green.svg` | 撞击触发学习 |
| **弹簧** | `spring.svg`<br>`spring_out.svg` | 弹跳道具（Phase 2） |
| **尖刺** | `spikes.svg`<br>`block_spikes.svg` | 不可通过的障碍 |
| **终点** | `flag_green_a.svg` | 关卡终点 |
| **背景** | `background_solid_grass.svg`<br>`background_solid_sky.svg` | 关卡背景 |

> ⚠️ **已知 Bug**：`PlatformScene.ts` 第 63-64 行使用了错误的 key `character_bege_walk_a/b`（少了 `i`），需要在实现时修正为 `character_beige_walk_a/b`。

### 3.2 金币处理

**暂时移除金币**。目前金币没有任何实际作用，移除后专注于核心学习体验。

---

## 四、障碍门 + 引导方块机制

### 4.1 数据结构

```typescript
interface WordGateConfig {
  // 学习内容
  word: string;         // 如 "cat"
  audioUrl: string;     // 音频资源路径（R2 CDN 或本地）
  imageUrl: string;     // 图片资源路径（R2 CDN 或本地）

  // 门的位置（相对于地面动态计算）
  doorOffsetX: number;  // 门距离起点的 X 偏移

  // 引导方块位置（相对于门）
  guideBlockOffsetX: number;  // 通常在门左侧 80-100px
}

interface WordGate {
  door: Phaser.Physics.Arcade.Sprite;
  guideBlock: Phaser.Physics.Arcade.Sprite;
  guideBlockTween: Phaser.Tweens.Tween;  // 保存 tween 引用
  word: string;
  audioUrl: string;
  imageUrl: string;
  isDoorOpen: boolean;
  guideBlockVisible: boolean;
  triggerCooldown: number;  // 触发冷却时间（防止重复触发）
}
```

### 4.2 交互流程

```
1. 玩家靠近障碍门（距离 < 150px）
   └── 引导方块出现（block_yellow，闪烁动画）

2. 玩家跳跃撞击引导方块
   └── 检查冷却时间（防止连续触发）
   └── 引导方块消失 + 停止闪烁动画
   └── 暂停游戏（物理、玩家控制、敌人AI）
   └── 弹出单词大卡片（覆盖屏幕中央）

3. 单词卡片流程（轻量级发音弹窗）
   ├── 播放音频 "cat"
   ├── 显示对应图片（猫）
   ├── 等待玩家跟读
   ├── 语音评分（使用 speechScoring.recognizeOnce）
   └── 反馈结果

4. 发音成功（HIGH / MEDIUM）
   └── 卡片消失
   └── 门打开（door_closed → door_open）
   └── 门的物理体移除（玩家可以穿过）
   └── 播放庆祝动画（1秒）
   └── 恢复游戏

5. 发音失败（LOW）
   └── 提示"再试一次"
   └── 重新播放音频
   └── 回到步骤 3
   └── 不重新显示引导方块（保持在卡片界面直到成功）
```

### 4.3 发音弹窗设计（方案 B：轻量级独立弹窗）

**为什么不直接复用 Round1？**
- Round1 是 **盲盒三连卡片** 模式，从 `theme.questions` 中随机取 3 题
- Round1 的入口是 `setupThemeData(theme)` + `spawnBlindBoxRound()`，不接受单个单词参数
- Round1 的 UI 复杂，包含盲盒动画、进度条等

**方案 B：创建轻量级 `PlatformPronunciationPopup`**

```typescript
// game/systems/PlatformPronunciationPopup.ts

export class PlatformPronunciationPopup {
  private scene: Phaser.Scene;
  private overlay: Phaser.GameObjects.Rectangle;
  private card: Phaser.GameObjects.Container;
  private wordText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private isShowing: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // 显示发音弹窗
  async show(word: string, audioUrl: string, imageUrl: string): Promise<{ success: boolean }> {
    this.isShowing = true;

    // 创建半透明遮罩
    this.overlay = this.scene.add.rectangle(
      this.scene.cameras.main.scrollX + 640,
      360,
      1280, 720,
      0x000000, 0.7
    ).setDepth(100).setScrollFactor(0);

    // 创建卡片容器
    this.card = this.scene.add.container(
      this.scene.cameras.main.scrollX + 640,
      360
    ).setDepth(101).setScrollFactor(0);

    // 卡片背景
    const bg = this.scene.add.rectangle(0, 0, 500, 400, 0xffffff).setOrigin(0.5);
    this.card.add(bg);

    // 显示图片
    if (imageUrl) {
      const image = this.scene.add.image(0, -80, imageUrl).setOrigin(0.5).setDisplaySize(200, 200);
      this.card.add(image);
    }

    // 显示单词
    this.wordText = this.scene.add.text(0, 50, word, {
      fontSize: '48px',
      color: '#333',
      fontFamily: 'Arial'
    }).setOrigin(0.5);
    this.card.add(this.wordText);

    // 提示文字
    this.hintText = this.scene.add.text(0, 120, '请跟读这个单词', {
      fontSize: '24px',
      color: '#666',
      fontFamily: 'Arial'
    }).setOrigin(0.5);
    this.card.add(this.hintText);

    // 播放音频
    this.scene.sound.play('wordAudio', { url: audioUrl });

    // 等待发音结果
    const result = await this.waitForPronunciation(word);

    // 清理 UI
    this.cleanup();

    return result;
  }

  // 等待发音结果
  private async waitForPronunciation(targetWord: string): Promise<{ success: boolean }> {
    // 使用 speechScoring.recognizeOnce
    const { speechScoring } from '../../services/speechScoring';

    while (this.isShowing) {
      this.hintText.setText('请跟读...');

      const result = await speechScoring.recognizeOnce({
        lang: 'en-US',
        maxDurationMs: 5000,
      });

      if (result.reason !== 'ok') {
        this.hintText.setText('识别失败，请重试');
        await this.sleep(1500);
        continue;
      }

      // 简单的单词匹配（不依赖复杂评分）
      const isMatch = result.transcript.toLowerCase().includes(targetWord.toLowerCase());

      if (isMatch) {
        this.hintText.setText('✅ 太棒了！');
        await this.sleep(1000);
        return { success: true };
      } else {
        this.hintText.setText(`❌ 你说的是 "${result.transcript}"，再试一次`);
        await this.sleep(2000);
        // 重新播放音频
        this.scene.sound.play('wordAudio');
      }
    }

    return { success: false };
  }

  // 清理 UI
  private cleanup() {
    this.isShowing = false;
    this.overlay?.destroy();
    this.card?.destroy();
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4.4 引导方块闪烁动画管理

```typescript
// 保存 tween 引用，确保可以正确暂停/恢复
const tween = this.scene.tweens.add({
  targets: guideBlock,
  alpha: 0.3,
  duration: 500,
  yoyo: true,
  repeat: -1
});

// 保存到 gate 对象
gate.guideBlockTween = tween;

// 隐藏时停止动画
function hideGuideBlock(gate: WordGate) {
  gate.guideBlockTween.stop();
  gate.guideBlock.setVisible(false);
}

// 显示时恢复动画
function showGuideBlock(gate: WordGate) {
  gate.guideBlock.setVisible(true);
  gate.guideBlockTween.play();
}
```

### 4.5 触发冷却机制

**问题**：发音失败后如果重新显示引导方块，玩家可能仍然站在方块位置上，会立即再次触发 overlap。

**解决方案**：添加冷却时间

```typescript
// 在 WordGate 中添加
triggerCooldown: number = 0;

// 在 overlap 回调中
onGuideBlockHit(gateIndex: number) {
  const gate = this.gates[gateIndex];
  const now = this.scene.time.now;

  // 检查冷却时间（2秒）
  if (now - gate.triggerCooldown < 2000) return;

  gate.triggerCooldown = now;
  // ... 继续处理
}
```

---

## 五、第一关设计（草原入门）

### 5.1 关卡参数

| 属性 | 数值 |
|------|------|
| 主题 | Grass 草原 |
| 难度 | ⭐ |
| 长度 | 3200px（与现有 platform-test.html 一致） |
| 单词数 | 2 个（零基础不宜太多） |
| 敌人 | 2-3 个史莱姆（纯动作踩死） |

### 5.2 关卡布局

```
[起点] ── 跑跳段 ── [史莱姆1] ── [障碍门1: cat] ── 弹簧段 ── [障碍门2: dog] ── 终点旗帜
                      (踩死)        │                                     │
                                  撞击方块                             撞击方块
                                  发音"cat"过关                        发音"dog"过关
```

### 5.3 详细布局

| 位置 (px) | 元素 | 说明 |
|-----------|------|------|
| 0 | 起点 | 角色初始位置 |
| 200-300 | 地面段 | 熟悉移动 |
| 400 | 浮动平台 | 练习跳跃 |
| 500 | 史莱姆1 | 踩死（纯动作） |
| 700 | 弹簧 | 弹跳到高台（Phase 2） |
| 900 | 高台 | 弹簧到达（Phase 2） |
| 1100 | 障碍门1 (cat) | 第一个学习点 |
| 1300 | 史莱姆2 | 踩死 |
| 1600 | 浮动平台组 | 连续跳跃 |
| 1900 | 障碍门2 (dog) | 第二个学习点 |
| 2200 | 史莱姆3 | 踩死 |
| 2500 | 尖刺障碍 | 需要跳跃躲避（纯视觉阻挡，不扣血） |
| 2800 | 浮动平台 | 最后一段跳跃 |
| 3000 | 终点旗帜 | 关卡完成 |

### 5.4 单词配置

| 序号 | 单词 | 音频 | 图片 | 位置 |
|------|------|------|------|------|
| 1 | cat | R2 CDN: `RAZ/audio/cat.mp3` | R2 CDN: `RAZ/images/cat.webp` | 1100px |
| 2 | dog | R2 CDN: `RAZ/audio/dog.mp3` | R2 CDN: `RAZ/images/dog.webp` | 1900px |

> 注：音频和图片资源使用 R2 CDN 路径，具体路径需要确认。如果不存在，可以使用本地占位资源。

### 5.5 障碍门 Y 坐标计算

**不硬编码 Y 坐标**，而是基于地面动态计算：

```typescript
// 在 PlatformScene.create() 中
const blockSize = 64;
const groundTop = this.groundY - blockSize / 2;
const doorHeight = 64;
const doorY = groundTop - doorHeight / 2;  // 门底部对齐地面顶部

// 引导方块在门左侧 100px
const guideBlockX = doorX - 100;
const guideBlockY = doorY;
```

### 5.6 尖刺障碍行为

**对于 3-5 岁零基础用户**，尖刺只做视觉阻挡，不造成伤害：

- 玩家碰到尖刺 → 被弹回（velocity.x 反向）
- 不扣血、不游戏结束
- 提示"小心！跳过去！"

### 5.7 弹簧机制（Phase 2）

弹簧在 Phase 1 中只做装饰，实际弹跳逻辑在 Phase 2 实现：

- 玩家踩上弹簧 → 弹簧切换到 `spring_out.svg`
- 玩家获得向上的 velocity（`setVelocityY(-800)`）
- 弹簧在 0.5 秒后恢复 `spring.svg`

### 5.8 关卡完成流程

```
玩家触碰终点旗帜
    ↓
暂停游戏
    ↓
显示完成界面（3秒）
    ├── "🎉 关卡完成！"
    ├── "你学会了: cat, dog"
    └── "太棒了！"
    ↓
自动返回主菜单 / 点击继续
```

---

## 六、技术实现

### 6.1 文件结构

```
game/
├── scenes/
│   └── PlatformScene.ts              # 修改：添加障碍门、引导方块、学习流程
├── systems/
│   ├── PlatformPlayerControlSystem.ts # 修改：接入 motionController 体感控制 + 暂停/恢复
│   ├── PlatformEnemySystem.ts         # 保持：现有史莱姆巡逻AI + 暂停/恢复
│   ├── PlatformWordGateSystem.ts      # 新增：障碍门+引导方块系统
│   └── PlatformPronunciationPopup.ts  # 新增：轻量级发音弹窗
└── data/
    └── level1Config.ts                # 新增：第一关配置

services/
├── motionController.ts                # 复用：体感控制
└── speechScoring.ts                   # 复用：语音评分
```

### 6.2 核心代码逻辑

#### 障碍门系统

```typescript
// game/systems/PlatformWordGateSystem.ts

export class PlatformWordGateSystem {
  private scene: Phaser.Scene;
  private player: Phaser.Physics.Arcade.Sprite;
  private gates: WordGate[] = [];
  private pronunciationPopup: PlatformPronunciationPopup;
  private playerControlSystem: PlatformPlayerControlSystem;
  private enemySystem: PlatformEnemySystem;

  constructor(
    scene: Phaser.Scene,
    player: Phaser.Physics.Arcade.Sprite,
    pronunciationPopup: PlatformPronunciationPopup,
    playerControlSystem: PlatformPlayerControlSystem,
    enemySystem: PlatformEnemySystem
  ) {
    this.scene = scene;
    this.player = player;
    this.pronunciationPopup = pronunciationPopup;
    this.playerControlSystem = playerControlSystem;
    this.enemySystem = enemySystem;
  }

  // 创建障碍门
  createGate(config: WordGateConfig, groundY: number): void {
    const blockSize = 64;
    const groundTop = groundY - blockSize / 2;
    const doorHeight = 64;
    const doorY = groundTop - doorHeight / 2;

    const door = this.scene.physics.add.staticSprite(
      config.doorOffsetX, doorY, 'door_closed'
    );
    door.setDisplaySize(64, 64);
    door.refreshBody();

    const guideBlockX = config.doorOffsetX + (config.guideBlockOffsetX || -100);
    const guideBlock = this.scene.physics.add.staticSprite(
      guideBlockX, doorY, 'block_yellow'
    );
    guideBlock.setDisplaySize(48, 48);
    guideBlock.refreshBody();

    // 闪烁动画（保存引用）
    const tween = this.scene.tweens.add({
      targets: guideBlock,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1
    });

    const gate: WordGate = {
      door,
      guideBlock,
      guideBlockTween: tween,
      word: config.word,
      audioUrl: config.audioUrl,
      imageUrl: config.imageUrl,
      isDoorOpen: false,
      guideBlockVisible: true,
      triggerCooldown: 0,
    };

    this.gates.push(gate);

    // 碰撞检测：玩家撞击引导方块
    this.scene.physics.add.overlap(
      this.player,
      guideBlock,
      () => this.onGuideBlockHit(gate),
      undefined,
      this
    );
  }

  // 引导方块被撞击
  private async onGuideBlockHit(gate: WordGate): Promise<void> {
    if (!gate.guideBlockVisible || gate.isDoorOpen) return;

    // 检查冷却时间
    const now = this.scene.time.now;
    if (now - gate.triggerCooldown < 2000) return;
    gate.triggerCooldown = now;

    // 隐藏引导方块
    gate.guideBlockTween.stop();
    gate.guideBlockVisible = false;
    gate.guideBlock.setVisible(false);

    // 暂停游戏
    this.scene.physics.pause();
    this.playerControlSystem.setPaused(true);
    this.enemySystem.pauseAll();

    // 弹出单词卡片
    const result = await this.pronunciationPopup.show(
      gate.word, gate.audioUrl, gate.imageUrl
    );

    // 恢复游戏
    this.scene.physics.resume();
    this.playerControlSystem.setPaused(false);
    this.enemySystem.resumeAll();

    // 处理结果
    if (result.success) {
      this.openGate(gate);
    } else {
      // 发音失败 → 重新显示引导方块
      gate.guideBlockVisible = true;
      gate.guideBlock.setVisible(true);
      gate.guideBlockTween.play();
    }
  }

  // 打开门
  private openGate(gate: WordGate): void {
    gate.isDoorOpen = true;
    gate.door.setTexture('door_open');
    gate.door.refreshBody();

    // 移除门的物理体（让玩家可以穿过）
    gate.door.disableBody(true, false);
  }
}
```

#### 接入体感控制

```typescript
// game/systems/PlatformPlayerControlSystem.ts 改造

import { motionController } from '../../services/motionController';

export class PlatformPlayerControlSystem {
  private scene: Phaser.Scene;
  private player: Phaser.Physics.Arcade.Sprite;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private isPaused: boolean = false;

  private readonly PLAYER_SPEED = 300;
  private readonly JUMP_VELOCITY = -1100;

  constructor(scene: Phaser.Scene, player: Phaser.Physics.Arcade.Sprite) {
    this.scene = scene;
    this.player = player;
    this.cursors = scene.input.keyboard!.createCursorKeys();
  }

  // 暂停/恢复
  setPaused(paused: boolean) {
    this.isPaused = paused;
  }

  public update(): void {
    if (!this.player || !this.player.body || this.isPaused) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const isOnGround = body.touching.down || body.blocked.down;

    // 优先使用体感控制
    const motionState = motionController.state;

    // 左右移动
    if (motionState.x === -1) {
      body.setVelocityX(-this.PLAYER_SPEED);
      this.player.setFlipX(true);
      if (isOnGround) this.player.anims.play('player_walk', true);
    } else if (motionState.x === 1) {
      body.setVelocityX(this.PLAYER_SPEED);
      this.player.setFlipX(false);
      if (isOnGround) this.player.anims.play('player_walk', true);
    } else if (this.cursors.left.isDown) {
      // 键盘控制（开发调试用）
      body.setVelocityX(-this.PLAYER_SPEED);
      this.player.setFlipX(true);
      if (isOnGround) this.player.anims.play('player_walk', true);
    } else if (this.cursors.right.isDown) {
      body.setVelocityX(this.PLAYER_SPEED);
      this.player.setFlipX(false);
      if (isOnGround) this.player.anims.play('player_walk', true);
    } else {
      body.setVelocityX(0);
      if (isOnGround) {
        this.player.anims.stop();
        this.player.setTexture('character_beige_idle');
      }
    }

    // 跳跃
    if ((motionState.isJumping || this.cursors.up.isDown || this.cursors.space?.isDown) && isOnGround) {
      body.setVelocityY(this.JUMP_VELOCITY);
      this.player.setTexture('character_beige_jump');
      this.player.anims.stop();
      try { (this.scene as any).jumpSound?.play(); } catch {}
    }

    // 空中状态
    if (!isOnGround && body.velocity.y > 0) {
      this.player.setTexture('character_beige_jump');
    }
  }
}
```

### 6.3 关卡配置

```typescript
// game/data/level1Config.ts

export const level1Config = {
  theme: 'grass',
  width: 3200,
  background: 'background_solid_grass',

  // 障碍门（学习点）
  gates: [
    {
      doorOffsetX: 1100,
      guideBlockOffsetX: -100,
      word: 'cat',
      audioUrl: 'RAZ/audio/cat.mp3',      // R2 CDN 路径
      imageUrl: 'RAZ/images/cat.webp',     // R2 CDN 路径
    },
    {
      doorOffsetX: 1900,
      guideBlockOffsetX: -100,
      word: 'dog',
      audioUrl: 'RAZ/audio/dog.mp3',
      imageUrl: 'RAZ/images/dog.webp',
    },
  ],

  // 敌人（纯动作踩死）
  enemies: [
    { x: 500, type: 'slime' },
    { x: 1300, type: 'slime' },
    { x: 2200, type: 'slime' },
  ],

  // 弹簧（Phase 2）
  springs: [
    { x: 700 },
  ],

  // 尖刺障碍
  spikes: [
    { x: 2500 },
  ],

  // 浮动平台
  platforms: [
    { x: 400, w: 3, heightOffset: 130 },
    { x: 900, w: 2, heightOffset: 210 },
    { x: 1600, w: 3, heightOffset: 160 },
    { x: 2800, w: 2, heightOffset: 220 },
  ],
};
```

---

## 七、与现有系统集成

### 7.1 不依赖 Round1 的盲盒流程

采用 **方案 B：轻量级独立弹窗**，原因：
- Round1 是盲盒三连卡片模式，不适合单单词场景
- 弹窗只需要"播放音频 → 录音 → 评分 → 反馈"，逻辑简单
- 使用 `speechScoring.recognizeOnce` 进行语音识别
- 单词匹配采用简单的 `includes` 判断，降低门槛

### 7.2 复用 motionController

现有的 `motionController` 已经实现了左右移动和跳跃检测，直接接入即可。

### 7.3 复用 Kenney 素材

所有素材都来自 `public/assets/kenney/Vector/backup/`，无需新增素材。

### 7.4 屏幕适配

- 关卡宽度固定 3200px，相机跟随玩家
- UI 元素（弹窗、提示）使用 `setScrollFactor(0)` 固定在屏幕上
- 弹窗位置基于 `cameras.main.scrollX + 640` 计算，确保始终居中

---

## 八、实现优先级

### Phase 1: 核心机制（本次实现）

1. **障碍门系统**
   - 门（closed/open）切换
   - 引导方块闪烁提示
   - 撞击触发学习流程
   - 暂停/恢复机制

2. **轻量级发音弹窗**
   - 显示图片 + 单词
   - 播放音频
   - 语音识别 + 单词匹配
   - 成功/失败反馈

3. **接入体感控制**
   - motionController 左右移动
   - motionController 跳跃
   - 保留键盘控制（开发调试）
   - 暂停/恢复支持

4. **第一关配置**
   - 2 个障碍门（cat, dog）
   - 2-3 个史莱姆
   - 浮动平台
   - 尖刺障碍（弹回，不扣血）
   - 终点旗帜

### Phase 2: 后续扩展

1. **弹簧机制**
   - 踩踏弹跳
   - spring → spring_out 动画切换

2. **更多关卡**
   - 第二关：Sand 沙漠
   - 第三关：Snow 冰雪

3. **更多单词**
   - 每关 3-5 个单词
   - 难度递进

4. **学习进度追踪**
   - 记录发音准确度
   - 错误单词复习

---

## 九、设计总结

### 核心创新点

1. **障碍门 = 学习触发器**：不发音就无法前进
2. **引导方块 = 学习提示**：清晰引导玩家学习
3. **轻量级弹窗 = 专注学习**：不依赖复杂的 Round1 流程
4. **极简设计 = 专注学习**：去掉所有不必要的元素

### 学习效果预期

| 指标 | 目标 |
|------|------|
| 单词记忆 | 每关 2 个单词，重复练习 |
| 发音准确度 | 简单匹配即可过关（includes 判断） |
| 学习兴趣 | 游戏驱动，自愿重复练习 |

### 下一步

设计文档已完成 Spec Review 第 1 轮修订，请用户审查后进入 implementation plan 阶段。
