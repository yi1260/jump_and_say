[根目录](../CLAUDE.md) > **api**

# API 模块文档

> 最后更新: 2026-04-06

## 模块职责

语音识别 API 接口层，提供第三方语音识别服务的兜底实现。当浏览器原生 Speech Recognition API 不可用时，通过此 API 接口调用云端服务。

**服务提供商优先级（2026-04-06 更新）**：
1. **腾讯云一句话识别**（优先）- 国内低延迟，每月 5000 次免费额度
2. **Deepgram**（第一兜底）- 流式识别，低延迟
3. **AssemblyAI**（第二兜底）- 批量识别，高准确度

## 入口与启动

- **唯一入口**: `recognize.ts` - 语音识别 API 处理器

## 对外接口

### API 配置

```typescript
export const config = {
  api: {
    bodyParser: false, // 禁用默认 body 解析，直接处理音频流
  },
};
```

### 请求处理

**HTTP 方法**: POST

**请求格式**: `multipart/form-data`

**请求字段**:
- `audio`: Blob - 音频数据（WebM/WAV 格式）
- `language`: string - 语言代码（如 `zh-CN`, `en-US`）

**响应格式**:
```typescript
interface RecognitionResponse {
  transcript: string;          // 识别文本
  confidence: number;          // 置信度 (0-1)
  provider: 'deepgram' | 'assemblyai'; // 服务提供商
}
```

### API 超时配置

```typescript
const ASSEMBLYAI_POLL_INTERVAL_MS = 1000;        // 轮询间隔
const ASSEMBLYAI_MAX_WAIT_MS = 8000;             // 最大等待时间
const DEEPGRAM_LISTEN_TIMEOUT_MS = 12000;        // Deepgram 超时
const ASSEMBLYAI_UPLOAD_TIMEOUT_MS = 12000;      // AssemblyAI 上传超时
const ASSEMBLYAI_TRANSCRIPT_CREATE_TIMEOUT_MS = 8000; // 转录创建超时
const ASSEMBLYAI_POLL_REQUEST_TIMEOUT_MS = 4000; // 轮询请求超时
```

## 关键依赖与配置

### 外部依赖

- `tencentcloud-sdk-nodejs`: 腾讯云语音识别 SDK
- `@ffmpeg-installer/ffmpeg`: FFmpeg 二进制文件（用于音频格式转换）
- `fluent-ffmpeg`: FFmpeg Node.js 封装
- `@deepgram/sdk`: Deepgram 语音识别 SDK
- `assemblyai`: AssemblyAI Node.js SDK

### 环境变量

需要在 `.env.local` 中配置:

```env
# 腾讯云（优先，国内访问）
TENCENT_SECRET_ID=your_tencent_secret_id
TENCENT_SECRET_KEY=your_tencent_secret_key

# Deepgram（第一兜底）
DEEPGRAM_API_KEY=your_deepgram_api_key

# AssemblyAI（第二兜底）
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
```

**注意**: 至少配置一个服务提供商的 API Key。

### API 提供商优先级

1. **腾讯云**（优先）
   - 国内节点，低延迟
   - 每月 5000 次免费额度
   - 支持 WAV 格式，WebM 自动转换
   - 引擎: `16k_en`（英语通用）

2. **Deepgram**（第一兜底）
   - 流式识别，低延迟
   - 原生支持 WebM 格式
   - 模型: `nova-3`

3. **AssemblyAI**（第二兜底）
   - 批量识别，高准确度
   - 上传后轮询结果
   - 语言: `en_us`

### 调用流程

#### 腾讯云流程

```
客户端音频流 → API Handler
→ 检测音频格式
→ 如果是 WebM，使用 FFmpeg 转换为 WAV
→ 调用腾讯云一句话识别 API（16k_en）
→ 返回识别结果
```

#### Deepgram 流程

```
客户端音频流 → API Handler
→ Deepgram REST API
→ 返回识别结果
```

#### AssemblyAI 流程

```
客户端音频流 → API Handler
→ 上传音频到 AssemblyAI
→ 获取转录任务 ID
→ 轮询转录状态
→ 返回完整转录文本
```

## 数据模型

### StageLogger (阶段日志器)

```typescript
interface StageLogger {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}
```

### FetchWithStageTimeoutOptions (超时请求选项)

```typescript
interface FetchWithStageTimeoutOptions {
  stage: string;
  url: string;
  timeoutMs: number;
  init?: RequestInit;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  logger?: StageLogger;
}
```

### AssemblyAiPollOptions (轮询选项)

```typescript
interface AssemblyAiPollOptions {
  apiKey: string;
  transcriptId: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}
```

### AssemblyAiPollResponse (轮询响应)

```typescript
interface AssemblyAiPollResponse {
  status?: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;         // 转录文本
  error?: string;        // 错误消息
}
```

### RecognitionSuccessPayload (成功载荷)

```typescript
interface RecognitionSuccessPayload {
  transcript: string;
  provider: 'tencent' | 'deepgram' | 'assemblyai';
}
```

## 测试与质量

### 测试文件

- `recognize.test.ts` - API 接口测试

### 运行测试

```bash
# 运行 API 测试
node --test api/recognize.test.ts

# 详细输出
node --test --test-reporter=tap api/recognize.test.ts
```

### 测试覆盖范围

- Deepgram API 调用和超时处理
- AssemblyAI 上传、轮询、错误处理
- 音频格式转换
- 多阶段超时控制

### 错误处理策略

**阶段化超时控制**:
- 上传阶段: 12s 超时
- 处理阶段: 8s 超时
- 轮询单次: 4s 超时

**重试机制**: 暂无自动重试，建议客户端实现重试逻辑。

## 常见问题 (FAQ)

### Q: 为什么需要三个语音识别服务?

A:
- **腾讯云**: 国内优先，低延迟，免费额度多
- **Deepgram**: 流式识别，延迟低（适合实时交互）
- **AssemblyAI**: 兜底方案，准确度高（适合复杂音频）

当腾讯云不可用时，自动切换到 Deepgram，再切换到 AssemblyAI。

### Q: WebM 格式如何处理?

A: 腾讯云不支持 WebM 格式。当检测到 WebM 音频时，会使用 FFmpeg 自动转换为 WAV 格式（16kHz, 单声道, 16-bit PCM）。转换失败时自动降级到 Deepgram/AssemblyAI。

### Q: API 调用失败如何处理?

A: 客户端 `fallbackRecognizer.ts` 会捕获错误并返回:
```typescript
{
  transcript: '',
  confidence: 0,
  reason: 'network' | 'timeout' | 'error'
}
```

建议在 UI 显示错误提示并允许重试。

### Q: 支持哪些音频格式?

A:
- **腾讯云**: WAV, MP3, M4A, AAC, OGG-OPUS, AMR（WebM 需转换）
- **Deepgram**: WebM, WAV, MP3, OGG 等
- **AssemblyAI**: WebM, WAV, MP3 等

推荐格式: WebM（浏览器原生录音格式）

### Q: 如何优化识别准确度?

A:
1. 使用高质量麦克风（推荐耳机麦克风）
2. 减少环境噪音
3. 说话清晰，语速适中
4. 确保网络连接稳定

### Q: API 费用如何计算?

A:
- **腾讯云**: 每月 5000 次免费，超出后 3.50元/千次
- **Deepgram**: 按音频时长计费（免费额度 200 小时/月）
- **AssemblyAI**: 按音频时长计费（免费额度 5 小时/月）

建议配置腾讯云作为主要服务，利用免费额度降低成本。

## 相关文件清单

### 核心文件

- `recognize.ts` (292 行) - API 处理器
- `recognize.test.ts` (153 行) - API 测试

### 客户端调用

- `services/fallbackRecognizer.ts` - 兜底识别器客户端
- `services/speechScoring.ts` - 语音评分服务（调用兜底识别器）

## 变更记录 (Changelog)

### 2026-04-06 - 接入腾讯云语音识别

- 新增腾讯云一句话识别作为优先服务商
- 添加 FFmpeg 音频格式转换（WebM → WAV）
- 更新服务提供商优先级：腾讯云 → Deepgram → AssemblyAI
- 更新环境变量配置说明
- 更新文档说明三个服务商的区别和费用

### 2026-03-29 - 初始化架构师扫描

- 创建模块文档
- 识别 2 个文件（1 个实现 + 1 个测试）
- 文档化 API 接口和调用流程
- 记录超时配置和错误处理策略
