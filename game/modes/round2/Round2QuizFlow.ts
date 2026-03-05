import Phaser from 'phaser';
import type { ModeSystems, RuntimeCallbackBridge } from '../core/types';
import type { QuestionData, Theme, ThemeQuestion } from '../../../types';

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

interface QuizCollisionPlayer {
  x: number;
  y: number;
  displayHeight: number;
  body: Phaser.Physics.Arcade.Body;
  setAngle(value: number): void;
  setGravityY(value: number): void;
}

interface QuizCollisionBlock {
  active: boolean;
  x: number;
  y: number;
  body: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;
  getData(key: string): unknown;
  setData(key: string, value: unknown): void;
  disableBody(disableGameObject?: boolean, hideGameObject?: boolean): void;
}

interface Round2SceneInternal {
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
  time: Phaser.Time.Clock;
  blocks: Phaser.Physics.Arcade.StaticGroup;
  textures: Phaser.Textures.TextureManager;
  modeSystems: ModeSystems | null;
  cache: Phaser.Cache.CacheManager;
  sound: Phaser.Sound.BaseSoundManager;
  callbackBridge: RuntimeCallbackBridge;
  successSound: Phaser.Sound.BaseSound;
  failureSound: Phaser.Sound.BaseSound;
  pronunciationSound: Phaser.Sound.BaseSound | null;
  PRONUNCIATION_VOLUME: number;
  isInteractionActive: boolean;
  imagesLoaded: boolean;
  hasPreloadedNext: boolean;
  currentQuestion: QuestionData | null;
  questionCounter: number;
  wrongAttempts: number;
  beeContainer?: Phaser.GameObjects.Container;
  beeSprite?: Phaser.GameObjects.Sprite;
  beeWordText?: Phaser.GameObjects.Text;
  blockCenterY: number;
  currentAnswerKeys: string[];
  currentAnswerRatios: number[];
  activeCardLayouts: AnswerCardLayout[];
  LANE_X_POSITIONS: number[];
  targetLaneIndex: number;
  blockHeight: number;
  gameScale: number;
  CARD_IMAGE_INSET_BASE: number;
  isMobileDevice: boolean;
  floorSurfaceY: number;
  GRAVITY_Y: number;
  score: number;
  totalQuestions: number;
  themeScore: number;
  themeData: Theme | null;
  themeWordPool: string[];
  lastQuestionWord: string;
  currentTheme: string;
  loadThemeImages(): Promise<void>;
  preloadNextTheme(): Promise<void>;
  showThemeCompletion(): Promise<void>;
  getImageTextureKey(questionItem: ThemeQuestion, themeId: string): string;
  getAudioCacheKey(questionItem: ThemeQuestion, themeId: string): string;
  stopPronunciationSound(restoreBgmVolume?: boolean): void;
  updateBeeWord(text: string): void;
  forceDestroyAllBlockVisuals(): void;
  getCurrentViewportSize(): ViewportSize;
  recalcLayout(width: number, height: number): void;
  updateSceneBounds(width: number, height: number): void;
  getTextureAspectRatio(textureKey: string): number;
  refreshThemeFrameMode(): void;
  computeAnswerCardLayouts(answerRatios: number[], safeWidth: number, safeHeight: number): AnswerCardLayout[];
  getMaxCardHeight(layouts: AnswerCardLayout[]): number;
  updateJumpVelocityByCardHeight(cardHeight: number): void;
  constrainCardLayout(layout: AnswerCardLayout, safeWidth: number, safeHeight: number): AnswerCardLayout;
  getLaneXPosition(index: number): number;
  getScaledPhysicsValue(baseValue: number): number;
  destroyBlockVisual(visual?: Phaser.GameObjects.Container): void;
  cleanupBlocks(): void;
}

export class Round2QuizFlow {
  private readonly sceneRef: unknown;

  constructor(scene: unknown) {
    this.sceneRef = scene;
  }

  private get scene(): Round2SceneInternal {
    return this.sceneRef as Round2SceneInternal;
  }

  public setupThemeData(theme: Theme): void {
    const scene = this.scene;
    scene.themeData = theme;
    scene.themeWordPool = theme.questions.map((questionItem: ThemeQuestion) => questionItem.question);
    scene.totalQuestions = scene.themeWordPool.length;
    Phaser.Utils.Array.Shuffle(scene.themeWordPool);

    if (scene.callbackBridge.onScoreUpdate) {
      scene.callbackBridge.onScoreUpdate(scene.score, scene.totalQuestions);
    }

    if (!scene.currentQuestion) {
      scene.time.delayedCall(100, () => {
        void this.spawnQuestion();
      });
    }
  }

  public async spawnQuestion(): Promise<void> {
    const scene = this.scene;
    scene.isInteractionActive = false;

    if (!scene.imagesLoaded) {
      console.log('[spawnQuestion] Waiting for theme images to load...');
      await scene.loadThemeImages();
      console.log('[spawnQuestion] Theme images ready, proceeding with question spawn');
    }

    if (!scene.hasPreloadedNext) {
      scene.hasPreloadedNext = true;
      void scene.preloadNextTheme();
    }

    const question = this.generateWordQuestion();
    if (!question) {
      void scene.showThemeCompletion();
      return;
    }

    scene.currentQuestion = question;
    this.playQuestionAudioByText(scene.currentQuestion.question);
    scene.questionCounter += 1;
    scene.wrongAttempts = 0;
    scene.updateBeeWord(scene.currentQuestion.question);

    scene.forceDestroyAllBlockVisuals();
    scene.blocks.clear(true, true);

    if (scene.beeContainer && !scene.beeContainer.active) {
      scene.beeContainer = undefined;
      scene.beeSprite = undefined;
      scene.beeWordText = undefined;
    }

    const entranceDuration = 300;
    const stagger = 80;
    const totalSetupTime = entranceDuration + (stagger * 2);

    const viewport = scene.getCurrentViewportSize();
    const width = viewport.width;
    const height = viewport.height;
    scene.recalcLayout(width, height);
    scene.updateSceneBounds(width, height);
    const blockY = scene.blockCenterY;

    scene.currentAnswerKeys = [...scene.currentQuestion.answers];
    scene.currentAnswerRatios = scene.currentAnswerKeys.map((answerKey) => {
      const imageKey = this.getImageTextureKeyByAnswer(answerKey);
      return scene.getTextureAspectRatio(imageKey);
    });
    scene.refreshThemeFrameMode();
    scene.activeCardLayouts = scene.computeAnswerCardLayouts(scene.currentAnswerRatios, width, height);
    scene.LANE_X_POSITIONS = scene.activeCardLayouts.map((layout) => layout.centerX);
    scene.targetLaneIndex = Phaser.Math.Clamp(
      scene.targetLaneIndex,
      0,
      Math.max(0, scene.LANE_X_POSITIONS.length - 1)
    );
    if (scene.activeCardLayouts.length > 0) {
      scene.updateJumpVelocityByCardHeight(scene.getMaxCardHeight(scene.activeCardLayouts));
    }

    scene.currentQuestion.answers.forEach((answerKey, i) => {
      const rawLayout = scene.activeCardLayouts[i];
      const layout = rawLayout ? scene.constrainCardLayout(rawLayout, width, height) : undefined;
      const x = Math.round(layout?.centerX ?? scene.LANE_X_POSITIONS[i] ?? scene.getLaneXPosition(1));
      const cardWidth = Math.round(layout?.cardWidth ?? scene.blockHeight);
      const cardHeight = Math.round(layout?.cardHeight ?? scene.blockHeight);
      const imageKey = this.getImageTextureKeyByAnswer(answerKey);
      const textureKey = imageKey && scene.textures.exists(imageKey) ? imageKey : 'tile_box';
      const borderThickness = Math.max(4, Math.round(6 * scene.gameScale));
      const innerBorderThickness = Math.max(2, Math.round(3 * scene.gameScale));
      const shadowOffsetY = Math.max(4, 8 * scene.gameScale);

      const block = scene.blocks.create(x, blockY, 'block_hitbox');
      block.setOrigin(0.5);
      block.setDisplaySize(cardWidth, cardHeight);
      block.refreshBody();
      block.setVisible(false);
      block.setAlpha(0);
      block.setData('answerIndex', i);
      block.setData('answerKey', answerKey);
      block.setData('imageKey', textureKey);
      block.setData('isCleaningUp', false);

      const container = scene.add.container(x, blockY);
      const frameShadow = scene.add
        .rectangle(
          0,
          shadowOffsetY,
          cardWidth + borderThickness * 1.4,
          cardHeight + borderThickness * 1.6,
          0x202432,
          0.28
        )
        .setOrigin(0.5);
      const frame = scene.add
        .rectangle(0, 0, cardWidth, cardHeight, 0xffffff, 0.98)
        .setOrigin(0.5)
        .setStrokeStyle(borderThickness, 0x2f3442, 1);
      const innerFrame = scene.add
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
      const icon = scene.add.image(0, 0, textureKey);

      if (layout) {
        icon.setDisplaySize(layout.iconWidth, layout.iconHeight);
      } else {
        const fallbackInset = Math.max(2, Math.round(scene.CARD_IMAGE_INSET_BASE * scene.gameScale));
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

      if (!scene.isMobileDevice) {
        scene.tweens.add({
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

      container.setScale(0);
      scene.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        duration: entranceDuration,
        delay: i * stagger,
        ease: 'Back.easeOut'
      });
    });

    scene.time.delayedCall(totalSetupTime, () => {
      scene.isInteractionActive = true;
    });
  }

  public handlePlayerHitBlock(player: unknown, block: unknown): void {
    const scene = this.scene;
    const collisionPlayer = player as QuizCollisionPlayer;
    const collisionBlock = block as QuizCollisionBlock;

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

    const idx = collisionBlock.getData('answerIndex');
    const visuals = collisionBlock.getData('visuals') as Phaser.GameObjects.Container | undefined;
    const isCorrect = idx === scene.currentQuestion?.correctIndex;

    if (isCorrect) {
      collisionBlock.disableBody(true, false);
      scene.successSound.play();

      if (visuals) {
        scene.modeSystems?.reward.playBlockExplosion(collisionBlock.x, collisionBlock.y);
      }

      const shouldAwardReward = scene.wrongAttempts < 2;
      let scoreSettleDelayMs = 0;
      if (shouldAwardReward && scene.modeSystems) {
        scoreSettleDelayMs = scene.modeSystems.reward.playQuizCollisionReward({
          blockX: collisionBlock.x,
          blockY: collisionBlock.y
        });
      }

      if (visuals) {
        scene.tweens.add({
          targets: visuals,
          scaleX: 1.5,
          scaleY: 1.5,
          alpha: 0,
          duration: 200,
          onComplete: () => {
            scene.destroyBlockVisual(visuals);
            collisionBlock.setData('visuals', undefined);
          }
        });
      }

      this.handleWin(scoreSettleDelayMs);
      return;
    }

    scene.failureSound.play();
    scene.wrongAttempts += 1;

    if (scene.currentQuestion) {
      this.playQuestionAudioByText(scene.currentQuestion.question);
    }

    if (visuals) {
      scene.tweens.add({
        targets: visuals,
        x: visuals.x + 10,
        duration: 50,
        yoyo: true,
        repeat: 5,
        ease: 'Sine.easeInOut'
      });
    }

    collisionPlayer.setGravityY(scene.getScaledPhysicsValue(scene.GRAVITY_Y * 2));
    scene.time.delayedCall(1200, () => {
      collisionPlayer.setGravityY(scene.getScaledPhysicsValue(scene.GRAVITY_Y));
      scene.isInteractionActive = true;
    });
  }

  private handleWin(scoreSettleDelayMs: number = 0): void {
    const scene = this.scene;
    scene.time.delayedCall(500, () => scene.cleanupBlocks());
    const nextQuestionDelayMs = Math.max(1500, scoreSettleDelayMs + 60);
    scene.time.delayedCall(nextQuestionDelayMs, () => {
      void this.spawnQuestion();
    });
  }

  private toQuestionKey(questionText: string): string {
    return questionText.replace(/^[Tt]he\s+/i, '').replace(/\s+/g, '_').toUpperCase();
  }

  private getQuestionByAnswerKey(answerKey: string): ThemeQuestion | undefined {
    const scene = this.scene;
    return scene.themeData?.questions.find((questionItem) => (
      this.toQuestionKey(questionItem.question) === answerKey
    ));
  }

  private getImageTextureKeyByAnswer(answerKey: string): string {
    const scene = this.scene;
    const questionItem = this.getQuestionByAnswerKey(answerKey);
    if (!questionItem) return '';
    return scene.getImageTextureKey(questionItem, scene.currentTheme);
  }

  private generateWordQuestion(): QuestionData | null {
    const scene = this.scene;
    if (scene.themeWordPool.length === 0) {
      return null;
    }

    const themeWords = scene.themeData
      ? scene.themeData.questions.map((questionItem) => this.toQuestionKey(questionItem.question))
      : [];

    let selectedIndex = -1;
    for (let i = 0; i < scene.themeWordPool.length; i += 1) {
      if (scene.themeWordPool[i] !== scene.lastQuestionWord) {
        selectedIndex = i;
        break;
      }
    }
    if (selectedIndex === -1) {
      selectedIndex = 0;
    }

    const correctRawWord = scene.themeWordPool.splice(selectedIndex, 1)[0];
    scene.lastQuestionWord = correctRawWord;
    const correctKey = this.toQuestionKey(correctRawWord);

    let distractors = themeWords.filter((word) => word !== correctKey);
    distractors = Phaser.Utils.Array.Shuffle(distractors).slice(0, 2);

    const answers = [correctKey, ...distractors]
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value);

    return {
      question: correctRawWord,
      answers,
      correctIndex: answers.indexOf(correctKey)
    };
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
    if (!audioKey) {
      console.warn(`[MainScene] Missing audio mapping for question: ${text}`);
      return;
    }
    if (!scene.cache.audio.exists(audioKey)) {
      console.warn(`[MainScene] Audio cache missing: ${audioKey}`);
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
      console.warn('[MainScene] Failed to play question audio', error);
      scene.stopPronunciationSound(true);
    }
  }
}
