import { MotionState, PoseLandmark } from '../types';

const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
const CURRENT_LOG_LEVEL = (import.meta as { prod?: boolean }).prod ? LOG_LEVEL.WARN : LOG_LEVEL.INFO;

function log(level: number, tag: string, message: string, data?: unknown) {
  if (level < CURRENT_LOG_LEVEL) return;
  const prefix = `[${tag}]`;
  if (level === LOG_LEVEL.DEBUG) console.debug(prefix, message, data);
  else if (level === LOG_LEVEL.INFO) console.info(prefix, message, data);
  else if (level === LOG_LEVEL.WARN) console.warn(prefix, message, data);
  else console.error(prefix, message, data);
}

interface PoseResults {
  poseLandmarks?: PoseLandmark[];
}

interface PoseOptions {
  modelComplexity: 0 | 1 | 2;
  smoothLandmarks?: boolean;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
  selfieMode?: boolean;
}

interface PoseInitOptions {
  locateFile: (file: string) => string;
}

interface PoseLike {
  setOptions: (options: PoseOptions) => void;
  onResults: (callback: (results: PoseResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  initialize: () => Promise<void>;
  close?: () => void;
}

type PoseConstructor = new (options: PoseInitOptions) => PoseLike;

interface Point2D {
  x: number;
  y: number;
}

declare global {
  interface Window {
    Pose?: PoseConstructor;
    __MEDIAPIPE_POSE_CDN__?: string;
    __MEDIAPIPE_POSE_NEXT_BASE__?: () => string | null;
    __APP_DIAG__?: boolean;
  }
}

export class MotionController {
  private video: HTMLVideoElement | null = null;
  private pose: PoseLike | null = null;
  private isRunning: boolean = false;
  private requestRef: number | null = null;
  private lastResultTime: number = 0;
  private lastSendTime: number = 0;
  private readonly FRAME_MIN_TIME = 1000 / 35;
  private missedDetections: number = 0;
  private readonly MAX_MISSED_DETECTIONS = 12;

  private readonly REF_SHOULDER_WIDTH = 0.22;
  private readonly REF_TORSO_HEIGHT = 0.25;

  private xThreshold: number = 0.12;

  public state: MotionState = {
    x: 0,
    bodyX: 0.5,
    isJumping: false,
    rawNoseX: 0.5,
    rawNoseY: 0.5,
    rawFaceX: 0.5,
    rawFaceY: 0.5,
    rawFaceWidth: 0.18,
    rawFaceHeight: 0.24,
    rawShoulderY: 0.5,
    smoothedState: {
      x: 0,
      bodyX: 0.5,
      isJumping: false,
      rawNoseX: 0.5,
      rawNoseY: 0.5,
      rawFaceX: 0.5,
      rawFaceY: 0.5,
      rawFaceWidth: 0.18,
      rawFaceHeight: 0.24,
      rawShoulderY: 0.5
    }
  };

  public smoothedState: MotionState = {
    x: 0,
    bodyX: 0.5,
    isJumping: false,
    rawNoseX: 0.5,
    rawNoseY: 0.5,
    rawFaceX: 0.5,
    rawFaceY: 0.5,
    rawFaceWidth: 0.18,
    rawFaceHeight: 0.24,
    rawShoulderY: 0.5
  };

  public isReady: boolean = false;
  public isStarted: boolean = false;
  public onMotionDetected: ((type: 'jump' | 'move') => void) | null = null;
  public poseLandmarks: PoseLandmark[] | null = null;

  private initPromise: Promise<void> | null = null;

  private currentBodyX: number = 0.5;
  private neutralX: number = 0.5;
  private smoothedBodyY: number = 0.5;
  private smoothedHeadY: number = 0.5;
  private smoothedNoseX: number = 0.5;
  private smoothedNoseY: number = 0.5;
  private smoothedBoxCenterX: number = 0.5;
  private smoothedBoxCenterY: number = 0.5;
  private smoothedBoxWidth: number = 0.18;
  private smoothedBoxHeight: number = 0.24;
  private smoothedShoulderWidth: number = 0.22;
  private smoothedTorsoHeight: number = 0.25;
  private jumpCandidateFrames: number = 0;
  private jumpArmed: boolean = true;

  private lastJumpTime: number = 0;
  private readonly JUMP_COOLDOWN = 800;

  private async prewarmPoseAssets(base: string): Promise<void> {
    if (!('caches' in window)) return;

    const cacheName = base.startsWith('/') ? 'local-mediapipe-pose-cache' : 'mediapipe-cdn-cache-v2';
    const assets = [
      'pose.js',
      'pose_solution_packed_assets_loader.js',
      'pose_solution_packed_assets.data',
      'pose_solution_simd_wasm_bin.js',
      'pose_solution_simd_wasm_bin.wasm',
      'pose_solution_simd_wasm_bin.data',
      'pose_solution_wasm_bin.js',
      'pose_solution_wasm_bin.wasm',
      'pose_web.binarypb',
      'pose_landmark_lite.tflite'
    ];

    try {
      const cache = await caches.open(cacheName);
      await Promise.all(
        assets.map(async (file) => {
          const url = `${base}${file}`;
          try {
            const response = await fetch(url, { mode: 'cors', cache: 'reload' });
            if (response.ok || response.type === 'opaque') {
              await cache.put(url, response.clone());
            }
          } catch {
            try {
              const response = await fetch(url, { mode: 'no-cors', cache: 'reload' });
              if (response) {
                await cache.put(url, response.clone());
              }
            } catch {
              // Ignore prewarm errors; main init handles failures.
            }
          }
        })
      );
    } catch (error) {
      log(2, 'INIT', 'Pose cache prewarm failed', error);
    }
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    const params = new URLSearchParams(window.location.search);
    const diagEnabled =
      window.__APP_DIAG__ === true ||
      params.get('debug') === 'true' ||
      params.get('diag') === '1' ||
      params.get('diag') === 'true';
    const diagLog = (message: string, data?: unknown) => {
      if (!diagEnabled) return;
      if (typeof data === 'undefined') console.info('[DIAG][MediaPipe]', message);
      else console.info('[DIAG][MediaPipe]', message, data);
    };

    const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      let timeoutId: number | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(label)), ms);
      });
      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };

    const waitForPose = async (): Promise<void> => {
      const start = performance.now();
      let attempts = 0;
      while (!window.Pose && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      if (!window.Pose) {
        throw new Error('Pose library not found');
      }
      diagLog('Pose global ready', { ms: Math.round(performance.now() - start), attempts });
    };

    const createPose = async (baseOverride?: string): Promise<PoseLike> => {
      const base = baseOverride || window.__MEDIAPIPE_POSE_CDN__ || '/assets/mediapipe/pose/';
      if (!window.Pose) {
        throw new Error('Pose constructor missing');
      }
      const pose = new window.Pose({
        locateFile: (file: string) => {
          const fileName = file.split('/').pop() || file;
          return `${base}${fileName}`;
        }
      });

      pose.setOptions({
        modelComplexity: 0,
        smoothLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        selfieMode: false
      });

      pose.onResults(this.onResults.bind(this));

      if (diagEnabled && 'caches' in window && typeof caches.match === 'function') {
        const probeFiles = [
          'pose.js',
          'pose_solution_packed_assets_loader.js',
          'pose_solution_packed_assets.data',
          'pose_solution_simd_wasm_bin.js',
          'pose_solution_simd_wasm_bin.wasm',
          'pose_solution_simd_wasm_bin.data',
          'pose_solution_wasm_bin.js',
          'pose_solution_wasm_bin.wasm',
          'pose_web.binarypb',
          'pose_landmark_lite.tflite'
        ];
        const results = await Promise.all(
          probeFiles.map(async (fileName) => {
            const url = `${base}${fileName}`;
            try {
              const match = await caches.match(url);
              return { fileName, hit: !!match };
            } catch (error) {
              return { fileName, hit: false, error: String(error) };
            }
          })
        );
        diagLog('Cache probe', { base, results });
      }

      const initStart = performance.now();
      await withTimeout(pose.initialize(), 8000, 'Pose initialize timeout');
      diagLog('initialize done', { base, ms: Math.round(performance.now() - initStart) });

      return pose;
    };

    const getNextBase = (): string | null => {
      if (typeof window.__MEDIAPIPE_POSE_NEXT_BASE__ === 'function') {
        return window.__MEDIAPIPE_POSE_NEXT_BASE__();
      }
      return null;
    };

    this.initPromise = (async () => {
      log(1, 'INIT', 'Initializing Pose...');

      try {
        const totalStart = performance.now();
        await waitForPose();
        this.pose = await createPose();
        this.isReady = true;
        log(1, 'INIT', 'Pose Ready');
        const activeBase = window.__MEDIAPIPE_POSE_CDN__ || '/assets/mediapipe/pose/';
        diagLog('init success', { ms: Math.round(performance.now() - totalStart), base: activeBase });
        void this.prewarmPoseAssets(activeBase);
      } catch (e) {
        log(2, 'INIT', 'Primary Pose init failed, retrying with alternate CDN...', e);
        diagLog('init failed, retrying', { error: String(e) });

        let retryBase = getNextBase();
        let attempts = 0;
        let lastError: unknown = e;
        while (retryBase && attempts < 12) {
          try {
            const retryStart = performance.now();
            await waitForPose();
            this.pose = await createPose(retryBase);
            this.isReady = true;
            window.__MEDIAPIPE_POSE_CDN__ = retryBase;
            log(1, 'INIT', 'Pose Ready (retry)');
            diagLog('retry success', { ms: Math.round(performance.now() - retryStart), base: retryBase });
            void this.prewarmPoseAssets(retryBase);
            return;
          } catch (retryError) {
            lastError = retryError;
            attempts += 1;
            retryBase = getNextBase();
          }
        }

        this.pose = null;
        this.isReady = false;
        console.error('[MotionController] Init failed', lastError);
        diagLog('retry failed', { error: String(lastError) });
        throw lastError;
      }
    })();

    this.initPromise = this.initPromise.catch((error) => {
      this.initPromise = null;
      throw error;
    });

    return this.initPromise;
  }

  async start(videoElement: HTMLVideoElement) {
    if (this.isRunning) {
      this.video = videoElement;
      return;
    }
    log(1, 'START', 'Starting Motion Controller...');

    if (!this.pose) {
      await this.init();
      if (!this.pose) {
        throw new Error('Pose not initialized');
      }
    }

    this.video = videoElement;
    this.isRunning = true;
    this.isStarted = true;
    this.missedDetections = 0;
    this.lastResultTime = 0;
    this.lastSendTime = 0;

    this.currentBodyX = 0.5;
    this.neutralX = 0.5;
    this.smoothedBodyY = 0.5;
    this.smoothedHeadY = 0.5;
    this.smoothedNoseX = 0.5;
    this.smoothedNoseY = 0.5;
    this.smoothedBoxCenterX = 0.5;
    this.smoothedBoxCenterY = 0.5;
    this.smoothedBoxWidth = 0.18;
    this.smoothedBoxHeight = 0.24;
    this.smoothedShoulderWidth = 0.22;
    this.smoothedTorsoHeight = 0.25;
    this.jumpCandidateFrames = 0;
    this.jumpArmed = true;
    this.state.isJumping = false;
    this.state.bodyX = 0.5;
    this.state.rawNoseX = 0.5;
    this.state.rawNoseY = 0.5;
    this.state.rawFaceX = 0.5;
    this.state.rawFaceY = 0.5;
    this.state.rawFaceWidth = 0.18;
    this.state.rawFaceHeight = 0.24;
    this.state.rawShoulderY = 0.5;

    log(1, 'START', 'Loop starting');
    this.processFrame();
  }

  stop() {
    this.isRunning = false;
    this.isStarted = false;
    this.poseLandmarks = null;
    if (this.requestRef !== null) {
      cancelAnimationFrame(this.requestRef);
      this.requestRef = null;
    }
  }

  calibrate() {
    this.neutralX = this.currentBodyX;
    this.smoothedBodyY = this.smoothedBodyY * 0.7 + this.state.rawShoulderY * 0.3;
  }

  getCalibrationProgress() {
    return 1;
  }

  isCalibrating() {
    return false;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private toPoint(landmark?: PoseLandmark): Point2D | null {
    if (!landmark) return null;
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
    const visibility = typeof landmark.visibility === 'number' ? landmark.visibility : 1;
    const presence = typeof landmark.presence === 'number' ? landmark.presence : 1;
    if (visibility < 0.35 || presence < 0.35) return null;
    return { x: landmark.x, y: landmark.y };
  }

  private resolveCenter(a: Point2D | null, b: Point2D | null, fallback: Point2D): Point2D {
    if (a && b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (a) return a;
    if (b) return b;
    return fallback;
  }

  private onResults(results: PoseResults) {
    const now = performance.now();
    const landmarks = Array.isArray(results.poseLandmarks) ? results.poseLandmarks : null;
    if (!landmarks || landmarks.length === 0) {
      this.missedDetections += 1;
      this.jumpCandidateFrames = 0;
      this.poseLandmarks = null;
      this.lastResultTime = now;
      return;
    }

    this.missedDetections = 0;
    this.poseLandmarks = landmarks;

    const nose = this.toPoint(landmarks[0]);
    const leftShoulder = this.toPoint(landmarks[11]);
    const rightShoulder = this.toPoint(landmarks[12]);
    const leftHip = this.toPoint(landmarks[23]);
    const rightHip = this.toPoint(landmarks[24]);

    const fallbackCenter: Point2D = nose || { x: 0.5, y: 0.5 };
    const shoulderCenter = this.resolveCenter(leftShoulder, rightShoulder, fallbackCenter);
    const hipCenter = this.resolveCenter(leftHip, rightHip, shoulderCenter);
    const bodyCenter: Point2D = {
      x: (shoulderCenter.x + hipCenter.x) / 2,
      y: (shoulderCenter.y + hipCenter.y) / 2
    };

    const rawNoseX = nose?.x ?? shoulderCenter.x;
    const rawNoseY = nose?.y ?? shoulderCenter.y;

    const boxPoints = [nose, leftShoulder, rightShoulder, leftHip, rightHip].filter(
      (point): point is Point2D => !!point
    );
    let boxCenterX = fallbackCenter.x;
    let boxCenterY = fallbackCenter.y;
    let boxWidth = 0.18;
    let boxHeight = 0.24;
    if (boxPoints.length > 0) {
      let minX = boxPoints[0].x;
      let maxX = boxPoints[0].x;
      let minY = boxPoints[0].y;
      let maxY = boxPoints[0].y;
      boxPoints.forEach((point) => {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      });
      boxCenterX = (minX + maxX) / 2;
      boxCenterY = (minY + maxY) / 2;
      boxWidth = Math.max(0.08, maxX - minX);
      boxHeight = Math.max(0.1, maxY - minY);
    }

    const elapsed = now - this.lastResultTime;
    const dtSec = Math.max(0.016, elapsed > 0 && elapsed < 500 ? elapsed / 1000 : 0.033);
    const alpha = 1 - Math.exp(-dtSec / 0.08);

    const shoulderWidth = leftShoulder && rightShoulder ? Math.abs(leftShoulder.x - rightShoulder.x) : 0;
    const hipWidth = leftHip && rightHip ? Math.abs(leftHip.x - rightHip.x) : 0;
    const widthCandidate = shoulderWidth > 0 ? shoulderWidth : hipWidth;
    if (widthCandidate > 0) {
      this.smoothedShoulderWidth = this.smoothedShoulderWidth * 0.9 + widthCandidate * 0.1;
    }

    const torsoHeight = Math.abs(hipCenter.y - shoulderCenter.y);
    const torsoHeightCandidate = torsoHeight > 0.02 ? torsoHeight : this.smoothedTorsoHeight;
    const torsoHeightRatio = this.smoothedTorsoHeight > 0
      ? Math.abs(torsoHeightCandidate - this.smoothedTorsoHeight) / this.smoothedTorsoHeight
      : 0;
    this.smoothedTorsoHeight = this.smoothedTorsoHeight * 0.92 + torsoHeightCandidate * 0.08;

    const mirroredBodyX = 1 - bodyCenter.x;
    this.currentBodyX = this.currentBodyX * 0.55 + mirroredBodyX * 0.45;
    this.state.bodyX = this.currentBodyX;
    this.state.rawNoseX = rawNoseX;
    this.state.rawNoseY = rawNoseY;
    this.state.rawFaceX = boxCenterX;
    this.state.rawFaceY = boxCenterY;
    this.state.rawFaceWidth = boxWidth;
    this.state.rawFaceHeight = boxHeight;
    this.state.rawShoulderY = shoulderCenter.y;

    this.smoothedNoseX = this.smoothedNoseX * (1 - alpha) + rawNoseX * alpha;
    this.smoothedNoseY = this.smoothedNoseY * (1 - alpha) + rawNoseY * alpha;
    this.smoothedBoxCenterX = this.smoothedBoxCenterX * (1 - alpha) + boxCenterX * alpha;
    this.smoothedBoxCenterY = this.smoothedBoxCenterY * (1 - alpha) + boxCenterY * alpha;
    this.smoothedBoxWidth = this.smoothedBoxWidth * (1 - alpha) + boxWidth * alpha;
    this.smoothedBoxHeight = this.smoothedBoxHeight * (1 - alpha) + boxHeight * alpha;

    const scaleFactor = this.clamp(this.smoothedShoulderWidth / this.REF_SHOULDER_WIDTH, 0.35, 1.6);
    const dynamicXThreshold = this.clamp(this.xThreshold * scaleFactor, 0.05, 0.22);
    const offsetX = this.currentBodyX - this.neutralX;

    let targetLane = 0;
    if (offsetX < -dynamicXThreshold) {
      targetLane = -1;
    } else if (offsetX > dynamicXThreshold) {
      targetLane = 1;
    } else {
      targetLane = 0;
    }

    if (Math.abs(offsetX) < dynamicXThreshold * 0.6) {
      this.neutralX = this.neutralX * 0.98 + this.currentBodyX * 0.02;
    }

    if (this.state.x !== targetLane) {
      this.onMotionDetected?.('move');
    }
    this.state.x = targetLane;

    const bodyDy = this.smoothedBodyY - bodyCenter.y;
    const headDy = this.smoothedHeadY - rawNoseY;
    const velocity = bodyDy / dtSec;

    this.smoothedBodyY = this.smoothedBodyY * 0.9 + bodyCenter.y * 0.1;
    this.smoothedHeadY = this.smoothedHeadY * 0.9 + rawNoseY * 0.1;

    const torsoScale = this.clamp(this.smoothedTorsoHeight / this.REF_TORSO_HEIGHT, 0.35, 1.6);
    const velocityThreshold = 1.4 * torsoScale;
    const displacementThreshold = 0.045 * torsoScale;
    const headDisplacementThreshold = 0.03 * torsoScale;

    if (torsoHeightRatio < 0.25) {
      if (!this.jumpArmed && bodyDy < -0.015 * torsoScale) {
        this.jumpArmed = true;
      }

      const isCandidate = velocity > velocityThreshold && bodyDy > displacementThreshold && headDy > headDisplacementThreshold;
      this.jumpCandidateFrames = isCandidate
        ? Math.min(4, this.jumpCandidateFrames + 1)
        : Math.max(0, this.jumpCandidateFrames - 1);

      if (
        this.jumpArmed &&
        this.jumpCandidateFrames >= 2 &&
        !this.state.isJumping &&
        now - this.lastJumpTime > this.JUMP_COOLDOWN
      ) {
        log(1, 'JUMP', `Jump! Vel: ${velocity.toFixed(2)}, Dy: ${bodyDy.toFixed(3)}`);
        this.state.isJumping = true;
        this.lastJumpTime = now;
        this.jumpCandidateFrames = 0;
        this.jumpArmed = false;
        this.onMotionDetected?.('jump');
        setTimeout(() => {
          this.state.isJumping = false;
        }, 450);
      }
    } else {
      this.jumpCandidateFrames = 0;
    }

    if (!this.state.smoothedState) {
      this.state.smoothedState = { ...this.state };
    }

    this.state.smoothedState.bodyX = this.state.bodyX;
    this.state.smoothedState.rawNoseX = this.smoothedNoseX;
    this.state.smoothedState.rawNoseY = this.smoothedNoseY;
    this.state.smoothedState.rawFaceX = this.smoothedBoxCenterX;
    this.state.smoothedState.rawFaceY = this.smoothedBoxCenterY;
    this.state.smoothedState.rawFaceWidth = this.smoothedBoxWidth;
    this.state.smoothedState.rawFaceHeight = this.smoothedBoxHeight;
    this.state.smoothedState.rawShoulderY = this.state.rawShoulderY;
    this.state.smoothedState.x = this.state.x;
    this.state.smoothedState.isJumping = this.state.isJumping;

    this.smoothedState = this.state.smoothedState;
    this.lastResultTime = now;
  }

  private async processFrame() {
    if (!this.isRunning || !this.video || !this.pose) return;

    const now = performance.now();
    if (now - this.lastSendTime < this.FRAME_MIN_TIME) {
      this.requestRef = requestAnimationFrame(() => this.processFrame());
      return;
    }
    this.lastSendTime = now;

    try {
      if (this.video.videoWidth > 0 && !this.video.paused) {
        await this.pose.send({ image: this.video });
      }
    } catch (e) {
      console.warn('Pose send error', e);
    }

    if (this.isRunning) {
      this.requestRef = requestAnimationFrame(() => this.processFrame());
    }
  }
}

export const motionController = new MotionController();
