import assert from 'node:assert/strict';
import test from 'node:test';

import { pollAssemblyAiTranscript } from './recognize.ts';

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
