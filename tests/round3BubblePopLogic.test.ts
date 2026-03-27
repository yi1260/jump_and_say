import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceBubblePopQueue,
  createBubbleHeadHitImpulse,
  createBubblePopQueue,
  createBubblePopWave,
  resolveBubbleSpawnSlots,
  shouldRegisterBubbleHeadHit,
  shouldRetryBubblePopQuestion
} from '../game/modes/round3/round3BubblePopLogic.ts';
import type { ThemeQuestion } from '../types.ts';

const THEME_QUESTIONS: ThemeQuestion[] = [
  { question: 'apple', image: 'apple.webp', audio: 'apple.mp3' },
  { question: 'banana', image: 'banana.webp', audio: 'banana.mp3' },
  { question: 'cat', image: 'cat.webp', audio: 'cat.mp3' },
  { question: 'dog', image: 'dog.webp', audio: 'dog.mp3' }
];

const createSequenceRandom = (values: number[]): (() => number) => {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
};

test('createBubblePopQueue returns a shuffled copy without mutating the source array', () => {
  const source = [...THEME_QUESTIONS];
  const queue = createBubblePopQueue(source, createSequenceRandom([0.75, 0.5, 0.25]));

  assert.notStrictEqual(queue, source);
  assert.deepEqual(source, THEME_QUESTIONS);
  assert.deepEqual(
    queue.map((question) => question.question),
    ['cat', 'apple', 'banana', 'dog']
  );
});

test('createBubblePopWave returns one correct prompt and three unique distractors', () => {
  const queue = createBubblePopQueue(THEME_QUESTIONS, createSequenceRandom([0, 0, 0]));
  const wave = createBubblePopWave(queue, THEME_QUESTIONS, createSequenceRandom([0.9, 0.1, 0.8, 0.2]));

  assert.ok(wave);
  assert.equal(wave.prompt.question, queue[0].question);
  assert.equal(wave.options.length, 4);
  assert.equal(
    wave.options.filter((question) => question.question === wave.prompt.question).length,
    1
  );
  assert.equal(new Set(wave.options.map((question) => question.question)).size, 4);
});

test('resolveBubbleSpawnSlots keeps the four-bubble layout on a single row', () => {
  const slots = resolveBubbleSpawnSlots(4);

  assert.equal(slots.length, 4);
  assert.ok(slots.every((slot) => slot.offsetY === 0));
  assert.deepEqual(
    slots.map((slot) => slot.fractionX),
    [0.14, 0.38, 0.62, 0.86]
  );
});

test('advanceBubblePopQueue removes the current prompt and completes after all prompts are consumed', () => {
  const queue = createBubblePopQueue(THEME_QUESTIONS, createSequenceRandom([0, 0, 0]));
  const nextQueue = advanceBubblePopQueue(queue);

  assert.equal(nextQueue.length, queue.length - 1);
  assert.deepEqual(nextQueue, queue.slice(1));
  assert.deepEqual(advanceBubblePopQueue([]), []);
});

test('shouldRetryBubblePopQuestion returns true after every active bubble has landed and the correct bubble still remains', () => {
  assert.equal(
    shouldRetryBubblePopQuestion([
      { isCorrect: true, hasLanded: true },
      { isCorrect: false, hasLanded: true },
      { isCorrect: false, hasLanded: true }
    ]),
    true
  );
});

test('shouldRetryBubblePopQuestion stays false while a bubble is airborne or the correct bubble is already gone', () => {
  assert.equal(
    shouldRetryBubblePopQuestion([
      { isCorrect: true, hasLanded: false },
      { isCorrect: false, hasLanded: true },
      { isCorrect: false, hasLanded: true }
    ]),
    false
  );

  assert.equal(
    shouldRetryBubblePopQuestion([
      { isCorrect: false, hasLanded: true },
      { isCorrect: false, hasLanded: true }
    ]),
    false
  );
});

test('shouldRegisterBubbleHeadHit only accepts close forehead contact instead of broad body proximity', () => {
  assert.equal(
    shouldRegisterBubbleHeadHit({
      playerX: 300,
      playerY: 500,
      playerDisplayHeight: 180,
      playerBodyWidth: 90,
      playerVelocityY: -320,
      bubbleX: 302,
      bubbleY: 272,
      bubbleRadius: 96
    }),
    true
  );

  assert.equal(
    shouldRegisterBubbleHeadHit({
      playerX: 300,
      playerY: 500,
      playerDisplayHeight: 180,
      playerBodyWidth: 90,
      playerVelocityY: -320,
      bubbleX: 414,
      bubbleY: 364,
      bubbleRadius: 96
    }),
    false
  );
});

test('shouldRegisterBubbleHeadHit rejects collisions when the player is already falling away from the bubble', () => {
  assert.equal(
    shouldRegisterBubbleHeadHit({
      playerX: 300,
      playerY: 500,
      playerDisplayHeight: 180,
      playerBodyWidth: 90,
      playerVelocityY: 180,
      bubbleX: 300,
      bubbleY: 270,
      bubbleRadius: 96
    }),
    false
  );
});

test('createBubbleHeadHitImpulse keeps wrong-bubble knockback directional but less violent', () => {
  const impulse = createBubbleHeadHitImpulse({
    bubbleX: 420,
    playerX: 300,
    bubbleRadius: 104,
    playerVelocityY: -460
  });

  assert.ok(impulse.velocityX > 0);
  assert.ok(impulse.velocityY < 0);
  assert.ok(Math.abs(impulse.velocityX) >= 100);
  assert.ok(Math.abs(impulse.velocityX) <= 180);
  assert.ok(Math.abs(impulse.velocityY) >= 420);
  assert.ok(Math.abs(impulse.velocityY) <= 760);
  assert.ok(impulse.angularVelocity > 0);
  assert.equal(impulse.impulseDurationMs, 460);
});
