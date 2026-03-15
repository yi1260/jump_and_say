import type { PronunciationConfidenceLevel, PronunciationRoundResult } from '../types.ts';

export const TRY_AGAIN_MIN_TEXT_SIMILARITY = 0.3;
export const TRY_AGAIN_MIN_VOLUME_PEAK = 0.07;
export const EXCELLENT_MIN_TEXT_SIMILARITY = 0.72;
export const EXCELLENT_MIN_VOLUME_PEAK = 0.14;
export const EXCELLENT_MIN_QUALITY_SCORE = 0.72;
const QUALITY_TEXT_WEIGHT = 0.82;
const QUALITY_VOLUME_WEIGHT = 0.18;
const TRANSIENT_RECOGNITION_RETRY_LIMIT = 2;
const TRANSIENT_RECOGNITION_MIN_REMAINING_MS = 900;

export interface PronunciationAssessmentInput {
  rawConfidence: number;
  textSimilarity: number;
  volumePeak: number;
  volumeMonitorReady: boolean;
  volumeMonitorDetectedSignal: boolean;
}

export interface PronunciationAssessmentResult {
  confidence: number;
  confidenceLevel: PronunciationConfidenceLevel;
  usedTranscriptOnlyFallback: boolean;
}

export interface RecognitionRetryDecisionInput {
  reason: PronunciationRoundResult['reason'];
  transcript: string;
  retryCount: number;
  remainingMs: number;
}

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const getVolumeQuality = (volumePeak: number): number => {
  const normalizedVolumePeak = clampUnit(volumePeak);
  const normalized = (normalizedVolumePeak - TRY_AGAIN_MIN_VOLUME_PEAK) / (0.42 - TRY_AGAIN_MIN_VOLUME_PEAK);
  return clampUnit(normalized);
};

const shouldUseTranscriptOnlyFallback = (
  textSimilarity: number,
  volumePeak: number,
  volumeMonitorReady: boolean,
  volumeMonitorDetectedSignal: boolean
): boolean => {
  const strongTranscript = textSimilarity >= EXCELLENT_MIN_TEXT_SIMILARITY;
  if (!strongTranscript) return false;
  const hasReliableVolumeSignal = (
    volumePeak >= TRY_AGAIN_MIN_VOLUME_PEAK ||
    (volumeMonitorReady && volumeMonitorDetectedSignal)
  );
  return !hasReliableVolumeSignal;
};

export const assessPronunciationAttempt = (
  input: PronunciationAssessmentInput
): PronunciationAssessmentResult => {
  const textSimilarity = clampUnit(input.textSimilarity);
  const usedTranscriptOnlyFallback = shouldUseTranscriptOnlyFallback(
    textSimilarity,
    input.volumePeak,
    input.volumeMonitorReady,
    input.volumeMonitorDetectedSignal
  );
  const volumeQuality = usedTranscriptOnlyFallback ? 0 : getVolumeQuality(input.volumePeak);
  const qualityScore = usedTranscriptOnlyFallback
    ? textSimilarity
    : textSimilarity * QUALITY_TEXT_WEIGHT + volumeQuality * QUALITY_VOLUME_WEIGHT;
  const safeConfidence = clampUnit(input.rawConfidence);
  const confidence = safeConfidence > 0
    ? clampUnit(qualityScore * 0.9 + safeConfidence * 0.1)
    : clampUnit(qualityScore);

  if (textSimilarity < TRY_AGAIN_MIN_TEXT_SIMILARITY) {
    return {
      confidence,
      confidenceLevel: 'LOW',
      usedTranscriptOnlyFallback
    };
  }

  if (usedTranscriptOnlyFallback) {
    return {
      confidence,
      confidenceLevel: 'MEDIUM',
      usedTranscriptOnlyFallback
    };
  }

  if (input.volumePeak < TRY_AGAIN_MIN_VOLUME_PEAK) {
    return {
      confidence,
      confidenceLevel: 'LOW',
      usedTranscriptOnlyFallback
    };
  }

  if (
    textSimilarity >= EXCELLENT_MIN_TEXT_SIMILARITY &&
    input.volumePeak >= EXCELLENT_MIN_VOLUME_PEAK &&
    confidence >= EXCELLENT_MIN_QUALITY_SCORE
  ) {
    return {
      confidence,
      confidenceLevel: 'HIGH',
      usedTranscriptOnlyFallback
    };
  }

  return {
    confidence,
    confidenceLevel: 'MEDIUM',
    usedTranscriptOnlyFallback
  };
};

export const shouldRetryRecognitionAttempt = (
  input: RecognitionRetryDecisionInput
): boolean => {
  if (input.transcript.trim().length > 0) return false;
  if (input.reason !== 'error' && input.reason !== 'aborted') return false;
  if (input.retryCount >= TRANSIENT_RECOGNITION_RETRY_LIMIT) return false;
  return input.remainingMs >= TRANSIENT_RECOGNITION_MIN_REMAINING_MS;
};
