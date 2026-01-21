# AGENTS.md - AI Coding Agent Instructions

## Project Overview
React + TypeScript game using Phaser 3 and MediaPipe Pose for motion-controlled gameplay.
- **Framework**: React 18.3.1 with Vite
- **Game Engine**: Phaser 3.80.0 (Arcade physics)
- **Motion Detection**: MediaPipe Pose
- **Language**: TypeScript 5.8.2 (ES2022 target)
- **Build Tool**: Vite 6.2.0

## Build Commands

```bash
# Development
npm run dev          # Start dev server on port 3000, host 0.0.0.0

# Production
npm run build        # Build for production (outputs to dist/)
npm run preview      # Preview production build locally
```

**No testing framework is configured**. The project does not have any test files or test commands.

## Code Style Guidelines

### TypeScript & Type Safety

**STRICT TYPING REQUIRED**:
- Use explicit types for function parameters and return values
- Define interfaces for all data structures
- Use `const` for primitives that won't change, `let` only when reassignment needed
- Type assertions with `as any` or `@ts-ignore` are DISALLOWED except when working with external libraries with incomplete types

```typescript
// ✅ GOOD
interface GameConfig {
  width: number;
  height: number;
  themes: ThemeId[];
}

function initializeGame(config: GameConfig): Phaser.Game {
  // implementation
}

// ❌ BAD - Missing types
function initializeGame(config) {
  // implementation
}
```

### Imports & File Organization

**Import Order**:
1. External libraries (React, Phaser, etc.)
2. Internal imports (components, services, types)
3. Type imports (if separate)

```typescript
// ✅ GOOD
import React, { useEffect, useState } from 'react';
import Phaser from 'phaser';
import { GameCanvas } from './components/GameCanvas';
import { ThemeId, GamePhase } from './types';
```

**Path Aliases**:
- `@/` = Root directory
- `/asserts` = `./public/asserts`
- `/kenney` = `./public/asserts/kenney`

```typescript
import { motionController } from '@/services/motionController';
import { loadThemes } from '@/gameConfig';
```

### Naming Conventions

- **Components**: PascalCase (e.g., `GameCanvas`, `CompletionOverlay`)
- **Functions/Methods**: camelCase (e.g., `handleScoreUpdate`, `initializeGame`)
- **Classes**: PascalCase (e.g., `MotionController`, `AdaptiveCalibrator`)
- **Constants**: UPPER_SNAKE_CASE for true constants (e.g., `MAX_CONCURRENT_DOWNLOADS`)
  - camelCase for config/calibration values that may be adjusted (e.g., `xThreshold`, `currentNoseX`)
- **Interfaces/Types**: PascalCase (e.g., `MotionState`, `Theme`)
- **Enum Values**: UPPER_SNAKE_CASE (e.g., `GamePhase.PLAYING`, `GamePhase.MENU`)

### React Patterns

**Functional Components with Hooks**:
```typescript
export const GameCanvas: React.FC<GameCanvasProps> = ({
  onScoreUpdate,
  onGameOver,
  themes
}) => {
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    // initialization
    return () => {
      // cleanup - ALWAYS clean up Phaser games
      game.destroy(true);
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
};
```

**Critical**: Always clean up Phaser games in useEffect cleanup with `game.destroy(true)`.

### Phaser Scene Patterns

**Scene Classes**:
```typescript
export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private score: number = 0;

  constructor() {
    super({ key: 'MainScene' });
  }

  preload(): void {
    this.load.image('player', '/asserts/kenney/player.png');
  }

  create(): void {
    const callbacks = this.registry.get('callbacks');
    // implementation
  }

  update(time: number, delta: number): void {
    // game loop - called every frame
  }
}
```

### Error Handling

**Never use empty catch blocks**. Always log or handle errors appropriately.

```typescript
// ✅ GOOD
try {
  await motionController.start(videoRef.current!);
  console.log('Motion controller started');
} catch (error) {
  console.error('Motion controller start failed:', error);
  alert('Failed to start motion detection. Please refresh and try again.');
  setPhase(GamePhase.MENU);
}

// ❌ BAD
try {
  await motionController.start(videoRef.current!);
} catch (e) {
  // Silent failure
}
```

**Device-Specific Error Handling**:
The app has special handling for iPad/iOS. Check for device type when appropriate:

```typescript
const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;

if (isIPad) {
  // Apply iPad-specific workarounds (memory constraints, camera constraints)
}
```

### Performance Guidelines

**MediaPipe & Motion Detection**:
- Target 30 FPS for pose detection (controlled by `FRAME_MIN_TIME = 1000 / 30`)
- Use visibility thresholds (0.4) for landmark confidence
- Smooth values with exponential moving average (e.g., `NOSE_SMOOTHING = 0.8`)
- Handle tracking loss gracefully with gradual state reset

**Phaser Performance**:
- Use `powerPreference: 'high-performance'` for rendering
- Enable antialias for smooth visuals
- Cap devicePixelRatio at 2 for performance
- Use object pooling for frequently created/destroyed game objects

**React Performance**:
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Avoid inline functions in render props

### Asset Management

**R2 CDN Integration**:
- Theme images served from R2 CDN (configured in `src/config/r2Config.ts`)
- Use `.webp` format when possible for better compression
- Implement preloading queue for background image loading

**Asset Paths**:
```
/asserts/kenney/Vector/Characters/
/asserts/kenney/Vector/Backgrounds/
/asserts/Fredoka/
```

**Preloading**:
- High-priority images for current theme loaded immediately
- Background preloading queue for remaining themes (MAX_CONCURRENT_DOWNLOADS = 6)
- Use `prioritizeThemeInQueue()` to push theme images to front of queue

### Camera & Permissions

**Camera Initialization**:
```typescript
// Request camera with device-specific constraints
const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
const videoConstraints: any = {
  facingMode: 'user',
  width: { ideal: isIPad ? 1280 : 640 },
  height: { ideal: isIPad ? 720 : 480 },
  frameRate: { ideal: 30 }
};

const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
```

**Critical**: Always set `videoElement.muted = true` and `playsInline` for iOS compatibility.

### CSS & Styling

**Tailwind CSS** for utility classes.
**Custom CSS** in `App.tsx` `<style>` blocks for:
- Font loading (Fredoka font family)
- Game-specific animations
- Responsive breakpoints
- Kenney-themed styles (`.kenney-panel`, `.kenney-button`, etc.)

**Common Classes**:
- `.kenney-panel` - Kenney-style panel with borders and shadows
- `.kenney-button-circle` - Circular buttons for actions
- `.scrollbar-hide` - Hide scrollbars for cleaner UI

### Global State & Registry

**Phaser Registry** for passing callbacks to scenes:
```typescript
game.registry.set('callbacks', {
  onScoreUpdate,
  onGameOver,
  onQuestionUpdate
});
```

**Exported Singletons**:
```typescript
export const motionController = new MotionController();
```

### Mobile & Responsive Design

**Landscape Orientation Required**:
- Show portrait warning overlay (`isPortrait` state)
- Lock orientation to landscape when entering game
- Use `@media (orientation: landscape)` queries for layout

**Viewport Units**:
- Use `dvh` (dynamic viewport height) for mobile browsers
- Mix `vw`/`vh` with pixel fallbacks for cross-device compatibility

### Debugging

**Development Tools**:
- Eruda mobile console available in dev mode (`import.meta.env.DEV`)
- Service Worker logs for PWA caching
- Console logs with tags: `[INIT]`, `[START]`, `[CALIB]`, `[FPS]`

**Logging Levels**:
```typescript
const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
```

### Key Files Structure

```
├── components/          # React UI components
│   ├── GameCanvas.tsx  # Phaser game container
│   ├── CompletionOverlay.tsx
│   └── GameBackground.tsx
├── game/
│   └── scenes/        # Phaser scenes
│       ├── MainScene.ts
│       └── PreloadScene.ts
├── services/
│   └── motionController.ts  # MediaPipe integration
├── src/
│   └── config/
│       └── r2Config.ts      # CDN configuration
├── types.ts           # TypeScript interfaces & enums
├── gameConfig.ts      # Game state & theme loading
├── App.tsx            # Main app component
└── index.tsx          # React entry point
```

### Critical Implementation Notes

1. **Never suppress type errors** with `as any` or `@ts-ignore`. If types are incomplete, define them properly or use `unknown` with type guards.

2. **Always clean up resources**:
   - Phaser games: `game.destroy(true)`
   - Camera streams: `stream.getTracks().forEach(t => t.stop())`
   - Event listeners: Remove in useEffect cleanup
   - RequestAnimationFrame: Cancel with `cancelAnimationFrame()`

3. **Mobile-First Camera Handling**:
   - Test on real devices, not just emulators
   - Handle permission denials gracefully
   - Provide clear error messages for users

4. **PWA Configuration**:
   - Service worker auto-registration in `index.tsx`
   - CDN caching for R2 assets (1-year cache)
   - Offline-ready for core assets

5. **Environment Variables**:
   - `GEMINI_API_KEY` - Required for AI features
   - Set in `.env.local` for development
   - Defined via Vite's `define` in `vite.config.ts`
