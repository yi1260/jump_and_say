import Phaser from 'phaser';
import { BookConfig, level1Config } from '../data/levelConfig';
import type { ThemeQuestion } from '../../types';

export interface Round1Result {
  correctCount: number;
  totalCount: number;
  accuracy: number;
  starCount: number;
}

type GateState = 'locked' | 'unlocking' | 'open' | 'entering' | 'completed';

interface LearningGate {
  gateIndex: number;
  state: GateState;
  block: Phaser.Types.Physics.Arcade.SpriteWithStaticBody;
  blockTween: Phaser.Tweens.Tween;
  doorBottom: Phaser.Types.Physics.Arcade.SpriteWithStaticBody;
  doorTop: Phaser.GameObjects.Image;
  doorBarrier: Phaser.Types.Physics.Arcade.ImageWithStaticBody;
  entryZone: Phaser.GameObjects.Zone;
  promptText: Phaser.GameObjects.Text;
}

interface QuestionAttemptResult {
  listenedCorrectly: boolean;
  pronunciationScore: number;
}

type PlatformSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionEventLike = {
  results: {
    length: number;
    [index: number]: {
      length: number;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type PlatformSpeechRecognitionCtor = new () => PlatformSpeechRecognition;

/**
 * Platform Word Gate System
 *
 * Manages the platformer answer doors:
 * player hits the glowing question block -> key pops out -> door opens ->
 * player walks into the door -> listening quiz -> pronunciation practice.
 */
export class PlatformWordGateSystem {
  private scene: Phaser.Scene;
  private gates: LearningGate[] = [];
  private completedGates: boolean[] = [];
  private onGateCompleteCallbacks: ((gateIndex: number, result: Round1Result) => void)[] = [];
  private activeOverlay: Phaser.GameObjects.Container | null = null;

  private readonly tileSize = 64;
  private readonly quizQuestionCount = 3;
  private readonly fontStack = '"FredokaBoot", "FredokaLatin", "ZCOOL KuaiLe UI", "PingFang SC", Arial, sans-serif';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.completedGates = new Array(level1Config.books.length).fill(false);
  }

  /**
   * Create all gates based on level configuration.
   */
  createGates(gatePositions: number[]): void {
    gatePositions.forEach((x, index) => {
      if (index < level1Config.books.length) {
        this.createGate(x, index);
      }
    });
  }

  private createGate(x: number, gateIndex: number): void {
    const { height } = this.scene.scale.gameSize;
    const groundTop = height - this.tileSize;
    const doorBottomY = groundTop - this.tileSize / 2;
    const doorTopY = doorBottomY - this.tileSize;
    const blockX = x - 250;
    const blockY = groundTop - 190;

    const player = this.getPlayer();

    const leftOverhang = this.scene.physics.add.staticSprite(
      blockX - this.tileSize,
      blockY,
      'terrain_grass_horizontal_overhang_left'
    );
    leftOverhang.setDisplaySize(this.tileSize, this.tileSize);
    leftOverhang.refreshBody();

    const rightOverhang = this.scene.physics.add.staticSprite(
      blockX + this.tileSize,
      blockY,
      'terrain_grass_horizontal_overhang_right'
    );
    rightOverhang.setDisplaySize(this.tileSize, this.tileSize);
    rightOverhang.refreshBody();

    const block = this.scene.physics.add.staticSprite(blockX, blockY, 'block_yellow');
    block.setDisplaySize(this.tileSize, this.tileSize);
    block.refreshBody();

    this.scene.physics.add.collider(player, leftOverhang);
    this.scene.physics.add.collider(player, rightOverhang);

    const doorBottom = this.scene.physics.add.staticSprite(x, doorBottomY, 'door_closed');
    doorBottom.setDisplaySize(this.tileSize, this.tileSize);
    doorBottom.refreshBody();

    const doorTop = this.scene.add.image(x, doorTopY, 'door_closed_top');
    doorTop.setDisplaySize(this.tileSize, this.tileSize);
    doorTop.setDepth(5);

    const doorBarrier = this.scene.physics.add.staticImage(x, groundTop - this.tileSize, 'door_closed');
    doorBarrier.setDisplaySize(74, this.tileSize * 2);
    doorBarrier.setVisible(false);
    doorBarrier.refreshBody();
    this.scene.physics.add.collider(player, doorBarrier);

    const entryZone = this.scene.add.zone(x, groundTop - this.tileSize, 112, this.tileSize * 2);
    this.scene.physics.add.existing(entryZone, true);
    this.scene.physics.add.overlap(
      player,
      entryZone as Phaser.Types.Physics.Arcade.GameObjectWithBody,
      () => this.onDoorEnter(gateIndex),
      undefined,
      this
    );

    const bookConfig = level1Config.books[gateIndex];
    const promptText = this.createGatePrompt(x, doorTopY - 58, bookConfig, gateIndex);

    const blockTween = this.scene.tweens.add({
      targets: block,
      alpha: 0.38,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.createBlockHint(blockX, blockY + 70);

    this.scene.physics.add.collider(
      player,
      block,
      () => this.onGuideBlockHit(gateIndex),
      undefined,
      this
    );

    this.gates[gateIndex] = {
      gateIndex,
      state: 'locked',
      block,
      blockTween,
      doorBottom,
      doorTop,
      doorBarrier,
      entryZone,
      promptText,
    };
    this.completedGates[gateIndex] = false;

    console.log(`[WordGate] Gate ${gateIndex + 1} created at x=${x}.`);
  }

  private createGatePrompt(
    x: number,
    y: number,
    bookConfig: BookConfig,
    gateIndex: number
  ): Phaser.GameObjects.Text {
    const prompt = this.scene.add.text(x, y, `Book ${gateIndex + 1}: ${bookConfig.title}`, {
      fontSize: '22px',
      color: '#ffffff',
      fontFamily: this.fontStack,
      fontStyle: 'bold',
      backgroundColor: '#1f3f5f',
      padding: { x: 16, y: 10 },
    });
    prompt.setOrigin(0.5);
    prompt.setDepth(8);
    prompt.setStroke('#16304a', 5);
    return prompt;
  }

  private createBlockHint(x: number, y: number): void {
    const arrow = this.scene.add.text(x, y, 'v', {
      fontSize: '42px',
      color: '#f3ce3a',
      fontFamily: this.fontStack,
      fontStyle: 'bold',
    });
    arrow.setOrigin(0.5);
    arrow.setAlpha(0.75);
    arrow.setDepth(7);

    this.scene.tweens.add({
      targets: arrow,
      y: y + 16,
      alpha: 0.25,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private async onGuideBlockHit(gateIndex: number): Promise<void> {
    const gate = this.gates[gateIndex];
    if (!gate || gate.state !== 'locked') return;

    console.log(`[WordGate] Gate ${gateIndex + 1} question block hit.`);
    gate.state = 'unlocking';
    this.setWorldPaused(true);

    gate.blockTween.stop();
    gate.block.setAlpha(1);
    gate.block.setScale(1);
    gate.block.setTint(0xfff176);

    await this.playUnlockSequence(gate);

    gate.state = 'open';
    gate.promptText.setText('门已打开，走进去开始学习');
    gate.promptText.setStyle({
      fontSize: '22px',
      color: '#ffffff',
      fontFamily: this.fontStack,
      fontStyle: 'bold',
      backgroundColor: '#2e7d32',
      padding: { x: 16, y: 10 },
    });
    this.setWorldPaused(false);
  }

  private async playUnlockSequence(gate: LearningGate): Promise<void> {
    const key = this.scene.add.image(gate.block.x, gate.block.y + 4, 'key_yellow');
    key.setDisplaySize(42, 42);
    key.setDepth(20);
    key.setAlpha(0);
    key.setScale(0.35);

    await this.tweenToPromise({
      targets: key,
      y: gate.block.y - 82,
      alpha: 1,
      scale: 1.15,
      angle: 12,
      duration: 420,
      ease: 'Back.out',
    });

    await this.tweenToPromise({
      targets: key,
      x: gate.doorBottom.x,
      y: gate.doorBottom.y - 18,
      scale: 0.72,
      angle: 90,
      duration: 720,
      ease: 'Sine.easeInOut',
    });

    await this.tweenToPromise({
      targets: key,
      scale: 0.35,
      alpha: 0,
      duration: 180,
      ease: 'Sine.easeIn',
    });
    key.destroy();

    this.openDoor(gate);
  }

  private openDoor(gate: LearningGate): void {
    gate.doorBottom.setTexture('door_open');
    gate.doorTop.setTexture('door_open_top');
    gate.doorBarrier.disableBody(true, true);

    this.scene.tweens.add({
      targets: [gate.doorBottom, gate.doorTop],
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 140,
      yoyo: true,
      ease: 'Sine.easeOut',
    });

    const shine = this.scene.add.rectangle(gate.doorBottom.x, gate.doorBottom.y - 30, 86, 132, 0xfff59d, 0.36);
    shine.setDepth(4);
    this.scene.tweens.add({
      targets: shine,
      alpha: 0,
      scaleX: 1.45,
      scaleY: 1.25,
      duration: 460,
      ease: 'Sine.easeOut',
      onComplete: () => shine.destroy(),
    });
  }

  private async onDoorEnter(gateIndex: number): Promise<void> {
    const gate = this.gates[gateIndex];
    if (!gate || gate.state !== 'open') return;

    gate.state = 'entering';
    this.setWorldPaused(true);
    await this.playPlayerEnterDoor(gate);

    const bookConfig = level1Config.books[gateIndex];
    const result = await this.showLearningChallenge(bookConfig);

    this.completedGates[gateIndex] = true;
    gate.state = 'completed';
    gate.promptText.setText('已完成，继续前进');
    gate.promptText.setStyle({
      fontSize: '22px',
      color: '#ffffff',
      fontFamily: this.fontStack,
      fontStyle: 'bold',
      backgroundColor: '#546e7a',
      padding: { x: 16, y: 10 },
    });

    this.applyLearningReward(result);
    this.onGateCompleteCallbacks.forEach(cb => cb(gateIndex, result));
    this.restorePlayerAfterDoor(gate);
    this.setWorldPaused(false);

    console.log(`[WordGate] Gate ${gateIndex + 1} completed.`);
  }

  private async playPlayerEnterDoor(gate: LearningGate): Promise<void> {
    const player = this.getPlayer();
    const body = player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    player.setFlipX(false);
    player.anims.stop();
    player.setTexture('character_beige_idle');

    await this.tweenToPromise({
      targets: player,
      x: gate.doorBottom.x,
      y: gate.doorBottom.y,
      scaleX: 0.68,
      scaleY: 0.68,
      alpha: 0.08,
      duration: 520,
      ease: 'Sine.easeInOut',
    });
  }

  private restorePlayerAfterDoor(gate: LearningGate): void {
    const player = this.getPlayer();
    const exitX = gate.doorBottom.x + 110;
    const exitY = gate.doorBottom.y;

    player.setPosition(exitX, exitY);
    player.setScale(1);
    player.setAlpha(1);
    player.setTexture('character_beige_idle');

    const body = player.body as Phaser.Physics.Arcade.Body;
    body.reset(exitX, exitY);
    body.setVelocity(0, 0);
  }

  private async showLearningChallenge(bookConfig: BookConfig): Promise<Round1Result> {
    const questions = bookConfig.questions.slice(0, this.quizQuestionCount);
    const attempts: QuestionAttemptResult[] = [];

    for (let index = 0; index < questions.length; index += 1) {
      const attempt = await this.showQuestionFlow(bookConfig, questions[index], questions, index);
      attempts.push(attempt);
    }

    const listeningCorrect = attempts.filter(attempt => attempt.listenedCorrectly).length;
    const pronunciationPassed = attempts.filter(attempt => attempt.pronunciationScore >= 60).length;
    const totalChecks = attempts.length * 2;
    const correctCount = listeningCorrect + pronunciationPassed;
    const accuracy = totalChecks > 0 ? correctCount / totalChecks : 0;

    return {
      correctCount,
      totalCount: totalChecks,
      accuracy,
      starCount: correctCount,
    };
  }

  private showQuestionFlow(
    bookConfig: BookConfig,
    question: ThemeQuestion,
    pool: ThemeQuestion[],
    questionIndex: number
  ): Promise<QuestionAttemptResult> {
    return new Promise(resolve => {
      const { width, height } = this.scene.scale.gameSize;
      const centerX = width / 2;
      const centerY = height / 2;
      let listenedCorrectly = false;
      let pronunciationScore = 80;
      let recognition: PlatformSpeechRecognition | null = null;

      const overlay = this.scene.add.container(0, 0);
      overlay.setScrollFactor(0);
      overlay.setDepth(200);
      this.activeOverlay = overlay;

      const dim = this.scene.add.rectangle(0, 0, width, height, 0x0e2035, 0.9)
        .setOrigin(0, 0);
      const card = this.scene.add.rectangle(centerX, centerY, 760, 520, 0xf7fbff, 1)
        .setStrokeStyle(6, 0x2f6fa8);
      const title = this.scene.add.text(centerX, centerY - 210, '听音识图', {
        fontSize: '36px',
        color: '#17324f',
        fontFamily: this.fontStack,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      const subtitle = this.scene.add.text(centerX, centerY - 166, `${bookConfig.title}  ${questionIndex + 1}/${this.quizQuestionCount}`, {
        fontSize: '20px',
        color: '#52708d',
        fontFamily: this.fontStack,
      }).setOrigin(0.5);
      const status = this.scene.add.text(centerX, centerY + 190, '先听声音，再选择对应图片', {
        fontSize: '24px',
        color: '#17324f',
        fontFamily: this.fontStack,
        fontStyle: 'bold',
      }).setOrigin(0.5);

      overlay.add([dim, card, title, subtitle, status]);

      const replayButton = this.createOverlayButton(centerX - 150, centerY + 130, 220, 54, '再听一次', 0x2f6fa8);
      const nextButton = this.createOverlayButton(centerX + 150, centerY + 130, 220, 54, '进入跟读', 0x8d6e63);
      nextButton.container.setVisible(false);
      overlay.add([replayButton.container, nextButton.container]);

      const candidates = this.getListeningCandidates(question, pool);
      const cardWidth = 178;
      const gap = 34;
      const startX = centerX - cardWidth - gap;
      const optionCards = candidates.map((candidate, index) => {
        const optionX = startX + index * (cardWidth + gap);
        const option = this.createPictureOption(optionX, centerY - 30, cardWidth, 210, candidate);
        overlay.add(option.container);
        option.container.setInteractive(new Phaser.Geom.Rectangle(-cardWidth / 2, -105, cardWidth, 210), Phaser.Geom.Rectangle.Contains);
        option.container.on('pointerdown', () => {
          if (nextButton.container.visible) return;
          listenedCorrectly = candidate.question === question.question;
          option.frame.setStrokeStyle(6, listenedCorrectly ? 0x43a047 : 0xe53935);
          status.setText(listenedCorrectly ? '答对了，现在大声跟读' : `正确答案：${this.cleanQuestionText(question.question)}`);
          optionCards.forEach(item => item.container.disableInteractive());
          nextButton.container.setVisible(true);
        });
        return option;
      });

      replayButton.bg.on('pointerdown', () => this.speakQuestion(question.question));
      nextButton.bg.on('pointerdown', () => {
        title.setText('大声跟读');
        subtitle.setText(this.cleanQuestionText(question.question));
        status.setText('点击开始，跟读屏幕上的句子');
        optionCards.forEach(item => item.container.setVisible(false));
        replayButton.label.setText('播放示范');
        nextButton.label.setText('开始跟读');
        nextButton.bg.setFillStyle(0x2f6fa8);

        const finishButton = this.createOverlayButton(centerX + 150, centerY + 130, 220, 54, '完成演示', 0x43a047);
        overlay.add(finishButton.container);
        finishButton.container.setVisible(false);

        const wordText = this.scene.add.text(centerX, centerY - 28, this.cleanQuestionText(question.question), {
          fontSize: '58px',
          color: '#17324f',
          fontFamily: this.fontStack,
          fontStyle: 'bold',
        }).setOrigin(0.5);
        const transcriptText = this.scene.add.text(centerX, centerY + 62, '', {
          fontSize: '22px',
          color: '#52708d',
          fontFamily: this.fontStack,
        }).setOrigin(0.5);
        overlay.add([wordText, transcriptText]);

        replayButton.bg.removeAllListeners('pointerdown');
        replayButton.bg.on('pointerdown', () => this.speakQuestion(question.question));

        nextButton.bg.removeAllListeners('pointerdown');
        nextButton.bg.on('pointerdown', () => {
          nextButton.container.setVisible(false);
          finishButton.container.setVisible(true);
          status.setText('录音中...');
          recognition = this.startRecognition(
            question.question,
            transcript => {
              transcriptText.setText(`识别到：${transcript}`);
              pronunciationScore = this.scorePronunciation(question.question, transcript);
              status.setText(pronunciationScore >= 60 ? `跟读通过：${pronunciationScore}` : `还可以再试：${pronunciationScore}`);
            },
            () => {
              status.setText('未检测到语音，可点击完成演示继续');
            }
          );
          if (!recognition) {
            status.setText('当前浏览器不支持语音识别，点击完成演示继续');
          }
        });

        finishButton.bg.on('pointerdown', () => {
          try {
            recognition?.stop();
          } catch (error) {
            console.warn('[WordGate] Failed to stop recognition.', error);
          }
          overlay.destroy();
          this.activeOverlay = null;
          resolve({ listenedCorrectly, pronunciationScore });
        });
      });

      this.scene.time.delayedCall(280, () => this.speakQuestion(question.question));
    });
  }

  private getListeningCandidates(question: ThemeQuestion, pool: ThemeQuestion[]): ThemeQuestion[] {
    const distractors = pool
      .filter(item => item.question !== question.question)
      .slice(0, 2);
    return Phaser.Utils.Array.Shuffle([question, ...distractors]).slice(0, 3);
  }

  private createPictureOption(
    x: number,
    y: number,
    width: number,
    height: number,
    question: ThemeQuestion
  ): {
    container: Phaser.GameObjects.Container;
    frame: Phaser.GameObjects.Rectangle;
  } {
    const container = this.scene.add.container(x, y);
    const frame = this.scene.add.rectangle(0, 0, width, height, 0xffffff, 1)
      .setStrokeStyle(4, 0xb8c7d8);
    const symbol = this.scene.add.text(0, -30, this.getPictureSymbol(question.question), {
      fontSize: '62px',
      color: this.getPictureColor(question.question),
      fontFamily: this.fontStack,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const caption = this.scene.add.text(0, 72, 'Picture', {
      fontSize: '20px',
      color: '#6a7f95',
      fontFamily: this.fontStack,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    container.add([frame, symbol, caption]);
    return { container, frame };
  }

  private createOverlayButton(
    x: number,
    y: number,
    width: number,
    height: number,
    labelText: string,
    color: number
  ): {
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
  } {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.rectangle(0, 0, width, height, color, 1);
    const label = this.scene.add.text(0, 0, labelText, {
      fontSize: '22px',
      color: '#ffffff',
      fontFamily: this.fontStack,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setAlpha(0.86));
    bg.on('pointerout', () => bg.setAlpha(1));
    container.add([bg, label]);
    return { container, bg, label };
  }

  private speakQuestion(questionText: string): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(this.cleanQuestionText(questionText));
      utterance.lang = 'en-US';
      utterance.rate = 0.82;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('[WordGate] Speech synthesis failed.', error);
    }
  }

  private startRecognition(
    targetText: string,
    onTranscript: (transcript: string) => void,
    onEndWithoutResult: () => void
  ): PlatformSpeechRecognition | null {
    if (typeof window === 'undefined') return null;

    const recognitionWindow = window as Window & {
      SpeechRecognition?: PlatformSpeechRecognitionCtor;
      webkitSpeechRecognition?: PlatformSpeechRecognitionCtor;
    };
    const RecognitionCtor = recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition;
    if (!RecognitionCtor) return null;

    const recognition = new RecognitionCtor();
    let hasResult = false;

    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      const result = event.results.length > 0 ? event.results[0] : null;
      const transcript = result && result.length > 0 ? result[0].transcript : '';
      hasResult = transcript.trim().length > 0;
      onTranscript(transcript || this.cleanQuestionText(targetText));
    };
    recognition.onerror = () => {
      onEndWithoutResult();
    };
    recognition.onend = () => {
      if (!hasResult) onEndWithoutResult();
    };

    try {
      recognition.start();
    } catch (error) {
      console.warn('[WordGate] Speech recognition start failed.', error);
      return null;
    }

    this.scene.time.delayedCall(4600, () => {
      try {
        recognition.stop();
      } catch (error) {
        console.warn('[WordGate] Speech recognition timeout stop failed.', error);
      }
    });

    return recognition;
  }

  private scorePronunciation(targetText: string, transcript: string): number {
    const target = this.normalizeForSpeech(targetText);
    const spoken = this.normalizeForSpeech(transcript);
    if (!target || !spoken) return 0;
    if (spoken === target || spoken.includes(target) || target.includes(spoken)) return 100;

    const targetWords = new Set(target.split(' '));
    const spokenWords = spoken.split(' ');
    const matched = spokenWords.filter(word => targetWords.has(word)).length;
    return Math.round((matched / Math.max(1, targetWords.size)) * 100);
  }

  private normalizeForSpeech(text: string): string {
    return this.cleanQuestionText(text)
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanQuestionText(questionText: string): string {
    return questionText.replace(/\s+/g, ' ').trim();
  }

  private getPictureSymbol(questionText: string): string {
    const word = this.normalizeForSpeech(questionText).split(' ')[0] || '?';
    const symbolMap: Record<string, string> = {
      red: 'R',
      blue: 'B',
      green: 'G',
      yellow: 'Y',
      orange: 'O',
      purple: 'P',
      black: 'B',
      white: 'W',
    };
    return symbolMap[word] || word.charAt(0).toUpperCase();
  }

  private getPictureColor(questionText: string): string {
    const word = this.normalizeForSpeech(questionText).split(' ')[0] || '';
    const colorMap: Record<string, string> = {
      red: '#e53935',
      blue: '#1e88e5',
      green: '#43a047',
      yellow: '#fbc02d',
      orange: '#fb8c00',
      purple: '#8e24aa',
      black: '#212121',
      white: '#90a4ae',
    };
    return colorMap[word] || '#2f6fa8';
  }

  private applyLearningReward(result: Round1Result): void {
    const shieldDuration = this.calculateShieldDuration(result.accuracy);
    if (shieldDuration <= 0) return;

    const shieldLevel = this.getShieldLevel(shieldDuration);
    const playerControlSystem = (this.scene as Phaser.Scene & {
      playerControlSystem?: {
        activateShield(duration: number, level: 'blue' | 'green' | 'gold'): void;
      };
    }).playerControlSystem;

    if (playerControlSystem) {
      playerControlSystem.activateShield(shieldDuration, shieldLevel);
      this.showShieldGetFeedback(shieldLevel, result.accuracy);
    }
  }

  private calculateShieldDuration(accuracy: number): number {
    if (accuracy >= 1.0) return 6;
    if (accuracy >= 0.8) return 5;
    if (accuracy >= 0.6) return 3;
    return 0;
  }

  private getShieldLevel(duration: number): 'blue' | 'green' | 'gold' {
    if (duration >= 6) return 'gold';
    if (duration >= 5) return 'green';
    return 'blue';
  }

  private showShieldGetFeedback(shieldLevel: 'blue' | 'green' | 'gold', accuracy: number): void {
    const { width, height } = this.scene.scale.gameSize;
    const centerX = width / 2;
    const centerY = height / 2;
    const colorMap = { blue: '#4A90E2', green: '#4CAF50', gold: '#FFD700' };
    const color = colorMap[shieldLevel];
    const label = accuracy >= 1 ? 'Perfect shield!' : 'Shield get!';

    const feedbackText = this.scene.add.text(centerX, centerY - 50, label, {
      fontSize: '46px',
      color,
      fontFamily: this.fontStack,
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(220);

    feedbackText.setScale(0);
    this.scene.tweens.add({
      targets: feedbackText,
      scale: 1,
      duration: 320,
      ease: 'Back.out',
    });

    this.scene.time.delayedCall(1300, () => {
      this.scene.tweens.add({
        targets: feedbackText,
        alpha: 0,
        y: centerY - 100,
        duration: 260,
        onComplete: () => feedbackText.destroy(),
      });
    });
  }

  private setWorldPaused(paused: boolean): void {
    const platformScene = this.scene as Phaser.Scene & {
      setPaused?: (paused: boolean) => void;
      playerControlSystem?: { setPaused(paused: boolean): void };
      enemySystem?: { pauseAll(): void; resumeAll(): void };
    };

    platformScene.setPaused?.(paused);
    platformScene.playerControlSystem?.setPaused(paused);

    if (paused) {
      this.scene.physics.pause();
      platformScene.enemySystem?.pauseAll();
    } else {
      this.scene.physics.resume();
      platformScene.enemySystem?.resumeAll();
    }
  }

  private tweenToPromise(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise(resolve => {
      this.scene.tweens.add({
        ...config,
        onComplete: () => resolve(),
      });
    });
  }

  private getPlayer(): Phaser.Physics.Arcade.Sprite {
    return (this.scene as Phaser.Scene & {
      player?: Phaser.Physics.Arcade.Sprite;
    }).player as Phaser.Physics.Arcade.Sprite;
  }

  /**
   * Register callback for gate completion (used for star tracking).
   */
  onGateComplete(callback: (gateIndex: number, result: Round1Result) => void): void {
    this.onGateCompleteCallbacks.push(callback);
  }

  /**
   * Check if all gates are completed.
   */
  areAllGatesCompleted(): boolean {
    return this.completedGates.every(completed => completed);
  }

  /**
   * Get total stars earned across all completed gates.
   */
  getTotalStars(): number {
    return this.completedGates.filter(Boolean).length;
  }
}
