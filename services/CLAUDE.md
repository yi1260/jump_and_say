[根目录](../CLAUDE.md) > **services**

# Services 模块文档

> 最后更新: 2026-03-29

## 模块职责

核心服务层，提供动作识别、摄像头管理、语音评分、音频控制、资源加载等基础能力。是连接 React UI 层和 Phaser 游戏层的桥梁。

## 入口与启动

- **动作识别**: `motionController.ts` - MediaPipe Pose 封装
- **摄像头管理**: `cameraSessionManager.ts` - 摄像头流和视频元素管理
- **语音评分**: `speechScoring.ts` - 语音识别结果处理
- **音频控制**: `audioController.ts` - Phaser 音频上下文和 BGM 控制
- **资源加载**: `assetLoader.ts` - 主题资源预加载

### 服务依赖关系

```
cameraSessionManager.ts (摄像头流)
        ↓
motionController.ts (姿态识别)
        ↓
Game Systems (游戏逻辑)

speechScoring.ts (语音识别)
        ↓
PronunciationSystem (发音系统)

audioController.ts (音频控制)
        ↓
Phaser Sound Manager (声音管理)
```

## 对外接口

### MotionController (动作控制器)

```typescript
export class MotionController {
  // 初始化 MediaPipe Pose
  async init(options?: { signal?: AbortSignal }): Promise<void>;

  // 启动姿态检测
  async start(video: HTMLVideoElement, options?: { signal?: AbortSignal }): Promise<void>;

  // 停止检测
  stop(): void;

  // 获取当前运动状态
  getMotionState(): MotionState | null;

  // 清理资源
  destroy(): void;
}
```

**运动状态数据**:
```typescript
interface MotionState {
  x: number;              // 水平位置 (-1=左, 0=中, 1=右)
  bodyX: number;          // 身体中心 X (0-1, 镜像)
  isJumping: boolean;     // 是否跳跃
  rawNoseX: number;       // 鼻子原始 X 坐标
  rawNoseY: number;       // 鼻子原始 Y 坐标
  rawFaceX: number;       // 面部框中心 X
  rawFaceY: number;       // 面部框中心 Y
  rawFaceWidth: number;   // 面部框宽度
  rawFaceHeight: number;  // 面部框高度
  rawShoulderY: number;   // 肩膀中心 Y
}
```

### CameraSessionManager (摄像头会话管理器)

```typescript
export class CameraSessionManager {
  // 获取平台信息
  static getPlatformInfo(): CameraPlatformInfo;

  // 获取可渲染的视频流
  static async acquireRenderableStream(options: {
    videoElement: HTMLVideoElement;
    existingStream?: MediaStream | null;
    permissionTimeoutMs: number;
  }): Promise<MediaStream>;

  // 确保视频元素可渲染
  static async ensureRenderable(video: HTMLVideoElement, options: {
    stage: string;
    metadataTimeoutMs?: number;
    playTimeoutMs?: number;
    frameTimeoutMs?: number;
  }): Promise<void>;

  // 检查是否为摄像头管道错误
  static isCameraPipelineError(error: unknown): error is CameraPipelineError;
}
```

**平台信息**:
```typescript
interface CameraPlatformInfo {
  platform: 'ios' | 'android' | 'harmony' | 'desktop' | 'unknown';
  isTablet: boolean;
  isMobile: boolean;
}
```

**错误类型**:
```typescript
type CameraPipelineErrorCode =
  | 'CAMERA_API_MISSING'
  | 'CAMERA_PERMISSION_TIMEOUT'
  | 'CAMERA_LATE_STREAM_DISCARDED'
  | 'VIDEO_PLAY_FAILED'
  | 'VIDEO_STREAM_NOT_RENDERING';
```

### SpeechScoringService (语音评分服务)

```typescript
export class SpeechScoringService {
  // 单次语音识别
  static async recognizeOnce(options: {
    lang: string;
    maxDurationMs: number;
    inputStream?: MediaStream | null;
  }): Promise<RecognizeOnceResult>;

  // 开始连续识别
  startContinuous(options: {
    lang: string;
    onResult: (result: RecognitionResult) => void;
    onError?: (error: Error) => void;
  }): void;

  // 停止识别
  stopContinuous(): void;
}
```

**识别结果**:
```typescript
interface RecognizeOnceResult {
  transcript: string;      // 识别文本
  confidence: number;      // 置信度 (0-1)
  reason: 'ok' | 'unsupported' | 'timeout' | 'no-speech' | 'aborted' | 'network' | 'not-allowed' | 'error';
  durationMs: number;      // 持续时间
}
```

### AudioController (音频控制器)

```typescript
export class BgmController {
  // 播放背景音乐
  play(key: string, config?: Phaser.Types.Sound.SoundConfig): void;

  // 暂停/恢复
  pause(): void;
  resume(): void;

  // 设置音量
  setVolume(volume: number): void;

  // 淡入/淡出
  fadeIn(duration: number): void;
  fadeOut(duration: number): void;
}

// 全局函数
export function ensurePhaserAudioUnlocked(): Promise<boolean>;
export function primePhaserAudioContext(): void;
export function bindActivePhaserGame(game: Phaser.Game): void;
```

### AssetLoader (资源加载器)

```typescript
// 预加载所有游戏资源
export async function preloadAllGameAssets(
  onProgress?: (loaded: number, total: number) => void
): Promise<void>;

// 预加载特定主题资源
export async function preloadThemeImages(themeId: string): Promise<void>;

// 严格预加载（带超时和重试）
export async function preloadThemeImagesStrict(
  themeId: string,
  onStatus?: (status: string) => void,
  abortSignal?: AbortSignal
): Promise<void>;
```

## 关键依赖与配置

### 外部依赖

- `@mediapipe/pose`: 姿态识别模型
- `@mediapipe/camera_utils`: 摄像头工具
- `assemblyai`: AssemblyAI SDK (语音识别 API)
- `@deepgram/sdk`: Deepgram SDK (语音识别 API)

### 内部依赖

- `../types`: 类型定义
- `../src/config/r2Config`: CDN 配置

### MediaPipe 配置

```typescript
const POSE_OPTIONS = {
  modelComplexity: 0,      // Lite 模型 (最快)
  smoothLandmarks: true,   // 平滑关键点
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
  selfieMode: true
};
```

### 摄像头约束

```typescript
const CAMERA_CONSTRAINTS = {
  ipad: { width: 1280, height: 720, facingMode: 'user' },
  mobile: { width: 640, height: 480, facingMode: 'user' },
  desktop: { width: 1280, height: 720, facingMode: 'user' }
};
```

### 姿态识别阈值

```typescript
const VISIBILITY_THRESHOLD = 0.35;    // 关键点可见度阈值
const JUMP_THRESHOLD = 0.15;          // 跳跃速度阈值
const JUMP_COOLDOWN_MS = 800;         // 跳跃冷却时间
const REF_SHOULDER_WIDTH = 0.22;      // 参考肩宽
```

## 数据模型

### PoseLandmark (姿态关键点)

```typescript
interface PoseLandmark {
  x: number;            // 归一化 X 坐标 (0-1)
  y: number;            // 归一化 Y 坐标 (0-1)
  z?: number;           // 深度信息
  visibility?: number;  // 可见度 (0-1)
  presence?: number;    // 存在概率 (0-1)
}
```

### FallbackRecognizer (兜底识别器)

```typescript
export class FallbackRecognizer {
  constructor(apiEndpoint: string);

  async recognize(audioBlob: Blob, language: string): Promise<{
    transcript: string;
    confidence: number;
  }>;

  setApiKey(key: string): void;
  setTimeout(ms: number): void;
}
```

## 测试与质量

### 测试文件

- `speechScoring.test.ts` - 语音评分测试
- `pronunciationAssessment.test.ts` - 发音评估测试
- `fallbackRecognizer.test.ts` - 兜底识别器测试

### 运行测试

```bash
# 运行所有服务测试
node --test services/*.test.ts

# 单独测试语音评分
node --test services/speechScoring.test.ts
```

### 测试覆盖率

- **speechScoring**: 测试语音识别结果处理和错误处理
- **pronunciationAssessment**: 测试发音准确度计算算法
- **fallbackRecognizer**: 测试第三方 API 调用和超时处理

## 常见问题 (FAQ)

### Q: MediaPipe 加载失败怎么办?

A: 代码已配置多 CDN 兜底，按优先级尝试:
1. `fastly.jsdelivr.net`
2. `cdn.jsdmirror.com`
3. `jsd.onmicrosoft.cn`
4. `testingcf.jsdelivr.net`
5. `cdn.jsdelivr.net`
6. `cdn.maskmysheet.com` (自定义 CDN)

如果全部失败，会显示超时提示界面。

### Q: 摄像头权限被拒绝怎么办?

A: `CameraSessionManager` 会抛出 `CameraPipelineError`，错误代码为 `CAMERA_PERMISSION_TIMEOUT`。建议在 UI 层捕获并提示用户手动授权。

### Q: 如何调试姿态识别?

A: 启用诊断模式 (`?diag=1`)，控制台会输出:
- MediaPipe 初始化时间
- 每帧检测结果
- 关键点可见度
- 跳跃事件触发

### Q: 语音识别超时如何处理?

A: `speechScoring.ts` 配置了超时机制:
- `DEEPGRAM_LISTEN_TIMEOUT_MS = 12000`
- `ASSEMBLYAI_UPLOAD_TIMEOUT_MS = 12000`

超时后会返回 `reason: 'timeout'`，建议在 UI 显示提示并允许重试。

### Q: 如何优化摄像头性能?

A: 根据设备类型选择合适的分辨率:
- iPad: 1280x720 (高清)
- 手机: 640x480 (性能优先)
- 桌面: 1280x720 (默认)

降低分辨率可减少 MediaPipe 计算负担。

## 相关文件清单

### 核心服务

- `motionController.ts` (839 行) - 动作识别
- `cameraSessionManager.ts` (1187 行) - 摄像头管理
- `speechScoring.ts` (525 行) - 语音评分
- `audioController.ts` (403 行) - 音频控制
- `assetLoader.ts` (282 行) - 资源加载

### 辅助服务

- `pronunciationAssessment.ts` (129 行) - 发音评估
- `fallbackRecognizer.ts` (244 行) - 兜底识别器
- `logger.ts` (131 行) - 日志服务

### 测试文件

- `speechScoring.test.ts` (197 行)
- `pronunciationAssessment.test.ts` (82 行)
- `fallbackRecognizer.test.ts` (236 行)

## 变更记录 (Changelog)

### 2026-03-29 - 初始化架构师扫描

- 创建模块文档
- 识别 11 个服务文件（8 个实现 + 3 个测试）
- 文档化核心服务接口和配置
- 记录 MediaPipe 和语音识别集成细节
- 记录测试覆盖范围
