[根目录](../CLAUDE.md) > **components**

# Components 模块文档

> 最后更新: 2026-03-29

## 模块职责

React UI 组件层，负责渲染游戏容器、加载界面、完成界面等用户界面元素。与 Phaser 游戏引擎集成，通过 React 状态管理控制游戏生命周期。

## 入口与启动

- **主入口**: `GameCanvas.tsx` - Phaser 游戏容器组件
- **辅助入口**: `LoadingScreen.tsx`, `CompletionOverlay.tsx` - UI 覆盖层组件

### 组件树结构

```
App.tsx
└── GameCanvas (Phaser 游戏容器)
    ├── LoadingScreen (资源加载界面)
    ├── CompletionOverlay (游戏完成界面)
    ├── GameBackground (背景渲染)
    ├── CameraGuide (摄像头引导)
    └── BugReportButton (错误报告)
```

## 对外接口

### GameCanvas 组件

```typescript
interface GameCanvasProps {
  theme: Theme;
  mode: GameplayMode;
  onScoreUpdate: (score: number) => void;
  onComplete: (summary?: PronunciationSummary) => void;
  qualityMode?: QualityMode; // 'adaptive' | 'high' | 'medium' | 'low'
}
```

**导出**: `export type QualityMode = 'adaptive' | 'high' | 'medium' | 'low'`

### CompletionOverlay 组件

```typescript
interface CompletionOverlayProps {
  score: number;
  themeName: string;
  onRestart: () => void;
  onMenu: () => void;
  pronunciationSummary?: PronunciationSummary;
}
```

## 关键依赖与配置

### 外部依赖

- `react`: UI 框架
- `react-dom`: DOM 渲染
- `phaser`: 游戏引擎 (通过 GameCanvas 集成)
- `framer-motion`: 动画库 (用于 UI 过渡动画)

### 内部依赖

- `../game/scenes/MainScene`: 主游戏场景
- `../game/scenes/PreloadScene`: 预加载场景
- `../services/audioController`: 音频控制器
- `../types`: 类型定义

### 渲染配置

- **设备适配**:
  - iPad: 1280x720, DPR 优化
  - 手机: 640x480, 性能模式
  - 桌面: 自适应分辨率
- **质量模式**: 支持用户手动切换渲染质量

## 数据模型

### RenderProfile (渲染配置文件)

```typescript
interface RenderProfile {
  name: 'ipad' | 'mobile' | 'default';
  renderDpr: number;       // 设备像素比
  textureBoost: number;    // 纹理增强因子
  maxInternalPixels: number;
  initialQualityStep: number;
  maxQualityStep: number;
}
```

### PersistedQualityState (持久化质量状态)

```typescript
interface PersistedQualityState {
  profile: RenderProfileName;
  step: number;
  savedAt: number; // 时间戳
}
```

### VideoSnapshot (视频快照)

```typescript
interface VideoSnapshot {
  paused: boolean;
  ended: boolean;
  muted: boolean;
  readyState: number;
  networkState: number;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
  clientWidth: number;
  clientHeight: number;
  isConnected: boolean;
}
```

## 测试与质量

### 测试策略

- **组件测试**: 暂无单元测试，依赖手动测试和集成测试
- **性能监控**: 通过 `requestAnimationFrame` 监控帧率
- **错误边界**: React Error Boundary 捕获渲染错误

### 质量保障

- TypeScript 严格模式
- React StrictMode (生产环境已禁用，避免双重初始化)
- 渲染性能自适应调整

## 常见问题 (FAQ)

### Q: 为什么移除了 React StrictMode?

A: StrictMode 会导致 Phaser 游戏实例双重初始化，在硬件集成演示中可能引发问题。虽然 useEffect 有清理逻辑，但禁用 StrictMode 更安全。

### Q: 如何切换渲染质量?

A: 通过 `qualityMode` 属性控制:
- `adaptive`: 根据设备性能自动调整
- `high`: 最高质量 (DPR 1.0)
- `medium`: 中等质量 (DPR 0.9)
- `low`: 最低质量 (DPR 0.8)

### Q: GameCanvas 如何清理资源?

A: 在 useEffect 清理函数中调用 `game.destroy(true)`，会自动销毁所有游戏对象、事件监听器和渲染器。

### Q: 如何处理摄像头权限拒绝?

A: `CameraGuide` 组件会显示引导界面，提示用户授权摄像头权限。如果拒绝，游戏无法启动。

## 相关文件清单

### 核心组件

- `GameCanvas.tsx` (775 行) - Phaser 游戏容器
- `CompletionOverlay.tsx` (547 行) - 完成界面
- `LoadingScreen.tsx` (73 行) - 加载屏幕
- `GameBackground.tsx` (61 行) - 背景渲染

### 辅助组件

- `CameraGuide.tsx` (99 行) - 摄像头引导
- `BugReportButton.tsx` (337 行) - 错误报告按钮
- `ImgWithFallback.tsx` (46 行) - 图片兜底加载

## 变更记录 (Changelog)

### 2026-03-29 - 初始化架构师扫描

- 创建模块文档
- 识别 7 个 React 组件文件
- 文档化渲染配置和质量模式系统
- 记录组件接口和数据模型
