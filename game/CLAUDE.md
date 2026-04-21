[根目录](../CLAUDE.md) > **game**

# Game 模块文档

> 最后更新: 2026-03-29

## 模块职责

Phaser 游戏核心逻辑层，包含游戏场景、系统、游戏模式和运行时管理。负责实现体感跳跃答题和发音练习两大核心玩法。

## 入口与启动

- **场景入口**:
  - `scenes/PreloadScene.ts` - 资源预加载场景
  - `scenes/MainScene.ts` - 主游戏场景
- **系统入口**:
  - `systems/PlayerControlSystem.ts` - 玩家控制系统
  - `systems/CardSystem.ts` - 卡片系统
  - `systems/PronunciationSystem.ts` - 发音系统
  - `systems/RewardSystem.ts` - 奖励系统
  - `systems/SceneUiSystem.ts` - 场景 UI 系统

### 游戏模式结构

```
game/modes/
├── core/ (核心接口)
│   ├── GameplayModePlugin.ts
│   └── types.ts
├── round1/ (发音模式)
│   ├── Round1PronunciationMode.ts
│   └── Round1PronunciationFlow.ts
├── round2/ (答题模式)
│   ├── Round2QuizMode.ts
│   └── Round2QuizFlow.ts
└── _template/ (新模板)
    └── NewModeTemplate.ts
```

## 对外接口

### MainScene (主场景)

```typescript
export class MainScene extends Phaser.Scene implements GameplayModeHost {
  // Phaser 生命周期方法
  init(data: { theme: ThemeId; mode: GameplayMode }): void;
  preload(): void;
  create(): void;
  update(time: number, delta: number): void;

  // GameplayModeHost 接口实现
  getPlayer(): Phaser.Physics.Arcade.Sprite;
  getBlocks(): Phaser.Physics.Arcade.StaticGroup;
  getScore(): number;
  addScore(points: number): void;
  getCurrentThemeData(): Theme | null;
}
```

### GameplayModePlugin (游戏模式插件接口)

```typescript
export interface GameplayModePlugin {
  getId(): GameplayModeId;
  getVisualProfile(): ModeVisualProfile;
  onActivate(context: ModeContext): Promise<void>;
  onDeactivate(reason: ModeTransitionReason): void;
  onUpdate(time: number, delta: number): void;
  handlePlayerJump(): void;
  handlePlayerMove(direction: 'left' | 'right'): void;
}
```

### Game Systems

#### PlayerControlSystem

```typescript
export class PlayerControlSystem {
  update(motionState: MotionState): void;
  getPlayer(): Phaser.Physics.Arcade.Sprite;
  isJumping(): boolean;
}
```

#### CardSystem

```typescript
export class CardSystem {
  showCards(questions: ThemeQuestion[]): void;
  hideCards(): void;
  highlightCard(index: number): void;
  onCardHit(callback: (index: number) => void): void;
}
```

#### PronunciationSystem

```typescript
export class PronunciationSystem {
  startPronunciationRound(targetText: string): Promise<PronunciationRoundResult>;
  showMicrophoneHud(x: number, y: number): void;
  hideMicrophoneHud(): void;
}
```

## 关键依赖与配置

### 外部依赖

- `phaser`: 游戏引擎 (3.80.0)
- `@mediapipe/pose`: 姿态识别 (通过 motionController)

### 内部依赖

- `../services/motionController`: 动作识别服务
- `../services/speechScoring`: 语音评分服务
- `../services/audioController`: 音频控制器
- `../gameConfig`: 游戏配置和主题加载
- `../types`: 类型定义

### 物理常量

```typescript
const GRAVITY_Y = 2500;           // 重力加速度
const JUMP_OVERSHOOT = 50;        // 跳跃高度偏移
const FRAME_MIN_TIME = 1000 / 35; // 最小帧间隔 (28.5 FPS)
```

### 布局计算

```typescript
interface AnswerCardLayout {
  centerX: number;
  cardWidth: number;
  cardHeight: number;
  iconWidth: number;
  iconHeight: number;
  imageRatio: number;
}
```

## 数据模型

### SceneRuntimeState (场景运行时状态)

```typescript
export class SceneRuntimeState {
  currentMode: GameplayModeId | null;
  isTransitioning: boolean;
  lastUpdateTime: number;
}
```

### ModeRegistry (模式注册表)

```typescript
export class ModeRegistry {
  registerMode(mode: GameplayModePlugin): void;
  activateMode(modeId: GameplayModeId, context: ModeContext): Promise<void>;
  deactivateMode(reason: ModeTransitionReason): void;
}
```

### ThemeAssetRuntime (主题资源运行时)

```typescript
export class ThemeAssetRuntime {
  preloadThemeAssets(themeId: string): Promise<void>;
  getAssetUrl(assetPath: string): string;
  isAssetLoaded(assetPath: string): boolean;
}
```

## 游戏模式详解

### Round 1: 发音模式 (BLIND_BOX_PRONUNCIATION)

**流程**: 跳起撞击闪卡 → 听示范发音 → 大声跟读单词 → 评分反馈

**核心文件**:
- `modes/round1/Round1PronunciationMode.ts` - 模式插件实现
- `modes/round1/Round1PronunciationFlow.ts` - 流程控制逻辑

**状态机**:
1. `WAITING_FOR_HIT` - 等待撞击闪卡
2. `PLAYING_AUDIO` - 播放示范音频
3. `WAITING_FOR_PRONUNCIATION` - 等待用户发音
4. `SCORING` - 评分和反馈

### Round 2: 答题模式 (QUIZ)

**流程**: 左右移动选择答案 → 跳跃确认 → 正误反馈 → 下一题

**核心文件**:
- `modes/round2/Round2QuizMode.ts` - 模式插件实现
- `modes/round2/Round2QuizFlow.ts` - 流程控制逻辑

**状态机**:
1. `SHOWING_QUESTION` - 显示题目
2. `WAITING_FOR_MOVE` - 等待移动选择
3. `WAITING_FOR_JUMP` - 等待跳跃确认
4. `SHOWING_RESULT` - 显示结果

## 测试与质量

### 测试策略

- **场景测试**: 手动集成测试，验证游戏流程
- **系统测试**: 单元测试覆盖核心逻辑（待补充）
- **模式测试**: 验证状态机转换和事件处理

### 性能优化

- **对象池**: 粒子效果使用 Phaser 内置对象池
- **纹理缓存**: 预加载主题纹理到 GPU
- **批量渲染**: 同类游戏对象批量绘制

## 常见问题 (FAQ)

### Q: 如何新增游戏模式?

A: 参考模板 `game/modes/_template/NewModeTemplate.ts`:
1. 创建新的模式目录 `game/modes/roundN/`
2. 实现 `GameplayModePlugin` 接口
3. 在 `game/runtime/ModeRegistry.ts` 注册新模式
4. 更新 `types.ts` 中的 `GameplayMode` 类型

### Q: 如何调试物理碰撞?

A: 在 `MainScene` 的 `create()` 方法中启用调试渲染:
```typescript
this.physics.world.createDebugGraphic();
```

### Q: 如何优化渲染性能?

A: 调整 `GameCanvas.tsx` 中的 `RenderProfile`:
- 降低 `renderDpr` (设备像素比)
- 启用 `textureBoost` 纹理优化
- 调整 `maxInternalPixels` 最大内部分辨率

### Q: 跳跃检测不准确怎么办?

A: 检查以下配置:
- `motionController.ts` 的跳跃阈值 (`JUMP_THRESHOLD`)
- `PlayerControlSystem.ts` 的跳跃冷却时间 (`JUMP_COOLDOWN`)
- MediaPipe 模型的 `minDetectionConfidence` 参数

## 相关文件清单

### 场景文件 (scenes/)

- `MainScene.ts` (1627 行) - 主游戏场景
- `PreloadScene.ts` (417 行) - 预加载场景

### 系统文件 (systems/)

- `PlayerControlSystem.ts` (184 行) - 玩家控制
- `CardSystem.ts` (205 行) - 卡片系统
- `PronunciationSystem.ts` (26 行) - 发音系统
- `RewardSystem.ts` (178 行) - 奖励系统
- `SceneUiSystem.ts` (201 行) - 场景 UI

### 模式文件 (modes/)

- `core/GameplayModePlugin.ts` (13 行) - 核心接口
- `core/types.ts` (111 行) - 类型定义
- `round1/Round1PronunciationMode.ts` (49 行) - 发音模式
- `round1/Round1PronunciationFlow.ts` (2765 行) - 发音流程
- `round2/Round2QuizMode.ts` (42 行) - 答题模式
- `round2/Round2QuizFlow.ts` (508 行) - 答题流程

### 运行时文件 (runtime/)

- `ModeRegistry.ts` (171 行) - 模式注册表
- `SceneRuntimeState.ts` (31 行) - 场景状态
- `ThemeAssetRuntime.ts` (214 行) - 主题资源管理

## 变更记录 (Changelog)

### 2026-03-29 - 初始化架构师扫描

- 创建模块文档
- 识别 17 个游戏核心文件
- 文档化场景、系统、模式和运行时架构
- 记录游戏模式和状态机设计
