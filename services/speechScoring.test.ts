import assert from 'node:assert/strict';
import test from 'node:test';

import { speechScoringService } from './speechScoring.ts';

type RecorderLike = {
  startRecording: (
    options?: { onSilence?: () => void; preferredStream?: MediaStream | null } | (() => void),
    preferredStream?: MediaStream | null
  ) => Promise<void>;
  stopAndRecognize: (maxDurationMs: number) => Promise<{ transcript: string; durationMs: number }>;
  abort: () => void;
};

type SpeechScoringServiceInternal = typeof speechScoringService & {
  fallbackRecognizer: RecorderLike;
};

test('recognizeOnce forwards the existing mic stream to fallback recording', async () => {
  const providedStream = {
    id: 'shared-stream'
  } as MediaStream;
  const recorderCalls: Array<{ onSilenceProvided: boolean; preferredStream: MediaStream | null | undefined }> = [];
  const fakeRecorder: RecorderLike = {
    startRecording: async (
      options?: { onSilence?: () => void; preferredStream?: MediaStream | null } | (() => void),
      preferredStream?: MediaStream | null
    ) => {
      const onSilence = typeof options === 'function' ? options : options?.onSilence;
      const providedPreferredStream = typeof options === 'function' ? preferredStream : options?.preferredStream;
      recorderCalls.push({
        onSilenceProvided: typeof onSilence === 'function',
        preferredStream: providedPreferredStream
      });
      onSilence?.();
    },
    stopAndRecognize: async (maxDurationMs: number) => ({
      transcript: `spoken within ${maxDurationMs}ms`,
      durationMs: 321
    }),
    abort: () => {}
  };

  const scoringService = speechScoringService as SpeechScoringServiceInternal;
  const originalRecognizer = scoringService.fallbackRecognizer;
  scoringService.fallbackRecognizer = fakeRecorder;

  try {
    const result = await speechScoringService.recognizeOnce({
      lang: 'en-US',
      maxDurationMs: 1200,
      inputStream: providedStream
    });

    assert.equal(recorderCalls.length, 1);
    assert.equal(recorderCalls[0]?.onSilenceProvided, true);
    assert.equal(recorderCalls[0]?.preferredStream, providedStream);
    assert.equal(result.reason, 'ok');
    assert.equal(result.transcript, 'spoken within 1200ms');
    assert.equal(result.durationMs, 321);
  } finally {
    scoringService.fallbackRecognizer = originalRecognizer;
  }
});
