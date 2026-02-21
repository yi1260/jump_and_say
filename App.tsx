import type Phaser from 'phaser';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BugReportButton } from './components/BugReportButton';
import CompletionOverlay from './components/CompletionOverlay';
import GameBackground from './components/GameBackground';
import { GameCanvas, type QualityMode } from './components/GameCanvas';
import { LoadingScreen } from './components/LoadingScreen';
import { MainScene } from './game/scenes/MainScene';
import { isCoverFailed, isCoverPreloaded, loadThemes, markCoverFailed, markCoverPreloaded, pauseBackgroundPreloading, preloadCoverImages, startBackgroundPreloading } from './gameConfig';
import { preloadAllGameAssets } from './services/assetLoader';
import { CameraSessionManager, isCameraPipelineError } from './services/cameraSessionManager';
import { loggerService } from './services/logger';
import { motionController } from './services/motionController';
import { getLocalAssetUrl, getR2AssetUrl, getR2ImageUrl } from './src/config/r2Config';
import { PoseLandmark, Theme, ThemeId } from './types';

declare global {
  interface Window {
    setBGMVolume?: (vol: number) => void;
    restoreBGMVolume?: () => void;
    ensureAudioUnlocked?: () => Promise<boolean>;
    phaserGame?: Phaser.Game;
  }
}

export enum GamePhase {
  MENU = 'MENU',
  THEME_SELECTION = 'THEME_SELECTION',
  LOADING = 'LOADING',
  TUTORIAL = 'TUTORIAL',
  PLAYING = 'PLAYING'
}

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  fullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitIsFullScreen?: boolean;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

const QUALITY_MODE_OPTIONS: Array<{ value: QualityMode; label: string }> = [
  { value: 'high', label: '最高' },
  { value: 'medium', label: '中等' },
  { value: 'low', label: '最低' },
  { value: 'adaptive', label: '自适应' }
];

const ThemeCardImage = ({ src, alt, index }: { src: string; alt: string; index: number }) => {
    const [loaded, setLoaded] = useState<boolean>(() => isCoverPreloaded(src));
    const [shouldAnimate, setShouldAnimate] = useState<boolean>(() => !isCoverPreloaded(src));
    const [isFailed, setIsFailed] = useState<boolean>(() => isCoverFailed(src));
    const fetchPriorityAttr: 'high' | 'auto' = index < 12 ? 'high' : 'auto';
    const imageRef = useRef<HTMLImageElement | null>(null);

    const handleImageLoad = useCallback(() => {
      markCoverPreloaded(src);
      setIsFailed(false);
      setLoaded(true);
    }, [src]);

    const handleImageError = useCallback(() => {
      markCoverFailed(src);
      setIsFailed(true);
      setLoaded(false);
      setShouldAnimate(false);
    }, [src]);
    
    useEffect(() => {
        if (isCoverFailed(src)) {
          setIsFailed(true);
          setLoaded(false);
          setShouldAnimate(false);
          return;
        }

        const alreadyLoaded = isCoverPreloaded(src);
        if (alreadyLoaded) {
            setLoaded(true);
            setIsFailed(false);
            setShouldAnimate(false);
            return;
        }

        setIsFailed(false);
        setLoaded(false);
        setShouldAnimate(true);
        const imgElement = imageRef.current;
        if (imgElement && imgElement.complete && imgElement.naturalWidth > 0) {
          markCoverPreloaded(src);
          setLoaded(true);
          setShouldAnimate(false);
        }
    }, [src]);
  
    return (
      <>
        {/* Fallback pattern (visible until loaded) */}
        <div 
          className={`absolute inset-0 transition-opacity duration-500 rounded-xl ${loaded ? 'opacity-0' : 'opacity-100'}`}
          style={{ zIndex: 1 }}
        >
             <div className="absolute inset-0 opacity-5 pointer-events-none rounded-xl" style={{
                  backgroundImage: 'radial-gradient(circle, #333333 1px, transparent 1px)',
                  backgroundSize: '12px 12px'
              }} />
              
              <div className="absolute inset-1 rounded-lg opacity-15 pointer-events-none" style={{
                   background: ['#000000', '#1a1a1a', '#2d2d2d', '#333333', '#404040'][
                       index % 5
                   ]
               }} />
        </div>

        {/* Real Image (fades in) */}
        {!isFailed && (
          <img 
            ref={imageRef}
            src={src} 
            alt={alt}
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            onError={handleImageError}
            className={`absolute inset-0 w-full h-full object-cover rounded-[inherit] ${shouldAnimate ? 'transition-opacity duration-300' : ''} ${loaded ? 'opacity-100' : 'opacity-0'}`}
            style={{ zIndex: 2 }}
            loading={index < 12 ? 'eager' : 'lazy'}
            {...{ fetchpriority: fetchPriorityAttr }}
          />
        )}
        
        {/* Gradient Overlay (always visible for text contrast, but only needed when image is loaded? 
            Actually, the fallback has its own color. Let's keep gradient on top of image only.) 
        */}
        <div 
            className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent rounded-[inherit] ${shouldAnimate ? 'transition-opacity duration-300' : ''} ${loaded ? 'opacity-100' : 'opacity-0'}`} 
            style={{ zIndex: 3 }}
        />
      </>
    );
};

export default function App() {
  const BGM_VOLUME_PLAYING = 0.015;
  const BGM_VOLUME_IDLE = 0.015;
  const THEME_SWITCH_REST_SECONDS = 15;
  const [score, setScore] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [selectedThemes, setSelectedThemes] = useState<ThemeId[]>([]);
  const [isPortrait, setIsPortrait] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [restCountdownSeconds, setRestCountdownSeconds] = useState<number | null>(null);
  const [isBgmEnabled, setIsBgmEnabled] = useState(true);
  const [bgIndex, setBgIndex] = useState(0);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string>('AA');
  const [qualityMode, setQualityMode] = useState<QualityMode>('adaptive');
  const [isQualityPickerOpen, setIsQualityPickerOpen] = useState<boolean>(false);

  const levels = React.useMemo(() => {
    const allLevels = Array.from(new Set(themes.map(t => t.level).filter(Boolean))) as string[];
    const order = ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    return allLevels.sort((a, b) => {
      const idxA = order.indexOf(a);
      const idxB = order.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [themes]);

  const filteredThemes = React.useMemo(() => {
      // If no levels found (old data structure?), show all themes
      if (levels.length === 0) return themes;
      return themes.filter(t => t.level === selectedLevel);
  }, [themes, selectedLevel, levels]);
  const activeQualityLabel = React.useMemo(() => (
    QUALITY_MODE_OPTIONS.find((option) => option.value === qualityMode)?.label ?? '自适应'
  ), [qualityMode]);

  useEffect(() => {
    if (levels.length > 0 && !levels.includes(selectedLevel)) {
      setSelectedLevel(levels[0]);
    }
  }, [levels, selectedLevel]);

  const phaseRef = useRef<GamePhase>(GamePhase.MENU);
  const [phase, setPhaseState] = useState<GamePhase>(GamePhase.MENU);
  const [initStatus, setInitStatus] = useState<string>('');
  const [themeImagesLoaded, setThemeImagesLoaded] = useState(false);
  const [hasShownEmoji, setHasShownEmoji] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenApiSupported, setIsFullscreenApiSupported] = useState(true);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const isBgmEnabledRef = useRef<boolean>(isBgmEnabled);
  const isBgmPlayingRef = useRef<boolean>(false);
  const poseCanvasRef = useRef<HTMLCanvasElement>(null);
  const poseLoopRef = useRef<number | null>(null);
  const appRootRef = useRef<HTMLDivElement>(null);
  const qualityPickerRef = useRef<HTMLDivElement>(null);
  const scorePanelRef = useRef<HTMLDivElement>(null);
  const fullscreenActionInFlightRef = useRef(false);
  const lastFullscreenAttemptAtRef = useRef(0);

  const hasLoggedFullscreenUnsupportedRef = useRef(false);
  const loadingRequestIdRef = useRef(0);
  const completionCycleRef = useRef(0);
  const completionAutoAdvanceHandledCycleRef = useRef<number | null>(null);
  const restCountdownTimerRef = useRef<number | null>(null);
  const isCompletionTransitioningRef = useRef<boolean>(false);

  useEffect(() => {
    if (phase !== GamePhase.MENU) {
      setIsQualityPickerOpen(false);
    }
  }, [phase]);

  useEffect(() => {
    if (!isQualityPickerOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!qualityPickerRef.current) return;
      if (!qualityPickerRef.current.contains(target)) {
        setIsQualityPickerOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isQualityPickerOpen]);
  
  // Loading State
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('正在准备...');
  const [cameraIssueMessage, setCameraIssueMessage] = useState('');
  const [isPoseDetected, setIsPoseDetected] = useState(false);
  const isPoseDetectedRef = useRef<boolean>(false);
  const lastPoseSeenAtRef = useRef<number>(0);
  const hasCalibratedPoseRef = useRef<boolean>(false);

  const POSE_CONNECTIONS: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3],
    [0, 4], [4, 5], [5, 6],
    [1, 7], [4, 8],
    [9, 10],
    [11, 12],
    [11, 13], [13, 15],
    [12, 14], [14, 16],
    [15, 17], [15, 19], [15, 21],
    [16, 18], [16, 20], [16, 22],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [27, 29], [29, 31],
    [24, 26], [26, 28], [28, 30], [30, 32]
  ];

  const setPoseDetectedState = useCallback((nextDetected: boolean): void => {
    if (isPoseDetectedRef.current === nextDetected) return;
    isPoseDetectedRef.current = nextDetected;
    setIsPoseDetected(nextDetected);
  }, []);

  const markPoseObserved = useCallback((observedAtMs: number): void => {
    lastPoseSeenAtRef.current = observedAtMs;
    setPoseDetectedState(true);
    if (!hasCalibratedPoseRef.current) {
      hasCalibratedPoseRef.current = true;
      motionController.calibrate();
    }
  }, [setPoseDetectedState]);

  const refreshPoseDetectedState = useCallback((nowMs: number): boolean => {
    const hasFreshPose = motionController.hasFreshPoseLandmarks(nowMs - 1200);
    if (hasFreshPose) {
      markPoseObserved(nowMs);
      return true;
    }
    if (isPoseDetectedRef.current && nowMs - lastPoseSeenAtRef.current > 2200) {
      setPoseDetectedState(false);
    }
    return false;
  }, [markPoseObserved, setPoseDetectedState]);

  const getBgmTargetVolume = (targetPhase: GamePhase): number => {
    return targetPhase === GamePhase.PLAYING ? BGM_VOLUME_PLAYING : BGM_VOLUME_IDLE;
  };

  const applyBgmState = (enabled: boolean): void => {
    const audio = bgmAudioRef.current;
    if (!audio) return;

    const shouldPlay = enabled;
    if (shouldPlay) {
      audio.muted = false;
      audio.volume = getBgmTargetVolume(phaseRef.current);
      audio.play().then(() => {
        isBgmPlayingRef.current = true;
      }).catch(() => {});
    } else {
      audio.pause();
      audio.muted = true;
      audio.volume = 0;
      isBgmPlayingRef.current = false;
    }
  };

  const setBgmEnabled = (enabled: boolean): void => {
    isBgmEnabledRef.current = enabled;
    setIsBgmEnabled(enabled);
    applyBgmState(enabled);
  };
  
  const setPhase = (newPhase: GamePhase) => {
    const prevPhase = phaseRef.current;
    if (newPhase === GamePhase.PLAYING) {
      setBgmEnabled(false);
    } else if (prevPhase === GamePhase.PLAYING) {
      setBgmEnabled(true);
    }

    phaseRef.current = newPhase;
    setPhaseState(newPhase);
    
    // Update BGM volume based on phase (e.g. might be different in MENU vs PLAYING)
    applyBgmState(isBgmEnabledRef.current);
  };

  const clearRestCountdown = useCallback((): void => {
    if (restCountdownTimerRef.current !== null) {
      window.clearInterval(restCountdownTimerRef.current);
      restCountdownTimerRef.current = null;
    }
    setRestCountdownSeconds(null);
    isCompletionTransitioningRef.current = false;
  }, []);

  const waitMs = (ms: number): Promise<void> => (
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    })
  );

  const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    const maybeThen = (value as { then?: unknown }).then;
    return typeof maybeThen === 'function';
  };

  const awaitWithTimeout = async (value: PromiseLike<unknown>, timeoutMs: number): Promise<void> => {
    let timeoutId: number | null = null;
    try {
      await Promise.race([
        Promise.resolve(value).then(() => undefined),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error('FULLSCREEN_TIMEOUT'));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  };

  const getFullscreenElement = useCallback((): Element | null => {
    const fullscreenDoc = document as FullscreenCapableDocument;
    if (fullscreenDoc.webkitIsFullScreen) {
      return document.documentElement;
    }
    return (
      document.fullscreenElement ??
      fullscreenDoc.webkitFullscreenElement ??
      fullscreenDoc.webkitCurrentFullScreenElement ??
      fullscreenDoc.mozFullScreenElement ??
      fullscreenDoc.msFullscreenElement ??
      null
    );
  }, []);

  const syncFullscreenState = useCallback((): void => {
    setIsFullscreen(Boolean(getFullscreenElement()));
  }, [getFullscreenElement]);

  const getFullscreenRequestTargets = useCallback((): Array<{ element: FullscreenCapableElement; label: 'app-root' | 'document-element' }> => {
    const targets: Array<{ element: FullscreenCapableElement; label: 'app-root' | 'document-element' }> = [];
    if (appRootRef.current) {
      targets.push({ element: appRootRef.current, label: 'app-root' });
    }
    const documentElement = document.documentElement as FullscreenCapableElement;
    if (!appRootRef.current || appRootRef.current !== documentElement) {
      targets.push({ element: documentElement, label: 'document-element' });
    }
    return targets;
  }, []);

  const hasFullscreenApi = useCallback((): boolean => {
    const fullscreenDoc = document as FullscreenCapableDocument;
    const hasRequestMethod = getFullscreenRequestTargets().some(({ element }) => (
      Boolean(
        element.requestFullscreen ||
        element.webkitRequestFullscreen ||
        element.webkitRequestFullScreen ||
        element.mozRequestFullScreen ||
        element.msRequestFullscreen
      )
    ));
    const hasExitMethod = Boolean(
      document.exitFullscreen ||
      fullscreenDoc.webkitExitFullscreen ||
      fullscreenDoc.webkitCancelFullScreen ||
      fullscreenDoc.mozCancelFullScreen ||
      fullscreenDoc.msExitFullscreen
    );
    return hasRequestMethod || hasExitMethod;
  }, [getFullscreenRequestTargets]);

  const requestFullscreenSafely = useCallback(async (source: 'auto' | 'manual'): Promise<boolean> => {
    const now = Date.now();
    if (fullscreenActionInFlightRef.current) return false;
    if (source === 'auto' && now - lastFullscreenAttemptAtRef.current < 350) return false;

    lastFullscreenAttemptAtRef.current = now;

    const fullscreenApiSupported = hasFullscreenApi();
    setIsFullscreenApiSupported(fullscreenApiSupported);
    if (!fullscreenApiSupported) {
      if (!hasLoggedFullscreenUnsupportedRef.current) {
        console.warn('[Fullscreen] API unavailable on this browser/environment.');
        hasLoggedFullscreenUnsupportedRef.current = true;
      }
      return false;
    }

    if (getFullscreenElement()) {
      setIsFullscreen(true);
      return true;
    }

    if (document.visibilityState !== 'visible') {
      return false;
    }

    fullscreenActionInFlightRef.current = true;
    try {
      const targets = getFullscreenRequestTargets();
      let lastError: unknown = null;
      for (const { element, label } of targets) {
        const requestMethod =
          element.requestFullscreen ||
          element.webkitRequestFullscreen ||
          element.webkitRequestFullScreen ||
          element.mozRequestFullScreen ||
          element.msRequestFullscreen;

        if (!requestMethod) {
          continue;
        }

        try {
          const maybePromise = requestMethod.call(element);
          if (isPromiseLike(maybePromise)) {
            await awaitWithTimeout(maybePromise, 1600);
          }
          await waitMs(120);
          if (getFullscreenElement()) {
            setIsFullscreen(true);
            return true;
          }
        } catch (error) {
          lastError = error;
          console.warn(`[Fullscreen] request failed on ${label}:`, error);
        }
      }

      if (lastError) {
        console.warn('[Fullscreen] all request attempts failed.');
      }
      return false;
    } catch (error) {
      console.warn('[Fullscreen] request failed:', error);
      return false;
    } finally {
      fullscreenActionInFlightRef.current = false;
      syncFullscreenState();
    }
  }, [getFullscreenElement, getFullscreenRequestTargets, hasFullscreenApi, syncFullscreenState]);

  const exitFullscreenSafely = useCallback(async (source: 'manual' | 'leave_game'): Promise<boolean> => {
    if (fullscreenActionInFlightRef.current) return false;
    if (!getFullscreenElement()) {
      setIsFullscreen(false);
      return true;
    }

    fullscreenActionInFlightRef.current = true;
    try {
      const fullscreenDoc = document as FullscreenCapableDocument;
      const exitMethod =
        document.exitFullscreen ||
        fullscreenDoc.webkitExitFullscreen ||
        fullscreenDoc.webkitCancelFullScreen ||
        fullscreenDoc.mozCancelFullScreen ||
        fullscreenDoc.msExitFullscreen;

      if (exitMethod) {
        const maybePromise = exitMethod.call(document);
        if (isPromiseLike(maybePromise)) {
          await awaitWithTimeout(maybePromise, 1600);
        }
        await waitMs(120);
      } else {
        setIsFullscreenApiSupported(false);
        if (!hasLoggedFullscreenUnsupportedRef.current) {
          console.warn('[Fullscreen] exit API unavailable on this browser/environment.');
          hasLoggedFullscreenUnsupportedRef.current = true;
        }
      }
      
      const isStillFullscreen = Boolean(getFullscreenElement());
      if (!isStillFullscreen) {
        setIsFullscreen(false);
        return true;
      }
      return false;
    } catch (error) {
      console.warn(`[Fullscreen] exit failed (${source}):`, error);
      return false;
    } finally {
      fullscreenActionInFlightRef.current = false;
      syncFullscreenState();
    }
  }, [getFullscreenElement, syncFullscreenState]);

  const handleToggleFullscreen = useCallback((e?: React.MouseEvent | React.TouchEvent): void => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (getFullscreenElement()) {
      void exitFullscreenSafely('manual');
      return;
    }
    void requestFullscreenSafely('manual');
  }, [exitFullscreenSafely, getFullscreenElement, requestFullscreenSafely]);

  useEffect(() => {
    const supported = hasFullscreenApi();
    setIsFullscreenApiSupported(supported);
    if (supported) {
      hasLoggedFullscreenUnsupportedRef.current = false;
    }
  }, [hasFullscreenApi]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraSessionManagerRef = useRef<CameraSessionManager>(new CameraSessionManager());
  const initializeCameraRef = useRef<() => Promise<boolean>>(async () => false);
  const startPoseOverlayLoopRef = useRef<() => void>(() => undefined);
  const isForegroundRecoveryInFlightRef = useRef<boolean>(false);
  const lastForegroundRecoveryAtRef = useRef<number>(0);

  useEffect(() => {
    loggerService.init();
    return () => {
      loggerService.destroy();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (poseLoopRef.current !== null) {
        cancelAnimationFrame(poseLoopRef.current);
        poseLoopRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    isBgmEnabledRef.current = isBgmEnabled;
  }, [isBgmEnabled]);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      syncFullscreenState();
    };
    const handleFullscreenError = (event: Event): void => {
      console.warn('[Fullscreen] fullscreenerror event:', event.type);
      syncFullscreenState();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', handleFullscreenError);
    document.addEventListener('webkitfullscreenerror', handleFullscreenError);
    document.addEventListener('mozfullscreenerror', handleFullscreenError);
    document.addEventListener('MSFullscreenError', handleFullscreenError);

    syncFullscreenState();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      document.removeEventListener('fullscreenerror', handleFullscreenError);
      document.removeEventListener('webkitfullscreenerror', handleFullscreenError);
      document.removeEventListener('mozfullscreenerror', handleFullscreenError);
      document.removeEventListener('MSFullscreenError', handleFullscreenError);
    };
  }, [syncFullscreenState]);

  useEffect(() => {
    if (phase !== GamePhase.PLAYING) {
      return;
    }

    let cancelled = false;
    const autoEnterTimer = window.setTimeout(() => {
      if (cancelled) return;
      void requestFullscreenSafely('auto').then((entered) => {
        if (!entered) {
          console.info('[Fullscreen] Auto-enter skipped or rejected. Continue windowed mode.');
        }
      });
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(autoEnterTimer);
    };
  }, [phase, requestFullscreenSafely]);

  useEffect(() => {
    let bgmAudio: HTMLAudioElement | null = null;
    let hasTriedFallback = false;
    let htmlAudioUnlocked = false;
    
    const updateVolume = (vol: number) => {
      if (bgmAudio) {
        if (!isBgmEnabledRef.current) {
          bgmAudio.volume = 0;
          return;
        }
        bgmAudio.volume = vol;
      }
    };
    
    window.setBGMVolume = updateVolume;
    window.restoreBGMVolume = () => {
      updateVolume(isBgmEnabledRef.current ? getBgmTargetVolume(phaseRef.current) : 0);
    };

    const ensureAudioUnlocked = async (): Promise<boolean> => {
      if (!bgmAudio) return false;
      if (htmlAudioUnlocked || isBgmPlayingRef.current || !bgmAudio.paused) {
        htmlAudioUnlocked = true;
        return true;
      }

      const previousMuted = bgmAudio.muted;
      try {
        bgmAudio.muted = true;
        bgmAudio.volume = 0;
        await bgmAudio.play();
        bgmAudio.pause();
        try {
          bgmAudio.currentTime = 0;
        } catch {
          // Ignore currentTime reset failures on some mobile browsers.
        }
        htmlAudioUnlocked = true;
        console.log('[Audio] HTMLMedia playback unlocked by user interaction.');
        return true;
      } catch (error) {
        console.warn('[Audio] HTMLMedia unlock attempt failed:', error);
        return false;
      } finally {
        if (!bgmAudio) return;
        const shouldPlayBgm = isBgmEnabledRef.current;
        if (!shouldPlayBgm && !bgmAudio.paused) {
          bgmAudio.pause();
        }
        if (!shouldPlayBgm) {
          bgmAudio.muted = true;
          bgmAudio.volume = 0;
        } else {
          bgmAudio.muted = previousMuted;
          bgmAudio.volume = getBgmTargetVolume(phaseRef.current);
        }
      }
    };

    window.ensureAudioUnlocked = ensureAudioUnlocked;
    
    const initBGM = async () => {
      if (isBgmPlayingRef.current) return;
      
      const bgmCdnUrl = getR2AssetUrl('assets/kenney/Sounds/funny-kids-video-322163.mp3');
      const bgmLocalUrl = getLocalAssetUrl(bgmCdnUrl);
      bgmAudio = new Audio(bgmCdnUrl);
      bgmAudioRef.current = bgmAudio;
      bgmAudio.loop = true;
      const shouldPlay = isBgmEnabledRef.current;
      bgmAudio.volume = shouldPlay ? getBgmTargetVolume(phaseRef.current) : 0;
      bgmAudio.muted = !shouldPlay;
      bgmAudio.preload = 'auto';
      bgmAudio.addEventListener('play', () => {
        isBgmPlayingRef.current = true;
      });
      bgmAudio.addEventListener('pause', () => {
        isBgmPlayingRef.current = false;
      });
      bgmAudio.addEventListener('ended', () => {
        isBgmPlayingRef.current = false;
      });
      bgmAudio.addEventListener('error', () => {
        if (!bgmAudio || hasTriedFallback) return;
        hasTriedFallback = true;
        bgmAudio.src = bgmLocalUrl;
        bgmAudio.load();
        if (isBgmPlayingRef.current) {
          bgmAudio.play().catch(() => {});
        }
      });
      
      if (isBgmEnabledRef.current) {
        try {
          await bgmAudio.play();
          isBgmPlayingRef.current = true;
          htmlAudioUnlocked = true;
          console.log('BGM started playing');
        } catch (e) {
          console.log('BGM play failed, waiting for user interaction:', e);
        }
      }
    };
    
    initBGM();
    
    const handleInteraction = () => {
      if (!bgmAudio) return;
      void ensureAudioUnlocked();
      if (!isBgmEnabledRef.current) return;
      if (!isBgmPlayingRef.current) {
        bgmAudio.play().then(() => {
          isBgmPlayingRef.current = true;
          htmlAudioUnlocked = true;
        }).catch(() => {});
      }
    };
    
    // Handle page visibility change (browser minimized/tab hidden)
    const handleVisibilityChange = () => {
      if (!bgmAudio) return;
      
      if (document.hidden) {
        // Page is hidden (browser minimized or tab switched)
        if (!bgmAudio.paused) {
          bgmAudio.pause();
          console.log('[BGM] Paused due to page visibility change');
        }
      } else {
        // Page is visible again
        if (isBgmEnabledRef.current && bgmAudio.paused) {
          bgmAudio.play().then(() => {
            isBgmPlayingRef.current = true;
            console.log('[BGM] Resumed after page visibility change');
          }).catch(() => {});
        }
      }
    };
    
    document.addEventListener('click', handleInteraction, true);
    document.addEventListener('touchstart', handleInteraction, true);
    document.addEventListener('keydown', handleInteraction, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('click', handleInteraction, true);
      document.removeEventListener('touchstart', handleInteraction, true);
      document.removeEventListener('keydown', handleInteraction, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (bgmAudio) {
        bgmAudio.pause();
        bgmAudio.src = '';
        bgmAudio = null;
      }
      bgmAudioRef.current = null;
      isBgmPlayingRef.current = false;
      window.setBGMVolume = undefined;
      window.restoreBGMVolume = undefined;
      window.ensureAudioUnlocked = undefined;
    };
  }, []);

  useEffect(() => {
    // Add custom animation styles directly to the document
    const style = document.createElement('style');
    const fredokaRegularLocalUrl = '/assets/fonts/Fredoka/static/Fredoka-Regular.ttf';
    const fredokaRegularCdnUrl = getR2AssetUrl('assets/fonts/Fredoka/static/Fredoka-Regular.ttf');
    const fredokaBoldLocalUrl = '/assets/fonts/Fredoka/static/Fredoka-Bold.ttf';
    const fredokaBoldCdnUrl = getR2AssetUrl('assets/fonts/Fredoka/static/Fredoka-Bold.ttf');
    const zcoolUiSubsetLocalUrl = '/assets/fonts/Zcool/zcool-kuaile-ui-subset.woff2';
    const zcoolUiSubsetCdnUrl = getR2AssetUrl('assets/fonts/Zcool/zcool-kuaile-ui-subset.woff2');
    const zcoolLocalUrl = '/assets/fonts/Zcool/zcool-kuaile-chinese-simplified-400-normal.woff2';
    const zcoolCdnUrl = getR2AssetUrl('assets/fonts/Zcool/zcool-kuaile-chinese-simplified-400-normal.woff2');
    const uiFontStack = `'FredokaBoot', 'FredokaLatin', 'Fredoka', 'ZCOOL KuaiLe UI', 'ZCOOL KuaiLe', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, -apple-system, sans-serif`;
    const fontSet: FontFaceSet | null = 'fonts' in document ? document.fonts : null;

    const monitorFredokaFontLoad = async (): Promise<void> => {
      if (!fontSet) {
        console.warn('[Font] FontFaceSet API is not available; cannot verify FredokaBoot load state.');
        return;
      }

      const fontSpecs = [
        '400 24px "FredokaBoot"',
        '700 24px "FredokaBoot"',
        '900 24px "FredokaBoot"',
        '400 24px "ZCOOL KuaiLe UI"'
      ];

      await Promise.race([
        Promise.allSettled(fontSpecs.map((spec) => fontSet.load(spec))),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2500))
      ]);

      const missingSpecs = fontSpecs.filter((spec) => !fontSet.check(spec));
      if (missingSpecs.length > 0) {
        await Promise.allSettled(missingSpecs.map((spec) => fontSet.load(spec)));
      }

      const stillMissingSpecs = fontSpecs.filter((spec) => !fontSet.check(spec));
      if (stillMissingSpecs.length > 0) {
        console.warn('[Font] FredokaBoot failed to load completely.', {
          missingSpecs: stillMissingSpecs,
          regularUrl: fredokaRegularCdnUrl,
          boldUrl: fredokaBoldCdnUrl
        });
      } else {
        console.info('[Font] FredokaBoot loaded successfully for UI.');
      }
    };

    const handleFontLoadingError = (): void => {
      console.warn('[Font] Browser reported a font loading error event while loading FredokaBoot.');
    };

    fontSet?.addEventListener('loadingerror', handleFontLoadingError);
    void monitorFredokaFontLoad();

    style.innerHTML = `
      @font-face {
        font-family: 'FredokaBoot';
        src: url('${fredokaRegularCdnUrl}') format('truetype'), url('${fredokaRegularLocalUrl}') format('truetype');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'FredokaBoot';
        src: url('${fredokaBoldCdnUrl}') format('truetype'), url('${fredokaBoldLocalUrl}') format('truetype');
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'FredokaBoot';
        src: url('${fredokaBoldCdnUrl}') format('truetype'), url('${fredokaBoldLocalUrl}') format('truetype');
        font-weight: 900;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'ZCOOL KuaiLe UI';
        src: url('${zcoolUiSubsetCdnUrl}') format('woff2'), url('${zcoolUiSubsetLocalUrl}') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'ZCOOL KuaiLe';
        src: url('${zcoolCdnUrl}') format('woff2'), url('${zcoolLocalUrl}') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      body, button, div, span, h1, h2, h3 {
        font-family: ${uiFontStack} !important;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .brand-title,
      .tabular-nums,
      .number-font {
        font-family: ${uiFontStack} !important;
      }

      .menu-shell,
      .menu-shell *,
      .theme-shell,
      .theme-shell *,
      .tutorial-shell,
      .tutorial-shell * {
        font-family: ${uiFontStack} !important;
      }

      .non-game-shell[lang='zh-CN'] h2:not(.brand-title),
      .non-game-shell[lang='zh-CN'] h3,
      .non-game-shell[lang='zh-CN'] p,
      .non-game-shell[lang='zh-CN'] button span,
      .non-game-shell[lang='zh-CN'] button {
        filter: none !important;
        text-shadow: none !important;
        font-family: ${uiFontStack} !important;
        letter-spacing: 0.02em;
      }

      .non-game-shell[lang='zh-CN'] .loading-title {
        font-size: clamp(1.35rem, 4vw, 2.4rem);
      }

      .non-game-shell[lang='zh-CN'] .loading-status {
        font-size: clamp(0.95rem, 2.25vw, 1.2rem);
        line-height: 1.35;
      }

      .non-game-shell[lang='zh-CN'] .theme-card-title {
        font-size: clamp(0.78rem, 1.5vw, 1rem) !important;
        line-height: 1.2 !important;
      }

      .non-game-shell[lang='zh-CN'] .tutorial-title {
        letter-spacing: 0.04em;
      }

      .non-game-shell[lang='zh-CN'] .tutorial-card-title {
        font-size: clamp(0.95rem, 2.5vw, 1.5rem) !important;
        line-height: 1.2 !important;
        font-weight: 400 !important;
      }

      @keyframes rotate-device {
        0%, 10% { transform: rotate(0deg); }
        40%, 60% { transform: rotate(-90deg); }
        90%, 100% { transform: rotate(0deg); }
      }
      .animate-rotate-device {
        animation: rotate-device 2s ease-in-out infinite;
      }
      .kenney-panel-textured {
        background-color: #ffffff;
        background-image: radial-gradient(rgba(51, 51, 51, 0.05) 1.5px, transparent 1.5px);
        background-size: 8px 8px;
        background-position: 0 0;
        background-repeat: repeat;
        border: 4px solid #333333;
        border-radius: 20px;
        box-shadow: 6px 6px 0px #333333;
      }

      .non-game-shell {
        padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)) !important;
      }

      .non-game-scale {
        --ui-scale: 1;
        transform: scale(var(--ui-scale));
        transform-origin: center;
      }

      .menu-shell,
      .theme-shell,
      .tutorial-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: var(--app-height, 100dvh);
        overflow: hidden;
      }

      .theme-grid-wrap {
        width: 100%;
        display: flex;
        justify-content: center;
      }

      .theme-start {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
        padding-top: 1rem;
        z-index: 50;
        pointer-events: none;
      }
      
      .theme-start button {
        pointer-events: auto;
      }

      @media (max-width: 640px) {
        .menu-shell {
          padding-top: 0.5rem !important;
          padding-bottom: 0.5rem !important;
        }
        .tutorial-shell {
          padding-top: 3vh !important;
        }
      }

      @media (max-height: 640px) {
        .menu-shell {
          padding-top: 0.25rem !important;
          padding-bottom: 0.25rem !important;
        }
        .tutorial-shell {
          padding-top: 2vh !important;
        }
      }

      @media (max-width: 768px) {
        .non-game-scale {
          --ui-scale: 0.95;
        }
      }

      @media (max-height: 640px) {
        .non-game-scale {
          --ui-scale: 0.9;
        }
      }

      @media (max-height: 520px) {
        .non-game-scale {
          --ui-scale: 0.82;
        }
      }

      @media (max-height: 420px) {
        .non-game-scale {
          --ui-scale: 0.75;
        }
      }

      @media (max-width: 640px) {
        .mobile-landscape-title {
          font-size: clamp(1.6rem, 8.5vw, 3rem) !important;
        }
        .home-landscape-title {
          font-size: clamp(2.5rem, 10vw, 4.5rem) !important;
        }
        .mobile-landscape-button {
          padding: 0.5rem 1.75rem !important;
          font-size: clamp(1rem, 4.8vw, 1.6rem) !important;
        }
        .mobile-landscape-character {
          width: 5.5rem !important;
          height: 5.5rem !important;
        }
        .theme-card {
          height: 3.25rem !important;
          padding: 0.5rem !important;
        }
        .theme-card-title {
          font-size: 0.75rem !important;
        }
        .theme-badge {
          width: 1.5rem !important;
          height: 1.5rem !important;
        }
        .theme-badge span {
          font-size: 0.6rem !important;
        }
      }

      @media (max-height: 640px) {
        .tutorial-title {
          font-size: clamp(1.4rem, 6vh, 2.2rem) !important;
        }
        .tutorial-card-title {
          font-size: clamp(0.9rem, 3.2vh, 1.3rem) !important;
        }
        .tutorial-card-subtitle {
          font-size: clamp(0.65rem, 2.4vh, 0.9rem) !important;
        }
        .tutorial-card-img {
          width: 10vh !important;
          height: 10vh !important;
        }
      }

      @media (max-height: 520px) {
        .tutorial-card {
          padding: 0.75rem !important;
        }
      }

      .loading-content {
        gap: 1.5rem;
      }

      .loading-character {
        width: clamp(5rem, 12vw, 10rem);
        height: clamp(5rem, 12vw, 10rem);
      }

      .loading-title {
        font-size: clamp(1.6rem, 4.5vw, 3rem);
      }

      .loading-bar {
        height: clamp(2rem, 4.5vw, 3rem);
      }

      .loading-status {
        font-size: clamp(0.85rem, 2.4vw, 1.25rem);
      }

      @media (max-height: 560px) {
        .loading-content {
          flex-direction: row;
          text-align: left;
          gap: 1rem;
        }
        .loading-text {
          align-items: flex-start;
        }
        .loading-character {
          width: 5rem;
          height: 5rem;
        }
        .loading-bar {
          height: 2rem;
        }
      }

      .live-view-video {
        /* Filter removed for clear view */
      }
      
      .live-view-texture {
        background-image: radial-gradient(rgba(0, 0, 0, 0.25) 1px, transparent 1px);
        background-size: 3px 3px;
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 1;
      }
      
      #bgm-audio {
        display: none;
      }
      
      .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }

      /* Smooth scrolling with GPU acceleration */
      .scrollbar-hide {
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
      }

      /* Theme grid performance optimizations */
      .theme-grid {
        contain: layout style paint;
      }

      /* Landscape Specific Fixes (Any height) */
      @media (orientation: landscape) {
        .landscape-compact-title {
          font-size: clamp(1.2rem, 6vh, 2.5rem) !important;
          margin-bottom: 0.5vh !important;
        }
        .landscape-compact-card {
          padding: 1vh !important;
          gap: 0.5vh !important;
        }
        .landscape-compact-img {
          width: 12vh !important;
          height: 12vh !important;
        }
        .landscape-compact-button {
          padding: 1vh 4vw !important;
          font-size: clamp(1rem, 5vh, 1.8rem) !important;
        }
      }

      /* Landscape Mobile Specific Fixes (Height constrained) */
      @media (max-height: 700px) and (orientation: landscape) {
        .mobile-landscape-control {
          transform: scale(0.7) !important;
          transform-origin: top left !important;
          top: 1rem !important;
          left: 1rem !important;
        }
        .mobile-landscape-camera {
          transform: scale(0.7) !important;
          transform-origin: top right !important;
          top: 1rem !important;
          right: 1rem !important;
        }
      }

      @media (max-height: 480px) {
        .mobile-landscape-title {
          font-size: 2.2rem !important;
          line-height: 1 !important;
          padding-top: 0.1rem !important;
          padding-bottom: 0.1rem !important;
          margin-bottom: 0.25rem !important;
        }
        .home-landscape-title {
          font-size: 3.5rem !important;
          line-height: 1 !important;
          padding-top: 0.1rem !important;
          padding-bottom: 0.1rem !important;
          margin-bottom: 0.25rem !important;
        }
        .mobile-landscape-character {
          width: 6rem !important;
          height: 6rem !important;
        }
        .mobile-landscape-button {
          padding: 0.4rem 2rem !important;
          font-size: 1.2rem !important;
        }
        .mobile-landscape-control {
          transform: scale(0.45) !important;
          transform-origin: top left !important;
          top: 0.2rem !important;
          left: 0.2rem !important;
        }
        .mobile-landscape-camera {
          transform: scale(0.45) !important;
          transform-origin: top right !important;
          top: 0.2rem !important;
          right: 0.2rem !important;
        }
        .mobile-landscape-panel {
          padding: 0.4rem !important;
        }
        .mobile-landscape-grid {
          gap: 0.5rem !important;
        }
        .mobile-landscape-card-img {
          width: 3rem !important;
          height: 3rem !important;
        }
        .mobile-landscape-card-text {
          font-size: 0.9rem !important;
          margin-bottom: 0.2rem !important;
        }
        .mobile-landscape-tutorial-grid {
          display: flex !important;
          flex-direction: row !important;
          gap: 0.75rem !important;
          width: 100% !important;
          max-width: 600px !important;
          justify-content: center !important;
          flex: 1 !important;
          min-height: 0 !important;
          align-items: center !important;
        }
        .mobile-landscape-tutorial-card {
          flex: 1 !important;
          max-width: 220px !important;
          height: 100% !important;
          max-height: 180px !important;
          padding: 0.6rem !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          align-items: center !important;
        }
        .mobile-landscape-card-badge {
          padding: 0.2rem 0.6rem !important;
        }
        .mobile-landscape-card-badge-text {
          font-size: 0.6rem !important;
        }

        /* Theme Grid Responsive Fixes */
        .theme-selection-container {
          gap: 0.5rem !important;
        }
        .theme-grid {
          gap: 0.75rem !important;
        }
        .theme-card {
          border-width: 2px !important;
          padding: 0.5rem !important;
        }
        .theme-card-title {
          font-size: 0.9rem !important;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .theme-badge {
          font-size: 8px !important;
          padding: 0.25rem 0.5rem !important;
        }
      }

      @media (max-height: 600px) and (max-width: 768px) {
        .theme-card-title {
          font-size: 1rem !important;
        }
      }

      /* Keep PLAYING HUD size consistent with windowed mode when fullscreen is enabled */
      .fullscreen-hud-match-windowed {
        transform: scale(0.7) !important;
        transform-origin: top left !important;
        top: 1rem !important;
        left: 1rem !important;
      }
      @media (max-height: 480px) {
        .fullscreen-hud-match-windowed {
          transform: scale(0.45) !important;
          top: 0.2rem !important;
          left: 0.2rem !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      fontSet?.removeEventListener('loadingerror', handleFontLoadingError);
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };

    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    checkOrientation();

    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  useEffect(() => {
    motionController.onMotionDetected = (type) => {
      // Logic for motion detection is handled in Phaser
    };
  }, []);

  useEffect(() => {
    const initThemes = async () => {
      const loadedThemes = await loadThemes();
      setThemes(loadedThemes);
    };
    initThemes();
  }, []);

  useEffect(() => {
    if (filteredThemes.length === 0) {
      return;
    }
    preloadCoverImages(filteredThemes);
  }, [filteredThemes]);

  const cleanupCameraAndMotion = useCallback((): void => {
    pauseBackgroundPreloading();
    motionController.stop();
    if (poseLoopRef.current !== null) {
      cancelAnimationFrame(poseLoopRef.current);
      poseLoopRef.current = null;
    }
    cameraSessionManagerRef.current.cleanupSession(videoRef.current, streamRef.current);
    streamRef.current = null;
    hasCalibratedPoseRef.current = false;
    lastPoseSeenAtRef.current = 0;
    setPoseDetectedState(false);
  }, [setPoseDetectedState]);

  const handleStartProcess = async () => {
    setCameraIssueMessage('');
    setPhase(GamePhase.THEME_SELECTION);
  };

  const handleToggleBgm = useCallback((e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      if (typeof e.cancelable !== 'boolean' || e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
    }

    setBgmEnabled(!isBgmEnabledRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (restCountdownTimerRef.current !== null) {
        window.clearInterval(restCountdownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updateAppHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--app-height', `${vh * 100}px`);
    };

    window.addEventListener('resize', updateAppHeight);
    window.addEventListener('orientationchange', updateAppHeight);
    
    // Initial call
    updateAppHeight();
    
    // Delayed call to handle address bar retraction on mobile load
    setTimeout(updateAppHeight, 100);
    setTimeout(updateAppHeight, 500);

    return () => {
      window.removeEventListener('resize', updateAppHeight);
      window.removeEventListener('orientationchange', updateAppHeight);
    };
  }, []);

  const handleBackToMenu = useCallback(() => {
    loadingRequestIdRef.current += 1;
    clearRestCountdown();
    void exitFullscreenSafely('leave_game');
    cleanupCameraAndMotion();
    setScore(0);
    setTotalQuestions(0);
    setShowCompletion(false);
    setSelectedThemes([]); // Clear selected themes
    setPhase(GamePhase.THEME_SELECTION);
  }, [cleanupCameraAndMotion, clearRestCountdown, exitFullscreenSafely]);

  const handleExitToMenu = () => {
    loadingRequestIdRef.current += 1;
    clearRestCountdown();
    void exitFullscreenSafely('leave_game');
    cleanupCameraAndMotion();

    setSelectedThemes([]); // Clear selected themes
    setPhase(GamePhase.MENU);
  };

  const handleThemeSelect = (themeId: ThemeId) => {
    setSelectedThemes(prev => {
      if (prev.includes(themeId)) {
        return prev.filter(id => id !== themeId);
      } else {
        return [...prev, themeId];
      }
    });
  };

  type CameraPermissionState = PermissionState | 'unsupported';
  type SimulatedFailure =
    | 'camera_api_missing'
    | 'camera_insecure'
    | 'camera_denied'
    | 'camera_blocked'
    | 'camera_not_found'
    | 'camera_busy'
    | 'camera_timeout'
    | 'pose_init_timeout'
    | 'asset_load_fail'
    | null;

  const getSimulatedFailure = (): SimulatedFailure => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('simulateFailure');
    if (!raw) return null;
    const normalized = raw.trim().toLowerCase();
    const allowed: Exclude<SimulatedFailure, null>[] = [
      'camera_api_missing',
      'camera_insecure',
      'camera_denied',
      'camera_blocked',
      'camera_not_found',
      'camera_busy',
      'camera_timeout',
      'pose_init_timeout',
      'asset_load_fail'
    ];
    return allowed.includes(normalized as Exclude<SimulatedFailure, null>)
      ? (normalized as Exclude<SimulatedFailure, null>)
      : null;
  };

  const isSimulatedFailure = (kind: Exclude<SimulatedFailure, null>): boolean => (
    getSimulatedFailure() === kind
  );

  const isInIframe = (): boolean => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  };

  const isLikelyInAppBrowser = (): boolean => {
    const ua = navigator.userAgent;
    return /MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line|wv\)|WebView/i.test(ua);
  };

  const getCameraPermissionState = async (): Promise<CameraPermissionState> => {
    const navWithPermissions = navigator as Navigator & {
      permissions?: {
        query?: (descriptor: { name: string }) => Promise<PermissionStatus>;
      };
    };
    const permissions = navWithPermissions.permissions;
    if (!permissions || typeof permissions.query !== 'function') {
      return 'unsupported';
    }

    try {
      const status = await permissions.query({ name: 'camera' });
      return status.state;
    } catch (error) {
      console.warn('[Camera] Permission query unsupported or failed:', error);
      return 'unsupported';
    }
  };

  const buildCameraGuidance = (
    reason: 'insecure' | 'api-missing' | 'denied' | 'blocked' | 'not-found' | 'busy' | 'timeout',
    inIframeContext: boolean,
    inAppBrowserContext: boolean
  ): string => {
    const tips: string[] = [];
    if (inAppBrowserContext) {
      tips.push('建议点击右上角用外部浏览器打开，不要在微信/QQ内置浏览器里玩。');
    }
    if (inIframeContext) {
      tips.push('当前页面可能是“嵌入页”，请单独打开游戏链接再试。');
    }

    if (reason === 'insecure') {
      return [
        '这个页面不是安全链接，摄像头无法使用。',
        '请确认网址以 https:// 开头，再重新打开。',
        ...tips
      ].join('\n');
    }
    if (reason === 'api-missing') {
      return [
        '当前浏览器不支持摄像头功能。',
        '请升级当前浏览器到最新版后再试。',
        ...tips
      ].join('\n');
    }
    if (reason === 'not-found') {
      return '没有找到可用摄像头，请检查设备摄像头是否可用（前置摄像头未损坏、未被系统禁用）。';
    }
    if (reason === 'busy') {
      return '摄像头正在被其他应用占用，请先关闭相机/视频通话类应用后重试。';
    }

    if (reason === 'denied') {
      return [
        '你之前拒绝了摄像头权限，所以这次不会自动弹窗。',
        '请到浏览器设置里，把这个网站的“摄像头”改成“允许”，然后刷新页面。',
        ...tips
      ].join('\n');
    }

    if (reason === 'timeout') {
      return [
        '等待摄像头授权超时，可能是权限弹窗没出来。',
        '请去浏览器设置手动允许摄像头，然后回到游戏重试。',
        ...tips
      ].join('\n');
    }

    return [
      '浏览器没有给摄像头权限。',
      '请在浏览器设置里允许摄像头后重试。',
      ...tips
    ].join('\n');
  };

  const initializeCamera = async (): Promise<boolean> => {
    const cameraSessionManager = cameraSessionManagerRef.current;

    const waitForPoseDetection = async (timeoutMs: number, sinceTimestampMs: number): Promise<boolean> => {
      const startedAt = performance.now();
      while (performance.now() - startedAt < timeoutMs) {
        const now = performance.now();
        if (motionController.hasFreshPoseLandmarks(sinceTimestampMs)) {
          markPoseObserved(now);
          return true;
        }
        refreshPoseDetectedState(now);
        await waitMs(120);
      }
      return false;
    };

    const startMotionWithTimeout = async (
      videoElement: HTMLVideoElement,
      timeoutMs: number
    ): Promise<void> => {
      const abortController = new AbortController();
      const timeoutId = window.setTimeout(() => {
        abortController.abort();
      }, timeoutMs);
      try {
        await motionController.start(videoElement, { signal: abortController.signal });
      } catch (error) {
        if (abortController.signal.aborted) {
          throw new Error('POSE_START_TIMEOUT');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const startMotionWithRetry = async (
      videoElement: HTMLVideoElement,
      retryCount: number
    ): Promise<void> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          motionController.resetPoseObservation();
          await startMotionWithTimeout(videoElement, 20000);
          return;
        } catch (error) {
          lastError = error;
          motionController.stop();
          if (attempt >= retryCount) break;
          console.warn('[Camera] Motion start failed, retrying...', {
            attempt: attempt + 1,
            retryCount,
            error
          });
          await waitMs(350);
        }
      }
      if (lastError instanceof Error) {
        throw lastError;
      }
      throw new Error('POSE_START_TIMEOUT');
    };

    const warmupPoseAfterEngineStart = async (label: string): Promise<void> => {
      setLoadingStatus('识别引擎已启动，正在等待人体进入镜头...');
      const detectionSinceTs = performance.now();
      const poseDetected = await waitForPoseDetection(7000, detectionSinceTs);
      if (!poseDetected) {
        setPoseDetectedState(false);
        const videoElement = videoRef.current;
        const stream = streamRef.current;
        if (!videoElement || !stream) {
          throw new Error('VIDEO_STREAM_NOT_RENDERING');
        }
        await cameraSessionManager.recoverForegroundPreview(videoElement, stream);
        console.warn(`[Camera] ${label}: pose warmup timeout, camera preview is active, continue observing.`);
      }
    };

    const stopMotionAndOverlay = (): void => {
      motionController.stop();
      motionController.resetPoseObservation();
      if (poseLoopRef.current !== null) {
        cancelAnimationFrame(poseLoopRef.current);
        poseLoopRef.current = null;
      }
    };

    const simulatedFailure = getSimulatedFailure();
    const simulatedPrefix = '[模拟] ';
    const inIframeContext = isInIframe();
    const inAppBrowserContext = isLikelyInAppBrowser();

    stopMotionAndOverlay();

    if (simulatedFailure === 'camera_api_missing') {
      const message = simulatedPrefix + buildCameraGuidance('api-missing', inIframeContext, inAppBrowserContext);
      setLoadingStatus('当前浏览器不支持摄像头。');
      setCameraIssueMessage(message);
      return false;
    }
    if (simulatedFailure === 'camera_insecure') {
      const message = simulatedPrefix + buildCameraGuidance('insecure', inIframeContext, inAppBrowserContext);
      setLoadingStatus('当前页面不是安全链接。');
      setCameraIssueMessage(message);
      return false;
    }
    if (simulatedFailure === 'camera_denied') {
      const message = simulatedPrefix + buildCameraGuidance('denied', inIframeContext, inAppBrowserContext);
      setLoadingStatus('摄像头权限未开启。');
      setCameraIssueMessage(message);
      return false;
    }
    if (simulatedFailure === 'camera_blocked') {
      const message = simulatedPrefix + buildCameraGuidance('blocked', inIframeContext, inAppBrowserContext);
      setLoadingStatus('摄像头被浏览器拦截。');
      setCameraIssueMessage(message);
      return false;
    }
    if (simulatedFailure === 'camera_not_found') {
      const message = simulatedPrefix + buildCameraGuidance('not-found', inIframeContext, inAppBrowserContext);
      setLoadingStatus('未检测到摄像头。');
      setCameraIssueMessage(message);
      return false;
    }
    if (simulatedFailure === 'camera_busy') {
      const message = simulatedPrefix + buildCameraGuidance('busy', inIframeContext, inAppBrowserContext);
      setLoadingStatus('摄像头被其他应用占用。');
      setCameraIssueMessage(message);
      return false;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const message = buildCameraGuidance('api-missing', inIframeContext, inAppBrowserContext);
      setLoadingStatus('当前浏览器不支持摄像头。');
      setCameraIssueMessage(message);
      return false;
    }

    try {
      if (!window.isSecureContext) {
        const message = buildCameraGuidance('insecure', inIframeContext, inAppBrowserContext);
        setLoadingStatus('当前页面不是安全链接。');
        setCameraIssueMessage(message);
        return false;
      }

      const permissionState = await getCameraPermissionState();
      if (permissionState === 'denied') {
        const deniedGuidance = buildCameraGuidance('denied', inIframeContext, inAppBrowserContext);
        setLoadingStatus('摄像头权限未开启。');
        setCameraIssueMessage(deniedGuidance);
        return false;
      }

      const videoElement = videoRef.current;
      if (!videoElement) {
        setLoadingStatus('摄像头预览初始化失败。');
        setCameraIssueMessage('摄像头已打开，但画面初始化失败。\n请点击“重试”。');
        return false;
      }

      setLoadingStatus(streamRef.current ? '正在恢复摄像头连接...' : '正在请求摄像头权限...');

      const platformInfo = cameraSessionManager.resolvePlatformInfo();
      const renderRetryCount = cameraSessionManager.getRenderRetryCount(platformInfo);
      const permissionTimeoutMs = isSimulatedFailure('camera_timeout') ? 300 : 12000;
      const stream = await cameraSessionManager.acquireRenderableStream({
        videoElement,
        existingStream: streamRef.current,
        permissionTimeoutMs,
        renderRetryCount
      });
      streamRef.current = stream;

      setLoadingStatus('摄像头已连接，正在启动识别引擎...');
      if (isSimulatedFailure('pose_init_timeout')) {
        throw new Error('Pose initialize timeout (simulated)');
      }
      await startMotionWithRetry(videoElement, 1);
      await warmupPoseAfterEngineStart('camera-start');

      startPoseOverlayLoop();
      setCameraIssueMessage('');
      return true;
    } catch (err) {
      const normalizedError = err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { kind: typeof err, value: String(err) };
      console.error('Camera init failed:', normalizedError);
      const errorMessage = String(err);
      const errorName = err instanceof DOMException ? err.name : '';

      if (isCameraPipelineError(err)) {
        if (err.code === 'CAMERA_API_MISSING') {
          const message = buildCameraGuidance('api-missing', inIframeContext, inAppBrowserContext);
          setLoadingStatus('当前浏览器不支持摄像头。');
          setCameraIssueMessage(message);
          return false;
        }

        if (err.code === 'CAMERA_PERMISSION_TIMEOUT') {
          const guidance = buildCameraGuidance('timeout', inIframeContext, inAppBrowserContext);
          setLoadingStatus('等待摄像头授权超时。');
          setCameraIssueMessage(guidance);
          return false;
        }

        if (err.code === 'CAMERA_LATE_STREAM_DISCARDED') {
          return false;
        }

        if (err.code === 'VIDEO_PLAY_FAILED') {
          setLoadingStatus('摄像头画面播放失败。');
          setCameraIssueMessage('摄像头已打开，但画面启动失败。\n请点击“重试”，并确认系统摄像头权限仍为允许。');
          return false;
        }

        if (err.code === 'VIDEO_STREAM_NOT_RENDERING') {
          cameraSessionManager.cleanupSession(videoRef.current, streamRef.current);
          streamRef.current = null;
          motionController.stop();
          setLoadingStatus('摄像头画面不可用。');
          setCameraIssueMessage('摄像头权限已允许，但画面未正常渲染。\n请点击"重试"，并确认没有其他应用占用摄像头。');
          return false;
        }
      }

      if (errorName === 'NotAllowedError') {
        console.error('[Camera] NotAllowedError context:', {
          isSecureContext: window.isSecureContext,
          isInIframe: inIframeContext,
          isInAppBrowser: inAppBrowserContext,
          visibilityState: document.visibilityState,
          userAgent: navigator.userAgent
        });
        const guidance = buildCameraGuidance('blocked', inIframeContext, inAppBrowserContext);
        setLoadingStatus('摄像头被浏览器拦截。');
        setCameraIssueMessage(guidance);
        return false;
      }

      if (errorName === 'NotFoundError') {
        const guidance = buildCameraGuidance('not-found', inIframeContext, inAppBrowserContext);
        setLoadingStatus('未检测到摄像头。');
        setCameraIssueMessage(guidance);
        return false;
      }

      if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        const guidance = buildCameraGuidance('busy', inIframeContext, inAppBrowserContext);
        setLoadingStatus('摄像头被其他应用占用。');
        setCameraIssueMessage(guidance);
        return false;
      }

      if (errorName === 'SecurityError') {
        const guidance = buildCameraGuidance('insecure', inIframeContext, inAppBrowserContext);
        setLoadingStatus('当前页面不允许访问摄像头。');
        setCameraIssueMessage(guidance);
        return false;
      }

      if (errorName === 'AbortError' || errorName === 'InvalidStateError') {
        const guidance = buildCameraGuidance('busy', inIframeContext, inAppBrowserContext);
        setLoadingStatus('摄像头启动被中断。');
        setCameraIssueMessage(`${guidance}\n请保持页面在前台后重试。`);
        return false;
      }

      if (errorName === 'OverconstrainedError') {
        setLoadingStatus('摄像头参数不兼容。');
        setCameraIssueMessage('当前设备摄像头参数与浏览器不兼容。\n请点击“重试”，系统会继续尝试兼容模式。');
        return false;
      }

      if (err instanceof Error && err.message === 'POSE_START_TIMEOUT') {
        setLoadingStatus('识别引擎启动超时。');
        setCameraIssueMessage('识别引擎启动超时。\n请检查网络并点击“重试”。');
        return false;
      }

      if (/pose|mediapipe|wasm|cdn|initialize timeout|pose_start_timeout|pose_start_aborted|pose_init_aborted/i.test(errorMessage)) {
        setLoadingStatus('识别引擎加载失败。');
        setCameraIssueMessage('识别引擎加载失败。\n请检查网络后点击“重试”。');
        return false;
      }

      setLoadingStatus('摄像头初始化失败。');
      setCameraIssueMessage('摄像头初始化失败，请点击“重试”。');
      return false;
    }
  };

  const simplifyLoadingStatus = (status: string): string => {
    if (!status) return '正在加载中...';
    if (/camera|permission|摄像头|授权/i.test(status)) return '正在准备摄像头...';
    if (/ai|pose|mediapipe|识别|引擎/i.test(status)) return '正在启动识别引擎...';
    if (/theme|题目|图片|缓存/i.test(status)) return '正在准备题目图片...';
    if (/asset|资源|loading/i.test(status)) return '正在加载游戏资源...';
    if (/ready|完成|就绪/i.test(status)) return '马上就好...';
    return '正在加载中...';
  };

  const startPoseOverlayLoop = () => {
        if (poseLoopRef.current !== null) return;

        const minVisibility = 0.4;
        const resolvePoint = (landmarks: PoseLandmark[], index: number): { x: number; y: number } | null => {
            const landmark = landmarks[index];
            if (!landmark) return null;
            const visibility = typeof landmark.visibility === 'number' ? landmark.visibility : 1;
            const presence = typeof landmark.presence === 'number' ? landmark.presence : 1;
            if (visibility < minVisibility || presence < minVisibility) return null;
            return { x: landmark.x, y: landmark.y };
        };

        const drawPoseOverlay = () => {
            const canvas = poseCanvasRef.current;
            const video = videoRef.current;
            const now = performance.now();
            refreshPoseDetectedState(now);
            if (!canvas || !video) {
                poseLoopRef.current = requestAnimationFrame(drawPoseOverlay);
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                poseLoopRef.current = requestAnimationFrame(drawPoseOverlay);
                return;
            }

            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
                canvas.width = Math.floor(width * dpr);
                canvas.height = Math.floor(height * dpr);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            ctx.clearRect(0, 0, width, height);

            const landmarks = motionController.poseLandmarks;
            if (!landmarks || landmarks.length === 0) {
                poseLoopRef.current = requestAnimationFrame(drawPoseOverlay);
                return;
            }

            ctx.lineWidth = 1.8;
            ctx.strokeStyle = 'rgba(0, 255, 163, 0.85)';
            ctx.fillStyle = 'rgba(0, 255, 163, 0.9)';

            POSE_CONNECTIONS.forEach(([start, end]) => {
                const p1 = resolvePoint(landmarks, start);
                const p2 = resolvePoint(landmarks, end);
                if (!p1 || !p2) return;
                const x1 = (1 - p1.x) * width;
                const y1 = p1.y * height;
                const x2 = (1 - p2.x) * width;
                const y2 = p2.y * height;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            });

            landmarks.forEach((landmark, index) => {
                const point = resolvePoint(landmarks, index);
                if (!point) return;
                const x = (1 - point.x) * width;
                const y = point.y * height;
                ctx.beginPath();
                ctx.arc(x, y, 2.4, 0, Math.PI * 2);
                ctx.fill();
            });

            poseLoopRef.current = requestAnimationFrame(drawPoseOverlay);
        };

        poseLoopRef.current = requestAnimationFrame(drawPoseOverlay);
  };

  useEffect(() => {
    initializeCameraRef.current = initializeCamera;
  });

  useEffect(() => {
    startPoseOverlayLoopRef.current = startPoseOverlayLoop;
  });

  useEffect(() => {
    let disposed = false;
    let resumeTimer: number | null = null;

    const clearResumeTimer = (): void => {
      if (resumeTimer !== null) {
        window.clearTimeout(resumeTimer);
        resumeTimer = null;
      }
    };

    const recoverAfterForeground = async (reason: string): Promise<void> => {
      if (disposed) return;
      if (document.visibilityState !== 'visible') return;
      if (phaseRef.current === GamePhase.MENU || phaseRef.current === GamePhase.THEME_SELECTION) return;
      if (isForegroundRecoveryInFlightRef.current) return;
      const now = Date.now();
      if (now - lastForegroundRecoveryAtRef.current < 800) return;
      lastForegroundRecoveryAtRef.current = now;
      isForegroundRecoveryInFlightRef.current = true;

      try {
        const videoElement = videoRef.current;
        const stream = streamRef.current;
        if (!videoElement) {
          return;
        }
        if (!stream) {
          console.warn('[Lifecycle] Foreground resume found no active stream, reinitializing camera.', { reason });
          await initializeCameraRef.current();
          return;
        }

        const cameraSessionManager = cameraSessionManagerRef.current;
        if (!cameraSessionManager.hasUsableLiveTrack(stream)) {
          console.warn('[Lifecycle] Foreground resume detected no live track, reinitializing.', {
            reason,
            tracks: cameraSessionManager.getVideoTrackDiagnostics(stream)
          });
          await initializeCameraRef.current();
          return;
        }

        try {
          await cameraSessionManager.recoverForegroundPreview(videoElement, stream);
        } catch (previewError) {
          console.warn('[Lifecycle] Foreground preview recovery failed, reinitializing camera.', {
            reason,
            error: previewError,
            tracks: cameraSessionManager.getVideoTrackDiagnostics(stream)
          });
          await initializeCameraRef.current();
          return;
        }

        if (!motionController.isStarted || !motionController.isActuallyRunning()) {
          if (motionController.isStarted) {
            motionController.stop();
          }
          await motionController.start(videoElement);
        }

        if (poseLoopRef.current === null) {
          startPoseOverlayLoopRef.current();
        }

        await waitMs(650);
        const hasFreshPose = motionController.hasFreshPoseLandmarks(performance.now() - 1200);
        if (!hasFreshPose) {
          console.warn('[Lifecycle] No pose observed after foreground resume, reinitializing camera.');
          await initializeCameraRef.current();
          return;
        }

        setCameraIssueMessage('');
      } catch (error) {
        console.error('[Lifecycle] Foreground recovery failed:', error);
        setPoseDetectedState(false);
      } finally {
        isForegroundRecoveryInFlightRef.current = false;
      }
    };

    const scheduleRecover = (reason: string, delayMs: number): void => {
      clearResumeTimer();
      resumeTimer = window.setTimeout(() => {
        void recoverAfterForeground(reason);
      }, delayMs);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        scheduleRecover('visibilitychange', 120);
      }
    };

    const handlePageShow = (): void => {
      scheduleRecover('pageshow', 120);
    };

    const handleFocus = (): void => {
      scheduleRecover('focus', 180);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);

    return () => {
      disposed = true;
      clearResumeTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
    };
  }, [setPoseDetectedState]);

  useEffect(() => {
    const handleAppInstalled = () => {
      console.log('[PWA] App installed, visibility state:', document.visibilityState);
    };
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => window.removeEventListener('appinstalled', handleAppInstalled);
  }, []);

  const handleStartGame = async () => {
    if (selectedThemes.length === 0) return;
    clearRestCountdown();
    const loadingRequestId = loadingRequestIdRef.current + 1;
    loadingRequestIdRef.current = loadingRequestId;
    const isCurrentLoadingRequest = (): boolean => (
      loadingRequestIdRef.current === loadingRequestId && phaseRef.current === GamePhase.LOADING
    );

    setCameraIssueMessage('');
    setBgIndex(0);
    setThemeImagesLoaded(false); // Reset when selecting a new theme
    hasCalibratedPoseRef.current = false;
    lastPoseSeenAtRef.current = 0;
    setPoseDetectedState(false);
    
    // 0. Enter Loading Phase
    setPhase(GamePhase.LOADING);
    setLoadingProgress(0);
    setLoadingStatus('正在准备摄像头...');

    // 1. Request camera first to avoid permission prompt conflicts on mobile browsers
    try {
        const cameraSuccess = await initializeCamera();
        if (!isCurrentLoadingRequest()) return;
        if (!cameraSuccess) {
          throw new Error("Camera failed");
        }

        if (isSimulatedFailure('asset_load_fail')) {
          throw new Error('SIMULATED_ASSET_LOAD_FAIL');
        }

        await preloadAllGameAssets(selectedThemes, (progress, status) => {
            if (!isCurrentLoadingRequest()) return;
            setLoadingProgress(progress);
            setLoadingStatus(simplifyLoadingStatus(status)); 
        });
        if (!isCurrentLoadingRequest()) return;

        // Start background preloading for the REST of the themes
        const firstThemeId = selectedThemes[0];
        const themesToPreload = themes.filter(t => selectedThemes.includes(t.id) && t.id !== firstThemeId);
        if (themesToPreload.length > 0) {
            startBackgroundPreloading(themesToPreload);
        }

        setThemeImagesLoaded(true);
        setPhase(GamePhase.TUTORIAL);
        setInitStatus('系统就绪');
        
    } catch (e) {
        if (!isCurrentLoadingRequest()) return;
        const normalizedError = e instanceof Error
          ? { name: e.name, message: e.message, stack: e.stack }
          : { kind: typeof e, value: String(e) };
        console.error("Loading failed:", normalizedError);
        const isCameraFailure = e instanceof Error && e.message === 'Camera failed';
        if (isCameraFailure) {
          setLoadingStatus('摄像头启动失败，请按提示处理后重试。');
          setLoadingProgress(0);
          return;
        }
        const isSimulatedAssetFailure = e instanceof Error && e.message === 'SIMULATED_ASSET_LOAD_FAIL';
        setLoadingStatus('资源加载失败，请检查网络后重试。');
        setCameraIssueMessage(
          isSimulatedAssetFailure
            ? '[模拟] 资源加载失败。请检查错误提示与重试按钮是否正常。'
            : '资源加载失败了。\n请检查网络后点击“重试”。'
        );
        setLoadingProgress(0);
        setPhase(GamePhase.LOADING);
    }
  };

  const handleScoreUpdate = useCallback((newScore: number, total: number) => {
    setScore(newScore);
    setTotalQuestions(total);
    // 触发积分栏动画
    const scorePanel = document.querySelector('.score-panel');
    if (scorePanel) {
      scorePanel.classList.remove('animate-bounce-short');
      void (scorePanel as HTMLElement).offsetWidth; // 触发重绘
      scorePanel.classList.add('animate-bounce-short');
    }
  }, []);

  const syncScoreHudTarget = useCallback((): boolean => {
    const game = window.phaserGame;
    if (!game) return false;

    if (phaseRef.current !== GamePhase.PLAYING) {
      game.registry.set('scoreHudTarget', null);
      return true;
    }

    const rootRect = appRootRef.current?.getBoundingClientRect();
    const scoreRect = scorePanelRef.current?.getBoundingClientRect();
    if (!rootRect || !scoreRect) return false;

    const centerX = scoreRect.left - rootRect.left + scoreRect.width / 2;
    const centerY = scoreRect.top - rootRect.top + scoreRect.height / 2;
    game.registry.set('scoreHudTarget', { x: centerX, y: centerY });
    return true;
  }, []);

  useEffect(() => {
    let rafId: number | null = null;
    let retryTimerId: number | null = null;

    const scheduleSync = (): void => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        const synced = syncScoreHudTarget();
        if (!synced && phase === GamePhase.PLAYING) {
          retryTimerId = window.setTimeout(scheduleSync, 120);
        }
      });
    };

    const onWindowLayoutChange = (): void => {
      scheduleSync();
    };

    scheduleSync();
    window.addEventListener('resize', onWindowLayoutChange);
    window.addEventListener('orientationchange', onWindowLayoutChange);
    document.addEventListener('fullscreenchange', onWindowLayoutChange);
    document.addEventListener('webkitfullscreenchange', onWindowLayoutChange);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (retryTimerId !== null) window.clearTimeout(retryTimerId);
      window.removeEventListener('resize', onWindowLayoutChange);
      window.removeEventListener('orientationchange', onWindowLayoutChange);
      document.removeEventListener('fullscreenchange', onWindowLayoutChange);
      document.removeEventListener('webkitfullscreenchange', onWindowLayoutChange);
    };
  }, [isFullscreen, phase, score, totalQuestions, syncScoreHudTarget]);
  
  const handleGameOver = useCallback(() => {
    setShowCompletion(true);
  }, []);

  const handleGameRestart = useCallback(() => {
    setShowCompletion(false);
    setBgIndex(0);
  }, []);

  const handleEnterPlaying = useCallback(async (): Promise<void> => {
    setBgIndex(0);
    setHasShownEmoji(true);
    try {
      await requestFullscreenSafely('manual');
    } catch (error) {
      console.warn('[Fullscreen] Unexpected error before entering PLAYING:', error);
    }
    setPhase(GamePhase.PLAYING);
  }, [requestFullscreenSafely]);

  const handleReplay = useCallback(() => {
    clearRestCountdown();
    setShowCompletion(false);
    const game = window.phaserGame;
    if (!game) {
      console.warn('[Completion] Replay skipped: Phaser game instance missing.');
      return;
    }

    try {
      const mainScene = game.scene.getScene('MainScene') as MainScene;
      mainScene.restartLevel();
    } catch (error) {
      console.error('[Completion] Replay failed to access MainScene:', error);
    }
  }, [clearRestCountdown]);

  const handleNextLevel = useCallback(() => {
    if (isCompletionTransitioningRef.current) {
      return;
    }

    setShowCompletion(false);

    const game = window.phaserGame;
    if (!game) {
      console.warn('[Completion] Next level skipped: Phaser game instance missing.');
      return;
    }

    try {
      const mainScene = game.scene.getScene('MainScene') as MainScene;
      const hasNextTheme = mainScene.hasNextTheme();

      if (!hasNextTheme) {
        handleBackToMenu();
        return;
      }

      isCompletionTransitioningRef.current = true;
      let remainingSeconds = THEME_SWITCH_REST_SECONDS;
      setRestCountdownSeconds(remainingSeconds);

      if (restCountdownTimerRef.current !== null) {
        window.clearInterval(restCountdownTimerRef.current);
      }

      restCountdownTimerRef.current = window.setInterval(() => {
        remainingSeconds -= 1;
        if (remainingSeconds <= 0) {
          if (restCountdownTimerRef.current !== null) {
            window.clearInterval(restCountdownTimerRef.current);
            restCountdownTimerRef.current = null;
          }
          setRestCountdownSeconds(null);
          isCompletionTransitioningRef.current = false;

          try {
            const currentGame = window.phaserGame;
            const currentMainScene = currentGame?.scene?.getScene('MainScene') as MainScene | undefined;
            if (!currentMainScene || !currentMainScene.nextLevel()) {
              handleBackToMenu();
            }
          } catch (error) {
            console.error('[Completion] Next level transition failed after rest:', error);
            handleBackToMenu();
          }
          return;
        }

        setRestCountdownSeconds(remainingSeconds);
      }, 1000);
    } catch (error) {
      console.error('[Completion] Next level failed to access MainScene:', error);
      isCompletionTransitioningRef.current = false;
      setRestCountdownSeconds(null);
    }
  }, [THEME_SWITCH_REST_SECONDS, handleBackToMenu]);

  useEffect(() => {
    if (!showCompletion || phase !== GamePhase.PLAYING) {
      return;
    }

    completionCycleRef.current += 1;
    const cycleId = completionCycleRef.current;
    completionAutoAdvanceHandledCycleRef.current = null;

    const watchdogTimerId = window.setTimeout(() => {
      if (completionAutoAdvanceHandledCycleRef.current === cycleId) {
        return;
      }
      completionAutoAdvanceHandledCycleRef.current = cycleId;
      console.warn('[Completion] Watchdog forcing next-level transition.');
      handleNextLevel();
    }, 6500);

    return () => {
      window.clearTimeout(watchdogTimerId);
    };
  }, [showCompletion, phase, handleNextLevel]);

  const isPlayingFullscreen = phase === GamePhase.PLAYING && isFullscreen;

  return (
    <div
      ref={appRootRef}
      className="relative w-full overflow-hidden bg-kenney-blue font-sans select-none text-kenney-dark"
      style={{ height: 'var(--app-height, 100dvh)' }}
    >
      <audio 
        ref={bgmRef}
        id="bgm-audio"
        preload="auto"
        playsInline
        muted={false}
      />
      
      {/* 0. Portrait Warning Overlay */}
      {isPortrait && (
          <div 
            className="fixed inset-0 z-[1000] bg-kenney-dark/95 backdrop-blur-md flex items-center justify-center p-8 text-center text-white touch-none non-game-shell"
            onWheel={(e) => e.preventDefault()}
            onTouchMove={(e) => e.preventDefault()}
          >
              <div className="non-game-scale flex flex-col items-center justify-center text-center">
                <div className="mb-4 md:mb-8 relative w-32 h-32 md:w-64 md:h-64 flex items-center justify-center">
                    {/* Visual Instruction for Kids */}
                    <div className="absolute inset-0 border-4 border-dashed border-white/20 rounded-3xl animate-pulse"></div>
                    <div className="relative animate-rotate-device">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-24 h-24 md:w-48 md:h-48">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                        </svg>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8 md:w-12 md:h-12 text-kenney-yellow animate-bounce">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                        </div>
                    </div>
                </div>
                <h2 className="text-2xl md:text-6xl font-black mb-2 uppercase italic tracking-tighter text-kenney-yellow">
                    请横屏使用
                </h2>
                <p className="text-lg md:text-2xl font-bold opacity-90 uppercase tracking-widest">
                    请将设备旋转为横屏
                </p>
              </div>
          </div>
      )}

      {/* Background Image Overlay */}
      <div 
        className="absolute inset-0 z-0 opacity-30 pointer-events-none bg-repeat bg-center"
        style={{ backgroundImage: `url('${getR2AssetUrl('assets/kenney/Vector/Backgrounds/background_clouds.svg')}')`, backgroundSize: '800px' }}
      />

      {/* 1. Camera HUD */}
      <div className={`fixed z-[60] transition-all duration-500 ease-in-out mobile-landscape-camera ${isPlayingFullscreen ? 'top-2 md:top-3 right-2 md:right-3' : 'top-4 md:top-6 right-4 md:right-6'} ${phase === GamePhase.MENU || phase === GamePhase.THEME_SELECTION ? 'translate-x-[200%] opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'}`}>
        <div className={`bg-white border-[2px] md:border-[4px] border-kenney-dark rounded-kenney shadow-lg scale-75 md:scale-100 origin-top-right ${isPlayingFullscreen ? 'p-1 md:p-1.5' : 'p-1 md:p-2'}`}>
           <div className={`${isPlayingFullscreen ? 'w-28 h-20 sm:w-32 sm:h-24 md:w-40 md:h-28' : 'w-20 h-15 sm:w-24 sm:h-18 md:w-32 md:h-24'} overflow-hidden relative bg-kenney-dark/10 rounded-lg md:rounded-xl`}>
               <video 
                 ref={videoRef} 
                 className="w-full h-full object-cover transform scale-x-[-1] live-view-video" 
                 playsInline 
                 muted 
                 autoPlay 
                 webkit-playsinline="true"
               />
               <div className="live-view-texture" />
                <canvas
                  ref={poseCanvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />
             </div>

        </div>
      </div>

      {/* 2.5 Unified Back Button */}
      {(phase !== GamePhase.MENU) && (
          <div className={`fixed top-4 md:top-6 left-4 md:left-6 z-[999] flex items-center gap-2 md:gap-3 mobile-landscape-control ${isFullscreen ? 'fullscreen-hud-match-windowed' : ''}`}>
            <div className="flex items-center gap-1 md:gap-1.5">
            <button 
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (phase === GamePhase.THEME_SELECTION) {
                  handleExitToMenu();
                } else {
                  handleBackToMenu();
                }
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (phase === GamePhase.THEME_SELECTION) {
                  handleExitToMenu();
                } else {
                  handleBackToMenu();
                }
              }}
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              className="kenney-button-circle kenney-button-red group scale-90 md:scale-100 flex-shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>

            {/* BGM Toggle (PLAYING only) */}
            {phase === GamePhase.PLAYING && (
              <button
                onTouchStart={(e) => handleToggleBgm(e)}
                onClick={(e) => handleToggleBgm(e)}
                style={{ pointerEvents: 'auto', touchAction: 'none' }}
                className={`kenney-button-circle group scale-90 md:scale-100 ${isBgmEnabled ? 'bg-kenney-green' : 'bg-gray-400'}`}
                title={isBgmEnabled ? '背景音乐：开' : '背景音乐：关'}
                aria-pressed={!isBgmEnabled}
              >
                {isBgmEnabled ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3.5} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a4 4 0 0 1 0 7M18 6a7 7 0 0 1 0 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3.5} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5zM16 9l4 4m0-4-4 4" />
                  </svg>
                )}
              </button>
            )}

            {/* Fullscreen Toggle (PLAYING only) */}
            {phase === GamePhase.PLAYING && (
              <button
                onTouchEnd={(e) => handleToggleFullscreen(e)}
                onClick={(e) => handleToggleFullscreen(e)}
                style={{ pointerEvents: 'auto', touchAction: 'manipulation' }}
                className={`kenney-button-circle group scale-90 md:scale-100 ${isFullscreen ? 'bg-kenney-yellow' : 'bg-kenney-blue'} ${isFullscreenApiSupported ? '' : 'opacity-50 cursor-not-allowed'}`}
                title={isFullscreenApiSupported ? (isFullscreen ? '退出全屏' : '进入全屏') : '当前浏览器限制网页全屏（iOS Safari 部分场景不支持）'}
                aria-pressed={isFullscreen}
                aria-disabled={!isFullscreenApiSupported}
                disabled={!isFullscreenApiSupported}
              >
                {isFullscreen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3.5} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9H5V5m0 0 5 5M15 9h4V5m0 0-5 5M9 15H5v4m0 0 5-5M15 15h4v4m0 0-5-5" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3.5} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
                  </svg>
                )}
              </button>
            )}
            </div>

            {/* Score Panel Integrated with Back Button for alignment */}
             {phase === GamePhase.PLAYING && (
               <div ref={scorePanelRef} className="score-panel kenney-panel h-11 md:h-14 px-3 md:px-4 flex items-center gap-2 md:gap-2.5 transition-all bg-white/90 backdrop-blur-sm shadow-[0_6px_0_#333333] border-[3px] md:border-[4px]">
                 <img src={getR2AssetUrl('assets/kenney/Vector/Tiles/star.svg')} className="w-8 h-8 md:w-10 md:h-10" alt="分数" />
                 <span className="text-lg md:text-3xl font-black leading-none text-kenney-dark tabular-nums tracking-tight">
                   {score} / {totalQuestions}
                 </span>
               </div>
             )}
          </div>
      )}

      {/* 4. Score HUD - REMOVED redundant fixed panel, now integrated above */}

      {/* 4. Game Canvas */}
      {phase === GamePhase.PLAYING && (
        <>
          <GameBackground currentIndex={bgIndex} />
          <div className="relative w-full h-full z-10">
            <GameCanvas 
              onScoreUpdate={handleScoreUpdate} 
              onGameOver={handleGameOver}
              onGameRestart={handleGameRestart}
              onBackgroundUpdate={setBgIndex}
              // @ts-ignore
              themes={selectedThemes}
              allThemes={themes}
              qualityMode={qualityMode}
            />
          </div>
        </>
      )}

      {/* 5. Completion Overlay (Sandwich Top Layer) */}
      <CompletionOverlay 
        isVisible={showCompletion} 
        score={score} 
        total={totalQuestions} 
        onRestart={handleReplay}
        onNextLevel={handleNextLevel}
      />

      {phase === GamePhase.PLAYING && restCountdownSeconds !== null && (
        <div className="fixed inset-0 z-[980] pointer-events-none flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="kenney-panel bg-white/95 px-8 md:px-12 py-6 md:py-8 text-center shadow-2xl">
            <p className="text-xl md:text-3xl font-black text-kenney-dark mb-3 md:mb-4">
              休息一下，准备下一个绘本
            </p>
            <div className="text-5xl md:text-7xl font-black text-kenney-yellow drop-shadow-[0_4px_0_#333333] tabular-nums">
              {restCountdownSeconds}
            </div>
          </div>
        </div>
      )}

      {/* 5. Menus & Overlays */}
      {phase !== GamePhase.PLAYING && (
        <div lang="zh-CN" className="absolute inset-0 z-50 flex items-center justify-center bg-kenney-blue/60 backdrop-blur-sm p-4 non-game-shell">
            
            {/* LOADING SCREEN */}
            {phase === GamePhase.LOADING && (
                <>
                  <LoadingScreen progress={loadingProgress} status={loadingStatus} />
                  {cameraIssueMessage && (
                    <div className="absolute inset-0 z-[90] bg-black/35 backdrop-blur-md flex items-center justify-center p-4">
                      <div className="kenney-panel bg-white/95 max-w-2xl w-full px-5 md:px-8 py-5 md:py-7 shadow-2xl">
                        <h3 className="text-xl md:text-3xl font-black text-kenney-dark mb-3 md:mb-4 uppercase">
                          出了点问题
                        </h3>
                        <p className="text-sm md:text-lg font-bold text-kenney-dark whitespace-pre-line leading-relaxed mb-4 md:mb-6">
                          {cameraIssueMessage}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 md:gap-4">
                          <button
                            onClick={() => {
                              setCameraIssueMessage('');
                              void handleStartGame();
                            }}
                            className="kenney-button kenney-button-handdrawn px-4 md:px-6 py-2 md:py-3 text-sm md:text-lg"
                          >
                            重试
                          </button>
                          <button
                            onClick={() => {
                              loadingRequestIdRef.current += 1;
                              setCameraIssueMessage('');
                              setLoadingProgress(0);
                              setLoadingStatus('请选择主题后重新开始');
                              setPhase(GamePhase.THEME_SELECTION);
                            }}
                            className="kenney-button kenney-button-handdrawn px-4 md:px-6 py-2 md:py-3 text-sm md:text-lg bg-gray-300 border-gray-500"
                          >
                            返回主题页
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
            )}
            
            {/* MAIN MENU */}
            {phase === GamePhase.MENU && (
              <div className="menu-shell non-game-scale text-center w-full max-w-4xl px-4 md:px-8 relative flex flex-col items-center justify-between lg:justify-center min-h-0 h-full max-h-screen overflow-y-auto py-2 md:py-12 lg:gap-6 scrollbar-hide">
                  
                  {/* Title and Character Group */}
                  <div className="flex flex-row lg:flex-col items-center justify-center gap-2 lg:gap-6 shrink-0 w-full flex-1 lg:flex-none">
                      {/* Title */}
                      <div className="flex flex-col items-center px-0 lg:px-10 overflow-hidden shrink-0 order-1 lg:order-2">
                          <h1 className="brand-title text-5xl sm:text-6xl md:text-8xl lg:text-9xl font-bold text-white drop-shadow-[0_4px_0_#333333] md:drop-shadow-[0_6px_0_#333333] tracking-normal uppercase italic leading-none rotate-[-1deg] whitespace-nowrap py-2 md:py-4 home-landscape-title">
                              JUMP <span className="text-kenney-yellow">&</span> SAY
                          </h1>
                      </div>

                      {/* Character */}
                      <div className="relative shrink-0 order-2 lg:order-1">
                        <img 
                          src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_jump.svg')}
                          className="w-20 h-20 sm:w-24 sm:h-24 md:w-48 md:h-48 lg:w-56 lg:h-56 animate-bounce drop-shadow-xl mobile-landscape-character" 
                          alt="角色" 
                        />
                      </div>
                  </div>
                  
                  {/* Start Button */}
                  <div className="pb-4 pt-2 lg:py-0 shrink-0">
                      <button onClick={handleStartProcess} 
                          className="kenney-button kenney-button-handdrawn px-6 sm:px-12 md:px-24 py-2 sm:py-4 md:py-8 text-base sm:text-2xl md:text-4xl hover:scale-110 transition-transform mobile-landscape-button">
                          开始游戏
                      </button>
                  </div>

                  {/* Quality Selector */}
                  <div className="w-full flex flex-col items-center gap-1 md:gap-2 mb-2 lg:mt-2 shrink-0">
                    <div ref={qualityPickerRef} className="relative pointer-events-auto">
                      <button
                        type="button"
                        onClick={() => setIsQualityPickerOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 md:gap-2 rounded-full border border-white/35 bg-white/10 px-3 md:px-4 py-1.5 md:py-2 text-white/80 hover:bg-white/14 transition-colors"
                        aria-haspopup="listbox"
                        aria-expanded={isQualityPickerOpen}
                        title="游戏画质"
                      >
                        <span className="text-xs md:text-sm font-black tracking-[0.01em]">游戏画质：{activeQualityLabel}</span>
                        <svg className={`w-3 h-3 md:w-3.5 md:h-3.5 transition-transform ${isQualityPickerOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                        </svg>
                      </button>
                      {isQualityPickerOpen && (
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 min-w-[168px] max-w-[84vw] rounded-2xl border border-white/35 bg-[#78AFFF]/95 backdrop-blur-md px-2 py-2 shadow-xl z-20">
                          <div className="flex flex-col gap-1 max-h-[46vh] overflow-y-auto" role="listbox" aria-label="游戏画质">
                            {QUALITY_MODE_OPTIONS.map((option) => {
                              const isActive = option.value === qualityMode;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    setQualityMode(option.value);
                                    setIsQualityPickerOpen(false);
                                  }}
                                  className={`w-full rounded-xl px-3 py-1.5 md:py-2 text-left text-sm md:text-base font-black transition-colors ${
                                    isActive ? 'bg-white/92 text-[#4f6e96]' : 'text-white/78 hover:bg-white/14'
                                  }`}
                                  aria-selected={isActive}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
              </div>
            )}

            {/* THEME SELECTION */}
            {phase === GamePhase.THEME_SELECTION && (
                <div className="theme-shell non-game-scale theme-selection-container text-center w-full max-w-[98vw] lg:max-w-[95vw] px-2 md:px-4 gap-2 md:gap-3 relative">
                    <h2 className="text-lg sm:text-2xl md:text-4xl lg:text-5xl font-black text-white mb-1 md:mb-2 tracking-[0.04em] shrink-0 mobile-landscape-title pt-4 md:pt-6">
                        选择绘本
                    </h2>
                    <div className="w-full overflow-y-auto overflow-x-hidden px-0.5 md:px-2 scrollbar-hide flex-1 min-h-0 will-change-transform">
                        {/* Level Selection Bar */}
                        {levels.length > 0 && (
                          <div className="w-full flex justify-center pb-2 md:pb-4 shrink-0 overflow-x-auto scrollbar-hide px-2">
                            <div className="flex gap-2 md:gap-3 p-1">
                              {levels.map((lvl) => (
                                <button
                                  key={lvl}
                                  onClick={() => setSelectedLevel(lvl)}
                                  className={`px-3 py-1.5 md:px-5 md:py-2.5 rounded-full text-sm md:text-lg font-black transition-all shadow-md whitespace-nowrap ${
                                    selectedLevel === lvl
                                      ? 'bg-kenney-yellow text-kenney-dark scale-105 ring-2 ring-white'
                                      : 'bg-black/20 text-white/90 hover:bg-black/30 backdrop-blur-sm'
                                  }`}
                                >
                                  Level {lvl}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="theme-grid-wrap">
                          <div className="theme-grid w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-2.5 px-1 md:px-0 auto-rows-min pb-32 md:pb-40">
                              {filteredThemes.map((theme, index) => {
                                  const isSelected = selectedThemes.includes(theme.id as ThemeId);
                                  const selectionIndex = selectedThemes.indexOf(theme.id as ThemeId);
                                  return (
                                  <button
                                      key={theme.id}
                                      onClick={() => theme.isAvailable !== false && handleThemeSelect(theme.id as ThemeId)}
                                      className={`group relative w-full min-w-0 overflow-hidden rounded-xl transition-all duration-200 will-change-transform ${
                                          theme.isAvailable === false 
                                            ? 'opacity-35 grayscale cursor-not-allowed' 
                                            : isSelected 
                                              ? 'ring-4 ring-kenney-green scale-95 opacity-100 shadow-inner'
                                              : 'hover:scale-105 hover:shadow-xl active:scale-95'
                                      }`}
                                      disabled={theme.isAvailable === false}
                                      title={theme.name}
                                      style={{ 
                                          perspective: '1000px',
                                          backfaceVisibility: 'hidden'
                                      }}
                                  >
                                      {/* Theme Card */}
                                      <div className={`theme-card relative w-full h-24 sm:h-32 md:h-40 lg:h-48 bg-white p-0 flex flex-col items-center justify-center border-2 md:border-3 border-kenney-dark rounded-xl shadow-lg transition-all will-change-transform ${isSelected ? 'bg-gray-100' : 'group-hover:shadow-2xl'}`}>
                                          
                                          {theme.cover ? (
                                              <ThemeCardImage 
                                                src={getR2ImageUrl(theme.cover)} 
                                                alt={theme.name} 
                                                index={index} 
                                              />
                                          ) : (
                                            <>
                                              {/* Fallback pattern */}
                                              <div className="absolute inset-0 opacity-5 pointer-events-none rounded-xl" style={{
                                                  backgroundImage: 'radial-gradient(circle, #333333 1px, transparent 1px)',
                                                  backgroundSize: '12px 12px'
                                              }} />
                                              
                                              {/* Fallback color */}
                                              <div className="absolute inset-1 rounded-lg opacity-15 pointer-events-none" style={{
                                                  background: ['#000000', '#1a1a1a', '#2d2d2d', '#333333', '#404040'][
                                                      index % 5
                                                  ]
                                              }} />
                                            </>
                                          )}
                                          
                                          {/* Selection Order Number Overlay */}
                                          {isSelected && (
                                              <div className="absolute inset-0 flex items-center justify-center z-50 bg-kenney-green/40 backdrop-blur-[1px] rounded-xl">
                                                  <div className="w-8 h-8 md:w-12 md:h-12 bg-kenney-green border-2 md:border-4 border-white rounded-full flex items-center justify-center shadow-lg animate-bounce-short">
                                                      <span className="text-lg md:text-2xl font-black text-white leading-none">
                                                          {selectionIndex + 1}
                                                      </span>
                                                  </div>
                                              </div>
                                          )}
                                          
                                          {/* Content */}
                                          <div className="relative z-10 w-full h-full flex flex-col items-center justify-end pb-2 px-1 pointer-events-none">
                                              {/* Theme Name */}
                                              <h3 className={`theme-card-title text-[10px] sm:text-xs md:text-sm lg:text-base font-black text-center leading-tight line-clamp-2 break-words text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]`} style={{ zIndex: 10 }}>
                                                  {theme.name}
                                              </h3>
                                          </div>
                                      </div>
                                      
                                      {/* Word count badge - cute corner */}
                                      {theme.questions?.length ? (
                                          <div className="theme-badge absolute top-1 right-1 bg-kenney-yellow border-2 border-kenney-dark rounded-full w-6 h-6 md:w-8 md:h-8 shadow-lg flex items-center justify-center transform group-hover:scale-125 transition-transform z-30">
                                              <span className="text-[8px] md:text-[10px] font-black text-kenney-dark leading-none">
                                                  {theme.questions.length}
                                              </span>
                                          </div>
                                      ) : null}
                                  </button>
                              )})}
                          </div>
                        </div>
                    </div>
                    
                    {/* START BUTTON FIXED BOTTOM - Overlay */}
                    <div className="theme-start flex justify-center px-4">
                         <button 
                            onClick={handleStartGame}
                            disabled={selectedThemes.length === 0}
                            className={`pointer-events-auto kenney-button kenney-button-handdrawn mobile-landscape-button px-8 py-3 text-xl md:text-2xl shadow-2xl transition-all transform duration-300 ${selectedThemes.length > 0 ? 'scale-100 opacity-100 translate-y-0' : 'scale-50 opacity-0 translate-y-10'}`}
                        >
                            开始游戏（{selectedThemes.length}）
                        </button>
                    </div>
                </div>
            )}

            {/* TUTORIAL */}
            {phase === GamePhase.TUTORIAL && (
                <div className="tutorial-shell non-game-scale text-center w-full max-w-6xl px-4 md:px-20 lg:px-32 flex flex-col items-center justify-center h-full max-h-screen gap-[2vh] md:gap-[4vh] overflow-y-auto scrollbar-hide py-4">
                    
                    <h2 className="tutorial-title text-[4vw] sm:text-[5vw] md:text-[6vw] font-bold text-white tracking-[0.03em] rotate-[-1deg] shrink-0 mobile-landscape-title landscape-compact-title leading-none">
                        游戏说明
                    </h2>
                    
                    <div className="w-full flex-1 flex flex-col items-center justify-center min-h-0 gap-[2vh] md:gap-[4vh]">
                        <div className="grid grid-cols-2 gap-[3vw] md:gap-[4vw] w-full max-w-3xl lg:max-w-4xl min-h-0 mobile-landscape-tutorial-grid">
                            <div className="tutorial-card kenney-panel p-[2vh] md:p-[4vh] flex flex-col items-center group hover:bg-kenney-light transition-colors mobile-landscape-panel mobile-landscape-tutorial-card landscape-compact-card shadow-[4px_4px_0px_#333333] border-[3px] md:border-[4px] rounded-2xl md:rounded-3xl">
                                <div className="flex-1 flex items-center justify-center min-h-0 w-full bg-kenney-blue/10 rounded-xl mb-2 md:mb-4">
                                    <img src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_walk_a.svg')} className="tutorial-card-img w-[8vw] h-[8vw] sm:w-[10vw] sm:h-[10vw] md:w-[14vw] md:h-[14vw] lg:w-[16vw] lg:h-[16vw] animate-bounce-horizontal-large mobile-landscape-card-img landscape-compact-img drop-shadow-md" alt="" />
                                </div>
                                <div className="shrink-0 flex flex-col items-center gap-1">
                                    <h3 className="tutorial-card-title text-[2vw] sm:text-[2.5vw] md:text-[3vw] font-black text-kenney-dark tracking-[0.02em] mobile-landscape-card-text">左右移动</h3>
                                    <p className="tutorial-card-subtitle hidden landscape:block md:block text-kenney-dark/60 font-bold text-[1.2vw] md:text-[1.5vw] uppercase tracking-tight">身体左右移动</p>
                                </div>
                            </div>

                            <div className="tutorial-card kenney-panel p-[2vh] md:p-[4vh] flex flex-col items-center group hover:bg-kenney-light transition-colors mobile-landscape-panel mobile-landscape-tutorial-card landscape-compact-card shadow-[4px_4px_0px_#333333] border-[3px] md:border-[4px] rounded-2xl md:rounded-3xl">
                                <div className="flex-1 flex items-center justify-center min-h-0 w-full bg-kenney-blue/10 rounded-xl mb-2 md:mb-4">
                                    <img src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_jump.svg')} className="tutorial-card-img w-[8vw] h-[8vw] sm:w-[10vw] sm:h-[10vw] md:w-[14vw] md:h-[14vw] lg:w-[16vw] lg:h-[16vw] animate-bounce mobile-landscape-card-img landscape-compact-img drop-shadow-md" alt="" />
                                </div>
                                <div className="shrink-0 flex flex-col items-center gap-1">
                                    <h3 className="tutorial-card-title text-[2vw] sm:text-[2.5vw] md:text-[3vw] font-black text-kenney-dark tracking-[0.02em] mobile-landscape-card-text">向上跳</h3>
                                    <p className="tutorial-card-subtitle hidden landscape:block md:block text-kenney-dark/60 font-bold text-[1.2vw] md:text-[1.5vw] uppercase tracking-tight">跳起来撞击方块</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-2">
                            <button 
                                onClick={() => {
                                    void handleEnterPlaying();
                                }}
                                disabled={!motionController.isStarted || !themeImagesLoaded}
                                className={`kenney-button kenney-button-handdrawn px-6 sm:px-12 md:px-24 py-2 sm:py-4 md:py-8 text-base sm:text-2xl md:text-4xl hover:scale-110 transition-transform shadow-2xl mobile-landscape-button landscape-compact-button flex items-center justify-center gap-3 md:gap-4 ${(!motionController.isStarted || !themeImagesLoaded) ? 'opacity-100 bg-gray-400 border-gray-600 cursor-wait' : 'bg-kenney-green border-kenney-dark'}`}>
                                {(motionController.isStarted && themeImagesLoaded) ? (
                                    <>
                                        <span className="font-black leading-none pb-1 text-base sm:text-2xl md:text-4xl">开始！</span>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 md:w-7 md:h-7 animate-pulse filter drop-shadow-md">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                                        </svg>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 border-[3px] md:border-[4px] border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span className="font-black tracking-widest leading-none">加载中...</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}


        </div>
      )}

      <BugReportButton />
    </div>
  );
}
