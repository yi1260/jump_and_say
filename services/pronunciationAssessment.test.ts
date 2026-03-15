import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessPronunciationAttempt,
  shouldRetryRecognitionAttempt
} from './pronunciationAssessment.ts';

test('falls back to transcript-based pass when volume meter never responded but transcript is strong', () => {
  const result = assessPronunciationAttempt({
    rawConfidence: 0.91,
    textSimilarity: 0.96,
    volumePeak: 0,
    volumeMonitorReady: false,
    volumeMonitorDetectedSignal: false
  });

  assert.equal(result.confidenceLevel, 'MEDIUM');
  assert.equal(result.usedTranscriptOnlyFallback, true);
  assert.ok(result.confidence >= 0.9);
});

test('keeps low confidence when transcript is weak and volume meter never responded', () => {
  const result = assessPronunciationAttempt({
    rawConfidence: 0.25,
    textSimilarity: 0.18,
    volumePeak: 0,
    volumeMonitorReady: false,
    volumeMonitorDetectedSignal: false
  });

  assert.equal(result.confidenceLevel, 'LOW');
  assert.equal(result.usedTranscriptOnlyFallback, false);
});

test('retries early transient recognition failures while there is still time left', () => {
  assert.equal(
    shouldRetryRecognitionAttempt({
      reason: 'error',
      transcript: '',
      retryCount: 0,
      remainingMs: 1800
    }),
    true
  );
  assert.equal(
    shouldRetryRecognitionAttempt({
      reason: 'aborted',
      transcript: '',
      retryCount: 1,
      remainingMs: 1200
    }),
    true
  );
  assert.equal(
    shouldRetryRecognitionAttempt({
      reason: 'aborted',
      transcript: '',
      retryCount: 2,
      remainingMs: 1200
    }),
    false
  );
  assert.equal(
    shouldRetryRecognitionAttempt({
      reason: 'unsupported',
      transcript: '',
      retryCount: 0,
      remainingMs: 1800
    }),
    false
  );
  assert.equal(
    shouldRetryRecognitionAttempt({
      reason: 'error',
      transcript: 'apple',
      retryCount: 0,
      remainingMs: 1800
    }),
    false
  );
});
