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
}

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

  // 使用 Promise 包装 callback 风格的 API
  const resp = await new Promise<{ Result: string }>((resolve, reject) => {
    client.SentenceRecognition({
      EngSerViceType: '16k_en',
      VoiceFormat: voiceFormat,
      SourceType: 1,
      Data: audioBuffer.toString('base64'),
      DataLen: audioBuffer.length,
    }, (err: Error | null, response: { Result: string }) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });

  console.info('[Vercel] Tencent ASR complete', {
    resultLen: resp.Result?.length || 0,
    durationMs: Date.now() - startTime
  });

  return {
    transcript: resp.Result || '',
    provider: 'tencent'
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

const convertWebmToWav = async (webmBuffer: Buffer): Promise<Buffer> => {
  // 使用 createRequire 兼容 ESM 模块
  const ffmpeg = require('fluent-ffmpeg');

  // 优先使用系统 FFmpeg（本地开发），回退到 @ffmpeg-installer（生产环境）
  let ffmpegPath: string;
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    ffmpegPath = ffmpegInstaller.path;
  } catch {
    // 本地开发环境，使用系统 FFmpeg
    ffmpegPath = 'ffmpeg';
  }
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
        resolve(Buffer.concat(chunks));
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

  if (!tencentSecretId && !tencentSecretKey && !deepgramApiKey && !assemblyApiKey) {
    return res.status(500).json({ error: 'No Speech API Key configured' });
  }

  try {
    const contentType = getContentType(req.headers['content-type']);
    const audioBuffer = await readRequestBody(req);
    const providerErrors: string[] = [];
    let sawTimeout = false;

    const isWebm = isWebmFormat(contentType);

    if (tencentSecretId && tencentSecretKey) {
      try {
        if (isWebm) {
          console.info('[Vercel] WebM format detected, converting to WAV for Tencent ASR');
          try {
            const wavBuffer = await convertWebmToWav(audioBuffer);
            const result = await transcribeWithTencent(tencentSecretId, tencentSecretKey, wavBuffer, 'wav');
            return res.status(200).json(result);
          } catch (convertError) {
            console.warn('[Vercel] WebM to WAV conversion failed, falling back to Deepgram:', convertError);
            providerErrors.push(`Tencent: ${toErrorMessage(convertError)}`);
          }
        } else {
          const result = await transcribeWithTencent(tencentSecretId, tencentSecretKey, audioBuffer, 'wav');
          return res.status(200).json(result);
        }
      } catch (error) {
        const message = toErrorMessage(error);
        console.warn('[Vercel] Tencent recognition failed, trying next provider.', { message });
        providerErrors.push(`Tencent: ${message}`);
        sawTimeout = sawTimeout || /timed out|timeout/i.test(message);
      }
    }

    if (deepgramApiKey) {
      try {
        const result = await transcribeWithDeepgram(deepgramApiKey, audioBuffer, contentType);
        return res.status(200).json(result);
      } catch (error) {
        const message = toErrorMessage(error);
        console.warn('[Vercel] Deepgram recognition failed, trying next provider.', { message });
        providerErrors.push(`Deepgram: ${message}`);
        sawTimeout = sawTimeout || /timed out/i.test(message);
      }
    }

    if (assemblyApiKey) {
      try {
        const result = await transcribeWithAssemblyAi(assemblyApiKey, audioBuffer);
        return res.status(200).json(result);
      } catch (error) {
        const message = toErrorMessage(error);
        console.warn('[Vercel] AssemblyAI recognition failed.', { message });
        providerErrors.push(`AssemblyAI: ${message}`);
        sawTimeout = sawTimeout || /timed out/i.test(message);
      }
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
