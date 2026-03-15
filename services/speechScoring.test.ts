import assert from 'node:assert/strict';
import test from 'node:test';

import { speechScoringService } from './speechScoring.ts';

interface MockRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }>>;
}

type ScheduledAction =
  | { kind: 'result'; delayMs: number; transcript: string; confidence?: number }
  | { kind: 'error'; delayMs: number; error: string }
  | { kind: 'end'; delayMs: number };

type MockRecognitionConstructor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: MockRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: ((event: Event) => void) | null;
  onnomatch: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

type WindowWithSpeechRecognition = typeof globalThis & {
  SpeechRecognition?: MockRecognitionConstructor;
  webkitSpeechRecognition?: MockRecognitionConstructor;
};

class MockSpeechRecognition {
  public static script: ScheduledAction[] = [];

  public static instances: MockSpeechRecognition[] = [];

  public lang: string = '';

  public continuous: boolean = false;

  public interimResults: boolean = false;

  public maxAlternatives: number = 1;

  public onresult: ((event: MockRecognitionEvent) => void) | null = null;

  public onerror: ((event: { error: string }) => void) | null = null;

  public onend: ((event: Event) => void) | null = null;

  public onnomatch: ((event: Event) => void) | null = null;

  public startCalled: boolean = false;

  public stopCalled: boolean = false;

  public abortCalled: boolean = false;

  private readonly timers: NodeJS.Timeout[] = [];

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  public start(): void {
    this.startCalled = true;
    for (const action of MockSpeechRecognition.script) {
      const timer = setTimeout(() => {
        if (action.kind === 'result') {
          this.onresult?.({
            resultIndex: 0,
            results: [
              [
                {
                  transcript: action.transcript,
                  confidence: action.confidence
                }
              ]
            ]
          });
          return;
        }
        if (action.kind === 'error') {
          this.onerror?.({ error: action.error });
          return;
        }
        this.onend?.(new Event('end'));
      }, action.delayMs);
      this.timers.push(timer);
    }
  }

  public stop(): void {
    this.stopCalled = true;
  }

  public abort(): void {
    this.abortCalled = true;
  }

  public addEventListener(_type: string, _listener: (event: Event) => void): void {}

  public removeEventListener(_type: string, _listener: (event: Event) => void): void {}

  public clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.length = 0;
  }
}

const wait = async <T>(value: T, delayMs: number): Promise<T> => (
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), delayMs);
  })
);

const speechWindow = globalThis as WindowWithSpeechRecognition;
const originalSpeechRecognition = speechWindow.SpeechRecognition;
const originalWebkitSpeechRecognition = speechWindow.webkitSpeechRecognition;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

const setWindowValue = (value: typeof globalThis): void => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value
  });
};

test.afterEach(() => {
  for (const instance of MockSpeechRecognition.instances) {
    instance.clearTimers();
  }
  MockSpeechRecognition.instances.length = 0;
  MockSpeechRecognition.script = [];
  speechWindow.SpeechRecognition = originalSpeechRecognition;
  speechWindow.webkitSpeechRecognition = originalWebkitSpeechRecognition;
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }
  delete (globalThis as { window?: typeof globalThis }).window;
});

test('recognizeOnce returns ok when result arrives even if end never fires', async () => {
  setWindowValue(globalThis);
  speechWindow.webkitSpeechRecognition = MockSpeechRecognition as unknown as MockRecognitionConstructor;
  MockSpeechRecognition.script = [
    { kind: 'result', delayMs: 25, transcript: 'hello world', confidence: 0.87 }
  ];

  const result = await Promise.race([
    speechScoringService.recognizeOnce({
      lang: 'en-US',
      maxDurationMs: 120
    }),
    wait('pending' as const, 500)
  ]);

  assert.notStrictEqual(result, 'pending');
  if (result === 'pending') {
    throw new Error('recognizeOnce should have resolved after receiving a result');
  }
  assert.equal(result.reason, 'ok');
  assert.equal(result.transcript, 'hello world');
  assert.equal(result.confidence, 0.87);
});

test('recognizeOnce returns timeout when stop does not trigger end', async () => {
  setWindowValue(globalThis);
  speechWindow.webkitSpeechRecognition = MockSpeechRecognition as unknown as MockRecognitionConstructor;
  MockSpeechRecognition.script = [];

  const result = await Promise.race([
    speechScoringService.recognizeOnce({
      lang: 'en-US',
      maxDurationMs: 120
    }),
    wait('pending' as const, 700)
  ]);

  assert.notStrictEqual(result, 'pending');
  if (result === 'pending') {
    throw new Error('recognizeOnce should have resolved after timing out');
  }
  assert.equal(result.reason, 'timeout');
  assert.equal(result.transcript, '');
  assert.equal(MockSpeechRecognition.instances[0]?.stopCalled, true);
});
