import type { ThemeQuestion } from '../../../types';

export interface BubblePopWaveDefinition {
  prompt: ThemeQuestion;
  options: ThemeQuestion[];
}

export interface BubbleWaveBubbleState {
  isCorrect: boolean;
  hasLanded: boolean;
  isPopping?: boolean;
  active?: boolean;
}

export interface BubbleHeadHitCheckInput {
  playerX: number;
  playerY: number;
  playerDisplayHeight: number;
  playerBodyWidth: number;
  playerVelocityY: number;
  bubbleX: number;
  bubbleY: number;
  bubbleRadius: number;
}

export interface BubbleHeadHitImpulseInput {
  bubbleX: number;
  playerX: number;
  bubbleRadius: number;
  playerVelocityY: number;
}

export interface BubbleHeadHitImpulse {
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
  impulseDurationMs: number;
}

export interface BubbleSpawnSlot {
  fractionX: number;
  offsetY: number;
}

export type BubblePopRandom = () => number;

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const getRandom = (randomFn?: BubblePopRandom): BubblePopRandom => {
  return typeof randomFn === 'function' ? randomFn : Math.random;
};

export const createBubblePopQueue = (
  questions: ThemeQuestion[],
  randomFn?: BubblePopRandom
): ThemeQuestion[] => {
  const nextQueue = [...questions];
  const random = getRandom(randomFn);

  for (let index = nextQueue.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = nextQueue[index];
    nextQueue[index] = nextQueue[swapIndex];
    nextQueue[swapIndex] = current;
  }

  return nextQueue;
};

export const createBubblePopWave = (
  queue: ThemeQuestion[],
  allQuestions: ThemeQuestion[],
  randomFn?: BubblePopRandom
): BubblePopWaveDefinition | null => {
  const prompt = queue[0];
  if (!prompt) {
    return null;
  }

  const distractorPool = allQuestions.filter((question) => question.question !== prompt.question);
  if (distractorPool.length < 3) {
    return null;
  }

  const random = getRandom(randomFn);
  const distractors = createBubblePopQueue(distractorPool, random).slice(0, 3);
  const options = createBubblePopQueue([prompt, ...distractors], random);

  return {
    prompt,
    options
  };
};

export const resolveBubbleSpawnSlots = (optionCount: number): BubbleSpawnSlot[] => {
  if (optionCount >= 4) {
    return [
      { fractionX: 0.14, offsetY: 0 },
      { fractionX: 0.38, offsetY: 0 },
      { fractionX: 0.62, offsetY: 0 },
      { fractionX: 0.86, offsetY: 0 }
    ];
  }

  return [
    { fractionX: 0.20, offsetY: 0 },
    { fractionX: 0.50, offsetY: 0 },
    { fractionX: 0.80, offsetY: 0 }
  ];
};

export const advanceBubblePopQueue = (queue: ThemeQuestion[]): ThemeQuestion[] => {
  if (queue.length === 0) {
    return [];
  }

  return queue.slice(1);
};

export const shouldRetryBubblePopQuestion = (
  bubbles: BubbleWaveBubbleState[]
): boolean => {
  const activeBubbles = bubbles.filter((bubble) => bubble.active !== false);
  if (activeBubbles.length === 0) {
    return false;
  }

  if (activeBubbles.some((bubble) => bubble.isPopping === true)) {
    return false;
  }

  const hasCorrectBubble = activeBubbles.some((bubble) => bubble.isCorrect);

  return hasCorrectBubble && activeBubbles.every((bubble) => bubble.hasLanded);
};

export const shouldRegisterBubbleHeadHit = (
  input: BubbleHeadHitCheckInput
): boolean => {
  const safeDisplayHeight = Math.max(1, input.playerDisplayHeight);
  const safeBodyWidth = Math.max(1, input.playerBodyWidth);
  const safeBubbleRadius = Math.max(1, input.bubbleRadius);

  const playerTopY = input.playerY - safeDisplayHeight;
  const foreheadY = playerTopY + safeDisplayHeight * 0.12;
  const foreheadHalfWidth = safeBodyWidth * 0.14;
  const foreheadTouchRadius = Math.max(6, safeBodyWidth * 0.08);
  const maxDownwardTouchVelocity = Math.max(72, safeBubbleRadius * 0.72);

  if (input.playerVelocityY > maxDownwardTouchVelocity) {
    return false;
  }

  const nearestX = clamp(
    input.bubbleX,
    input.playerX - foreheadHalfWidth,
    input.playerX + foreheadHalfWidth
  );
  const dx = input.bubbleX - nearestX;
  const dy = input.bubbleY - foreheadY;
  const touchDistance = safeBubbleRadius + foreheadTouchRadius;

  return dx * dx + dy * dy <= touchDistance * touchDistance;
};

export const createBubbleHeadHitImpulse = (
  input: BubbleHeadHitImpulseInput
): BubbleHeadHitImpulse => {
  const safeBubbleRadius = Math.max(48, input.bubbleRadius);
  const upwardPlayerSpeed = Math.max(0, -input.playerVelocityY);
  const normalizedOffset = clamp(
    (input.bubbleX - input.playerX) / Math.max(safeBubbleRadius * 0.78, 1),
    -1,
    1
  );
  const direction = normalizedOffset === 0 ? 1 : Math.sign(normalizedOffset);
  const lateralStrength = Math.abs(normalizedOffset);

  return {
    velocityX: Math.round(direction * clamp(
      safeBubbleRadius * (0.88 + lateralStrength * 0.42),
      100,
      180
    )),
    velocityY: -Math.round(clamp(
      safeBubbleRadius * 3.55 + upwardPlayerSpeed * 0.34,
      420,
      760
    )),
    angularVelocity: Math.round(direction * clamp(
      110 + lateralStrength * 70 + safeBubbleRadius * 0.22,
      120,
      220
    )),
    impulseDurationMs: 460
  };
};
