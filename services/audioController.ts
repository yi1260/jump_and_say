import type Phaser from 'phaser';

type AudioContextConstructor = typeof AudioContext;
type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: AudioContextConstructor;
};

type UnlockableSoundManager = Phaser.Sound.BaseSoundManager & {
  context?: AudioContext;
  locked?: boolean;
  unlock?: () => void;
};

const clampVolume = (value: number): number => {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const getAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof AudioContext === 'function') return AudioContext;
  const audioWindow = window as WindowWithWebkitAudioContext;
  if (typeof audioWindow.webkitAudioContext === 'function') return audioWindow.webkitAudioContext;
  return null;
};

const getContextState = (context: AudioContext | null): string => (context ? String(context.state) : 'closed');

let sharedPhaserAudioContext: AudioContext | null = null;
let activePhaserGame: Phaser.Game | null = null;

const getSharedPhaserAudioContext = (): AudioContext | null => {
  if (sharedPhaserAudioContext && getContextState(sharedPhaserAudioContext) !== 'closed') {
    return sharedPhaserAudioContext;
  }

  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return null;

  try {
    sharedPhaserAudioContext = new AudioContextCtor();
  } catch (error) {
    console.warn('[Audio] Failed to create shared Phaser AudioContext.', error);
    sharedPhaserAudioContext = null;
  }

  return sharedPhaserAudioContext;
};

export const getPhaserAudioConfig = (): Phaser.Types.Core.AudioConfig | undefined => {
  const context = getSharedPhaserAudioContext();
  return context ? ({ context } as Phaser.Types.Core.AudioConfig) : undefined;
};

export const primePhaserAudioContext = async (): Promise<boolean> => {
  const context = getSharedPhaserAudioContext();
  if (!context) return false;

  const state = getContextState(context);
  if (state === 'running') return true;

  try {
    await context.resume();
  } catch (error) {
    console.warn('[Audio] Failed to resume shared Phaser AudioContext.', error);
  }

  return getContextState(context) === 'running';
};

export const bindActivePhaserGame = (game: Phaser.Game | null): void => {
  activePhaserGame = game;
};

export const ensurePhaserAudioUnlocked = async (): Promise<boolean> => {
  const game = activePhaserGame;
  if (!game || !game.sound) return false;

  const soundManager = game.sound as UnlockableSoundManager;
  const context = soundManager.context ?? getSharedPhaserAudioContext();

  if (context) {
    const state = getContextState(context);
    if (state === 'suspended' || state === 'interrupted') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('[Audio] Failed to resume Phaser SoundManager context.', error);
      }
    }
  }

  if (soundManager.locked && typeof soundManager.unlock === 'function') {
    try {
      soundManager.unlock();
    } catch (error) {
      console.warn('[Audio] Failed to call Phaser SoundManager unlock().', error);
    }
  }

  const isRunning = context ? getContextState(context) === 'running' : true;
  if (isRunning && soundManager.locked) {
    // Some Safari builds can keep `locked` stale after context resume.
    soundManager.locked = false;
  }

  return isRunning;
};

interface BgmControllerOptions {
  getTargetVolume: () => number;
  isEnabled: () => boolean;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export class BgmController {
  private readonly options: BgmControllerOptions;
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmPrimaryUrl = '';
  private bgmFallbackUrl = '';
  private hasTriedFallback = false;
  private htmlMediaUnlocked = false;
  private volumeOverride: number | null = null;

  private bgmContext: AudioContext | null = null;
  private bgmGainNode: GainNode | null = null;
  private bgmSourceNode: MediaElementAudioSourceNode | null = null;

  private isDisposed = false;

  private readonly onBgmPlay = () => {
    this.options.onPlayStateChange?.(true);
  };

  private readonly onBgmPause = () => {
    this.options.onPlayStateChange?.(false);
  };

  private readonly onBgmEnded = () => {
    this.options.onPlayStateChange?.(false);
  };

  private readonly onBgmError = () => {
    if (!this.bgmAudio || this.hasTriedFallback || !this.bgmFallbackUrl) return;
    this.hasTriedFallback = true;
    this.bgmAudio.src = this.bgmFallbackUrl;
    this.bgmAudio.load();
    void this.playIfEnabled();
  };

  private readonly onVisibilityChange = () => {
    if (!this.bgmAudio) return;

    if (document.hidden) {
      if (!this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
      return;
    }

    this.syncState();
  };

  private readonly onUserInteraction = () => {
    void this.handleUserInteraction();
  };

  constructor(options: BgmControllerOptions) {
    this.options = options;
  }

  private getEffectiveVolume(): number {
    if (!this.options.isEnabled()) return 0;
    if (this.volumeOverride !== null) return clampVolume(this.volumeOverride);
    return clampVolume(this.options.getTargetVolume());
  }

  private applyOutputVolume(): void {
    const audio = this.bgmAudio;
    if (!audio) return;

    const effectiveVolume = this.getEffectiveVolume();

    if (this.bgmGainNode && this.bgmContext) {
      const now = this.bgmContext.currentTime;
      this.bgmGainNode.gain.setValueAtTime(effectiveVolume, now);
      audio.volume = 1;
      return;
    }

    audio.volume = effectiveVolume;
  }

  private async ensureBgmGainNode(): Promise<void> {
    if (!this.bgmAudio) return;
    if (this.bgmGainNode && this.bgmContext && getContextState(this.bgmContext) !== 'closed') return;

    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return;

    try {
      this.bgmContext = new AudioContextCtor();
      this.bgmSourceNode = this.bgmContext.createMediaElementSource(this.bgmAudio);
      this.bgmGainNode = this.bgmContext.createGain();
      this.bgmSourceNode.connect(this.bgmGainNode);
      this.bgmGainNode.connect(this.bgmContext.destination);
      this.applyOutputVolume();
    } catch (error) {
      console.warn('[Audio] Failed to build BGM WebAudio gain graph, fallback to HTMLAudio volume.', error);
      this.bgmContext = null;
      this.bgmGainNode = null;
      this.bgmSourceNode = null;
    }
  }

  private async resumeBgmContextIfNeeded(): Promise<void> {
    if (!this.bgmContext) return;
    const state = getContextState(this.bgmContext);
    if (state !== 'suspended' && state !== 'interrupted') return;

    try {
      await this.bgmContext.resume();
    } catch (error) {
      console.warn('[Audio] Failed to resume BGM AudioContext.', error);
    }
  }

  private async playIfEnabled(): Promise<void> {
    const audio = this.bgmAudio;
    if (!audio || this.isDisposed) return;
    if (!this.options.isEnabled()) return;
    if (!audio.paused) {
      this.applyOutputVolume();
      return;
    }

    try {
      await audio.play();
    } catch {
      // User gesture may be required on mobile browsers.
    }
  }

  private attachDocumentListeners(): void {
    document.addEventListener('click', this.onUserInteraction, true);
    document.addEventListener('touchstart', this.onUserInteraction, true);
    document.addEventListener('keydown', this.onUserInteraction, true);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private detachDocumentListeners(): void {
    document.removeEventListener('click', this.onUserInteraction, true);
    document.removeEventListener('touchstart', this.onUserInteraction, true);
    document.removeEventListener('keydown', this.onUserInteraction, true);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  async init(primaryUrl: string, fallbackUrl: string): Promise<void> {
    if (this.isDisposed) return;

    this.bgmPrimaryUrl = primaryUrl;
    this.bgmFallbackUrl = fallbackUrl;
    this.hasTriedFallback = false;

    const audio = new Audio(primaryUrl);
    this.bgmAudio = audio;
    audio.loop = true;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.setAttribute('playsinline', 'true');
    audio.muted = !this.options.isEnabled();

    audio.addEventListener('play', this.onBgmPlay);
    audio.addEventListener('pause', this.onBgmPause);
    audio.addEventListener('ended', this.onBgmEnded);
    audio.addEventListener('error', this.onBgmError);

    await this.ensureBgmGainNode();
    this.applyOutputVolume();
    this.attachDocumentListeners();

    if (this.options.isEnabled()) {
      await this.playIfEnabled();
    }
  }

  syncState(): void {
    const audio = this.bgmAudio;
    if (!audio || this.isDisposed) return;

    const enabled = this.options.isEnabled();
    audio.muted = !enabled;
    this.applyOutputVolume();

    if (!enabled) {
      if (!audio.paused) {
        audio.pause();
      }
      return;
    }

    void this.playIfEnabled();
  }

  setBgmVolume(volume: number): void {
    this.volumeOverride = clampVolume(volume);
    this.syncState();
  }

  restoreBgmVolume(): void {
    this.volumeOverride = null;
    this.syncState();
  }

  async ensureAudioUnlocked(): Promise<boolean> {
    const audio = this.bgmAudio;
    if (!audio || this.isDisposed) return false;

    await this.resumeBgmContextIfNeeded();

    if (this.htmlMediaUnlocked) {
      const bgmContextReady = !this.bgmContext || getContextState(this.bgmContext) === 'running';
      return bgmContextReady;
    }

    const wasPaused = audio.paused;
    const previousMuted = audio.muted;
    const previousVolume = audio.volume;

    try {
      audio.muted = true;
      audio.volume = 0;
      await audio.play();
      this.htmlMediaUnlocked = true;

      if (wasPaused) {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // Ignore currentTime reset failures on some mobile browsers.
        }
      }
    } catch (error) {
      console.warn('[Audio] HTMLMedia unlock attempt failed:', error);
    } finally {
      if (!this.bgmAudio) {
        return false;
      }

      this.bgmAudio.muted = previousMuted;
      this.bgmAudio.volume = previousVolume;
      this.syncState();
    }

    const bgmContextReady = !this.bgmContext || getContextState(this.bgmContext) === 'running';
    return this.htmlMediaUnlocked && bgmContextReady;
  }

  async handleUserInteraction(): Promise<void> {
    await Promise.allSettled([
      primePhaserAudioContext(),
      ensurePhaserAudioUnlocked(),
      this.ensureAudioUnlocked()
    ]);
    this.syncState();
  }

  destroy(): void {
    this.isDisposed = true;
    this.detachDocumentListeners();

    if (this.bgmAudio) {
      this.bgmAudio.removeEventListener('play', this.onBgmPlay);
      this.bgmAudio.removeEventListener('pause', this.onBgmPause);
      this.bgmAudio.removeEventListener('ended', this.onBgmEnded);
      this.bgmAudio.removeEventListener('error', this.onBgmError);
      this.bgmAudio.pause();
      this.bgmAudio.src = '';
      this.bgmAudio.load();
      this.bgmAudio = null;
    }

    if (this.bgmSourceNode) {
      this.bgmSourceNode.disconnect();
      this.bgmSourceNode = null;
    }

    if (this.bgmGainNode) {
      this.bgmGainNode.disconnect();
      this.bgmGainNode = null;
    }

    if (this.bgmContext && getContextState(this.bgmContext) !== 'closed') {
      void this.bgmContext.close().catch(() => {});
    }
    this.bgmContext = null;
  }

  getAudioElement(): HTMLAudioElement | null {
    return this.bgmAudio;
  }
}
