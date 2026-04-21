[根目录](../../CLAUDE.md) > [src](../) > **config**

# Config 模块文档

> 最后更新: 2026-03-29

## 模块职责

配置管理模块，负责 R2 CDN 路径映射、资源 URL 生成和错误处理。提供统一的资源访问接口，支持本地和 CDN 双路径。

## 入口与启动

- **唯一入口**: `r2Config.ts` - R2 CDN 配置和 URL 生成工具

## 对外接口

### R2 配置常量

```typescript
export const R2_BASE_URL = 'https://cdn.maskmysheet.com';
const ASSET_VERSION = 'v=20260218_fix3'; // 缓存破坏版本号
```

### URL 生成函数

#### getR2ImageUrl

生成主题图片的 CDN URL（自动添加版本参数）

```typescript
export const getR2ImageUrl = (imagePath: string): string;

// 示例
getR2ImageUrl('AA/ThemeName/image.webp');
// 返回: 'https://cdn.maskmysheet.com/RAZ/AA/ThemeName/image.webp?v=20260218_fix3'
```

**路径转换规则**:
- 输入路径包含级别（如 `AA/ThemeName/image.webp`）
- 自动添加 `RAZ/` 前缀（大写）
- 强制 WebP 格式（在调用前完成）

#### getR2AssetUrl

生成游戏资源的 CDN URL

```typescript
export const getR2AssetUrl = (path: string): string;

// 示例
getR2AssetUrl('assets/kenney/sprites/player.png');
// 返回: 'https://cdn.maskmysheet.com/assets/kenney/sprites/player.png?v=20260218_fix3'
```

#### getLocalAssetUrl

生成本地资源路径（用于开发和兜底）

```typescript
export const getLocalAssetUrl = (path: string): string;

// 示例
getLocalAssetUrl('https://cdn.maskmysheet.com/assets/icon.png');
// 返回: '/assets/icon.png'
```

#### getThemesListPrimaryUrl

获取主题列表 JSON 的主 URL（本地优先）

```typescript
export const getThemesListPrimaryUrl = (): string;
// 返回: '/themes/themes-list.json?v=20260218_fix3'
```

#### getThemesListFallbackUrl

获取主题列表 JSON 的兜底 URL（CDN）

```typescript
export const getThemesListFallbackUrl = (): string;
// 返回: 'https://cdn.maskmysheet.com/RAZ/themes-list.json?v=20260218_fix3'
```

### 错误处理

```typescript
export const handleR2Error = (error: unknown, context: string): never;

// 示例用法
try {
  await loadThemes();
} catch (error) {
  handleR2Error(error, '加载主题列表失败');
  // 会抛出用户友好的错误消息
}
```

**错误消息映射**:
- `Failed to fetch` / `NetworkError` → "网络连接失败，请检查网络设置"
- `404` → "资源未找到"
- 其他错误 → "加载资源失败"

## 关键依赖与配置

### CDN 配置

- **R2 Bucket**: `cdn.maskmysheet.com`
- **主题目录**: `RAZ/` (大写)
- **资源目录**: `assets/`
- **缓存策略**: 不可变缓存（需要版本参数破坏缓存）

### 路径约定

#### 主题资源路径

```
RAZ/
├── AA/              # 级别 A-A
│   ├── Theme1/
│   │   ├── icon.webp
│   │   ├── cover.webp
│   │   ├── image1.webp
│   │   └── audio1.mp3
│   └── Theme2/
├── BB/              # 级别 B-B
└── themes-list.json
```

#### 游戏资源路径

```
assets/
├── kenney/
│   ├── Sprites/
│   ├── Sounds/
│   └── Vector/
├── fonts/
│   ├── Fredoka/
│   └── Zcool/
└── mediapipe/
    └── pose/
```

### 缓存破坏策略

- **版本参数**: `?v=20260218_fix3`
- **更新频率**: 每次 R2 部署后更新版本号
- **格式**: `v=YYYYMMDD_fixN`

## 数据模型

无复杂数据模型，仅使用字符串路径和 URL。

## 测试与质量

### 测试策略

- 暂无单元测试
- 通过集成测试验证 URL 生成逻辑
- 在 `gameConfig.ts` 和 `assetLoader.ts` 中实际使用

### 质量保障

- TypeScript 类型安全（所有函数显式返回类型）
- JSDoc 注释完整
- 边界情况处理（URL 解析、路径清理）

## 常见问题 (FAQ)

### Q: 为什么主题路径需要添加 `RAZ/` 前缀?

A: R2 Bucket 的目录结构要求主题资源放在 `RAZ/` 目录下，且级别必须大写（如 `AA/`, `BB/`）。代码会自动转换路径格式。

### Q: 如何切换本地开发和 CDN 模式?

A: 使用不同的函数:
- **开发模式**: `getLocalAssetUrl()` - 使用本地 `public/` 目录
- **生产模式**: `getR2AssetUrl()` - 使用 CDN
- **主题列表**: `getThemesListPrimaryUrl()` 本地优先，失败后自动使用 `getThemesListFallbackUrl()`

### Q: 缓存版本号何时更新?

A: 每次部署 R2 资源后，需要手动更新 `ASSET_VERSION` 常量:
```typescript
const ASSET_VERSION = 'v=20260218_fix4'; // 更新版本号
```

### Q: 如何处理 CDN 加载失败?

A: 调用 `handleR2Error(error, context)` 会抛出用户友好的错误消息，建议在 UI 层捕获并显示:
```typescript
try {
  await loadThemes();
} catch (error) {
  alert(error.message); // "网络连接失败，请检查网络设置"
}
```

## 相关文件清单

### 核心文件

- `r2Config.ts` (89 行) - R2 CDN 配置和 URL 工具

### 依赖此模块的文件

- `gameConfig.ts` - 主题加载和资源预加载
- `services/assetLoader.ts` - 游戏资源加载
- `App.tsx` - 主题图片路径生成

## 变更记录 (Changelog)

### 2026-03-29 - 初始化架构师扫描

- 创建模块文档
- 识别 1 个配置文件
- 文档化 URL 生成函数和路径约定
- 记录缓存破坏策略
