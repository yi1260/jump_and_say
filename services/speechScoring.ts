type SpeechRecognitionResultReason =
  | 'ok'
  | 'unsupported'
  | 'timeout'
  | 'no-speech'
  | 'aborted'
  | 'error';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLikeEventMap {
  result: SpeechRecognitionEventLike;
  error: SpeechRecognitionErrorEventLike;
  end: Event;
  nomatch: Event;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
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
  reason: SpeechRecognitionResultReason;
  durationMs: number;
}

const getSpeechRecognitionCtor = (): SpeechRecognitionLikeConstructor | null => (
  window.SpeechRecognition || window.webkitSpeechRecognition || null
);

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
  return 'error';
};

class SpeechScoringService {
  isSupported(): boolean {
    return Boolean(getSpeechRecognitionCtor());
  }

  async recognizeOnce(options: RecognizeOnceOptions): Promise<RecognizeOnceResult> {
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      return {
        transcript: '',
        reason: 'unsupported',
        durationMs: 0
      };
    }

    const startedAt = performance.now();

    return new Promise<RecognizeOnceResult>((resolve) => {
      const recognition = new RecognitionCtor();
      recognition.lang = options.lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      let transcript = '';
      let finalized = false;
      let forcedTimeout = false;
      let mappedErrorReason: SpeechRecognitionResultReason | null = null;
      let timeoutId: number | null = null;

      const clearTimeoutIfNeeded = (): void => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const finalize = (reason: SpeechRecognitionResultReason): void => {
        if (finalized) return;
        finalized = true;
        clearTimeoutIfNeeded();
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        resolve({
          transcript: transcript.trim(),
          reason,
          durationMs
        });
      };

      recognition.onresult = (event: SpeechRecognitionEventLike): void => {
        const chunks: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const alt = event.results[i][0];
          if (!alt || typeof alt.transcript !== 'string') continue;
          chunks.push(alt.transcript);
        }
        if (chunks.length > 0) {
          transcript = chunks.join(' ').trim();
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike): void => {
        mappedErrorReason = mapRecognitionError(event.error);
      };

      recognition.onnomatch = (): void => {
        mappedErrorReason = 'no-speech';
      };

      recognition.onend = (): void => {
        if (transcript.trim().length > 0) {
          finalize('ok');
          return;
        }
        if (forcedTimeout) {
          finalize('timeout');
          return;
        }
        finalize(mappedErrorReason || 'no-speech');
      };

      timeoutId = window.setTimeout(() => {
        forcedTimeout = true;
        try {
          recognition.stop();
        } catch (error) {
          console.warn('[Pronounce] SpeechRecognition stop failed on timeout:', error);
          finalize('timeout');
        }
      }, Math.max(1500, options.maxDurationMs));

      try {
        recognition.start();
      } catch (error) {
        console.warn('[Pronounce] SpeechRecognition start failed:', error);
        finalize('error');
      }
    });
  }
}

export const speechScoringService = new SpeechScoringService();
