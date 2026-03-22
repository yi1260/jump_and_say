export interface FallbackRecognizeOptions {
  lang: string;
  maxDurationMs: number;
}

export class FallbackRecognizer {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  /**
   * 开始录音
   */
  async startRecording(): Promise<void> {
    this.audioChunks = [];

    // 获取麦克风权限，配置尽可能小的音频以节省网络带宽
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // 尝试支持的编码格式，优先使用占用带宽小的 opus
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    }

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      audioBitsPerSecond: 16000, // 降低比特率，进一步减小体积
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
  async stopAndRecognize(maxDurationMs: number): Promise<{ transcript: string; durationMs: number }> {
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return reject(new Error('Recorder not initialized or already stopped'));
      }

      this.mediaRecorder.onstop = async () => {
        // 关键修复：录音一旦停止，立刻释放麦克风硬件资源。
        // 如果等到 fetch 请求结束再释放，会导致手机 OS 认为仍处于“通话/录音”状态，
        // 从而降低播放音量（Ducking）或将声音路由到听筒，导致后续的音效和 TTS 播放异常。
        this.cleanup();

        try {
          const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });

          // 强制控制时长
          const durationMs = performance.now() - startedAt;

          // 上传到 Vercel Function
          const response = await fetch('/api/recognize', {
            method: 'POST',
            headers: {
              'Content-Type': mimeType,
            },
            body: audioBlob,
          });

          if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
          }

          const result = await response.json();
          resolve({
            transcript: result.transcript || '',
            durationMs: Math.round(durationMs),
          });
        } catch (error) {
          reject(error);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * 强制终止并清理资源
   */
  abort() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
  }
}
