import React, { useCallback, useEffect, useRef, useState } from 'react';
import CompletionOverlay from './components/CompletionOverlay';
import GameBackground from './components/GameBackground';
import { GameCanvas } from './components/GameCanvas';
import { LoadingScreen } from './components/LoadingScreen';
import { loadThemes, startBackgroundPreloading } from './gameConfig';
import { preloadAllGameAssets } from './services/assetLoader';
import { motionController } from './services/motionController';
import { getLocalAssetUrl, getR2AssetUrl } from './src/config/r2Config';
import { Theme, ThemeId } from './types';

declare global {
  interface Window {
    setBGMVolume?: (vol: number) => void;
  }
}

export enum GamePhase {
  MENU = 'MENU',
  THEME_SELECTION = 'THEME_SELECTION',
  LOADING = 'LOADING',
  TUTORIAL = 'TUTORIAL',
  PLAYING = 'PLAYING'
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FaceMaskSvg: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    className="w-full h-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
    aria-hidden="true"
  >
    <g>
      <path
        fill="#FFBDD1"
        d="M52 32 Q52 40.3 46.15 46.15 40.3 52 32 52 23.75 52 17.9 46.15 12 40.3 12 32 12 23.75 17.9 17.9 23.75 12 32 12 40.3 12 46.15 17.9 52 23.75 52 32 M32 14 Q24.6 14 19.35 19.3 L19.3 19.35 Q14 24.6 14 32 14 39.45 19.3 44.75 L19.35 44.75 Q24.6 50 32 50 39.45 50 44.75 44.75 50 39.45 50 32 50 24.6 44.75 19.35 L44.75 19.3 Q39.45 14 32 14"
      />
      <path
        fill="#FF8AAE"
        d="M32 14 Q39.45 14 44.75 19.3 L44.75 19.35 Q50 24.6 50 32 50 39.45 44.75 44.75 39.45 50 32 50 24.6 50 19.35 44.75 L19.3 44.75 Q14 39.45 14 32 14 24.6 19.3 19.35 L19.35 19.3 Q24.6 14 32 14"
      />
      <path
        fill="#913F58"
        d="M32 8 Q41.95 8 49 15.1 56 22.1 56 32 56 41.95 49 49 41.95 56 32 56 22.1 56 15.1 49 8 41.95 8 32 8 22.1 15.05 15.1 L15.1 15.05 Q22.1 8 32 8 M52 32 Q52 23.75 46.15 17.9 40.3 12 32 12 23.75 12 17.9 17.9 12 23.75 12 32 12 40.3 17.9 46.15 23.75 52 32 52 40.3 52 46.15 46.15 52 40.3 52 32"
      />
      <path
        fill="#FFFFFF"
        d="M40 29 Q40 32.3 37.6 34.6 35.35 37 32 37 28.6 37 26.35 34.6 24 32.3 24 29 24 25.65 26.35 23.25 28.6 21 32 21 35.35 21 37.6 23.25 40 25.65 40 29 M36 29 Q36 27.3 34.8 26.1 33.65 25 32 25 30.35 25 29.2 26.1 28 27.3 28 29 28 30.65 29.2 31.8 30.35 33 32 33 33.65 33 34.8 31.8 36 30.65 36 29"
      />
      <path
        fill="#AF4D62"
        d="M36 29 Q36 30.65 34.8 31.8 33.65 33 32 33 30.35 33 29.2 31.8 28 30.65 28 29 28 27.3 29.2 26.1 30.35 25 32 25 33.65 25 34.8 26.1 36 27.3 36 29"
      />
      <path
        fill="#AF4D62"
        d="M35.25 42.2 Q33.9 43.5 32 43.5 30.1 43.5 28.65 42.15 L28.65 42.1 28.25 41.65 Q27.95 41.3 28 40.9 28.05 40.5 28.4 40.25 28.7 39.95 29.1 40 29.5 40.05 29.8 40.4 L30.05 40.7 Q30.9 41.5 32 41.5 33.15 41.5 33.95 40.7 L34.05 40.6 34.15 40.5 Q34.35 40.1 34.75 40.05 L35.5 40.15 36 40.75 35.85 41.55 35.25 42.2"
      />
    </g>
  </svg>
);

export default function App() {
  const [score, setScore] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [selectedThemes, setSelectedThemes] = useState<ThemeId[]>([]);
  const [isPortrait, setIsPortrait] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [bgIndex, setBgIndex] = useState(0);
  const [themes, setThemes] = useState<Theme[]>([]);

  const phaseRef = useRef<GamePhase>(GamePhase.MENU);
  const [phase, setPhaseState] = useState<GamePhase>(GamePhase.MENU);
  const [initStatus, setInitStatus] = useState<string>('');
  const [themeImagesLoaded, setThemeImagesLoaded] = useState(false);
  const [hasShownEmoji, setHasShownEmoji] = useState(false);
  const [nosePosition, setNosePosition] = useState({ x: 0.5, y: 0.5 });
  const [faceBox, setFaceBox] = useState<FaceBox>({ x: 0.5, y: 0.5, width: 0.18, height: 0.24 });
  const [isNoseDetected, setIsNoseDetected] = useState(false);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
  
  // Loading State
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');

  const maskScale = 1.1;
  const maskLeft = clamp(1 - nosePosition.x, 0.05, 0.95);
  const maskTop = clamp(nosePosition.y, 0.05, 0.95);
  const maskWidth = Math.max(faceBox.width * maskScale, 0.14);
  const maskHeight = Math.max(faceBox.height * maskScale, 0.18);
  
  const setPhase = (newPhase: GamePhase) => {
    phaseRef.current = newPhase;
    setPhaseState(newPhase);
    
    // Adjust BGM volume based on game phase
    if (newPhase === GamePhase.PLAYING) {
      window.setBGMVolume?.(0.2);
    } else {
      window.setBGMVolume?.(0.3);
      
      // Force exit fullscreen when entering MENU or THEME_SELECTION
      if (newPhase === GamePhase.MENU || newPhase === GamePhase.THEME_SELECTION) {
        const doc = document as any;
        const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
        if (isFull) {
            if (document.exitFullscreen) {
              document.exitFullscreen().catch(() => {});
            } else if (doc.webkitExitFullscreen) {
              doc.webkitExitFullscreen();
            } else if (doc.mozCancelFullScreen) {
              doc.mozCancelFullScreen();
            } else if (doc.msExitFullscreen) {
              doc.msExitFullscreen();
            }
        }
      }
    }
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as any;
      const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
      console.log('Fullscreen change detected:', isFull);
      setIsFullscreen(isFull);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    let bgmAudio: HTMLAudioElement | null = null;
    let isPlaying = false;
    let hasTriedFallback = false;
    
    const updateVolume = (vol: number) => {
      if (bgmAudio) {
        bgmAudio.volume = vol;
      }
    };
    
    window.setBGMVolume = updateVolume;
    
    const initBGM = async () => {
      if (isPlaying) return;
      
      const bgmCdnUrl = getR2AssetUrl('assets/kenney/Sounds/funny-kids-video-322163.mp3');
      const bgmLocalUrl = getLocalAssetUrl(bgmCdnUrl);
      bgmAudio = new Audio(bgmCdnUrl);
      bgmAudio.loop = true;
      bgmAudio.volume = 0.3;
      bgmAudio.preload = 'auto';
      bgmAudio.addEventListener('error', () => {
        if (!bgmAudio || hasTriedFallback) return;
        hasTriedFallback = true;
        bgmAudio.src = bgmLocalUrl;
        bgmAudio.load();
        if (isPlaying) {
          bgmAudio.play().catch(() => {});
        }
      });
      
      try {
        await bgmAudio.play();
        isPlaying = true;
        console.log('BGM started playing');
      } catch (e) {
        console.log('BGM play failed, waiting for user interaction:', e);
      }
    };
    
    initBGM();
    
    const handleInteraction = () => {
      if (!isPlaying && bgmAudio) {
        bgmAudio.play().catch(() => {});
      }
    };
    
    document.addEventListener('click', handleInteraction);
    document.addEventListener('touchstart', handleInteraction);
    document.addEventListener('keydown', handleInteraction);
    
    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
      if (bgmAudio) {
        bgmAudio.pause();
        bgmAudio.src = '';
        bgmAudio = null;
      }
      isPlaying = false;
    };
  }, []);

  const toggleFullscreen = async (e?: React.MouseEvent | React.TouchEvent) => {
    // IMPORTANT: Prevent default and propagation to avoid event interference
    if (e) {
      // Prevent double-firing: if we handled touch, don't handle click
      if (e.type === 'click' && (e as any).detail === 0) {
          // This is a synthetic click from a touch event that we likely already handled
          // However, React's event normalization makes this tricky.
          // Best approach is to rely on e.preventDefault() in touchstart
      }

      if (typeof e.cancelable !== 'boolean' || e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
    }
    
    // Explicitly focus body to remove focus from any button
    document.body.focus();
    
    try {
      const doc = document as any;
      const isCurrentlyFullscreen = !!(
        doc.fullscreenElement || 
        doc.webkitFullscreenElement || 
        doc.mozFullScreenElement || 
        doc.msFullscreenElement ||
        doc.webkitIsFullScreen ||
        doc.mozFullScreen ||
        doc.msFullscreenElement
      );

      console.log('toggleFullscreen action:', isCurrentlyFullscreen ? 'EXITING' : 'ENTERING');

      if (!isCurrentlyFullscreen) {
        const docEl = document.documentElement as any;
        // Check for permission policies (though usually not blocking for user gesture)
        
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          await docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          await docEl.msRequestFullscreen();
        }
        
        // Try to lock orientation after entering fullscreen
        if (window.screen.orientation && (window.screen.orientation as any).lock) {
            try {
                await (window.screen.orientation as any).lock('landscape');
            } catch (err) {
                console.warn('Orientation lock failed:', err);
            }
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
    } catch (e) {
      console.error('Fullscreen toggle failed', e);
    }
  };

  useEffect(() => {
    // Add custom animation styles directly to the document
    const style = document.createElement('style');
    const fontCdnUrl = getR2AssetUrl('assets/Fredoka/static/Fredoka-Bold.ttf');
    const fontLocalUrl = getLocalAssetUrl(fontCdnUrl);
    style.innerHTML = `
      @font-face {
        font-family: 'FredokaLocal';
        src: url('${fontCdnUrl}') format('truetype'), url('${fontLocalUrl}') format('truetype');
        font-weight: bold;
        font-style: normal;
        font-display: swap;
      }

      body, button, div, span, h1, h2, h3 {
        font-family: 'FredokaLocal', 'Arial Rounded MT Bold', 'Chalkboard SE', 'Comic Sans MS', cursive !important;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
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

      .live-view-video {
        filter: blur(1.2px) brightness(0.92) contrast(0.92) saturate(0.9);
      }

      .live-view-mask {
        background: linear-gradient(135deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.08));
        -webkit-backdrop-filter: blur(1.5px);
        backdrop-filter: blur(1.5px);
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
        .mobile-landscape-character {
          width: 5rem !important;
          height: 5rem !important;
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
        @media (max-height: 480px) {
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
          .theme-card span {
            font-size: 0.9rem !important;
          }
          .theme-card p {
            font-size: 0.65rem !important;
            line-clamp: 2;
          }
          .theme-badge {
            font-size: 8px !important;
            padding: 0.25rem 0.5rem !important;
          }
        }
        
        @media (max-height: 600px) and (max-width: 768px) {
          .theme-card p {
            font-size: 0.7rem !important;
          }
          .theme-card span {
            font-size: 1rem !important;
          }
        }

        /* Smooth scrolling for theme grid */
        .scrollbar-hide {
          scroll-behavior: smooth;
        }
          font-size: 0.6rem !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
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
    
    // Early initialize AI models
    console.log("App: Background initializing AI models...");
    motionController.init().catch(err => {
      console.warn("App: Failed to background initialize AI models:", err);
    });
  }, []);

  const handleStartProcess = async () => {
    // 1. Unlock Web Audio / Speech Synthesis for mobile (iOS/Android)
    if ('speechSynthesis' in window) {
      const silence = new SpeechSynthesisUtterance('');
      silence.volume = 0;
      window.speechSynthesis.speak(silence);
    }
    
    setPhase(GamePhase.THEME_SELECTION);
  };

  const enterFullscreenAndLockOrientation = async () => {
    try {
      // Force Landscape Orientation if supported
      if (window.screen.orientation && (window.screen.orientation as any).lock) {
        await (window.screen.orientation as any).lock('landscape').catch((e: any) => {
          console.log('Orientation lock failed', e);
        });
      }

      // Enter Fullscreen
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
      } else if ((docEl as any).msRequestFullscreen) {
        await (docEl as any).msRequestFullscreen();
      }
    } catch (e) {
      console.log('Fullscreen/Orientation lock failed', e);
    }
  };

  const handleBackToMenu = useCallback(() => {
    // 强制清理
    setScore(0);
    setTotalQuestions(0);
    setShowCompletion(false);
    setPhase(GamePhase.THEME_SELECTION);
    // Don't stop the stream, just transition phase
  }, []);

  const handleExitToMenu = () => {
    // Stop motion controller and camera stream only when completely exiting to main menu
    if (motionController) motionController.stop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    // Exit fullscreen
    const doc = document as any;
    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
    if (isFull) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
    
    // Unlock orientation
    if (window.screen.orientation && (window.screen.orientation as any).unlock) {
      (window.screen.orientation as any).unlock();
    }

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

  const initializeCamera = async (): Promise<boolean> => {
    // If we already have a stream and it's active, skip
    if (streamRef.current && streamRef.current.active && videoRef.current) {
        try {
            if (!videoRef.current.srcObject) {
                videoRef.current.srcObject = streamRef.current;
            }
            videoRef.current.muted = true;
            videoRef.current.playsInline = true;
            await videoRef.current.play();
            
            if (!motionController.isStarted) {
                await motionController.start(videoRef.current);
            }
            motionController.calibrate();
            
            // 启动 nose position update loop
            startNoseTrackingLoop();
            
            return true;
        } catch (e) {
            console.error('Failed to reuse camera:', e);
        }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera API required.");
        return false;
    }

    try {
        const isIPad = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
        const videoConstraints: any = {
            facingMode: 'user',
            width: isIPad ? { ideal: 1280, max: 1920 } : { ideal: 640, max: 1280 },
            height: isIPad ? { ideal: 720, max: 1080 } : { ideal: 480, max: 720 },
            frameRate: { ideal: 30, max: 30 }
        };
        if (isIPad) videoConstraints.frameRate = { ideal: 30, max: 60 };

        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        streamRef.current = stream;

        if (videoRef.current) {
             videoRef.current.srcObject = stream;
             videoRef.current.muted = true;
             videoRef.current.playsInline = true;
             
             await new Promise<void>((resolve) => {
                 if (videoRef.current!.readyState >= 1) {
                     resolve();
                 } else {
                     videoRef.current!.onloadedmetadata = () => resolve();
                 }
             });

             await videoRef.current.play();
             await motionController.start(videoRef.current);
             
             // 启动 nose position update loop
             startNoseTrackingLoop();
             
             return true;
        }
        return false;
    } catch (err) {
        console.error("Camera init failed:", err);
        alert("Camera initialization failed: " + err);
        return false;
    }
  };

  const startNoseTrackingLoop = () => {
        let lastUpdateTime = 0;
        let consecutiveMissedFrames = 0;
        const updateNosePosition = (timestamp: number) => {
            if (phaseRef.current !== GamePhase.TUTORIAL && phaseRef.current !== GamePhase.PLAYING && phaseRef.current !== GamePhase.LOADING) {
                // Keep running during LOADING to detect nose early
                // But maybe stop if we exit to MENU
                if (phaseRef.current === GamePhase.MENU || phaseRef.current === GamePhase.THEME_SELECTION) {
                    return; 
                }
            }
            
            if (timestamp - lastUpdateTime >= 30) {
                if (motionController.state) {
                    if (motionController.isNoseDetected) {
                        const overlayState = motionController.smoothedState || motionController.state;
                        setNosePosition({
                            x: overlayState.rawNoseX,
                            y: overlayState.rawNoseY
                        });
                        const nextFaceBox: FaceBox = {
                            x: typeof overlayState.rawFaceX === 'number' ? overlayState.rawFaceX : overlayState.rawNoseX,
                            y: typeof overlayState.rawFaceY === 'number' ? overlayState.rawFaceY : overlayState.rawNoseY,
                            width: typeof overlayState.rawFaceWidth === 'number' ? overlayState.rawFaceWidth : 0.18,
                            height: typeof overlayState.rawFaceHeight === 'number' ? overlayState.rawFaceHeight : 0.24
                        };
                        setFaceBox({
                            x: clamp(nextFaceBox.x, 0.05, 0.95),
                            y: clamp(nextFaceBox.y, 0.05, 0.95),
                            width: clamp(nextFaceBox.width, 0.08, 0.7),
                            height: clamp(nextFaceBox.height, 0.1, 0.8)
                        });
                        consecutiveMissedFrames = 0;
                    } else {
                        consecutiveMissedFrames++;
                        if (consecutiveMissedFrames >= 10) {
                            const gradualRate = 0.05;
                            setNosePosition(prev => ({
                                x: prev.x * (1 - gradualRate) + 0.5 * gradualRate,
                                y: prev.y * (1 - gradualRate) + 0.5 * gradualRate
                            }));
                            setFaceBox(prev => ({
                                x: prev.x * (1 - gradualRate) + 0.5 * gradualRate,
                                y: prev.y * (1 - gradualRate) + 0.5 * gradualRate,
                                width: prev.width * (1 - gradualRate) + 0.18 * gradualRate,
                                height: prev.height * (1 - gradualRate) + 0.24 * gradualRate
                            }));
                        }
                    }
                    setIsNoseDetected(motionController.isNoseDetected);
                }
                lastUpdateTime = timestamp;
            }
            requestAnimationFrame(updateNosePosition);
        };
        requestAnimationFrame(updateNosePosition);
  };

  const handleStartGame = async () => {
    if (selectedThemes.length === 0) return;

    setBgIndex(0);
    setThemeImagesLoaded(false); // Reset when selecting a new theme
    
    // 0. Enter Loading Phase
    setPhase(GamePhase.LOADING);
    setLoadingProgress(0);
    setLoadingStatus('Initializing Camera & Assets...');

    // Enter fullscreen immediately
    await enterFullscreenAndLockOrientation();

    // 1. Parallel Loading: Assets + Camera
    try {
        // We wrap camera init in a promise that reports progress/status if we wanted
        // For now, we just run it parallel.
        
        // However, we need to request camera permission ASAP to avoid user gesture timeout issues if strict?
        // Actually, we are inside the click handler (handleStartGame), so getUserMedia should be fine.
        // But the 'await' for setPhase might break the stack? 
        // React state updates are async but usually microtasks.
        // Let's try to start getUserMedia FIRST if we don't have it.
        
        let cameraPromise: Promise<boolean>;
        
        // Define a wrapper to update status
        const initCameraWithStatus = async () => {
             // Delay slightly to allow UI to render "Initializing Camera..."
             await new Promise(r => setTimeout(r, 100)); 
             const success = await initializeCamera();
             if (!success) throw new Error("Camera failed");
             return success;
        };

        cameraPromise = initCameraWithStatus();

        // Assets Promise
        const assetsPromise = preloadAllGameAssets(selectedThemes, (progress, status) => {
            // We can mix the progress if we want, or just let asset loader drive the bar
            // and camera status drive the text.
            // For simplicity, let asset loader drive the bar 0-100.
            setLoadingProgress(progress);
            setLoadingStatus(status); 
        });

        await Promise.all([cameraPromise, assetsPromise]);

        // Start background preloading for the REST of the themes
        const firstThemeId = selectedThemes[0];
        const themesToPreload = themes.filter(t => selectedThemes.includes(t.id) && t.id !== firstThemeId);
        if (themesToPreload.length > 0) {
            startBackgroundPreloading(themesToPreload);
        }

        setThemeImagesLoaded(true);
        setPhase(GamePhase.TUTORIAL);
        setInitStatus('System Ready!');
        
    } catch (e) {
        console.error("Loading failed:", e);
        setPhase(GamePhase.MENU);
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
  
  const handleGameOver = useCallback(() => {
    setShowCompletion(true);
  }, []);

  const handleGameRestart = useCallback(() => {
    setShowCompletion(false);
    setBgIndex(0);
  }, []);

  return (
    <div className="relative w-full h-screen h-[100dvh] overflow-hidden bg-kenney-blue font-sans select-none text-kenney-dark">
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
            className="fixed inset-0 z-[1000] bg-kenney-dark/95 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center text-white touch-none"
            onWheel={(e) => e.preventDefault()}
            onTouchMove={(e) => e.preventDefault()}
          >
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
                  Rotate Screen
              </h2>
              <p className="text-lg md:text-2xl font-bold opacity-90 uppercase tracking-widest">
                  Turn your phone!
              </p>
          </div>
      )}

      {/* Background Image Overlay */}
      <div 
        className="absolute inset-0 z-0 opacity-30 pointer-events-none bg-repeat bg-center"
        style={{ backgroundImage: `url('${getR2AssetUrl('assets/kenney/Vector/Backgrounds/background_clouds.svg')}')`, backgroundSize: '800px' }}
      />

      {/* 1. Camera HUD */}
      <div className={`fixed top-4 md:top-6 right-4 md:right-6 z-[60] transition-transform duration-500 ease-in-out mobile-landscape-camera ${phase === GamePhase.MENU || phase === GamePhase.THEME_SELECTION ? 'translate-x-[200%]' : 'translate-x-0'}`}>
        <div className="bg-white p-1 md:p-2 border-[2px] md:border-[4px] border-kenney-dark rounded-kenney shadow-lg scale-75 md:scale-100 origin-top-right">
           <div className="w-20 h-15 sm:w-24 sm:h-18 md:w-32 md:h-24 overflow-hidden relative bg-kenney-dark/10 rounded-lg md:rounded-xl">
               <video 
                 ref={videoRef} 
                 className="w-full h-full object-cover transform scale-x-[-1] live-view-video" 
                 playsInline 
                 muted 
                 autoPlay 
                 webkit-playsinline="true"
               />
                <div className="absolute inset-0 pointer-events-none">
                  {/* Soft privacy/clarity mask over live view */}
                  <div className="absolute inset-0 live-view-mask"></div>
                  {/* Face Mask Overlay */}
                  <div 
                    className={`absolute flex items-center justify-center -translate-x-1/2 -translate-y-1/2 ${!isNoseDetected ? 'opacity-0 scale-0' : 'opacity-100 scale-100'} transition-[opacity,transform] duration-200`}
                    style={{
                      left: `${maskLeft * 100}%`,
                      top: `${maskTop * 100}%`,
                      width: `${maskWidth * 100}%`,
                      height: `${maskHeight * 100}%`
                    }}
                  >
                    <FaceMaskSvg />
                  </div>
                </div>
             </div>
           <div className="mt-0.5 text-center text-[6px] md:text-[10px] font-black tracking-widest uppercase">Live View</div>
        </div>
      </div>

      {/* 2.5 Unified Back Button & Fullscreen Toggle */}
      {(phase !== GamePhase.MENU) && (
          <div className="fixed top-4 md:top-6 left-4 md:left-6 z-[999] flex items-center gap-3 md:gap-4 mobile-landscape-control">
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
              className="kenney-button-circle group scale-90 md:scale-100 flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>

            {/* Score Panel Integrated with Back Button for alignment */}
             {phase === GamePhase.PLAYING && (
               <div className="score-panel kenney-panel px-3 md:px-5 py-1 md:py-2 flex items-center gap-2 md:gap-4 transition-all bg-white/90 backdrop-blur-sm shadow-[0_4px_0_#333333] border-[3px] md:border-[4px]">
                 <img src={getR2AssetUrl('assets/kenney/Vector/Tiles/star.svg')} className="w-6 h-6 md:w-12 md:h-12" alt="Score" />
                 <span className="text-xl md:text-4xl font-black text-kenney-dark tabular-nums tracking-tight">
                   {score} / {totalQuestions}
                 </span>
               </div>
             )}

            {/* Fullscreen Toggle - Only in PLAYING/TUTORIAL phase */}
            {phase !== GamePhase.THEME_SELECTION && (
                <button 
                  onTouchStart={(e) => {
                    // Handle touch immediately and prevent mouse events
                    e.preventDefault(); 
                    toggleFullscreen(e);
                  }}
                  onClick={(e) => {
                      // Only handle clicks if they are NOT from touch interactions
                      // (preventDefault in touchStart should prevent this, but just in case)
                      toggleFullscreen(e);
                  }}
                  style={{ pointerEvents: 'auto', touchAction: 'none' }}
                  className="kenney-button-circle group scale-90 md:scale-100 bg-kenney-yellow"
                  title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                  {isFullscreen ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3 3m12 6V4.5M15 9h4.5M15 9l6-6M9 15v4.5M9 15H4.5M9 15l-6 6m12-6v4.5M15 15h4.5M15 15l6 6" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-5 h-5 md:w-8 md:h-8 group-hover:scale-110 transition-transform">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
            )}
          </div>
      )}

      {/* Fullscreen toggle for Main Menu specifically - REMOVED per user request */}

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
            />
          </div>
        </>
      )}

      {/* 5. Completion Overlay (Sandwich Top Layer) */}
      <CompletionOverlay 
        isVisible={showCompletion} 
        score={score} 
        total={totalQuestions} 
      />

      {/* 5. Menus & Overlays */}
      {phase !== GamePhase.PLAYING && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-kenney-blue/60 backdrop-blur-sm p-4">
            
            {/* LOADING SCREEN */}
            {phase === GamePhase.LOADING && (
                <LoadingScreen progress={loadingProgress} status={loadingStatus} />
            )}
            
            {/* MAIN MENU */}
            {phase === GamePhase.MENU && (
                <div className="text-center w-full max-w-4xl px-4 md:px-8 relative flex flex-col items-center justify-center min-h-0 h-full max-h-screen overflow-y-auto py-4 md:py-12 gap-2 md:gap-6 scrollbar-hide">
                    {/* Top: Player Character */}
                    <div className="relative shrink-0">
                      <img 
                        src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_jump.svg')}
                        className="w-16 h-16 sm:w-20 sm:h-20 md:w-48 md:h-48 lg:w-56 lg:h-56 animate-bounce drop-shadow-xl mobile-landscape-character" 
                        alt="Character" 
                      />
                    </div>
                    
                    {/* Middle: Title (Single Line) */}
                    <div className="flex flex-col items-center px-4 md:px-10 w-full overflow-hidden shrink-0">
                        <h1 className="text-3xl sm:text-5xl md:text-8xl lg:text-9xl font-normal text-white drop-shadow-[0_4px_0_#333333] md:drop-shadow-[0_6px_0_#333333] tracking-normal uppercase italic leading-none rotate-[-1deg] whitespace-nowrap py-2 md:py-4 mobile-landscape-title">
                            JUMP <span className="text-kenney-yellow">&</span> SAY
                        </h1>
                    </div>
                    
                    {/* Bottom: Start Button */}
                    <div className="py-2 md:py-0 shrink-0">
                        <button onClick={handleStartProcess} 
                            className="kenney-button kenney-button-handdrawn px-6 sm:px-12 md:px-24 py-2 sm:py-4 md:py-8 text-base sm:text-2xl md:text-4xl hover:scale-110 transition-transform mobile-landscape-button">
                            START GAME
                        </button>
                    </div>
                </div>
            )}

            {/* THEME SELECTION */}
            {phase === GamePhase.THEME_SELECTION && (
                <div className="text-center w-full max-w-[98vw] lg:max-w-[95vw] px-2 md:px-4 flex flex-col items-center justify-center h-full max-h-screen py-2 md:py-4 gap-2 md:gap-3 overflow-hidden relative">
                    <h2 className="text-lg sm:text-2xl md:text-4xl lg:text-5xl font-black text-white mb-1 md:mb-2 tracking-wide uppercase drop-shadow-[0_4px_0_#333333] italic shrink-0 mobile-landscape-title">
                        SELECT THEME
                    </h2>
                    <div className="w-full overflow-y-auto overflow-x-hidden pb-3 px-0.5 md:px-2 scrollbar-hide min-h-0 flex-1 will-change-transform">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-2.5 px-1 md:px-0 auto-rows-min pb-32">
                            {themes.map((theme, index) => {
                                const isSelected = selectedThemes.includes(theme.id as ThemeId);
                                const selectionIndex = selectedThemes.indexOf(theme.id as ThemeId);
                                return (
                                <button
                                    key={theme.id}
                                    onClick={() => theme.isAvailable !== false && handleThemeSelect(theme.id as ThemeId)}
                                    className={`group relative overflow-hidden rounded-xl transition-all duration-200 will-change-transform ${
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
                                    {/* Theme Card with soft color - shorter */}
                                    <div className={`relative w-full h-16 sm:h-20 md:h-24 lg:h-28 bg-white p-1.5 md:p-2 flex flex-col items-center justify-center border-2 md:border-3 border-kenney-dark rounded-xl shadow-lg transition-all will-change-transform ${isSelected ? 'bg-gray-100' : 'group-hover:shadow-2xl'}`}>
                                        {/* Cute dots pattern background */}
                                        <div className="absolute inset-0 opacity-5 pointer-events-none rounded-xl" style={{
                                            backgroundImage: 'radial-gradient(circle, #333333 1px, transparent 1px)',
                                            backgroundSize: '12px 12px'
                                        }} />
                                        
                                        {/* Soft colored background circle */}
                                        <div className="absolute inset-1 rounded-lg opacity-15 pointer-events-none" style={{
                                            background: ['#4c99ff', '#77b039', '#ff5c5c', '#ffcc00', '#a67c52'][
                                                index % 5
                                            ]
                                        }} />
                                        
                                        {/* Selection Order Number Overlay */}
                                        {isSelected && (
                                            <div className="absolute inset-0 flex items-center justify-center z-20 bg-kenney-green/20 backdrop-blur-[1px] rounded-xl">
                                                <div className="w-8 h-8 md:w-12 md:h-12 bg-kenney-green border-2 md:border-4 border-white rounded-full flex items-center justify-center shadow-lg animate-bounce-short">
                                                    <span className="text-lg md:text-2xl font-black text-white leading-none">
                                                        {selectionIndex + 1}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Content - centered */}
                                        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center px-0.5">
                                            {/* Theme Name - properly sized */}
                                            <h3 className="text-[10px] sm:text-xs md:text-sm lg:text-base font-black text-kenney-dark text-center leading-tight line-clamp-3 break-words">
                                                {theme.name}
                                            </h3>
                                        </div>
                                    </div>
                                    
                                    {/* Word count badge - cute corner */}
                                    {theme.questions?.length ? (
                                        <div className="absolute -top-1 -right-1 bg-kenney-yellow border-2 border-kenney-dark rounded-full w-6 h-6 md:w-8 md:h-8 shadow-lg flex items-center justify-center transform group-hover:scale-125 transition-transform">
                                            <span className="text-[8px] md:text-[10px] font-black text-kenney-dark leading-none">
                                                {theme.questions.length}
                                            </span>
                                        </div>
                                    ) : null}
                                </button>
                            )})}
                        </div>
                    </div>
                    
                    {/* START BUTTON FIXED BOTTOM - Adjusted for non-fullscreen layouts */}
                    <div className="absolute bottom-10 sm:bottom-14 md:bottom-20 left-0 right-0 flex justify-center px-4 pointer-events-none z-50">
                         <button 
                            onClick={handleStartGame}
                            disabled={selectedThemes.length === 0}
                            className={`pointer-events-auto kenney-button kenney-button-handdrawn px-8 py-3 text-xl md:text-2xl shadow-2xl transition-all transform duration-300 ${selectedThemes.length > 0 ? 'scale-100 opacity-100 translate-y-0' : 'scale-50 opacity-0 translate-y-10'}`}
                        >
                            START GAME ({selectedThemes.length})
                        </button>
                    </div>
                </div>
            )}

            {/* TUTORIAL */}
            {phase === GamePhase.TUTORIAL && (
                <div className="text-center w-full max-w-6xl px-8 md:px-20 lg:px-32 flex flex-col items-center h-full max-h-screen pt-[12vh] md:pt-[15vh] gap-[2vh] md:gap-[4vh] overflow-hidden">
                    
                    <h2 className="text-[4vw] sm:text-[5vw] md:text-[6vw] font-normal text-white italic tracking-tight uppercase drop-shadow-[0_4px_0_#333333] md:drop-shadow-[0_6px_0_#333333] rotate-[-1deg] shrink-0 mobile-landscape-title landscape-compact-title leading-none">
                        HOW TO PLAY
                    </h2>
                    
                    <div className="w-full flex-1 flex flex-col items-center justify-start min-h-0 gap-[2vh] md:gap-[4vh]">
                        <div className="grid grid-cols-2 gap-[3vw] md:gap-[4vw] w-full max-w-3xl lg:max-w-4xl min-h-0 mobile-landscape-tutorial-grid">
                            <div className="kenney-panel p-[2vh] md:p-[4vh] flex flex-col items-center group hover:bg-kenney-light transition-colors mobile-landscape-panel mobile-landscape-tutorial-card landscape-compact-card shadow-[4px_4px_0px_#333333] border-[3px] md:border-[4px] rounded-2xl md:rounded-3xl">
                                <div className="flex-1 flex items-center justify-center min-h-0 w-full bg-kenney-blue/10 rounded-xl mb-2 md:mb-4">
                                    <img src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_walk_a.svg')} className="w-[8vw] h-[8vw] sm:w-[10vw] sm:h-[10vw] md:w-[14vw] md:h-[14vw] lg:w-[16vw] lg:h-[16vw] animate-bounce-horizontal-large mobile-landscape-card-img landscape-compact-img drop-shadow-md" alt="" />
                                </div>
                                <div className="shrink-0 flex flex-col items-center gap-1">
                                    <h3 className="text-[2vw] sm:text-[2.5vw] md:text-[3vw] font-black text-kenney-dark uppercase tracking-tighter italic mobile-landscape-card-text drop-shadow-sm">MOVE</h3>
                                    <p className="hidden landscape:block md:block text-kenney-dark/60 font-bold text-[1.2vw] md:text-[1.5vw] uppercase tracking-tight">Tilt your body</p>
                                </div>
                            </div>

                            <div className="kenney-panel p-[2vh] md:p-[4vh] flex flex-col items-center group hover:bg-kenney-light transition-colors mobile-landscape-panel mobile-landscape-tutorial-card landscape-compact-card shadow-[4px_4px_0px_#333333] border-[3px] md:border-[4px] rounded-2xl md:rounded-3xl">
                                <div className="flex-1 flex items-center justify-center min-h-0 w-full bg-kenney-blue/10 rounded-xl mb-2 md:mb-4">
                                    <img src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_jump.svg')} className="w-[8vw] h-[8vw] sm:w-[10vw] sm:h-[10vw] md:w-[14vw] md:h-[14vw] lg:w-[16vw] lg:h-[16vw] animate-bounce mobile-landscape-card-img landscape-compact-img drop-shadow-md" alt="" />
                                </div>
                                <div className="shrink-0 flex flex-col items-center gap-1">
                                    <h3 className="text-[2vw] sm:text-[2.5vw] md:text-[3vw] font-black text-kenney-dark uppercase tracking-tighter italic mobile-landscape-card-text drop-shadow-sm">JUMP</h3>
                                    <p className="hidden landscape:block md:block text-kenney-dark/60 font-bold text-[1.2vw] md:text-[1.5vw] uppercase tracking-tight">Jump to hit blocks</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-2">
                            <button 
                                onClick={() => {
                                    setBgIndex(0);
                                    setHasShownEmoji(true);
                                    // Force fullscreen again when entering gameplay
                                    enterFullscreenAndLockOrientation();
                                    setPhase(GamePhase.PLAYING);
                                }}
                                disabled={!motionController.isStarted || !themeImagesLoaded}
                                className={`kenney-button kenney-button-handdrawn px-8 sm:px-16 md:px-24 py-3 sm:py-5 md:py-6 hover:scale-105 active:scale-95 transition-all shadow-2xl shrink-0 mobile-landscape-button landscape-compact-button flex items-center justify-center gap-3 md:gap-4 min-w-[160px] md:min-w-[240px] ${(!motionController.isStarted || !themeImagesLoaded) ? 'opacity-100 bg-gray-400 border-gray-600 cursor-wait' : 'bg-kenney-green border-kenney-dark'}`}>
                                {(motionController.isStarted && themeImagesLoaded) ? (
                                    <>
                                        <span className="drop-shadow-md text-2xl sm:text-4xl md:text-5xl font-black leading-none pb-1">GO!</span>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 animate-pulse filter drop-shadow-md">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                                        </svg>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 border-[3px] md:border-[4px] border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span className="text-base sm:text-xl md:text-2xl font-black tracking-widest leading-none">LOADING...</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}


        </div>
      )}
    </div>
  );
}
