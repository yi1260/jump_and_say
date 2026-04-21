import assert from 'node:assert/strict';
import test from 'node:test';

import { speechScoringService } from './speechScoring.ts';

type RecorderLike = {
  startRecording: (
    options?: { onSilence?: () => void; preferredStream?: MediaStream | null } | (() => void),
    preferredStream?: MediaStream | null
  ) => Promise<void>;
  stopAndRecognize: (maxDurationMs: number) => Promise<{ transcript: string; durationMs: number; provider: 'tencent' | 'deepgram' | 'assemblyai' | 'unknown' }>;
  abort: () => void;
};

type SpeechScoringServiceTestAccess = {
  fallbackRecognizer: RecorderLike;
  isNativeBroken: boolean;
};

test('recognizeOnce skips native recognition on non-iOS platforms when fallback is unavailable', async () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const scoringService = speechScoringService as unknown as SpeechScoringServiceTestAccess;
  const originalRecognizer = scoringService.fallbackRecognizer;
  const originalIsNativeBroken = scoringService.isNativeBroken;
  let fallbackUsed = false;
  let nativeStarted = false;

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
      nativeStarted = true;
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
      durationMs: 500,
      provider: 'tencent'
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
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (Linux; Android 12)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5
    }
  });

  try {
    const result = await speechScoringService.recognizeOnce({
      lang: 'en-US',
      maxDurationMs: 1500
    });

    assert.equal(fallbackUsed, false);
    assert.equal(nativeStarted, false);
    assert.equal(result.reason, 'unsupported');
    assert.equal(result.transcript, '');
    assert.equal(result.confidence, 0);
    assert.equal(result.provider, 'unknown');
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
  }
});

test('recognizeOnce uses native recognition first on desktop platforms', async () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const scoringService = speechScoringService as unknown as SpeechScoringServiceTestAccess;
  const originalRecognizer = scoringService.fallbackRecognizer;
  const originalIsNativeBroken = scoringService.isNativeBroken;
  let fallbackUsed = false;

  class DesktopSpeechRecognition {
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
                transcript: 'one black sheet',
                confidence: 0.88
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

  scoringService.fallbackRecognizer = {
    startRecording: async () => {
      fallbackUsed = true;
    },
    stopAndRecognize: async () => ({
      transcript: 'fallback should not run',
      durationMs: 100,
      provider: 'tencent'
    }),
    abort: () => {}
  };
  scoringService.isNativeBroken = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      SpeechRecognition: DesktopSpeechRecognition,
      setTimeout,
      clearTimeout
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      mediaDevices: {
        getUserMedia: async () => ({ id: 'desktop-stream' }) as MediaStream
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
      maxDurationMs: 1500
    });

    assert.equal(fallbackUsed, false);
    assert.equal(result.reason, 'ok');
    assert.equal(result.transcript, 'one black sheet');
    assert.equal(result.provider, 'native');
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

test('recognizeOnce falls back to cloud recognition after an iOS native timeout', async () => {
  const providedStream = {
    id: 'shared-ios-stream'
  } as MediaStream;
  const recorderCalls: Array<{ maxDurationMs: number; preferredStream: MediaStream | null | undefined }> = [];
  const fakeRecorder: RecorderLike = {
    startRecording: async (options?: { onSilence?: () => void; preferredStream?: MediaStream | null } | (() => void)) => {
      const onSilence = typeof options === 'function' ? options : options?.onSilence;
      const preferredStream = typeof options === 'function' ? undefined : options?.preferredStream;
      recorderCalls.push({
        maxDurationMs: 0,
        preferredStream
      });
      onSilence?.();
    },
    stopAndRecognize: async (maxDurationMs: number) => {
      recorderCalls[recorderCalls.length - 1].maxDurationMs = maxDurationMs;
      return {
        transcript: 'fallback after timeout',
        durationMs: 280,
        provider: 'tencent'
      };
    },
    abort: () => {}
  };

  class TimeoutSpeechRecognition {
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
      this.onstart?.(new Event('start'));
    }

    stop(): void {}
    abort(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  const scoringService = speechScoringService as unknown as SpeechScoringServiceTestAccess;
  const originalRecognizer = scoringService.fallbackRecognizer;
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalIsNativeBroken = scoringService.isNativeBroken;

  scoringService.fallbackRecognizer = fakeRecorder;
  scoringService.isNativeBroken = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      SpeechRecognition: TimeoutSpeechRecognition,
      setTimeout: (callback: () => void) => {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeout: () => {}
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
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
      maxDurationMs: 9000,
      inputStream: providedStream
    });

    assert.equal(recorderCalls.length, 1);
    assert.equal(recorderCalls[0]?.preferredStream, providedStream);
    assert.equal(recorderCalls[0]!.maxDurationMs <= 9000, true);
    assert.equal(recorderCalls[0]!.maxDurationMs >= 600, true);
    assert.equal(result.reason, 'ok');
    assert.equal(result.transcript, 'fallback after timeout');
    assert.equal(result.provider, 'tencent');
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
      durationMs: 321,
      provider: 'tencent'
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
    assert.equal(result.provider, 'tencent');
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
