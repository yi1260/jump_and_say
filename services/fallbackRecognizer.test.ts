import assert from 'node:assert/strict';
import test from 'node:test';

import { FallbackRecognizer } from './fallbackRecognizer.ts';

type FakeTrack = {
  stopCalls: number;
  stop: () => void;
};

type FakeStream = MediaStream & {
  __track: FakeTrack;
};

type FakeMediaRecorderCtor = typeof MediaRecorder & {
  latestStream: MediaStream | null;
  latestMimeType: string | null;
};

class FakeAudioContext {
  public state: 'running' | 'closed' = 'running';

  createMediaStreamSource(_stream: MediaStream) {
    return {
      connect: () => {}
    };
  }

  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 8,
      getByteFrequencyData: (target: Uint8Array) => {
        target.fill(0);
      }
    };
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

class FakeMediaRecorder {
  public static latestStream: MediaStream | null = null;

  public static latestMimeType: string | null = null;

  public static isTypeSupported(type: string): boolean {
    return type === 'audio/mp4';
  }

  public state: 'inactive' | 'recording' = 'inactive';

  public ondataavailable: ((event: { data: Blob }) => void) | null = null;

  public onstop: (() => void | Promise<void>) | null = null;

  public readonly mimeType: string;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    FakeMediaRecorder.latestStream = stream;
    this.mimeType = options?.mimeType || '';
    FakeMediaRecorder.latestMimeType = this.mimeType;
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['audio-bytes'], { type: this.mimeType })
    });
    queueMicrotask(() => {
      void this.onstop?.();
    });
  }
}

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalMediaRecorder = globalThis.MediaRecorder;
const originalFetch = globalThis.fetch;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

const setWindowValue = (value: typeof globalThis & { AudioContext?: typeof FakeAudioContext }): void => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value
  });
};

const setNavigatorValue = (value: Navigator): void => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value
  });
};

const createFakeStream = (): FakeStream => {
  const track: FakeTrack = {
    stopCalls: 0,
    stop() {
      track.stopCalls += 1;
    }
  };

  return {
    __track: track,
    getTracks: () => [track as MediaStreamTrack]
  } as FakeStream;
};

test.afterEach(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete (globalThis as { navigator?: Navigator }).navigator;
  }

  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    delete (globalThis as { window?: typeof globalThis }).window;
  }

  globalThis.MediaRecorder = originalMediaRecorder;
  globalThis.fetch = originalFetch;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  FakeMediaRecorder.latestStream = null;
  FakeMediaRecorder.latestMimeType = null;
});

test('startRecording reuses the provided input stream instead of opening a second mic capture', async () => {
  const recognizer = new FallbackRecognizer();
  const providedStream = createFakeStream();

  setWindowValue({
    ...globalThis,
    AudioContext: FakeAudioContext
  });
  setNavigatorValue({
    mediaDevices: {
      getUserMedia: async (): Promise<MediaStream> => {
        throw new Error('getUserMedia should not run when a shared stream is available');
      }
    }
  } as Navigator);
  globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  await recognizer.startRecording(undefined, providedStream);

  assert.equal((FakeMediaRecorder as unknown as FakeMediaRecorderCtor).latestStream, providedStream);
  recognizer.abort();
});

test('stopAndRecognize preserves the recorder mime type after cleanup', async () => {
  const recognizer = new FallbackRecognizer();
  const providedStream = createFakeStream();
  let postedContentType = '';
  let postedBodyType = '';

  setWindowValue({
    ...globalThis,
    AudioContext: FakeAudioContext
  });
  setNavigatorValue({
    mediaDevices: {
      getUserMedia: async (): Promise<MediaStream> => {
        throw new Error('getUserMedia should not run when a shared stream is available');
      }
    }
  } as Navigator);
  globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postedContentType = String(init?.headers && (init.headers as Record<string, string>)['Content-Type']);
    postedBodyType = init?.body instanceof Blob ? init.body.type : '';
    return {
      ok: true,
      json: async () => ({ transcript: 'apple' })
    } as Response;
  }) as typeof fetch;

  await recognizer.startRecording(undefined, providedStream);
  const result = await recognizer.stopAndRecognize(1500);

  assert.equal(postedContentType, 'audio/mp4');
  assert.equal(postedBodyType, 'audio/mp4');
  assert.equal(result.transcript, 'apple');
  assert.equal(providedStream.__track.stopCalls, 0);
});
