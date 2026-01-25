# AGENTS.md - AI Coding Agent Instructions

## Project Overview
React + TypeScript motion-controlled educational game using Phaser 3 and MediaPipe Pose.
- **Framework**: React 18.3.1 with Vite
- **Game Engine**: Phaser 3.80.0 (Arcade physics)
- **Motion Detection**: MediaPipe Pose
- **Language**: TypeScript 5.8.2 (ES2022 target)
- **Build Tool**: Vite 6.2.0
- **Animation**: Framer Motion 12.23.26
- **PWA**: vite-plugin-pwa 1.2.0 with Service Worker
- **CDN**: R2 Cloudflare CDN for all assets (themes, game assets, fonts, audio)
- **Debugging**: Eruda for mobile debugging
- **SSL**: @vitejs/plugin-basic-ssl for HTTPS support

## Build Commands

```bash
# Development
npm run dev          # Start dev server on port 3000, host 0.0.0.0

# Production
npm run build        # Build for production (outputs to dist/)
npm run preview      # Preview production build locally

# Post-install (automatic)
npm run postinstall  # Copies MediaPipe files to public/mediapipe/
```

**No testing framework is configured**. The project does not have any test files or test commands.

## Code Style Guidelines

### TypeScript & Type Safety

**STRICT TYPING REQUIRED**:
- Use explicit types for function parameters and return values
- Define interfaces for all data structures
- Use `const` for primitives that won't change, `let` only when reassignment needed
- Type assertions with `as any` or `@ts-ignore` are DISALLOWED except when working with external libraries with incomplete types
- **Phaser Compatibility**: `useDefineForClassFields: false` and `experimentalDecorators: true` are required for Phaser

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
- `@/` = Root directory (`./src/`)
- `/assets` = `./public/assets`
- `/kenney` = `./public/assets/kenney`

```typescript
import { motionController } from '@/services/motionController';
import { loadThemes } from '@/gameConfig';
import { getR2ImageUrl, getR2AssetUrl } from '@/src/config/r2Config';
```

### Naming Conventions

- **Components**: PascalCase (e.g., `GameCanvas`, `CompletionOverlay`, `CameraGuide`)
- **Functions/Methods**: camelCase (e.g., `handleScoreUpdate`, `initializeGame`, `preloadThemeImages`)
- **Classes**: PascalCase (e.g., `MotionController`, `AdaptiveCalibrator`, `MainScene`)
- **Constants**: UPPER_SNAKE_CASE for true constants (e.g., `MAX_CONCURRENT_DOWNLOADS`, `FRAME_MIN_TIME`)
  - camelCase for config/calibration values that may be adjusted (e.g., `xThreshold`, `currentNoseX`)
- **Interfaces/Types**: PascalCase (e.g., `MotionState`, `Theme`, `ThemeQuestion`)
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

**Framer Motion for Animations**:
```typescript
import { motion } from 'framer-motion';

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.5 }}
>
  Content
</motion.div>
```

### Phaser Scene Patterns

**Scene Classes**:
```typescript
export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private score: number = 0;

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data: { theme: ThemeId; dpr?: number }) {
    // Initialize with registry data
    const callbacks = this.registry.get('callbacks') || {};
    this.onScoreUpdate = callbacks.onScoreUpdate || null;
  }

  preload(): void {
    this.load.image('player', '/assets/kenney/player.png');
  }

  create(): void {
    // Setup game objects, physics, events
    const callbacks = this.registry.get('callbacks');
    // implementation
  }

  update(time: number, delta: number): void {
    // Game loop - called every frame
  }
}
```

**Phaser Configuration**:
```typescript
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  backgroundColor: 'transparent',
  transparent: true,
  resolution: Math.min(window.devicePixelRatio, 2),
  render: {
    antialias: true,
    powerPreference: 'high-performance'
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [PreloadScene, MainScene]
};
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
The app has special handling for iPad/iOS and Android. Check for device type when appropriate:

```typescript
const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobilePhone = /iPhone|Android|Mobile/i.test(navigator.userAgent) && !/iPad|Tablet/i.test(navigator.userAgent);

if (isIPad) {
  // Apply iPad-specific workarounds (memory constraints, camera constraints)
}

if (isAndroid) {
  // Apply Android-specific optimizations
}
```

### Performance Guidelines

**MediaPipe & Motion Detection**:
- Target 30 FPS for pose detection (controlled by `FRAME_MIN_TIME = 1000 / 30`)
- Use visibility thresholds (0.4) for landmark confidence
- Smooth values with exponential moving average (e.g., `NOSE_SMOOTHING = 0.8`)
- Handle tracking loss gracefully with gradual state reset
- Use adaptive calibration system (`AdaptiveCalibrator` class) for jump detection

**Phaser Performance**:
- Use `powerPreference: 'high-performance'` for rendering
- Enable antialias for smooth visuals
- Cap devicePixelRatio at 2 for performance
- Use object pooling for frequently created/destroyed game objects
- Use code splitting for large bundles (phaser, react-vendor)

**React Performance**:
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Avoid inline functions in render props
- Use Framer Motion for smooth animations

**Asset Preloading**:
- Background preloading queue for remaining themes (MAX_CONCURRENT_DOWNLOADS = 6)
- Batch loading with `preloadThemeImages()` for immediate needs
- Use `prioritizeThemeInQueue()` to push theme images to front of queue
- Implement retry logic for failed loads (1 retry, 15s timeout)

### Asset Management

**CDN-Only Architecture**:
- All assets served from R2 Cloudflare CDN
- No local asset files in repository (except MediaPipe backup)
- Base URL: `https://cdn.maskmysheet.com`

**R2 CDN Functions** (in `src/config/r2Config.ts`):
```typescript
import { getR2ImageUrl, getR2AssetUrl, getR2ThemesListUrl, handleR2Error } from '@/src/config/r2Config';

// Theme images (with raz_aa prefix)
const imageUrl = getR2ImageUrl('theme_id/image.webp');
// → https://cdn.maskmysheet.com/raz_aa/theme_id/image.webp

// Game assets (without raz_aa prefix)
const assetUrl = getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_idle.svg');
// → https://cdn.maskmysheet.com/assets/kenney/Vector/Characters/character_pink_idle.svg

// Themes list (via Vite proxy)
const themesUrl = getR2ThemesListUrl();
// → /themes/themes-list.json (proxied to R2 CDN)

// Handle R2 errors
try {
  // R2 operation
} catch (error) {
  handleR2Error(error, 'Failed to load theme');
}
```

**Asset Path Mapping**:
```
CDN URL Structure:
├── raz_aa/                    # Theme images
│   ├── {theme_id}/
│   │   ├── image1.webp
│   │   └── image2.webp
└── assets/                    # Game assets
    ├── Fredoka/
    │   └── static/
    │       └── Fredoka-Bold.ttf
    └── kenney/
        ├── Sounds/
        │   ├── sfx_jump-high.mp3
        │   ├── sfx_coin.mp3
        │   ├── sfx_disappear.mp3
        │   ├── sfx_bump.mp3
        │   └── funny-kids-video-322163.mp3 (BGM)
        ├── Vector/
        │   ├── Characters/
        │   │   ├── character_pink_idle.svg
        │   │   ├── character_pink_jump.svg
        │   │   └── character_pink_walk_a.svg
        │   ├── Enemies/
        │   │   ├── bee_a.svg
        │   │   └── bee_b.svg
        │   ├── Tiles/
        │   │   ├── block_empty.svg
        │   │   ├── star.svg
        │   │   └── gem_blue.svg
        │   └── Backgrounds/
        │       ├── background_color_hills.svg
        │       └── background_clouds.svg
```

**Path Auto-Correction**:
The `getR2AssetUrl()` function automatically corrects legacy paths:
```typescript
getR2AssetUrl('asserts/kenney/...')  // Auto-corrected to 'assets/kenney/...'
getR2AssetUrl('/assets/kenney/...') // Leading slash removed
```

**Preloading Strategy**:
```typescript
// High-priority images for current theme
await preloadThemeImages(themeId);

// Background preloading queue for remaining themes
startBackgroundPreloading(themes);

// Prioritize a specific theme
prioritizeThemeInQueue(themeId);
```

**Image Loading with Retry**:
```typescript
const loadWithRetry = (retriesLeft: number): Promise<void> => {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    const timeout = setTimeout(() => {
      if (retriesLeft > 0) {
        resolve(loadWithRetry(retriesLeft - 1));
      } else {
        resolve();
      }
    }, 15000); // 15s timeout
    
    img.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    
    img.onerror = (e) => {
      clearTimeout(timeout);
      if (retriesLeft > 0) {
        setTimeout(() => {
          resolve(loadWithRetry(retriesLeft - 1));
        }, 500);
      } else {
        resolve();
      }
    };
    
    img.src = imgUrl;
  });
};
```

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

**Camera Guide Component**:
Use `CameraGuide.tsx` to help users position themselves correctly:
```typescript
<CameraGuide
  isActive={phase === GamePhase.CALIBRATING}
  onPositionValid={(isValid) => {
    // Handle position validation
  }}
/>
```

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

**Viewport Units**:
- Use `dvh` (dynamic viewport height) for mobile browsers
- Mix `vw`/`vh` with pixel fallbacks for cross-device compatibility

### Global State & Registry

**Phaser Registry** for passing callbacks to scenes:
```typescript
game.registry.set('callbacks', {
  onScoreUpdate,
  onGameOver,
  onGameRestart,
  onQuestionUpdate,
  onBackgroundUpdate
});
game.registry.set('initialThemes', themes);
game.registry.set('dpr', window.devicePixelRatio || 1);
```

**Exported Singletons**:
```typescript
export const motionController = new MotionController();
```

### PWA Configuration

**Service Worker**:
- Auto-registration in `index.tsx` using `virtual:pwa-register`
- Auto-update mode for seamless updates
- Offline-ready for core assets
- CDN caching with 1-year cache duration

**PWA Features**:
```typescript
// index.tsx
import { registerSW } from 'virtual:pwa-register';

registerSW({
  onNeedRefresh() {
    console.log('New content available, auto-updating...');
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
});
```

**Workbox Configuration** (in vite.config.ts):
- Runtime caching for R2 CDN assets
- Cache-first strategy for CDN
- 1-year cache duration for theme assets
- Maximum file size: 10MB
- Ignores unused assets (Sprites, backup folders)

### Mobile & Responsive Design

**Landscape Orientation Required**:
- Show portrait warning overlay (`isPortrait` state)
- Lock orientation to landscape when entering game
- Use `@media (orientation: landscape)` queries for layout

**Device Detection**:
```typescript
const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobilePhone = /iPhone|Android|Mobile/i.test(navigator.userAgent) && !/iPad|Tablet/i.test(navigator.userAgent);
const isTablet = window.innerWidth >= 768;
```

**Fullscreen Handling**:
```typescript
useEffect(() => {
  const handleFullscreenChange = () => {
    const doc = document as any;
    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || 
                      doc.mozFullScreenElement || doc.msFullscreenElement);
    setIsFullscreen(isFull);
  };
  
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);
  
  return () => {
    // Cleanup event listeners
  };
}, []);
```

### Debugging

**Development Tools**:
- Eruda mobile console available in dev mode (`import.meta.env.DEV`)
- Service Worker logs for PWA caching
- Console logs with tags: `[INIT]`, `[START]`, `[CALIB]`, `[FPS]`, `[THRESH]`, `[TRACK]`
- Debug mode can be forced via URL parameter: `?debug=true`

**Logging Levels**:
```typescript
const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
const CURRENT_LOG_LEVEL = (import.meta as { prod?: boolean }).prod ? LOG_LEVEL.WARN : LOG_LEVEL.INFO;
```

### Audio System

**Background Music (BGM)**:
```typescript
// Global BGM volume control
declare global {
  interface Window {
    setBGMVolume?: (vol: number) => void;
  }
}

// Adjust BGM volume based on game phase
if (newPhase === GamePhase.PLAYING) {
  window.setBGMVolume?.(0.2);
} else {
  window.setBGMVolume?.(0.3);
}
```

**Sound Effects** (in Phaser scenes):
- Jump sound
- Success sound
- Failure sound
- Bump sound

### Motion Detection System

**MotionController Singleton**:
```typescript
export const motionController = new MotionController();

// Initialize
await motionController.init();

// Start detection
await motionController.start(videoElement);

// Stop detection
motionController.stop();

// Calibrate
motionController.calibrate();

// Get state
const state = motionController.state; // MotionState
```

**MotionState Interface**:
```typescript
interface MotionState {
  x: number;           // -1 (left), 0 (center), 1 (right)
  bodyX: number;       // 0..1, mirrored to match Live View
  isJumping: boolean;
  rawNoseX: number;
  rawNoseY: number;
  rawShoulderY: number;
}
```

**Adaptive Calibration**:
- Automatic jump threshold calibration based on user's actual jump height
- Collects up to 5 jump samples during calibration phase
- Gradually adjusts threshold based on average jump displacement

**Device-Specific Thresholds**:
- iPad: Higher thresholds due to camera distance
- Mobile phone: Lower thresholds for easier control
- Desktop/Tablet: Balanced thresholds

### Theme System

**Theme Structure**:
```typescript
interface Theme {
  id: string;
  name: string;
  icon: string;
  questions: ThemeQuestion[];
  isAvailable?: boolean;
}

interface ThemeQuestion {
  question: string;
  image: string;
}
```

**Theme Loading**:
```typescript
import { loadThemes, preloadThemeImages, getThemeImagePath } from './gameConfig';

// Load all themes
const themes = await loadThemes();

// Preload images for a specific theme
await preloadThemeImages(themeId);

// Get image path
const imagePath = getThemeImagePath(themeId, imageName);
```

**Background Preloading**:
```typescript
import { startBackgroundPreloading, prioritizeThemeInQueue } from './gameConfig';

// Start background preloading
startBackgroundPreloading(themes);

// Prioritize a theme when user selects it
prioritizeThemeInQueue(themeId);
```

### Vite Configuration

**Path Aliases**:
```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '/assets': path.resolve(__dirname, './public/assets'),
    '/kenney': path.resolve(__dirname, './public/assets/kenney'),
  }
}
```

**CDN Proxy**:
```typescript
proxy: {
  '/cdn-proxy': {
    target: env.VITE_R2_BASE_URL || 'https://cdn.maskmysheet.com/raz_aa',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/cdn-proxy/, ''),
  },
}
```

**Code Splitting**:
```typescript
rollupOptions: {
  output: {
    manualChunks: {
      'phaser': ['phaser'],
      'react-vendor': ['react', 'react-dom', 'framer-motion'],
    }
  }
}
```

### Game Phases

**GamePhase Enum**:
```typescript
enum GamePhase {
  MENU = 'MENU',                    // Main menu
  THEME_SELECTION = 'THEME_SELECTION', // Theme selection screen
  LOADING_AI = 'LOADING_AI',        // Loading AI resources
  CALIBRATING = 'CALIBRATING',      // Motion calibration
  TUTORIAL = 'TUTORIAL',            // Tutorial mode
  PLAYING = 'PLAYING',              // Active gameplay
  GAME_OVER = 'GAME_OVER'           // Game over screen
}
```

**Phase Transitions**:
```typescript
const setPhase = (newPhase: GamePhase) => {
  phaseRef.current = newPhase;
  setPhaseState(newPhase);
  
  // Phase-specific logic
  if (newPhase === GamePhase.PLAYING) {
    window.setBGMVolume?.(0.2);
  } else {
    window.setBGMVolume?.(0.3);
  }
  
  // Exit fullscreen when entering MENU or THEME_SELECTION
  if (newPhase === GamePhase.MENU || newPhase === GamePhase.THEME_SELECTION) {
    // Fullscreen exit logic
  }
};
```

### MediaPipe Integration

**Multi-CDN Fallback** (in `index.html`):
```javascript
const CDNS = [
  'https://npm.elemecdn.com/@mediapipe/pose@0.5.1675469404/',      // 国内镜像 1
  'https://unpkg.zhimg.com/@mediapipe/pose@0.5.1675469404/',      // 国内镜像 2
  '/mediapipe/',                                                   // 本地回退
  'https://fastly.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/', // jsDelivr
  'https://unpkg.com/@mediapipe/pose@0.5.1675469404/',            // unpkg
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/',  // jsDelivr
  'https://cdnjs.cloudflare.com/ajax/libs/mediapipe/0.5.1675469404/' // cdnjs
];
```

**Postinstall Script**:
```bash
# Automatically runs after npm install
mkdir -p public/mediapipe && \
cp -r node_modules/@mediapipe/pose/* public/mediapipe/ && \
cp node_modules/@mediapipe/camera_utils/camera_utils.js public/mediapipe/
```

**Loading Process**:
1. Try CDNs in order with 5s timeout
2. Successfully loaded CDN is saved to `window.__MEDIAPIPE_CDN__`
3. MediaPipe uses this CDN for loading WASM files
4. On failure, automatically try next CDN

### Key Files Structure

```
├── components/                    # React UI components
│   ├── CameraGuide.tsx           # Camera position guide
│   ├── CompletionOverlay.tsx     # Game completion overlay
│   ├── GameBackground.tsx        # Dynamic background component
│   └── GameCanvas.tsx            # Phaser game container
├── game/
│   └── scenes/                   # Phaser scenes
│       ├── MainScene.ts          # Main gameplay scene
│       └── PreloadScene.ts       # Asset preloading scene
├── services/
│   └── motionController.ts       # MediaPipe integration & motion detection
├── src/
│   └── config/
│       └── r2Config.ts           # R2 CDN configuration
├── types.ts                      # TypeScript interfaces & enums
├── gameConfig.ts                 # Game state, theme loading, preloading
├── App.tsx                       # Main app component
├── index.tsx                     # React entry point & PWA registration
├── index.html                    # HTML entry point with MediaPipe CDN loader
├── vite.config.ts                # Vite configuration (PWA, SSL, proxy, aliases)
└── tsconfig.json                 # TypeScript configuration
```

### .gitignore

**Ignored Directories**:
```
# Local asset backups (not committed)
public/assets/
public/mediapipe/

# Theme cache
public/themes/
```

### Critical Implementation Notes

1. **Never suppress type errors** with `as any` or `@ts-ignore`. If types are incomplete, define them properly or use `unknown` with type guards.

2. **Always clean up resources**:
   - Phaser games: `game.destroy(true)`
   - Camera streams: `stream.getTracks().forEach(t => t.stop())`
   - Event listeners: Remove in useEffect cleanup
   - RequestAnimationFrame: Cancel with `cancelAnimationFrame()`
   - MotionController: Call `stop()` when done

3. **CDN-Only Architecture**:
   - All assets loaded from R2 Cloudflare CDN
   - No local asset files in repository
   - MediaPipe files copied via postinstall script
   - Use `getR2AssetUrl()` and `getR2ImageUrl()` for all asset URLs
   - Path auto-correction: `asserts/` → `assets/`

4. **Mobile-First Camera Handling**:
   - Test on real devices, not just emulators
   - Handle permission denials gracefully
   - Provide clear error messages for users
   - Use device-specific constraints (iPad, Android, Mobile phone)
   - Set `muted` and `playsInline` for iOS compatibility

5. **PWA Configuration**:
   - Service worker auto-registration in `index.tsx`
   - CDN caching for R2 assets (1-year cache)
   - Offline-ready for core assets
   - Auto-update mode for seamless updates
   - HTTPS support via @vitejs/plugin-basic-ssl

6. **Environment Variables**:
   - `GEMINI_API_KEY` - Required for AI features
   - Set in `.env.local` for development
   - Defined via Vite's `define` in `vite.config.ts`

7. **MediaPipe Integration**:
   - Multi-CDN fallback system for reliability
   - MediaPipe files copied to `public/mediapipe/` via postinstall script
   - Use `/mediapipe/` as local fallback CDN path
   - Handle WASM warm-up to prevent first-frame lag
   - Implement graceful degradation for tracking loss

8. **Performance Optimization**:
   - Code splitting for large bundles (phaser, react-vendor)
   - Batch image loading with retry logic
   - Background preloading queue for themes
   - Adaptive thresholds based on device type
   - Smooth values with exponential moving average
   - CDN caching with 1-year duration

9. **Phaser-Specific Notes**:
   - `experimentalDecorators: true` required for Phaser decorators
   - `useDefineForClassFields: false` required for Phaser class fields
   - Use `@ts-ignore` sparingly and only for known type definition issues
   - Always clean up Phaser games in useEffect cleanup
   - Use registry for passing callbacks to scenes

10. **Debugging**:
    - Use Eruda for mobile debugging in development
    - Force debug mode via `?debug=true` URL parameter
    - Use tagged console logs for better filtering
    - Monitor FPS and tracking quality

11. **Error Handling**:
    - Never use empty catch blocks
    - Provide user-friendly error messages
    - Log errors with context
    - Implement retry logic for network operations
    - Handle device-specific errors (iPad memory, Android camera)
    - Use `handleR2Error()` for CDN-related errors

12. **Asset Loading**:
    - All assets loaded from R2 CDN
    - Use `.webp` format for theme images (auto-converted)
    - SVG assets for game elements (Kenney Vector assets)
    - MP3/OGG dual format for audio compatibility
    - TTF fonts for Fredoka font family
    - Implement retry logic with 15s timeout