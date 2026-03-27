import Phaser from 'phaser';
import { Round1PronunciationFlow } from '../modes/round1/Round1PronunciationFlow';
import { Round1PronunciationMode } from '../modes/round1/Round1PronunciationMode';
import { Round2QuizFlow } from '../modes/round2/Round2QuizFlow';
import { Round2QuizMode } from '../modes/round2/Round2QuizMode';
import { Round3BubblePopFlow } from '../modes/round3/Round3BubblePopFlow';
import { Round3BubblePopMode } from '../modes/round3/Round3BubblePopMode';
import type {
  GameplayModeHost,
  GameplayModeId,
  ModeVisualProfile,
  ModeContext,
  ModeSystems,
  ModeTransitionReason,
  ResponsiveLayoutStrategyId,
  RuntimeCallbackBridge
} from '../modes/core/types';
import { ModeRegistry } from '../runtime/ModeRegistry';
import { SceneRuntimeState } from '../runtime/SceneRuntimeState';
import { CardSystem } from '../systems/CardSystem';
import { PronunciationSystem } from '../systems/PronunciationSystem';
import { RewardSystem } from '../systems/RewardSystem';
import { SceneUiSystem } from '../systems/SceneUiSystem';
import { PlayerControlSystem } from '../systems/PlayerControlSystem';
import { ThemeAssetRuntime } from '../runtime/ThemeAssetRuntime';
import { extractThemesFromThemeList } from '../runtime/themeListUtils';
import { pauseBackgroundPreloading, resumeBackgroundPreloading } from '../../gameConfig';
import { getLocalAssetUrl } from '../../src/config/r2Config';
import {
  PronunciationRoundResult,
  PronunciationSummary,
  QuestionData,
  Theme,
  ThemeId,
  ThemeQuestion
} from '../../types';

// --- CONFIGURATION ---

const C_GOLD = 0xFFD700;
const C_AMBER = 0xFFA500;
const C_WHITE = 0xFFFFFF;

interface AnswerCardLayout {
  centerX: number;
  cardWidth: number;
  cardHeight: number;
  iconWidth: number;
  iconHeight: number;
  imageRatio: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

export class MainScene extends Phaser.Scene implements GameplayModeHost {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerTrailEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private jumpBurstEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  public blockDebrisEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blockSmokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blockFlashEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private rewardTrailEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blocks!: Phaser.Physics.Arcade.StaticGroup; 
  private floor!: Phaser.GameObjects.Rectangle;
  
  // 物理常量 
  private readonly GRAVITY_Y = 2500; 
  private JUMP_OVERSHOOT = 50; // 跳跃最高点比方块高出多少 (确保头部穿过方块中心) 

  // 布局状态 
  private floorHeight: number = 0;
  private floorSurfaceY: number = 0; // 地面表面的 Y 坐标 (主角脚底的位置) 
  private blockCenterY: number = 0;  // 方块中心的 Y 坐标 
  private beeCenterY: number = 0;    // 蜜蜂中心的 Y 坐标
  private jumpVelocity: number = 0;  // 计算出的跳跃初速度 
  private bubbleScale: number = 1; 
  
  // 动态计算的尺寸
  private playerHeight: number = 0;  // 主角高度
  private blockHeight: number = 0;   // 木箱高度
  private playerHeadY: number = 0;   // 主角头部Y坐标 (相对于脚底)
  private blockBottomY: number = 0;  // 木箱底部Y坐标 (相对于中心) 
  private gameScale: number = 1;  
  private stableViewportWidth: number = 1280;
  private stableViewportHeight: number = 720;
  
  // Logic State
  private score: number = 0;
  private themeScore: number = 0; // 当前主题获得的分数
  private currentQuestion: QuestionData | null = null;
  private currentThemes: ThemeId[] = [];
  private currentThemeIndex: number = 0;
  private currentTheme: ThemeId = ''; 
  public themeData: Theme | null = null;
  private beeContainer?: Phaser.GameObjects.Container;
  private beeSprite?: Phaser.GameObjects.Sprite;
  private beeWordText?: Phaser.GameObjects.Text;
  
  // Sound effects
  private jumpSound!: Phaser.Sound.BaseSound;
  private successSound!: Phaser.Sound.BaseSound;
    private failureSound!: Phaser.Sound.BaseSound;
    private bumpSound!: Phaser.Sound.BaseSound;
    
    // 单词循环逻辑状态
  private themeWordPool: string[] = [];
  private lastQuestionWord: string = '';
  private wrongAttempts: number = 0; // 当前题目的错误次数
  
  private currentBgIndex: number = 0;
  private questionCounter: number = 0;
  private totalQuestions: number = 0;
  
  private callbackBridge: RuntimeCallbackBridge = {};
  public activeModeId: GameplayModeId = 'QUIZ';
  private responsiveLayoutStrategy: ResponsiveLayoutStrategyId = 'round2-quiz';
  private modeVisualProfile: ModeVisualProfile = { pronunciationFlowEnabled: false };
  private runtimeState: SceneRuntimeState | null = null;
  private modeRegistry: ModeRegistry = new ModeRegistry();
  private modeSystems: ModeSystems | null = null;
  private modeContext: ModeContext | null = null;
  private readonly round1Flow: Round1PronunciationFlow;
  private readonly round2Flow: Round2QuizFlow;
  private readonly round3Flow: Round3BubblePopFlow;
  private readonly playerControlSystem: PlayerControlSystem;
  private readonly themeAssetRuntime: ThemeAssetRuntime;
  private blindBoxRoundPhase: 'IDLE' | 'SELECTING' | 'SHOWING' | 'COUNTDOWN' | 'RECORDING' | 'RESULT' = 'IDLE';
  private blindBoxRemainingQuestions: ThemeQuestion[] = [];
  private currentBlindBoxRoundQuestions: ThemeQuestion[] = [];
  private pronunciationResults: PronunciationRoundResult[] = [];
  private blindBoxRoundToken: number = 0;
  private blindBoxVolumeContainer: Phaser.GameObjects.Container | null = null;
  private blindBoxVolumeFrameImage: Phaser.GameObjects.Image | null = null;
  private blindBoxVolumeFillImage: Phaser.GameObjects.Image | null = null;
  private blindBoxVolumeFillGraphics: Phaser.GameObjects.Graphics | null = null;
  private blindBoxVolumeMaskGraphics: Phaser.GameObjects.Graphics | null = null;
  private blindBoxVolumeFillMask: Phaser.Display.Masks.GeometryMask | null = null;
  private blindBoxVolumePeakLine: Phaser.GameObjects.Rectangle | null = null;
  private blindBoxVolumeHeatGlow: Phaser.GameObjects.Ellipse | null = null;
  private blindBoxVolumeValueText: Phaser.GameObjects.Text | null = null;
  private blindBoxVolumeSparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private blindBoxVolumeInnerRect:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        radius: number;
      }
    | null = null;
  private blindBoxVolumeLevelStage: number = -1;
  private blindBoxVolumeCurrentLevel: number = 0;
  private blindBoxVolumePeakLevel: number = 0;
  private blindBoxVolumePeakHoldUntil: number = 0;
  private blindBoxVolumeLastUpdateAt: number = 0;
  private blindBoxVolumeBurstCooldownUntil: number = 0;
  private blindBoxCurrentVolumePeak: number = 0;
  private blindBoxRevealImage: Phaser.GameObjects.Image | null = null;
  private blindBoxRevealShadow: Phaser.GameObjects.Ellipse | null = null;
  private blindBoxMicHintIcon: Phaser.GameObjects.Image | null = null;
  private blindBoxMicPulseTween: Phaser.Tweens.Tween | null = null;
  private blindBoxRevealImageRatio: number = 1;
  private volumeMonitorStream: MediaStream | null = null;
  private volumeMonitorAudioContext: AudioContext | null = null;
  private volumeMonitorSource: MediaStreamAudioSourceNode | null = null;
  private volumeMonitorAnalyser: AnalyserNode | null = null;
  private volumeMonitorDataArray: Uint8Array | null = null;
  private volumeMonitorFrameId: number | null = null;
  private volumeMonitorLastSampleAt: number = 0;
  private volumeMonitorStartAt: number = 0;
  private volumeMonitorNoiseFloor: number = 0.008;
  private volumeMonitorReferenceLevel: number = 0.032;
  private volumeMonitorDetectedSignal: boolean = false;
  private volumeMonitorSensitivityBoost: number = 1;
  private blindBoxMicHintContainer: Phaser.GameObjects.Container | null = null;
  private blindBoxMicHintText: Phaser.GameObjects.Text | null = null;
  private pronunciationHudMicVisible: boolean = false;
  private pronunciationHudVolumeLevel: number = 0;
  private pronunciationHudCountdownSeconds: number = 0;
  private pronunciationHudMicAnchorX: number = 0.5;
  private pronunciationHudMicAnchorY: number = 0.9;
  
  // Input & Lane State
  private targetLaneIndex: number = 1; 
  private LANE_X_POSITIONS = [320, 640, 960]; 
  private laneCandidateIndex: number = 1;
  private laneCandidateFrames: number = 0;
  private readonly LANE_SWITCH_STABLE_FRAMES = 2;
  // Positional Movement Thresholds
  // Lane 1 (Center) is defined as 0.35 to 0.65 (30% width)
  // Symmetric Thresholds for intuitive control
  private readonly POS_THRESHOLD = 0.15; // Deviation from center (0.5) to trigger move
  private readonly POS_HYSTERESIS = 0.08; // Deviation from center to return
  
  private readonly POS_TO_LEFT = 0.5 - this.POS_THRESHOLD;   // 0.35
  private readonly POS_FROM_LEFT = 0.5 - this.POS_HYSTERESIS; // 0.42
  
  private readonly POS_TO_RIGHT = 0.5 + this.POS_THRESHOLD;  // 0.65
  private readonly POS_FROM_RIGHT = 0.5 + this.POS_HYSTERESIS; // 0.58

  // New state for single-step movement logic
  // private lastMoveDirection: 'left' | 'right' | null = null;
  
  // Interaction Lock
  public isInteractionActive: boolean = false;
  private isGameOver: boolean = false;
  private imagesLoading: boolean = false;
  private imagesLoaded: boolean = false;
  private hasPreloadedNext: boolean = false;
  private loadingPromise: Promise<void> | null = null;
  private currentAnswerRatios: number[] = [];
  private currentAnswerKeys: string[] = [];
  private activeCardLayouts: AnswerCardLayout[] = [];
  private currentThemeUsesPortraitFrames: boolean = true;
  private pronunciationSound: Phaser.Sound.BaseSound | null = null;
  private readonly isIPadDevice: boolean = /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
  private readonly isMobileDevice: boolean = /iPhone|Android|Mobile|iPad|Tablet|HarmonyOS/i.test(navigator.userAgent) || this.isIPadDevice;
  private resizeStabilizeTimers: Phaser.Time.TimerEvent[] = [];

  private readonly CARD_ORIENTATION_THRESHOLD = 1.0;
  private readonly CARD_FRAME_ASPECT_RATIO_LANDSCAPE = 1.2;
  private readonly CARD_FRAME_ASPECT_RATIO_PORTRAIT = 0.78;
  private readonly CARD_SIDE_PADDING_RATIO = 0.04;
  private readonly CARD_GAP_RATIO = 0.018;
  private readonly CARD_IMAGE_INSET_BASE = 4;
  private readonly JUMP_SFX_VOLUME = 0.16;
  private readonly SUCCESS_SFX_VOLUME = 0.2;
  private readonly FAILURE_SFX_VOLUME = 0.14;
  private readonly PRONUNCIATION_VOLUME = 1.0;
  private readonly PLAYER_MAX_LEAN_ANGLE = 14;
  private readonly PLAYER_LEAN_LERP = 0.35;
  private readonly MIN_VALID_VIEWPORT_WIDTH = 64;
  private readonly MIN_VALID_VIEWPORT_HEIGHT = 64;
  private readonly BLIND_BOX_SINGLE_LAYOUT_RATIO = 0.52;
  private readonly BLIND_BOX_OPTION_COUNT = 3;
  private readonly BLIND_BOX_VOLUME_MONITOR_FFT_SIZE = 256;
  private readonly PRONUNCIATION_RECORDING_TIMEOUT_MS = 10000;

  declare add: Phaser.GameObjects.GameObjectFactory;
  declare make: Phaser.GameObjects.GameObjectCreator;
  declare physics: Phaser.Physics.Arcade.ArcadePhysics;
  declare time: Phaser.Time.Clock;
  declare tweens: Phaser.Tweens.TweenManager;
  declare cameras: Phaser.Cameras.Scene2D.CameraManager;
  declare load: Phaser.Loader.LoaderPlugin;

  constructor() {
    super({ key: 'MainScene' });
    this.round1Flow = new Round1PronunciationFlow(this);
    this.round2Flow = new Round2QuizFlow(this);
    this.round3Flow = new Round3BubblePopFlow(this);
    this.playerControlSystem = new PlayerControlSystem(this);
    this.themeAssetRuntime = new ThemeAssetRuntime(this);
  }

  private isCompressedLandscapeViewport(width: number, height: number): boolean {
    const viewportAspect = height / Math.max(width, 1);
    return width > height && viewportAspect < 0.72;
  }

  private isValidViewportSize(width: number, height: number): boolean {
    return (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= this.MIN_VALID_VIEWPORT_WIDTH &&
      height >= this.MIN_VALID_VIEWPORT_HEIGHT
    );
  }

  private getInternalScaleSize(): ViewportSize {
    const gameSize = this.scale.gameSize;
    return {
      width: Math.round(gameSize.width),
      height: Math.round(gameSize.height)
    };
  }

  private resolveViewportSize(width: number, height: number): ViewportSize {
    const normalizedWidth = Math.round(width);
    const normalizedHeight = Math.round(height);
    if (this.isValidViewportSize(normalizedWidth, normalizedHeight)) {
      this.stableViewportWidth = normalizedWidth;
      this.stableViewportHeight = normalizedHeight;
      return { width: normalizedWidth, height: normalizedHeight };
    }

    const registryInternalWidth = this.registry.get('internalWidth');
    const registryInternalHeight = this.registry.get('internalHeight');
    if (
      typeof registryInternalWidth === 'number' &&
      typeof registryInternalHeight === 'number' &&
      this.isValidViewportSize(registryInternalWidth, registryInternalHeight)
    ) {
      this.stableViewportWidth = Math.round(registryInternalWidth);
      this.stableViewportHeight = Math.round(registryInternalHeight);
      return {
        width: this.stableViewportWidth,
        height: this.stableViewportHeight
      };
    }

    const registryCssWidth = this.registry.get('cssWidth');
    const registryCssHeight = this.registry.get('cssHeight');
    const renderDpr = this.getRenderDpr();
    if (
      typeof registryCssWidth === 'number' &&
      typeof registryCssHeight === 'number' &&
      this.isValidViewportSize(registryCssWidth, registryCssHeight)
    ) {
      this.stableViewportWidth = Math.round(registryCssWidth * renderDpr);
      this.stableViewportHeight = Math.round(registryCssHeight * renderDpr);
      return {
        width: this.stableViewportWidth,
        height: this.stableViewportHeight
      };
    }

    const visualViewport = window.visualViewport;
    const fallbackCssWidth = Math.round(
      visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0
    );
    const fallbackCssHeight = Math.round(
      visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0
    );
    if (this.isValidViewportSize(fallbackCssWidth, fallbackCssHeight)) {
      this.stableViewportWidth = Math.round(fallbackCssWidth * renderDpr);
      this.stableViewportHeight = Math.round(fallbackCssHeight * renderDpr);
      return {
        width: this.stableViewportWidth,
        height: this.stableViewportHeight
      };
    }

    return {
      width: this.stableViewportWidth,
      height: this.stableViewportHeight
    };
  }

  private getCurrentViewportSize(): ViewportSize {
    const internalSize = this.getInternalScaleSize();
    return this.resolveViewportSize(internalSize.width, internalSize.height);
  }

  private updateSceneBounds(width: number, height: number): void {
    if (!this.physics?.world) return;
    const physicsBottom = Math.max(1, Math.round(this.floorSurfaceY));
    this.physics.world.setBounds(0, 0, width, physicsBottom);
    this.physics.world.setBoundsCollision(true, true, false, true);
    this.cameras.main.setBounds(0, 0, width, height);
  }

  private getLaneXPosition(index: number): number {
    const laneX = this.LANE_X_POSITIONS[index];
    if (typeof laneX === 'number' && Number.isFinite(laneX)) {
      return laneX;
    }
    return this.stableViewportWidth * 0.5;
  }

  private getLaneSpacing(): number {
    const leftLane = this.getLaneXPosition(0);
    const centerLane = this.getLaneXPosition(1);
    const spacing = Math.abs(centerLane - leftLane);
    if (spacing > 1) {
      return spacing;
    }
    return Math.max(this.stableViewportWidth * 0.3, 1);
  }

  public getBlindBoxLayoutForResize(
    width: number,
    height: number,
    imageRatio: number
  ): { centerX: number; width: number; height: number; imageWidth: number; imageHeight: number } {
    const layout = this.round1Flow.getBlindBoxLayout(width, height, imageRatio);
    return {
      centerX: layout.centerX,
      width: layout.width,
      height: layout.height,
      imageWidth: layout.imageWidth,
      imageHeight: layout.imageHeight
    };
  }

  private recoverPlayerIfCorrupted(): void {
    if (!this.player || !this.player.body) return;
    const laneTargetX = this.getLaneXPosition(this.targetLaneIndex);
    const isCorruptedX = !Number.isFinite(this.player.x) || this.player.x < -this.stableViewportWidth || this.player.x > this.stableViewportWidth * 2;
    const isCorruptedY = !Number.isFinite(this.player.y) || this.player.y < -this.playerHeight * 2 || this.player.y > this.stableViewportHeight * 2;
    const isPinnedToTopLeft = this.player.x <= 2 && this.player.y <= 2;
    if (!isCorruptedX && !isCorruptedY && !isPinnedToTopLeft) {
      return;
    }

    const safeX = laneTargetX;
    const safeY = this.floorSurfaceY;
    this.player.setPosition(safeX, safeY);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.reset(safeX, safeY);
    body.setVelocity(0, 0);
    this.player.setAngle(0);
  }

  private stabilizePlayerOnFloor(): void {
    if (!this.player || !this.player.body) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const clampedX = Phaser.Math.Clamp(
      this.player.x,
      this.getLaneXPosition(0) - this.getLaneSpacing(),
      this.getLaneXPosition(2) + this.getLaneSpacing()
    );

    const hardOutOfBounds =
      !Number.isFinite(this.player.y) ||
      !Number.isFinite(body.bottom) ||
      this.player.y > this.floorSurfaceY + Math.max(this.playerHeight, 36 * this.gameScale) ||
      body.top > this.stableViewportHeight + Math.max(this.playerHeight, 36 * this.gameScale);
    if (hardOutOfBounds) {
      this.player.setPosition(clampedX, this.floorSurfaceY);
      body.reset(clampedX, this.floorSurfaceY);
      body.setVelocity(0, 0);
      this.player.setAngle(0);
    }
  }

  private getBeeTextOffsetY(width: number, height: number): number {
    return this.isCompressedLandscapeViewport(width, height) ? 48 * this.gameScale : 60 * this.gameScale;
  }

  private clearResizeStabilizers(): void {
    this.resizeStabilizeTimers.forEach((timer) => {
      if (timer && !timer.hasDispatched) {
        timer.remove(false);
      }
    });
    this.resizeStabilizeTimers = [];
  }

  private getRuntimeCallbacks(): RuntimeCallbackBridge {
    return this.callbackBridge;
  }

  private initializeModeRuntime(initialModeId: GameplayModeId): void {
    const callbacks = this.getRuntimeCallbacks();
    this.runtimeState = new SceneRuntimeState(initialModeId, callbacks);
    this.modeSystems = {
      ui: new SceneUiSystem(this),
      cards: new CardSystem(this),
      reward: new RewardSystem(this),
      pronunciation: new PronunciationSystem(this)
    };
    this.modeContext = {
      scene: this,
      state: this.runtimeState,
      systems: this.modeSystems,
      callbacks
    };
    this.modeRegistry = new ModeRegistry();
    this.modeRegistry.register('BLIND_BOX_PRONUNCIATION', new Round1PronunciationMode());
    this.modeRegistry.register('QUIZ', new Round2QuizMode());
    this.modeRegistry.register('BUBBLE_POP', new Round3BubblePopMode());
    this.activeModeId = initialModeId;
  }

  private teardownModeRuntime(reason: ModeTransitionReason): void {
    if (this.modeContext) {
      this.modeRegistry.shutdown(this.modeContext, reason);
    }
    if (this.modeSystems) {
      this.modeSystems.pronunciation.destroy();
      this.modeSystems.reward.destroy();
      this.modeSystems.cards.destroy();
      this.modeSystems.ui.destroy();
    }
    this.modeContext = null;
    this.modeSystems = null;
    this.runtimeState = null;
  }

  public switchMode(nextModeId: GameplayModeId, reason: ModeTransitionReason): void {
    if (!this.modeContext) {
      this.activeModeId = nextModeId;
      this.modeVisualProfile = this.getVisualProfileByMode(nextModeId);
      return;
    }
    const safeFallbackMode: GameplayModeId = 'QUIZ';
    const resolvedMode = this.modeRegistry.switchMode(
      this.modeContext,
      nextModeId,
      reason,
      safeFallbackMode
    );
    this.activeModeId = resolvedMode;
  }

  private getLayoutStrategyByMode(modeId: GameplayModeId): ResponsiveLayoutStrategyId {
    if (modeId === 'BLIND_BOX_PRONUNCIATION') {
      return 'round1-pronunciation';
    }
    if (modeId === 'BUBBLE_POP') {
      return 'round3-bubble-pop';
    }
    return 'round2-quiz';
  }

  private getVisualProfileByMode(modeId: GameplayModeId): ModeVisualProfile {
    if (modeId === 'BLIND_BOX_PRONUNCIATION') {
      return { pronunciationFlowEnabled: true };
    }
    return { pronunciationFlowEnabled: false };
  }

  private isPronunciationFlowEnabled(): boolean {
    return this.modeVisualProfile.pronunciationFlowEnabled;
  }

  public setModeVisualProfile(profile: ModeVisualProfile): void {
    this.modeVisualProfile = profile;
  }

  public setModeResponsiveLayoutStrategy(strategyId: ResponsiveLayoutStrategyId): void {
    this.responsiveLayoutStrategy = strategyId;
  }

  public setLegacyGameplayMode(modeId: GameplayModeId): void {
    this.activeModeId = modeId;
    this.responsiveLayoutStrategy = this.getLayoutStrategyByMode(modeId);
    this.modeVisualProfile = this.getVisualProfileByMode(modeId);
  }

  public onModeEnter(modeId: GameplayModeId, reason: ModeTransitionReason): void {
    this.activeModeId = modeId;
    this.configurePlayerPhysicsForMode(modeId);
    this.logModeRuntime('mode-enter', { modeId, reason });
  }

  public onModeExit(modeId: GameplayModeId, reason: ModeTransitionReason): void {
    if (modeId === 'BUBBLE_POP') {
      this.round3Flow.clear();
    }
    this.configurePlayerPhysicsForMode('QUIZ');
    this.logModeRuntime('mode-exit', { modeId, reason });
  }

  public onModeResize(width: number, height: number): void {
    this.applyResponsiveLayout(width, height);
  }

  public handleRound1PlayerHitBlock(player: unknown, block: unknown): void {
    this.round1Flow.hitBlindBox(
      player as Phaser.Types.Physics.Arcade.GameObjectWithBody,
      block as Phaser.Types.Physics.Arcade.GameObjectWithBody
    );
  }

  public handleRound2PlayerHitBlock(player: unknown, block: unknown): void {
    this.round2Flow.handlePlayerHitBlock(
      player as Phaser.Types.Physics.Arcade.GameObjectWithBody,
      block as Phaser.Types.Physics.Arcade.GameObjectWithBody
    );
  }

  public handleRound3PlayerHitBubble(player: unknown, bubble: unknown): void {
    this.round3Flow.handleHit(player, bubble);
  }

  public cleanupBlocksForModeSwitch(): void {
    this.cleanupBlocks();
  }

  public resetPronunciationModeUi(): void {
    this.round1Flow.destroyBlindBoxUiText();
  }

  public logModeRuntime(message: string, extra?: Record<string, unknown>): void {
    if (extra) {
      console.info(`[ModeRuntime] ${message}`, extra);
      return;
    }
    console.info(`[ModeRuntime] ${message}`);
  }

  init(data: {
    theme: ThemeId;
    dpr?: number;
  }) {
    const callbacksRaw = this.registry.get('callbacks');
    if (callbacksRaw && typeof callbacksRaw === 'object') {
      this.callbackBridge = callbacksRaw as RuntimeCallbackBridge;
    } else {
      this.callbackBridge = {};
    }
    this.round1Flow.resetPronunciationHudState();
    const registryMode = this.registry.get('gameplayMode');
    const initialModeId: GameplayModeId =
      registryMode === 'BLIND_BOX_PRONUNCIATION' ? 'BLIND_BOX_PRONUNCIATION' : 
      registryMode === 'BUBBLE_POP' ? 'BUBBLE_POP' : 'QUIZ';
    this.activeModeId = initialModeId;
    this.modeVisualProfile = this.getVisualProfileByMode(initialModeId);
    this.initializeModeRuntime(initialModeId);

    const initialThemes = this.registry.get('initialThemes');
    const initialTheme = this.registry.get('initialTheme'); // Fallback

    if (Array.isArray(initialThemes) && initialThemes.length > 0) {
        this.currentThemes = initialThemes;
    } else if (initialTheme) {
        this.currentThemes = [initialTheme];
    } else {
        this.currentThemes = [];
    }

    this.currentTheme = data.theme || this.currentThemes[0] || '';
    this.currentThemeIndex = this.currentThemes.indexOf(this.currentTheme);
    if (this.currentThemeIndex === -1) this.currentThemeIndex = 0;

    this.score = 0;
    this.themeScore = 0;
    this.targetLaneIndex = 1;
    this.laneCandidateIndex = 1;
    this.laneCandidateFrames = 0;
    // this.lastMoveDirection = null;
    this.isInteractionActive = false;
    this.isGameOver = false;
    this.imagesLoading = false;  // 重置加载状态标志
    this.imagesLoaded = false;
    this.hasPreloadedNext = false;
    this.currentQuestion = null;
    this.themeData = null;
    this.themeWordPool = [];
    this.blindBoxRemainingQuestions = [];
    this.currentBlindBoxRoundQuestions = [];
    this.pronunciationResults = [];
    this.blindBoxRoundPhase = 'IDLE';
    this.blindBoxRoundToken += 1;
    this.questionCounter = 0;
    this.totalQuestions = 0;
    this.currentAnswerRatios = [];
    this.currentAnswerKeys = [];
    this.activeCardLayouts = [];
    this.currentThemeUsesPortraitFrames = true;
    this.pronunciationSound = null;
    this.blindBoxVolumePeakLevel = 0;
    this.blindBoxVolumePeakHoldUntil = 0;
    this.blindBoxVolumeLastUpdateAt = 0;
    this.blindBoxVolumeBurstCooldownUntil = 0;
    this.volumeMonitorLastSampleAt = 0;
    this.volumeMonitorStartAt = 0;
    this.volumeMonitorNoiseFloor = 0.008;
    this.volumeMonitorReferenceLevel = 0.032;
    this.volumeMonitorDetectedSignal = false;
    this.blindBoxVolumeInnerRect = null;
    this.blindBoxVolumeFillImage = null;
    this.round1Flow.destroyBlindBoxUiText();
    this.clearResizeStabilizers();
    // Randomize background for each level/restart
    this.currentBgIndex = Phaser.Math.Between(0, 6);
    this.wrongAttempts = 0;

    this.dpr = data.dpr || 1;
    this.lastQuestionWord = '';
    const viewport = this.getCurrentViewportSize();
    this.gameScale = viewport.height / 1080;
  }

  private initThemeDataFromCache() {
    this.themeAssetRuntime.initThemeDataFromCache();
  }

  private setupThemeData(theme: Theme) {
    this.themeData = theme;
    if (!this.modeContext) return;
    this.modeRegistry.onThemeDataReady(this.modeContext, theme);
  }

  public setupRound1ThemeData(theme: Theme): void {
    this.themeData = theme;
    this.round1Flow.setupThemeData(theme);
  }

  public setupRound2ThemeData(theme: Theme): void {
    this.themeData = theme;
    this.round2Flow.setupThemeData(theme);
  }

  public setupRound3ThemeData(theme: Theme): void {
    this.themeData = theme;
    this.round3Flow.setupThemeData(theme);
  }

  private getScoreHudTarget(): { x: number; y: number } {
    const fallbackTarget = {
      x: 140 * this.gameScale,
      y: 50 * this.gameScale
    };
    const rawTarget = this.registry.get('scoreHudTarget');
    if (!rawTarget || typeof rawTarget !== 'object') {
      return fallbackTarget;
    }

    const target = rawTarget as { x?: unknown; y?: unknown };
    if (
      typeof target.x !== 'number' ||
      !Number.isFinite(target.x) ||
      typeof target.y !== 'number' ||
      !Number.isFinite(target.y)
    ) {
      return fallbackTarget;
    }

    const viewport = this.getCurrentViewportSize();
    const cssWidthRaw = this.registry.get('cssWidth');
    const cssHeightRaw = this.registry.get('cssHeight');
    const cssWidth = typeof cssWidthRaw === 'number' && Number.isFinite(cssWidthRaw) && cssWidthRaw > 0
      ? cssWidthRaw
      : viewport.width / this.getRenderDpr();
    const cssHeight = typeof cssHeightRaw === 'number' && Number.isFinite(cssHeightRaw) && cssHeightRaw > 0
      ? cssHeightRaw
      : viewport.height / this.getRenderDpr();
    const scaleX = viewport.width / Math.max(1, cssWidth);
    const scaleY = viewport.height / Math.max(1, cssHeight);

    return { x: target.x * scaleX, y: target.y * scaleY };
  }

  public getScoreHudTargetPoint(): { x: number; y: number } {
    return this.getScoreHudTarget();
  }

  public applyScoreDelta(delta: number): void {
    this.score += delta;
    this.themeScore += delta;
    if (this.callbackBridge.onScoreUpdate) {
      this.callbackBridge.onScoreUpdate(this.score, this.totalQuestions);
    }
  }

  public getGameScaleValue(): number {
    return this.gameScale;
  }

  public getRewardTrailEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | null {
    return this.rewardTrailEmitter ?? null;
  }

  private dpr: number = 1;

  private getImageTextureKey(questionItem: Theme['questions'][number], themeId: string): string {
    return `theme_${themeId}_${questionItem.image.replace(/\.(png|jpg|jpeg|webp)$/i, '')}`;
  }

  private getAudioCacheKey(questionItem: Theme['questions'][number], themeId: string): string {
    if (!questionItem.audio) return '';
    return `theme_audio_${themeId}_${questionItem.audio.replace(/\.(mp3|wav|ogg|m4a)$/i, '')}`;
  }

  private stopPronunciationSound(restoreBgmVolume = true): void {
    const activeSound = this.pronunciationSound;
    this.pronunciationSound = null;
    if (activeSound) {
      activeSound.removeAllListeners();
      if (activeSound.isPlaying) {
        activeSound.stop();
      }
      activeSound.destroy();
    }
    if (restoreBgmVolume) {
      window.restoreBGMVolume?.();
    }
  }

  private getTextureAspectRatio(textureKey: string): number {
    if (!textureKey || !this.textures.exists(textureKey)) {
      return 1;
    }

    const texture = this.textures.get(textureKey);
    const sourceImage = texture.getSourceImage() as
      | {
          naturalWidth?: number;
          naturalHeight?: number;
          width?: number;
          height?: number;
        }
      | undefined;

    const width = sourceImage?.naturalWidth ?? sourceImage?.width ?? texture.source[0]?.width ?? 0;
    const height = sourceImage?.naturalHeight ?? sourceImage?.height ?? texture.source[0]?.height ?? 0;

    if (width <= 0 || height <= 0) {
      return 1;
    }

    return width / height;
  }

  private getCardHeightByAspect(cardWidth: number, frameAspectRatio: number, sceneHeight: number): number {
    const maxHeightByWidth = cardWidth / frameAspectRatio;
    const maxHeightByViewport = Math.min(sceneHeight * 0.5, 560 * this.gameScale);
    const minHeight = Math.max(150 * this.gameScale, sceneHeight * 0.18);
    return Math.round(Phaser.Math.Clamp(maxHeightByWidth, minHeight, maxHeightByViewport));
  }

  private configurePlayerPhysicsForMode(modeId: GameplayModeId): void {
    if (!this.player?.body) {
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const isBubbleMode = modeId === 'BUBBLE_POP';
    body.setDirectControl(false);
    this.player.setPushable(!isBubbleMode);
    this.player.setImmovable(isBubbleMode);
  }

  private refreshThemeFrameMode(): void {
    if (!this.themeData || !Array.isArray(this.themeData.questions) || this.themeData.questions.length === 0) {
      this.currentThemeUsesPortraitFrames = true;
      return;
    }

    const hasPortraitImage = this.themeData.questions.some((questionItem: Theme['questions'][number]) => {
      const textureKey = this.getImageTextureKey(questionItem, this.currentTheme);
      const ratio = this.getTextureAspectRatio(textureKey);
      return ratio > 0 && ratio < this.CARD_ORIENTATION_THRESHOLD;
    });

    this.currentThemeUsesPortraitFrames = hasPortraitImage;
  }

  private computeAnswerCardLayouts(answerRatios: number[], sceneWidth: number, sceneHeight: number): AnswerCardLayout[] {
    const fallbackRatios = answerRatios.length === 3 ? answerRatios : [1, 1, 1];
    const isRound1Pronunciation = this.responsiveLayoutStrategy === 'round1-pronunciation';
    const frameAspectRatio = this.currentThemeUsesPortraitFrames
      ? this.CARD_FRAME_ASPECT_RATIO_PORTRAIT
      : this.CARD_FRAME_ASPECT_RATIO_LANDSCAPE;

    const sidePaddingRatio = isRound1Pronunciation ? Math.max(0.008, this.CARD_SIDE_PADDING_RATIO * 0.24) : this.CARD_SIDE_PADDING_RATIO;
    const gapRatio = isRound1Pronunciation ? Math.max(0.004, this.CARD_GAP_RATIO * 0.35) : this.CARD_GAP_RATIO;
    const sidePadding = Math.max(sceneWidth * sidePaddingRatio, 16 * this.gameScale);
    const gap = Math.max(sceneWidth * gapRatio, 8 * this.gameScale);
    const availableWidth = Math.max(sceneWidth - sidePadding * 2 - gap * 2, sceneWidth * 0.42);
    const cardWidthByViewport = Math.round(availableWidth / 3);
    const minRound1CardSize = Math.max(142 * this.gameScale, sceneHeight * (this.isMobileDevice ? 0.19 : 0.21));
    const maxRound1CardSize = Math.min(
      cardWidthByViewport,
      Math.min(sceneHeight * (this.isMobileDevice ? 0.48 : 0.58), 700 * this.gameScale)
    );
    const cardWidth = isRound1Pronunciation
      ? Math.round(Phaser.Math.Clamp(cardWidthByViewport, minRound1CardSize, Math.max(minRound1CardSize, maxRound1CardSize)))
      : cardWidthByViewport;
    const imageInset = Math.max(2, Math.round(this.CARD_IMAGE_INSET_BASE * this.gameScale));
    const totalWidth = cardWidth * 3 + gap * 2;
    let cursorX = (sceneWidth - totalWidth) / 2;

    return fallbackRatios.map((ratio: number, index: number) => {
      const rawRatio = Math.max(0.01, answerRatios[index] ?? ratio);
      const cardHeight = isRound1Pronunciation
        ? cardWidth
        : this.getCardHeightByAspect(cardWidth, frameAspectRatio, sceneHeight);
      const centerX = Math.round(cursorX + cardWidth / 2);
      cursorX += cardWidth + gap;

      return {
        centerX,
        cardWidth: Math.round(cardWidth),
        cardHeight,
        iconWidth: Math.max(1, Math.round(cardWidth - imageInset * 2)),
        iconHeight: Math.max(1, Math.round(cardHeight - imageInset * 2)),
        imageRatio: rawRatio
      };
    });
  }

  private constrainCardLayout(layout: AnswerCardLayout, sceneWidth: number, sceneHeight: number): AnswerCardLayout {
    const isRound1Pronunciation = this.responsiveLayoutStrategy === 'round1-pronunciation';
    const sidePaddingRatio = isRound1Pronunciation ? Math.max(0.008, this.CARD_SIDE_PADDING_RATIO * 0.24) : this.CARD_SIDE_PADDING_RATIO;
    const gapRatio = isRound1Pronunciation ? Math.max(0.004, this.CARD_GAP_RATIO * 0.35) : this.CARD_GAP_RATIO;
    const sidePadding = Math.max(sceneWidth * sidePaddingRatio, 16 * this.gameScale);
    const gap = Math.max(sceneWidth * gapRatio, 8 * this.gameScale);
    const availableWidth = Math.max(sceneWidth - sidePadding * 2 - gap * 2, sceneWidth * 0.42);
    const maxCardWidth = Math.round(availableWidth / 3);
    const imageInset = Math.max(2, Math.round(this.CARD_IMAGE_INSET_BASE * this.gameScale));
    if (isRound1Pronunciation) {
      const minRound1CardSize = Math.max(142 * this.gameScale, sceneHeight * (this.isMobileDevice ? 0.19 : 0.21));
      const maxRound1CardSize = Math.min(
        maxCardWidth,
        Math.min(sceneHeight * (this.isMobileDevice ? 0.48 : 0.58), 700 * this.gameScale)
      );
      const rawCardSize = Math.round(Math.max(layout.cardWidth, layout.cardHeight));
      const safeCardSize = Math.max(
        1,
        Math.round(
          Phaser.Math.Clamp(
            rawCardSize,
            minRound1CardSize,
            Math.max(minRound1CardSize, maxRound1CardSize)
          )
        )
      );
      return {
        ...layout,
        cardWidth: safeCardSize,
        cardHeight: safeCardSize,
        iconWidth: Math.max(1, Math.round(safeCardSize - imageInset * 2)),
        iconHeight: Math.max(1, Math.round(safeCardSize - imageInset * 2))
      };
    }
    const frameAspectRatio = this.currentThemeUsesPortraitFrames
      ? this.CARD_FRAME_ASPECT_RATIO_PORTRAIT
      : this.CARD_FRAME_ASPECT_RATIO_LANDSCAPE;
    const maxCardHeight = this.getCardHeightByAspect(maxCardWidth, frameAspectRatio, sceneHeight);

    const safeCardWidth = Math.max(1, Math.min(Math.round(layout.cardWidth), maxCardWidth));
    const safeCardHeight = Math.max(1, Math.min(Math.round(layout.cardHeight), maxCardHeight));

    return {
      ...layout,
      cardWidth: safeCardWidth,
      cardHeight: safeCardHeight,
      iconWidth: Math.max(1, Math.round(safeCardWidth - imageInset * 2)),
      iconHeight: Math.max(1, Math.round(safeCardHeight - imageInset * 2))
    };
  }

  private getMaxCardHeight(layouts: AnswerCardLayout[]): number {
    if (layouts.length === 0) return this.blockHeight;
    return layouts.reduce((maxHeight, layout) => Math.max(maxHeight, layout.cardHeight), 0);
  }

  private getRenderDpr(): number {
    const raw = this.registry.get('renderDpr');
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(1, raw);
    }
    return 1;
  }

  private getScaledPhysicsValue(baseValue: number): number {
    return baseValue * this.getRenderDpr();
  }

  private updateJumpVelocityByCardHeight(cardHeight: number): void {
    this.blockHeight = cardHeight;
    this.blockBottomY = this.blockHeight / 2;
    const distanceToBlock = this.floorSurfaceY - this.blockCenterY;
    const requiredJumpHeight = distanceToBlock + this.blockBottomY + Math.abs(this.playerHeadY) + this.JUMP_OVERSHOOT;
    this.jumpVelocity = Math.sqrt(2 * this.getScaledPhysicsValue(this.GRAVITY_Y) * requiredJumpHeight);
  }

  private destroyBlockVisual(visuals: Phaser.GameObjects.Container | undefined): void {
    if (!visuals || !visuals.active) return;
    this.tweens.killTweensOf(visuals);
    visuals.destroy();
  }

  private forceDestroyAllBlockVisuals(): void {
    const blocks = this.blocks;
    const blockChildren = blocks?.children;
    if (!blocks || !blockChildren || typeof blockChildren.iterate !== 'function') return;
    blockChildren.iterate((b: any) => {
      if (!b) return true;
      const visuals = b.getData('visuals') as Phaser.GameObjects.Container | undefined;
      this.destroyBlockVisual(visuals);
      b.setData('visuals', undefined);
      b.setData('isCleaningUp', false);
      return true;
    });
  }

  private applyBlockVisualLayout(
    block: Phaser.Physics.Arcade.Sprite,
    visuals: Phaser.GameObjects.Container | undefined,
    layout: AnswerCardLayout
  ): void {
    if (block.getData('isCleaningUp')) return;

    const constrainedLayout = this.constrainCardLayout(layout, this.cameras.main.width, this.cameras.main.height);
    const snappedX = Math.round(constrainedLayout.centerX);
    const snappedY = Math.round(this.blockCenterY);
    const snappedCardWidth = Math.round(constrainedLayout.cardWidth);
    const snappedCardHeight = Math.round(constrainedLayout.cardHeight);
    const snappedIconWidth = Math.round(constrainedLayout.iconWidth);
    const snappedIconHeight = Math.round(constrainedLayout.iconHeight);

    block.x = snappedX;
    block.y = snappedY;
    block.setDisplaySize(snappedCardWidth, snappedCardHeight);
    block.refreshBody();

    if (!visuals) return;
    // Resize/fullscreen transitions can leave legacy float tweens with stale Y bounds.
    // Clear them before re-positioning so cards snap to the latest layout immediately.
    // Also force visual state to a stable final value in case entrance tween is interrupted.
    this.tweens.killTweensOf(visuals);
    visuals.setVisible(true);
    visuals.setAlpha(1);
    visuals.setScale(1, 1);
    visuals.x = snappedX;
    visuals.y = snappedY;

    const borderThickness = Math.max(4, Math.round(6 * this.gameScale));
    const innerBorderThickness = Math.max(2, Math.round(3 * this.gameScale));
    const shadowOffsetY = Math.max(4, 8 * this.gameScale);
    const frameShadow = block.getData('answerFrameShadow') as Phaser.GameObjects.Rectangle | undefined;
    const frame = block.getData('answerFrame') as Phaser.GameObjects.Rectangle | undefined;
    const innerFrame = block.getData('answerInnerFrame') as Phaser.GameObjects.Rectangle | undefined;
    const icon = block.getData('answerIcon') as Phaser.GameObjects.Image | undefined;

    if (frameShadow) {
      frameShadow.y = shadowOffsetY;
      frameShadow.setSize(
        snappedCardWidth + borderThickness * 1.4,
        snappedCardHeight + borderThickness * 1.6
      );
    }
    if (frame) {
      frame.setSize(snappedCardWidth, snappedCardHeight);
      frame.setStrokeStyle(borderThickness, 0x2f3442, 1);
    }
    if (innerFrame) {
      innerFrame.setSize(
        Math.max(1, snappedCardWidth - borderThickness * 1.2),
        Math.max(1, snappedCardHeight - borderThickness * 1.2)
      );
      innerFrame.setStrokeStyle(innerBorderThickness, 0xd9e2f2, 0.9);
    }
    if (icon) {
      icon.setDisplaySize(snappedIconWidth, snappedIconHeight);
      icon.setOrigin(0.5, 0.5);
    }
  }

  /** 
   * 核心布局计算 
   * 逻辑：定死地面位置 -> 算出方块高度 -> 算出蜜蜂高度 -> 反推速度 
   */ 
  private recalcLayout(width: number, height: number) { 
    const viewport = this.resolveViewportSize(width, height);
    const safeWidth = viewport.width;
    const safeHeight = viewport.height;

    this.gameScale = safeHeight / 1080;
    this.dpr = this.registry.get('dpr') || this.dpr || 1;
    this.JUMP_OVERSHOOT = 60 * this.gameScale; 

    const isCompressedLandscape = this.isCompressedLandscapeViewport(safeWidth, safeHeight);
    const bottomMarginRatio = isCompressedLandscape ? 0.055 : (this.isMobileDevice ? 0.07 : 0.09);
    const minBottomMargin = this.isMobileDevice ? 18 : 36;
    const maxBottomMargin = this.isMobileDevice ? 140 : 200;
    const bottomMargin = Phaser.Math.Clamp(safeHeight * bottomMarginRatio, minBottomMargin, maxBottomMargin);
    this.floorSurfaceY = safeHeight - bottomMargin; 
    this.floorHeight = bottomMargin;

    this.LANE_X_POSITIONS = [safeWidth * 0.20, safeWidth * 0.5, safeWidth * 0.80]; 

    const visualPlayerSize = 180 * this.gameScale;
    const visualBoxSize = Math.min(380 * this.gameScale, safeHeight * 0.38);
    
    this.playerHeight = visualPlayerSize;
    this.blockHeight = visualBoxSize;
    
    this.playerHeadY = -this.playerHeight;
    this.blockBottomY = this.blockHeight / 2;

    const minTopMargin = 56 * this.gameScale;
    const minBeeBlockGap = (isCompressedLandscape ? 450 : 420) * this.gameScale;
    const beeLiftOffset = (isCompressedLandscape ? 34 : 0) * this.gameScale;

    const jumpRatio = safeHeight < 600 ? 0.35 : 0.43; 
    const idealJumpHeight = Phaser.Math.Clamp(safeHeight * jumpRatio, 220 * this.gameScale, 520 * this.gameScale);
    const playerTopY = this.floorSurfaceY - this.playerHeight;
    const desiredPlayerCardGap = Phaser.Math.Clamp(
      safeHeight * (isCompressedLandscape ? 0.08 : 0.095),
      40 * this.gameScale,
      120 * this.gameScale
    );
    const minBlockCenterByBee = minTopMargin + minBeeBlockGap + beeLiftOffset;
    const maxBlockCenterByPlayerGap = playerTopY - desiredPlayerCardGap - this.blockHeight / 2;
    const blockCenterUpperBound = Math.max(maxBlockCenterByPlayerGap, minBlockCenterByBee);
    const baseBlockCenterY = this.floorSurfaceY - idealJumpHeight;

    this.blockCenterY = Phaser.Math.Clamp(baseBlockCenterY, minBlockCenterByBee, blockCenterUpperBound);
    this.beeCenterY = this.blockCenterY - minBeeBlockGap - beeLiftOffset;

    this.updateJumpVelocityByCardHeight(this.blockHeight);

    // BUBBLE_POP 模式覆盖 - player 尽量靠底部, 跳跃高度 = 屏幕高度的 50%
    if (this.activeModeId === 'BUBBLE_POP') {
      const bubbleBottomMargin = Math.max(6, 10 * this.gameScale);
      this.floorSurfaceY = safeHeight - bubbleBottomMargin;
      this.floorHeight = bubbleBottomMargin;
      const jumpHeight = safeHeight * 0.5;
      this.jumpVelocity = Math.sqrt(2 * this.getScaledPhysicsValue(this.GRAVITY_Y) * jumpHeight);
    }
  }

  preload() {
    console.time('[MainScene] preload');
    // 确保跨域加载图片时带上 Origin 头，否则 WebGL 渲染会因污染报错
    this.load.crossOrigin = 'anonymous';
    
    this.generateInternalTextures();

    // 加载进度日志与配置 (生产环境减少日志)
    const isDev = (import.meta as any).dev || (import.meta as any).MODE !== 'production';
    this.load.on('start', () => {
      if (isDev) console.log('Loading started...');
    });
    this.load.on('filecomplete', (key: string) => {
      if (isDev && key.startsWith('theme_')) {
        console.log('Loaded theme image:', key);
      }
    });
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
        console.warn(`[Loader] Error loading ${file.key} from ${file.url}`);
        
        // R2 CDN -> Same-origin fallback
        if (typeof file.url === 'string' && file.url.includes('cdn.maskmysheet.com') && file.url.includes('/assets/')) {
             const newUrl = getLocalAssetUrl(file.url);
             if (newUrl !== file.url) {
                 console.log(`[Loader] CDN load failed for ${file.key}, attempting local fallback: ${newUrl}`);
                 switch (file.type) {
                     case 'image':
                         this.load.image(file.key, newUrl);
                         break;
                     case 'svg':
                         // Use config if available, otherwise just try load
                         this.load.svg(file.key, newUrl, (file as any).config); 
                         break;
                     case 'audio':
                         this.load.audio(file.key, newUrl);
                         break;
                     default:
                         this.load.image(file.key, newUrl);
                 }

                 this.load.start();
                 return;
             }
        }
    });
  }

  generateInternalTextures() {
    // 1. Particle
    const p = this.make.graphics({x: 0, y: 0});
    p.fillStyle(C_GOLD);
    p.fillCircle(8, 8, 8);
    p.generateTexture('particle_gold', 16, 16);
    p.destroy();
    
    // 2. Star Sparkle (for bubbles)
    const s = this.make.graphics({x: 0, y: 0});
    s.fillStyle(C_WHITE, 1);
    s.fillPoint(4, 4, 2);
    s.lineStyle(1, C_WHITE, 1);
    s.lineBetween(4, 0, 4, 8);
    s.lineBetween(0, 4, 8, 4);
    s.generateTexture('particle_sparkle', 8, 8);
    s.destroy();

    // 3. Player
    const basePlayerSize = 180; // 调大基础尺寸，匹配 visualPlayerSize
    const playerSize = Math.round(basePlayerSize * this.gameScale * this.dpr);
    const bot = this.make.graphics({x: 0, y: 0});
    bot.fillStyle(C_AMBER, 0.3);
    bot.fillCircle(playerSize/2, playerSize/2, playerSize/2);
    bot.fillStyle(C_GOLD, 1);
    bot.fillCircle(playerSize/2, playerSize/2, playerSize/2 * 0.7);
    bot.fillStyle(0x000000, 1);
    bot.fillRoundedRect(playerSize * 0.25, playerSize * 0.3, playerSize * 0.2, playerSize * 0.25, 5); 
    bot.fillRoundedRect(playerSize * 0.55, playerSize * 0.3, playerSize * 0.2, playerSize * 0.25, 5);
    bot.fillStyle(C_WHITE, 1);
    bot.fillCircle(playerSize * 0.31, playerSize * 0.37, 3);
    bot.fillCircle(playerSize * 0.62, playerSize * 0.37, 3);
    bot.generateTexture('player_bot', playerSize, playerSize);
    bot.destroy();

    // 4. Bubble Texture (Optimized)
    const bSize = 512;
    const bubble = this.make.graphics({x: 0, y: 0});
    bubble.fillStyle(C_GOLD, 0.3);
    bubble.fillCircle(bSize/2, bSize/2, bSize/2 - 2);
    bubble.generateTexture('bubble_base', bSize, bSize);
    bubble.destroy();

    // 5. Block Hitbox
    const boxSize = 200;
    const box = this.make.graphics({x: 0, y: 0});
    box.fillStyle(0xFF0000, 1);
    box.fillRect(0, 0, boxSize, boxSize); 
    box.generateTexture('block_hitbox', boxSize, boxSize);
    box.destroy();

    // 6. Block Debris Particle (圆角方块 - 增强立体感)
    const dSize = 24;
    const radius = 6;
    const deb = this.make.graphics({x: 0, y: 0});
    
    // 阴影层 (模拟底部厚度)
    deb.fillStyle(0x5D2E0C, 1.0); 
    deb.fillRoundedRect(2, 2, dSize, dSize, radius);

    // 粒子主体
    deb.fillStyle(0x8B4513, 1.0); 
    deb.fillRoundedRect(0, 0, dSize, dSize, radius);
    
    // 高光层 (顶部边缘，增加立体感)
    deb.fillStyle(0xA0522D, 1.0); 
    deb.fillRoundedRect(0, 0, dSize, dSize * 0.4, radius);
    
    deb.generateTexture('debris_bubble', dSize + 4, dSize + 4);
    deb.destroy();

    // 7. Wood Particle (用于木箱碎裂)
    this.generateWoodParticleTexture();
  }

  private generateWoodParticleTexture() {
    const size = 16;
    const g = this.make.graphics({x: 0, y: 0});
    g.fillStyle(0x8B4513, 1); // 棕色
    g.fillRect(0, 0, size, size);
    g.lineStyle(2, 0x5D2E0C, 1);
    g.strokeRect(0, 0, size, size);
    g.generateTexture('particle_wood', size, size);
    g.destroy();
  }

  private async loadThemeImages(themeId?: string) {
    await this.themeAssetRuntime.loadThemeImages(themeId);
  }

  /**
   * 预加载下一个主题的图片 (后台执行)
   */
  private async preloadNextTheme() {
    await this.themeAssetRuntime.preloadNextTheme();
  }

  create() {
    console.timeEnd('[MainScene] preload');
    
    // PAUSE background preloading when gameplay starts to save CPU/Bandwidth
    pauseBackgroundPreloading();
    try {
      this.switchMode(this.activeModeId, 'scene-init');
    } catch (error) {
      this.logModeRuntime('mode-init-failed', {
        modeId: this.activeModeId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.switchMode('QUIZ', 'fallback');
    }

    this.initThemeDataFromCache();
    
    // 开始异步加载主题图片
    this.loadThemeImages();

    // Force linear filtering for all textures to ensure smoothness
    this.textures.getTextureKeys().forEach(key => {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    });

    // 移动端禁用 FXAA，避免整体画面（尤其文字/图片）出现发糊；桌面端保留。
    if (!this.isMobileDevice && this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
        // @ts-ignore - FXAAPipeline is available in Phaser 3.80+ but might be missing in types
        this.cameras.main.setPostPipeline(Phaser.Renderer.WebGL.Pipelines.FXAAPipeline);
    }

    const viewport = this.getCurrentViewportSize();
    const width = viewport.width;
    const height = viewport.height;
    this.recalcLayout(width, height);
    this.updateSceneBounds(width, height);
    this.cameras.main.roundPixels = this.isMobileDevice;

    // 初始化音效 (增加安全检查，防止加载失败导致后续代码崩溃)
    try {
        this.jumpSound = this.sound.add('sfx_jump', { volume: this.JUMP_SFX_VOLUME });
        this.successSound = this.sound.add('sfx_success', { volume: this.SUCCESS_SFX_VOLUME });
        this.failureSound = this.sound.add('sfx_failure', { volume: this.FAILURE_SFX_VOLUME });
        this.bumpSound = this.sound.add('sfx_bump', { volume: this.FAILURE_SFX_VOLUME });
    } catch (e) {
        console.warn('Audio initialization failed, continuing without sound.');
        // 创建空对象模拟播放器，防止 play() 报错
        const noop = { play: () => {}, stop: () => {} } as any;
        this.jumpSound = this.jumpSound || noop;
        this.successSound = this.successSound || noop;
        this.failureSound = this.failureSound || noop;
        this.bumpSound = this.bumpSound || noop;
    }

    this.blocks = this.physics.add.staticGroup();

    // 4. 物理地面 (不再显示视觉素材) 
    const floorHeight = 80; 
    this.floor = this.add.rectangle(width / 2, this.floorSurfaceY + floorHeight, width, floorHeight, 0x000000, 0); 
    this.floor.setOrigin(0.5, 1.0); 
    this.floor.setVisible(false);
    
    // 5. 物理地面 
    const platforms = this.physics.add.staticGroup(); 
    platforms.add(this.floor); 
    
    // 同步物理位置 
    const body = this.floor.body as Phaser.Physics.Arcade.StaticBody; 
    body.updateFromGameObject(); 

    // Create Animations
    this.anims.create({
        key: 'p1_walk',
        frames: [
            { key: 'p1_walk_a' },
            { key: 'p1_walk_b' }
        ],
        frameRate: 4,
        repeat: -1
    });

    // 玩家配置 (动态)
    this.player = this.physics.add.sprite(this.LANE_X_POSITIONS[1], this.floorSurfaceY, 'p1_stand');
    const visualPlayerSize = 180 * this.gameScale;
    this.player.setDisplaySize(visualPlayerSize, visualPlayerSize);
    this.player.setOrigin(0.5, 1.0);
    this.player.setDepth(20);
    this.player.setCollideWorldBounds(true);
    this.player.setGravityY(this.getScaledPhysicsValue(this.GRAVITY_Y));
    
    const bodyWidth = visualPlayerSize * 0.5;
    const bodyHeight = visualPlayerSize * 0.95;
    this.player.body?.setSize(bodyWidth, bodyHeight);
    this.player.body?.setOffset((visualPlayerSize - bodyWidth) / 2, visualPlayerSize - bodyHeight);
    this.player.setDepth(20);
    this.player.play('p1_walk');
    this.configurePlayerPhysicsForMode(this.activeModeId);

    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.clearResizeStabilizers();
      this.scale.off('resize', this.handleResize, this);
      this.blindBoxRoundToken += 1;
      this.teardownModeRuntime('shutdown');
      this.round3Flow.destroy();
      this.round1Flow.destroyBlindBoxUiText();
      this.stopPronunciationSound(true);
    });
    this.events.once('destroy', () => {
      this.clearResizeStabilizers();
      this.scale.off('resize', this.handleResize, this);
      this.blindBoxRoundToken += 1;
      this.teardownModeRuntime('destroy');
      this.round3Flow.destroy();
      this.round1Flow.destroyBlindBoxUiText();
      this.stopPronunciationSound(true);
    });

    this.physics.add.collider(this.player, platforms);
    this.physics.add.overlap(this.player, this.blocks, this.hitBlock, undefined, this);
    // Bubble pop mode uses manual hit qualification in Round3BubblePopFlow.
    // Keep this as overlap-only so Arcade Physics doesn't separate the player on any broad contact first.
    this.physics.add.overlap(this.player, this.round3Flow.bubbleSystem.bubbleGroup, this.hitBlock, undefined, this);
    this.applyResponsiveLayout(width, height);
    // Force one post-create resize pass. On iPad Edge we may receive a transient
    // viewport during scene create and not get another resize event immediately.
    // Re-running the resize pipeline here guarantees round1 layout uses the final
    // internal coordinate space.
    this.handleResize(this.scale.gameSize);

    // 预创建小蜜蜂飞行动画 (移到 create 中)
    if (!this.anims.exists('bee_fly')) {
        this.anims.create({
            key: 'bee_fly',
            frames: [
                { key: 'bee_a' },
                { key: 'bee_b' }
            ],
            frameRate: 8,
            repeat: -1
        });
    }

    this.playerTrailEmitter = this.add.particles(0, 0, 'particle_gold', {
        speed: { min: 50, max: 150 },
        scale: { start: 0.8, end: 0 },
        alpha: { start: 0.8, end: 0 },
        lifespan: 500,
        tint: [C_GOLD, C_AMBER, 0xFF4500],
        blendMode: 'ADD',
        angle: { min: 85, max: 95 },
        follow: this.player,
        followOffset: { x: 0, y: 0 },
        frequency: 60 
    }).setDepth(25);

    this.jumpBurstEmitter = this.add.particles(0, 0, 'particle_gold', {
        speed: { min: 100, max: 400 },
        angle: { min: 0, max: 180 },
        scale: { start: 0.8, end: 0 },
        lifespan: 500,
        quantity: 20,
        blendMode: 'ADD',
        emitting: false
    });

    // --- Pre-create Pooled Particle Emitters for Optimizations ---
    
    // 1. Block Debris (Optimized: reduced quantity, removed physics bounds)
    this.blockDebrisEmitter = this.add.particles(0, 0, 'debris_bubble', {
        speed: { min: 200, max: 600 }, 
        angle: { min: 0, max: 360 },
        scale: { start: 0.8 * this.gameScale, end: 0.2 * this.gameScale }, 
        alpha: { start: 1, end: 0 }, 
        lifespan: 1000, 
        rotate: { min: -180, max: 180 }, 
        gravityY: 1200, 
        emitting: false
    }).setDepth(30);

    // 2. Block Smoke
    this.blockSmokeEmitter = this.add.particles(0, 0, 'particle_gold', {
        speed: { min: 20, max: 80 },
        scale: { start: 1.5 * this.gameScale, end: 3 * this.gameScale },
        alpha: { start: 0.3, end: 0 },
        lifespan: 800,
        emitting: false
    }).setDepth(31);

    // 3. Block Flash
    this.blockFlashEmitter = this.add.particles(0, 0, 'particle_gold', {
        speed: { min: 100, max: 300 },
        scale: { start: 0.8 * this.gameScale, end: 0 },
        lifespan: 400,
        blendMode: 'ADD',
        emitting: false
    }).setDepth(32);

    // 4. Reward Trail
    this.rewardTrailEmitter = this.add.particles(0, 0, 'particle_gold', {
        speed: 10,
        scale: { start: 0.8, end: 0 },
        alpha: { start: 0.6, end: 0 },
        lifespan: 600,
        blendMode: 'ADD',
        emitting: false
    }).setDepth(90);

    // 移除重复的 delayedCall，统一由 setupThemeData 触发
    // this.time.delayedCall(2000, () => {
    //   this.spawnQuestion();
    // });

    // Sync initial background to React UI
    if (this.callbackBridge.onBackgroundUpdate) {
        this.callbackBridge.onBackgroundUpdate(this.currentBgIndex);
    }
  }

  private applyResponsiveLayout(width: number, height: number): void {
      const viewport = this.resolveViewportSize(width, height);
      const safeWidth = viewport.width;
      const safeHeight = viewport.height;

      this.recalcLayout(safeWidth, safeHeight);
      this.updateSceneBounds(safeWidth, safeHeight);

      this.modeSystems?.cards.applyResponsiveAnswerLayouts(
        this.responsiveLayoutStrategy,
        safeWidth,
        safeHeight
      );
      this.targetLaneIndex = Phaser.Math.Clamp(this.targetLaneIndex, 0, Math.max(0, this.LANE_X_POSITIONS.length - 1));

      // 1. 更新地面位置
      if (this.floor) {
          const floorHeight = 80;
          this.floor.width = safeWidth;
          this.floor.height = floorHeight;
          this.floor.y = this.floorSurfaceY + floorHeight;
          const floorBody = this.floor.body as Phaser.Physics.Arcade.StaticBody;
          floorBody.updateFromGameObject();
      }

      // 2. 更新主角尺寸与安全位置
      if (this.player && this.player.body) {
          const visualPlayerSize = 180 * this.gameScale;
          this.player.setDisplaySize(visualPlayerSize, visualPlayerSize);

          const bodyWidth = visualPlayerSize * 0.5;
          const bodyHeight = visualPlayerSize * 0.95;
          this.player.body.setSize(bodyWidth, bodyHeight);
          this.player.body.setOffset((visualPlayerSize - bodyWidth) / 2, visualPlayerSize - bodyHeight);
          this.player.setGravityY(this.getScaledPhysicsValue(this.GRAVITY_Y));

          const laneTargetX = this.getLaneXPosition(this.targetLaneIndex);
          const shouldSnapToFloor =
            !Number.isFinite(this.player.y) ||
            this.player.y > this.floorSurfaceY + Math.max(2, 8 * this.gameScale) ||
            this.player.y < -visualPlayerSize;
          if (shouldSnapToFloor) {
              const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
              playerBody.reset(this.player.x, this.floorSurfaceY);
              playerBody.setVelocityY(0);
          }

          if (!Number.isFinite(this.player.x) || this.player.x < -safeWidth || this.player.x > safeWidth * 2) {
              this.player.x = laneTargetX;
          }
          this.recoverPlayerIfCorrupted();
      }

      this.modeSystems?.cards.relayoutBlocks(safeWidth, safeHeight);

      this.modeSystems?.ui.syncBeeLayout(safeWidth, safeHeight);

      this.round1Flow.onSceneResize();
      this.round3Flow.handleSceneResize();
  }

  handleResize(_gameSize: Phaser.Structs.Size) {
      // Always resolve from the latest internal game size. Layout coordinates
      // are in world space, and world space follows scale.gameSize.
      const currentInternalSize = this.getInternalScaleSize();
      const currentWidth = currentInternalSize.width;
      const currentHeight = currentInternalSize.height;
      if (!this.modeContext) return;
      this.modeRegistry.onResize(this.modeContext, currentWidth, currentHeight);

      // iPad/Safari 在退出全屏时会先抛出一次过渡尺寸，随后才稳定。
      // 追加两次短延迟重排，读取最新 scale 尺寸，避免偶发布局错位。
      this.clearResizeStabilizers();
      const settleDelays = [80, 220];
      settleDelays.forEach((delayMs) => {
          const timer = this.time.delayedCall(delayMs, () => {
              if (!this.scene.isActive()) return;
              const stableInternalSize = this.getInternalScaleSize();
              const stableWidth = stableInternalSize.width;
              const stableHeight = stableInternalSize.height;
              if (!this.modeContext) return;
              this.modeRegistry.onResize(this.modeContext, stableWidth, stableHeight);
          });
          this.resizeStabilizeTimers.push(timer);
      });
  }
  
  public runLegacyUpdateLoop(_time: number, _delta: number): void {
    void _delta;
    this.playerControlSystem.update();
    if (this.activeModeId === 'BUBBLE_POP') {
      this.round3Flow.update(_time);
    }
  }

  update(time: number, delta: number): void {
    if (!this.modeContext) return;
    this.modeRegistry.update(this.modeContext, time, delta);
  }

  public getPronunciationSummarySnapshot(): PronunciationSummary {
    return this.round1Flow.getPronunciationSummarySnapshot();
  }

  hitBlock(player: unknown, block: unknown): void {
    if (!this.modeContext) return;
    this.modeRegistry.onPlayerHitBlock(this.modeContext, player, block);
  }

  /**
   * 核心架构：三明治分层结算页 (下层 Phaser 交互部分)
   */
  private async showThemeCompletion() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.blindBoxRoundToken += 1;
    this.round1Flow.destroyBlindBoxUiText();
    this.currentAnswerRatios = [];
    this.currentAnswerKeys = [];
    this.activeCardLayouts = [];
    const viewport = this.getCurrentViewportSize();
    this.recalcLayout(viewport.width, viewport.height);
    this.updateSceneBounds(viewport.width, viewport.height);

    // RESUME background preloading during the completion screen
    // This gives us ~8 seconds to load the next theme while user watches animations
    resumeBackgroundPreloading();

    // 1. 停止所有方块的生成逻辑
    this.isInteractionActive = false;
    this.blocks.clear(true, true);
    this.round3Flow.clear();
    
    // 2. 触发 React 层 UI 开启 (三明治上层)
    if (this.modeContext) {
      this.modeRegistry.onThemeComplete(this.modeContext);
    }
    if (this.callbackBridge.onGameOver) this.callbackBridge.onGameOver();
  }

  public restartLevel() {
    this.transitionToTheme(this.currentTheme);
  }

  public hasNextTheme(): boolean {
    if (this.currentThemes.length > 0) {
      return this.currentThemeIndex < this.currentThemes.length - 1;
    }

    const themeList = this.cache.json.get('themes_list');
    const themes = extractThemesFromThemeList(themeList);
    const currentIndex = themes.findIndex((t: Theme) => t.id === this.currentTheme);
    return currentIndex >= 0 && currentIndex < themes.length - 1;
  }

  public nextLevel(): boolean {
    if (!this.hasNextTheme()) {
      return false;
    }

    let nextTheme = this.currentTheme;
    if (this.currentThemes.length > 0) {
      const nextIndex = this.currentThemeIndex + 1;
      nextTheme = this.currentThemes[nextIndex];
    } else {
      const themeList = this.cache.json.get('themes_list');
      const themes = extractThemesFromThemeList(themeList);
      const currentIndex = themes.findIndex((t: Theme) => t.id === this.currentTheme);
      const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
      nextTheme = themes[nextIndex]?.id || this.currentTheme;
    }
    this.transitionToTheme(nextTheme);
    return true;
  }

  private transitionToTheme(theme: ThemeId): void {
    let started = false;

    const startPreloadScene = (): void => {
      if (started) return;
      started = true;
      try {
        this.scene.start('PreloadScene', { theme });
      } catch (error) {
        console.error('[Scene] Failed to start PreloadScene during completion transition:', error);
      }
    };

    const fallbackTimer = window.setTimeout(() => {
      console.warn('[Scene] Fade-out completion event timeout, forcing scene transition.');
      startPreloadScene();
    }, 900);

    try {
      this.cameras.main.once('camerafadeoutcomplete', () => {
        window.clearTimeout(fallbackTimer);
        startPreloadScene();
      });
      this.cameras.main.fadeOut(500, 0, 0, 0);
    } catch (error) {
      window.clearTimeout(fallbackTimer);
      console.warn('[Scene] Camera fade transition failed, forcing immediate transition:', error);
      startPreloadScene();
    }
  }

  /**
   * 初始化或更新小蜜蜂及其抓着的文字
   */
  public updateBeeWord(text: string) {
    const uiSystem = this.modeSystems?.ui as SceneUiSystem | undefined;
    uiSystem?.updateBeeWord(text);
  }

  cleanupBlocks() {
    const uiSystem = this.modeSystems?.ui as SceneUiSystem | undefined;
    uiSystem?.cleanupBlocks();
  }
}
