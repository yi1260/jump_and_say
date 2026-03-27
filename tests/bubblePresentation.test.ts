import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBubblePresentation,
  resolveBubbleVisualAngle,
  resolveBubbleFloatVelocity,
  ROUND3_BUBBLE_PALETTE,
  sampleBubbleDrift
} from '../game/modes/round3/bubblePresentation.ts';

test('buildBubblePresentation creates a shell larger than the image card', () => {
  const presentation = buildBubblePresentation(96, 0.78, 0.42);

  assert.ok(presentation.cardWidth > 0);
  assert.ok(presentation.cardHeight > 0);
  assert.ok(presentation.shellWidth > presentation.cardWidth);
  assert.ok(presentation.shellHeight > presentation.cardHeight);
  assert.ok(presentation.bodyRadius >= Math.max(presentation.shellWidth, presentation.shellHeight) * 0.24);
});

test('sampleBubbleDrift produces non-static drifting motion over time', () => {
  const driftConfig = buildBubblePresentation(92, 1.25, 0.18).drift;

  const sampleA = sampleBubbleDrift(driftConfig, 0);
  const sampleB = sampleBubbleDrift(driftConfig, 1800);

  assert.notEqual(sampleA.velocityX, sampleB.velocityX);
  assert.notEqual(sampleA.velocityY, sampleB.velocityY);
  assert.notEqual(sampleA.rotation, sampleB.rotation);
  assert.notEqual(sampleA.hoverOffsetY, sampleB.hoverOffsetY);
  assert.ok(sampleA.velocityY > 0);
  assert.ok(sampleB.velocityY > 0);
});

test('buildBubblePresentation keeps the inner card inside the bubble silhouette while remaining readable', () => {
  const presentation = buildBubblePresentation(100, 1, 0.3);
  const diagonal = Math.sqrt(
    presentation.cardWidth * presentation.cardWidth +
    presentation.cardHeight * presentation.cardHeight
  );

  assert.ok(presentation.cardWidth >= presentation.shellWidth * 0.62);
  assert.ok(presentation.cardHeight >= presentation.shellHeight * 0.62);
  assert.ok(diagonal <= presentation.shellWidth * 0.9);
});

test('ROUND3_BUBBLE_PALETTE uses the pink visual treatment for round3 bubbles', () => {
  assert.equal(ROUND3_BUBBLE_PALETTE.shellFillColor, 0xffd6e8);
  assert.equal(ROUND3_BUBBLE_PALETTE.shellStrokeColor, 0xff8fbd);
  assert.equal(ROUND3_BUBBLE_PALETTE.textColor, '#7a184a');
});

test('resolveBubbleFloatVelocity keeps bubbles descending before they reach the float zone', () => {
  const velocityY = resolveBubbleFloatVelocity({
    bubbleY: 128,
    anchorY: 360,
    bubbleRadius: 96,
    fallVelocityY: 40,
    hoverOffsetY: 0
  });

  assert.equal(velocityY, 40);
});

test('resolveBubbleFloatVelocity lifts bubbles back up once they drift below the mid-screen anchor', () => {
  const velocityY = resolveBubbleFloatVelocity({
    bubbleY: 388,
    anchorY: 360,
    bubbleRadius: 96,
    fallVelocityY: 42,
    hoverOffsetY: 12
  });

  assert.ok(velocityY < 0);
});

test('resolveBubbleVisualAngle returns toward upright quickly after a hit settles', () => {
  const hitAngle = resolveBubbleVisualAngle(24, 4, 0);
  const recoveredAngle = resolveBubbleVisualAngle(24, 4, 0.65);

  assert.ok(Math.abs(hitAngle - 24) < Math.abs(hitAngle - 4));
  assert.ok(Math.abs(recoveredAngle - 4) < Math.abs(hitAngle - 4));
  assert.ok(recoveredAngle < hitAngle);
});
