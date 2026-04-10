import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const config = {
  api: {
    bodyParser: false,
  },
};

const ASSEMBLYAI_POLL_INTERVAL_MS = 1000;
const ASSEMBLYAI_MAX_WAIT_MS = 8000;
const DEEPGRAM_LISTEN_TIMEOUT_MS = 12000;
const ASSEMBLYAI_UPLOAD_TIMEOUT_MS = 12000;
const ASSEMBLYAI_TRANSCRIPT_CREATE_TIMEOUT_MS = 8000;
const ASSEMBLYAI_POLL_REQUEST_TIMEOUT_MS = 4000;
const TENCENT_TIMEOUT_MS = 10000;

interface StageLogger {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

interface FetchWithStageTimeoutOptions {
  stage: string;
  url: string;
  timeoutMs: number;
  init?: RequestInit;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  logger?: StageLogger;
}

interface AssemblyAiPollOptions {
  apiKey: string;
  transcriptId: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

interface AssemblyAiPollResponse {
  status?: string;
  text?: string;
  error?: string;
}

interface RecognitionSuccessPayload {
  transcript: string;
  provider: 'tencent' | 'deepgram' | 'assemblyai';
  requestId?: string;
  audioDurationMs?: number;
  routing?: {
    attemptedProviders: RecognitionProvider[];
    providerErrors: string[];
    forcedProvider: RecognitionProvider | 'auto';
  };
}

type RecognitionProvider = RecognitionSuccessPayload['provider'];

const getContentType = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] || 'audio/webm';
  }
  return value || 'audio/webm';
};

const readRequestBody = async (req: AsyncIterable<Uint8Array | Buffer | string>): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const getForcedProvider = (): RecognitionProvider | null => {
  const rawValue = (
    process.env.SPEECH_RECOGNITION_PROVIDER ||
    process.env.SPEECH_PROVIDER ||
    process.env.FORCE_SPEECH_PROVIDER ||
    ''
  ).trim().toLowerCase();

  if (rawValue === 'tencent' || rawValue === 'deepgram' || rawValue === 'assemblyai') {
    return rawValue;
  }
  return null;
};

const withRoutingMetadata = (
  payload: RecognitionSuccessPayload,
  attemptedProviders: RecognitionProvider[],
  providerErrors: string[],
  forcedProvider: RecognitionProvider | null
): RecognitionSuccessPayload => ({
  ...payload,
  routing: {
    attemptedProviders,
    providerErrors,
    forcedProvider: forcedProvider || 'auto'
  }
});

const withTimeout = async <T>(
  label: string,
  timeoutMs: number,
  task: () => Promise<T>
): Promise<T> => new Promise<T>((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  task()
    .then((value) => {
      clearTimeout(timeoutId);
      resolve(value);
    })
    .catch((error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
});

export const pollAssemblyAiTranscript = async ({
  apiKey,
  transcriptId,
  maxWaitMs = ASSEMBLYAI_MAX_WAIT_MS,
  pollIntervalMs = ASSEMBLYAI_POLL_INTERVAL_MS,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}: AssemblyAiPollOptions): Promise<string> => {
  const deadlineMs = now() + Math.max(0, maxWaitMs);

  while (now() < deadlineMs) {
    const pollRes = await fetchImpl(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { Authorization: apiKey }
    });

    if (!pollRes.ok) {
      throw new Error(`AssemblyAI polling failed with ${pollRes.status}`);
    }

    const pollData = await pollRes.json() as AssemblyAiPollResponse;
    if (pollData.status === 'completed') {
      return pollData.text || '';
    }
    if (pollData.status === 'error') {
      throw new Error(pollData.error || 'AssemblyAI processing error');
    }

    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }

  throw new Error(`AssemblyAI polling timed out after ${maxWaitMs}ms`);
};

export const fetchWithStageTimeout = async ({
  stage,
  url,
  timeoutMs,
  init,
  fetchImpl = fetch,
  now = () => Date.now(),
  logger = console
}: FetchWithStageTimeoutOptions): Promise<Response> => {
  const controller = new AbortController();
  const startedAt = now();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    logger.info('[Vercel] Speech stage start', { stage, timeoutMs });
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
    logger.info('[Vercel] Speech stage complete', {
      stage,
      status: response.status,
      durationMs: Math.max(0, Math.round(now() - startedAt))
    });
    return response;
  } catch (error) {
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    if (controller.signal.aborted) {
      logger.warn('[Vercel] Speech stage timeout', { stage, timeoutMs, durationMs });
      throw new Error(`${stage} timed out after ${timeoutMs}ms`);
    }
    logger.warn('[Vercel] Speech stage failed', {
      stage,
      durationMs,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const transcribeWithTencent = async (
  secretId: string,
  secretKey: string,
  audioBuffer: Buffer,
  voiceFormat: string
): Promise<RecognitionSuccessPayload> => {
  // 使用新版 SDK API (v4.x)
  const { ProfileCredential } = require('tencentcloud-sdk-nodejs/tencentcloud/common');
  const AsrClient = require('tencentcloud-sdk-nodejs').asr.v20190614.Client;

  const cred = new ProfileCredential(secretId, secretKey);
  const client = new AsrClient({ credential: cred, region: 'ap-shanghai' });

  const startTime = Date.now();
  console.info('[Vercel] Tencent ASR start', { voiceFormat, audioLen: audioBuffer.length });

  const resp = await withTimeout('tencent-sentence-recognition', TENCENT_TIMEOUT_MS, async () => (
    new Promise<{ Result?: string; RequestId?: string; AudioDuration?: number }>((resolve, reject) => {
      client.SentenceRecognition({
        EngSerViceType: '16k_en',
        VoiceFormat: voiceFormat,
        SourceType: 1,
        Data: audioBuffer.toString('base64'),
        DataLen: audioBuffer.length,
      }, (err: Error | null, response: { Result?: string; RequestId?: string; AudioDuration?: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    })
  ));

  console.info('[Vercel] Tencent ASR complete', {
    resultLen: resp.Result?.length || 0,
    durationMs: Date.now() - startTime,
    requestId: resp.RequestId,
    audioDurationMs: resp.AudioDuration
  });

  return {
    transcript: resp.Result || '',
    provider: 'tencent',
    requestId: resp.RequestId,
    audioDurationMs: resp.AudioDuration
  };
};

const transcribeWithDeepgram = async (
  apiKey: string,
  audioBuffer: Buffer,
  contentType: string
): Promise<RecognitionSuccessPayload> => {
  const response = await fetchWithStageTimeout({
    stage: 'deepgram-listen',
    url: 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=en',
    timeoutMs: DEEPGRAM_LISTEN_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': contentType,
      },
      body: audioBuffer,
      duplex: 'half',
    } as RequestInit
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText ? `Deepgram API error: ${errorText}` : `Deepgram API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    transcript: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
    provider: 'deepgram'
  };
};

const transcribeWithAssemblyAi = async (
  apiKey: string,
  audioBuffer: Buffer
): Promise<RecognitionSuccessPayload> => {
  const uploadRes = await fetchWithStageTimeout({
    stage: 'assemblyai-upload',
    url: 'https://api.assemblyai.com/v2/upload',
    timeoutMs: ASSEMBLYAI_UPLOAD_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/octet-stream'
      },
      body: audioBuffer
    }
  });
  if (!uploadRes.ok) throw new Error('AssemblyAI upload failed');
  const { upload_url } = await uploadRes.json();

  const transcriptRes = await fetchWithStageTimeout({
    stage: 'assemblyai-transcript-create',
    url: 'https://api.assemblyai.com/v2/transcript',
    timeoutMs: ASSEMBLYAI_TRANSCRIPT_CREATE_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: 'en_us'
      })
    }
  });
  if (!transcriptRes.ok) throw new Error('AssemblyAI transcript failed');
  const { id } = await transcriptRes.json();

  const transcript = await pollAssemblyAiTranscript({
    apiKey,
    transcriptId: id,
    fetchImpl: (url, init) => fetchWithStageTimeout({
      stage: 'assemblyai-poll',
      url,
      timeoutMs: ASSEMBLYAI_POLL_REQUEST_TIMEOUT_MS,
      init
    })
  });

  return {
    transcript,
    provider: 'assemblyai'
  };
};

const isWebmFormat = (contentType: string): boolean => {
  const normalized = contentType.toLowerCase();
  return normalized.includes('webm') || normalized.includes('opus');
};

const getFfmpegPath = (): string => {
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    return ffmpegInstaller.path;
  } catch {
    return 'ffmpeg';
  }
};

const convertWebmToWav = async (webmBuffer: Buffer): Promise<{ wavBuffer: Buffer; ffmpegPath: string }> => {
  // 使用 createRequire 兼容 ESM 模块
  const ffmpeg = require('fluent-ffmpeg');

  const ffmpegPath = getFfmpegPath();
  ffmpeg.setFfmpegPath(ffmpegPath);

  const stream = require('stream');

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = new stream.PassThrough();
    readable.end(webmBuffer);

    ffmpeg(readable)
      .inputFormat('webm')
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', (err: Error) => {
        reject(err);
      })
      .on('end', () => {
        resolve({
          wavBuffer: Buffer.concat(chunks),
          ffmpegPath
        });
      })
      .pipe()
      .on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
  });
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tencentSecretId = process.env.TENCENT_SECRET_ID;
  const tencentSecretKey = process.env.TENCENT_SECRET_KEY;
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const assemblyApiKey = process.env.ASSEMBLYAI_API_KEY;
  const forcedProvider = getForcedProvider();
  const hasTencentConfig = Boolean(tencentSecretId && tencentSecretKey);
  const hasPartialTencentConfig = Boolean((tencentSecretId || tencentSecretKey) && !hasTencentConfig);

  if (!hasTencentConfig && !deepgramApiKey && !assemblyApiKey) {
    return res.status(500).json({ error: 'No Speech API Key configured' });
  }

  if (hasPartialTencentConfig) {
    console.warn('[Vercel] Tencent credentials are partially configured.', {
      hasSecretId: Boolean(tencentSecretId),
      hasSecretKey: Boolean(tencentSecretKey)
    });
  }

  try {
    const contentType = getContentType(req.headers['content-type']);
    const audioBuffer = await readRequestBody(req);
    const providerErrors: string[] = [];
    const attemptedProviders: RecognitionProvider[] = [];
    let sawTimeout = false;

    const isWebm = isWebmFormat(contentType);
    console.info('[Vercel] Speech provider routing', {
      forcedProvider: forcedProvider || 'auto',
      hasTencentConfig,
      hasDeepgramConfig: Boolean(deepgramApiKey),
      hasAssemblyConfig: Boolean(assemblyApiKey),
      contentType,
      audioLen: audioBuffer.length,
      isWebm
    });

    if (hasTencentConfig && (!forcedProvider || forcedProvider === 'tencent')) {
      attemptedProviders.push('tencent');
      try {
        if (isWebm) {
          console.info('[Vercel] WebM format detected, converting to WAV for Tencent ASR');
          try {
            const { wavBuffer, ffmpegPath } = await convertWebmToWav(audioBuffer);
            console.info('[Vercel] WebM to WAV conversion complete', {
              inputLen: audioBuffer.length,
              wavLen: wavBuffer.length,
              ffmpegPath
            });
            const result = await transcribeWithTencent(tencentSecretId!, tencentSecretKey!, wavBuffer, 'wav');
            return res.status(200).json(withRoutingMetadata(result, attemptedProviders, providerErrors, forcedProvider));
          } catch (convertError) {
            console.warn('[Vercel] WebM to WAV conversion failed before Tencent ASR.', {
              message: toErrorMessage(convertError)
            });
            providerErrors.push(`Tencent: ${toErrorMessage(convertError)}`);
            if (forcedProvider === 'tencent') {
              return res.status(502).json({ error: providerErrors.join(' | ') });
            }
          }
        } else {
          const result = await transcribeWithTencent(tencentSecretId!, tencentSecretKey!, audioBuffer, 'wav');
          return res.status(200).json(withRoutingMetadata(result, attemptedProviders, providerErrors, forcedProvider));
        }
      } catch (error) {
        const message = toErrorMessage(error);
        console.warn('[Vercel] Tencent recognition failed, trying next provider.', { message });
        providerErrors.push(`Tencent: ${message}`);
        sawTimeout = sawTimeout || /timed out|timeout/i.test(message);
        if (forcedProvider === 'tencent') {
          return res.status(sawTimeout ? 504 : 502).json({ error: providerErrors.join(' | ') });
        }
      }
    } else if (forcedProvider === 'tencent') {
      providerErrors.push(hasPartialTencentConfig
        ? 'Tencent: incomplete credentials'
        : 'Tencent: provider not configured');
      return res.status(500).json({ error: providerErrors.join(' | ') });
    }

    if (deepgramApiKey && (!forcedProvider || forcedProvider === 'deepgram')) {
      attemptedProviders.push('deepgram');
      try {
        const result = await transcribeWithDeepgram(deepgramApiKey, audioBuffer, contentType);
        return res.status(200).json(withRoutingMetadata(result, attemptedProviders, providerErrors, forcedProvider));
      } catch (error) {
        const message = toErrorMessage(error);
        console.warn('[Vercel] Deepgram recognition failed, trying next provider.', { message });
        providerErrors.push(`Deepgram: ${message}`);
        sawTimeout = sawTimeout || /timed out/i.test(message);
        if (forcedProvider === 'deepgram') {
          return res.status(sawTimeout ? 504 : 502).json({ error: providerErrors.join(' | ') });
        }
      }
    } else if (forcedProvider === 'deepgram') {
      providerErrors.push('Deepgram: provider not configured');
      return res.status(500).json({ error: providerErrors.join(' | ') });
    }

    if (assemblyApiKey && (!forcedProvider || forcedProvider === 'assemblyai')) {
      attemptedProviders.push('assemblyai');
      try {
        const result = await transcribeWithAssemblyAi(assemblyApiKey, audioBuffer);
        return res.status(200).json(withRoutingMetadata(result, attemptedProviders, providerErrors, forcedProvider));
      } catch (error) {
        const message = toErrorMessage(error);
        console.warn('[Vercel] AssemblyAI recognition failed.', { message });
        providerErrors.push(`AssemblyAI: ${message}`);
        sawTimeout = sawTimeout || /timed out/i.test(message);
        if (forcedProvider === 'assemblyai') {
          return res.status(sawTimeout ? 504 : 502).json({ error: providerErrors.join(' | ') });
        }
      }
    } else if (forcedProvider === 'assemblyai') {
      providerErrors.push('AssemblyAI: provider not configured');
      return res.status(500).json({ error: providerErrors.join(' | ') });
    }

    if (providerErrors.length > 0) {
      return res.status(sawTimeout ? 504 : 502).json({ error: providerErrors.join(' | ') });
    }
  } catch (error: any) {
    const errorMessage = toErrorMessage(error);
    console.error('[Vercel] Speech recognition proxy error:', error);
    if (/timed out/i.test(errorMessage)) {
      return res.status(504).json({ error: errorMessage });
    }
    return res.status(500).json({ error: errorMessage || 'Internal server error' });
  }
}
