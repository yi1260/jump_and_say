import Phaser from 'phaser';
import { pauseBackgroundPreloading, prioritizeThemeInQueue, resumeBackgroundPreloading } from '../../gameConfig';
import { motionController } from '../../services/motionController';
import { getLocalAssetUrl } from '../../src/config/r2Config';
import { QuestionData, Theme, ThemeId, ThemeList } from '../../types';

// --- CONFIGURATION ---

const C_GOLD = 0xFFD700;
const C_AMBER = 0xFFA500;
const C_WHITE = 0xFFFFFF;

const FONT_STACK = '"FredokaBoot", "FredokaLatin", "Fredoka", "ZCOOL KuaiLe UI", "ZCOOL KuaiLe", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif';

interface AnswerCardLayout {
  centerX: number;
  cardWidth: number;
  cardHeight: number;
  iconWidth: number;
  iconHeight: number;
  imageRatio: number;
}

export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private jumpBurstEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blockDebrisEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
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
  
  // Logic State
  private score: number = 0;
  private themeScore: number = 0; // 当前主题获得的分数
  private currentQuestion: QuestionData | null = null;
  private currentThemes: ThemeId[] = [];
  private currentThemeIndex: number = 0;
  private currentTheme: ThemeId = ''; 
  private themeData: Theme | null = null;
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
  
  private onScoreUpdate: ((score: number, total: number) => void) | null = null;
  private onGameOver: (() => void) | null = null;
  private onGameRestart: (() => void) | null = null;
  private onQuestionUpdate: ((q: string) => void) | null = null;
  private onBackgroundUpdate: ((index: number) => void) | null = null;
  
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
  private isInteractionActive: boolean = false;
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

  declare add: Phaser.GameObjects.GameObjectFactory;
  declare make: Phaser.GameObjects.GameObjectCreator;
  declare physics: Phaser.Physics.Arcade.ArcadePhysics;
  declare time: Phaser.Time.Clock;
  declare tweens: Phaser.Tweens.TweenManager;
  declare cameras: Phaser.Cameras.Scene2D.CameraManager;
  declare load: Phaser.Loader.LoaderPlugin;

  constructor() {
    super({ key: 'MainScene' });
  }

  private isCompressedLandscapeViewport(width: number, height: number): boolean {
    const viewportAspect = height / Math.max(width, 1);
    return width > height && viewportAspect < 0.72;
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

  init(data: {
    theme: ThemeId;
    dpr?: number;
  }) {
    const callbacks = this.registry.get('callbacks') || {};
    this.onScoreUpdate = callbacks.onScoreUpdate || null;
    this.onGameOver = callbacks.onGameOver || null;
    this.onGameRestart = callbacks.onGameRestart || null;
    this.onQuestionUpdate = callbacks.onQuestionUpdate || null;
    this.onBackgroundUpdate = callbacks.onBackgroundUpdate || null;

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
    this.questionCounter = 0;
    this.totalQuestions = 0;
    this.currentAnswerRatios = [];
    this.currentAnswerKeys = [];
    this.activeCardLayouts = [];
    this.currentThemeUsesPortraitFrames = true;
    this.pronunciationSound = null;
    this.clearResizeStabilizers();
    // Randomize background for each level/restart
    this.currentBgIndex = Phaser.Math.Between(0, 6);
    this.wrongAttempts = 0;

    // 每次初始化或重启场景时，重置 React 层的结算状态
    if (this.onGameRestart) {
      this.onGameRestart();
    }
    this.dpr = data.dpr || 1;
    this.lastQuestionWord = '';
    this.gameScale = this.scale?.height ? this.scale.height / 1080 : 1;
  }

  private initThemeDataFromCache() {
    const themeList = this.cache.json.get('themes_list');
    const themes = themeList?.themes || [];
    const theme = themes.find((t: Theme) => t.id === this.currentTheme);

    if (!theme) {
      // 降级方案：如果缓存中没有，尝试重新加载 (虽然理论上 PreloadScene 已经处理了)
      console.warn(`[MainScene] Theme ${this.currentTheme} not found in cache. Attempting fallback fetch...`);
      this.loadThemeDataFallback();
      return;
    }

    this.setupThemeData(theme);
  }

  private setupThemeData(theme: Theme) {
    this.themeData = theme;
    // Store raw question strings to preserve "The"
    this.themeWordPool = this.themeData.questions.map(q => q.question);
    this.totalQuestions = this.themeWordPool.length;
    Phaser.Utils.Array.Shuffle(this.themeWordPool);

    if (this.onScoreUpdate) this.onScoreUpdate(this.score, this.totalQuestions);
    
    // 如果之前因为没有数据而无法生成题目，现在尝试生成
    if (!this.currentQuestion) {
        this.time.delayedCall(100, () => this.spawnQuestion());
    }
  }

  private async loadThemeDataFallback() {
      try {
        // 动态引入避免循环依赖
        const { getThemesListFallbackUrl, getThemesListPrimaryUrl } = await import('@/src/config/r2Config');
        const fetchThemeList = async (url: string): Promise<ThemeList> => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as ThemeList;
          return data;
        };

        let themeList: ThemeList;
        try {
          themeList = await fetchThemeList(getThemesListPrimaryUrl());
        } catch (primaryError) {
          console.warn('[MainScene] CDN themes-list failed, falling back to local', primaryError);
          themeList = await fetchThemeList(getThemesListFallbackUrl());
        }
        // 更新缓存供后续使用
        this.cache.json.add('themes_list', themeList);
        
        // Flatten themes from all levels to find the target theme
        const allThemes = Object.values(themeList.levels).flatMap(l => l.themes);
        const theme = allThemes.find((t: Theme) => t.id === this.currentTheme);
        if (theme) {
            console.log(`[MainScene] Fallback load successful for ${this.currentTheme}`);
            this.setupThemeData(theme);
        } else {
            console.error(`[MainScene] Theme ${this.currentTheme} still not found after fallback`);
        }
      } catch (err) {
          console.error('[MainScene] Fallback load failed:', err);
      }
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

    return { x: target.x, y: target.y };
  }

  private dpr: number = 1;

  private toQuestionKey(questionText: string): string {
    return questionText.replace(/^[Tt]he\s+/i, '').replace(/\s+/g, '_').toUpperCase();
  }

  private getQuestionByAnswerKey(answerKey: string): Theme['questions'][number] | undefined {
    return this.themeData?.questions.find((questionItem: Theme['questions'][number]) => {
      return this.toQuestionKey(questionItem.question) === answerKey;
    });
  }

  private getImageTextureKeyByAnswer(answerKey: string): string {
    const questionItem = this.getQuestionByAnswerKey(answerKey);
    if (!questionItem) return '';
    return this.getImageTextureKey(questionItem, this.currentTheme);
  }

  private getImageTextureKey(questionItem: Theme['questions'][number], themeId: string): string {
    return `theme_${themeId}_${questionItem.image.replace(/\.(png|jpg|jpeg|webp)$/i, '')}`;
  }

  private getAudioCacheKey(questionItem: Theme['questions'][number], themeId: string): string {
    if (!questionItem.audio) return '';
    return `theme_audio_${themeId}_${questionItem.audio.replace(/\.(mp3|wav|ogg|m4a)$/i, '')}`;
  }

  private getQuestionByText(questionText: string): Theme['questions'][number] | undefined {
    const normalizedText = this.toQuestionKey(questionText);
    return this.themeData?.questions.find((questionItem: Theme['questions'][number]) => (
      this.toQuestionKey(questionItem.question) === normalizedText
    ));
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
    const frameAspectRatio = this.currentThemeUsesPortraitFrames
      ? this.CARD_FRAME_ASPECT_RATIO_PORTRAIT
      : this.CARD_FRAME_ASPECT_RATIO_LANDSCAPE;

    const sidePadding = Math.max(sceneWidth * this.CARD_SIDE_PADDING_RATIO, 36 * this.gameScale);
    const gap = Math.max(sceneWidth * this.CARD_GAP_RATIO, 20 * this.gameScale);
    const availableWidth = Math.max(sceneWidth - sidePadding * 2 - gap * 2, sceneWidth * 0.42);
    const cardWidth = Math.round(availableWidth / 3);
    const imageInset = Math.max(2, Math.round(this.CARD_IMAGE_INSET_BASE * this.gameScale));
    const totalWidth = cardWidth * 3 + gap * 2;
    let cursorX = (sceneWidth - totalWidth) / 2;

    return fallbackRatios.map((ratio: number, index: number) => {
      const rawRatio = Math.max(0.01, answerRatios[index] ?? ratio);
      const cardHeight = this.getCardHeightByAspect(cardWidth, frameAspectRatio, sceneHeight);
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
    const sidePadding = Math.max(sceneWidth * this.CARD_SIDE_PADDING_RATIO, 36 * this.gameScale);
    const gap = Math.max(sceneWidth * this.CARD_GAP_RATIO, 20 * this.gameScale);
    const availableWidth = Math.max(sceneWidth - sidePadding * 2 - gap * 2, sceneWidth * 0.42);
    const maxCardWidth = Math.round(availableWidth / 3);
    const frameAspectRatio = this.currentThemeUsesPortraitFrames
      ? this.CARD_FRAME_ASPECT_RATIO_PORTRAIT
      : this.CARD_FRAME_ASPECT_RATIO_LANDSCAPE;
    const maxCardHeight = this.getCardHeightByAspect(maxCardWidth, frameAspectRatio, sceneHeight);
    const imageInset = Math.max(2, Math.round(this.CARD_IMAGE_INSET_BASE * this.gameScale));

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

  private applyBlockVisualLayout(
    block: Phaser.Physics.Arcade.Sprite,
    visuals: Phaser.GameObjects.Container | undefined,
    layout: AnswerCardLayout
  ): void {
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
    this.gameScale = height / 1080;
    this.dpr = this.registry.get('dpr') || this.dpr || 1;
    this.JUMP_OVERSHOOT = 60 * this.gameScale; 

    const isCompressedLandscape = this.isCompressedLandscapeViewport(width, height);
    const bottomMarginRatio = isCompressedLandscape ? 0.055 : (this.isMobileDevice ? 0.07 : 0.09);
    const minBottomMargin = this.isMobileDevice ? 18 : 36;
    const maxBottomMargin = this.isMobileDevice ? 140 : 200;
    const bottomMargin = Phaser.Math.Clamp(height * bottomMarginRatio, minBottomMargin, maxBottomMargin);
    this.floorSurfaceY = height - bottomMargin; 
    this.floorHeight = bottomMargin;

    this.LANE_X_POSITIONS = [width * 0.20, width * 0.5, width * 0.80]; 

    const visualPlayerSize = 180 * this.gameScale;
    const visualBoxSize = Math.min(380 * this.gameScale, height * 0.38);
    
    this.playerHeight = visualPlayerSize;
    this.blockHeight = visualBoxSize;
    
    this.playerHeadY = -this.playerHeight;
    this.blockBottomY = this.blockHeight / 2;

    const minTopMargin = 56 * this.gameScale;
    const minBeeBlockGap = (isCompressedLandscape ? 450 : 420) * this.gameScale;
    const beeLiftOffset = (isCompressedLandscape ? 34 : 0) * this.gameScale;

    const jumpRatio = height < 600 ? 0.35 : 0.43; 
    const idealJumpHeight = Phaser.Math.Clamp(height * jumpRatio, 220 * this.gameScale, 520 * this.gameScale);
    const playerTopY = this.floorSurfaceY - this.playerHeight;
    const desiredPlayerCardGap = Phaser.Math.Clamp(
      height * (isCompressedLandscape ? 0.08 : 0.095),
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
    const bSize = 320;
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
    const targetThemeId = themeId || this.currentTheme;
    const isCurrentTheme = targetThemeId === this.currentTheme;

    // 如果已经在加载，返回现有的 promise
    if (isCurrentTheme && this.loadingPromise) {
      return this.loadingPromise;
    }

    // 如果已经加载完成，就直接返回
    if (isCurrentTheme && this.imagesLoaded) {
      return Promise.resolve();
    }

    const themesList = this.cache.json.get('themes_list');
    if (!themesList) {
      console.warn('[loadThemeImages] Themes list not loaded yet');
      return Promise.resolve();
    }
    const themes = themesList.themes || [];
    
    // 获取目标主题
    const targetTheme = themes.find((t: Theme) => t.id === targetThemeId);
    if (!targetTheme) {
      console.warn(`[loadThemeImages] Theme ${targetThemeId} not found`);
      return Promise.resolve();
    }
    
    // --- Load Theme Assets ---
    // NO-OP: All theme assets are now guaranteed to be loaded by PreloadScene
    // We just check if they are missing as a safety net, but we don't block
    
    const missingImageQuestions = targetTheme.questions.filter((questionItem: Theme['questions'][number]) => {
        const key = this.getImageTextureKey(questionItem, targetThemeId);
        return !this.textures.exists(key);
    });
    const missingAudioQuestions = targetTheme.questions.filter((questionItem: Theme['questions'][number]) => {
        if (!questionItem.audio) return false;
        const key = this.getAudioCacheKey(questionItem, targetThemeId);
        return !this.cache.audio.exists(key);
    });

    if (missingImageQuestions.length > 0) {
        console.warn(
          `[MainScene] Missing ${missingImageQuestions.length} textures for ${targetThemeId}, loading fallback...`
        );
        const { getR2ImageUrl } = await import('@/src/config/r2Config');
        missingImageQuestions.forEach((questionItem: Theme['questions'][number]) => {
            const imageName = questionItem.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
            const imagePath = getR2ImageUrl(imageName);
            const key = this.getImageTextureKey(questionItem, targetThemeId);
            if (!this.textures.exists(key)) {
                this.load.image(key, imagePath);
            }
        });

        if (isCurrentTheme) {
          this.imagesLoading = true;
        }

        const loadPromise = new Promise<void>((resolve) => {
            this.load.once('complete', () => {
                if (isCurrentTheme) {
                  this.imagesLoading = false;
                  this.imagesLoaded = true;
                  this.loadingPromise = null;
                }
                resolve();
            });
            this.load.start();
        });
        if (isCurrentTheme) {
          this.loadingPromise = loadPromise;
        }
        if (missingAudioQuestions.length > 0) {
          this.preloadThemeAudiosInBackground(targetThemeId, missingAudioQuestions);
        }
        return loadPromise;
    }

    if (isCurrentTheme) {
      this.imagesLoading = false;
      this.imagesLoaded = true;
      this.loadingPromise = null;
    }
    if (missingAudioQuestions.length > 0) {
      this.preloadThemeAudiosInBackground(targetThemeId, missingAudioQuestions);
    }
    return Promise.resolve();
  }

  private preloadThemeAudiosInBackground(
    themeId: string,
    audioQuestions: Array<Theme['questions'][number]>
  ): void {
    if (!audioQuestions || audioQuestions.length === 0) return;
    void (async () => {
      const { getR2ImageUrl } = await import('@/src/config/r2Config');
      let queuedAudioCount = 0;
      audioQuestions.forEach((questionItem: Theme['questions'][number]) => {
        if (!questionItem.audio) return;
        const audioKey = this.getAudioCacheKey(questionItem, themeId);
        if (!audioKey || this.cache.audio.exists(audioKey)) return;
        const audioPath = getR2ImageUrl(questionItem.audio);
        this.load.audio(audioKey, audioPath);
        queuedAudioCount += 1;
      });
      if (queuedAudioCount === 0) return;
      console.log(`[MainScene] Background loading ${queuedAudioCount} theme audios for ${themeId}`);
      if (!this.load.isLoading()) {
        this.load.start();
      }
    })().catch((error: unknown) => {
      console.warn('[MainScene] Failed to queue background audio preload', error);
    });
  }

  /**
   * 预加载下一个主题的图片 (后台执行)
   */
  private async preloadNextTheme() {
    try {
      let nextThemeId = '';
      
      if (this.currentThemes.length > 0) {
        if (this.currentThemeIndex >= this.currentThemes.length - 1) {
          return;
        }
        const nextIndex = this.currentThemeIndex + 1;
        nextThemeId = this.currentThemes[nextIndex];
      } else {
         const themesList = this.cache.json.get('themes_list');
         if (!themesList) return;
         const themes = themesList.themes || [];
         const currentIndex = themes.findIndex((t: Theme) => t.id === this.currentTheme);
         if (currentIndex === -1 || currentIndex >= themes.length - 1) return;
         const nextIndex = currentIndex + 1;
         nextThemeId = themes[nextIndex].id;
      }
      
      console.log(`[preloadNextTheme] Starting background preload for: ${nextThemeId}`);
      
      // Prioritize this theme in the global queue (browser cache warmup)
      prioritizeThemeInQueue(nextThemeId);
    } catch (err) {
      console.warn('[preloadNextTheme] Error:', err);
    }
  }

  create() {
    console.timeEnd('[MainScene] preload');
    
    // PAUSE background preloading when gameplay starts to save CPU/Bandwidth
    pauseBackgroundPreloading();

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

    const { width, height } = this.scale;
    this.recalcLayout(width, height);
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
    
    const bodyWidth = visualPlayerSize * 0.6;
    const bodyHeight = visualPlayerSize * 0.8;
    this.player.body?.setSize(bodyWidth, bodyHeight);
    this.player.body?.setOffset((visualPlayerSize - bodyWidth) / 2, visualPlayerSize - bodyHeight);
    this.player.setDepth(20);
    this.player.play('p1_walk');

    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.clearResizeStabilizers();
      this.scale.off('resize', this.handleResize, this);
      this.stopPronunciationSound(true);
    });
    this.events.once('destroy', () => {
      this.clearResizeStabilizers();
      this.scale.off('resize', this.handleResize, this);
      this.stopPronunciationSound(true);
    });

    this.physics.add.collider(this.player, platforms);
    this.physics.add.overlap(this.player, this.blocks, this.hitBlock, undefined, this);

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

    this.add.particles(0, 0, 'particle_gold', {
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
    if (this.onBackgroundUpdate) {
        this.onBackgroundUpdate(this.currentBgIndex);
    }
  }

  private applyResponsiveLayout(width: number, height: number): void {
      this.recalcLayout(width, height); 

      // 1. 更新地面位置 
      if (this.floor) { 
          const floorHeight = 80; // 与 create 中保持一致 
          this.floor.width = width; 
          this.floor.height = floorHeight; 
          // 重新定位地板 Sprite，让它的“上表面”对齐 floorSurfaceY 
          this.floor.y = this.floorSurfaceY + floorHeight; 
          
          // 【极为重要】更新静态物理体 
          const body = this.floor.body as Phaser.Physics.Arcade.StaticBody; 
          body.updateFromGameObject(); 
      } 
      
      // 2. 更新主角位置 (如果在地面上) 
      if (this.player) { 
          const visualPlayerSize = 180 * this.gameScale;
          this.player.setDisplaySize(visualPlayerSize, visualPlayerSize);
          
          const bodyWidth = visualPlayerSize * 0.6;
          const bodyHeight = visualPlayerSize * 0.8;
          this.player.body?.setSize(bodyWidth, bodyHeight);
          this.player.body?.setOffset((visualPlayerSize - bodyWidth) / 2, visualPlayerSize - bodyHeight);
          this.player.setGravityY(this.getScaledPhysicsValue(this.GRAVITY_Y));

          if (this.player.body && (this.player.body.touching.down || this.player.y > this.floorSurfaceY)) { 
              this.player.y = this.floorSurfaceY; 
          } 
      } 

      if (this.currentAnswerRatios.length === 3) {
          this.activeCardLayouts = this.computeAnswerCardLayouts(this.currentAnswerRatios, width, height);
          this.LANE_X_POSITIONS = this.activeCardLayouts.map((layout) => layout.centerX);
          if (this.activeCardLayouts.length > 0) {
              this.updateJumpVelocityByCardHeight(this.getMaxCardHeight(this.activeCardLayouts));
          }
      } else {
          this.activeCardLayouts = [];
      }

      if (this.blocks) { 
          this.blocks.children.iterate((b: any) => { 
              if (!b || !b.active) return true; 
              
              const answerIndex = b.getData('answerIndex');
              const visuals = b.getData('visuals') as Phaser.GameObjects.Container | undefined;

              if (typeof answerIndex === 'number' && this.activeCardLayouts[answerIndex]) {
                  const layout = this.activeCardLayouts[answerIndex];
                  this.applyBlockVisualLayout(b, visuals, layout);
                  return true;
              }

              const optionId = b.getData('optionId') as string | undefined;
              if (optionId) {
                  const optionX = optionId === 'retry' ? this.LANE_X_POSITIONS[0] : this.LANE_X_POSITIONS[2];
                  const optionSize = 240 * this.gameScale;
                  b.x = optionX;
                  b.y = this.blockCenterY;
                  b.setDisplaySize(optionSize, optionSize);
                  b.refreshBody();

                  if (visuals) {
                      visuals.x = optionX;
                      visuals.y = this.blockCenterY;
                      const bubble = visuals.list[0] as Phaser.GameObjects.Image | undefined;
                      const icon = visuals.list[1] as Phaser.GameObjects.Image | undefined;
                      if (bubble) bubble.setDisplaySize(optionSize, optionSize);
                      if (icon) {
                          const iconSize = optionSize * 0.5;
                          icon.setDisplaySize(iconSize, iconSize);
                      }
                  }
              }
              return true; 
          }); 
      } 
      
      // 4. 更新蜜蜂位置
      if (this.beeContainer && this.beeContainer.active) {
          this.beeContainer.x = width / 2;
          this.beeContainer.y = this.beeCenterY;
          
          // 调整：保持与 updateBeeWord 一致的尺寸
          const visualBeeSize = 80 * this.gameScale;
    const fontSize = Math.round(38 * this.gameScale);
          const textOffsetY = this.getBeeTextOffsetY(width, height);
          
          if (this.beeSprite) {
              this.beeSprite.setDisplaySize(visualBeeSize, visualBeeSize);
          }
          if (this.beeWordText) {
              this.beeWordText.setFontSize(`${fontSize}px`);
              this.beeWordText.y = textOffsetY;
              // this.beeWordText.setStroke('#000000', Math.max(2, 4 * this.gameScale));
          }
      }
  }

  handleResize(gameSize: Phaser.Structs.Size) {
      const immediateWidth = Math.round(gameSize.width);
      const immediateHeight = Math.round(gameSize.height);
      this.applyResponsiveLayout(immediateWidth, immediateHeight);

      // iPad/Safari 在退出全屏时会先抛出一次过渡尺寸，随后才稳定。
      // 追加两次短延迟重排，读取最新 scale 尺寸，避免偶发布局错位。
      this.clearResizeStabilizers();
      const settleDelays = [80, 220];
      settleDelays.forEach((delayMs) => {
          const timer = this.time.delayedCall(delayMs, () => {
              if (!this.scene.isActive()) return;
              const stableWidth = Math.round(this.scale.width);
              const stableHeight = Math.round(this.scale.height);
              this.applyResponsiveLayout(stableWidth, stableHeight);
          });
          this.resizeStabilizeTimers.push(timer);
      });
  }
  
  private getHysteresisLane(bodyX: number, currentLaneIndex: number): number {
    if (currentLaneIndex === 0) {
      // Currently in Left Lane. To leave (go to Center), must cross POS_FROM_LEFT
      return bodyX > this.POS_FROM_LEFT ? 1 : 0;
    }
    if (currentLaneIndex === 2) {
      // Currently in Right Lane. To leave (go to Center), must cross POS_FROM_RIGHT
      return bodyX < this.POS_FROM_RIGHT ? 1 : 2;
    }
    
    // Currently in Center Lane (1)
    if (bodyX < this.POS_TO_LEFT) return 0;  // Go Left
    if (bodyX > this.POS_TO_RIGHT) return 2; // Go Right
    return 1; // Stay Center
  }

  update() {
    if (!this.player || !this.player.body) return;

    const isOnGround = this.player.body.touching.down;

    const motionState = motionController.state;
    if (isOnGround) {
        // Use smoothed state for movement logic to prevent jitter/lag
        // Fallback to raw state if smoothedState is not available yet
        const effectiveState = motionController.smoothedState || motionState;
        
        const bodyX = Phaser.Math.Clamp(
          typeof effectiveState.bodyX === 'number' ? effectiveState.bodyX : (1 - effectiveState.rawNoseX),
          0,
          1
        );

        // --- Step-based Movement Logic ---
        // Only allow 1 step at a time. Must return to "neutral zone" before moving again.
        
        // Positional Control Logic (Absolute Mapping)
        // Directly maps body position to target lane with hysteresis
        // This solves the "locking" issue where user moves "too far" and gets stuck waiting for reset
        
        const newLane = this.getHysteresisLane(bodyX, this.targetLaneIndex);
        this.targetLaneIndex = newLane;
        
        // Smooth visual movement
        const targetX = this.LANE_X_POSITIONS[this.targetLaneIndex];
        this.player.x = Phaser.Math.Linear(this.player.x, targetX, 0.28);
        
        if (this.player.anims.currentAnim?.key !== 'p1_walk') {
            this.player.play('p1_walk', true);
        }
 
        // Use smoothed jump state too? No, jump is an event, use immediate state but with latching in controller
        // Actually, we should check if jump was triggered in the last few frames if we missed it
        if (effectiveState.isJumping && this.isInteractionActive) {
            this.player.setVelocityY(-this.jumpVelocity); 
            this.player.setTexture('p1_jump');
            this.player.anims.stop();
            this.jumpSound.play();
            this.jumpBurstEmitter.emitParticleAt(this.player.x, this.player.y, 1); 
            this.jumpBurstEmitter.explode(20, this.player.x, this.player.y);
        }
    } else {
        if (this.player.body.velocity.y > 0) {
            this.player.setTexture('p1_stand');
        }
    }

    this.player.setVelocityX(0);

    const targetXForAngle = this.LANE_X_POSITIONS[this.targetLaneIndex];
    const diff = targetXForAngle - this.player.x;
    const laneSpacing = this.LANE_X_POSITIONS.length > 1
      ? Math.abs(this.LANE_X_POSITIONS[1] - this.LANE_X_POSITIONS[0])
      : Math.max(this.scale.width * 0.3, 1);
    const normalizedDiff = Phaser.Math.Clamp(diff / Math.max(laneSpacing, 1), -1, 1);
    const targetLeanAngle = normalizedDiff * this.PLAYER_MAX_LEAN_ANGLE;
    const nextLeanAngle = Phaser.Math.Linear(this.player.angle, targetLeanAngle, this.PLAYER_LEAN_LERP);
    this.player.setAngle(nextLeanAngle);

    // 控制器备份 (键盘支持)
    const cursors = this.input.keyboard?.createCursorKeys();
    if (cursors) {
        if (Phaser.Input.Keyboard.JustDown(cursors.left)) {
            this.targetLaneIndex = Math.max(0, this.targetLaneIndex - 1);
        } else if (Phaser.Input.Keyboard.JustDown(cursors.right)) {
            this.targetLaneIndex = Math.min(2, this.targetLaneIndex + 1);
        }
        if ((Phaser.Input.Keyboard.JustDown(cursors.up) || Phaser.Input.Keyboard.JustDown(cursors.space)) && isOnGround) {
            this.player.setVelocityY(-this.jumpVelocity); 
            this.player.setTexture('p1_jump');
            this.player.anims.stop();
            this.jumpSound.play();
            this.jumpBurstEmitter.explode(20, this.player.x, this.player.y);
        }
    }
  }

  speak(text: string) {
      const questionItem = this.getQuestionByText(text);
      const audioKey = questionItem ? this.getAudioCacheKey(questionItem, this.currentTheme) : '';
      if (!audioKey) {
          console.warn(`[MainScene] Missing audio mapping for question: ${text}`);
          return;
      }
      if (!this.cache.audio.exists(audioKey)) {
          console.warn(`[MainScene] Audio cache missing: ${audioKey}`);
          return;
      }

      if (window.setBGMVolume) {
          window.setBGMVolume(0);
      }
      this.stopPronunciationSound(false);

      try {
          const sound = this.sound.add(audioKey);
          this.pronunciationSound = sound;

          sound.once('complete', () => {
              if (this.pronunciationSound === sound) {
                  this.pronunciationSound = null;
              }
              sound.destroy();
              window.restoreBGMVolume?.();
          });
          sound.once('destroy', () => {
              if (this.pronunciationSound === sound) {
                  this.pronunciationSound = null;
              }
          });

          const played = sound.play({ volume: this.PRONUNCIATION_VOLUME });
          if (!played) {
              sound.destroy();
              this.pronunciationSound = null;
              window.restoreBGMVolume?.();
          }
      } catch (error) {
          console.warn('[MainScene] Failed to play question audio', error);
          this.stopPronunciationSound(true);
      }
  }

  generateWordQuestion(): QuestionData | null {
    if (this.themeWordPool.length === 0) {
        return null;
    }

    const themeWords = this.themeData ? this.themeData.questions.map(q => this.toQuestionKey(q.question)) : [];

    // 从池子中选一个和上次不一样的单词
    let selectedIndex = -1;
    for (let i = 0; i < this.themeWordPool.length; i++) {
        if (this.themeWordPool[i] !== this.lastQuestionWord) {
            selectedIndex = i;
            break;
        }
    }

    // 如果没找到不一样的（极端情况，池子里剩下的都是一样的），就选第一个
    if (selectedIndex === -1) selectedIndex = 0;

    const correctRawWord = this.themeWordPool.splice(selectedIndex, 1)[0];
    this.lastQuestionWord = correctRawWord;

    const correctKey = this.toQuestionKey(correctRawWord);

    // 干扰项从该主题的所有单词中选
    let distractors = themeWords.filter(w => w !== correctKey);
    distractors = Phaser.Utils.Array.Shuffle(distractors).slice(0, 2);
    
    const answers = [correctKey, ...distractors]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    return { 
        question: correctRawWord, 
        answers, 
        correctIndex: answers.indexOf(correctKey)
    };
  }

  private async spawnQuestion() {
    this.isInteractionActive = false;
    
    // 如果还没加载主题图片，先加载
    if (!this.imagesLoaded) {
      console.log('[spawnQuestion] Waiting for theme images to load...');
      await this.loadThemeImages();
      console.log('[spawnQuestion] Theme images ready, proceeding with question spawn');
    }
    
    // 确保下一关预加载逻辑只执行一次
    if (!this.hasPreloadedNext) {
      this.hasPreloadedNext = true;
      this.preloadNextTheme();
    }
    
    const question = this.generateWordQuestion();
    
    if (!question) {
        this.showThemeCompletion();
        return;
    }

    this.currentQuestion = question;
    if (this.onQuestionUpdate) this.onQuestionUpdate(this.currentQuestion.question);
    this.speak(this.currentQuestion.question);
    this.questionCounter++;
    
    // 重置错误计数
    this.wrongAttempts = 0;

    // 更新小蜜蜂抓着的文字
    this.updateBeeWord(this.currentQuestion.question);

    // 清理旧的方块及其视觉容器
    this.blocks.children.iterate((b: any) => {
        const visuals = b.getData('visuals');
        if (visuals) {
            visuals.destroy();
        }
        return true;
    });
    this.blocks.clear(true, true);

    // 如果小蜜蜂容器已经存在但被销毁了（比如场景重启），需要重置引用
    if (this.beeContainer && !this.beeContainer.active) {
        this.beeContainer = undefined;
        this.beeSprite = undefined;
        this.beeWordText = undefined;
    }

    const entranceDuration = 300;
    const stagger = 80;
    const totalSetupTime = entranceDuration + (stagger * 2);

    const { width, height } = this.cameras.main;
    this.recalcLayout(width, height);
    const blockY = this.blockCenterY;

    this.currentAnswerKeys = [...this.currentQuestion.answers];
    this.currentAnswerRatios = this.currentAnswerKeys.map((answerKey) => {
        const imageKey = this.getImageTextureKeyByAnswer(answerKey);
        return this.getTextureAspectRatio(imageKey);
    });
    this.refreshThemeFrameMode();
    this.activeCardLayouts = this.computeAnswerCardLayouts(this.currentAnswerRatios, width, height);
    this.LANE_X_POSITIONS = this.activeCardLayouts.map((layout) => layout.centerX);
    this.targetLaneIndex = Phaser.Math.Clamp(this.targetLaneIndex, 0, this.LANE_X_POSITIONS.length - 1);
    if (this.activeCardLayouts.length > 0) {
        this.updateJumpVelocityByCardHeight(this.getMaxCardHeight(this.activeCardLayouts));
    }

    this.currentQuestion.answers.forEach((answerKey, i) => {
        const rawLayout = this.activeCardLayouts[i];
        const layout = rawLayout ? this.constrainCardLayout(rawLayout, width, height) : undefined;
        const x = Math.round(layout?.centerX ?? this.LANE_X_POSITIONS[i] ?? this.LANE_X_POSITIONS[1]);
        const cardWidth = Math.round(layout?.cardWidth ?? this.blockHeight);
        const cardHeight = Math.round(layout?.cardHeight ?? this.blockHeight);
        const imageKey = this.getImageTextureKeyByAnswer(answerKey);
        const textureKey = imageKey && this.textures.exists(imageKey) ? imageKey : 'tile_box';
        const borderThickness = Math.max(4, Math.round(6 * this.gameScale));
        const innerBorderThickness = Math.max(2, Math.round(3 * this.gameScale));
        const shadowOffsetY = Math.max(4, 8 * this.gameScale);

        const block = this.blocks.create(x, blockY, 'block_hitbox');
        block.setOrigin(0.5);
        block.setDisplaySize(cardWidth, cardHeight);
        block.refreshBody();
        block.setVisible(false);
        block.setAlpha(0);
        block.setData('answerIndex', i);
        block.setData('answerKey', answerKey);
        block.setData('imageKey', textureKey);

        const container = this.add.container(x, blockY);
        const frameShadow = this.add
            .rectangle(
                0,
                shadowOffsetY,
                cardWidth + borderThickness * 1.4,
                cardHeight + borderThickness * 1.6,
                0x202432,
                0.28
            )
            .setOrigin(0.5);
        const frame = this.add
            .rectangle(0, 0, cardWidth, cardHeight, 0xffffff, 0.98)
            .setOrigin(0.5)
            .setStrokeStyle(borderThickness, 0x2f3442, 1);
        const innerFrame = this.add
            .rectangle(
                0,
                0,
                Math.max(1, cardWidth - borderThickness * 1.2),
                Math.max(1, cardHeight - borderThickness * 1.2),
                0xffffff,
                0
            )
            .setOrigin(0.5)
            .setStrokeStyle(innerBorderThickness, 0xd9e2f2, 0.9);
        const icon = this.add.image(0, 0, textureKey);

        if (layout) {
            icon.setDisplaySize(layout.iconWidth, layout.iconHeight);
        } else {
            const fallbackInset = Math.max(2, Math.round(this.CARD_IMAGE_INSET_BASE * this.gameScale));
            icon.setDisplaySize(
                Math.max(1, cardWidth - fallbackInset * 2),
                Math.max(1, cardHeight - fallbackInset * 2)
            );
        }

        icon.setTint(0xffffff);
        icon.setOrigin(0.5, 0.5);

        container.add([frameShadow, frame, innerFrame, icon]);
        block.setData('visuals', container);
        block.setData('answerFrameShadow', frameShadow);
        block.setData('answerFrame', frame);
        block.setData('answerInnerFrame', innerFrame);
        block.setData('answerIcon', icon);

        // 移动端禁用答案卡片浮动，避免 resize/fullscreen 过渡时出现旧坐标残留导致错位
        if (!this.isMobileDevice) {
            this.tweens.add({
                targets: container,
                y: Math.round(container.y - 15),
                duration: 1500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                delay: i * 200
            });
        } else {
            container.y = Math.round(container.y);
        }

        // Entrance
        container.setScale(0);
        this.tweens.add({
            targets: container,
            scaleX: 1,
            scaleY: 1,
            duration: entranceDuration,
            delay: i * stagger,
            ease: 'Back.easeOut'
        });
    });

    this.time.delayedCall(totalSetupTime, () => {
        this.isInteractionActive = true;
    });
  }

  hitBlock(player: any, block: any) {
    if (!block.active || !this.isInteractionActive) return;
    
    if (player.body.velocity.y > this.getScaledPhysicsValue(500)) return;

    const playerBodyTopY = player.y - player.body.height;
    const blockBottomY = block.y + (block.body.height / 2);
    
    if (playerBodyTopY > blockBottomY) return;

    this.isInteractionActive = false;
    
    const recoilForce = this.getScaledPhysicsValue(400);
    player.setVelocityY(recoilForce);
    
    const pushDownPadding = Math.max(2, 6 * this.gameScale);
    const safePlayerY = blockBottomY + player.displayHeight + pushDownPadding;
    player.y = Math.min(safePlayerY, this.floorSurfaceY);
    player.setAngle(0);
    
    const idx = block.getData('answerIndex');
    const visuals = block.getData('visuals') as Phaser.GameObjects.Container;
    
    const isCorrect = idx === this.currentQuestion?.correctIndex;

    if (isCorrect) {
        block.disableBody(true, false); 
        this.successSound.play();
        
        if (visuals) {
            this.createBlockExplosion(block.x, block.y);
        }

        const shouldAwardStar = this.wrongAttempts < 2;
        let scoreSettleDelayMs = 0;
        if (shouldAwardStar) {
            const rewards = [
                { key: 'star_gold', score: 1, scale: 1, surprise: false, label: '星星' },
                { key: 'mushroom_red', score: 1, scale: 1, surprise: true, label: '红蘑菇' },
                { key: 'mushroom_brown', score: 1, scale: 1, surprise: true, label: '小蘑菇' },
                { key: 'gem_blue', score: 1, scale: 1, surprise: true, label: '蓝宝石' },
                { key: 'gem_red', score: 1, scale: 1, surprise: true, label: '红宝石' },
                { key: 'gem_green', score: 1, scale: 1, surprise: true, label: '绿宝石' },
                { key: 'gem_yellow', score: 1, scale: 1, surprise: true, label: '黄宝石' },
                { key: 'grass', score: 1, scale: 1, surprise: true, label: '小草' },
                { key: 'grass_purple', score: 1, scale: 1, surprise: true, label: '紫色小草' },
            ];

            const random = Math.random();
            const reward = random < 0.6
                ? rewards[0]
                : rewards[Phaser.Math.Between(1, rewards.length - 1)];

            const rewardItem = this.add.image(block.x, block.y, reward.key);
            rewardItem.setDepth(100);
            rewardItem.setScale(0);

            const baseScale = (reward.scale * this.gameScale) / 4;
            const trailTint = reward.surprise ? [0x00FFFF, 0xFF00FF, 0xFFFF00] : [C_GOLD, C_AMBER, 0xFF4500];

            if (this.rewardTrailEmitter) {
                this.rewardTrailEmitter.setParticleTint(trailTint[0]);
                this.rewardTrailEmitter.startFollow(rewardItem);
                this.rewardTrailEmitter.start();
                this.rewardTrailEmitter.setFrequency(reward.surprise ? 16 : 26);
            }

            const rewardText = this.add.text(block.x, block.y - 50 * this.gameScale, `+${reward.score}`, {
                fontSize: `${(reward.surprise ? 64 : 48) * this.gameScale}px`,
                fontFamily: FONT_STACK,
                fontStyle: 'bold',
                color: reward.surprise ? '#FFD700' : '#FFFFFF',
                stroke: '#000',
                strokeThickness: 8 * this.gameScale
            }).setOrigin(0.5).setDepth(110);

            this.tweens.add({
                targets: rewardText,
                y: rewardText.y - 150 * this.gameScale,
                alpha: 0,
                scale: reward.surprise ? 1.5 : 1.2,
                duration: 2500,
                ease: 'Cubic.easeOut',
                onComplete: () => rewardText.destroy()
            });

            if (reward.surprise) {
                this.cameras.main.shake(200, 0.01);
            }

            const waitTime = reward.surprise ? 260 : 220;
            const flightDuration = reward.surprise ? 1450 : 1250;
            const launchScaleFactor = reward.surprise ? 2.2 : 1.6;
            const launchHeight = reward.surprise ? 95 : 80;
            scoreSettleDelayMs = 700 + waitTime + flightDuration;

            this.tweens.add({
                targets: rewardItem,
                y: block.y - launchHeight * this.gameScale,
                scaleX: baseScale * launchScaleFactor,
                scaleY: baseScale * launchScaleFactor,
                duration: 700,
                ease: 'Back.easeOut',
                onComplete: () => {
                    this.time.delayedCall(waitTime, () => {
                        const { x: targetX, y: targetY } = this.getScoreHudTarget();
                        const startX = rewardItem.x;
                        const startY = rewardItem.y;
                        const controlXOffset = Phaser.Math.Clamp((startX - targetX) * 0.22, -220 * this.gameScale, 220 * this.gameScale);
                        const controlX = (startX + targetX) / 2 + controlXOffset;
                        const controlY = Math.min(startY, targetY) - (reward.surprise ? 230 : 190) * this.gameScale;
                        const flightCurve = new Phaser.Curves.QuadraticBezier(
                            new Phaser.Math.Vector2(startX, startY),
                            new Phaser.Math.Vector2(controlX, controlY),
                            new Phaser.Math.Vector2(targetX, targetY)
                        );

                        this.tweens.addCounter({
                            from: 0,
                            to: 1,
                            duration: flightDuration,
                            ease: 'Sine.easeInOut',
                            onStart: () => {
                                if (this.rewardTrailEmitter) {
                                    this.rewardTrailEmitter.setFrequency(reward.surprise ? 10 : 14);
                                }
                            },
                            onUpdate: (tween) => {
                                const progress = tween.getValue();
                                const point = flightCurve.getPoint(progress);
                                rewardItem.setPosition(point.x, point.y);
                                rewardItem.setScale(baseScale * Phaser.Math.Linear(launchScaleFactor, 0.38, progress));
                                rewardItem.setAlpha(Phaser.Math.Linear(1, 0.45, progress));
                                rewardItem.setAngle(Phaser.Math.Linear(0, reward.surprise ? 540 : 360, progress));
                            },
                            onComplete: () => {
                                rewardItem.destroy();
                                if (this.rewardTrailEmitter) {
                                    this.rewardTrailEmitter.stop();
                                    this.rewardTrailEmitter.stopFollow();
                                }
                                this.score += reward.score;
                                this.themeScore += reward.score;
                                if (this.onScoreUpdate) this.onScoreUpdate(this.score, this.totalQuestions);
                            }
                        });
                    });
                }
            });
        }

        if (visuals) {
            this.tweens.add({
                targets: visuals,
                scaleX: 1.5,
                scaleY: 1.5,
                alpha: 0,
                duration: 200, 
                onComplete: () => visuals.destroy()
            });
        }

        this.handleWin(scoreSettleDelayMs);

    } else {
        this.failureSound.play();
        
        // 增加错误计数
        this.wrongAttempts++;

        // 每次碰撞错误都重新朗读
        if (this.currentQuestion) {
            this.speak(this.currentQuestion.question);
        }
        
        if (visuals) {
            this.tweens.add({
                targets: visuals,
                x: visuals.x + 10,
                duration: 50,
                yoyo: true,
                repeat: 5,
                ease: 'Sine.easeInOut'
            });
        }

        player.setGravityY(this.getScaledPhysicsValue(this.GRAVITY_Y * 2));
        
        this.time.delayedCall(1200, () => {
            player.setGravityY(this.getScaledPhysicsValue(this.GRAVITY_Y));
            this.isInteractionActive = true;
        });
    }
  }

  handleWin(scoreSettleDelayMs: number = 0) {
    // 当存在奖励飞行动画时，等待计分真正入账后再生成下一题，
    // 避免最后一题结算页先打开导致文案/语音判断使用旧分数。
    this.time.delayedCall(500, () => this.cleanupBlocks());
    const nextQuestionDelayMs = Math.max(1500, scoreSettleDelayMs + 60);
    this.time.delayedCall(nextQuestionDelayMs, () => this.spawnQuestion());
  }

  /**
   * 核心架构：三明治分层结算页 (下层 Phaser 交互部分)
   */
  private async showThemeCompletion() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.currentAnswerRatios = [];
    this.currentAnswerKeys = [];
    this.activeCardLayouts = [];
    this.recalcLayout(this.scale.width, this.scale.height);

    // RESUME background preloading during the completion screen
    // This gives us ~8 seconds to load the next theme while user watches animations
    resumeBackgroundPreloading();

    // 1. 停止所有方块的生成逻辑
    this.isInteractionActive = false;
    this.blocks.clear(true, true);
    
    // 2. 触发 React 层 UI 开启 (三明治上层)
    if (this.onGameOver) this.onGameOver();
  }

  public restartLevel() {
    this.transitionToTheme(this.currentTheme);
  }

  public hasNextTheme(): boolean {
    if (this.currentThemes.length > 0) {
      return this.currentThemeIndex < this.currentThemes.length - 1;
    }

    const themeList = this.cache.json.get('themes_list');
    const themes = themeList?.themes || [];
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
      const themes = themeList?.themes || [];
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

  private createBlockExplosion(x: number, y: number) {
    // Use pooled emitters to avoid object creation overhead
    if (this.blockDebrisEmitter) {
        this.blockDebrisEmitter.explode(35, x, y); // Reduced from 80
    }
    
    if (this.blockSmokeEmitter) {
        this.blockSmokeEmitter.explode(10, x, y); // Reduced from 15
    }

    if (this.blockFlashEmitter) {
        this.blockFlashEmitter.explode(15, x, y); // Reduced from 30
    }
  }


  /**
   * 初始化或更新小蜜蜂及其抓着的文字
   */
  private updateBeeWord(text: string) {
    if (!text) return;

    // 格式化文字：仅首字母大写
    const formattedText = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

    const { width } = this.scale;
    const startY = this.beeCenterY;

    // 如果容器存在但已经不活跃（被销毁了），重置它
    if (this.beeContainer && !this.beeContainer.active) {
        this.beeContainer = undefined;
    }

    if (!this.beeContainer) {
        console.log("Creating new bee container");
        // 创建容器
        this.beeContainer = this.add.container(width / 2, startY);
        this.beeContainer.setDepth(1000); // 提高深度，确保在所有物体之上
        this.beeContainer.setScale(0); // 初始缩放为0，用于进场动画

        // 创建小蜜蜂精灵并设置动画
         this.beeSprite = this.add.sprite(0, 0, 'bee_a');
         this.beeSprite.play('bee_fly');

        // 创建文字
        this.beeWordText = this.add.text(0, 0, formattedText, {
            fontFamily: FONT_STACK,
            fontStyle: 'bold',
            color: '#333333',
        }).setOrigin(0.5);

        this.beeContainer.add([this.beeSprite, this.beeWordText]);

        // 持续的漂浮晃动动画 (针对容器内的元素，避免与缩放动画冲突)
        this.tweens.add({
            targets: this.beeSprite,
            y: { from: 0, to: 15 }, // 这里使用固定值，后面 update 时会 scale 容器
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    } else {
        console.log("Updating existing bee container");
        // 如果已存在，强制显示并更新文字
        this.beeContainer.setVisible(true);
        this.beeContainer.setAlpha(1);
        this.beeContainer.setScale(0); // 重置缩放，准备进场
        
        // 停止之前的进场或退场动画
        this.tweens.killTweensOf(this.beeContainer);
        this.beeContainer.y = startY;
        this.beeWordText?.setText(formattedText);
    }

    // 无论新建还是更新，都刷新尺寸和偏移 (适配不同分辨率切换)
    // 调整：蜜蜂和文字大小调小，适配长句子
    const visualBeeSize = 80 * this.gameScale;
    const fontSize = Math.round(40 * this.gameScale);
    const textOffsetY = this.getBeeTextOffsetY(this.scale.width, this.scale.height); // 非全屏横屏时减小文字下偏移，避免贴近卡片
    
    if (this.beeSprite) {
        this.beeSprite.setDisplaySize(visualBeeSize, visualBeeSize);
    }
    
    if (this.beeWordText) {
        this.beeWordText.setFontSize(`${fontSize}px`);
        this.beeWordText.setY(textOffsetY);
        // this.beeWordText.setStroke('#000000', Math.max(2, 4 * this.gameScale));
        
        // 更新文字的晃动动画偏移 (如果是更新)
        this.tweens.killTweensOf(this.beeWordText);
        const floatDistance = 15 * this.gameScale;
        this.tweens.add({
            targets: this.beeWordText,
            y: { from: textOffsetY, to: textOffsetY + floatDistance },
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    // 统一的进场动画 (与木箱一致)
    this.tweens.add({
        targets: this.beeContainer,
        scaleX: 1,
        scaleY: 1,
        duration: 500,
        ease: 'Back.easeOut'
    });
  }

  cleanupBlocks() {
    if (!this.blocks) return;

    // 1. 小蜜蜂消失 (与木箱同步)
    if (this.beeContainer && this.beeContainer.active) {
        this.tweens.add({
            targets: this.beeContainer,
            scaleX: 0,
            scaleY: 0,
            duration: 300,
            ease: 'Back.easeIn',
            onComplete: () => {
                if (this.beeContainer) this.beeContainer.setVisible(false);
            }
        });
    }

    // 2. 木箱消失
    this.blocks.children.iterate((b: any) => {
        if (b.active) {
            const v = b.getData('visuals');
            if(v) {
                this.tweens.add({
                    targets: v,
                    scaleX: 0,
                    scaleY: 0,
                    duration: 300,
                    onComplete: () => v.destroy()
                });
            }
        }
        return true;
    });
    this.time.delayedCall(350, () => {
        this.blocks.clear(true, true);
    });
  }
}
