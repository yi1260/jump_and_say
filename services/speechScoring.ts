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
}

export interface RecognizeOnceResult {
  transcript: string;
  confidence: number;
  reason: SpeechRecognitionResultReason;
  durationMs: number;
}

const getSpeechRecognitionCtor = (): SpeechRecognitionLikeConstructor | null => (
  window.SpeechRecognition || window.webkitSpeechRecognition || null
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

import { FallbackRecognizer } from './fallbackRecognizer';

class SpeechScoringService {
  private fallbackRecognizer = new FallbackRecognizer();
  // FORCE TRUE FOR TESTING: Disable native API and force the use of 3rd party fallback
  public isNativeBroken = true;

  isSupported(): boolean {
    return true; // Force support to true so the flow continues
  }

  async recognizeOnce(options: RecognizeOnceOptions): Promise<RecognizeOnceResult> {
    // 强制走降级方案，用于测试 Vercel + Deepgram / AssemblyAI
    return this.recognizeWithFallback(options);
  }

  // 降级方案：使用 MediaRecorder 录制音频并发送到后端 API
  private async recognizeWithFallback(options: RecognizeOnceOptions): Promise<RecognizeOnceResult> {
    console.info('[Pronounce] Using Fallback API for speech recognition');
    try {
      await this.fallbackRecognizer.startRecording();
      
      // 等待指定的最大时间或者用户手动触发停止。这里做一个简单的倒计时：
      // 在实际游戏中，可以通过外部调用控制何时停止。
      const { transcript, durationMs } = await new Promise<{transcript: string, durationMs: number}>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.fallbackRecognizer.stopAndRecognize(options.maxDurationMs)
            .then(resolve)
            .catch(reject);
        }, Math.min(options.maxDurationMs, 3500)); // 降级模式下缩短录音时间，防止网络请求过慢，这里默认录3.5秒
      });

      return {
        transcript,
        confidence: transcript ? 0.9 : 0, // Fallback API 暂未返回置信度，给个默认高分
        reason: transcript ? 'ok' : 'no-speech',
        durationMs
      };
    } catch (error) {
      console.error('[Pronounce] Fallback API failed:', error);
      return {
        transcript: '',
        confidence: 0,
        reason: 'error',
        durationMs: 0
      };
    }
  }
}

export const speechScoringService = new SpeechScoringService();
