import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

import handler, { fetchWithStageTimeout, normalizeEnvValue, pollAssemblyAiTranscript } from './recognize.ts';

const require = createRequire(import.meta.url);

test('normalizeEnvValue trims whitespace and carriage returns from env vars', () => {
  assert.equal(normalizeEnvValue('  abc123  \r\n'), 'abc123');
  assert.equal(normalizeEnvValue(' \r\n '), undefined);
  assert.equal(normalizeEnvValue(undefined), undefined);
});

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

test('handler falls back to AssemblyAI when Deepgram request fails', async () => {
  const originalFetch = global.fetch;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const originalAssemblyApiKey = process.env.ASSEMBLYAI_API_KEY;
  const fetchCalls: string[] = [];

  process.env.DEEPGRAM_API_KEY = 'deepgram-key';
  process.env.ASSEMBLYAI_API_KEY = 'assembly-key';

  global.fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    fetchCalls.push(url);

    if (url.includes('deepgram.com')) {
      return {
        ok: false,
        status: 503,
        text: async () => 'temporary deepgram failure'
      } as Response;
    }

    if (url.endsWith('/upload')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ upload_url: 'https://upload.example/audio.wav' })
      } as Response;
    }

    if (url.endsWith('/transcript')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'transcript-123' })
      } as Response;
    }

    if (url.includes('/transcript/transcript-123')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', text: 'fallback transcript' })
      } as Response;
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = Readable.from([Buffer.from('fake-audio')]) as Readable & {
    method: string;
    headers: Record<string, string>;
  };
  req.method = 'POST';
  req.headers = {
    'content-type': 'audio/webm'
  };

  const responseState: {
    statusCode: number;
    payload: unknown;
  } = {
    statusCode: 200,
    payload: null
  };

  const res = {
    status(code: number) {
      responseState.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      responseState.payload = payload;
      return this;
    }
  };

  try {
    await handler(req, res);

    assert.equal(responseState.statusCode, 200);
    assert.deepEqual(responseState.payload, {
      transcript: 'fallback transcript',
      provider: 'assemblyai',
      routing: {
        attemptedProviders: ['deepgram', 'assemblyai'],
        providerErrors: ['Deepgram: Deepgram API error: temporary deepgram failure']
      }
    });
    assert.equal(fetchCalls.some((url) => url.includes('deepgram.com')), true);
    assert.equal(fetchCalls.some((url) => url.includes('assemblyai.com')), true);
  } finally {
    global.fetch = originalFetch;
    process.env.DEEPGRAM_API_KEY = originalDeepgramApiKey;
    process.env.ASSEMBLYAI_API_KEY = originalAssemblyApiKey;
  }
});

test('handler falls back to Tencent when Deepgram fails first', async () => {
  const sdk = require('tencentcloud-sdk-nodejs');
  const originalTencentClient = sdk.asr.v20190614.Client;
  const originalFetch = global.fetch;
  const originalTencentSecretId = process.env.TENCENT_SECRET_ID;
  const originalTencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;

  process.env.TENCENT_SECRET_ID = 'tencent-id';
  process.env.TENCENT_SECRET_KEY = 'tencent-key';
  process.env.DEEPGRAM_API_KEY = 'deepgram-key';

  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes('deepgram.com')) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return {
      ok: false,
      status: 503,
      text: async () => 'temporary deepgram failure'
    } as Response;
  }) as typeof fetch;

  sdk.asr.v20190614.Client = class FakeTencentClient {
    SentenceRecognition(
      _request: unknown,
      cb: (error: Error | null, response?: { Result?: string; RequestId?: string; AudioDuration?: number }) => void
    ): void {
      cb(null, {
        Result: 'one black suit',
        RequestId: 'req-456',
        AudioDuration: 850
      });
    }
  };

  const req = Readable.from([Buffer.from('fake-wav-audio')]) as Readable & {
    method: string;
    headers: Record<string, string>;
  };
  req.method = 'POST';
  req.headers = {
    'content-type': 'audio/wav'
  };

  const responseState: {
    statusCode: number;
    payload: unknown;
  } = {
    statusCode: 200,
    payload: null
  };

  const res = {
    status(code: number) {
      responseState.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      responseState.payload = payload;
      return this;
    }
  };

  try {
    await handler(req, res);

    assert.equal(responseState.statusCode, 200);
    assert.deepEqual(responseState.payload, {
      transcript: 'one black suit',
      provider: 'tencent',
      requestId: 'req-456',
      audioDurationMs: 850,
      routing: {
        attemptedProviders: ['deepgram', 'tencent'],
        providerErrors: ['Deepgram: Deepgram API error: temporary deepgram failure']
      }
    });
  } finally {
    sdk.asr.v20190614.Client = originalTencentClient;
    global.fetch = originalFetch;
    process.env.TENCENT_SECRET_ID = originalTencentSecretId;
    process.env.TENCENT_SECRET_KEY = originalTencentSecretKey;
    process.env.DEEPGRAM_API_KEY = originalDeepgramApiKey;
  }
});

test('handler uses explicit Tencent secret credentials instead of ProfileCredential file lookup', async () => {
  const sdk = require('tencentcloud-sdk-nodejs');
  const originalTencentClient = sdk.asr.v20190614.Client;
  const originalTencentSecretId = process.env.TENCENT_SECRET_ID;
  const originalTencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
  let capturedConfig: unknown = null;

  process.env.TENCENT_SECRET_ID = 'tencent-id';
  process.env.TENCENT_SECRET_KEY = 'tencent-key';
  delete process.env.DEEPGRAM_API_KEY;

  sdk.asr.v20190614.Client = class FakeTencentClient {
    constructor(config: unknown) {
      capturedConfig = config;
    }

    SentenceRecognition(
      _request: unknown,
      cb: (error: Error | null, response?: { Result?: string; RequestId?: string; AudioDuration?: number }) => void
    ): void {
      cb(null, {
        Result: 'a big dog',
        RequestId: 'req-123',
        AudioDuration: 900,
      });
    }
  };

  const req = Readable.from([Buffer.from('fake-wav-audio')]) as Readable & {
    method: string;
    headers: Record<string, string>;
  };
  req.method = 'POST';
  req.headers = {
    'content-type': 'audio/wav'
  };

  const responseState: {
    statusCode: number;
    payload: unknown;
  } = {
    statusCode: 200,
    payload: null
  };

  const res = {
    status(code: number) {
      responseState.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      responseState.payload = payload;
      return this;
    }
  };

  try {
    await handler(req, res);

    assert.equal(responseState.statusCode, 200);
    assert.deepEqual(capturedConfig, {
      credential: {
        secretId: 'tencent-id',
        secretKey: 'tencent-key',
      },
      region: 'ap-shanghai',
      profile: {
        signMethod: 'TC3-HMAC-SHA256',
        httpProfile: {
          endpoint: 'asr.tencentcloudapi.com',
          reqMethod: 'POST',
          reqTimeout: 30,
        },
      },
    });
    assert.deepEqual(responseState.payload, {
      transcript: 'a big dog',
      provider: 'tencent',
      requestId: 'req-123',
      audioDurationMs: 900,
      routing: {
        attemptedProviders: ['tencent'],
        providerErrors: []
      }
    });
  } finally {
    sdk.asr.v20190614.Client = originalTencentClient;
    process.env.TENCENT_SECRET_ID = originalTencentSecretId;
    process.env.TENCENT_SECRET_KEY = originalTencentSecretKey;
    process.env.DEEPGRAM_API_KEY = originalDeepgramApiKey;
  }
});
