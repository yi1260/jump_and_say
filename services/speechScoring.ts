import { FallbackRecognizer, type CloudRecognitionProvider } from './fallbackRecognizer.ts';

type SpeechRecognitionResultReason =
  | 'ok'
  | 'unsupported'
  | 'timeout'
  | 'no-speech'
  | 'aborted'
  | 'network'
  | 'not-allowed'
  | 'error';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
  length: number;
  isFinal?: boolean;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    [index: number]: SpeechRecognitionResultLike;
    length: number;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLikeEventMap {
  result: SpeechRecognitionEventLike;
  error: SpeechRecognitionErrorEventLike;
  end: Event;
  nomatch: Event;
  start: Event;
  audiostart: Event;
  audioend: Event;
  soundstart: Event;
  soundend: Event;
  speechstart: Event;
  speechend: Event;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onaudiostart: ((event: Event) => void) | null;
  onaudioend: ((event: Event) => void) | null;
  onsoundstart: ((event: Event) => void) | null;
  onsoundend: ((event: Event) => void) | null;
  onspeechstart: ((event: Event) => void) | null;
  onspeechend: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  onnomatch: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener<K extends keyof SpeechRecognitionLikeEventMap>(
    type: K,
    listener: (event: SpeechRecognitionLikeEventMap[K]) => void
  ): void;
  removeEventListener<K extends keyof SpeechRecognitionLikeEventMap>(
    type: K,
    listener: (event: SpeechRecognitionLikeEventMap[K]) => void
  ): void;
}

interface SpeechRecognitionLikeConstructor {
  new (): SpeechRecognitionLike;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionLikeConstructor;
    webkitSpeechRecognition?: SpeechRecognitionLikeConstructor;
  }
}

export interface RecognizeOnceOptions {
  lang: string;
  maxDurationMs: number;
  inputStream?: MediaStream | null;
}

export interface RecognizeOnceResult {
  transcript: string;
  confidence: number;
  reason: SpeechRecognitionResultReason;
  durationMs: number;
  provider?: 'native' | CloudRecognitionProvider;
}

const getSpeechRecognitionCtor = (): SpeechRecognitionLikeConstructor | null => (
  typeof window === 'undefined'
    ? null
    : (window.SpeechRecognition || window.webkitSpeechRecognition || null)
);

const RECOGNITION_START_TIMEOUT_FLOOR_MS = 300;
const RECOGNITION_END_GRACE_MS = 180;

const clampScore = (score: number): number => {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
};

const levenshteinDistance = (source: string, target: string): number => {
  if (source === target) return 0;
  const sourceLength = source.length;
  const targetLength = target.length;
  if (sourceLength === 0) return targetLength;
  if (targetLength === 0) return sourceLength;

  const previousRow: number[] = Array.from({ length: targetLength + 1 }, (_, idx) => idx);
  const currentRow: number[] = new Array(targetLength + 1).fill(0);

  for (let i = 1; i <= sourceLength; i += 1) {
    currentRow[0] = i;
    const sourceChar = source.charCodeAt(i - 1);
    for (let j = 1; j <= targetLength; j += 1) {
      const targetChar = target.charCodeAt(j - 1);
      const substitutionCost = sourceChar === targetChar ? 0 : 1;
      const deletion = previousRow[j] + 1;
      const insertion = currentRow[j - 1] + 1;
      const substitution = previousRow[j - 1] + substitutionCost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
    for (let j = 0; j <= targetLength; j += 1) {
      previousRow[j] = currentRow[j];
    }
  }

  return previousRow[targetLength];
};

const joinTokens = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(' ');
};

const buildTokenString = (tokens: string[]): string => {
  if (tokens.length === 0) return '';
  return tokens.join(' ');
};

export const normalizeText = (text: string): string => (
  text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const scorePronunciation = (targetText: string, transcript: string): number => {
  const normalizedTarget = normalizeText(targetText);
  const normalizedTranscript = normalizeText(transcript);

  if (!normalizedTarget || !normalizedTranscript) {
    return 0;
  }

  if (normalizedTarget === normalizedTranscript) {
    return 100;
  }

  const charDistance = levenshteinDistance(normalizedTarget, normalizedTranscript);
  const maxCharLength = Math.max(normalizedTarget.length, normalizedTranscript.length);
  const charSimilarity = maxCharLength > 0 ? 1 - charDistance / maxCharLength : 0;

  const targetTokens = joinTokens(normalizedTarget);
  const transcriptTokens = joinTokens(normalizedTranscript);
  const tokenTarget = buildTokenString(targetTokens);
  const tokenTranscript = buildTokenString(transcriptTokens);
  const tokenDistance = levenshteinDistance(tokenTarget, tokenTranscript);
  const maxTokenLength = Math.max(tokenTarget.length, tokenTranscript.length);
  const tokenSimilarity = maxTokenLength > 0 ? 1 - tokenDistance / maxTokenLength : 0;

  const weightedScore = (charSimilarity * 0.65 + tokenSimilarity * 0.35) * 100;
  return clampScore(weightedScore);
};

const mapRecognitionError = (errorName: string): SpeechRecognitionResultReason => {
  if (errorName === 'aborted') return 'aborted';
  if (errorName === 'no-speech') return 'no-speech';
  if (errorName === 'network') return 'network';
  if (errorName === 'not-allowed' || errorName === 'service-not-allowed') return 'not-allowed';
  return 'error';
};

const canUseFallbackRecognition = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
  const hasGetUserMedia = Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
  return hasMediaRecorder && hasGetUserMedia;
};

class SpeechScoringService {
  private fallbackRecognizer = new FallbackRecognizer();
  public isNativeBroken = false;

  isSupported(): boolean {
    return Boolean(getSpeechRecognitionCtor()) || canUseFallbackRecognition();
  }

  async recognizeOnce(options: RecognizeOnceOptions): Promise<RecognizeOnceResult> {
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (RecognitionCtor && !this.isNativeBroken) {
      const nativeResult = await this.recognizeWithNative(options, RecognitionCtor);
      if (nativeResult.transcript.trim().length > 0) {
        this.isNativeBroken = false;
        return nativeResult;
      }

      if (!this.shouldFallbackAfterNativeFailure(nativeResult.reason)) {
        return nativeResult;
      }

      if (canUseFallbackRecognition()) {
        console.info('[Pronounce] Native recognition failed; falling back to cloud recognition.', {
          reason: nativeResult.reason
        });
        const fallbackResult = await this.recognizeWithFallback(options);
        if (fallbackResult.transcript.trim().length > 0) {
          return fallbackResult;
        }
        return fallbackResult.reason === 'error' ? nativeResult : fallbackResult;
      }

      return nativeResult;
    }

    if (canUseFallbackRecognition()) {
      console.info('[Pronounce] Native recognition unavailable; using cloud fallback directly.', {
        hasNativeRecognition: Boolean(RecognitionCtor),
        isNativeBroken: this.isNativeBroken
      });
      return this.recognizeWithFallback(options);
    }

    return {
      transcript: '',
      confidence: 0,
      reason: 'unsupported',
      durationMs: 0,
      provider: 'unknown'
    };
  }

  private shouldFallbackAfterNativeFailure(reason: SpeechRecognitionResultReason): boolean {
    return reason === 'unsupported' || reason === 'network' || reason === 'error' || reason === 'aborted';
  }

  private async recognizeWithNative(
    options: RecognizeOnceOptions,
    RecognitionCtor: SpeechRecognitionLikeConstructor
  ): Promise<RecognizeOnceResult> {
    const startedAt = performance.now();

    return new Promise<RecognizeOnceResult>((resolve) => {
      const recognition = new RecognitionCtor();
      recognition.lang = options.lang;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      let transcript = '';
      let confidence = 0;
      let finalized = false;
      let forcedTimeout = false;
      let mappedErrorReason: SpeechRecognitionResultReason | null = null;
      let timeoutId: number | null = null;
      let forceFinalizeId: number | null = null;

      const clearTimersIfNeeded = (): void => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (forceFinalizeId !== null) {
          window.clearTimeout(forceFinalizeId);
          forceFinalizeId = null;
        }
      };

      const buildFinalReason = (
        preferredReason: SpeechRecognitionResultReason | null = null
      ): SpeechRecognitionResultReason => {
        if (transcript.trim().length > 0) {
          return 'ok';
        }
        if (forcedTimeout) {
          return 'timeout';
        }
        return preferredReason || mappedErrorReason || 'no-speech';
      };

      const finalize = (reason: SpeechRecognitionResultReason): void => {
        if (finalized) return;
        finalized = true;
        clearTimersIfNeeded();
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        resolve({
          transcript: transcript.trim(),
          confidence: Math.max(0, Math.min(1, confidence)),
          reason,
          durationMs,
          provider: 'native'
        });
      };

      const scheduleForceFinalize = (
        reason: SpeechRecognitionResultReason,
        delayMs: number,
        cause: string
      ): void => {
        if (finalized || forceFinalizeId !== null) return;
        forceFinalizeId = window.setTimeout(() => {
          forceFinalizeId = null;
          if (finalized) return;
          console.warn('[Pronounce] SpeechRecognition forcing finalize after missing end event.', {
            cause,
            reason,
            transcriptLength: transcript.trim().length,
            confidence,
            forcedTimeout,
            mappedErrorReason
          });
          try {
            recognition.abort();
          } catch (error) {
            console.warn('[Pronounce] SpeechRecognition abort failed during forced finalize:', error);
          }
          finalize(buildFinalReason(reason));
        }, Math.max(0, delayMs));
      };

      recognition.onstart = (): void => {
        console.info('[Pronounce] Native SpeechRecognition started.', {
          lang: options.lang,
          maxDurationMs: options.maxDurationMs
        });
      };

      recognition.onaudiostart = (): void => {
        console.info('[Pronounce] SpeechRecognition audio capture started.');
      };

      recognition.onaudioend = (): void => {
        console.info('[Pronounce] SpeechRecognition audio capture ended.');
      };

      recognition.onsoundstart = (): void => {
        console.info('[Pronounce] SpeechRecognition sound detected.');
      };

      recognition.onsoundend = (): void => {
        console.info('[Pronounce] SpeechRecognition sound ended.');
      };

      recognition.onspeechstart = (): void => {
        console.info('[Pronounce] SpeechRecognition speech detected.');
      };

      recognition.onspeechend = (): void => {
        console.info('[Pronounce] SpeechRecognition speech ended.');
      };

      recognition.onresult = (event: SpeechRecognitionEventLike): void => {
        let currentTranscript = '';
        let latestConfidence = 0;
        let isFinal = false;

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const alt = result[0];
          if (!alt || typeof alt.transcript !== 'string') continue;
          currentTranscript += alt.transcript;
          if (typeof alt.confidence === 'number' && Number.isFinite(alt.confidence)) {
            latestConfidence = Math.max(latestConfidence, alt.confidence);
          }
          if (result.isFinal) {
            isFinal = true;
          }
        }

        if (currentTranscript.trim().length > 0) {
          transcript = currentTranscript.trim();
          confidence = Math.max(confidence, latestConfidence);
          console.info('[Pronounce] SpeechRecognition result received.', {
            transcript,
            confidence,
            isFinal
          });

          if (isFinal) {
            try {
              recognition.stop();
            } catch (error) {
              console.warn('[Pronounce] SpeechRecognition stop failed after result:', error);
            }
            finalize('ok');
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike): void => {
        mappedErrorReason = mapRecognitionError(event.error);
        if (mappedErrorReason === 'network') {
          console.warn('[Pronounce] Detected native network error, marking native recognition as broken.');
          this.isNativeBroken = true;
        }
        console.warn('[Pronounce] SpeechRecognition error event received.', {
          error: event.error,
          message: event.message,
          mappedErrorReason
        });
        scheduleForceFinalize(mappedErrorReason, RECOGNITION_END_GRACE_MS, `error:${event.error}`);
      };

      recognition.onnomatch = (): void => {
        mappedErrorReason = 'no-speech';
        console.info('[Pronounce] SpeechRecognition no match.');
        scheduleForceFinalize('no-speech', RECOGNITION_END_GRACE_MS, 'nomatch');
      };

      recognition.onend = (): void => {
        console.info('[Pronounce] SpeechRecognition ended.', {
          transcriptLength: transcript.trim().length,
          forcedTimeout,
          mappedErrorReason
        });
        finalize(buildFinalReason());
      };

      timeoutId = window.setTimeout(() => {
        forcedTimeout = true;
        console.warn('[Pronounce] SpeechRecognition timed out, requesting stop.', {
          maxDurationMs: options.maxDurationMs
        });
        try {
          recognition.stop();
          scheduleForceFinalize('timeout', RECOGNITION_END_GRACE_MS, 'timeout-stop-without-end');
        } catch (error) {
          console.warn('[Pronounce] SpeechRecognition stop failed on timeout:', error);
          finalize('timeout');
        }
      }, Math.max(RECOGNITION_START_TIMEOUT_FLOOR_MS, options.maxDurationMs));

      try {
        recognition.start();
      } catch (error) {
        console.warn('[Pronounce] SpeechRecognition start failed:', error);
        finalize('error');
      }
    });
  }

  // 降级方案：使用 MediaRecorder 录制音频并发送到后端 API
  private async recognizeWithFallback(options: RecognizeOnceOptions): Promise<RecognizeOnceResult> {
    console.info('[Pronounce] Using Fallback API for speech recognition');
    try {
      const { transcript, durationMs, provider } = await new Promise<{transcript: string, durationMs: number, provider: CloudRecognitionProvider}>((resolve, reject) => {
        let isDone = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const doStop = () => {
          if (isDone) return;
          isDone = true;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          this.fallbackRecognizer.stopAndRecognize(options.maxDurationMs)
            .then(resolve)
            .catch(reject);
        };

        // 绑定静音检测回调：一旦检测到用户说完了，立刻停止录音去请求接口
        this.fallbackRecognizer.startRecording({
          onSilence: () => {
            doStop();
          },
          preferredStream: options.inputStream ?? null
        }).catch(reject);

        // 如果用户一直不出声或一直有杂音，最多等 5 秒强制上传
        timer = setTimeout(() => {
          doStop();
        }, Math.min(options.maxDurationMs, 5000));
      });

      console.info('[Pronounce] Fallback API recognition completed.', {
        provider,
        transcriptLength: transcript.trim().length,
        durationMs
      });

      return {
        transcript,
        confidence: transcript ? 0.9 : 0, // Fallback API 暂未返回置信度，给个默认高分
        reason: transcript ? 'ok' : 'no-speech',
        durationMs,
        provider
      };
    } catch (error) {
      console.error('[Pronounce] Fallback API failed:', error);
      return {
        transcript: '',
        confidence: 0,
        reason: 'error',
        durationMs: 0,
        provider: 'unknown'
      };
    }
  }
}

export const speechScoringService = new SpeechScoringService();
