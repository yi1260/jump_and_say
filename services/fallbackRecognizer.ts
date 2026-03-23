export interface FallbackRecognizeOptions {
  lang: string;
  maxDurationMs: number;
}

export class FallbackRecognizer {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private vadContext: AudioContext | null = null;
  private vadFrameId: number | null = null;
  private onSilenceDetected: (() => void) | null = null;

  /**
   * 开始录音，并附加简单的静音检测 (VAD)
   */
  async startRecording(onSilence?: () => void): Promise<void> {
    this.audioChunks = [];
    this.onSilenceDetected = onSilence || null;

    // 获取麦克风权限
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

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
  async stopAndRecognize(maxDurationMs: number): Promise<{ transcript: string; durationMs: number }> {
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return reject(new Error('Recorder not initialized or already stopped'));
      }

      this.mediaRecorder.onstop = async () => {
        // 立刻释放硬件资源
        this.cleanup();

        try {
          const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });
          const durationMs = performance.now() - startedAt;

          const response = await fetch('/api/recognize', {
            method: 'POST',
            headers: { 'Content-Type': mimeType },
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

      // 停止录音触发 onstop
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
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
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.onSilenceDetected = null;
  }
}
