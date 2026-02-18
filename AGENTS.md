# AGENTS.md - AI Coding Agent Instructions

## Project Overview
React + TypeScript motion-controlled educational game using Phaser 3 and MediaPipe Pose.
- **Framework**: React 18.3.1 with Vite 6.2.0
- **Game Engine**: Phaser 3.80.0 (Arcade physics)
- **Motion Detection**: MediaPipe Pose (Lite model, modelComplexity: 0)
- **Language**: TypeScript 5.8.2 (ES2022 target)
- **Animation**: Framer Motion 12.23.26
- **PWA**: vite-plugin-pwa with Service Worker
- **CDN**: R2 Cloudflare CDN for all assets
- **Fonts**: Fredoka (English) + ZCOOL KuaiLe (Chinese)

## Build Commands

```bash
# Development
npm run dev          # Start dev server on port 3000 (HTTPS enabled)

# Production
npm run build        # Build for production (outputs to dist/)
npm run preview      # Preview production build locally

# Post-install
npm run postinstall  # No-op (MediaPipe loaded from CDN)
```

**No testing framework is configured**. The project does not have test files or test commands.

## Code Style Guidelines

### TypeScript & Type Safety
**STRICT TYPING REQUIRED**:
- Use explicit types for function parameters and return values
- Define interfaces for all data structures
- Use `const` for primitives, `let` only when reassignment needed
- Type assertions with `as any` or `@ts-ignore` are DISALLOWED except for external libraries with incomplete types
- **Phaser Compatibility**: `useDefineForClassFields: false` and `experimentalDecorators: true` in tsconfig.json

### Imports & File Organization
**Import Order**: External libraries → Internal imports → Type imports
```typescript
import React, { useEffect, useState } from 'react';
import Phaser from 'phaser';
import { GameCanvas } from './components/GameCanvas';
import { ThemeId, GamePhase } from './types';
```

**Path Aliases**:
- `@/` = Root directory
- `/assets` = `./public/assets`

### Naming Conventions
- **Components**: PascalCase (e.g., `GameCanvas`, `CompletionOverlay`)
- **Functions/Methods**: camelCase (e.g., `handleScoreUpdate`, `initializeGame`)
- **Classes**: PascalCase (e.g., `MotionController`, `MainScene`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_CONCURRENT_DOWNLOADS`, `FRAME_MIN_TIME`)
- **Interfaces/Types**: PascalCase (e.g., `MotionState`, `Theme`)
- **Enum Values**: UPPER_SNAKE_CASE (e.g., `GamePhase.PLAYING`)

### React Patterns
```typescript
export const GameCanvas: React.FC<GameCanvasProps> = ({ onScoreUpdate, onGameOver, themes }) => {
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    // initialization
    return () => {
      game.destroy(true); // ALWAYS clean up Phaser games
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
};
```

### Error Handling
**Never use empty catch blocks**. Always log or handle errors appropriately.
```typescript
try {
  await motionController.start(videoRef.current!);
} catch (error) {
  console.error('Motion controller start failed:', error);
  alert('Failed to start motion detection. Please refresh and try again.');
}
```

## Key Patterns

### Motion Detection (MediaPipe Pose)
- Uses **Pose Lite model** (`modelComplexity: 0`) for lightweight inference
- Detects 33 body landmarks including nose, shoulders, hips
- Uses shoulder center for horizontal movement detection
- Uses body vertical velocity for jump detection
- **Coordinates**: Normalized 0-1, X-axis mirrored in code (`1 - rawX`)
- **Horizontal threshold**: Dynamic based on shoulder width (~0.12 from center)
- **Jump detection**: Velocity-based with adaptive thresholds, 800ms cooldown
- **Visibility/Presence**: Landmarks filtered when visibility < 0.35 or presence < 0.35
- **Multi-CDN fallback**: jsdelivr → unpkg → R2 custom CDN

### Phaser Scene
```typescript
export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data: { theme: ThemeId; dpr?: number }) {
    const callbacks = this.registry.get('callbacks') || {};
  }

  preload(): void { /* load assets */ }
  create(): void { /* setup game objects */ }
  update(time: number, delta: number): void { /* game loop */ }
}
```

### Asset Loading
- Use `preloadAllGameAssets()` from `services/assetLoader.ts` for centralized loading
- Batch loading with `preloadThemeImages()` (BATCH_SIZE = 4)
- Background preloading queue (MAX_CONCURRENT_DOWNLOADS = 6)
- Retry logic: 1 retry with 15s timeout
- **Audio blob caching**: In-memory blob URLs for theme audios (max 48 entries)

### R2 CDN Functions
```typescript
import { getR2ImageUrl, getR2AssetUrl } from './src/config/r2Config';
const imageUrl = getR2ImageUrl('theme_id/image.webp');
const assetUrl = getR2AssetUrl('assets/kenney/Vector/Characters/character.svg');
```

### Logger Service
Centralized logging for bug reports:
```typescript
import { loggerService } from './services/logger';

// Initialize at app startup
loggerService.init();

// Get formatted logs for bug reports
const logs = loggerService.getFormattedLogs();
```

### Bug Report Feature
- `BugReportButton` component captures recent logs as PNG image
- Uses Web Share API for mobile sharing, falls back to clipboard/download
- Stores last 500 log entries with timestamps

## Device Detection
```typescript
const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobilePhone = /iPhone|Android|Mobile/i.test(navigator.userAgent) && !/iPad|Tablet/i.test(navigator.userAgent);
```

## Critical Implementation Notes

1. **Never suppress type errors** - Define proper types or use `unknown` with type guards

2. **Always clean up resources**:
   - Phaser games: `game.destroy(true)`
   - Camera streams: `stream.getTracks().forEach(t => t.stop())`
   - Event listeners: Remove in useEffect cleanup
   - Audio blob URLs: `URL.revokeObjectURL()` when evicting from cache

3. **Mobile-First Camera**:
   - Set `videoElement.muted = true` and `playsInline` for iOS
   - Use device-specific constraints (iPad: 1280x720, Mobile: 640x480)
   - Adaptive constraint profiles for iOS / Android / HarmonyOS / desktop

4. **PWA**: Service worker auto-registered, CDN assets cached for 1 year
   - MediaPipe files cached in `mediapipe-cdn-cache-v2`
   - Theme images cached in `raz-cdn-cache-v4`
   - Game assets cached in `game-assets-cdn-cache-v2`

5. **Debugging**: 
   - Eruda available in dev mode
   - Force debug via `?debug=true` URL parameter
   - Use tagged console logs: `[INIT]`, `[START]`, `[JUMP]`, `[Font]`, `[Audio]`

6. **Logging**:
   ```typescript
   const LOG_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
   const CURRENT_LOG_LEVEL = import.meta.prod ? LOG_LEVEL.WARN : LOG_LEVEL.INFO;
   ```

7. **Fonts**:
   - `FredokaBoot`: Primary English font (400, 700, 900 weights)
   - `ZCOOL KuaiLe`: Chinese font (400 weight)
   - Font preload in `index.html` with fallback to CDN

8. **Audio Autoplay Policy**:
   - Call `window.ensureAudioUnlocked()` before audio playback
   - Uses capture-phase listeners to ensure unlock works even with `stopPropagation()`

## Key Files Structure
```
├── components/           # React UI components
│   ├── BugReportButton.tsx   # Bug report with log capture
│   ├── CameraGuide.tsx       # Camera permission guide
│   ├── CompletionOverlay.tsx # Game completion/reward screen
│   ├── GameCanvas.tsx        # Phaser game container
│   └── LoadingScreen.tsx     # Loading progress UI
├── game/scenes/          # Phaser scenes
│   ├── MainScene.ts          # Main gameplay scene
│   └── PreloadScene.ts       # Asset preloading scene
├── services/             # Core services
│   ├── assetLoader.ts        # Asset loading & caching
│   ├── logger.ts             # Log capture for bug reports
│   └── motionController.ts   # MediaPipe Pose integration
├── src/config/           # Configuration
│   └── r2Config.ts            # R2 CDN URL helpers
├── types.ts              # TypeScript interfaces & enums
├── gameConfig.ts         # Game state, theme loading
├── App.tsx               # Main app component
├── index.tsx             # React entry & PWA registration
└── index.html            # HTML entry with MediaPipe loader
```

## Reward Voice System
- Voice files: `perfect.mp3`, `super.mp3`, `great.mp3`, `amazing.mp3`, `awesome.mp3`, `excellent.mp3`
- Preloaded in `PreloadScene` with blob URL optimization
- Playback via Phaser sound pipeline with HTMLAudio fallback

## Recent Major Changes
1. **Motion Detection Migration**: Switched from Face Detection to Pose detection for better accuracy
2. **Bug Report Feature**: Added log capture and PNG export for debugging
3. **Audio Optimization**: Blob URL caching for reduced latency
4. **Camera Resilience**: Multi-attempt fallback for `getUserMedia` constraints
5. **Completion Polish**: Star timing, voice synchronization, and one-shot playback guard