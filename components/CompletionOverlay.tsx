import { AnimatePresence, motion } from 'framer-motion';
import type Phaser from 'phaser';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getR2AssetUrl } from '../src/config/r2Config';
import { ImgWithFallback } from './ImgWithFallback';

interface CompletionOverlayProps {
  score: number;
  total: number;
  isVisible: boolean;
  onNextLevel?: () => void;
  onRestart?: () => void;
}

const FULL_SCORE_WORDS = ['Perfect', 'Super', 'Amazing', 'Awesome', 'Excellent'];
const FEEDBACK_VOICE_VOLUME = 0.55;
const FEEDBACK_SFX_VOLUME = 0.18;
const FEEDBACK_VOICE_CACHE_VERSION = '20260217_voice_fix1';
const FEEDBACK_RETRY_EVENTS: Array<'click' | 'touchstart' | 'keydown'> = ['click', 'touchstart', 'keydown'];
const STAR_POP_START_DELAY_SEC = 0.8;
const STAR_POP_STAGGER_SEC = 0.22;
const STAR_POP_DURATION_SEC = 0.4;
const STAR_SOUND_SYNC_OFFSET_SEC = 0.1;
const REWARD_VOICE_KEY_PREFIX = 'voice_';
const AUTO_ADVANCE_EXTRA_DELAY_SEC = 2.5;
const AUTO_ADVANCE_MAX_DELAY_MS = 5500;
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;

interface ViewportSize {
  width: number;
  height: number;
}

interface StarLayoutConfig {
  starSizePx: number;
  starGapPx: number;
  starsPerRow: number;
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const withFeedbackVoiceCacheVersion = (url: string): string => {
  try {
    const parsedUrl = new URL(url, window.location.href);
    parsedUrl.searchParams.set('voice', FEEDBACK_VOICE_CACHE_VERSION);
    return parsedUrl.toString();
  } catch (error) {
    console.warn('[Audio] Failed to append feedback voice cache version with URL API:', error);
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}voice=${FEEDBACK_VOICE_CACHE_VERSION}`;
  }
};

const getUnknownErrorName = (error: unknown): string => {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const maybeName = (error as { name?: unknown }).name;
    if (typeof maybeName === 'string') return maybeName;
  }
  return 'UnknownError';
};

const getUnknownErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return String(error);
};

const CompletionOverlay: React.FC<CompletionOverlayProps> = ({ score, total, isVisible, onNextLevel, onRestart }) => {
  const isPerfect = score === total;
  const [feedbackWord, setFeedbackWord] = useState('');
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => {
    if (typeof window === 'undefined') {
      return { width: DEFAULT_VIEWPORT_WIDTH, height: DEFAULT_VIEWPORT_HEIGHT };
    }
    return {
      width: window.innerWidth,
      height: window.innerHeight
    };
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaserVoiceRef = useRef<Phaser.Sound.BaseSound | null>(null);
  const overlayCycleRef = useRef(0);
  const playedVoiceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const updateViewportSize = (): void => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);

    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
    };
  }, []);

  const starLayoutConfig = useMemo<StarLayoutConfig>(() => {
    const safeTotal = Math.max(total, 1);
    const viewportWidth = Math.max(viewportSize.width, 320);
    const viewportHeight = Math.max(viewportSize.height, 480);
    const isNarrowMobile = viewportWidth <= 420;
    const isMobile = viewportWidth <= 768;

    const starsPerRow = isNarrowMobile
      ? Math.min(4, safeTotal)
      : isMobile
        ? Math.min(5, safeTotal)
        : Math.min(6, safeTotal);

    const starRows = Math.ceil(safeTotal / starsPerRow);
    const cardWidth = Math.min(viewportWidth * 0.92, 600);
    const horizontalPadding = clamp(cardWidth * 0.08, 20, 48);
    const starGapPx = isNarrowMobile ? 8 : isMobile ? 10 : 14;

    const availableWidth = cardWidth - horizontalPadding * 2;
    const starSizeByWidth = (availableWidth - (starsPerRow - 1) * starGapPx) / starsPerRow;

    // Keep stars within a safe vertical budget so small phones don't overflow.
    const starAreaHeightBudget = clamp(viewportHeight * 0.28, 120, 260);
    const starSizeByHeight = (starAreaHeightBudget - (starRows - 1) * starGapPx) / starRows;

    const starSizePx = Math.round(clamp(Math.min(starSizeByWidth, starSizeByHeight), 30, 80));

    return {
      starSizePx,
      starGapPx,
      starsPerRow
    };
  }, [total, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (isVisible) {
      overlayCycleRef.current += 1;
      playedVoiceKeyRef.current = null;
      return;
    }
    playedVoiceKeyRef.current = null;
    setFeedbackWord('');
  }, [isVisible]);

  // Use layout effect so the reward word is available before first paint.
  useLayoutEffect(() => {
    if (!isVisible) return;
    const isFullStars = total > 0 && score === total;
    if (!isFullStars) {
      setFeedbackWord('Great');
      return;
    }
    const randomWord = FULL_SCORE_WORDS[Math.floor(Math.random() * FULL_SCORE_WORDS.length)];
    setFeedbackWord(randomWord);
  }, [isVisible, score, total]);

  // Handle voice and sound feedback
  useEffect(() => {
    if (isVisible && feedbackWord) {
      const currentCycle = overlayCycleRef.current;
      const playbackKey = `${currentCycle}:${feedbackWord.toLowerCase()}`;
      if (playedVoiceKeyRef.current === playbackKey) {
        return;
      }
      playedVoiceKeyRef.current = playbackKey;

      let retryInteractionHandler: (() => void) | null = null;
      const stopPhaserVoice = (): void => {
        const activeVoice = phaserVoiceRef.current;
        if (!activeVoice) return;
        phaserVoiceRef.current = null;
        activeVoice.removeAllListeners();
        if (activeVoice.isPlaying) {
          activeVoice.stop();
        }
        activeVoice.destroy();
      };

      const stopHtmlAudio = (): void => {
        if (!audioRef.current) return;
        audioRef.current.pause();
        audioRef.current = null;
      };

      const playFallbackHtmlAudio = async (): Promise<void> => {
        let audioUrl = '';
        try {
          if (window.ensureAudioUnlocked) {
            const unlocked = await window.ensureAudioUnlocked();
            console.log(`[Audio] Audio unlock result: ${unlocked}`);
          }
        } catch (unlockError) {
          console.warn('[Audio] Audio unlock failed, continuing anyway:', unlockError);
        }
        
        const audioPath = `assets/kenney/Sounds/${feedbackWord.toLowerCase()}.mp3`;
        audioUrl = withFeedbackVoiceCacheVersion(getR2AssetUrl(audioPath));
        console.log(`[Audio] HTMLAudio URL: ${audioUrl}`);
        
        stopHtmlAudio();
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.preload = 'auto';
        audio.volume = FEEDBACK_VOICE_VOLUME;
        audio.onended = () => {
          console.log(`[Audio] HTMLAudio playback ended: ${feedbackWord}`);
          clearRetryInteractionHandler();
          window.restoreBGMVolume?.();
        };
        audio.onerror = (e) => {
          clearRetryInteractionHandler();
          console.error(`[Audio] Load failed (Network/404) for URL: ${audioUrl}`, e);
          window.restoreBGMVolume?.();
        };
        console.log(`[Audio] Attempting HTMLAudio fallback: ${audioUrl}`);
        await audio.play();
        console.log('[Audio] HTMLAudio fallback playback started successfully');
      };

      const clearRetryInteractionHandler = (): void => {
        if (!retryInteractionHandler) return;
        FEEDBACK_RETRY_EVENTS.forEach((eventName) => {
          document.removeEventListener(eventName, retryInteractionHandler as EventListener);
        });
        retryInteractionHandler = null;
      };

      // 1. Audio Feedback (MP3)
      const playAudio = async () => {
        try {
          if (window.setBGMVolume) {
            window.setBGMVolume(0);
          }
          stopPhaserVoice();
          stopHtmlAudio();

          const voiceKey = `${REWARD_VOICE_KEY_PREFIX}${feedbackWord.toLowerCase()}`;
          const phaserGame = window.phaserGame;
          const mainScene = phaserGame?.scene?.getScene('MainScene');
          const hasPhaserVoiceAsset = Boolean(mainScene?.cache?.audio?.exists(voiceKey));
          
          console.log(`[Audio] Voice playback request: ${voiceKey}, Phaser cache exists: ${hasPhaserVoiceAsset}`);

          if (mainScene && hasPhaserVoiceAsset) {
            try {
              const voiceSound = mainScene.sound.add(voiceKey, { volume: FEEDBACK_VOICE_VOLUME });
              phaserVoiceRef.current = voiceSound;

              voiceSound.once('complete', () => {
                if (phaserVoiceRef.current === voiceSound) {
                  phaserVoiceRef.current = null;
                }
                voiceSound.destroy();
                clearRetryInteractionHandler();
                window.restoreBGMVolume?.();
              });

              voiceSound.once('destroy', () => {
                if (phaserVoiceRef.current === voiceSound) {
                  phaserVoiceRef.current = null;
                }
              });

              const played = voiceSound.play();
              if (played) {
                console.log(`[Audio] Phaser voice playback started: ${voiceKey}`);
                return;
              }

              voiceSound.destroy();
              phaserVoiceRef.current = null;
              console.warn(`[Audio] Phaser voice failed to start, falling back to HTMLAudio: ${voiceKey}`);
            } catch (phaserError) {
              console.warn(`[Audio] Phaser voice threw error, falling back to HTMLAudio: ${voiceKey}`, phaserError);
            }
          } else {
            console.warn(`[Audio] Phaser voice cache missing, falling back to HTMLAudio: ${voiceKey}`);
          }

          await playFallbackHtmlAudio();
        } catch (error: unknown) {
          const errorName = getUnknownErrorName(error);
          const errorMessage = getUnknownErrorMessage(error);
          console.error('[Audio] Play execution failed:', {
            name: errorName,
            message: errorMessage,
            word: feedbackWord
          });

          const activeAudio = audioRef.current;
          const shouldRetryOnInteraction =
            (errorName === 'NotAllowedError' || errorName === 'AbortError') &&
            Boolean(activeAudio);

          if (shouldRetryOnInteraction && activeAudio) {
            retryInteractionHandler = () => {
              if (audioRef.current !== activeAudio) {
                clearRetryInteractionHandler();
                return;
              }

              void window.ensureAudioUnlocked?.();
              void activeAudio.play().then(() => {
                console.log('[Audio] HTMLAudio fallback resumed after interaction');
                clearRetryInteractionHandler();
              }).catch((retryError: unknown) => {
                console.error('[Audio] Retry play failed after interaction:', retryError);
                clearRetryInteractionHandler();
                window.restoreBGMVolume?.();
              });
            };

            FEEDBACK_RETRY_EVENTS.forEach((eventName) => {
              if (!retryInteractionHandler) return;
              document.addEventListener(eventName, retryInteractionHandler as EventListener, {
                once: true,
                passive: true
              });
            });
          } else {
            window.restoreBGMVolume?.();
          }
        }
      };

      // Start voice immediately with overlay reveal.
      void playAudio();
      
      // 2. Rhythmic Star Sound Effects
      const soundTimers: number[] = [];
      const phaserGame = window.phaserGame;

      for (let i = 0; i < score; i++) {
        const soundDelayMs = (
          STAR_POP_START_DELAY_SEC +
          i * STAR_POP_STAGGER_SEC +
          STAR_SOUND_SYNC_OFFSET_SEC
        ) * 1000;
        const timer = window.setTimeout(() => {
          if (phaserGame) {
            try {
              const scene = phaserGame.scene.getScene('MainScene');
              if (scene && scene.sound) {
                scene.sound.play('sfx_bump', { volume: FEEDBACK_SFX_VOLUME });
              }
            } catch (e) {
              console.warn('Phaser sound play failed:', e);
            }
          }
        }, soundDelayMs);
        soundTimers.push(timer);
      }

      // 3. Auto Advance Logic (Wait for stars + extra time)
      const starTimelineEndSec =
        STAR_POP_START_DELAY_SEC +
        (Math.max(score, 1) - 1) * STAR_POP_STAGGER_SEC +
        STAR_POP_DURATION_SEC;
      const totalDelay = Math.min(
        (starTimelineEndSec + AUTO_ADVANCE_EXTRA_DELAY_SEC) * 1000,
        AUTO_ADVANCE_MAX_DELAY_MS
      );

      const autoAdvanceTimer = window.setTimeout(() => {
        try {
          if (onNextLevel) {
            onNextLevel();
            return;
          }
          if (onRestart) {
            onRestart();
          }
        } catch (error) {
          console.error('[Completion] Auto advance failed:', error);
          if (onRestart) {
            try {
              onRestart();
            } catch (fallbackError) {
              console.error('[Completion] Auto advance fallback restart failed:', fallbackError);
            }
          }
        }
      }, totalDelay);

      return () => {
        clearRetryInteractionHandler();
        window.clearTimeout(autoAdvanceTimer);
        soundTimers.forEach((timerId) => window.clearTimeout(timerId));
        stopPhaserVoice();
        stopHtmlAudio();
        window.restoreBGMVolume?.();
      };
    }
  }, [isVisible, feedbackWord, score, total, onNextLevel, onRestart]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] pointer-events-none flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden px-3 py-4 sm:px-4"
          style={{ fontFamily: "'FredokaBoot', 'Fredoka', sans-serif" }}
        >
          {/* Card Container */}
          <motion.div 
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 50 }}
            transition={{ type: "spring", bounce: 0.5 }}
            className="relative bg-white/90 backdrop-blur-md w-[min(92vw,600px)] max-h-[88dvh] rounded-[clamp(1.35rem,5vw,3rem)] px-[clamp(1rem,4vw,3rem)] py-[clamp(1rem,3.8vh,3rem)] flex flex-col items-center shadow-[0_10px_0_rgba(0,0,0,0.2)] border-[5px] sm:border-[6px] border-white overflow-hidden"
          >
            {/* Celebration Effects Background */}
            <div className="absolute inset-0 overflow-hidden rounded-[clamp(1rem,4.4vw,2.5rem)] pointer-events-none">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,204,0,0.3)_30deg,transparent_60deg)]"
              />
            </div>

            {/* Title Text */}
            <motion.div
              initial={{ y: -50, opacity: 0, scale: 0.5 }}
              animate={{ 
                y: 0, 
                opacity: 1,
                scale: isPerfect ? [1, 1.2, 1] : 1
              }}
              transition={{ 
                y: { duration: 0.6, ease: "backOut" },
                scale: isPerfect ? { repeat: Infinity, duration: 1.5, ease: "easeInOut" } : { duration: 0.4 }
              }}
              className="relative z-10 mb-[clamp(0.75rem,2.6vh,2rem)]"
            >
              <h1 
                className="text-[clamp(2.2rem,11.5vw,5rem)] leading-[0.92] font-black tracking-[0.04em] text-[#FFD700] drop-shadow-[4px_4px_0_rgba(0,0,0,0.2)]"
                style={{ 
                  WebkitTextStroke: '3px #333',
                  paintOrder: 'stroke fill',
                  textShadow: '4px 4px 0 #333'
                }}
              >
                {feedbackWord}
              </h1>
            </motion.div>

            {/* Stars Container */}
            <div
              className="relative z-10 grid justify-center mb-[clamp(0.75rem,2.8vh,2rem)] max-w-full"
              style={{
                gap: `${starLayoutConfig.starGapPx}px`,
                gridTemplateColumns: `repeat(${starLayoutConfig.starsPerRow}, minmax(0, 1fr))`
              }}
            >
              {Array.from({ length: total }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ 
                    scale: i < score ? [0, 1.5, 1] : 1, 
                    rotate: 0,
                    opacity: 1
                  }}
                  transition={{ 
                    scale: {
                      delay: STAR_POP_START_DELAY_SEC + i * STAR_POP_STAGGER_SEC,
                      duration: STAR_POP_DURATION_SEC,
                      times: [0, 0.7, 1],
                      ease: "backOut"
                    },
                    rotate: {
                      delay: STAR_POP_START_DELAY_SEC + i * STAR_POP_STAGGER_SEC,
                      duration: STAR_POP_DURATION_SEC
                    },
                    opacity: {
                      delay: STAR_POP_START_DELAY_SEC + i * STAR_POP_STAGGER_SEC,
                      duration: 0.3
                    }
                  }}
                >
                  <ImgWithFallback 
                    src={getR2AssetUrl('assets/kenney/Vector/Tiles/star.svg')}
                    style={{ width: `${starLayoutConfig.starSizePx}px`, height: `${starLayoutConfig.starSizePx}px` }}
                    className={`drop-shadow-[0_4px_0_rgba(0,0,0,0.2)] filter ${
                      i < score 
                        ? 'brightness-110 contrast-125' 
                        : 'grayscale opacity-30 blur-[1px]'
                    }`}
                    alt="Star"
                  />
                </motion.div>
              ))}
            </div>

            {/* Score Pill */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                delay:
                  STAR_POP_START_DELAY_SEC +
                  Math.max(score - 1, 0) * STAR_POP_STAGGER_SEC +
                  STAR_POP_DURATION_SEC +
                  0.2,
                duration: 0.5
              }}
              className="relative z-10 bg-[#333] rounded-full px-[clamp(1rem,6vw,2.5rem)] py-[clamp(0.4rem,1.6vh,0.75rem)] shadow-[0_6px_0_rgba(0,0,0,0.2)] border-[3px] sm:border-4 border-white transform hover:scale-105 transition-transform"
            >
              <span className="text-[clamp(1.4rem,8vw,3rem)] leading-none font-black text-white tabular-nums drop-shadow-md tracking-[0.08em]">
                {score} / {total}
              </span>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CompletionOverlay;
