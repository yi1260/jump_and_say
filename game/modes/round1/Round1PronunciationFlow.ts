import Phaser from 'phaser';
import { scorePronunciation, speechScoringService, type RecognizeOnceResult } from '../../../services/speechScoring';
import {
  assessPronunciationAttempt,
  shouldRetryRecognitionAttempt
} from '../../../services/pronunciationAssessment';
import type {
  PronunciationConfidenceLevel,
  PronunciationRoundResult,
  PronunciationSummary,
  Theme,
  ThemeQuestion
} from '../../../types';
import type { RuntimeCallbackBridge } from '../core/types';

const FONT_STACK = '"FredokaBoot", "FredokaLatin", "Fredoka", "ZCOOL KuaiLe UI", "ZCOOL KuaiLe", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif';
const VOLUME_FULL_THRESHOLD = 0.95;
const VOLUME_FULL_BURST_COOLDOWN_MS = 800;
const VOLUME_SILENCE_CUTOFF = 0.08;
const VOLUME_RISE_ENTRY_THRESHOLD = 0.22;
const VOLUME_STARTUP_CALIBRATION_MS = 420;
const VOLUME_BASE_SENSITIVITY_BOOST = 1.05;
const VOLUME_GLOW_THRESHOLD = 0.72;
const VOLUME_GLOW_IGNITION_COOLDOWN_MS = 360;
const VOLUME_PEAK_HOLD_MS = 800;
const VOLUME_PEAK_DECAY_PER_SECOND = 0.066;
const VOLUME_BURST_VISIBLE_THRESHOLD = 0.96;
const VOLUME_MAX_HOLD_TRIGGER = 0.965;
const VOLUME_MAX_HOLD_MS = 1500;
const VOLUME_MAX_DECAY_PER_SECOND = 0.021;
const VOLUME_SUPER_BURST_THRESHOLD = 0.92;
const VOLUME_SUPER_BURST_COOLDOWN_MS = 1500;
const VOLUME_JUICE_SHAKE_THRESHOLD = 0.85;
const VOLUME_JUICE_FLASH_THRESHOLD = 0.9;
const VOLUME_JUICE_SHAKE_COOLDOWN_MS = 90;
const MIC_COUNTDOWN_RING_START_ANGLE = -Math.PI / 2;
const MIC_COUNTDOWN_RING_ARC_OVERSHOOT = 0.02;
const MIC_COUNTDOWN_RING_COLOR = 0xd7efb2;
const MIC_COUNTDOWN_RING_TRACK_ALPHA = 0.2;
const MIC_COUNTDOWN_RING_PROGRESS_GLOW_ALPHA = 0.3;
const MIC_COUNTDOWN_RING_PROGRESS_ALPHA = 1;
const MIC_COUNTDOWN_RING_PROGRESS_CAP_ALPHA = 1;
const MIC_COUNTDOWN_RING_PROGRESS_MIN_VISIBLE_RATIO = 0.005;
const MIC_COUNTDOWN_RING_STROKE_RATIO = 0.085;
const MIC_HINT_ICON_BASE_SIZE = 80;
const MIC_HINT_LABEL_BASE_SIZE = 38;
const MIC_HINT_LABEL_FONT_SCALE = 0.6;
const MIC_HINT_LABEL_COLOR = '#5b6472';
const MIC_HINT_LABEL_FONT_STYLE = '300';
const MIC_HINT_TEXT_GAP_BASE_SIZE = 6;
const MIC_HINT_IMAGE_GAP_BASE_SIZE = 3;
const MIC_HINT_BOTTOM_MARGIN_BASE_SIZE = 7;
const MIC_HINT_ICON_ART_VISIBLE_RATIO = 0.8;
const MIC_HINT_ICON_RING_PADDING_RATIO = 0.05;
const ROUND1_FEEDBACK_BADGE_MIN_DISPLAY_WIDTH = 216;
const ROUND1_FEEDBACK_BADGE_MAX_DISPLAY_WIDTH = 540;
const ROUND1_FEEDBACK_BADGE_VIEWPORT_WIDTH_RATIO = 0.66;
const ROUND1_FEEDBACK_BADGE_VIEWPORT_HEIGHT_RATIO = 0.48;
const ROUND1_TRY_AGAIN_SKIP_LIMIT = 3;
const RECORDING_START_SFX_KEY = 'sfx_record_start';
const RECORDING_START_SFX_VOLUME = 0.45;

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

interface BlindBoxLayout {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

interface BlindBoxRevealLayout {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

type PronunciationHudStage = 'HIDDEN' | 'LISTENING' | 'RECORDING';

interface BlindBoxCollisionPlayer {
  x: number;
  y: number;
  displayHeight: number;
  body: Phaser.Physics.Arcade.Body;
  setAngle(value: number): void;
}

interface BlindBoxCollisionBlock {
  active: boolean;
  x: number;
  y: number;
  displayWidth: number;
  body: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;
  getData(key: string): unknown;
  setData(key: string, value: unknown): void;
}

interface Round1SceneInternal {
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
  time: Phaser.Time.Clock;
  input: Phaser.Input.InputPlugin;
  scene: Phaser.Scenes.ScenePlugin;
  registry: Phaser.Data.DataManager;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  playerTrailEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  jumpBurstEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  blocks: Phaser.Physics.Arcade.StaticGroup;
  textures: Phaser.Textures.TextureManager;
  callbackBridge: RuntimeCallbackBridge;
  bumpSound: Phaser.Sound.BaseSound;
  isInteractionActive: boolean;
  blindBoxRoundPhase: 'IDLE' | 'SELECTING' | 'SHOWING' | 'COUNTDOWN' | 'RECORDING' | 'RESULT';
  volumeMonitorSensitivityBoost: number;
  imagesLoaded: boolean;
  hasPreloadedNext: boolean;
  blindBoxRemainingQuestions: ThemeQuestion[];
  currentBlindBoxRoundQuestions: ThemeQuestion[];
  currentQuestion: unknown;
  currentTheme: string;
  currentAnswerKeys: string[];
  currentAnswerRatios: number[];
  activeCardLayouts: AnswerCardLayout[];
  beeWordText?: Phaser.GameObjects.Text;
  blindBoxMicPulseTween: Phaser.Tweens.Tween | null;
  blindBoxMicHintContainer: Phaser.GameObjects.Container | null;
  blindBoxMicHintIcon: Phaser.GameObjects.Image | null;
  blindBoxMicHintText: Phaser.GameObjects.Text | null;
  blindBoxRevealShadow: Phaser.GameObjects.Ellipse | null;
  blindBoxVolumeContainer: Phaser.GameObjects.Container | null;
  blindBoxVolumeFrameImage: Phaser.GameObjects.Image | null;
  blindBoxVolumeFillImage: Phaser.GameObjects.Image | null;
  blindBoxVolumeFillGraphics: Phaser.GameObjects.Graphics | null;
  blindBoxVolumeMaskGraphics: Phaser.GameObjects.Graphics | null;
  blindBoxVolumeFillMask: Phaser.Display.Masks.GeometryMask | null;
  blindBoxVolumePeakLine: Phaser.GameObjects.Rectangle | null;
  blindBoxVolumeHeatGlow: Phaser.GameObjects.Ellipse | null;
  blindBoxVolumeValueText: Phaser.GameObjects.Text | null;
  blindBoxVolumeSparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null;
  blindBoxVolumeInnerRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
  } | null;
  blindBoxVolumeLevelStage: number;
  blindBoxVolumeCurrentLevel: number;
  blindBoxVolumePeakLevel: number;
  blindBoxVolumePeakHoldUntil: number;
  blindBoxVolumeLastUpdateAt: number;
  blindBoxVolumeBurstCooldownUntil: number;
  volumeMonitorStream: MediaStream | null;
  volumeMonitorAudioContext: AudioContext | null;
  volumeMonitorSource: MediaStreamAudioSourceNode | null;
  volumeMonitorHighPass: BiquadFilterNode | null;
  volumeMonitorLowPass: BiquadFilterNode | null;
  volumeMonitorPeakingEq: BiquadFilterNode | null;
  volumeMonitorAnalyser: AnalyserNode | null;
  volumeMonitorDataArray: Uint8Array | null;
  volumeMonitorFrameId: number | null;
  volumeMonitorLastSampleAt: number;
  volumeMonitorStartAt: number;
  volumeMonitorNoiseFloor: number;
  volumeMonitorReferenceLevel: number;
  volumeMonitorDetectedSignal: boolean;
  pronunciationHudMicVisible: boolean;
  pronunciationHudStage: PronunciationHudStage;
  pronunciationHudVolumeLevel: number;
  pronunciationHudCountdownSeconds: number;
  pronunciationHudMicAnchorX: number;
  pronunciationHudMicAnchorY: number;
  LANE_X_POSITIONS: number[];
  targetLaneIndex: number;
  player: Phaser.Physics.Arcade.Sprite;
  floorSurfaceY: number;
  beeContainer?: Phaser.GameObjects.Container;
  isMobileDevice: boolean;
  blockCenterY: number;
  gameScale: number;
  blindBoxRevealImageRatio: number;
  blindBoxRevealImage: Phaser.GameObjects.Image | null;
  blockFlashEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  blockDebrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  blindBoxCurrentVolumePeak: number;
  PRONUNCIATION_RECORDING_TIMEOUT_MS: number;
  pronunciationResults: PronunciationRoundResult[];
  totalQuestions: number;
  score: number;
  themeScore: number;
  blindBoxRoundToken: number;
  BLIND_BOX_OPTION_COUNT: number;
  BLIND_BOX_SINGLE_LAYOUT_RATIO: number;
  BLIND_BOX_VOLUME_MONITOR_FFT_SIZE: number;
  PRONUNCIATION_VOLUME: number;
  cache: Phaser.Cache.CacheManager;
  sound: Phaser.Sound.BaseSoundManager;
  pronunciationSound: Phaser.Sound.BaseSound | null;
  isPronunciationFlowEnabled(): boolean;
  loadThemeImages(): Promise<void>;
  preloadNextTheme(): Promise<void>;
  showThemeCompletion(): Promise<void>;
  forceDestroyAllBlockVisuals(): void;
  getCurrentViewportSize(): ViewportSize;
  recalcLayout(width: number, height: number): void;
  updateSceneBounds(width: number, height: number): void;
  getImageTextureKey(questionItem: ThemeQuestion, themeId: string): string;
  getTextureAspectRatio(textureKey: string): number;
  computeAnswerCardLayouts(answerRatios: number[], safeWidth: number, safeHeight: number): AnswerCardLayout[];
  getMaxCardHeight(layouts: AnswerCardLayout[]): number;
  updateJumpVelocityByCardHeight(cardHeight: number): void;
  getLaneXPosition(index: number): number;
  getScaledPhysicsValue(baseValue: number): number;
  destroyBlockVisual(visual?: Phaser.GameObjects.Container): void;
  updateBeeWord(text: string): void;
  getAudioCacheKey(questionItem: ThemeQuestion, themeId: string): string;
  stopPronunciationSound(restoreBgmVolume?: boolean): void;
  getScoreHudTargetPoint(): { x: number; y: number };
  getRewardTrailEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | null;
  cleanupBlocks(): void;
}

export class Round1PronunciationFlow {
  private readonly sceneRef: unknown;
  private volumeGlowBurstCooldownUntil: number = 0;
  private micCountdownTrackGraphics: Phaser.GameObjects.Graphics | null = null;
  private micCountdownProgressGraphics: Phaser.GameObjects.Graphics | null = null;
  private micCountdownTween: Phaser.Tweens.Tween | null = null;
  private micCountdownTweenState: { progress: number } = { progress: 0 };
  private micCountdownDurationMs: number = 0;
  private micCountdownStartAtMs: number = 0;
  private micCountdownCompleteCallback: (() => void) | null = null;
  private micCountdownRingRadius: number = 0;
  private micCountdownRingStrokeWidth: number = 0;
  private blindBoxVolumeBloomFx: Phaser.FX.Bloom | null = null;
  private blindBoxVolumeDisplayLevel: number = 0;
  private blindBoxVolumeDisplayPercent: number = -1;
  private blindBoxVolumeBaseX: number = 0;
  private blindBoxVolumeBaseY: number = 0;
  private blindBoxVolumeShakeOffsetX: number = 0;
  private blindBoxVolumeShakeOffsetY: number = 0;
  private volumeMeterShakeCooldownUntil: number = 0;
  private volumeBarMaxHoldUntil: number = 0;
  private superBurstCooldownUntil: number = 0;

  constructor(scene: unknown) {
    this.sceneRef = scene;
  }

  private get scene(): Round1SceneInternal {
    return this.sceneRef as Round1SceneInternal;
  }

  public setupThemeData(theme: Theme): void {
    const scene = this.scene;
    scene.blindBoxRemainingQuestions = [...theme.questions];
    Phaser.Utils.Array.Shuffle(scene.blindBoxRemainingQuestions);
    scene.currentBlindBoxRoundQuestions = [];
    scene.pronunciationResults = [];
    scene.totalQuestions = scene.blindBoxRemainingQuestions.length;
    scene.score = 0;
    if (scene.callbackBridge.onScoreUpdate) {
      scene.callbackBridge.onScoreUpdate(scene.score, scene.totalQuestions);
    }
    if (scene.callbackBridge.onPronunciationProgressUpdate) {
      scene.callbackBridge.onPronunciationProgressUpdate(0, scene.totalQuestions, 0);
    }
    scene.time.delayedCall(100, () => {
      void this.spawnBlindBoxRound();
    });
  }

  public getPronunciationSummarySnapshot(): PronunciationSummary {
    const scene = this.scene;
    const highConfidenceCount = scene.pronunciationResults.filter((item) => item.confidenceLevel === 'HIGH').length;
    const mediumConfidenceCount = scene.pronunciationResults.filter((item) => item.confidenceLevel === 'MEDIUM').length;
    const lowConfidenceCount = scene.pronunciationResults.filter((item) => item.confidenceLevel === 'LOW').length;
    const averageConfidence = this.getPronunciationAverageConfidence();
    return {
      averageConfidence,
      highConfidenceCount,
      mediumConfidenceCount,
      lowConfidenceCount,
      completed: scene.pronunciationResults.length,
      total: scene.totalQuestions
    };
  }

  public clearTransientUi(): void {
    const rewardTrailEmitter = this.scene.getRewardTrailEmitter();
    if (rewardTrailEmitter) {
      rewardTrailEmitter.stop();
      rewardTrailEmitter.stopFollow();
    }
  }

  public onSceneResize(): void {
    this.updateBlindBoxRevealVisualLayout();

    // 监听 Resize，销毁并重新创建音量条以适配最新比例
    const scene = this.scene;
    if (scene.blindBoxVolumeContainer) {
      const wasVisible = scene.blindBoxVolumeContainer.visible;
      this.destroyBlindBoxVolumeMeter();
      this.ensureBlindBoxVolumeMeter();
      if (scene.blindBoxVolumeContainer) {
        scene.blindBoxVolumeContainer.setVisible(wasVisible);
      }
    }

    this.updateBlindBoxVolumeMeterPosition();
  }

  public resetPronunciationHudState(): void {
    const scene = this.scene;
    this.stopMicCountdown();
    scene.pronunciationHudMicVisible = false;
    scene.pronunciationHudStage = 'HIDDEN';
    scene.pronunciationHudVolumeLevel = 0;
    scene.pronunciationHudCountdownSeconds = 0;
    scene.pronunciationHudMicAnchorX = 0.5;
    scene.pronunciationHudMicAnchorY = 0.9;
    this.emitPronunciationHudState();
  }

  public destroyBlindBoxUiText(): void {
    const scene = this.scene;
    this.stopVolumeMonitor();
    scene.volumeMonitorSensitivityBoost = VOLUME_BASE_SENSITIVITY_BOOST;
    this.destroyBlindBoxVolumeMeter();
    this.setBlindBoxMicHintVisible(false);
    this.destroyBlindBoxRevealVisuals();
    this.setBlindBoxPlayerVisible(true);
    this.clearTransientUi();
  }

  public getBlindBoxLayout(width: number, height: number, imageRatio: number): BlindBoxLayout {
    const scene = this.scene;
    const safeImageRatio = Phaser.Math.Clamp(imageRatio || 1, 0.65, 1.45);
    const sidePadding = Math.max(width * 0.008, 16 * scene.gameScale);
    const gap = Math.max(width * 0.004, 8 * scene.gameScale);
    const maxWidthByTripleLayout = Math.max((width - sidePadding * 2 - gap * 2) / 3, 1);
    let cardSize = Phaser.Math.Clamp(
      maxWidthByTripleLayout,
      142 * scene.gameScale,
      780 * scene.gameScale
    );
    const maxCardSizeByHeight = Math.min(height * (scene.isMobileDevice ? 0.48 : 0.58), 700 * scene.gameScale);
    cardSize = Math.min(cardSize, maxCardSizeByHeight);
    const borderInset = Math.max(10 * scene.gameScale, cardSize * 0.055);
    const innerSquareSize = Math.max(48 * scene.gameScale, cardSize - borderInset * 2);
    const imageWidth = safeImageRatio >= 1
      ? innerSquareSize
      : Math.max(48 * scene.gameScale, innerSquareSize * safeImageRatio);
    const imageHeight = safeImageRatio >= 1
      ? Math.max(48 * scene.gameScale, innerSquareSize / safeImageRatio)
      : innerSquareSize;
    return {
      centerX: width * 0.5,
      centerY: scene.blockCenterY,
      width: cardSize,
      height: cardSize,
      imageWidth,
      imageHeight
    };
  }

  public getBlindBoxRevealLayout(width: number, height: number, imageRatio: number): BlindBoxRevealLayout {
    const scene = this.scene;
    const safeRatio = Phaser.Math.Clamp(imageRatio || 1, 0.5, 1.8);
    const maxWidth = Math.max(320 * scene.gameScale, width * (scene.isMobileDevice ? 0.94 : 0.9));
    const topSafeInset = Phaser.Math.Clamp(
      height * (scene.isMobileDevice ? 0.16 : 0.14),
      64 * scene.gameScale,
      176 * scene.gameScale
    );
    const defaultBottomSafeInset = Phaser.Math.Clamp(
      height * (scene.isMobileDevice ? 0.16 : 0.13),
      56 * scene.gameScale,
      186 * scene.gameScale
    );
    const bottomSafeInset = Math.max(defaultBottomSafeInset, this.getMicHintBottomSafetySpacePx());
    const availableHeight = Math.max(220 * scene.gameScale, height - topSafeInset - bottomSafeInset);
    const maxHeight = Math.min(
      Math.max(240 * scene.gameScale, height * (scene.isMobileDevice ? 0.8 : 0.78)),
      availableHeight
    );
    let revealWidth = maxWidth;
    let revealHeight = revealWidth / safeRatio;
    if (revealHeight > maxHeight) {
      revealHeight = maxHeight;
      revealWidth = revealHeight * safeRatio;
    }
    const targetCenterY = height * (scene.isMobileDevice ? 0.55 : 0.53);
    const minCenterY = topSafeInset + revealHeight / 2;
    const maxCenterY = height - bottomSafeInset - revealHeight / 2;
    return {
      centerX: width * 0.5,
      centerY: Phaser.Math.Clamp(targetCenterY, minCenterY, Math.max(minCenterY, maxCenterY)),
      width: revealWidth,
      height: revealHeight
    };
  }

  public updateBlindBoxRevealVisualLayout(): void {
    const scene = this.scene;
    const image = scene.blindBoxRevealImage;
    const shadow = scene.blindBoxRevealShadow;
    if (!image || !image.active) {
      this.positionBlindBoxMicHintIcon();
      return;
    }
    const viewport = scene.getCurrentViewportSize();
    const layout = this.getBlindBoxRevealLayout(
      viewport.width,
      viewport.height,
      scene.blindBoxRevealImageRatio
    );
    image.setPosition(layout.centerX, layout.centerY);
    image.setDisplaySize(layout.width, layout.height);
    const micAnchorX = layout.centerX / Math.max(1, viewport.width);
    const imageToTextGap = Phaser.Math.Clamp(3 * scene.gameScale, 2, 6);
    const micAnchorY = (layout.centerY + layout.height * 0.5 + imageToTextGap) / Math.max(1, viewport.height);
    this.setPronunciationHudMicAnchor(micAnchorX, micAnchorY);
    if (shadow && shadow.active) {
      shadow.setPosition(layout.centerX, layout.centerY + layout.height * 0.56);
      shadow.setSize(layout.width * 0.64, Math.max(26 * scene.gameScale, layout.height * 0.22));
    }
    this.positionBlindBoxMicHintIcon();
    if (scene.isPronunciationFlowEnabled() && scene.beeContainer && scene.beeContainer.active) {
      const minBeeY = Math.max(54 * scene.gameScale, 26);
      const maxBeeY = layout.centerY - Math.max(36 * scene.gameScale, 20);
      const beeY = Phaser.Math.Clamp(layout.centerY - layout.height * 0.72, minBeeY, maxBeeY);
      scene.beeContainer.setPosition(layout.centerX, beeY);
      scene.beeContainer.setDepth(1720);
      if (scene.beeWordText && scene.beeWordText.active) {
        scene.beeWordText.y = Math.max(24, 40 * scene.gameScale);
      }
    }
    this.updateBlindBoxVolumeMeterPosition();
  }

  public async spawnBlindBoxRound(): Promise<void> {
    const scene = this.scene;
    if (!scene.isPronunciationFlowEnabled()) return;
    const roundToken = ++scene.blindBoxRoundToken;
    scene.isInteractionActive = false;
    scene.blindBoxRoundPhase = 'SELECTING';
    scene.volumeMonitorSensitivityBoost = VOLUME_BASE_SENSITIVITY_BOOST;
    this.destroyBlindBoxUiText();

    if (!scene.imagesLoaded) {
      await scene.loadThemeImages();
      if (!this.isActiveRoundToken(roundToken)) return;
    }

    if (!scene.hasPreloadedNext) {
      scene.hasPreloadedNext = true;
      void scene.preloadNextTheme();
    }

    if (scene.blindBoxRemainingQuestions.length === 0) {
      scene.currentBlindBoxRoundQuestions = [];
      scene.currentQuestion = null;
      await scene.showThemeCompletion();
      return;
    }

    scene.currentBlindBoxRoundQuestions = this.getBlindBoxRoundQuestions();
    if (scene.currentBlindBoxRoundQuestions.length === 0) {
      await scene.showThemeCompletion();
      return;
    }

    scene.forceDestroyAllBlockVisuals();
    scene.blocks.clear(true, true);

    const viewport = scene.getCurrentViewportSize();
    const width = viewport.width;
    const height = viewport.height;
    scene.recalcLayout(width, height);
    scene.updateSceneBounds(width, height);

    scene.currentAnswerKeys = [];
    scene.currentAnswerRatios = scene.currentBlindBoxRoundQuestions.map((questionItem) => {
      const textureKey = scene.getImageTextureKey(questionItem, scene.currentTheme);
      return scene.getTextureAspectRatio(textureKey);
    });
    scene.activeCardLayouts = scene.computeAnswerCardLayouts(scene.currentAnswerRatios, width, height);
    scene.LANE_X_POSITIONS = scene.activeCardLayouts.map((layout) => layout.centerX);
    scene.targetLaneIndex = Phaser.Math.Clamp(
      Math.floor((scene.LANE_X_POSITIONS.length - 1) / 2),
      0,
      Math.max(0, scene.LANE_X_POSITIONS.length - 1)
    );
    if (scene.activeCardLayouts.length > 0) {
      scene.updateJumpVelocityByCardHeight(scene.getMaxCardHeight(scene.activeCardLayouts));
    }
    if (scene.player?.body) {
      const playerBody = scene.player.body as Phaser.Physics.Arcade.Body;
      const startX = scene.getLaneXPosition(scene.targetLaneIndex);
      playerBody.reset(startX, scene.floorSurfaceY);
      playerBody.setVelocity(0, 0);
      scene.player.setAngle(0);
    }

    if (scene.beeContainer && scene.beeContainer.active) {
      scene.beeContainer.setVisible(false);
    }
    this.setBlindBoxMicHintVisible(false);
    this.destroyBlindBoxRevealVisuals();
    this.setBlindBoxPlayerVisible(true);

    scene.currentBlindBoxRoundQuestions.forEach((questionItem, index) => {
      const layout = scene.activeCardLayouts[index];
      if (!layout) return;
      const textureKeyRaw = scene.getImageTextureKey(questionItem, scene.currentTheme);
      const textureToUse = scene.textures.exists(textureKeyRaw) ? textureKeyRaw : 'tile_box';
      const imageRatio = scene.getTextureAspectRatio(textureToUse);
      const cardCenterX = Math.round(layout.centerX);
      const cardCenterY = Math.round(scene.blockCenterY);
      const cardWidth = Math.round(layout.cardWidth);
      const cardHeight = Math.round(layout.cardHeight);
      const imageWidth = Math.round(layout.iconWidth);
      const imageHeight = Math.round(layout.iconHeight);

      const block = scene.blocks.create(cardCenterX, cardCenterY, 'block_hitbox');
      block.setOrigin(0.5);
      block.setDisplaySize(cardWidth, cardHeight);
      block.refreshBody();
      block.setVisible(false);
      block.setAlpha(0);
      block.setData('answerIndex', index);
      block.setData('questionItem', questionItem);
      block.setData('blindBox', true);
      block.setData('blindImageRatio', imageRatio);
      block.setData('blindImageWidth', imageWidth);
      block.setData('blindImageHeight', imageHeight);
      block.setData('isCleaningUp', false);
      block.setData('blindBoxResolved', false);
      block.setData('blindBoxRevealed', false);

      const container = scene.add.container(cardCenterX, cardCenterY);
      const cardFrame = scene.add
        .image(0, 0, scene.textures.exists('tile_card_frame_hd') ? 'tile_card_frame_hd' : 'tile_box')
        .setDisplaySize(cardWidth, cardHeight);
      const cardGlow = scene.add
        .rectangle(0, 0, cardWidth * 0.98, cardHeight * 0.98, 0xfff7b8, 0)
        .setOrigin(0.5);
      const revealIcon = scene.add
        .image(0, 0, textureToUse)
        .setDisplaySize(imageWidth, imageHeight)
        .setVisible(false)
        .setAlpha(0);
      container.add([cardGlow, cardFrame, revealIcon]);

      block.setData('visuals', container);
      block.setData('answerIcon', revealIcon);
      block.setData('blindQuestionMark', undefined);
      block.setData('blindCardFrame', cardFrame);
      block.setData('blindCardGlow', cardGlow);
      block.setData('blindSparkleLeft', undefined);
      block.setData('blindSparkleRight', undefined);

      if (!scene.isMobileDevice) {
        scene.tweens.add({
          targets: container,
          y: Math.round(container.y - 10),
          duration: 1400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: index * 70
        });
      }

      container.setScale(0);
      scene.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        duration: 360,
        delay: index * 90,
        ease: 'Back.easeOut'
      });
    });

    scene.time.delayedCall(420, () => {
      if (!this.isActiveRoundToken(roundToken)) return;
      scene.isInteractionActive = true;
    });
  }

  public hitBlindBox(player: unknown, block: unknown): void {
    const scene = this.scene;
    const collisionPlayer = player as BlindBoxCollisionPlayer;
    const collisionBlock = block as BlindBoxCollisionBlock;

    if (!collisionBlock.active || !scene.isInteractionActive) return;
    if (collisionPlayer.body.velocity.y > scene.getScaledPhysicsValue(500)) return;

    const playerBodyTopY = collisionPlayer.y - collisionPlayer.body.height;
    const blockBottomY = collisionBlock.y + ((collisionBlock.body as { height: number }).height / 2);
    if (playerBodyTopY > blockBottomY) return;

    scene.isInteractionActive = false;
    const recoilForce = scene.getScaledPhysicsValue(400);
    const playerBody = collisionPlayer.body;
    const pushDownPadding = Math.max(2, 6 * scene.gameScale);
    const safePlayerY = blockBottomY + collisionPlayer.displayHeight + pushDownPadding;
    const clampedY = Math.min(safePlayerY, scene.floorSurfaceY);
    playerBody.reset(collisionPlayer.x, clampedY);
    if (clampedY >= scene.floorSurfaceY - Math.max(1, 3 * scene.gameScale)) {
      playerBody.setVelocityY(0);
    } else {
      playerBody.setVelocityY(recoilForce);
    }
    collisionPlayer.setAngle(0);

    if (collisionBlock.getData('blindBoxResolved')) return;
    collisionBlock.setData('blindBoxResolved', true);
    scene.bumpSound.play();
    void this.handleBlindBoxSelection(collisionBlock);
  }

  public async handleBlindBoxSelection(block: unknown): Promise<void> {
    const scene = this.scene;
    const selectedBlock = block as BlindBoxCollisionBlock;
    const roundToken = scene.blindBoxRoundToken;
    const questionItem = selectedBlock.getData('questionItem') as ThemeQuestion | undefined;
    if (!questionItem) {
      scene.isInteractionActive = true;
      return;
    }

    scene.blindBoxRoundPhase = 'SHOWING';
    this.playBlindBoxRevealEffect(selectedBlock, questionItem);

    await this.waitForDelay(360);
    if (!this.isActiveRoundToken(roundToken)) return;

    this.setBlindBoxListenHintVisible(true);
    await this.playQuestionAudioByItem(questionItem);
    if (!this.isActiveRoundToken(roundToken)) return;

    let finalRoundResult: PronunciationRoundResult | null = null;
    let tryAgainCount = 0;
    while (this.isActiveRoundToken(roundToken)) {
      scene.blindBoxRoundPhase = 'RECORDING';
      console.info('[Pronounce] Recognition started:', questionItem.question);
      this.setBlindBoxMicHintVisible(true);
      const volumeMonitorReady = await this.startVolumeMonitor(() => {
        console.info('[Pronounce] Mic countdown reached 0s.');
      });
      const recognitionResult = await this.recognizeWithStableWindow(
        scene.PRONUNCIATION_RECORDING_TIMEOUT_MS,
        scene.volumeMonitorStream
      );
      const volumeMonitorDetectedSignal = scene.volumeMonitorDetectedSignal;
      const volumePeak = Phaser.Math.Clamp(scene.blindBoxCurrentVolumePeak, 0, 1);
      this.stopVolumeMonitor();
      this.setBlindBoxMicHintVisible(false);
      
      // 给手机操作系统底层留出切换音频路由（从录音模式/听筒切换回媒体播放模式）的时间
      // 避免刚刚关闭麦克风时立刻播放音效导致声音被掩盖或吞音
      await this.waitForDelay(150);

      if (!this.isActiveRoundToken(roundToken)) return;

      const transcript = recognitionResult.transcript.trim();
      const textSimilarity = this.getTextSimilarity(
        questionItem.question,
        transcript,
        recognitionResult.reason
      );
      const assessment = assessPronunciationAttempt({
        rawConfidence: recognitionResult.confidence,
        textSimilarity,
        volumePeak,
        volumeMonitorReady,
        volumeMonitorDetectedSignal
      });
      const confidence = assessment.confidence;
      const confidenceLevel = assessment.confidenceLevel;
      if (assessment.usedTranscriptOnlyFallback) {
        console.warn('[Pronounce] Falling back to transcript-only scoring because volume meter never responded.', {
          question: questionItem.question,
          transcript,
          textSimilarity,
          volumePeak,
          volumeMonitorReady,
          volumeMonitorDetectedSignal,
          reason: recognitionResult.reason
        });
      }

      const roundResult: PronunciationRoundResult = {
        targetText: questionItem.question,
        transcript,
        confidence,
        confidenceLevel,
        volumePeak,
        reason: recognitionResult.reason,
        durationMs: recognitionResult.durationMs
      };
      console.info('[Pronounce] Round result:', roundResult);

      scene.blindBoxRoundPhase = 'RESULT';
      const feedbackAnimationTask = this.playBlindBoxFeedbackBadge(confidenceLevel);
      this.playConfidenceFeedbackVoice(confidenceLevel);
      await this.playBlindBoxRevealFeedbackEffect(confidenceLevel);
      await feedbackAnimationTask;

      if (confidenceLevel === 'LOW') {
        tryAgainCount += 1;
        if (tryAgainCount >= ROUND1_TRY_AGAIN_SKIP_LIMIT) {
          console.info('[Pronounce] Try Again limit reached, skipping question without score.', {
            limit: ROUND1_TRY_AGAIN_SKIP_LIMIT,
            question: questionItem.question
          });
          finalRoundResult = roundResult;
          scene.volumeMonitorSensitivityBoost = VOLUME_BASE_SENSITIVITY_BOOST;
          this.removeBlindBoxQuestionFromRemaining(questionItem);
          await this.waitForDelay(180);
          if (!this.isActiveRoundToken(roundToken)) return;
          break;
        }

        scene.volumeMonitorSensitivityBoost = Phaser.Math.Clamp(
          scene.volumeMonitorSensitivityBoost + 0.2,
          VOLUME_BASE_SENSITIVITY_BOOST,
          2.25
        );
        await this.waitForDelay(180);
        if (!this.isActiveRoundToken(roundToken)) return;
        await this.waitForDelay(120);
        if (!this.isActiveRoundToken(roundToken)) return;
        await this.restoreBlindBoxRevealImageForRetry();
        if (!this.isActiveRoundToken(roundToken)) return;
        await this.playQuestionAudioByItem(questionItem);
        if (!this.isActiveRoundToken(roundToken)) return;
        continue;
      }

      finalRoundResult = roundResult;
      scene.volumeMonitorSensitivityBoost = VOLUME_BASE_SENSITIVITY_BOOST;
      scene.pronunciationResults.push(roundResult);
      this.removeBlindBoxQuestionFromRemaining(questionItem);
      scene.score += 1;
      scene.themeScore += 1;
      if (scene.callbackBridge.onScoreUpdate) {
        scene.callbackBridge.onScoreUpdate(scene.score, scene.totalQuestions);
      }
      await this.waitForDelay(160);
      if (!this.isActiveRoundToken(roundToken)) return;
      break;
    }
    if (!finalRoundResult) return;

    const averageConfidence = this.getPronunciationAverageConfidence();
    if (scene.callbackBridge.onPronunciationProgressUpdate) {
      scene.callbackBridge.onPronunciationProgressUpdate(
        scene.pronunciationResults.length,
        scene.totalQuestions,
        averageConfidence
      );
    }

    this.setBlindBoxMicHintVisible(false);
    this.setBlindBoxPlayerVisible(true);
    this.destroyBlindBoxRevealVisuals();
    scene.cleanupBlocks();
    await this.waitForDelay(400);
    if (!this.isActiveRoundToken(roundToken)) return;

    scene.blindBoxRoundPhase = 'IDLE';
    if (scene.blindBoxRemainingQuestions.length === 0) {
      await scene.showThemeCompletion();
      return;
    }

    await this.spawnBlindBoxRound();
  }

  private getBlindBoxRoundQuestions(): ThemeQuestion[] {
    const scene = this.scene;
    if (scene.blindBoxRemainingQuestions.length === 0) {
      return [];
    }
    const candidates = [...scene.blindBoxRemainingQuestions];
    Phaser.Utils.Array.Shuffle(candidates);
    const selected = candidates.slice(0, Math.min(scene.BLIND_BOX_OPTION_COUNT, candidates.length));
    if (selected.length === 0) return [];
    const fallbackItem = selected[0];
    while (selected.length < scene.BLIND_BOX_OPTION_COUNT) {
      selected.push(fallbackItem);
    }
    return selected;
  }

  private emitPronunciationHudState(): void {
    this.positionBlindBoxMicHintIcon();
    this.updateBlindBoxVolumeMeterPosition();
  }

  private setPronunciationHudStage(stage: PronunciationHudStage): void {
    const scene = this.scene;
    const micVisible = stage === 'RECORDING';
    if (scene.pronunciationHudStage === stage && scene.pronunciationHudMicVisible === micVisible) return;
    scene.pronunciationHudStage = stage;
    scene.pronunciationHudMicVisible = micVisible;
    this.emitPronunciationHudState();
  }

  private setPronunciationHudVolumeLevel(level: number, force: boolean = false): void {
    const scene = this.scene;
    const nextLevel = Phaser.Math.Clamp(level, 0, 1);
    if (!force && Math.abs(nextLevel - scene.pronunciationHudVolumeLevel) < 0.015) return;
    scene.pronunciationHudVolumeLevel = nextLevel;
    this.emitPronunciationHudState();
  }

  private setPronunciationHudCountdownSeconds(seconds: number, force: boolean = false): void {
    const scene = this.scene;
    const nextSeconds = Phaser.Math.Clamp(Math.round(seconds), 0, 99);
    if (!force && nextSeconds === scene.pronunciationHudCountdownSeconds) return;
    scene.pronunciationHudCountdownSeconds = nextSeconds;
    this.emitPronunciationHudState();
  }

  private formatBlindBoxVolumeLabel(percentRaw: number): string {
    const percent = Phaser.Math.Clamp(Math.round(percentRaw), 0, 100);
    return `音量 ${percent}%`;
  }

  private updateBlindBoxVolumeValueText(levelRaw: number, force: boolean = false): void {
    const scene = this.scene;
    const valueText = scene.blindBoxVolumeValueText;
    if (!valueText || !valueText.active) return;
    const nextPercent = Phaser.Math.Clamp(Math.round(Phaser.Math.Clamp(levelRaw, 0, 1) * 100), 0, 100);
    if (!force && nextPercent === this.blindBoxVolumeDisplayPercent) return;
    this.blindBoxVolumeDisplayPercent = nextPercent;
    valueText.setText(this.formatBlindBoxVolumeLabel(nextPercent));
  }

  private getMicCountdownProgressRatio(nowMs: number = performance.now()): number {
    if (this.micCountdownDurationMs <= 0 || this.micCountdownStartAtMs <= 0) {
      return this.scene.pronunciationHudCountdownSeconds > 0 ? 1 : 0;
    }
    const elapsedMs = Math.max(0, nowMs - this.micCountdownStartAtMs);
    return Phaser.Math.Clamp(1 - (elapsedMs / this.micCountdownDurationMs), 0, 1);
  }

  private drawMicCountdownRing(progressRatio: number, forceTrackRedraw: boolean = false): void {
    const trackGraphics = this.micCountdownTrackGraphics;
    const progressGraphics = this.micCountdownProgressGraphics;
    if (!trackGraphics || !trackGraphics.active || !progressGraphics || !progressGraphics.active) return;
    if (this.micCountdownRingRadius <= 0 || this.micCountdownRingStrokeWidth <= 0) return;
    trackGraphics.setVisible(true);
    progressGraphics.setVisible(true);
    const radius = this.micCountdownRingRadius;
    const stroke = this.micCountdownRingStrokeWidth;
    const arcStart = MIC_COUNTDOWN_RING_START_ANGLE;
    const drawArc = (
      graphics: Phaser.GameObjects.Graphics,
      arcRadius: number,
      startAngle: number,
      endAngle: number,
      lineWidth: number,
      lineColor: number,
      lineAlpha: number
    ): void => {
      graphics.lineStyle(Math.max(1, lineWidth), lineColor, lineAlpha);
      graphics.beginPath();
      graphics.arc(0, 0, Math.max(1, arcRadius), startAngle, endAngle, false, MIC_COUNTDOWN_RING_ARC_OVERSHOOT);
      graphics.strokePath();
    };

    if (forceTrackRedraw) {
      trackGraphics.clear();
      const fullCircleEnd = arcStart + Phaser.Math.PI2;
      drawArc(
        trackGraphics,
        radius,
        arcStart,
        fullCircleEnd,
        stroke,
        MIC_COUNTDOWN_RING_COLOR,
        MIC_COUNTDOWN_RING_TRACK_ALPHA
      );
    }

    progressGraphics.clear();
    if (progressRatio <= MIC_COUNTDOWN_RING_PROGRESS_MIN_VISIBLE_RATIO) return;
    const arcEnd = arcStart + Phaser.Math.PI2 * progressRatio;
    drawArc(
      progressGraphics,
      radius,
      arcStart,
      arcEnd,
      stroke * 1.28,
      MIC_COUNTDOWN_RING_COLOR,
      MIC_COUNTDOWN_RING_PROGRESS_GLOW_ALPHA
    );
    drawArc(
      progressGraphics,
      radius,
      arcStart,
      arcEnd,
      stroke,
      MIC_COUNTDOWN_RING_COLOR,
      MIC_COUNTDOWN_RING_PROGRESS_ALPHA
    );

    const endX = Math.cos(arcEnd) * radius;
    const endY = Math.sin(arcEnd) * radius;
    const capCoreRadius = Math.max(1, stroke * 0.38);
    progressGraphics.fillStyle(MIC_COUNTDOWN_RING_COLOR, MIC_COUNTDOWN_RING_PROGRESS_CAP_ALPHA);
    progressGraphics.fillCircle(endX, endY, capCoreRadius);
  }

  private getMicCountdownRingMetrics(iconDisplaySize: number): { strokeWidth: number; radius: number } {
    const strokeWidth = Math.max(1.5, iconDisplaySize * MIC_COUNTDOWN_RING_STROKE_RATIO);
    const iconVisibleRadius = iconDisplaySize * MIC_HINT_ICON_ART_VISIBLE_RATIO * 0.5;
    const padding = Math.max(2, iconDisplaySize * MIC_HINT_ICON_RING_PADDING_RATIO);
    const radius = iconVisibleRadius + padding + strokeWidth * 0.5;
    return { strokeWidth, radius };
  }

  private getMicHintIconSizePx(): number {
    const scene = this.scene;
    return MIC_HINT_ICON_BASE_SIZE * scene.gameScale;
  }

  private getMicHintLabelSizePx(): number {
    const scene = this.scene;
    return Math.round(MIC_HINT_LABEL_BASE_SIZE * scene.gameScale);
  }

  private getMicHintLabelRenderSizePx(): number {
    return Math.max(8, Math.round(this.getMicHintLabelSizePx() * MIC_HINT_LABEL_FONT_SCALE));
  }

  private getMicHintIconDisplaySizePx(iconSize: number): number {
    return Math.max(36 * this.scene.gameScale, iconSize);
  }

  private getMicHintBottomSafetySpacePx(): number {
    const scene = this.scene;
    const iconSize = this.getMicHintIconSizePx();
    const labelSize = this.getMicHintLabelRenderSizePx();
    const iconDisplaySize = this.getMicHintIconDisplaySizePx(iconSize);
    const ringMetrics = this.getMicCountdownRingMetrics(iconDisplaySize);
    const ringOuterRadius = ringMetrics.radius + ringMetrics.strokeWidth * 0.75;
    const textHeight = Math.round(labelSize * 1.28);
    const textToMicGap = MIC_HINT_TEXT_GAP_BASE_SIZE * scene.gameScale;
    const imageToTextGap = MIC_HINT_IMAGE_GAP_BASE_SIZE * scene.gameScale;
    const bottomMargin = MIC_HINT_BOTTOM_MARGIN_BASE_SIZE * scene.gameScale;
    const iconCenterFromTextTop = textHeight + textToMicGap + ringOuterRadius;
    const micBottomFromTextTop = iconCenterFromTextTop + ringOuterRadius;
    return imageToTextGap + micBottomFromTextTop + bottomMargin;
  }

  private refreshMicCountdownRingLayout(iconDisplaySize: number): void {
    const { strokeWidth, radius } = this.getMicCountdownRingMetrics(iconDisplaySize);
    this.micCountdownRingStrokeWidth = strokeWidth;
    this.micCountdownRingRadius = radius;
    this.drawMicCountdownRing(this.getMicCountdownProgressRatio(), true);
  }

  private stopMicCountdown(): void {
    if (this.micCountdownTween) {
      this.micCountdownTween.remove();
      this.micCountdownTween = null;
    }
    this.micCountdownDurationMs = 0;
    this.micCountdownStartAtMs = 0;
    this.micCountdownTweenState.progress = 0;
    this.micCountdownCompleteCallback = null;
    this.drawMicCountdownRing(0);
  }

  private startMicCountdown(durationMs: number, onComplete?: () => void): void {
    const safeDurationMs = Math.max(100, Math.round(durationMs));
    this.stopMicCountdown();
    this.micCountdownDurationMs = safeDurationMs;
    this.micCountdownStartAtMs = performance.now();
    this.micCountdownTweenState.progress = 1;
    this.micCountdownCompleteCallback = onComplete || null;
    this.setPronunciationHudCountdownSeconds(Math.ceil(safeDurationMs / 1000), true);
    this.drawMicCountdownRing(1);
    this.micCountdownTween = this.scene.tweens.add({
      targets: this.micCountdownTweenState,
      progress: 0,
      duration: safeDurationMs,
      ease: 'Linear',
      onUpdate: () => {
        this.updateMicCountdownProgress(performance.now());
      },
      onComplete: () => {
        this.micCountdownTween = null;
        this.updateMicCountdownProgress(performance.now());
        const callback = this.micCountdownCompleteCallback;
        this.micCountdownCompleteCallback = null;
        if (callback) {
          callback();
        }
      }
    });
  }

  private updateMicCountdownProgress(nowMs: number): void {
    if (this.micCountdownDurationMs <= 0 || this.micCountdownStartAtMs <= 0) return;
    const elapsedMs = Math.max(0, nowMs - this.micCountdownStartAtMs);
    const remainingMs = Math.max(0, this.micCountdownDurationMs - elapsedMs);
    const progressRatio = Phaser.Math.Clamp(this.micCountdownTweenState.progress, 0, 1);
    this.drawMicCountdownRing(progressRatio);
    this.setPronunciationHudCountdownSeconds(Math.ceil(remainingMs / 1000));
  }

  private setPronunciationHudMicAnchor(anchorX: number, anchorY: number, force: boolean = false): void {
    const scene = this.scene;
    const nextAnchorX = Phaser.Math.Clamp(anchorX, 0.02, 0.98);
    const nextAnchorY = Phaser.Math.Clamp(anchorY, 0.02, 0.98);
    if (
      !force &&
      Math.abs(nextAnchorX - scene.pronunciationHudMicAnchorX) < 0.002 &&
      Math.abs(nextAnchorY - scene.pronunciationHudMicAnchorY) < 0.002
    ) {
      return;
    }
    scene.pronunciationHudMicAnchorX = nextAnchorX;
    scene.pronunciationHudMicAnchorY = nextAnchorY;
    this.emitPronunciationHudState();
  }

  private positionBlindBoxMicHintIcon(): void {
    const scene = this.scene;
    const shouldShowMicHint = scene.isPronunciationFlowEnabled() && scene.pronunciationHudStage !== 'HIDDEN';
    if (!shouldShowMicHint) {
      if (scene.blindBoxMicPulseTween) {
        scene.blindBoxMicPulseTween.remove();
        scene.blindBoxMicPulseTween = null;
      }
      if (scene.blindBoxMicHintContainer) {
        scene.blindBoxMicHintContainer.setVisible(false);
      }
      this.stopMicCountdown();
      return;
    }

    const viewport = scene.getCurrentViewportSize();
    const iconTextureKey = scene.textures.exists('tile_speaker_icon_hd') ? 'tile_speaker_icon_hd' : 'tile_box';
    const iconSize = this.getMicHintIconSizePx();
    const labelSize = this.getMicHintLabelRenderSizePx();
    const iconDisplaySize = this.getMicHintIconDisplaySizePx(iconSize);
    const ringMetrics = this.getMicCountdownRingMetrics(iconDisplaySize);
    const ringOuterRadius = ringMetrics.radius + ringMetrics.strokeWidth * 0.75;
    const textHeight = Math.round(labelSize * 1.28);
    const textToMicGap = MIC_HINT_TEXT_GAP_BASE_SIZE * scene.gameScale;
    const bottomMargin = MIC_HINT_BOTTOM_MARGIN_BASE_SIZE * scene.gameScale;
    const iconCenterFromTextTop = textHeight + textToMicGap + ringOuterRadius;
    const micBottomFromTextTop = iconCenterFromTextTop + ringOuterRadius;
    const labelTopY = -iconCenterFromTextTop;
    const minX = ringOuterRadius;
    const maxX = Math.max(minX, viewport.width - minX);
    const minTextTop = Math.max(0, ringOuterRadius - iconCenterFromTextTop);
    const maxTextTop = Math.max(minTextTop, viewport.height - micBottomFromTextTop - bottomMargin);
    const rawX = viewport.width * scene.pronunciationHudMicAnchorX;
    const rawTextTopY = viewport.height * scene.pronunciationHudMicAnchorY;
    const x = Math.round(Phaser.Math.Clamp(rawX, minX, maxX));
    const textTopY = Math.round(Phaser.Math.Clamp(rawTextTopY, minTextTop, maxTextTop));
    const y = Math.round(textTopY + iconCenterFromTextTop);

    if (!scene.blindBoxMicHintContainer || !scene.blindBoxMicHintContainer.active) {
      const ringTrack = scene.add.graphics();
      const ringProgress = scene.add.graphics();
      const icon = scene.add.image(0, 0, iconTextureKey).setDisplaySize(iconDisplaySize, iconDisplaySize).setOrigin(0.5);
      const label = scene.add.text(0, labelTopY, '', {
        fontFamily: FONT_STACK,
        fontSize: `${labelSize}px`,
        fontStyle: MIC_HINT_LABEL_FONT_STYLE,
        color: MIC_HINT_LABEL_COLOR,
        align: 'center'
      }).setOrigin(0.5, 0);
      scene.blindBoxMicHintContainer = scene.add
        .container(x, y, [ringTrack, ringProgress, icon, label])
        .setDepth(1800)
        .setVisible(true);
      scene.blindBoxMicHintIcon = icon;
      scene.blindBoxMicHintText = label;
      this.micCountdownTrackGraphics = ringTrack;
      this.micCountdownProgressGraphics = ringProgress;
    } else {
      scene.blindBoxMicHintContainer.setPosition(x, y).setVisible(true).setAlpha(1);
      if (
        !this.micCountdownTrackGraphics ||
        !this.micCountdownTrackGraphics.active ||
        !this.micCountdownProgressGraphics ||
        !this.micCountdownProgressGraphics.active
      ) {
        const ringTrack = scene.add.graphics();
        const ringProgress = scene.add.graphics();
        scene.blindBoxMicHintContainer.addAt(ringTrack, 0);
        scene.blindBoxMicHintContainer.addAt(ringProgress, 1);
        this.micCountdownTrackGraphics = ringTrack;
        this.micCountdownProgressGraphics = ringProgress;
      }
      if (scene.blindBoxMicHintIcon && scene.blindBoxMicHintIcon.active) {
        scene.blindBoxMicHintIcon.setTexture(iconTextureKey);
        scene.blindBoxMicHintIcon.setDisplaySize(iconDisplaySize, iconDisplaySize);
      }
      if (scene.blindBoxMicHintText && scene.blindBoxMicHintText.active) {
        scene.blindBoxMicHintText
          .setFontSize(labelSize)
          .setFontStyle(MIC_HINT_LABEL_FONT_STYLE)
          .setColor(MIC_HINT_LABEL_COLOR)
          .setY(Math.round(labelTopY));
      }
    }

    if (scene.blindBoxMicHintText && scene.blindBoxMicHintText.active) {
      const hintText = scene.pronunciationHudStage === 'LISTENING'
        ? '请先听示范'
        : `录音中（倒计时${Math.max(0, Math.round(scene.pronunciationHudCountdownSeconds))}秒）`;
      scene.blindBoxMicHintText.setText(hintText);
    }

    this.refreshMicCountdownRingLayout(iconDisplaySize);

    if (scene.blindBoxMicHintIcon && scene.blindBoxMicHintIcon.active) {
      if (scene.blindBoxMicPulseTween) {
        scene.blindBoxMicPulseTween.remove();
        scene.blindBoxMicPulseTween = null;
      }
      scene.blindBoxMicHintIcon.setDisplaySize(iconDisplaySize, iconDisplaySize);
    }
  }

  private setBlindBoxPlayerVisible(visible: boolean): void {
    const scene = this.scene;
    if (!scene.player || !scene.player.body) return;
    const body = scene.player.body as Phaser.Physics.Arcade.Body;
    scene.player.setVisible(visible);
    scene.player.setAlpha(visible ? 1 : 0);
    body.enable = visible;
    if (scene.jumpBurstEmitter) {
      scene.jumpBurstEmitter.setVisible(visible);
      if (!visible) {
        scene.jumpBurstEmitter.stop();
        scene.jumpBurstEmitter.killAll();
      }
    }
    if (scene.playerTrailEmitter) {
      scene.playerTrailEmitter.setVisible(visible);
      if (!visible) {
        scene.playerTrailEmitter.stop();
        scene.playerTrailEmitter.killAll();
      } else {
        scene.playerTrailEmitter.start();
      }
    }
    if (!visible) {
      body.setVelocity(0, 0);
    }
  }

  private setBlindBoxMicHintVisible(visible: boolean): void {
    const scene = this.scene;
    if (!visible) {
      this.stopMicCountdown();
      if (scene.blindBoxMicPulseTween) {
        scene.blindBoxMicPulseTween.remove();
        scene.blindBoxMicPulseTween = null;
      }
    }
    this.setPronunciationHudStage(visible ? 'RECORDING' : 'HIDDEN');
  }

  private setBlindBoxListenHintVisible(visible: boolean): void {
    if (!visible) {
      this.setPronunciationHudStage('HIDDEN');
      return;
    }
    this.setPronunciationHudStage('LISTENING');
  }

  private destroyBlindBoxRevealVisuals(): void {
    const scene = this.scene;
    this.stopMicCountdown();
    if (scene.blindBoxMicPulseTween) {
      scene.blindBoxMicPulseTween.remove();
      scene.blindBoxMicPulseTween = null;
    }
    if (scene.blindBoxMicHintContainer) {
      scene.tweens.killTweensOf(scene.blindBoxMicHintContainer);
      scene.blindBoxMicHintContainer.destroy();
      scene.blindBoxMicHintContainer = null;
    }
    if (scene.blindBoxMicHintIcon) {
      scene.blindBoxMicHintIcon = null;
    }
    if (scene.blindBoxMicHintText) {
      scene.blindBoxMicHintText = null;
    }
    this.micCountdownTrackGraphics = null;
    this.micCountdownProgressGraphics = null;
    this.micCountdownRingRadius = 0;
    this.micCountdownRingStrokeWidth = 0;
    if (scene.blindBoxRevealImage) {
      scene.tweens.killTweensOf(scene.blindBoxRevealImage);
      scene.blindBoxRevealImage.destroy();
      scene.blindBoxRevealImage = null;
    }
    if (scene.blindBoxRevealShadow) {
      scene.tweens.killTweensOf(scene.blindBoxRevealShadow);
      scene.blindBoxRevealShadow.destroy();
      scene.blindBoxRevealShadow = null;
    }
  }

  private getOrCreateRound1VolumeFillTexture(
    meterWidth: number,
    meterHeight: number,
    innerRect: { x: number; y: number; width: number; height: number; radius: number }
  ): string {
    const scene = this.scene;
    const textureWidth = Math.max(8, Math.round(meterWidth));
    const textureHeight = Math.max(8, Math.round(meterHeight));
    const textureKey = `round1_volume_fill_smooth_${textureWidth}x${textureHeight}`;
    if (scene.textures.exists(textureKey)) {
      return textureKey;
    }

    const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
    const centerX = textureWidth * 0.5;
    const centerY = textureHeight * 0.5;
    const channelInsetX = innerRect.width * 0.05;
    const channelX = centerX + innerRect.x + channelInsetX;
    const channelY = centerY + innerRect.y;
    const channelWidth = Math.max(6, innerRect.width - channelInsetX * 2);
    const channelHeight = Math.max(12, innerRect.height);

    // 平滑多段渐变：底部(蓝) → 青 → 绿 → 黄 → 橙 → 红(顶部)
    const stops = [
      { p: 0.0, r: 0x2a, g: 0x6b, b: 0xff },
      { p: 0.18, r: 0x00, g: 0xc8, b: 0xff },
      { p: 0.38, r: 0x00, g: 0xe8, b: 0x96 },
      { p: 0.58, r: 0x88, g: 0xff, b: 0x00 },
      { p: 0.75, r: 0xff, g: 0xdd, b: 0x00 },
      { p: 0.88, r: 0xff, g: 0x88, b: 0x00 },
      { p: 1.0, r: 0xff, g: 0x33, b: 0x44 },
    ];
    const lerpColor = (t: number): number => {
      const ct = Phaser.Math.Clamp(t, 0, 1);
      for (let si = 0; si < stops.length - 1; si += 1) {
        const a = stops[si];
        const b = stops[si + 1];
        if (ct >= a.p && ct <= b.p) {
          const lt = (ct - a.p) / (b.p - a.p);
          return Phaser.Display.Color.GetColor(
            Math.round(a.r + (b.r - a.r) * lt),
            Math.round(a.g + (b.g - a.g) * lt),
            Math.round(a.b + (b.b - a.b) * lt)
          );
        }
      }
      const last = stops[stops.length - 1];
      return Phaser.Display.Color.GetColor(last.r, last.g, last.b);
    };

    // 用薄水平切片绘制平滑渐变
    const sliceCount = Math.max(48, Math.round(channelHeight / 2));
    const sliceH = channelHeight / sliceCount;
    for (let i = 0; i < sliceCount; i += 1) {
      const t = i / Math.max(1, sliceCount - 1);
      const sliceY = channelY + channelHeight - (i + 1) * sliceH;
      const hex = lerpColor(t);
      // 主填充
      graphics.fillStyle(hex, 1);
      graphics.fillRect(channelX, sliceY, channelWidth, sliceH + 0.5);
      // 左侧高光条，增加立体感
      graphics.fillStyle(0xffffff, 0.12 + t * 0.08);
      graphics.fillRect(channelX, sliceY, channelWidth * 0.14, sliceH + 0.5);
      // 右侧暗影
      graphics.fillStyle(0x000000, 0.06);
      graphics.fillRect(channelX + channelWidth * 0.88, sliceY, channelWidth * 0.12, sliceH + 0.5);
    }

    graphics.generateTexture(textureKey, textureWidth, textureHeight);
    graphics.destroy();
    return textureKey;
  }

  private ensureBlindBoxVolumeMeter(): void {
    const scene = this.scene;
    if (!scene.blindBoxVolumeContainer || !scene.blindBoxVolumeContainer.active) {
      const frameTextureKey = scene.textures.exists('round1_volume_border_hd')
        ? 'round1_volume_border_hd'
        : (scene.textures.exists('round1_volume_frame_hd')
          ? 'round1_volume_frame_hd'
          : (scene.textures.exists('tile_box') ? 'tile_box' : 'particle_gold'));
      const meterHeight = Phaser.Math.Clamp(420 * scene.gameScale, 280, 520);
      const meterWidth = Phaser.Math.Clamp(meterHeight * 0.27, 56, 120);
      const innerRect = {
        x: -meterWidth * 0.255,
        y: -meterHeight * 0.438,
        width: meterWidth * 0.51,
        height: meterHeight * 0.878,
        radius: meterWidth * 0.24
      };
      const fillTextureKey = this.getOrCreateRound1VolumeFillTexture(meterWidth, meterHeight, innerRect);
      const frameImage = scene.add.image(0, 0, frameTextureKey).setOrigin(0.5);
      const fillImage = scene.add.image(0, 0, fillTextureKey).setOrigin(0.5);
      frameImage.setDisplaySize(meterWidth, meterHeight);
      fillImage.setDisplaySize(meterWidth, meterHeight);
      if (fillImage.postFX) {
        this.blindBoxVolumeBloomFx = fillImage.postFX.addBloom(0x66ccff, 0.6, 0.6, 0.2, 0.25, 3);
      }

      const maskGraphics = scene.make.graphics({ x: 0, y: 0, add: false });
      maskGraphics.fillStyle(0xffffff, 1);
      maskGraphics.fillRoundedRect(
        innerRect.x,
        innerRect.y,
        innerRect.width,
        innerRect.height,
        innerRect.radius
      );
      const fillMask = maskGraphics.createGeometryMask();
      fillImage.setMask(fillMask);

      const peakLine = scene.add
        .rectangle(
          0,
          innerRect.y + innerRect.height,
          innerRect.width * 0.84,
          Math.max(2, meterHeight * 0.014),
          0xfff1c6,
          0.92
        )
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      peakLine.setMask(fillMask);

      const labelSize = this.getMicHintLabelRenderSizePx();
      const volumeValueText = scene.add.text(0, meterHeight * 0.48, this.formatBlindBoxVolumeLabel(0), {
        fontFamily: FONT_STACK,
        fontSize: `${labelSize}px`,
        fontStyle: MIC_HINT_LABEL_FONT_STYLE,
        color: MIC_HINT_LABEL_COLOR,
        align: 'center'
      }).setOrigin(0.5, 0);

      scene.blindBoxVolumeContainer = scene.add
        .container(0, 0, [fillImage, peakLine, frameImage, volumeValueText])
        .setDepth(1790)
        .setVisible(false);
      scene.blindBoxVolumeContainer.setData('meterWidth', meterWidth);
      scene.blindBoxVolumeContainer.setData('meterHeight', meterHeight);
      scene.blindBoxVolumeFrameImage = frameImage;
      scene.blindBoxVolumeFillImage = fillImage;
      scene.blindBoxVolumeFillGraphics = null;
      scene.blindBoxVolumeMaskGraphics = maskGraphics;
      scene.blindBoxVolumeFillMask = fillMask;
      scene.blindBoxVolumePeakLine = peakLine;
      scene.blindBoxVolumeValueText = volumeValueText;
      scene.blindBoxVolumeInnerRect = innerRect;
      this.updateBlindBoxVolumeFillVisual(0);
      this.updateBlindBoxVolumePeakLine(0);
    }

    if (!scene.blindBoxVolumeSparkEmitter || !scene.blindBoxVolumeSparkEmitter.active) {
      const sparkTextureKey = scene.textures.exists('round1_volume_spark') ? 'round1_volume_spark' : 'particle_sparkle';
      scene.blindBoxVolumeSparkEmitter = scene.add.particles(0, 0, sparkTextureKey, {
        speed: { min: 140, max: 380 },
        angle: { min: 210, max: 330 },
        scale: { start: 0.65, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0xffea3a, 0xff5b00],
        lifespan: { min: 300, max: 550 },
        frequency: 40,
        quantity: 2,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false
      }).setDepth(1792);
    }

    scene.blindBoxVolumeLevelStage = -1;
    scene.blindBoxVolumeCurrentLevel = 0;
    scene.blindBoxVolumePeakLevel = 0;
    scene.blindBoxVolumePeakHoldUntil = 0;
    scene.blindBoxVolumeLastUpdateAt = performance.now();
    scene.blindBoxVolumeBurstCooldownUntil = 0;
    this.blindBoxVolumeDisplayLevel = 0;
    this.blindBoxVolumeDisplayPercent = -1;
    this.blindBoxVolumeShakeOffsetX = 0;
    this.blindBoxVolumeShakeOffsetY = 0;
    this.volumeMeterShakeCooldownUntil = 0;
    this.volumeBarMaxHoldUntil = 0;
    this.volumeGlowBurstCooldownUntil = 0;
    scene.volumeMonitorStartAt = 0;
    scene.volumeMonitorNoiseFloor = 0.015;
    scene.volumeMonitorReferenceLevel = 0.045;
    this.redrawBlindBoxVolumeMeter(0);
    this.setPronunciationHudVolumeLevel(0, true);
  }

  private redrawBlindBoxVolumeMeter(levelRaw: number): void {
    const scene = this.scene;
    const fillImage = scene.blindBoxVolumeFillImage;
    const innerRect = scene.blindBoxVolumeInnerRect;
    if (!fillImage || !fillImage.active || !innerRect) return;

    const level = Phaser.Math.Clamp(levelRaw, 0, 1);
    const displayLevel = level < VOLUME_SILENCE_CUTOFF ? 0 : Math.pow(level, 1.08);
    this.blindBoxVolumeDisplayLevel = displayLevel;
    const stage = displayLevel >= 0.58 ? 3 : displayLevel >= 0.38 ? 2 : displayLevel >= 0.16 ? 1 : 0;
    scene.blindBoxVolumeLevelStage = stage;

    this.updateBlindBoxVolumeFillVisual(displayLevel);
    this.updateBlindBoxVolumePeakLine(displayLevel);
    this.updateBlindBoxVolumeValueText(displayLevel);

    const heatLevel = Phaser.Math.Clamp((displayLevel - VOLUME_GLOW_THRESHOLD) / (1 - VOLUME_GLOW_THRESHOLD), 0, 1);

    const shakeFactor = this.applyBlindBoxVolumeJuice(displayLevel);
    this.updateBlindBoxVolumeSparkEffect(Math.max(heatLevel, shakeFactor * 0.9));
  }

  private interpolateColorHex(fromHex: number, toHex: number, factorRaw: number): number {
    const factor = Phaser.Math.Clamp(factorRaw, 0, 1);
    const fromColor = Phaser.Display.Color.ValueToColor(fromHex);
    const toColor = Phaser.Display.Color.ValueToColor(toHex);
    const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(
      fromColor,
      toColor,
      100,
      Math.round(factor * 100)
    );
    return Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b);
  }

  private applyBlindBoxVolumeContainerTransform(): void {
    const scene = this.scene;
    const container = scene.blindBoxVolumeContainer;
    if (!container || !container.active) return;
    const targetX = this.blindBoxVolumeBaseX + this.blindBoxVolumeShakeOffsetX;
    const targetY = this.blindBoxVolumeBaseY + this.blindBoxVolumeShakeOffsetY;
    container.setPosition(targetX, targetY);
    if (scene.blindBoxVolumeMaskGraphics) {
      scene.blindBoxVolumeMaskGraphics.setPosition(targetX, targetY);
    }
    const topPoint = this.getBlindBoxVolumeTopWorldPoint();
    if (topPoint && scene.blindBoxVolumeSparkEmitter?.active) {
      scene.blindBoxVolumeSparkEmitter.setPosition(topPoint.x, topPoint.y);
    }
  }

  private applyBlindBoxVolumeJuice(displayLevelRaw: number): number {
    const scene = this.scene;
    const displayLevel = Phaser.Math.Clamp(displayLevelRaw, 0, 1);
    const shakeFactor = Phaser.Math.Clamp(
      (displayLevel - VOLUME_JUICE_SHAKE_THRESHOLD) / (1 - VOLUME_JUICE_SHAKE_THRESHOLD),
      0,
      1
    );
    if (shakeFactor <= 0) {
      if (this.blindBoxVolumeShakeOffsetX !== 0 || this.blindBoxVolumeShakeOffsetY !== 0) {
        this.blindBoxVolumeShakeOffsetX = 0;
        this.blindBoxVolumeShakeOffsetY = 0;
        this.applyBlindBoxVolumeContainerTransform();
      }
      return 0;
    }

    const maxOffset = Phaser.Math.Linear(0.8, Math.max(2.2, 3.8 * scene.gameScale), shakeFactor);
    this.blindBoxVolumeShakeOffsetX = Phaser.Math.FloatBetween(-maxOffset, maxOffset);
    this.blindBoxVolumeShakeOffsetY = Phaser.Math.FloatBetween(-maxOffset, maxOffset);
    this.applyBlindBoxVolumeContainerTransform();

    const now = performance.now();
    if (now >= this.volumeMeterShakeCooldownUntil) {
      const shakeDuration = Phaser.Math.Linear(36, 88, shakeFactor);
      const shakeIntensity = Phaser.Math.Linear(0.0006, 0.0022, shakeFactor);
      scene.cameras.main.shake(shakeDuration, shakeIntensity);
      this.volumeMeterShakeCooldownUntil = now + VOLUME_JUICE_SHAKE_COOLDOWN_MS;
    }
    return shakeFactor;
  }

  private updateBlindBoxVolumeFillVisual(levelRaw: number): void {
    const scene = this.scene;
    const fillImage = scene.blindBoxVolumeFillImage;
    if (!fillImage || !fillImage.active) return;
    const level = Phaser.Math.Clamp(levelRaw, 0, 1);
    this.applyBlindBoxVolumeFillCrop(fillImage, level);
    if (level <= 0.0005) {
      fillImage.setVisible(false);
      if (this.blindBoxVolumeBloomFx) {
        this.blindBoxVolumeBloomFx.strength = 0;
        this.blindBoxVolumeBloomFx.blurStrength = 0;
      }
      return;
    }

    fillImage.setVisible(true);
    // 颜色已烘焙进纹理（蓝→青→绿→黄→橙→红），仅在高音量时叠加白色热感效果
    const flashBase = Phaser.Math.Clamp(
      (level - VOLUME_JUICE_FLASH_THRESHOLD) / (1 - VOLUME_JUICE_FLASH_THRESHOLD),
      0,
      1
    );
    const flashPulse = flashBase > 0 ? (0.5 + Math.sin(performance.now() * 0.085) * 0.5) : 0;
    const heatWhiten = Phaser.Math.Clamp((level - 0.7) / 0.3, 0, 1) * 0.15 + flashBase * flashPulse * 0.2;
    const brightenColor = this.interpolateColorHex(0xffffff, 0xfff8e0, heatWhiten);
    fillImage
      .setTint(brightenColor)
      .setAlpha(Phaser.Math.Linear(0.9, 1, level));

    if (this.blindBoxVolumeBloomFx) {
      const bloomHeat = Phaser.Math.Clamp((level - 0.35) / 0.65, 0, 1);
      this.blindBoxVolumeBloomFx.color = this.interpolateColorHex(0x66ccff, 0xffee88, bloomHeat);
      this.blindBoxVolumeBloomFx.offsetX = Phaser.Math.Linear(0.4, 1.0, bloomHeat);
      this.blindBoxVolumeBloomFx.offsetY = Phaser.Math.Linear(0.4, 1.0, bloomHeat);
      this.blindBoxVolumeBloomFx.blurStrength = Phaser.Math.Linear(0.2, 1.5, bloomHeat);
      this.blindBoxVolumeBloomFx.strength = Phaser.Math.Linear(0.3, 2.2, bloomHeat);
      this.blindBoxVolumeBloomFx.steps = Math.round(Phaser.Math.Linear(2, 5, bloomHeat));
    }
  }

  private applyBlindBoxVolumeFillCrop(fillImage: Phaser.GameObjects.Image, levelRaw: number): void {
    const level = Phaser.Math.Clamp(levelRaw, 0, 1);
    const frameWidth = fillImage.frame.cutWidth;
    const frameHeight = fillImage.frame.cutHeight;
    if (level <= 0.0005) {
      fillImage.setCrop(0, frameHeight, frameWidth, 0);
      return;
    }

    const cropHeight = Math.max(1, Math.round(frameHeight * level));
    const cropY = Math.max(0, frameHeight - cropHeight);
    fillImage.setCrop(0, cropY, frameWidth, cropHeight);
  }

  private updateBlindBoxVolumePeakLine(currentDisplayLevelRaw: number): void {
    const scene = this.scene;
    const innerRect = scene.blindBoxVolumeInnerRect;
    const peakLine = scene.blindBoxVolumePeakLine;
    if (!innerRect || !peakLine || !peakLine.active) return;

    const currentDisplayLevel = Phaser.Math.Clamp(currentDisplayLevelRaw, 0, 1);
    const peakLevel = Phaser.Math.Clamp(scene.blindBoxVolumePeakLevel, 0, 1);
    if (peakLevel <= 0.01 || peakLevel <= currentDisplayLevel + 0.01) {
      peakLine.setVisible(false);
      return;
    }

    const peakY = innerRect.y + innerRect.height - innerRect.height * peakLevel;
    const peakHeat = Phaser.Math.Clamp((peakLevel - VOLUME_GLOW_THRESHOLD) / (1 - VOLUME_GLOW_THRESHOLD), 0, 1);
    const peakColor = Phaser.Display.Color.HSLToColor(
      Phaser.Math.Linear(0.14, 0.06, peakHeat),
      Phaser.Math.Linear(0.78, 0.98, peakHeat),
      Phaser.Math.Linear(0.82, 0.68, peakHeat)
    );
    peakLine
      .setVisible(true)
      .setY(peakY)
      .setFillStyle(peakColor.color, 1)
      .setAlpha(Phaser.Math.Linear(0.58, 0.96, peakLevel));
  }

  private updateBlindBoxVolumeSparkEffect(heatLevelRaw: number): void {
    const scene = this.scene;
    const emitter = scene.blindBoxVolumeSparkEmitter;
    const topPoint = this.getBlindBoxVolumeTopWorldPoint();
    if (!emitter || !emitter.active || !topPoint) return;
    const heatLevel = Phaser.Math.Clamp(heatLevelRaw, 0, 1);
    if (heatLevel <= 0) {
      emitter.stop();
      emitter.killAll();
      return;
    }
    emitter.setPosition(topPoint.x, topPoint.y);
    emitter.setFrequency(Math.round(Phaser.Math.Linear(70, 15, heatLevel)));
    emitter.setScale(Phaser.Math.Linear(0.3, 0.85, heatLevel), 0);
    emitter.start();
  }

  private getBlindBoxVolumeTopWorldPoint(): { x: number; y: number } | null {
    const scene = this.scene;
    const container = scene.blindBoxVolumeContainer;
    const innerRect = scene.blindBoxVolumeInnerRect;
    if (!container || !container.active || !innerRect) return null;
    const displayLevel = Phaser.Math.Clamp(this.blindBoxVolumeDisplayLevel, 0, 1);
    const fillHeight = innerRect.height * displayLevel;
    const fillTopY = innerRect.y + innerRect.height - fillHeight;
    return {
      x: container.x,
      y: container.y + fillTopY - Math.max(2, innerRect.height * 0.012)
    };
  }

  private triggerBlindBoxVolumeGlowIgnition(heatLevelRaw: number): void {
    const scene = this.scene;
    const now = performance.now();
    if (now < this.volumeGlowBurstCooldownUntil) return;
    const topPoint = this.getBlindBoxVolumeTopWorldPoint();
    if (!topPoint) return;
    this.volumeGlowBurstCooldownUntil = now + VOLUME_GLOW_IGNITION_COOLDOWN_MS;

    const heatLevel = Phaser.Math.Clamp(heatLevelRaw, 0, 1);
    const sparkTextureKey = scene.textures.exists('round1_volume_spark') ? 'round1_volume_spark' : 'particle_sparkle';
    const ignitionEmitter = scene.add.particles(0, 0, sparkTextureKey, {
      speed: { min: 160, max: Phaser.Math.Linear(260, 420, heatLevel) },
      angle: { min: 212, max: 328 },
      scale: { start: Phaser.Math.Linear(0.34, 0.52, heatLevel), end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 180, max: 320 },
      quantity: 10,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false
    }).setDepth(1794);
    ignitionEmitter.explode(10, topPoint.x, topPoint.y);
    scene.time.delayedCall(360, () => {
      if (ignitionEmitter.active) {
        ignitionEmitter.destroy();
      }
    });

    const ring = scene.add
      .circle(topPoint.x, topPoint.y, Math.max(4, 8 * scene.gameScale), 0xfff2c1, 0.52)
      .setStrokeStyle(Math.max(2, 3 * scene.gameScale), 0xffd475, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1795);
    scene.tweens.add({
      targets: ring,
      scaleX: Phaser.Math.Linear(2.6, 3.6, heatLevel),
      scaleY: Phaser.Math.Linear(2.6, 3.6, heatLevel),
      alpha: 0,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        ring.destroy();
      }
    });
  }

  private triggerBlindBoxVolumeBurst(): void {
    const scene = this.scene;
    const now = performance.now();
    if (now < scene.blindBoxVolumeBurstCooldownUntil) return;
    const topPoint = this.getBlindBoxVolumeTopWorldPoint();
    if (!topPoint) return;
    scene.blindBoxVolumeBurstCooldownUntil = now + VOLUME_FULL_BURST_COOLDOWN_MS;

    const sparkTextureKey = scene.textures.exists('round1_volume_spark') ? 'round1_volume_spark' : 'particle_sparkle';
    const burstEmitter = scene.add.particles(0, 0, sparkTextureKey, {
      speed: { min: 220, max: 520 },
      angle: { min: 205, max: 335 },
      scale: { start: 0.62, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 260, max: 460 },
      quantity: 20,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false
    }).setDepth(1794);
    burstEmitter.explode(20, topPoint.x, topPoint.y);
    scene.time.delayedCall(520, () => {
      if (burstEmitter.active) {
        burstEmitter.destroy();
      }
    });

    const ring = scene.add
      .circle(topPoint.x, topPoint.y, Math.max(6, 10 * scene.gameScale), 0xfff1b3, 0.45)
      .setStrokeStyle(Math.max(2, 4 * scene.gameScale), 0xffde86, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1795);
    scene.tweens.add({
      targets: ring,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        ring.destroy();
      }
    });
    scene.cameras.main.shake(90, 0.0018);
  }

  /**
   * 超级爆发特效：满格后的烟花喷射粒子特效
   */
  private triggerSuperVolumeBurst(): void {
    const scene = this.scene;
    const now = performance.now();
    if (now < this.superBurstCooldownUntil) return;
    const topPoint = this.getBlindBoxVolumeTopWorldPoint();
    if (!topPoint) return;
    this.superBurstCooldownUntil = now + VOLUME_SUPER_BURST_COOLDOWN_MS;

    // 多层烟花喷射 (受重力下落)
    const rainbowColors = [0xff3344, 0xff8800, 0xffdd00, 0x00e896, 0x00c8ff, 0x2a6bff, 0xeb42f4];
    const sparkKey = scene.textures.exists('round1_volume_spark') ? 'round1_volume_spark' : 'particle_sparkle';
    rainbowColors.forEach((tint, idx) => {
      const burstEmitter = scene.add.particles(0, 0, sparkKey, {
        speed: { min: 400, max: 900 }, // 喷射速度加倍
        angle: { min: 210, max: 330 }, // 扇形向上喷射
        gravityY: 1200,                // 强烈的重力让粒子呈抛物线下落 (烟花效果)
        scale: { start: Phaser.Math.Linear(0.6, 1.4, idx / 6), end: 0 },
        alpha: { start: 1, end: 0 },
        tint: tint,
        lifespan: { min: 1000, max: 2200 },
        quantity: 15,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false
      }).setDepth(1800);
      burstEmitter.explode(12 + idx * 2, topPoint.x, topPoint.y);
      scene.time.delayedCall(2500, () => {
        if (burstEmitter.active) burstEmitter.destroy();
      });
    });

    // 烟花爆炸中心的强光核心
    const coreFlash = scene.add
      .circle(topPoint.x, topPoint.y, Math.max(20, 30 * scene.gameScale), 0xffffff, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1799);
    scene.tweens.add({
      targets: coreFlash,
      scaleX: 6,
      scaleY: 6,
      alpha: 0,
      duration: 600,
      ease: 'Cubic.easeOut',
      onComplete: () => coreFlash.destroy()
    });

    // 巨大烟花冲击波 (光圈扩散)
    const shockwave = scene.add
      .circle(topPoint.x, topPoint.y, Math.max(15, 25 * scene.gameScale), 0xffaa00, 0)
      .setStrokeStyle(Math.max(6, 12 * scene.gameScale), 0xffaa00, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1796);
    scene.tweens.add({
      targets: shockwave,
      scaleX: 15,
      scaleY: 15,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => shockwave.destroy()
    });

    // 全屏白光亮斑 (闪屏效果更长)
    const viewport = scene.getCurrentViewportSize();
    const screenFlash = scene.add
      .rectangle(viewport.width * 0.5, viewport.height * 0.5, viewport.width, viewport.height, 0xffffff, 0.25)
      .setDepth(1850)
      .setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: screenFlash,
      alpha: 0,
      duration: 500,
      ease: 'Sine.easeOut',
      onComplete: () => screenFlash.destroy()
    });

    // 强烈屏幕抖动增强打击感
    scene.cameras.main.shake(180, 0.005);
  }

  private setBlindBoxVolumeLevel(currentLevelRaw: number): void {
    const scene = this.scene;
    const now = performance.now();
    const deltaSeconds = scene.blindBoxVolumeLastUpdateAt > 0
      ? Math.max(0.001, (now - scene.blindBoxVolumeLastUpdateAt) / 1000)
      : (1 / 60);
    const sampledLevel = Phaser.Math.Clamp(currentLevelRaw, 0, 1);
    const previousLevel = Phaser.Math.Clamp(scene.blindBoxVolumeCurrentLevel, 0, 1);
    if (sampledLevel <= VOLUME_SILENCE_CUTOFF) {
      if (previousLevel >= VOLUME_MAX_HOLD_TRIGGER && now < this.volumeBarMaxHoldUntil) {
        scene.blindBoxVolumeCurrentLevel = previousLevel;
      } else {
        const decayPerSecond = previousLevel >= 0.9
          ? VOLUME_MAX_DECAY_PER_SECOND
          : (previousLevel >= 0.55 ? 0.048 : 0.096);
        const decayed = Math.max(0, previousLevel - decayPerSecond * deltaSeconds);
        scene.blindBoxVolumeCurrentLevel = decayed < 0.008 ? 0 : decayed;
      }
    } else {
      const canStartRising = !(previousLevel <= 0.0001 && sampledLevel < VOLUME_RISE_ENTRY_THRESHOLD);
      if (canStartRising && sampledLevel > previousLevel) {
        const riseAlpha = sampledLevel - previousLevel > 0.2 ? 0.85 : 0.6;
        scene.blindBoxVolumeCurrentLevel = Phaser.Math.Clamp(
          Phaser.Math.Linear(previousLevel, sampledLevel, riseAlpha),
          previousLevel,
          1
        );
      } else {
        // 如果处于满格保持期，且之前的电平足够高，即使当前采样声音变小也不下降
        if (previousLevel >= VOLUME_MAX_HOLD_TRIGGER && now < this.volumeBarMaxHoldUntil) {
          scene.blindBoxVolumeCurrentLevel = previousLevel;
        } else {
          const settleAlpha = sampledLevel < previousLevel ? 0.018 : 0.08;
          scene.blindBoxVolumeCurrentLevel = Phaser.Math.Clamp(
            Phaser.Math.Linear(previousLevel, sampledLevel, settleAlpha),
            0,
            1
          );
        }
      }
    }

    const displayLevel = scene.blindBoxVolumeCurrentLevel;
    if (displayLevel >= VOLUME_MAX_HOLD_TRIGGER) {
      this.volumeBarMaxHoldUntil = now + VOLUME_MAX_HOLD_MS;
    }
    if (displayLevel >= scene.blindBoxVolumePeakLevel) {
      scene.blindBoxVolumePeakLevel = displayLevel;
      scene.blindBoxVolumePeakHoldUntil = now + VOLUME_PEAK_HOLD_MS;
    } else if (now > scene.blindBoxVolumePeakHoldUntil) {
      const decayedPeak = scene.blindBoxVolumePeakLevel - VOLUME_PEAK_DECAY_PER_SECOND * deltaSeconds;
      scene.blindBoxVolumePeakLevel = Phaser.Math.Clamp(Math.max(displayLevel, decayedPeak), 0, 1);
    }
    scene.blindBoxVolumeLastUpdateAt = now;

    if (previousLevel < VOLUME_GLOW_THRESHOLD && displayLevel >= VOLUME_GLOW_THRESHOLD) {
      const heatLevel = Phaser.Math.Clamp((displayLevel - VOLUME_GLOW_THRESHOLD) / (1 - VOLUME_GLOW_THRESHOLD), 0, 1);
      this.triggerBlindBoxVolumeGlowIgnition(heatLevel);
    }

    this.redrawBlindBoxVolumeMeter(displayLevel);
    const visibleLevel = this.blindBoxVolumeDisplayLevel;
    if (displayLevel >= VOLUME_FULL_THRESHOLD && visibleLevel >= VOLUME_BURST_VISIBLE_THRESHOLD) {
      this.triggerBlindBoxVolumeBurst();
    }
    if (displayLevel >= VOLUME_SUPER_BURST_THRESHOLD && previousLevel < VOLUME_SUPER_BURST_THRESHOLD) {
      this.triggerSuperVolumeBurst();
    }
    this.setPronunciationHudVolumeLevel(displayLevel);
  }

  private updateBlindBoxVolumeMeterPosition(): void {
    const scene = this.scene;
    if (!scene.blindBoxVolumeContainer || !scene.blindBoxVolumeContainer.active) return;
    const shouldShowVolume = (
      scene.isPronunciationFlowEnabled() &&
      (scene.pronunciationHudMicVisible || scene.pronunciationHudVolumeLevel > 0.01)
    );
    if (!shouldShowVolume) {
      scene.blindBoxVolumeContainer.setVisible(false);
      this.blindBoxVolumeShakeOffsetX = 0;
      this.blindBoxVolumeShakeOffsetY = 0;
      if (scene.blindBoxVolumeSparkEmitter?.active) {
        scene.blindBoxVolumeSparkEmitter.stop();
        scene.blindBoxVolumeSparkEmitter.killAll();
      }
      return;
    }

    const viewport = scene.getCurrentViewportSize();
    const meterWidthRaw = scene.blindBoxVolumeContainer.getData('meterWidth');
    const meterWidth = typeof meterWidthRaw === 'number' && Number.isFinite(meterWidthRaw) ? meterWidthRaw : 72;
    const rightMargin = Phaser.Math.Clamp(22 * scene.gameScale, 12, 28);
    this.blindBoxVolumeBaseX = viewport.width - rightMargin - meterWidth * 0.5;
    this.blindBoxVolumeBaseY = viewport.height * 0.5;
    scene.blindBoxVolumeContainer
      .setVisible(true)
      .setAlpha(0.98);
    this.applyBlindBoxVolumeContainerTransform();
  }

  private destroyBlindBoxVolumeMeter(): void {
    const scene = this.scene;
    if (scene.blindBoxVolumeSparkEmitter) {
      scene.blindBoxVolumeSparkEmitter.stop();
      scene.blindBoxVolumeSparkEmitter.killAll();
      scene.blindBoxVolumeSparkEmitter.destroy();
      scene.blindBoxVolumeSparkEmitter = null;
    }
    this.blindBoxVolumeBloomFx = null;
    if (scene.blindBoxVolumeFillGraphics) {
      scene.blindBoxVolumeFillGraphics.clear();
      scene.blindBoxVolumeFillGraphics.clearMask(false);
    }
    if (scene.blindBoxVolumeFillImage) {
      scene.blindBoxVolumeFillImage.clearMask(false);
    }
    if (scene.blindBoxVolumePeakLine) {
      scene.blindBoxVolumePeakLine.clearMask(false);
    }
    if (scene.blindBoxVolumeFillMask) {
      scene.blindBoxVolumeFillMask.destroy();
      scene.blindBoxVolumeFillMask = null;
    }
    if (scene.blindBoxVolumeContainer) {
      scene.blindBoxVolumeContainer.destroy();
      scene.blindBoxVolumeContainer = null;
    }
    if (scene.blindBoxVolumeMaskGraphics) {
      scene.blindBoxVolumeMaskGraphics.destroy();
    }
    scene.blindBoxVolumeFrameImage = null;
    scene.blindBoxVolumeFillImage = null;
    scene.blindBoxVolumeFillGraphics = null;
    scene.blindBoxVolumeMaskGraphics = null;
    scene.blindBoxVolumePeakLine = null;
    scene.blindBoxVolumeHeatGlow = null;
    scene.blindBoxVolumeValueText = null;
    scene.blindBoxVolumeInnerRect = null;
    scene.blindBoxVolumeLevelStage = -1;
    scene.blindBoxVolumeCurrentLevel = 0;
    scene.blindBoxVolumePeakLevel = 0;
    scene.blindBoxVolumePeakHoldUntil = 0;
    scene.blindBoxVolumeLastUpdateAt = 0;
    scene.blindBoxVolumeBurstCooldownUntil = 0;
    this.blindBoxVolumeDisplayLevel = 0;
    this.blindBoxVolumeDisplayPercent = -1;
    this.blindBoxVolumeBaseX = 0;
    this.blindBoxVolumeBaseY = 0;
    this.blindBoxVolumeShakeOffsetX = 0;
    this.blindBoxVolumeShakeOffsetY = 0;
    this.volumeMeterShakeCooldownUntil = 0;
    this.volumeBarMaxHoldUntil = 0;
    this.volumeGlowBurstCooldownUntil = 0;
    scene.volumeMonitorStartAt = 0;
    scene.volumeMonitorNoiseFloor = 0.015;
    scene.volumeMonitorReferenceLevel = 0.045;
    scene.blindBoxCurrentVolumePeak = 0;
    scene.volumeMonitorDetectedSignal = false;
    this.setPronunciationHudVolumeLevel(0, true);
  }

  private stopVolumeMonitor(): void {
    const scene = this.scene;
    this.stopMicCountdown();
    if (scene.volumeMonitorFrameId !== null) {
      window.cancelAnimationFrame(scene.volumeMonitorFrameId);
      scene.volumeMonitorFrameId = null;
    }
    if (scene.volumeMonitorLowPass) {
      try {
        scene.volumeMonitorLowPass.disconnect();
      } catch (error) {
        console.warn('[Pronounce] Failed to disconnect low-pass filter:', error);
      }
      scene.volumeMonitorLowPass = null;
    }
    if (scene.volumeMonitorHighPass) {
      try {
        scene.volumeMonitorHighPass.disconnect();
      } catch (error) {
        console.warn('[Pronounce] Failed to disconnect high-pass filter:', error);
      }
      scene.volumeMonitorHighPass = null;
    }
    if (scene.volumeMonitorPeakingEq) {
      try {
        scene.volumeMonitorPeakingEq.disconnect();
      } catch (error) {
        console.warn('[Pronounce] Failed to disconnect peaking EQ filter:', error);
      }
      scene.volumeMonitorPeakingEq = null;
    }
    if (scene.volumeMonitorSource) {
      try {
        scene.volumeMonitorSource.disconnect();
      } catch (error) {
        console.warn('[Pronounce] Failed to disconnect volume monitor source:', error);
      }
      scene.volumeMonitorSource = null;
    }
    if (scene.volumeMonitorStream) {
      scene.volumeMonitorStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      scene.volumeMonitorStream = null;
    }
    if (scene.volumeMonitorAudioContext) {
      void scene.volumeMonitorAudioContext.close().catch((error: unknown) => {
        console.warn('[Pronounce] Failed to close volume monitor audio context:', error);
      });
      scene.volumeMonitorAudioContext = null;
    }
    scene.volumeMonitorAnalyser = null;
    scene.volumeMonitorDataArray = null;
    scene.volumeMonitorLastSampleAt = 0;
    scene.volumeMonitorStartAt = 0;
    scene.volumeMonitorNoiseFloor = 0.015;
    scene.volumeMonitorReferenceLevel = 0.045;
    scene.blindBoxVolumeCurrentLevel = 0;
    scene.blindBoxVolumePeakLevel = 0;
    scene.blindBoxVolumePeakHoldUntil = 0;
    scene.volumeMonitorDetectedSignal = false;
    this.blindBoxVolumeDisplayLevel = 0;
    this.blindBoxVolumeShakeOffsetX = 0;
    this.blindBoxVolumeShakeOffsetY = 0;
    this.volumeMeterShakeCooldownUntil = 0;
    this.volumeBarMaxHoldUntil = 0;
    this.volumeGlowBurstCooldownUntil = 0;
    this.setBlindBoxVolumeLevel(0);
    this.setPronunciationHudVolumeLevel(0, true);
    this.setPronunciationHudCountdownSeconds(0, true);
  }

  private async startVolumeMonitor(onCountdownComplete?: () => void): Promise<boolean> {
    const scene = this.scene;
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    this.stopVolumeMonitor();
    this.ensureBlindBoxVolumeMeter();
    this.updateBlindBoxVolumeMeterPosition();
    scene.blindBoxCurrentVolumePeak = 0;
    scene.volumeMonitorDetectedSignal = false;
    scene.blindBoxVolumeCurrentLevel = 0;
    scene.blindBoxVolumePeakLevel = 0;
    scene.blindBoxVolumePeakHoldUntil = 0;
    scene.blindBoxVolumeLastUpdateAt = performance.now();
    scene.blindBoxVolumeLevelStage = -1;
    this.setBlindBoxVolumeLevel(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      scene.volumeMonitorStream = stream;
      const audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      scene.volumeMonitorAudioContext = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = scene.BLIND_BOX_VOLUME_MONITOR_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.12;
      scene.volumeMonitorAnalyser = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      scene.volumeMonitorSource = source;
      const highPass = audioContext.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 200;
      highPass.Q.value = 0.8;
      scene.volumeMonitorHighPass = highPass;
      // Peaking EQ 增强人声核心频段 (1.5kHz)，抑制环境噪音
      const peakingEq = audioContext.createBiquadFilter();
      peakingEq.type = 'peaking';
      peakingEq.frequency.value = 1500;
      peakingEq.Q.value = 1.2;
      peakingEq.gain.value = 4;
      scene.volumeMonitorPeakingEq = peakingEq;
      const lowPass = audioContext.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 3000;
      lowPass.Q.value = 0.8;
      scene.volumeMonitorLowPass = lowPass;
      source.connect(highPass);
      highPass.connect(peakingEq);
      peakingEq.connect(lowPass);
      lowPass.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      scene.volumeMonitorDataArray = dataArray;
      scene.volumeMonitorLastSampleAt = performance.now();
      scene.volumeMonitorStartAt = scene.volumeMonitorLastSampleAt;
      scene.volumeMonitorNoiseFloor = 0.015;
      scene.volumeMonitorReferenceLevel = 0.045;
      this.playRecordingStartSfx();
      this.startMicCountdown(scene.PRONUNCIATION_RECORDING_TIMEOUT_MS, onCountdownComplete);

      const tick = (): void => {
        if (!scene.volumeMonitorAnalyser || !scene.volumeMonitorDataArray) return;
        scene.volumeMonitorAnalyser.getByteTimeDomainData(scene.volumeMonitorDataArray);

        const now = performance.now();
        scene.volumeMonitorLastSampleAt = now;

        let sumSquares = 0;
        let sumAbs = 0;
        for (let i = 0; i < scene.volumeMonitorDataArray.length; i += 1) {
          const normalized = (scene.volumeMonitorDataArray[i] - 128) / 128;
          sumSquares += normalized * normalized;
          sumAbs += Math.abs(normalized);
        }
        const rms = Math.sqrt(sumSquares / scene.volumeMonitorDataArray.length);
        const meanAbs = sumAbs / scene.volumeMonitorDataArray.length;

        const rawLevel = Math.max(rms * 1.2, meanAbs * 1.8);
        const elapsedMs = now - scene.volumeMonitorStartAt;
        const floorLerp = rawLevel <= scene.volumeMonitorNoiseFloor + 0.008 ? 0.12 : 0.02;
        scene.volumeMonitorNoiseFloor = Phaser.Math.Linear(
          scene.volumeMonitorNoiseFloor,
          Phaser.Math.Clamp(rawLevel, 0, 0.08),
          floorLerp
        );
        const noiseGate = scene.volumeMonitorNoiseFloor + 0.0015;
        const signal = Math.max(0, rawLevel - noiseGate);
        const dynamicSignalGate = Phaser.Math.Clamp(
          scene.volumeMonitorNoiseFloor * 1.4 + 0.005,
          0.008,
          0.035
        );
        const gateWindow = Math.max(0.0024, dynamicSignalGate * 2);
        const gateMix = Phaser.Math.Clamp(
          (signal - dynamicSignalGate * 0.46) / gateWindow,
          0,
          1
        );
        const gatedSignal = signal * gateMix;
        const isCalibrating = elapsedMs < VOLUME_STARTUP_CALIBRATION_MS;
        scene.volumeMonitorReferenceLevel = Math.max(
          gatedSignal,
          Phaser.Math.Linear(
            scene.volumeMonitorReferenceLevel,
            gatedSignal,
            gatedSignal > scene.volumeMonitorReferenceLevel ? 0.18 : 0.02
          )
        );
        const reference = Phaser.Math.Clamp(
          Math.max(scene.volumeMonitorReferenceLevel, dynamicSignalGate * 1.4),
          0.012,
          0.18
        );
        const normalizedSignal = Phaser.Math.Clamp(
          (gatedSignal / (reference * 0.82)) * scene.volumeMonitorSensitivityBoost,
          0,
          1.4
        );
        const softNormalized = Phaser.Math.Clamp(normalizedSignal / 1.15, 0, 1);
        const mapped = Phaser.Math.Clamp(Math.pow(softNormalized, 0.72), 0, 1);
        const normalizedLevel = isCalibrating || gatedSignal <= 0.003 || mapped < VOLUME_SILENCE_CUTOFF ? 0 : mapped;
        scene.blindBoxCurrentVolumePeak = Math.max(scene.blindBoxCurrentVolumePeak, normalizedLevel);
        if (normalizedLevel >= VOLUME_SILENCE_CUTOFF) {
          scene.volumeMonitorDetectedSignal = true;
        }
        this.setBlindBoxVolumeLevel(normalizedLevel);
        scene.volumeMonitorFrameId = window.requestAnimationFrame(tick);
      };
      scene.volumeMonitorFrameId = window.requestAnimationFrame(tick);
      return true;
    } catch (error) {
      console.warn('[Pronounce] Volume monitor unavailable:', error);
      this.stopVolumeMonitor();
      return false;
    }
  }

  private playRecordingStartSfx(): void {
    const scene = this.scene;
    if (!scene.cache.audio.exists(RECORDING_START_SFX_KEY)) {
      return;
    }
    try {
      const played = scene.sound.play(RECORDING_START_SFX_KEY, { volume: RECORDING_START_SFX_VOLUME });
      if (!played) {
        console.warn('[Pronounce] Recording start cue did not play.');
      }
    } catch (error) {
      console.warn('[Pronounce] Recording start cue playback failed:', error);
    }
  }

  private getTextSimilarity(
    targetText: string,
    transcript: string,
    reason: PronunciationRoundResult['reason']
  ): number {
    if (reason !== 'ok' || transcript.trim().length === 0) {
      return 0;
    }
    const textScore = scorePronunciation(targetText, transcript);
    return Phaser.Math.Clamp(textScore / 100, 0, 1);
  }

  private getPronunciationAverageConfidence(): number {
    const scene = this.scene;
    if (scene.pronunciationResults.length === 0) return 0;
    const sum = scene.pronunciationResults.reduce((acc, item) => acc + item.confidence, 0);
    return Math.round((sum / scene.pronunciationResults.length) * 100);
  }

  private waitForDelay(delayMs: number): Promise<void> {
    if (!this.isSceneActiveSafe()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      try {
        this.scene.time.delayedCall(delayMs, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  private isActiveRoundToken(roundToken: number): boolean {
    return this.isSceneActiveSafe() && roundToken === this.scene.blindBoxRoundToken;
  }

  private isSceneActiveSafe(): boolean {
    const scenePlugin = this.scene.scene as Phaser.Scenes.ScenePlugin | undefined;
    if (!scenePlugin || typeof scenePlugin.isActive !== 'function') {
      return false;
    }
    try {
      return scenePlugin.isActive();
    } catch {
      return false;
    }
  }

  private getConfidenceFeedbackBadgeKey(level: PronunciationConfidenceLevel): string {
    if (level === 'HIGH') return 'reward_excellent';
    if (level === 'MEDIUM') return 'reward_great';
    return 'reward_try_again';
  }

  private getConfidenceFeedbackTrailTint(level: PronunciationConfidenceLevel): [number, number, number] {
    if (level === 'HIGH') return [0x6BFF6B, 0xFFD700, 0xFFF7A8];
    if (level === 'MEDIUM') return [0xFFD700, 0xFFA500, 0xFF6A00];
    return [0xFF7A7A, 0xFF5252, 0xFFA500];
  }

  private playBlindBoxFeedbackBadge(level: PronunciationConfidenceLevel): Promise<void> {
    const scene = this.scene;
    const badgeTextureKey = this.getConfidenceFeedbackBadgeKey(level);
    if (!scene.textures.exists(badgeTextureKey)) {
      console.warn('[Round1] Feedback badge texture missing:', badgeTextureKey);
      return Promise.resolve();
    }

    const viewport = scene.getCurrentViewportSize();
    const startX = scene.blindBoxRevealImage?.x ?? viewport.width * 0.5;
    const startY = scene.blindBoxRevealImage?.y ?? viewport.height * 0.54;
    const rewardItem = scene.add.image(startX, startY, badgeTextureKey).setDepth(2600);
    const badgeWidth = Phaser.Math.Clamp(
      Math.min(
        viewport.width * ROUND1_FEEDBACK_BADGE_VIEWPORT_WIDTH_RATIO,
        viewport.height * ROUND1_FEEDBACK_BADGE_VIEWPORT_HEIGHT_RATIO
      ),
      ROUND1_FEEDBACK_BADGE_MIN_DISPLAY_WIDTH,
      ROUND1_FEEDBACK_BADGE_MAX_DISPLAY_WIDTH
    );
    const badgeRatio = Phaser.Math.Clamp(scene.getTextureAspectRatio(badgeTextureKey), 1.6, 4.6);
    rewardItem.setDisplaySize(badgeWidth, badgeWidth / badgeRatio);
    const rewardBaseScaleX = rewardItem.scaleX;
    const rewardBaseScaleY = rewardItem.scaleY;
    const applyRewardScaleFactor = (scaleFactor: number): void => {
      rewardItem.setScale(rewardBaseScaleX * scaleFactor, rewardBaseScaleY * scaleFactor);
    };

    const rewardTrailEmitter = scene.getRewardTrailEmitter();
    const trailTint = this.getConfidenceFeedbackTrailTint(level);
    const originalTrailDepth = rewardTrailEmitter ? rewardTrailEmitter.depth : 0;
    const stopTrail = (): void => {
      if (!rewardTrailEmitter) return;
      rewardTrailEmitter.stop();
      rewardTrailEmitter.stopFollow();
      rewardTrailEmitter.setDepth(originalTrailDepth);
    };

    return new Promise((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (rewardItem.active) {
          rewardItem.destroy();
        }
        stopTrail();
        resolve();
      };

      if (rewardTrailEmitter) {
        rewardTrailEmitter.stop();
        rewardTrailEmitter.stopFollow();
        rewardTrailEmitter.setParticleTint(trailTint[0]);
        rewardTrailEmitter.setDepth(rewardItem.depth - 1);
      }

      const launchHeight = 80;
      const launchScaleFactor = level === 'LOW' ? 1.28 : 1.6;
      const waitTime = level === 'LOW' ? 1280 : 2000;
      const flightDuration = level === 'LOW' ? 0 : 1250;

      rewardItem.setY(startY - launchHeight * scene.gameScale);
      applyRewardScaleFactor(launchScaleFactor);
      rewardItem.setAlpha(1);

      scene.time.delayedCall(waitTime, () => {
        if (!rewardItem.active) {
          settle();
          return;
        }

        if (level === 'LOW') {
          scene.tweens.add({
            targets: rewardItem,
            alpha: 0,
            scaleX: rewardBaseScaleX * launchScaleFactor * 1.03,
            scaleY: rewardBaseScaleY * launchScaleFactor * 1.03,
            duration: 280,
            ease: 'Sine.easeOut',
            onComplete: () => {
              settle();
            }
          });
          return;
        }

        if (rewardTrailEmitter) {
          rewardTrailEmitter.startFollow(rewardItem);
          rewardTrailEmitter.start();
          rewardTrailEmitter.setFrequency(12);
        }

        const { x: targetX, y: targetY } = scene.getScoreHudTargetPoint();
        const startPosX = rewardItem.x;
        const startPosY = rewardItem.y;
        const controlXOffset = Phaser.Math.Clamp((startPosX - targetX) * 0.22, -220 * scene.gameScale, 220 * scene.gameScale);
        const controlX = (startPosX + targetX) / 2 + controlXOffset;
        const controlY = Math.min(startPosY, targetY) - (level === 'LOW' ? 180 : 190) * scene.gameScale;
        const flightCurve = new Phaser.Curves.QuadraticBezier(
          new Phaser.Math.Vector2(startPosX, startPosY),
          new Phaser.Math.Vector2(controlX, controlY),
          new Phaser.Math.Vector2(targetX, targetY)
        );

        scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: flightDuration,
          ease: 'Sine.easeInOut',
          onUpdate: (tween) => {
            if (!rewardItem.active) return;
            const progress = tween.getValue();
            const point = flightCurve.getPoint(progress);
            rewardItem.setPosition(point.x, point.y);
            applyRewardScaleFactor(Phaser.Math.Linear(launchScaleFactor, 0.38, progress));
            rewardItem.setAlpha(Phaser.Math.Linear(1, 0.45, progress));
            rewardItem.setAngle(Phaser.Math.Linear(0, 540, progress));
          },
          onComplete: () => {
            settle();
          }
        });
      });
    });
  }

  private playConfidenceFeedbackVoice(level: PronunciationConfidenceLevel): void {
    const scene = this.scene;
    const voiceKey = level === 'HIGH' ? 'voice_excellent' : level === 'MEDIUM' ? 'voice_great' : 'voice_try_again';
    if (!voiceKey || !scene.cache.audio.exists(voiceKey)) return;
    try {
      const sound = scene.sound.add(voiceKey, { volume: 0.5 });
      sound.once('complete', () => sound.destroy());
      const played = sound.play();
      if (!played) {
        sound.destroy();
      }
    } catch (error) {
      console.warn('[Pronounce] Confidence voice playback failed:', error);
    }
  }

  private removeBlindBoxQuestionFromRemaining(selected: ThemeQuestion): void {
    const scene = this.scene;
    const index = scene.blindBoxRemainingQuestions.findIndex((questionItem: ThemeQuestion) => (
      questionItem === selected ||
      (
        questionItem.question === selected.question &&
        questionItem.image === selected.image &&
        questionItem.audio === selected.audio
      )
    ));
    if (index >= 0) {
      scene.blindBoxRemainingQuestions.splice(index, 1);
    }
  }

  private async speakWithSpeechSynthesis(text: string): Promise<void> {
    if (
      typeof window === 'undefined' ||
      typeof window.speechSynthesis === 'undefined' ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1;
      let resolved = false;
      const finish = (): void => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      utterance.onend = () => finish();
      utterance.onerror = () => finish();
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        window.setTimeout(finish, 5000);
      } catch (error) {
        console.warn('[Pronounce] speechSynthesis fallback failed:', error);
        finish();
      }
    });
  }

  private async playQuestionAudioByItem(questionItem: ThemeQuestion): Promise<void> {
    const scene = this.scene;
    const audioKey = scene.getAudioCacheKey(questionItem, scene.currentTheme);
    if (window.setBGMVolume) {
      window.setBGMVolume(0);
    }

    if (audioKey && scene.cache.audio.exists(audioKey)) {
      scene.stopPronunciationSound(false);
      await new Promise<void>((resolve) => {
        try {
          const sound = scene.sound.add(audioKey);
          scene.pronunciationSound = sound;

          const finalize = (): void => {
            if (scene.pronunciationSound === sound) {
              scene.pronunciationSound = null;
            }
            sound.destroy();
            resolve();
          };

          sound.once('complete', finalize);
          sound.once('destroy', () => {
            if (scene.pronunciationSound === sound) {
              scene.pronunciationSound = null;
            }
          });

          const played = sound.play({ volume: scene.PRONUNCIATION_VOLUME });
          if (!played) {
            finalize();
          }
        } catch (error) {
          console.warn('[Pronounce] Failed to play question audio, fallback to speech synthesis.', error);
          resolve();
        }
      });
      window.restoreBGMVolume?.();
      return;
    }

    console.warn(`[Pronounce] Audio missing for "${questionItem.question}", using speech synthesis fallback.`);
    await this.speakWithSpeechSynthesis(questionItem.question);
    window.restoreBGMVolume?.();
  }

  private async recognizeWithStableWindow(
    maxDurationMs: number,
    inputStream: MediaStream | null
  ): Promise<RecognizeOnceResult> {
    const scene = this.scene;
    const startedAt = performance.now();
    let retryCount = 0;
    let lastResult: RecognizeOnceResult = {
      transcript: '',
      confidence: 0,
      reason: 'timeout',
      durationMs: 0
    };

    while (this.isSceneActiveSafe()) {
      const elapsedMs = performance.now() - startedAt;
      const remainingMs = Math.max(0, maxDurationMs - elapsedMs);
      if (remainingMs <= 280) {
        return {
          ...lastResult,
          reason: lastResult.transcript.trim() ? 'ok' : 'timeout',
          durationMs: Math.max(0, Math.round(performance.now() - startedAt))
        };
      }

      const attempt = await speechScoringService.recognizeOnce({
        lang: 'en-US',
        maxDurationMs: Math.max(600, remainingMs),
        inputStream
      });
      lastResult = {
        ...attempt,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt))
      };

      if (lastResult.transcript.trim()) {
        return lastResult;
      }

      if (attempt.reason === 'unsupported') {
        return lastResult;
      }

      const remainingAfterAttemptMs = Math.max(0, maxDurationMs - (performance.now() - startedAt));
      if (shouldRetryRecognitionAttempt({
        reason: attempt.reason,
        transcript: attempt.transcript,
        retryCount,
        remainingMs: remainingAfterAttemptMs
      })) {
        retryCount += 1;
        console.warn('[Pronounce] Retrying recognition after transient early failure.', {
          reason: attempt.reason,
          retryCount,
          remainingAfterAttemptMs
        });
        await this.waitForDelay(140);
        continue;
      }

      if (attempt.reason === 'error' || attempt.reason === 'aborted') {
        return lastResult;
      }

      await this.waitForDelay(80);
    }

    return {
      ...lastResult,
      reason: lastResult.transcript.trim() ? 'ok' : 'aborted',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt))
    };
  }

  private collapseBlindBoxCardVisuals(selectedBlock: BlindBoxCollisionBlock): void {
    const scene = this.scene;
    const blocks = scene.blocks;
    const blockChildren = blocks?.children;
    if (!blocks || !blockChildren || typeof blockChildren.iterate !== 'function') {
      return;
    }
    blockChildren.iterate((rawBlock) => {
      const block = rawBlock as
        | (Phaser.GameObjects.GameObject & {
          active: boolean;
          body?: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;
          getData(key: string): unknown;
          setData(key: string, value: unknown): void;
        })
        | undefined;
      if (!block || !block.active || !block.getData('blindBox')) return true;
      block.setData('blindBoxResolved', true);
      block.setData('isCleaningUp', true);
      if (block.body) {
        block.body.enable = false;
      }
      const visuals = block.getData('visuals') as Phaser.GameObjects.Container | undefined;
      if (!visuals || !visuals.active) return true;
      scene.tweens.killTweensOf(visuals);
      const isSelected = block === selectedBlock;
      scene.tweens.add({
        targets: visuals,
        alpha: 0,
        scaleX: isSelected ? 1.14 : 0.88,
        scaleY: isSelected ? 1.14 : 0.88,
        angle: Phaser.Math.Between(-14, 14),
        duration: isSelected ? 220 : 190,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          scene.destroyBlockVisual(visuals);
          block.setData('visuals', undefined);
        }
      });
      return true;
    });
  }

  private playBlindBoxRevealEffect(block: BlindBoxCollisionBlock, questionItem: ThemeQuestion): void {
    const scene = this.scene;
    const selectedTexture = scene.getImageTextureKey(questionItem, scene.currentTheme);
    const textureToUse = scene.textures.exists(selectedTexture) ? selectedTexture : 'tile_box';
    const selectedRatio = scene.getTextureAspectRatio(textureToUse);
    scene.blindBoxRevealImageRatio = selectedRatio;

    if (block.getData('blindBoxRevealed')) {
      return;
    }
    block.setData('blindBoxRevealed', true);

    this.setBlindBoxPlayerVisible(false);
    this.collapseBlindBoxCardVisuals(block);

    const flash = scene.add
      .circle(block.x, block.y, Math.max(40, block.displayWidth * 0.24), 0xffffff, 0.9)
      .setDepth(1200);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 260,
      ease: 'Sine.easeOut',
      onComplete: () => flash.destroy()
    });
    scene.blockFlashEmitter.explode(24, block.x, block.y);
    scene.blockDebrisEmitter.explode(26, block.x, block.y);

    this.destroyBlindBoxRevealVisuals();
    const viewport = scene.getCurrentViewportSize();
    const revealLayout = this.getBlindBoxRevealLayout(viewport.width, viewport.height, selectedRatio);
    this.setPronunciationHudMicAnchor(
      revealLayout.centerX / Math.max(1, viewport.width),
      (revealLayout.centerY + revealLayout.height * 0.5 + Phaser.Math.Clamp(3 * scene.gameScale, 2, 6)) / Math.max(1, viewport.height),
      true
    );
    const startRevealWidth = revealLayout.width * 0.26;
    const startRevealHeight = revealLayout.height * 0.26;
    scene.time.delayedCall(300, () => {
      if (!this.isSceneActiveSafe()) return;
      const revealAura = scene.add
        .circle(
          revealLayout.centerX,
          revealLayout.centerY,
          Math.max(52 * scene.gameScale, revealLayout.width * 0.2),
          0xffed99,
          0.66
        )
        .setDepth(1210);
      scene.tweens.add({
        targets: revealAura,
        alpha: 0,
        scaleX: 2.9,
        scaleY: 2.9,
        duration: 560,
        ease: 'Sine.easeOut',
        onComplete: () => revealAura.destroy()
      });
      const revealAura2 = scene.add
        .circle(
          revealLayout.centerX,
          revealLayout.centerY,
          Math.max(40 * scene.gameScale, revealLayout.width * 0.14),
          0xffffff,
          0.52
        )
        .setDepth(1211);
      scene.tweens.add({
        targets: revealAura2,
        alpha: 0,
        scaleX: 2.4,
        scaleY: 2.4,
        duration: 460,
        ease: 'Cubic.easeOut',
        onComplete: () => revealAura2.destroy()
      });

      scene.blindBoxRevealImage = scene.add
        .image(revealLayout.centerX, revealLayout.centerY, textureToUse)
        .setDisplaySize(startRevealWidth, startRevealHeight)
        .setDepth(1220)
        .setAngle(-120)
        .setAlpha(0);
      scene.tweens.add({
        targets: scene.blindBoxRevealImage,
        displayWidth: revealLayout.width * 1.08,
        displayHeight: revealLayout.height * 1.08,
        alpha: 1,
        angle: 10,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          if (!scene.blindBoxRevealImage || !scene.blindBoxRevealImage.active) return;
          scene.tweens.add({
            targets: scene.blindBoxRevealImage,
            displayWidth: revealLayout.width,
            displayHeight: revealLayout.height,
            angle: 0,
            duration: 260,
            ease: 'Sine.easeInOut',
            onComplete: () => {
              if (!scene.blindBoxRevealImage || !scene.blindBoxRevealImage.active) return;
              scene.updateBeeWord(questionItem.question);
              this.updateBlindBoxRevealVisualLayout();
            }
          });
        }
      });
    });
  }

  private playBlindBoxRevealFeedbackEffect(level: PronunciationConfidenceLevel): Promise<void> {
    const scene = this.scene;
    const revealImage = scene.blindBoxRevealImage;
    if (!revealImage || !revealImage.active || !revealImage.visible) {
      return Promise.resolve();
    }

    const baseWidth = revealImage.displayWidth;
    const baseHeight = revealImage.displayHeight;
    const flash = scene.add
      .circle(revealImage.x, revealImage.y, Math.max(42, baseWidth * 0.24), 0xfff2a5, 0.72)
      .setDepth(1230);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: 260,
      ease: 'Sine.easeOut',
      onComplete: () => {
        flash.destroy();
      }
    });

    return new Promise((resolve) => {
      scene.tweens.killTweensOf(revealImage);
      const fadeDuration = level === 'LOW' ? 180 : 240;
      scene.tweens.add({
        targets: revealImage,
        displayWidth: level === 'LOW' ? baseWidth : baseWidth * 1.06,
        displayHeight: level === 'LOW' ? baseHeight : baseHeight * 1.06,
        alpha: 0,
        angle: level === 'LOW' ? 0 : Phaser.Math.Between(-12, 12),
        duration: fadeDuration,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          revealImage.setVisible(false);
          revealImage.setAlpha(1);
          revealImage.setAngle(0);
          revealImage.setDisplaySize(baseWidth, baseHeight);
          resolve();
        }
      });
    });
  }

  private restoreBlindBoxRevealImageForRetry(): Promise<void> {
    const scene = this.scene;
    const revealImage = scene.blindBoxRevealImage;
    if (!revealImage || !revealImage.active) {
      return Promise.resolve();
    }
    if (revealImage.visible) {
      return Promise.resolve();
    }

    const baseWidth = revealImage.displayWidth;
    const baseHeight = revealImage.displayHeight;
    revealImage.setVisible(true);
    revealImage.setAlpha(0);
    revealImage.setDisplaySize(baseWidth * 0.9, baseHeight * 0.9);
    return new Promise((resolve) => {
      scene.tweens.add({
        targets: revealImage,
        alpha: 1,
        displayWidth: baseWidth,
        displayHeight: baseHeight,
        duration: 220,
        ease: 'Back.easeOut',
        onComplete: () => resolve()
      });
    });
  }
}
