import Phaser from 'phaser';

import type { QuestionData, Theme, ThemeQuestion } from '../../../types';
import { BubbleSystem, type BubbleSpawnDefinition } from '../../systems/BubbleSystem';
import {
  advanceBubblePopQueue,
  createBubblePopQueue,
  createBubblePopWave,
  resolveBubbleSpawnSlots,
  shouldRegisterBubbleHeadHit,
  shouldRetryBubblePopQuestion,
  type BubblePopWaveDefinition
} from './round3BubblePopLogic';

interface ViewportSize {
  width: number;
  height: number;
}

interface BubbleCollisionPlayer {
  x: number;
  y: number;
  displayHeight: number;
  body: Phaser.Physics.Arcade.Body;
  setAngle(value: number): void;
  setGravityY(value: number): void;
}

interface BubbleCollisionTarget {
  active: boolean;
  x: number;
  y: number;
  angle: number;
  body: Phaser.Physics.Arcade.Body;
  getData(key: string): unknown;
  setData(key: string, value: unknown): void;
}

interface Round3SceneInternal {
  time: Phaser.Time.Clock;
  sound: Phaser.Sound.BaseSoundManager;
  cache: Phaser.Cache.CacheManager;
  textures: Phaser.Textures.TextureManager;
  callbackBridge: {
    onScoreUpdate?: (score: number, total: number) => void;
  };
  currentTheme: string;
  themeData: Theme | null;
  currentQuestion: QuestionData | null;
  score: number;
  totalQuestions: number;
  questionCounter: number;
  gameScale: number;
  floorSurfaceY: number;
  GRAVITY_Y: number;
  player: { x: number; y: number; body: Phaser.Physics.Arcade.Body; displayHeight: number; setAngle(v: number): void; setGravityY(v: number): void };
  isInteractionActive: boolean;
  imagesLoaded: boolean;
  hasPreloadedNext: boolean;
  pronunciationSound: Phaser.Sound.BaseSound | null;
  PRONUNCIATION_VOLUME: number;
  successSound: Phaser.Sound.BaseSound;
  bumpSound: Phaser.Sound.BaseSound;
  failureSound: Phaser.Sound.BaseSound;
  jumpBurstEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  blockDebrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  loadThemeImages(): Promise<void>;
  preloadNextTheme(): Promise<void>;
  showThemeCompletion(): Promise<void>;
  updateBeeWord(text: string): void;
  getCurrentViewportSize(): ViewportSize;
  recalcLayout(width: number, height: number): void;
  updateSceneBounds(width: number, height: number): void;
  getScaledPhysicsValue(baseValue: number): number;
  getImageTextureKey(questionItem: ThemeQuestion, themeId: string): string;
  getTextureAspectRatio(textureKey: string): number;
  getAudioCacheKey(questionItem: ThemeQuestion, themeId: string): string;
  stopPronunciationSound(restoreBgmVolume?: boolean): void;
  applyScoreDelta(delta: number): void;
}

export class Round3BubblePopFlow {
  private readonly sceneRef: unknown;
  private _bubbleSystem?: BubbleSystem;
  private questionQueue: ThemeQuestion[] = [];
  private currentWave: BubblePopWaveDefinition | null = null;
  private pendingWaveTimer: Phaser.Time.TimerEvent | null = null;
  private wrongHitUnlockTimer: Phaser.Time.TimerEvent | null = null;
  private waveToken: number = 0;

  constructor(scene: unknown) {
    this.sceneRef = scene;
  }

  private get scene(): Round3SceneInternal {
    return this.sceneRef as Round3SceneInternal;
  }

  public get bubbleSystem(): BubbleSystem {
    if (!this._bubbleSystem) {
      this._bubbleSystem = new BubbleSystem(this.sceneRef as Phaser.Scene);
    }
    return this._bubbleSystem;
  }

  public setupThemeData(theme: Theme): void {
    const scene = this.scene;
    scene.themeData = theme;
    scene.currentQuestion = null;
    scene.isInteractionActive = false;
    scene.questionCounter = 0;

    this.currentWave = null;
    this.questionQueue = createBubblePopQueue(theme.questions);
    scene.totalQuestions = this.questionQueue.length;
    this.cancelTimers();
    this.bubbleSystem.clearWave();

    scene.callbackBridge.onScoreUpdate?.(scene.score, scene.totalQuestions);

    this.scheduleNextWave(120);
  }

  public update(time: number): void {
    this._bubbleSystem?.update(time);
    this.maybeRetryCurrentQuestion();
  }

  public handleSceneResize(): void {
    if (!this._bubbleSystem) {
      return;
    }

    const viewport = this.scene.getCurrentViewportSize();
    this._bubbleSystem.clampToViewport(viewport.width, viewport.height);
  }

  public clear(): void {
    this.cancelTimers();
    this.currentWave = null;
    this.scene.currentQuestion = null;
    this.scene.isInteractionActive = false;
    this.scene.player.setGravityY(this.scene.getScaledPhysicsValue(this.scene.GRAVITY_Y));
    this._bubbleSystem?.clearWave();
  }

  public destroy(): void {
    this.clear();
    this.questionQueue = [];
    if (this._bubbleSystem) {
      this._bubbleSystem.destroy();
      this._bubbleSystem = undefined;
    }
  }

  public handleHit(player: unknown, bubbleTarget: unknown): void {
    const scene = this.scene;
    const collisionPlayer = player as BubbleCollisionPlayer;
    const collisionTarget = bubbleTarget as BubbleCollisionTarget;

    if (!collisionTarget.active || !scene.isInteractionActive) {
      return;
    }
    if (collisionTarget.getData('isPopping') || collisionTarget.getData('hitLocked')) {
      return;
    }

    const playerBody = collisionPlayer.body;
    const bubbleRadius = (collisionTarget.getData('radius') as number) || 100;
    const shouldTriggerHit = shouldRegisterBubbleHeadHit({
      playerX: collisionPlayer.x,
      playerY: collisionPlayer.y,
      playerDisplayHeight: collisionPlayer.displayHeight,
      playerBodyWidth: playerBody.width,
      playerVelocityY: playerBody.velocity.y,
      bubbleX: collisionTarget.x,
      bubbleY: collisionTarget.y,
      bubbleRadius
    });
    if (!shouldTriggerHit) {
      return;
    }

    scene.isInteractionActive = false;

    // 碰撞后施加后坐力 — 把玩家向下推离泡泡（参考 Round2 模式）
    const recoilForce = scene.getScaledPhysicsValue(350);
    const bubbleCenterY = collisionTarget.y;
    const pushDownY = bubbleCenterY + bubbleRadius + playerBody.height + Math.max(2, 4 * scene.gameScale);
    const clampedY = Math.min(pushDownY, scene.floorSurfaceY);
    playerBody.reset(collisionPlayer.x, clampedY);
    if (clampedY >= scene.floorSurfaceY - Math.max(1, 3 * scene.gameScale)) {
      playerBody.setVelocityY(0);
    } else {
      playerBody.setVelocityY(recoilForce);
    }
    collisionPlayer.setAngle(0);

    const isCorrect = collisionTarget.getData('isCorrect') === true;
    if (isCorrect) {
      this.handleCorrectHit(collisionPlayer, collisionTarget);
      return;
    }

    this.handleWrongHit(collisionTarget, collisionPlayer);
  }

  private scheduleNextWave(delayMs: number): void {
    this.cancelPendingWaveTimer();
    const token = ++this.waveToken;
    this.pendingWaveTimer = this.scene.time.delayedCall(delayMs, () => {
      if (token !== this.waveToken) {
        return;
      }
      void this.spawnNextWave();
    });
  }

  private async spawnNextWave(): Promise<void> {
    const scene = this.scene;
    this.cancelPendingWaveTimer();
    scene.isInteractionActive = false;

    if (!scene.themeData) {
      return;
    }

    if (!scene.imagesLoaded) {
      void scene.loadThemeImages().catch((error: unknown) => {
        console.warn('[Round3] Theme image preload failed, continuing with text bubbles', error);
      });
    }

    if (!scene.hasPreloadedNext) {
      scene.hasPreloadedNext = true;
      void scene.preloadNextTheme().catch((error: unknown) => {
        console.warn('[Round3] Failed to queue next-theme preload', error);
      });
    }

    const nextWave = createBubblePopWave(this.questionQueue, scene.themeData.questions);
    if (!nextWave) {
      this.currentWave = null;
      await scene.showThemeCompletion();
      return;
    }

    this.currentWave = nextWave;
    scene.questionCounter = scene.totalQuestions - this.questionQueue.length + 1;
    scene.currentQuestion = {
      question: nextWave.prompt.question,
      answers: nextWave.options.map((option) => option.question),
      correctIndex: nextWave.options.findIndex((option) => option.question === nextWave.prompt.question)
    };

    const viewport = scene.getCurrentViewportSize();
    scene.recalcLayout(viewport.width, viewport.height);
    scene.updateSceneBounds(viewport.width, viewport.height);
    try {
      scene.updateBeeWord(nextWave.prompt.question);
    } catch (error) {
      console.warn('[Round3] Failed to update bee prompt, continuing with bubble spawn', error);
    }
    this.playQuestionAudioByText(nextWave.prompt.question);

    const token = ++this.waveToken;
    this.pendingWaveTimer = scene.time.delayedCall(650, () => {
      if (token !== this.waveToken || !this.currentWave) {
        return;
      }

      const freshViewport = scene.getCurrentViewportSize();
      const entries = this.createSpawnEntries(this.currentWave, freshViewport);
      this.bubbleSystem.spawnWave(entries);
      scene.isInteractionActive = true;
      this.pendingWaveTimer = null;
    });
  }

  private createSpawnEntries(
    wave: BubblePopWaveDefinition,
    viewport: ViewportSize
  ): BubbleSpawnDefinition[] {
    const scene = this.scene;
    const optionCount = wave.options.length;
    const isFourBubbleLayout = optionCount >= 4;
    const minRadius = isFourBubbleLayout
      ? Math.round(Math.max(36, 42 * scene.gameScale))
      : Math.round(Math.max(140, 160 * scene.gameScale));
    const maxRadius = isFourBubbleLayout
      ? Math.round(Math.max(minRadius, 132 * scene.gameScale))
      : Math.round(Math.max(minRadius, 220 * scene.gameScale));
    const maxRadiusByWidth = isFourBubbleLayout
      ? viewport.width * 0.115
      : viewport.width * 0.22;
    const radius = Math.round(
      Phaser.Math.Clamp(
        Math.min(maxRadiusByWidth, viewport.height * (isFourBubbleLayout ? 0.16 : 0.26)),
        minRadius,
        maxRadius
      )
    );
    const horizontalPadding = radius + Math.round(Math.max(12, 16 * scene.gameScale));
    const spawnY = -radius + Math.round(Math.max(18, 26 * scene.gameScale));
    const spawnSlots = resolveBubbleSpawnSlots(optionCount);

    return wave.options.map((option, index) => {
      const questionItem = this.getQuestionByText(option.question);
      const textureKey = questionItem ? scene.getImageTextureKey(questionItem, scene.currentTheme) : '';
      const resolvedTextureKey = textureKey && scene.textures.exists(textureKey) ? textureKey : null;
      const imageAspectRatio = resolvedTextureKey ? scene.getTextureAspectRatio(resolvedTextureKey) : 1;
      const slot = spawnSlots[index] ?? spawnSlots[spawnSlots.length - 1] ?? { fractionX: 0.5, offsetY: 0 };
      const jitterX = isFourBubbleLayout
        ? 0
        : (index === 1 ? 0 : Phaser.Math.Between(-12, 12) * scene.gameScale);
      const targetX = Math.round(viewport.width * slot.fractionX + jitterX);
      const x = Phaser.Math.Clamp(
        targetX,
        horizontalPadding,
        Math.max(horizontalPadding, viewport.width - horizontalPadding)
      );
      const y = spawnY + slot.offsetY - Phaser.Math.Between(0, Math.round(18 * scene.gameScale));

      return {
        id: `${option.question}-${index}-${this.waveToken}`,
        word: option.question,
        isCorrect: option.question === wave.prompt.question,
        x,
        y,
        radius,
        textureKey: resolvedTextureKey,
        imageAspectRatio,
        visualSeed: Phaser.Math.FloatBetween(0.08, 0.94)
      };
    });
  }

  private handleCorrectHit(player: BubbleCollisionPlayer, bubbleTarget: BubbleCollisionTarget): void {
    const scene = this.scene;
    const bubbleX = bubbleTarget.x;
    const bubbleY = bubbleTarget.y;
    const transitionToken = ++this.waveToken;

    this.clearWrongHitUnlockTimer();
    scene.player.setGravityY(scene.getScaledPhysicsValue(scene.GRAVITY_Y));
    scene.applyScoreDelta(1);
    scene.jumpBurstEmitter.explode(24, player.x, bubbleY);
    scene.blockDebrisEmitter.explode(14, bubbleX, bubbleY);
    scene.successSound.play();

    this.questionQueue = advanceBubblePopQueue(this.questionQueue);
    this.currentWave = null;
    scene.currentQuestion = null;

    this.bubbleSystem.popBubble(bubbleTarget as unknown as Phaser.Physics.Arcade.Image);

    scene.time.delayedCall(220, () => {
      if (transitionToken !== this.waveToken) {
        return;
      }
      this.bubbleSystem.clearWave();
    });

    if (this.questionQueue.length === 0) {
      this.pendingWaveTimer = scene.time.delayedCall(820, () => {
        if (transitionToken !== this.waveToken) {
          return;
        }
        void scene.showThemeCompletion();
      });
      return;
    }

    this.pendingWaveTimer = scene.time.delayedCall(980, () => {
      if (transitionToken !== this.waveToken) {
        return;
      }
      void this.spawnNextWave();
    });
  }

  private handleWrongHit(bubbleTarget: BubbleCollisionTarget, collisionPlayer: BubbleCollisionPlayer): void {
    const scene = this.scene;
    bubbleTarget.setData('hitLocked', true);
    this.bubbleSystem.applyWrongHitImpulse(
      bubbleTarget as unknown as Phaser.Physics.Arcade.Image,
      collisionPlayer.x,
      collisionPlayer.body.velocity.y
    );

    scene.bumpSound.play();

    // 错误碰撞后短暂增加重力，让玩家快速落回地面
    collisionPlayer.setGravityY(scene.getScaledPhysicsValue(scene.GRAVITY_Y * 2));

    this.clearWrongHitUnlockTimer();
    this.wrongHitUnlockTimer = scene.time.delayedCall(600, () => {
      if (!bubbleTarget.active) {
        return;
      }
      bubbleTarget.setData('hitLocked', false);
      // 恢复正常重力
      collisionPlayer.setGravityY(scene.getScaledPhysicsValue(scene.GRAVITY_Y));
      if (this.currentWave) {
        scene.isInteractionActive = true;
      }
    });
  }

  private maybeRetryCurrentQuestion(): void {
    if (!this._bubbleSystem || !this.currentWave || this.pendingWaveTimer) {
      return;
    }

    const bubbleStates = this._bubbleSystem.getWaveStateSnapshot();
    if (!shouldRetryBubblePopQuestion(bubbleStates)) {
      return;
    }

    this.retryCurrentQuestion();
  }

  private retryCurrentQuestion(): void {
    const scene = this.scene;
    if (!this.currentWave) {
      return;
    }

    const retryPrompt = this.currentWave.prompt.question;
    const retryAnswers = this.currentWave.options.map((option) => option.question);
    this.clearWrongHitUnlockTimer();
    scene.player.setGravityY(scene.getScaledPhysicsValue(scene.GRAVITY_Y));
    scene.isInteractionActive = false;
    scene.currentQuestion = {
      question: retryPrompt,
      answers: retryAnswers,
      correctIndex: retryAnswers.findIndex((answer) => answer === retryPrompt)
    };
    scene.failureSound.play();
    this.bubbleSystem.clearWave();
    this.currentWave = null;
    this.scheduleNextWave(520);
  }

  private cancelPendingWaveTimer(): void {
    if (this.pendingWaveTimer && !this.pendingWaveTimer.hasDispatched) {
      this.pendingWaveTimer.remove(false);
    }
    this.pendingWaveTimer = null;
  }

  private cancelTimers(): void {
    this.cancelPendingWaveTimer();
    this.clearWrongHitUnlockTimer();
    this.waveToken += 1;
  }

  private clearWrongHitUnlockTimer(): void {
    if (this.wrongHitUnlockTimer && !this.wrongHitUnlockTimer.hasDispatched) {
      this.wrongHitUnlockTimer.remove(false);
    }
    this.wrongHitUnlockTimer = null;
  }

  private toQuestionKey(value: string): string {
    return value.trim().toLowerCase();
  }

  private getQuestionByText(questionText: string): ThemeQuestion | undefined {
    const normalizedText = this.toQuestionKey(questionText);
    return this.scene.themeData?.questions.find((questionItem) => (
      this.toQuestionKey(questionItem.question) === normalizedText
    ));
  }

  private playQuestionAudioByText(text: string): void {
    const scene = this.scene;
    const questionItem = this.getQuestionByText(text);
    const audioKey = questionItem ? scene.getAudioCacheKey(questionItem, scene.currentTheme) : '';
    if (!audioKey || !scene.cache.audio.exists(audioKey)) {
      return;
    }

    if (window.setBGMVolume) {
      window.setBGMVolume(0);
    }
    scene.stopPronunciationSound(false);

    try {
      const sound = scene.sound.add(audioKey);
      scene.pronunciationSound = sound;

      sound.once('complete', () => {
        if (scene.pronunciationSound === sound) {
          scene.pronunciationSound = null;
        }
        sound.destroy();
        window.restoreBGMVolume?.();
      });
      sound.once('destroy', () => {
        if (scene.pronunciationSound === sound) {
          scene.pronunciationSound = null;
        }
      });

      const played = sound.play({ volume: scene.PRONUNCIATION_VOLUME });
      if (!played) {
        sound.destroy();
        scene.pronunciationSound = null;
        window.restoreBGMVolume?.();
      }
    } catch (error) {
      console.warn('[MainScene] Failed to play bubble prompt audio', error);
      scene.stopPronunciationSound(true);
    }
  }
}
