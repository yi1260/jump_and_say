# Jump & Say - 项目代码结构文档

## 项目概述

这是一个基于React + TypeScript的motion-controlled(动作控制)教育游戏,使用Phaser 3游戏引擎和MediaPipe Pose进行人体姿态检测。

### 核心技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3.1 | UI框架 |
| TypeScript | 5.8.2 | 类型安全 |
| Phaser 3 | 3.80.0 | 2D游戏引擎 |
| MediaPipe Pose | 0.5.1675469404 | 人体姿态检测 |
| Framer Motion | 12.23.26 | UI动画 |
| Vite | 6.2.0 | 构建工具 |

### 目录结构

```
jump_and_say/
├── public/
│   ├── assets/              # 静态资源
│   │   ├── fonts/           # 字体文件 (Fredoka, ZCOOL KuaiLe)
│   │   ├── kenney/         # 游戏素材 (角色、瓦片、音效)
│   │   └── ...
│   └── themes/              # 主题数据
│       └── themes-list.json # 主题列表配置
├── src/                     # 源代码目录 (实际位于根目录)
├── components/              # React组件
├── game/                    # Phaser游戏场景
├── services/                # 核心服务
└── index.html               # HTML入口
```

---

## 核心模块详解

### 1. React组件 (`components/`)

#### GameCanvas.tsx
- **职责**: Phaser游戏容器,负责游戏初始化和渲染
- **关键特性**:
  - 自适应DPR(设备像素比)渲染
  - 渲染配置: iPad/Mobile/Desktop三种profile
  - 性能监控: FPS检测,自动降级画质
  - WebGL Context丢失恢复
- **关键函数**:
  - `syncHiDpiScale()`: HiDPI适配核心逻辑
  - `degradeQuality()`: 画质降级处理
  - `initializeGame()`: 游戏初始化

#### LoadingScreen.tsx
- **职责**: 加载界面,显示初始化进度
- **关键特性**:
  - 分阶段加载状态显示
  - 动画角色展示

#### CompletionOverlay.tsx
- **职责**: 游戏完成/奖励界面
- **关键特性**:
  - 星星动画效果
  - 语音同步播放(perfect/super/great等)
  - 一次性播放保护

#### CameraGuide.tsx
- **职责**: 摄像头权限引导
- **关键特性**:
  - 设备检测(iPad/Mobile/Desktop)
  - 自适应约束配置

#### BugReportButton.tsx
- **职责**: 错误报告按钮
- **关键特性**:
  - 日志捕获(最近500条)
  - PNG图片导出
  - Web Share API集成

#### GameBackground.tsx
- **职责**: 游戏背景组件
- **关键特性**: 背景图片预加载

#### ImgWithFallback.tsx
- **职责**: 带降级方案的图片组件

---

### 2. Phaser游戏场景 (`game/scenes/`)

#### PreloadScene.ts
- **职责**: 资源预加载
- **关键功能**:
  - 游戏素材批量加载
  - 奖励语音文件预加载(blob URL优化)
  - 字体加载状态检测

#### MainScene.ts
- **职责**: 主游戏场景
- **关键功能**:
  - 运行时编排器(Runtime Orchestrator)
  - 模式切换与生命周期托管(enter/update/exit/resize/hitBlock)
  - 统一桥接 React 高层事件(score/progress/complete/gameOver/background)
  - 公共系统装配(UI/Card/Reward/Pronunciation)

#### 新增: 玩法插件层 (`game/modes/`)
- `core/`: 插件契约与上下文类型
- `round1/Round1PronunciationMode.ts`: round1 发音玩法插件
- `round2/Round2QuizMode.ts`: round2 听音识图玩法插件
- `_template/NewModeTemplate.ts`: 新玩法模板

#### 新增: 运行时与系统层
- `game/runtime/ModeRegistry.ts`: 玩法注册、解析、切换、fallback
- `game/runtime/SceneRuntimeState.ts`: 玩法运行时状态(当前/上一个 mode、切换原因、回调桥接)
- `game/runtime/ThemeAssetRuntime.ts`: 主题数据兜底与资源缺失加载链路
- `game/systems/SceneUiSystem.ts`: 游戏内 UI 系统门面
- `game/systems/CardSystem.ts`: 卡片生命周期系统门面
- `game/systems/RewardSystem.ts`: 奖励反馈系统门面
- `game/systems/PronunciationSystem.ts`: 发音流程系统门面
- `game/systems/PlayerControlSystem.ts`: 玩家控制循环系统（姿态输入/键盘输入/运动纠偏）

#### 运行时策略
- 插件运行时为唯一执行路径（不再保留 legacy gameplay 分支）。
- 通过 `ModeRegistry` 的 fallback 机制处理插件进入异常。

---

### 3. 核心服务 (`services/`)

#### motionController.ts
- **职责**: MediaPipe Pose姿态检测
- **关键特性**:
  - **Lite模型** (modelComplexity: 0) 轻量级推理
  - 33个身体关键点检测
  - 肩膀中心→水平移动检测
  - 身体垂直速度→跳跃检测
  - **坐标处理**: 归一化0-1,X轴镜像(1-rawX)
  - **水平阈值**: 动态基于肩膀宽度(~0.12)
  - **跳跃检测**: 基于速度+自适应阈值,800ms冷却
  - **可见性过滤**: visibility/presence < 0.35时过滤
  - **多CDN回退**: jsdelivr → unpkg → R2自定义CDN
- **关键方法**:
  - `init()`: 初始化Pose模型
  - `start()`: 启动检测循环
  - `calibrate()`: 姿态校准
  - `onResults()`: 姿态结果处理

#### assetLoader.ts
- **职责**: 资源加载与缓存
- **关键特性**:
  - 批量加载(BATCH_SIZE=4)
  - 背景预加载队列(MAX_CONCURRENT_DOWNLOADS=6)
  - 重试逻辑: 1次重试,15s超时
  - **音频blob缓存**: 内存中blob URL,最多48条

#### audioController.ts
- **职责**: 音频控制
- **关键功能**:
  - BGM控制器(游戏/菜单音量差异)
  - 音效播放
  - 音频解锁(浏览器自动播放策略)

#### cameraSessionManager.ts
- **职责**: 摄像头会话管理
- **关键特性**:
  - 多设备约束适配(iPad/Mobile/Desktop)
  - 错误恢复机制

#### speechScoring.ts
- **职责**: 发音评测
- **关键功能**:
  - Web Speech API集成
  - 置信度评估(HIGH/MEDIUM/LOW)
  - 音量检测

#### logger.ts
- **职责**: 日志服务
- **关键功能**:
  - 日志捕获(最近500条)
  - 格式化输出
  - Bug报告支持

---

### 4. 配置与类型

#### types.ts
- **核心类型定义**:
```typescript
// 运动状态
interface MotionState {
  x: number;           // -1=left, 0=center, 1=right
  bodyX: number;       // 0-1,镜像后
  isJumping: boolean;
  // ...更多属性
}

// 游戏阶段
enum GamePhase {
  MENU = 'MENU',
  THEME_SELECTION = 'THEME_SELECTION',
  LOADING = 'LOADING',
  LOADING_AI = 'LOADING_AI',
  CALIBRATING = 'CALIBRATING',
  TUTORIAL = 'TUTORIAL',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER'
}

// 主题结构
interface Theme {
  id: string;
  name: string;
  icon: string;
  cover?: string;
  level?: string;
  questions: ThemeQuestion[];
}
```

#### gameConfig.ts
- **游戏配置管理**:
  - 主题加载(CDN回退机制)
  - 资源预加载队列管理
  - 封面图片预加载
  - 音频blob URL缓存管理

#### r2Config.ts
- **R2 CDN配置**:
  - 图片URL生成
  - 资源URL生成
  - CDN回退逻辑

---

### 5. 主应用 (`App.tsx`)

#### 核心功能模块

1. **游戏阶段管理**
   - MENU → THEME_SELECTION → LOADING → TUTORIAL → PLAYING → GAME_OVER
   
2. **主题选择系统**
   - 级别筛选(AA/A/B/C/...)
   - 多主题连续游戏
   - 封面预加载优化

3. **运动检测集成**
   - MediaPipe Pose初始化
   - 姿态关键点渲染
   - 检测状态UI反馈

4. **音效系统**
   - BGM音量动态调整
   - 游戏阶段音量差异

5. **全屏管理**
   - 跨浏览器API兼容
   - iOS Safari适配

6. **性能优化**
   - 渲染质量自适应
   - 内存管理
   - 资源清理

---

### 6. 入口文件

#### index.tsx
- React入口
- PWA Service Worker注册

#### index.html
- MediaPipe脚本加载
- 字体预加载

---

## 游戏流程

```
1. 启动 → MENU
2. 点击开始 → THEME_SELECTION (选择主题)
3. 选择完成 → LOADING (加载资源)
4. 加载完成 → TUTORIAL (玩法教学)
5. 教学完成 → PLAYING (游戏进行)
   - Round 1: 盲盒发音 (BLIND_BOX_PRONUNCIATION)
   - Round 2: 听音识图 (QUIZ)
6. 游戏结束 → GAME_OVER → CompletionOverlay
7. 返回菜单 → MENU
```

---

## 关键配置

### 渲染质量级别
- **iPad High**: DPR 2.0, 3.4M像素
- **iPad Medium**: DPR 1.8, 2.8M像素
- **iPad Low**: DPR 1.55, 2.3M像素
- **Mobile**: DPR 2.4, 2.6M像素
- **Desktop**: DPR 2.2, 3.0M像素

### 运动检测参数
- 帧率: 35fps (FRAME_MIN_TIME = 1000/35)
- 跳跃冷却: 800ms
- 水平阈值: 0.05-0.22 (动态)
- 可见性过滤: 0.35

### 资源加载参数
- 批量大小: 4
- 最大并发: 6
- 超时: 15s
- 重试: 1次
- 音频Blob缓存: 48条

---

## PWA配置

- Service Worker自动注册
- CDN资源缓存策略:
  - MediaPipe文件: 1年
  - 主题图片(raz-cdn-cache-v4): 1年
  - 游戏资源(game-assets-cdn-cache-v2): 1年

---

## 开发调试

- Dev模式: Eruda可用的控制台
- 调试参数: `?debug=true`
- 日志标签: `[INIT]`, `[START]`, `[JUMP]`, `[Font]`, `[Audio]`

---

## 注意事项

1. **类型安全**: 严格TypeScript,禁止使用`as any`或`@ts-ignore`
2. **资源清理**: 
   - Phaser: `game.destroy(true)`
   - 摄像头: `stream.getTracks().forEach(t => t.stop())`
   - Blob URL: `URL.revokeObjectURL()`
3. **移动端适配**:
   - 视频元素: `muted=true`, `playsInline`
   - 设备约束差异化配置
4. **音频策略**: 始终调用`ensureAudioUnlocked()`后播放
