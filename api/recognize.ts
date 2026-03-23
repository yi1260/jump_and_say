export const config = {
  api: {
    bodyParser: false, // 禁用默认的 body 解析，直接处理音频流
  },
};

const ASSEMBLYAI_POLL_INTERVAL_MS = 1000;
const ASSEMBLYAI_MAX_WAIT_MS = 2500;

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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const assemblyApiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!deepgramApiKey && !assemblyApiKey) {
    return res.status(500).json({ error: 'No Speech API Key configured' });
  }

  try {
    // 使用 Deepgram (首选，因为它是真正的实时同步返回，速度极快)
    if (deepgramApiKey) {
      // 提取前端传来的 mimetype，比如 audio/webm
      const contentType = req.headers['content-type'] || 'audio/webm';
      
      const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=en', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramApiKey}`,
          'Content-Type': contentType,
        },
        body: req,
        duplex: 'half',
      } as RequestInit);

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Vercel] Deepgram error:', errText);
        return res.status(response.status).json({ error: 'Deepgram API error' });
      }

      const data = await response.json();
      const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      return res.status(200).json({ transcript, provider: 'deepgram' });
    }

    // 使用 AssemblyAI (备选，需要上传 -> 发起转写 -> 轮询，稍微慢一点)
    if (assemblyApiKey) {
      // 1. 获取完整的音频 buffer (因为我们要先上传)
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      // 2. 上传文件到 AssemblyAI
      const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'Authorization': assemblyApiKey,
          'Content-Type': 'application/octet-stream'
        },
        body: audioBuffer
      });
      if (!uploadRes.ok) throw new Error('AssemblyAI upload failed');
      const { upload_url } = await uploadRes.json();

      // 3. 提交转写任务
      const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': assemblyApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio_url: upload_url,
          language_code: 'en_us'
        })
      });
      if (!transcriptRes.ok) throw new Error('AssemblyAI transcript failed');
      const { id } = await transcriptRes.json();

      const transcript = await pollAssemblyAiTranscript({
        apiKey: assemblyApiKey,
        transcriptId: id
      });
      return res.status(200).json({ transcript, provider: 'assemblyai' });
    }
  } catch (error: any) {
    console.error('[Vercel] Speech recognition proxy error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
