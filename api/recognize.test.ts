import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

import handler, { buildProviderOrder, fetchWithStageTimeout, normalizeEnvValue, pollAssemblyAiTranscript } from './recognize.ts';

const require = createRequire(import.meta.url);

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

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

test('buildProviderOrder rotates the first cloud provider from a random start index', () => {
  assert.deepEqual(
    buildProviderOrder(['tencent', 'deepgram', 'assemblyai'], null, () => 0),
    ['tencent', 'deepgram', 'assemblyai']
  );
  assert.deepEqual(
    buildProviderOrder(['tencent', 'deepgram', 'assemblyai'], null, () => 0.4),
    ['deepgram', 'assemblyai', 'tencent']
  );
  assert.deepEqual(
    buildProviderOrder(['tencent', 'deepgram', 'assemblyai'], null, () => 0.8),
    ['assemblyai', 'tencent', 'deepgram']
  );
  assert.deepEqual(
    buildProviderOrder(['tencent', 'deepgram', 'assemblyai'], 'deepgram', () => 0.8),
    ['deepgram']
  );
});

test('handler falls back to AssemblyAI when Deepgram request fails', async () => {
  const originalFetch = global.fetch;
  const originalTencentSecretId = process.env.TENCENT_SECRET_ID;
  const originalTencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const originalAssemblyApiKey = process.env.ASSEMBLYAI_API_KEY;
  const originalForcedProvider = process.env.SPEECH_RECOGNITION_PROVIDER;
  const originalRandom = Math.random;
  const fetchCalls: string[] = [];

  delete process.env.TENCENT_SECRET_ID;
  delete process.env.TENCENT_SECRET_KEY;
  process.env.DEEPGRAM_API_KEY = 'deepgram-key';
  process.env.ASSEMBLYAI_API_KEY = 'assembly-key';
  delete process.env.SPEECH_RECOGNITION_PROVIDER;
  Math.random = () => 0;

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
        providerErrors: ['Deepgram: Deepgram API error: temporary deepgram failure'],
        forcedProvider: 'auto'
      }
    });
    assert.equal(fetchCalls.some((url) => url.includes('deepgram.com')), true);
    assert.equal(fetchCalls.some((url) => url.includes('assemblyai.com')), true);
  } finally {
    global.fetch = originalFetch;
    Math.random = originalRandom;
    restoreEnv('TENCENT_SECRET_ID', originalTencentSecretId);
    restoreEnv('TENCENT_SECRET_KEY', originalTencentSecretKey);
    restoreEnv('DEEPGRAM_API_KEY', originalDeepgramApiKey);
    restoreEnv('ASSEMBLYAI_API_KEY', originalAssemblyApiKey);
    restoreEnv('SPEECH_RECOGNITION_PROVIDER', originalForcedProvider);
  }
});

test('handler returns routing metadata when Tencent fails and Deepgram succeeds', async () => {
  const sdk = require('tencentcloud-sdk-nodejs');
  const originalTencentClient = sdk.asr.v20190614.Client;
  const originalFetch = global.fetch;
  const originalTencentSecretId = process.env.TENCENT_SECRET_ID;
  const originalTencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const originalForcedProvider = process.env.SPEECH_RECOGNITION_PROVIDER;
  const originalRandom = Math.random;

  process.env.TENCENT_SECRET_ID = 'tencent-id';
  process.env.TENCENT_SECRET_KEY = 'tencent-key';
  process.env.DEEPGRAM_API_KEY = 'deepgram-key';
  delete process.env.SPEECH_RECOGNITION_PROVIDER;
  Math.random = () => 0;

  sdk.asr.v20190614.Client = class FakeTencentClient {
    async SentenceRecognition(): Promise<{ Result?: string }> {
      throw new Error('invalid tencent signature');
    }
  };

  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes('deepgram.com')) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: {
          channels: [
            {
              alternatives: [
                { transcript: 'one black suit' }
              ]
            }
          ]
        }
      })
    } as Response;
  }) as typeof fetch;

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
      provider: 'deepgram',
      routing: {
        attemptedProviders: ['tencent', 'deepgram'],
        providerErrors: ['Tencent: invalid tencent signature'],
        forcedProvider: 'auto'
      }
    });
  } finally {
    sdk.asr.v20190614.Client = originalTencentClient;
    global.fetch = originalFetch;
    Math.random = originalRandom;
    restoreEnv('TENCENT_SECRET_ID', originalTencentSecretId);
    restoreEnv('TENCENT_SECRET_KEY', originalTencentSecretKey);
    restoreEnv('DEEPGRAM_API_KEY', originalDeepgramApiKey);
    restoreEnv('SPEECH_RECOGNITION_PROVIDER', originalForcedProvider);
  }
});

test('handler does not silently fall back when Tencent is forced and Tencent fails', async () => {
  const sdk = require('tencentcloud-sdk-nodejs');
  const originalTencentClient = sdk.asr.v20190614.Client;
  const originalFetch = global.fetch;
  const originalTencentSecretId = process.env.TENCENT_SECRET_ID;
  const originalTencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const originalForcedProvider = process.env.SPEECH_RECOGNITION_PROVIDER;
  let fetchCalled = false;

  process.env.TENCENT_SECRET_ID = 'tencent-id';
  process.env.TENCENT_SECRET_KEY = 'tencent-key';
  process.env.DEEPGRAM_API_KEY = 'deepgram-key';
  process.env.SPEECH_RECOGNITION_PROVIDER = 'tencent';

  sdk.asr.v20190614.Client = class FakeTencentClient {
    async SentenceRecognition(): Promise<{ Result?: string }> {
      throw new Error('invalid tencent signature');
    }
  };

  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error('Deepgram should not run when Tencent is forced');
  }) as typeof fetch;

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

    assert.equal(fetchCalled, false);
    assert.equal(responseState.statusCode, 502);
    assert.deepEqual(responseState.payload, {
      error: 'Tencent: invalid tencent signature'
    });
  } finally {
    sdk.asr.v20190614.Client = originalTencentClient;
    global.fetch = originalFetch;
    restoreEnv('TENCENT_SECRET_ID', originalTencentSecretId);
    restoreEnv('TENCENT_SECRET_KEY', originalTencentSecretKey);
    restoreEnv('DEEPGRAM_API_KEY', originalDeepgramApiKey);
    restoreEnv('SPEECH_RECOGNITION_PROVIDER', originalForcedProvider);
  }
});

test('handler uses explicit Tencent secret credentials instead of ProfileCredential file lookup', async () => {
  const sdk = require('tencentcloud-sdk-nodejs');
  const originalTencentClient = sdk.asr.v20190614.Client;
  const originalTencentSecretId = process.env.TENCENT_SECRET_ID;
  const originalTencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const originalForcedProvider = process.env.SPEECH_RECOGNITION_PROVIDER;
  let capturedConfig: unknown = null;

  process.env.TENCENT_SECRET_ID = 'tencent-id';
  process.env.TENCENT_SECRET_KEY = 'tencent-key';
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.SPEECH_RECOGNITION_PROVIDER;

  sdk.asr.v20190614.Client = class FakeTencentClient {
    constructor(config: unknown) {
      capturedConfig = config;
    }

    async SentenceRecognition(): Promise<{ Result?: string; RequestId?: string; AudioDuration?: number }> {
      return {
        Result: 'a big dog',
        RequestId: 'req-123',
        AudioDuration: 900,
      };
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
        providerErrors: [],
        forcedProvider: 'auto'
      }
    });
  } finally {
    sdk.asr.v20190614.Client = originalTencentClient;
    restoreEnv('TENCENT_SECRET_ID', originalTencentSecretId);
    restoreEnv('TENCENT_SECRET_KEY', originalTencentSecretKey);
    restoreEnv('DEEPGRAM_API_KEY', originalDeepgramApiKey);
    restoreEnv('SPEECH_RECOGNITION_PROVIDER', originalForcedProvider);
  }
});
