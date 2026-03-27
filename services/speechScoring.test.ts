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

type SpeechScoringServiceTestAccess = {
  fallbackRecognizer: RecorderLike;
  isNativeBroken: boolean;
};

test('recognizeOnce prefers native recognition before cloud fallback', async () => {
  const originalWindow = globalThis.window;
  const scoringService = speechScoringService as unknown as SpeechScoringServiceTestAccess;
  const originalRecognizer = scoringService.fallbackRecognizer;
  const originalIsNativeBroken = scoringService.isNativeBroken;
  let fallbackUsed = false;

  class FakeSpeechRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart: ((event: Event) => void) | null = null;
    onaudiostart: ((event: Event) => void) | null = null;
    onaudioend: ((event: Event) => void) | null = null;
    onsoundstart: ((event: Event) => void) | null = null;
    onsoundend: ((event: Event) => void) | null = null;
    onspeechstart: ((event: Event) => void) | null = null;
    onspeechend: ((event: Event) => void) | null = null;
    onresult: ((event: Event & {
      resultIndex: number;
      results: { [index: number]: { [index: number]: { transcript: string; confidence: number }; length: number; isFinal?: boolean }; length: number };
    }) => void) | null = null;
    onerror: ((event: Event & { error: string; message?: string }) => void) | null = null;
    onend: ((event: Event) => void) | null = null;
    onnomatch: ((event: Event) => void) | null = null;

    start(): void {
      queueMicrotask(() => {
        this.onresult?.({
          resultIndex: 0,
          results: {
            0: {
              0: {
                transcript: 'native apple',
                confidence: 0.84
              },
              length: 1,
              isFinal: true
            },
            length: 1
          }
        } as unknown as Event & {
          resultIndex: number;
          results: { [index: number]: { [index: number]: { transcript: string; confidence: number }; length: number; isFinal?: boolean }; length: number };
        });
        this.onend?.(new Event('end'));
      });
    }

    stop(): void {}
    abort(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  const fakeRecorder: RecorderLike = {
    startRecording: async () => {
      fallbackUsed = true;
    },
    stopAndRecognize: async () => ({
      transcript: 'fallback apple',
      durationMs: 500
    }),
    abort: () => {}
  };

  scoringService.fallbackRecognizer = fakeRecorder;
  scoringService.isNativeBroken = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      SpeechRecognition: FakeSpeechRecognition,
      setTimeout,
      clearTimeout
    }
  });

  try {
    const result = await speechScoringService.recognizeOnce({
      lang: 'en-US',
      maxDurationMs: 1500
    });

    assert.equal(fallbackUsed, false);
    assert.equal(result.reason, 'ok');
    assert.equal(result.transcript, 'native apple');
    assert.equal(result.confidence, 0.84);
  } finally {
    scoringService.fallbackRecognizer = originalRecognizer;
    scoringService.isNativeBroken = originalIsNativeBroken;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  }
});

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

  const scoringService = speechScoringService as unknown as SpeechScoringServiceTestAccess;
  const originalRecognizer = scoringService.fallbackRecognizer;
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalIsNativeBroken = scoringService.isNativeBroken;
  scoringService.fallbackRecognizer = fakeRecorder;
  scoringService.isNativeBroken = true;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {}
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => providedStream
      }
    }
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: class FakeMediaRecorder {}
  });

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
    scoringService.isNativeBroken = originalIsNativeBroken;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator
    });
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: originalMediaRecorder
    });
  }
});
