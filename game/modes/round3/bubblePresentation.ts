export interface BubbleDriftConfig {
  baseFallSpeed: number;
  baseDriftX: number;
  swayAmplitude: number;
  swayFrequency: number;
  microSwayAmplitude: number;
  microSwayFrequency: number;
  liftAmplitude: number;
  liftFrequency: number;
  microLiftAmplitude: number;
  microLiftFrequency: number;
  rotationAmplitude: number;
  rotationFrequency: number;
  phaseA: number;
  phaseB: number;
  phaseC: number;
}

export interface BubblePresentationSpec {
  shellWidth: number;
  shellHeight: number;
  bodyRadius: number;
  cardWidth: number;
  cardHeight: number;
  imageWidth: number;
  imageHeight: number;
  drift: BubbleDriftConfig;
}

export interface BubbleDriftSample {
  velocityX: number;
  velocityY: number;
  hoverOffsetY: number;
  rotation: number;
}

export interface BubbleFloatVelocityInput {
  bubbleY: number;
  anchorY: number;
  bubbleRadius: number;
  fallVelocityY: number;
  hoverOffsetY: number;
}

export interface Round3BubblePalette {
  shellFillColor: number;
  shellFillAlpha: number;
  shellStrokeColor: number;
  shellStrokeAlpha: number;
  cardFillColor: number;
  cardStrokeColor: number;
  cardStrokeAlpha: number;
  textColor: string;
}

export const ROUND3_BUBBLE_PALETTE: Round3BubblePalette = {
  shellFillColor: 0xffd6e8,
  shellFillAlpha: 0.12,
  shellStrokeColor: 0xff8fbd,
  shellStrokeAlpha: 0.58,
  cardFillColor: 0xfffbfe,
  cardStrokeColor: 0xffbdd8,
  cardStrokeAlpha: 0.92,
  textColor: '#7a184a'
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const buildBubblePresentation = (
  radius: number,
  imageAspectRatio: number,
  seed: number
): BubblePresentationSpec => {
  const safeRadius = Math.max(48, radius);
  const safeAspectRatio = clamp(
    Number.isFinite(imageAspectRatio) && imageAspectRatio > 0 ? imageAspectRatio : 1,
    0.68,
    1.5
  );
  const safeSeed = clamp(Number.isFinite(seed) ? seed : 0.5, 0, 1);

  // 单圆形泡泡 - 物理体 = 视觉半径
  const bodyRadius = safeRadius;
  const shellWidth = safeRadius * 2;
  const shellHeight = safeRadius * 2;

  // 卡片填充泡泡直径的 ~78%，让图片在泡泡里更饱满
  const cardWidthRatio = safeAspectRatio >= 1 ? 1.62 : 1.52;
  const cardHeightRatio = safeAspectRatio >= 1 ? 1.56 : 1.64;
  const cardMaxWidth = safeRadius * cardWidthRatio;
  const cardMaxHeight = safeRadius * cardHeightRatio;

  let cardWidth = cardMaxWidth;
  let cardHeight = cardWidth / safeAspectRatio;
  if (cardHeight > cardMaxHeight) {
    cardHeight = cardMaxHeight;
    cardWidth = cardHeight * safeAspectRatio;
  }

  // 保证卡片四角留在泡泡内，避免矩形角顶出圆形轮廓
  const maxCardDiagonal = safeRadius * 2 * 0.9;
  const cardDiagonal = Math.sqrt(cardWidth * cardWidth + cardHeight * cardHeight);
  if (cardDiagonal > maxCardDiagonal) {
    const scale = maxCardDiagonal / cardDiagonal;
    cardWidth *= scale;
    cardHeight *= scale;
  }

  // 图片填充卡片的 88%，避免内容过度贴边
  const imageWidth = cardWidth * 0.88;
  const imageHeight = cardHeight * 0.88;

  return {
    shellWidth,
    shellHeight,
    bodyRadius,
    cardWidth,
    cardHeight,
    imageWidth,
    imageHeight,
    drift: {
      // 下落速度降低约50%
      baseFallSpeed: safeRadius * (0.32 + safeSeed * 0.08),
      baseDriftX: (safeSeed - 0.5) * safeRadius * 0.35,
      // 左右摇摆幅度降低
      swayAmplitude: safeRadius * (0.22 + safeSeed * 0.08),
      swayFrequency: 0.0008 + safeSeed * 0.0002,
      microSwayAmplitude: safeRadius * (0.08 + safeSeed * 0.03),
      microSwayFrequency: 0.0016 + safeSeed * 0.0004,
      // 上下浮动幅度降低
      liftAmplitude: safeRadius * (0.1 + safeSeed * 0.04),
      liftFrequency: 0.001 + safeSeed * 0.00025,
      microLiftAmplitude: safeRadius * (0.04 + safeSeed * 0.02),
      microLiftFrequency: 0.0018 + safeSeed * 0.00035,
      // 微弱旋转
      rotationAmplitude: 3 + safeSeed * 3,
      rotationFrequency: 0.0009 + safeSeed * 0.00025,
      phaseA: safeSeed * Math.PI * 2,
      phaseB: (safeSeed * 1.7 + 0.2) * Math.PI,
      phaseC: (safeSeed * 2.3 + 0.4) * Math.PI
    }
  };
};

export const sampleBubbleDrift = (
  drift: BubbleDriftConfig,
  elapsedMs: number
): BubbleDriftSample => {
  const sway =
    Math.sin(elapsedMs * drift.swayFrequency + drift.phaseA) * drift.swayAmplitude +
    Math.sin(elapsedMs * drift.microSwayFrequency + drift.phaseB) * drift.microSwayAmplitude;

  const lift =
    Math.sin(elapsedMs * drift.liftFrequency + drift.phaseB) * drift.liftAmplitude +
    Math.sin(elapsedMs * drift.microLiftFrequency + drift.phaseC) * drift.microLiftAmplitude;

  const rotation =
    Math.sin(elapsedMs * drift.rotationFrequency + drift.phaseC) * drift.rotationAmplitude;

  return {
    velocityX: drift.baseDriftX + sway,
    velocityY: Math.max(16, drift.baseFallSpeed + lift),
    hoverOffsetY: lift,
    rotation
  };
};

export const resolveBubbleVisualAngle = (
  bodyAngle: number,
  driftRotation: number,
  recoveryProgress: number = 0
): number => {
  const safeBodyAngle = Number.isFinite(bodyAngle) ? bodyAngle : 0;
  const safeDriftRotation = Number.isFinite(driftRotation) ? driftRotation : 0;
  const safeRecoveryProgress = clamp(
    Number.isFinite(recoveryProgress) ? recoveryProgress : 0,
    0,
    1
  );
  const displayedHitAngle = safeBodyAngle * 0.7;
  const remainingHitInfluence = Math.pow(1 - safeRecoveryProgress, 2.4);

  return safeDriftRotation + (displayedHitAngle - safeDriftRotation) * remainingHitInfluence;
};

export const resolveBubbleFloatVelocity = (
  input: BubbleFloatVelocityInput
): number => {
  const safeRadius = Math.max(24, input.bubbleRadius);
  const floatEntryBand = safeRadius * 0.22;

  if (input.bubbleY < input.anchorY - floatEntryBand) {
    return input.fallVelocityY;
  }

  const hoverCeiling = input.anchorY - safeRadius * 0.2;
  const hoverFloor = input.anchorY + safeRadius * 0.06;
  const targetY = clamp(
    input.anchorY - safeRadius * 0.08 + input.hoverOffsetY * 0.32,
    hoverCeiling,
    hoverFloor
  );
  const maxHoverSpeed = Math.max(18, safeRadius * 0.3);
  const correctionVelocity = clamp(
    (targetY - input.bubbleY) * 2.1,
    -maxHoverSpeed,
    maxHoverSpeed
  );

  if (input.bubbleY > hoverFloor) {
    return -Math.max(18, Math.min(maxHoverSpeed, (input.bubbleY - hoverFloor) * 2.4));
  }

  return correctionVelocity > 0 && input.bubbleY >= input.anchorY
    ? 0
    : correctionVelocity;
};
