import Phaser from 'phaser';
import React, { useEffect, useRef } from 'react';
import { MainScene } from '../game/scenes/MainScene';
import { PreloadScene } from '../game/scenes/PreloadScene';
import { Theme, ThemeId } from '../types';

const isIPadDevice = (): boolean => (
  /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document
);

const isMobilePhone = (): boolean => (
  /iPhone|Android|Mobile|HarmonyOS/i.test(navigator.userAgent) && !/iPad|Tablet/i.test(navigator.userAgent)
);

type RenderProfileName = 'ipad' | 'mobile' | 'default';
export type QualityMode = 'adaptive' | 'high' | 'medium' | 'low';

interface RenderProfile {
  name: RenderProfileName;
  renderDpr: number;
  textureBoost: number;
  maxInternalPixels: number;
  initialQualityStep: number;
  maxQualityStep: number;
}

interface PersistedQualityState {
  profile: RenderProfileName;
  step: number;
  savedAt: number;
}

interface RuntimeMarkerState {
  activeAt: number;
}

const QUALITY_STEP_FACTORS: number[] = [1, 0.9, 0.8, 0.72, 0.64];
const QUALITY_STATE_STORAGE_KEY = 'jump_and_say_quality_state_v1';
const RUNTIME_MARKER_STORAGE_KEY = 'jump_and_say_runtime_marker_v1';
const QUALITY_STATE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RUNTIME_MARKER_TTL_MS = 15 * 60 * 1000;

const clampQualityStep = (step: number, maxStep: number): number => {
  const safeStep = Number.isFinite(step) ? Math.floor(step) : 0;
  return Phaser.Math.Clamp(safeStep, 0, Math.max(0, maxStep));
};

const getForcedQualityStep = (mode: QualityMode, maxStep: number): number => {
  if (mode === 'high') return 0;
  if (mode === 'medium') return clampQualityStep(2, maxStep);
  return maxStep;
};

const isPersistedQualityState = (value: unknown): value is PersistedQualityState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.profile === 'ipad' || candidate.profile === 'mobile' || candidate.profile === 'default') &&
    typeof candidate.step === 'number' &&
    Number.isFinite(candidate.step) &&
    typeof candidate.savedAt === 'number' &&
    Number.isFinite(candidate.savedAt)
  );
};

const isRuntimeMarkerState = (value: unknown): value is RuntimeMarkerState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.activeAt === 'number' && Number.isFinite(candidate.activeAt);
};

const readPersistedQualityStep = (profile: RenderProfileName, maxStep: number): number => {
  try {
    const raw = window.localStorage.getItem(QUALITY_STATE_STORAGE_KEY);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedQualityState(parsed)) return 0;
    if (parsed.profile !== profile) return 0;
    if (Date.now() - parsed.savedAt > QUALITY_STATE_TTL_MS) return 0;
    return clampQualityStep(parsed.step, maxStep);
  } catch {
    return 0;
  }
};

const persistQualityStep = (profile: RenderProfileName, step: number): void => {
  const payload: PersistedQualityState = {
    profile,
    step,
    savedAt: Date.now()
  };
  try {
    window.localStorage.setItem(QUALITY_STATE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures (private mode / quota)
  }
};

const readRuntimeMarker = (): RuntimeMarkerState | null => {
  try {
    const raw = window.localStorage.getItem(RUNTIME_MARKER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRuntimeMarkerState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeRuntimeMarker = (): void => {
  const marker: RuntimeMarkerState = { activeAt: Date.now() };
  try {
    window.localStorage.setItem(RUNTIME_MARKER_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Ignore storage failures (private mode / quota)
  }
};

const clearRuntimeMarker = (): void => {
  try {
    window.localStorage.removeItem(RUNTIME_MARKER_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode / quota)
  }
};

const getIpadTier = (): 'high' | 'medium' | 'low' => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
    ? nav.deviceMemory
    : 0;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === 'number' && Number.isFinite(navigator.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : 0;
  const maxScreenSide = Math.max(window.screen.width, window.screen.height);

  let score = 0;
  if (deviceMemory >= 8) score += 3;
  else if (deviceMemory >= 6) score += 2;
  else if (deviceMemory >= 4) score += 1;

  if (hardwareConcurrency >= 8) score += 2;
  else if (hardwareConcurrency >= 6) score += 1;

  if (maxScreenSide >= 2732) score += 2;
  else if (maxScreenSide >= 2388) score += 1;

  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
};

const getBaseRenderProfile = (): RenderProfile => {
  const rawDpr = window.devicePixelRatio || 1;

  if (isIPadDevice()) {
    const tier = getIpadTier();
    if (tier === 'high') {
      return {
        name: 'ipad',
        renderDpr: Math.max(1, Math.min(rawDpr * 1.02, 2.0)),
        textureBoost: 1.06,
        maxInternalPixels: 3_400_000,
        initialQualityStep: 0,
        maxQualityStep: 4
      };
    }
    if (tier === 'medium') {
      return {
        name: 'ipad',
        renderDpr: Math.max(1, Math.min(rawDpr * 0.98, 1.8)),
        textureBoost: 1.02,
        maxInternalPixels: 2_800_000,
        initialQualityStep: 1,
        maxQualityStep: 4
      };
    }
    return {
      name: 'ipad',
      renderDpr: Math.max(1, Math.min(rawDpr * 0.92, 1.55)),
      textureBoost: 1,
      maxInternalPixels: 2_300_000,
      initialQualityStep: 1,
      maxQualityStep: 4
    };
  }

  if (isMobilePhone()) {
    return {
      name: 'mobile',
      renderDpr: Math.max(1, Math.min(rawDpr, 2.4)),
      textureBoost: 1,
      maxInternalPixels: 2_600_000,
      initialQualityStep: 0,
      maxQualityStep: 4
    };
  }

  return {
    name: 'default',
    renderDpr: Math.max(1, Math.min(rawDpr, 2.2)),
    textureBoost: 1,
    maxInternalPixels: 3_000_000,
    initialQualityStep: 0,
    maxQualityStep: 4
  };
};

const getAppliedRenderProfile = (qualityStep: number): RenderProfile & { appliedQualityStep: number } => {
  const baseProfile = getBaseRenderProfile();
  const appliedQualityStep = clampQualityStep(qualityStep, baseProfile.maxQualityStep);
  const safeFactor = QUALITY_STEP_FACTORS[appliedQualityStep] ?? QUALITY_STEP_FACTORS[QUALITY_STEP_FACTORS.length - 1];

  return {
    ...baseProfile,
    appliedQualityStep,
    renderDpr: Phaser.Math.Clamp(baseProfile.renderDpr * safeFactor, 1, baseProfile.renderDpr),
    textureBoost: Phaser.Math.Clamp(baseProfile.textureBoost * safeFactor, 1, baseProfile.textureBoost),
    maxInternalPixels: Math.max(
      1_800_000,
      Math.floor(baseProfile.maxInternalPixels * safeFactor * safeFactor)
    )
  };
};

const syncHiDpiScale = (
  game: Phaser.Game,
  container: HTMLDivElement,
  qualityStep: number
): { profile: RenderProfileName; appliedQualityStep: number; maxQualityStep: number } => {
  const profile = getAppliedRenderProfile(qualityStep);
  const targetRenderDpr = profile.renderDpr;
  const rect = container.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height));
  const cssArea = Math.max(1, cssWidth * cssHeight);
  const maxDprByPixels = Math.sqrt(profile.maxInternalPixels / cssArea);
  const renderDpr = Phaser.Math.Clamp(Math.min(targetRenderDpr, maxDprByPixels), 1, targetRenderDpr);
  const internalWidth = Math.max(1, Math.floor(cssWidth * renderDpr));
  const internalHeight = Math.max(1, Math.floor(cssHeight * renderDpr));
  const textureBoost = profile.textureBoost * (renderDpr / targetRenderDpr);

  game.registry.set('renderProfile', profile.name);
  game.registry.set('renderDpr', renderDpr);
  game.registry.set('textureBoost', Phaser.Math.Clamp(textureBoost, 1, profile.textureBoost));
  game.registry.set('renderQualityStep', profile.appliedQualityStep);
  game.registry.set('dpr', 1);
  game.scale.setZoom(1 / renderDpr);
  game.scale.resize(internalWidth, internalHeight);

  return {
    profile: profile.name,
    appliedQualityStep: profile.appliedQualityStep,
    maxQualityStep: profile.maxQualityStep
  };
};

interface GameCanvasProps {
  onScoreUpdate: (score: number, total: number) => void;
  onGameOver: () => void;
  onGameRestart?: () => void;
  onQuestionUpdate?: (question: string) => void;
  onBackgroundUpdate?: (index: number) => void;
  themes: ThemeId[];
  allThemes: Theme[];
  qualityMode: QualityMode;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ 
  onScoreUpdate, 
  onGameOver, 
  onGameRestart,
  onQuestionUpdate,
  onBackgroundUpdate,
  themes,
  allThemes,
  qualityMode
}) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const applyQualityModeRef = useRef<((mode: QualityMode) => void) | null>(null);
  const qualityModeRef = useRef<QualityMode>(qualityMode);

  useEffect(() => {
    if (!containerRef.current) return;

    let isUnmounted = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeRafId = 0;
    let performanceMonitorRafId = 0;
    let runtimeMarkerIntervalId = 0;
    let qualityStep = 0;
    let qualityMaxStep = 0;
    let qualityProfile: RenderProfileName = 'default';
    let activeQualityMode: QualityMode = qualityModeRef.current;
    let isRuntimeMarkerTrackingEnabled = false;
    let lastDegradeAt = 0;
    let perfLastTimestamp = 0;
    let perfSampleCount = 0;
    let perfDeltaSum = 0;
    let perfSlow33Count = 0;
    let perfSlow50Count = 0;
    let perfBadWindows = 0;
    let contextLostHandler: ((event: Event) => void) | null = null;
    let contextRestoredHandler: (() => void) | null = null;
    let beforeUnloadHandler: (() => void) | null = null;

    const stopPerformanceMonitor = (): void => {
      if (performanceMonitorRafId !== 0) {
        window.cancelAnimationFrame(performanceMonitorRafId);
        performanceMonitorRafId = 0;
      }
    };

    const resetPerfWindow = (): void => {
      perfSampleCount = 0;
      perfDeltaSum = 0;
      perfSlow33Count = 0;
      perfSlow50Count = 0;
    };

    const scheduleHiDpiSync = (): void => {
      if (resizeRafId !== 0) {
        window.cancelAnimationFrame(resizeRafId);
      }
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = 0;
        const game = gameRef.current;
        const container = containerRef.current;
        if (!game || !container) return;
        const result = syncHiDpiScale(game, container, qualityStep);
        qualityProfile = result.profile;
        qualityMaxStep = result.maxQualityStep;
        qualityStep = result.appliedQualityStep;
        game.registry.set('renderQualityMode', activeQualityMode);
      });
    };

    const setRuntimeMarkerTracking = (enabled: boolean): void => {
      if (enabled === isRuntimeMarkerTrackingEnabled) return;
      isRuntimeMarkerTrackingEnabled = enabled;

      if (!enabled) {
        if (runtimeMarkerIntervalId !== 0) {
          window.clearInterval(runtimeMarkerIntervalId);
          runtimeMarkerIntervalId = 0;
        }
        if (beforeUnloadHandler) {
          window.removeEventListener('beforeunload', beforeUnloadHandler);
          beforeUnloadHandler = null;
        }
        clearRuntimeMarker();
        return;
      }

      writeRuntimeMarker();
      runtimeMarkerIntervalId = window.setInterval(() => {
        writeRuntimeMarker();
      }, 5000);
      beforeUnloadHandler = () => {
        clearRuntimeMarker();
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
    };

    const computeInitialStepForMode = (mode: QualityMode): void => {
      const baseProfile = getBaseRenderProfile();
      qualityProfile = baseProfile.name;
      qualityMaxStep = baseProfile.maxQualityStep;

      if (mode === 'adaptive') {
        const persistedStep = readPersistedQualityStep(qualityProfile, qualityMaxStep);
        qualityStep = Math.max(baseProfile.initialQualityStep, persistedStep);
        return;
      }

      qualityStep = getForcedQualityStep(mode, qualityMaxStep);
    };

    const degradeQuality = (reason: string): void => {
      if (activeQualityMode !== 'adaptive') return;
      const now = Date.now();
      if (now - lastDegradeAt < 12_000) return;

      const baseProfile = getBaseRenderProfile();
      qualityProfile = baseProfile.name;
      qualityMaxStep = baseProfile.maxQualityStep;
      const nextStep = clampQualityStep(qualityStep + 1, qualityMaxStep);
      if (nextStep === qualityStep) return;

      qualityStep = nextStep;
      lastDegradeAt = now;
      persistQualityStep(qualityProfile, qualityStep);
      console.warn('[Render] Quality degraded adaptively.', {
        reason,
        profile: qualityProfile,
        qualityStep
      });
      scheduleHiDpiSync();
    };

    const startPerformanceMonitor = (): void => {
      const tick = (timestamp: number): void => {
        if (document.hidden) {
          perfLastTimestamp = timestamp;
          performanceMonitorRafId = window.requestAnimationFrame(tick);
          return;
        }

        if (perfLastTimestamp > 0) {
          const delta = timestamp - perfLastTimestamp;
          if (delta > 0 && delta < 120) {
            perfSampleCount += 1;
            perfDeltaSum += delta;
            if (delta > 33) perfSlow33Count += 1;
            if (delta > 50) perfSlow50Count += 1;
          }
        }

        perfLastTimestamp = timestamp;

        if (perfSampleCount >= 150) {
          const avgDelta = perfDeltaSum / perfSampleCount;
          const slow33Ratio = perfSlow33Count / perfSampleCount;
          const slow50Ratio = perfSlow50Count / perfSampleCount;
          const badWindow = avgDelta > 24 || slow33Ratio > 0.22 || slow50Ratio > 0.08;

          perfBadWindows = badWindow ? perfBadWindows + 1 : Math.max(0, perfBadWindows - 1);
          if (perfBadWindows >= 2) {
            perfBadWindows = 0;
            degradeQuality('low-fps-window');
          }

          resetPerfWindow();
        }

        performanceMonitorRafId = window.requestAnimationFrame(tick);
      };

      stopPerformanceMonitor();
      performanceMonitorRafId = window.requestAnimationFrame(tick);
    };

    const waitForFredokaFont = async (): Promise<void> => {
      if (!('fonts' in document)) return;

      const fontSet = document.fonts;
      const fontSpecs = [
        '400 24px "FredokaBoot"',
        '700 24px "FredokaBoot"',
        '900 24px "FredokaBoot"'
      ];

      const fontLoads: Array<Promise<FontFace[]>> = [
        fontSet.load('400 24px "FredokaBoot"'),
        fontSet.load('700 24px "FredokaBoot"'),
        fontSet.load('900 24px "FredokaBoot"')
      ];

      await Promise.race([
        Promise.allSettled(fontLoads).then(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2000))
      ]);

      const missingSpecs = fontSpecs.filter((spec) => !fontSet.check(spec));
      if (missingSpecs.length > 0) {
        await Promise.allSettled(missingSpecs.map((spec) => fontSet.load(spec)));
      }

      const stillMissingSpecs = fontSpecs.filter((spec) => !fontSet.check(spec));
      if (stillMissingSpecs.length > 0) {
        console.warn('[Font] FredokaBoot not fully ready before Phaser init.', { missingSpecs: stillMissingSpecs });
      }
    };

    const initializeGame = async (): Promise<void> => {
      await waitForFredokaFont();
      if (isUnmounted || !containerRef.current) return;
      const useRoundPixels = isIPadDevice() || isMobilePhone();
      activeQualityMode = qualityModeRef.current;

      computeInitialStepForMode(activeQualityMode);
      if (activeQualityMode === 'adaptive') {
        const runtimeMarker = readRuntimeMarker();
        if (runtimeMarker && Date.now() - runtimeMarker.activeAt < RUNTIME_MARKER_TTL_MS) {
          qualityStep = clampQualityStep(qualityStep + 1, qualityMaxStep);
          persistQualityStep(qualityProfile, qualityStep);
          console.warn('[Render] Crash recovery detected. Starting with lower quality.', {
            profile: qualityProfile,
            qualityStep
          });
        }
      }

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.WEBGL,
        parent: containerRef.current,
        backgroundColor: 'transparent',
        transparent: true,
        render: {
          antialias: true,
          pixelArt: false,
          roundPixels: useRoundPixels,
          powerPreference: 'high-performance'
        },
        scale: {
          mode: Phaser.Scale.NONE,
          width: 1,
          height: 1,
          zoom: 1,
          autoRound: true
        },
        physics: {
          default: 'arcade',
          arcade: {
            gravity: { x: 0, y: 0 },
            debug: false
          }
        },
        callbacks: {
          preBoot: (game) => {
            game.registry.set('callbacks', {
              onScoreUpdate,
              onGameOver,
              onGameRestart,
              onQuestionUpdate,
              onBackgroundUpdate
            });
            game.registry.set('initialThemes', themes);
            game.registry.set('allThemes', allThemes);
            game.registry.set('renderProfile', qualityProfile);
            game.registry.set('renderDpr', 1);
            game.registry.set('textureBoost', 1);
            game.registry.set('renderQualityStep', qualityStep);
            game.registry.set('renderQualityMode', activeQualityMode);
            game.registry.set('dpr', 1);
          },
          postBoot: (game) => {
            if (!containerRef.current) return;
            const result = syncHiDpiScale(game, containerRef.current, qualityStep);
            qualityProfile = result.profile;
            qualityMaxStep = result.maxQualityStep;
            qualityStep = result.appliedQualityStep;
          }
        },
        scene: [PreloadScene, MainScene],
        input: {
          keyboard: true
        }
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;
      (window as Window & { phaserGame?: Phaser.Game }).phaserGame = game;

      scheduleHiDpiSync();
      window.addEventListener('resize', scheduleHiDpiSync, { passive: true });
      window.addEventListener('orientationchange', scheduleHiDpiSync);
      if (activeQualityMode === 'adaptive') {
        startPerformanceMonitor();
        setRuntimeMarkerTracking(true);
      } else {
        stopPerformanceMonitor();
        setRuntimeMarkerTracking(false);
      }

      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          scheduleHiDpiSync();
        });
        resizeObserver.observe(containerRef.current);
      }

      if (game.canvas) {
        contextLostHandler = (event: Event) => {
          event.preventDefault();
          if (activeQualityMode === 'adaptive') {
            degradeQuality('webgl-context-lost');
          } else {
            scheduleHiDpiSync();
          }
        };
        contextRestoredHandler = () => {
          scheduleHiDpiSync();
        };
        game.canvas.addEventListener('webglcontextlost', contextLostHandler, false);
        game.canvas.addEventListener('webglcontextrestored', contextRestoredHandler, false);
      }

      applyQualityModeRef.current = (nextMode: QualityMode): void => {
        activeQualityMode = nextMode;
        computeInitialStepForMode(nextMode);
        const runningGame = gameRef.current;
        const container = containerRef.current;
        if (runningGame && container) {
          const result = syncHiDpiScale(runningGame, container, qualityStep);
          qualityProfile = result.profile;
          qualityMaxStep = result.maxQualityStep;
          qualityStep = result.appliedQualityStep;
          runningGame.registry.set('renderQualityMode', nextMode);
        }

        if (nextMode === 'adaptive') {
          startPerformanceMonitor();
          setRuntimeMarkerTracking(true);
        } else {
          stopPerformanceMonitor();
          setRuntimeMarkerTracking(false);
        }
      };
    };

    void initializeGame();

    return () => {
      isUnmounted = true;
      stopPerformanceMonitor();
      setRuntimeMarkerTracking(false);
      if (resizeRafId !== 0) {
        window.cancelAnimationFrame(resizeRafId);
      }
      applyQualityModeRef.current = null;
      window.removeEventListener('resize', scheduleHiDpiSync);
      window.removeEventListener('orientationchange', scheduleHiDpiSync);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      const game = gameRef.current;
      if (!game) return;
      if (game.canvas) {
        if (contextLostHandler) {
          game.canvas.removeEventListener('webglcontextlost', contextLostHandler, false);
          contextLostHandler = null;
        }
        if (contextRestoredHandler) {
          game.canvas.removeEventListener('webglcontextrestored', contextRestoredHandler, false);
          contextRestoredHandler = null;
        }
      }
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    qualityModeRef.current = qualityMode;
    if (!applyQualityModeRef.current) return;
    applyQualityModeRef.current(qualityMode);
  }, [qualityMode]);

  return <div ref={containerRef} className="w-full h-full" />;
};
