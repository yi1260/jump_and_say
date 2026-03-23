import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithStageTimeout, pollAssemblyAiTranscript } from './recognize.ts';

test('fetchWithStageTimeout aborts stalled third-party requests with stage context', async () => {
  await assert.rejects(
    async () => fetchWithStageTimeout({
      stage: 'deepgram-listen',
      url: 'https://example.com/listen',
      timeoutMs: 10,
      logger: {
        info: () => {},
        warn: () => {}
      },
      fetchImpl: async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          reject(new Error('AbortSignal missing'));
          return;
        }
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    }),
    /deepgram-listen timed out after 10ms/i
  );
});

test('pollAssemblyAiTranscript times out when AssemblyAI never completes', async () => {
  let nowMs = 0;
  let pollCount = 0;

  await assert.rejects(
    async () => pollAssemblyAiTranscript({
      apiKey: 'test-key',
      transcriptId: 'transcript-123',
      maxWaitMs: 2500,
      pollIntervalMs: 1000,
      now: () => nowMs,
      sleep: async (delayMs: number) => {
        nowMs += delayMs;
      },
      fetchImpl: async () => {
        pollCount += 1;
        return {
          ok: true,
          json: async () => ({ status: 'processing' })
        } as Response;
      }
    }),
    /timed out/i
  );

  assert.equal(pollCount, 3);
});
