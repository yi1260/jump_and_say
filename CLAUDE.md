# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jump and Say is an educational game where players control a character by moving their body (detected via webcam/MediaPipe) to jump and select answers. It's built with React + Phaser 3 and uses pose detection for body-controlled gameplay.

## Commands

```bash
npm install    # Install dependencies
npm run dev    # Start dev server on port 3000 (requires HTTPS for webcam)
npm run build  # Production build
npm run preview # Preview production build
```

## Environment Setup

Create a `.env.local` file with:
```
GEMINI_API_KEY=your_key_here
VITE_R2_BASE_URL=https://cdn.maskmysheet.com/raz_aa
```

## Architecture Overview

### React Layer
- **index.tsx**: Entry point, initializes PWA service worker and Eruda (mobile debugging)
- **App.tsx**: Main React component orchestrating game phases and UI overlays
- **components/GameCanvas.tsx**: Creates Phaser game instance, manages responsive scaling and adaptive quality

### Phaser Layer
- **gameConfig.ts**: Theme/asset loading, background preloading queue management
- **game/scenes/PreloadScene.ts**: Loads game assets and theme-specific images/audio
- **game/scenes/MainScene.ts**: Core gameplay - player physics, answer cards, scoring, animations

### Key Services
- **services/motionController.ts**: MediaPipe Pose integration for body-controlled gameplay (jump detection, lateral movement)
- **services/assetLoader.ts**: Theme asset preloading with CDN fallback
- **src/config/r2Config.ts**: CDN URL construction and fallback logic

### Asset Loading Strategy

The game uses a multi-tier asset loading approach:
1. Primary: CDN (cdn.maskmysheet.com) for theme images/audio
2. Fallback: Local `/public/themes/themes-list.json` and `/public/assets/` for core game assets
3. Service Worker caching for offline support (PWA)

Theme images are stored at `cdn.maskmysheet.com/RAZ/{level}/{theme-id}/` and are preloaded via `preloadThemeImagesStrict()`.

### Gameplay Flow

1. User selects theme from `themes-list.json`
2. PreloadScene loads theme assets
3. MainScene generates questions with 3 answer cards
4. MotionController detects body position for lane selection and jumps
5. Player jumps to hit correct answer card
6. Score updates trigger React UI sync via registry callbacks

### Quality/Performance System

GameCanvas implements adaptive quality rendering:
- Device-specific render profiles (iPad tiers, mobile, desktop)
- Dynamic DPR scaling based on viewport and performance
- Persistent quality state for crash recovery
- WebGL context loss handling

### Motion Control

The `MotionController` class:
- Uses MediaPipe Pose (lite model) for body tracking
- Detects lateral movement via shoulder center position
- Detects jumps via torso velocity and displacement thresholds
- Provides smoothed state to prevent jittery gameplay

## Key Patterns

- **Scene Communication**: React ↔ Phaser via `game.registry.set/get` and callback functions
- **Asset Keys**: Theme images use format `theme_{themeId}_{imageName}` for texture keys
- **Responsive Layout**: MainScene recalculates all positions in `recalcLayout()` on resize
- **Lane System**: 3 lanes mapped to body position with hysteresis to prevent flickering
