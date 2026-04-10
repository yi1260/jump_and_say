export interface FallbackRecognizeOptions {
  lang: string;
  maxDurationMs: number;
}

export interface StartRecordingOptions {
  onSilence?: () => void;
  preferredStream?: MediaStream | null;
}

export type CloudRecognitionProvider = 'tencent' | 'deepgram' | 'assemblyai' | 'unknown';

interface RecognitionRoutingMetadata {
  attemptedProviders?: CloudRecognitionProvider[];
  providerErrors?: string[];
  forcedProvider?: CloudRecognitionProvider | 'auto';
}

const RECOGNITION_PROXY_TIMEOUT_MS = 20000;

const readRecognitionApiError = async (response: Response): Promise<string> => {
  const jsonTarget = typeof response.clone === 'function' ? response.clone() : response;
  try {
    const payload = await jsonTarget.json() as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error.trim();
    }
  } catch (_error) {
    // Ignore JSON parsing failures and fall back to text.
  }

  const textTarget = typeof response.clone === 'function' ? response.clone() : response;
  try {
    const text = await textTarget.text();
    const normalized = text.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  } catch (_error) {
    // Ignore text parsing failures and fall back to status-only error.
  }

  return '';
};

export class FallbackRecognizer {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private vadContext: AudioContext | null = null;
  private vadFrameId: number | null = null;
  private onSilenceDetected: (() => void) | null = null;
  private ownsStream: boolean = false;
  private activeMimeType: string = 'audio/webm';

  /**
   * 开始录音，并附加简单的静音检测 (VAD)
   */
  async startRecording(onSilence?: (() => void) | StartRecordingOptions, preferredStream?: MediaStream | null): Promise<void> {
    this.cleanup();
    this.audioChunks = [];
    this.onSilenceDetected = typeof onSilence === 'function'
      ? onSilence
      : (onSilence?.onSilence ?? null);
    const providedStream = typeof onSilence === 'function'
      ? preferredStream
      : (onSilence?.preferredStream ?? preferredStream ?? null);

    // 获取麦克风权限
    if (providedStream) {
      this.stream = providedStream;
      this.ownsStream = false;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this.ownsStream = true;
    }

    // --- 简单的 VAD (静音检测) 逻辑 ---
    try {
      this.vadContext = new window.AudioContext();
      const source = this.vadContext.createMediaStreamSource(this.stream);
      const analyser = this.vadContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let hasSpoken = false;
      let silenceStart = 0;
      
      const checkSilence = () => {
        if (!this.vadContext) return;
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // 设一个极低的阈值，大于这个值认为有声音
        const isSpeaking = average > 8; 

        if (isSpeaking) {
          hasSpoken = true;
          silenceStart = 0;
        } else if (hasSpoken) {
          if (silenceStart === 0) {
            silenceStart = performance.now();
          } else if (performance.now() - silenceStart > 1200) {
            // 已经说过话，且连续安静超过 1.2 秒 -> 触发提前结束
            console.info('[FallbackRecognizer] Silence detected, stopping early.');
            if (this.onSilenceDetected) {
              this.onSilenceDetected();
            }
            return; // 结束检测循环
          }
        }
        
        this.vadFrameId = requestAnimationFrame(checkSilence);
      };
      this.vadFrameId = requestAnimationFrame(checkSilence);
    } catch (e) {
      console.warn('[FallbackRecognizer] VAD setup failed, will fallback to fixed timeout.', e);
    }
    // --- VAD 结束 ---

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    }
    this.activeMimeType = mimeType;

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      audioBitsPerSecond: 16000,
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
  }

  /**
   * 停止录音并请求云端 API
   */
  async stopAndRecognize(maxDurationMs: number): Promise<{ transcript: string; durationMs: number; provider: CloudRecognitionProvider }> {
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return reject(new Error('Recorder not initialized or already stopped'));
      }
      const recorder = this.mediaRecorder;
      const mimeType = recorder.mimeType || this.activeMimeType || 'audio/webm';

      recorder.onstop = async () => {
        // 立刻释放硬件资源
        this.cleanup();

        try {
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });
          const requestStartedAt = performance.now();
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => {
            controller.abort();
          }, RECOGNITION_PROXY_TIMEOUT_MS);

          let response: Response;
          try {
            console.info('[FallbackRecognizer] Posting audio to /api/recognize', {
              mimeType,
              size: audioBlob.size
            });
            response = await fetch('/api/recognize', {
              method: 'POST',
              headers: { 'Content-Type': mimeType },
              body: audioBlob,
              signal: controller.signal,
            });
            console.info('[FallbackRecognizer] /api/recognize completed', {
              status: response.status,
              durationMs: Math.max(0, Math.round(performance.now() - requestStartedAt))
            });
          } catch (error) {
            if (controller.signal.aborted) {
              throw new Error(`recognition-proxy timed out after ${RECOGNITION_PROXY_TIMEOUT_MS}ms`);
            }
            throw error;
          } finally {
            clearTimeout(timeoutId);
          }

          if (!response.ok) {
            const errorDetail = await readRecognitionApiError(response);
            throw new Error(errorDetail ? `API returned ${response.status}: ${errorDetail}` : `API returned ${response.status}`);
          }

          const result = await response.json() as {
            transcript?: string;
            provider?: CloudRecognitionProvider;
            requestId?: string;
            audioDurationMs?: number;
            routing?: RecognitionRoutingMetadata;
          };
          console.info('[FallbackRecognizer] Recognition payload received', {
            provider: result.provider || 'unknown',
            transcriptLength: result.transcript?.trim().length || 0,
            requestId: result.requestId,
            audioDurationMs: result.audioDurationMs,
            attemptedProviders: result.routing?.attemptedProviders || [],
            providerErrors: result.routing?.providerErrors || [],
            forcedProvider: result.routing?.forcedProvider || 'auto',
            totalDurationMs: Math.max(0, Math.round(performance.now() - startedAt))
          });
          if ((result.routing?.providerErrors?.length || 0) > 0) {
            console.warn('[FallbackRecognizer] Cloud provider fallback occurred.', {
              finalProvider: result.provider || 'unknown',
              attemptedProviders: result.routing?.attemptedProviders || [],
              providerErrors: result.routing?.providerErrors || [],
              forcedProvider: result.routing?.forcedProvider || 'auto'
            });
          }
          resolve({
            transcript: result.transcript || '',
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            provider: result.provider || 'unknown',
          });
        } catch (error) {
          reject(error);
        }
      };

      // 停止录音触发 onstop
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    });
  }

  abort() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.vadFrameId !== null) {
      cancelAnimationFrame(this.vadFrameId);
      this.vadFrameId = null;
    }
    if (this.vadContext && this.vadContext.state !== 'closed') {
      this.vadContext.close().catch(() => {});
      this.vadContext = null;
    }
    if (this.stream && this.ownsStream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
    this.stream = null;
    this.ownsStream = false;
    this.mediaRecorder = null;
    this.activeMimeType = 'audio/webm';
    this.onSilenceDetected = null;
  }
}
