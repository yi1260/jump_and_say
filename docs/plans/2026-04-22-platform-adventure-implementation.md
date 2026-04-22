# Platform Adventure (平台探险模式) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个基于体感控制的马里奥式英语启蒙游戏模式，核心特色为“声控魔法（子弹时间跟读）”和“顶方块答题”。

**Architecture:** 采用 Phaser 模式插件架构，新增 `AdventureScene` 作为主场景，通过 `AdventureFlow` 管理游戏状态机。复用现有的物理、敌人和语音识别系统，但进行结构化重构。

**Tech Stack:** Phaser 3 (Arcade Physics), MediaPipe Pose (Motion Control), React, TypeScript.

---

### Task 1: 基础设施与场景搭建

**Files:**
- Create: `game/scenes/AdventureScene.ts`
- Create: `game/modes/adventure/AdventureModePlugin.ts`
- Modify: `game/modes/core/types.ts`
- Modify: `game/runtime/ModeRegistry.ts`

- [ ] **Step 1: 扩展 GameplayModeId**
在 `game/modes/core/types.ts` 中添加 `ADVENTURE` 模式 ID。

- [ ] **Step 2: 创建 AdventureScene 骨架**
参考 `PlatformScene.ts` 创建 `AdventureScene` 类，实现基础的 `init`, `preload`, `create` 方法。

- [ ] **Step 3: 创建并注册 AdventureModePlugin**
实现 `AdventureModePlugin` 类，并在 `ModeRegistry.ts` 中完成注册，使其能通过 `MainScene` 或外部逻辑激活。

- [ ] **Step 4: 运行并验证场景切换**
确保可以通过修改配置进入空的 `AdventureScene`。

---

### Task 2: 世界构建与多主题配置

**Files:**
- Create: `game/data/worldConfigs.ts`
- Create: `game/systems/PlatformPhysicsSystem.ts`

- [ ] **Step 1: 定义五大世界配置**
在 `worldConfigs.ts` 中定义草地、沙漠、雪地、洞穴、幻境的资源路径、宽度和敌人密度。

- [ ] **Step 2: 实现 PlatformPhysicsSystem**
封装地形生成逻辑。支持从配置中读取 `terrain_grass_block` 等不同主题的资源来构建地图。

- [ ] **Step 3: 实现平滑摄像机跟随**
创建 `CameraSystem.ts` 或在场景中配置摄像机平滑跟随玩家，并设置死区（Deadzone）。

---

### Task 3: 体感控制与动作映射

**Files:**
- Modify: `game/systems/PlatformPlayerControlSystem.ts`
- Create: `game/systems/AdventurePlayerControlSystem.ts`

- [ ] **Step 1: 重构控制系统以支持体感**
创建一个新的 `AdventurePlayerControlSystem`（或重构现有的），从全局状态中读取 `MotionController` 的数据（`bodyX`, `isJumping`）。

- [ ] **Step 2: 映射跑步与跳跃**
实现原地小跑驱动角色向右移动，原地起跳驱动垂直跳跃的逻辑。

- [ ] **Step 3: 优化动画状态机**
根据移动状态切换 `walk_a/b`, `jump`, `idle` 动画。

---

### Task 4: 声控魔法系统 (子弹时间)

**Files:**
- Create: `game/systems/MagicSpellSystem.ts`
- Modify: `game/systems/PlatformEnemySystem.ts`

- [ ] **Step 1: 实现慢动作 (Bullet Time) 触发器**
当玩家与怪物的距离小于阈值时，通过 `this.physics.world.timeScale = 5` (放慢5倍) 实现子弹时间。

- [ ] **Step 2: 集成语音评分**
在子弹时间内，触发 `PronunciationSystem`。在屏幕中央显示单词卡片和麦克风。

- [ ] **Step 3: 魔法反馈逻辑**
如果识别正确，播放 `super.mp3` 并将怪物转化为金币或弹簧；如果错误或超时，恢复时间流速并让怪物加速冲刺。

---

### Task 5: 生命值与顶方块答题 (Round 2)

**Files:**
- Create: `game/systems/AdventureQuizSystem.ts`
- Modify: `game/scenes/AdventureScene.ts` (HUD 逻辑)

- [ ] **Step 1: 实现 3 颗心生命值 HUD**
使用 `hud_heart.svg` 在左上角渲染生命值。处理碰撞减血逻辑。

- [ ] **Step 2: 实现答题方块交互**
在特定位置生成 `block_exclamation.svg`。监听 `overlap` 事件，当玩家向上跳跃顶到方块时，触发听力题目。

- [ ] **Step 3: 实现答题奖励**
答对则爆出大量金币。

---

### Task 6: 关卡切换与结算

**Files:**
- Modify: `game/scenes/AdventureScene.ts`
- Modify: `components/CompletionOverlay.tsx`

- [ ] **Step 1: 实现终点旗帜逻辑**
触碰 `flag_red_a.svg` 后停止玩家控制，播放庆祝动画。

- [ ] **Step 2: 实现世界自动切换**
当第一关完成后，自动加载 `worldConfigs[1]` 的配置并重置场景（无需重新加载整个页面）。

- [ ] **Step 3: 最终结算**
显示获得的总星星数和学习到的单词列表。
