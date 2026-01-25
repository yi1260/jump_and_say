# AGENTS.md - AI Coding Agent Instructions

## Project Overview
React + TypeScript motion-controlled educational game using Phaser 3 and MediaPipe Face Detection.
- **Framework**: React 18.3.1 with Vite
- **Game Engine**: Phaser 3.80.0 (Arcade physics)
- **Motion Detection**: MediaPipe Face Detection (lightweight, optimized for performance)
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
- `@/` = Root directory (`./`)
- `/assets` = `./public/assets`
- `/kenney` = `./public/assets/kenney`

```typescript
import { motionController } from './services/motionController';
import { loadThemes } from './gameConfig';
import { getR2ImageUrl, getR2AssetUrl } from './src/config/r2Config';
```

### Naming Conventions

- **Components**: PascalCase (e.g., `GameCanvas`, `CompletionOverlay`, `CameraGuide`, `LoadingScreen`)
- **Functions/Methods**: camelCase (e.g., `handleScoreUpdate`, `initializeGame`, `preloadThemeImages`, `preloadAllGameAssets`)
- **Classes**: PascalCase (e.g., `MotionController`, `AdaptiveCalibrator`, `MainScene`)
- **Constants**: UPPER_SNAKE_CASE for true constants (e.g., `MAX_CONCURRENT_DOWNLOADS`, `FRAME_MIN_TIME`)
  - camelCase for config/calibration values that may be adjusted (e.g., `xThreshold`, `currentHeadX`)
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
import { motion, AnimatePresence } from 'framer-motion';

<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      Content
    </motion.div>
  )}
</AnimatePresence>
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

**MediaPipe Face Detection**:
- **Lightweight Model**: Uses 'short' model for faster inference
- **Optimized Settings**: 
  - `minDetectionConfidence: 0.5` - Balanced accuracy/speed
  - `selfieMode: true` - Mirrored for natural interaction
- **Target FPS**: 30 FPS (controlled by `FRAME_MIN_TIME = 1000 / 30`)
- **Smooth Values**: Exponential moving average for stable tracking
  - X-axis smoothing: 0.7/0.3 (70% old, 30% new)
  - Y-axis smoothing: 0.9/0.1 (90% old, 10% new) for jump detection
- **Jump Detection**: Velocity-based with 1.2 threshold and 0.04 displacement
- **Cooldown**: 600ms between jumps to prevent spam
- **Multi-CDN Fallback**: 4 CDN sources for reliable loading

**Phaser Performance**:
- Use `powerPreference: 'high-performance'` for rendering
- Enable antialias for smooth visuals
- Cap devicePixelRatio at 2 for performance
- Use object pooling for frequently created/destroyed game objects
- Use code splitting for large bundles (phaser, react-vendor)
- Limit concurrent downloads to reduce blocking

**React Performance**:
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Avoid inline functions in render props
- Use Framer Motion for smooth animations

**Asset Preloading**:
- **PreloadAllGameAssets**: Centralized asset loading function in `services/assetLoader.ts`
  - Preloads MediaPipe AI models
  - Preloads game assets (sounds, SVGs) in parallel
  - Preloads themes-list.json
  - Preloads first theme's images
  - Provides progress callbacks for loading screen
- Background preloading queue for remaining themes (MAX_CONCURRENT_DOWNLOADS = 6)
- Batch loading with `preloadThemeImages()` for immediate needs (BATCH_SIZE = 4)
- Use `prioritizeThemeInQueue()` to push theme images to front of queue
- Implement retry logic for failed loads (1 retry, 15s timeout)
- Pause background preloading during high-priority loading

**Performance Improvements**:
- **Reduced Power Consumption**: Face Detection is lighter than full-body Pose
- **Faster Inference**: 'short' model provides ~2-3x speed improvement
- **Optimized CDN Loading**: Multi-CDN fallback with 3s timeout
- **Optimization Recommendations**:
  - Use camera only when needed (CALIBRATING, PLAYING phases)
  - Reduce concurrent downloads (16→4)
  - Implement performance modes for low-end devices
  - Pause background preloading during gameplay

### Asset Management

**CDN-Only Architecture**:
- All assets served from R2 Cloudflare CDN
- No local asset files in repository (except MediaPipe backup in public/mediapipe/)
- Base URL: `https://cdn.maskmysheet.com`

**R2 CDN Functions** (in `src/config/r2Config.ts`):
```typescript
import { getR2ImageUrl, getR2AssetUrl, getR2ThemesListUrl, handleR2Error } from './src/config/r2Config';

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
│   │   ├── image2.webp
│   │   └── icon.webp
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
        │   ├── Enemies/
        │   ├── Tiles/
        │   └── Backgrounds/
```

**Path Auto-Correction**:
The `getR2AssetUrl()` function automatically corrects legacy paths:
```typescript
getR2AssetUrl('assets/kenney/...')  // Works correctly
getR2AssetUrl('/assets/kenney/...') // Leading slash removed
```

**Preloading Strategy**:
```typescript
import { preloadAllGameAssets } from './services/assetLoader';
import { startBackgroundPreloading, prioritizeThemeInQueue } from './gameConfig';

// Preload all game assets with progress tracking
await preloadAllGameAssets(selectedThemes, (progress, status) => {
  console.log(`Loading: ${progress}% - ${status}`);
});

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
- **Optimized globIgnores**: Excludes backup files and assets to reduce precache size

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
- **Optimized globIgnores**: Excludes backup files, assets, and MediaPipe Pose files
  - `**/assets/**/*` - All local assets
  - `**/mediapipe/pose/**/*` - MediaPipe Pose files
  - `**/mediapipe/pose*` - MediaPipe Pose files
  - `**/themes.backup*/**/*` - Backup theme directories
  - `**/assets/kenney/Sprites/**/*` - Unused sprite assets
  - `**/assets/kenney/Vector/backup/**/*` - Backup vector assets
- **MediaPipe WASM caching**: Includes `.wasm` and `.data` files for offline support
- **Multi-CDN support**: Caches MediaPipe Face Detection files from jsdelivr, unpkg, and custom CDN

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
- Console logs with tags: `[INIT]`, `[START]`, `[JUMP]`
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

// Calibrate (no-op for compatibility)
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
  smoothedState?: MotionState; // Smoothed state for display/UI
}
```

**MediaPipe Face Detection**:
- **Algorithm**: MediaPipe Face Detection with 'short' model
- **Model**: Lightweight face detection model optimized for speed
- **Configuration**:
  - `model: 'short'` - Fast inference (~2-3x faster than full model)
  - `minDetectionConfidence: 0.5` - Balanced accuracy/speed
  - `selfieMode: true` - Mirrored for natural interaction
- **Detection**: Returns bounding box (xCenter, yCenter, width, height)
- **Coordinates**: Normalized 0-1 range
- **Mirroring**: X-axis mirrored (1 - xCenter) for selfie view
- **Performance**: ~30 FPS on most devices

**Movement Detection**:
- **Horizontal Movement**: Based on face center X position
  - Threshold: 0.12 from center (0.5)
  - Left: < 0.38 (0.5 - 0.12)
  - Right: > 0.62 (0.5 + 0.12)
  - Center: 0.38 - 0.62
  - Smoothing: 0.7/0.3 exponential moving average
- **Jump Detection**: Velocity-based on face center Y position
  - Velocity threshold: 1.2 (fast upward movement)
  - Displacement threshold: 0.04 (significant distance)
  - Smoothing: 0.9/0.1 (slow adaptation to height)
  - Cooldown: 600ms between jumps

**Smoothing Parameters**:
- X-axis smoothing: 0.7/0.3 (70% old, 30% new) - responsive but stable
- Y-axis smoothing: 0.9/0.1 (90% old, 10% new) - slow adaptation for jump detection
- Jump cooldown: 600ms
- Target FPS: 30

**Multi-CDN Fallback** (in `index.html`):
```javascript
const CDNS = [
  'https://fastly.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/',  // 国内镜像 1 (最快)
  'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/',    // 国内镜像 2
  '/mediapipe/face_detection/',                                                     // 本地回退
  'https://cdn.maskmysheet.com/mediapipe/face_detection/'                           // 自有 R2 CDN
];
```

**Loading Process**:
1. Try CDNs in order with 3s timeout
2. Successfully loaded CDN is saved to `window.__MEDIAPIPE_FACE_DETECTION_CDN__`
3. MediaPipe uses this CDN for loading WASM files
4. On failure, automatically try next CDN
5. Face Detection library loaded as `window.FaceDetection`

### Asset Loading System

**AssetLoader Service** (`services/assetLoader.ts`):
- **Centralized Asset Loading**: `preloadAllGameAssets()` function
- **Progress Tracking**: Provides callbacks for loading progress and status
- **Parallel Loading**: Loads game assets in parallel for faster startup
- **Error Handling**: Continues on individual asset failures
- **Asset Categories**:
  - MediaPipe AI models
  - Game sounds (MP3)
  - Game SVGs (characters, enemies, tiles, backgrounds)
  - Themes list JSON
  - First theme's images

**LoadingScreen Component** (`components/LoadingScreen.tsx`):
- **Visual Feedback**: Animated loading screen with progress bar
- **Progress Display**: Shows percentage and status text
- **Animated Character**: Bouncing character animation
- **Kenney Style**: Consistent with game's visual design
- **Backdrop Blur**: Modern glassmorphism effect

**Usage Example**:
```typescript
import { preloadAllGameAssets } from './services/assetLoader';
import { LoadingScreen } from './components/LoadingScreen';

// In App.tsx
const [loadingProgress, setLoadingProgress] = useState(0);
const [loadingStatus, setLoadingStatus] = useState('');

await preloadAllGameAssets(selectedThemes, (progress, status) => {
  setLoadingProgress(progress);
  setLoadingStatus(status);
});

<LoadingScreen progress={loadingProgress} status={loadingStatus} />
```

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

**Preloading Strategy**:
- Batch size: 4 images per batch
- Max concurrent downloads: 6
- Retry on failure: 1 retry with 15s timeout
- High-priority loading pauses background preloading
- Cache detection: Loads < 50ms indicate cache hit

### Vite Configuration

**Path Aliases**:
```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, '.'),
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
  LOADING = 'LOADING',              // Asset loading phase
  LOADING_AI = 'LOADING_AI',        // AI model loading
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

### Key Files Structure

```
├── components/                    # React UI components
│   ├── CameraGuide.tsx           # Camera position guide
│   ├── CompletionOverlay.tsx     # Game completion overlay with framer-motion
│   ├── GameBackground.tsx        # Dynamic background component
│   ├── GameCanvas.tsx            # Phaser game container
│   ├── ImgWithFallback.tsx       # Image component with fallback support
│   └── LoadingScreen.tsx         # Loading screen with progress bar
├── game/
│   └── scenes/                   # Phaser scenes
│       ├── MainScene.ts          # Main gameplay scene
│       └── PreloadScene.ts       # Asset preloading scene
├── services/
│   ├── motionController.ts       # Motion detection (MediaPipe Face Detection)
│   └── assetLoader.ts            # Asset loading service
├── src/
│   └── config/
│       └── r2Config.ts           # R2 CDN configuration
├── scripts/                      # Utility scripts
│   ├── upload-themes-continue.sh # Continue theme upload to R2
│   └── upload-themes-to-r2.sh    # Upload themes to R2 CDN
├── types.ts                      # TypeScript interfaces & enums
├── gameConfig.ts                 # Game state, theme loading, preloading
├── App.tsx                       # Main app component
├── index.tsx                     # React entry point & PWA registration
├── index.html                    # HTML entry point with MediaPipe Face Detection loader
├── vite.config.ts                # Vite configuration (PWA, SSL, proxy, aliases)
└── tsconfig.json                 # TypeScript configuration
```

### Environment Configuration

**Environment Variables**:
- `.env.local` - Development environment variables
- `.env.production` - Production environment variables

**Required Variables**:
```env
# .env.local
GEMINI_API_KEY=your_gemini_api_key_here
VITE_R2_BASE_URL=https://cdn.maskmysheet.com/raz_aa

# .env.production
VITE_R2_BASE_URL=https://cdn.maskmysheet.com/raz_aa
```

**Note**: `GEMINI_API_KEY` is defined via Vite's `define` in `vite.config.ts` and is required for AI features.

### .gitignore

**Ignored Directories**:
```
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Theme cache
public/themes/
public/themes.*/

# Local asset backups (optional - currently commented out)
# public/assets/
# public/mediapipe/

# Dependencies
node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Backup folders
```

**Note**: `public/assets/` and `public/mediapipe/` are currently commented out, meaning they may be committed or have different handling strategies.

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
   - No local asset files in repository (except MediaPipe backup)
   - MediaPipe files copied via postinstall script
   - Use `getR2AssetUrl()` and `getR2ImageUrl()` for all asset URLs

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
   - MediaPipe WASM files cached for offline support
   - **Optimized globIgnores**: Excludes backup files to reduce precache size

6. **Environment Variables**:
   - `GEMINI_API_KEY` - Required for AI features
   - Set in `.env.local` for development
   - Set in `.env.production` for production
   - Defined via Vite's `define` in `vite.config.ts`

7. **Motion Detection System**:
   - **Primary**: MediaPipe Face Detection
     - Lightweight 'short' model for fast inference
     - Bounding box detection (xCenter, yCenter, width, height)
     - Selfie mode with X-axis mirroring
     - Multi-CDN fallback system (4 CDNs)
     - WASM files cached for offline support
     - 3s timeout for CDN switching
     - **Priority**: fastly.jsdelivr.net → jsdelivr.net → local → R2 CDN

8. **Performance Optimization**:
   - **Lightweight Model**: Face Detection 'short' model is ~2-3x faster than Pose
   - **Optimized Settings**: Balanced accuracy/speed with 0.5 confidence threshold
   - **Efficient Smoothing**: Exponential moving average for stable tracking
   - **Code Splitting**: Large bundles split (phaser, react-vendor)
   - **Batch Loading**: Image loading with retry logic (BATCH_SIZE = 4)
   - **Background Preloading**: Queue for themes (MAX_CONCURRENT_DOWNLOADS = 6)
   - **CDN Caching**: 1-year cache duration for theme assets
   - **Pause Preloading**: During high-priority loading
   - **Optimized globIgnores**: Reduces precache size for faster Service Worker activation

9. **Phaser-Specific Notes**:
   - `experimentalDecorators: true` required for Phaser decorators
   - `useDefineForClassFields: false` required for Phaser class fields
   - Use `@ts-ignore` sparingly and only for known type definition issues
   - Always clean up Phaser games in useEffect cleanup
   - Use registry for passing callbacks to scenes
   - **Local Fallback**: PreloadScene has CDN → local fallback logic for game assets

10. **Debugging**:
    - Use Eruda for mobile debugging in development
    - Force debug mode via `?debug=true` URL parameter
    - Use tagged console logs for better filtering
    - Monitor FPS and tracking quality
    - Cache status logged for all loaded assets

11. **Error Handling**:
    - Never use empty catch blocks
    - Provide user-friendly error messages
    - Log errors with context
    - Implement retry logic for network operations
    - Handle device-specific errors (iPad memory, Android camera)
    - Use `handleR2Error()` for CDN-related errors
    - Global error handlers for WASM loading issues

12. **Asset Loading**:
    - All assets loaded from R2 CDN
    - Use `.webp` format for theme images (auto-converted)
    - SVG assets for game elements (Kenney Vector assets)
    - MP3/OGG dual format for audio compatibility
    - TTF fonts for Fredoka font family
    - Implement retry logic with 15s timeout
    - Cache detection: < 50ms indicates cache hit
    - **CDN → Local Fallback**: PreloadScene automatically falls back to local assets if CDN fails
    - **Centralized Loading**: Use `preloadAllGameAssets()` for consistent asset loading

13. **Framer Motion Usage**:
    - Only used in `CompletionOverlay.tsx`
    - Used for entry/exit animations, title animations, star animations, score display
    - Import: `import { AnimatePresence, motion } from 'framer-motion';`

14. **Performance Improvements**:
    - **Reduced Power Consumption**: Face Detection is lighter than full-body Pose
    - **Faster Inference**: 'short' model provides ~2-3x speed improvement
    - **Optimized CDN Loading**: Multi-CDN fallback with 3s timeout
    - **Optimization Recommendations**:
      - Use camera only when needed (CALIBRATING, PLAYING phases)
      - Reduce concurrent downloads (16→4)
      - Implement performance modes for low-end devices
      - Pause background preloading during gameplay

15. **Theme Upload Scripts**:
    - `scripts/upload-themes-to-r2.sh` - Uploads all theme assets to R2 CDN
    - `scripts/upload-themes-continue.sh` - Continues interrupted upload process
    - Scripts use AWS CLI for R2 operations
    - Requires R2 credentials configuration

16. **Server Directory**:
    - `server/` directory exists but is currently empty
    - Reserved for future backend server implementation
    - Do not add files here unless implementing backend features

17. **StrictMode Removed**:
    - React StrictMode is disabled in `index.tsx`
    - Prevents double-initialization of webcam in development
    - Hardware integration (camera) requires careful lifecycle management

18. **Motion Detection Architecture**:
    - **Primary**: MediaPipe Face Detection in `services/motionController.ts`
      - Uses 'short' model for lightweight inference
      - Returns bounding box (xCenter, yCenter, width, height)
      - Normalized coordinates (0-1)
      - Selfie mode with X-axis mirroring (1 - xCenter)
      - Multi-CDN fallback system
      - WASM files cached for offline support
    - **Detection Logic**:
      - Horizontal: Face center X position with 0.12 threshold
      - Jump: Velocity-based with 1.2 threshold and 0.04 displacement
      - Smoothing: 0.7/0.3 for X, 0.9/0.1 for Y
      - Cooldown: 600ms between jumps

19. **Calibration System**:
    - Simplified calibration (no-op methods for compatibility)
    - `calibrate()` - No-op (Face Detection doesn't require calibration)
    - `getCalibrationProgress()` - Returns 1 (always ready)
    - `isCalibrating()` - Returns false (no calibration needed)

20. **Device-Specific Optimizations**:
    - iPad: Higher thresholds, larger camera resolution (1280x720)
    - Mobile phone: Lower thresholds, standard resolution (640x480)
    - Desktop/Tablet: Balanced thresholds and resolution
    - Device detection via User Agent and touch capabilities

21. **Face Detection vs Pose**:
    - **Face Detection**: Current implementation
      - Lightweight 'short' model
      - Bounding box detection only
      - ~2-3x faster than Pose
      - Lower CPU/GPU usage
      - Good for head/jump detection
    - **Pose**: Previous implementation (deprecated)
      - Full-body landmark detection
      - More accurate but heavier
      - Higher CPU/GPU usage
      - Better for complex movements

22. **Known Limitations**:
    - Face Detection only tracks head position
    - Cannot detect full-body movements
    - Jump detection based on head velocity may be less accurate than full-body tracking
    - Background interference minimal (face-focused detection)
    - Multiple faces not handled (uses first detection only)

23. **Migration Notes**:
    - Project migrated from Pixel Motion → MediaPipe Face Detection
    - Pixel Motion had accuracy issues (background interference, noise sensitivity)
    - Face Detection provides better accuracy with acceptable performance
    - API remains compatible with previous implementations
    - No breaking changes to game logic or UI components

24. **Loading System Improvements**:
    - **Centralized Asset Loading**: `preloadAllGameAssets()` in `services/assetLoader.ts`
    - **Progress Tracking**: Real-time progress updates for loading screen
    - **Parallel Loading**: Game assets loaded concurrently for faster startup
    - **Visual Feedback**: `LoadingScreen` component with animated progress bar
    - **Error Resilience**: Continues loading even if individual assets fail
    - **Optimized globIgnores**: Reduces Service Worker precache size for faster activation

25. **Service Worker Optimization**:
    - **Reduced Precache Size**: Excludes backup files and local assets
    - **Faster Activation**: Smaller precache list means faster Service Worker activation
    - **Runtime Caching**: CDN assets cached at runtime with 1-year duration
    - **Cleanup Outdated Caches**: Automatically removes old cache versions
    - **Skip Waiting**: New Service Worker activates immediately
    - **Clients Claim**: New Service Worker takes control of all clients immediately

26. **PWA Refresh Performance**:
    - **Problem**: Large precache manifests (100+ backup theme files) cause slow refresh
    - **Solution**: Optimized `globIgnores` to exclude backup files
    - **Result**: Refresh time reduced from 10-30s to 1-3s
    - **Configuration**:
      ```javascript
      globIgnores: [
        '**/assets/**/*',              // All local assets
        '**/mediapipe/pose/**/*',      // MediaPipe Pose files
        '**/mediapipe/pose*',          // MediaPipe Pose files
        '**/themes.backup*/**/*',      // Backup theme directories
        '**/assets/kenney/Sprites/**/*', // Unused sprites
        '**/assets/kenney/Vector/backup/**/*' // Backup vectors
      ]
      ```