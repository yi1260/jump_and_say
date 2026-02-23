import { JumpReadinessState, MotionState, PoseLandmark } from '../types';

const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
const CURRENT_LOG_LEVEL = (import.meta as { prod?: boolean }).prod ? LOG_LEVEL.WARN : LOG_LEVEL.INFO;
const DEFAULT_POSE_CDN_BASE = 'https://fastly.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/';

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

interface InitOptions {
  signal?: AbortSignal;
}

interface StartOptions {
  signal?: AbortSignal;
}

type PoseConstructor = new (options: PoseInitOptions) => PoseLike;

interface Point2D {
  x: number;
  y: number;
}

type JumpReadinessIssue =
  | 'no_pose'
  | 'upper_body_missing'
  | 'too_far'
  | 'too_close'
  | 'off_center'
  | 'head_out_of_frame'
  | 'too_unstable';

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
  private readonly JUMP_READY_REQUIREMENTS = '请露出头部到髋部、站在画面中间，距离镜头约0.6~1.2米';
  private readonly JUMP_READY_STABLE_MS = 700;
  private readonly JUMP_READY_HOLD_MS = 700;
  private readonly JUMP_MIN_UPPER_BODY_HEIGHT = 0.1;
  private readonly JUMP_MAX_UPPER_BODY_HEIGHT = 0.95;
  private readonly JUMP_MAX_CENTER_OFFSET = 0.28;
  private readonly JUMP_MIN_NOSE_Y = 0.04;
  private readonly JUMP_MAX_NOSE_Y = 0.6;

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
  private filteredPoseLandmarks: PoseLandmark[] | null = null;
  public jumpReadiness: JumpReadinessState = {
    status: 'no_pose',
    isReady: false,
    message: '请站到镜头前并露出头部到髋部',
    requirements: this.JUMP_READY_REQUIREMENTS,
    stableProgress: 0
  };

  public isActuallyRunning(): boolean {
    return this.isRunning && this.requestRef !== null;
  }

  private initPromise: Promise<void> | null = null;

  private currentBodyX: number = 0.5;
  private neutralX: number = 0.5;
  private smoothedBodyY: number = 0.5;
  private smoothedHeadY: number = 0.5;
  private smoothedShoulderY: number = 0.5;
  private smoothedHipY: number = 0.62;
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
  private lastPoseLandmarksAt: number = 0;
  private jumpReadyStableStartAt: number | null = null;
  private jumpNoiseVelocity: number = 1;
  private jumpNoiseBodyDy: number = 0.03;
  private jumpNoiseHeadDy: number = 0.025;
  private jumpNoiseShoulderDy: number = 0.025;
  private jumpNoiseHipDy: number = 0.025;
  private jumpNoiseShoulderVelocity: number = 0.9;
  private jumpNoiseHorizontalVelocity: number = 0.35;
  private jumpNoiseLift: number = 0.02;
  private jumpNoiseVerticalDisagreement: number = 0.09;
  private jumpLiftSignalPrev: number = 0;
  private jumpLateralCoupling: number = 0.035;
  private jumpIntentScore: number = 0;
  private lastJumpReadyAt: number = 0;
  private jumpBaselineBodyY: number = 0.5;
  private jumpBaselineHeadY: number = 0.5;
  private jumpBaselineShoulderY: number = 0.5;
  private jumpBaselineHipY: number = 0.62;
  private jumpBaselineShoulderWidth: number = 0.22;
  private jumpBaselineTorsoHeight: number = 0.25;
  private jumpCalibrationFrames: number = 0;
  private jumpHasCalibration: boolean = false;
  private smoothedUpperBodyHeight: number = 0.24;
  private jumpQuietFrames: number = 0;
  private jumpStableFrames: number = 0;
  private jumpReliabilityScore: number = 1;
  private missingHipFrames: number = 0;
  private lastReliablePoseAt: number = 0;
  private jumpSuppressUntil: number = 0;

  private lastJumpTime: number = 0;
  private readonly JUMP_COOLDOWN = 500;

  private async prewarmPoseAssets(base: string): Promise<void> {
    if (!('caches' in window)) return;

    const cacheName = 'mediapipe-cdn-cache-v2';
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

  async init(options: InitOptions = {}) {
    const { signal } = options;
    if (this.initPromise) {
      return this.withAbort(this.initPromise, signal, 'POSE_INIT_ABORTED');
    }

    const POSE_INIT_TOTAL_TIMEOUT_MS = 2 * 60 * 1000;
    const navWithConnection = navigator as Navigator & {
      connection?: {
        effectiveType?: string;
        saveData?: boolean;
      };
    };
    const effectiveType = navWithConnection.connection?.effectiveType;
    const isConstrainedNetwork =
      navWithConnection.connection?.saveData === true ||
      effectiveType === 'slow-2g' ||
      effectiveType === '2g' ||
      effectiveType === '3g';
    const POSE_INIT_ATTEMPT_TIMEOUT_MS = isConstrainedNetwork ? 25000 : 15000;
    const POSE_INIT_RETRY_DELAY_MS = 800;
    const POSE_WAIT_GLOBAL_TIMEOUT_MS = isConstrainedNetwork ? 12000 : 6000;
    const DEFAULT_POSE_BASE = window.__MEDIAPIPE_POSE_CDN__ || DEFAULT_POSE_CDN_BASE;

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
      let abortCleanup: (() => void) | null = null;
      const abortPromise = new Promise<never>((_, reject) => {
        if (!signal) return;
        const onAbort = () => {
          reject(new Error('POSE_INIT_ABORTED'));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        abortCleanup = () => {
          signal.removeEventListener('abort', onAbort);
        };
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(label)), ms);
      });
      try {
        return await Promise.race([promise, timeoutPromise, abortPromise]);
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        if (abortCleanup) {
          abortCleanup();
        }
      }
    };

    const sleep = (ms: number): Promise<void> => this.sleepWithAbort(ms, signal, 'POSE_INIT_ABORTED');

    const waitForPose = async (maxWaitMs: number): Promise<void> => {
      const start = performance.now();
      let attempts = 0;
      while (!window.Pose) {
        if (signal?.aborted) {
          throw new Error('POSE_INIT_ABORTED');
        }
        if (performance.now() - start >= maxWaitMs) {
          throw new Error('Pose library not found');
        }
        await sleep(100);
        attempts++;
      }
      diagLog('Pose global ready', { ms: Math.round(performance.now() - start), attempts });
    };

    const createPose = async (baseOverride?: string): Promise<PoseLike> => {
      const base = baseOverride || window.__MEDIAPIPE_POSE_CDN__ || DEFAULT_POSE_CDN_BASE;
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
        smoothLandmarks: true,
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

      try {
        const initStart = performance.now();
        await withTimeout(pose.initialize(), POSE_INIT_ATTEMPT_TIMEOUT_MS, 'Pose initialize timeout');
        diagLog('initialize done', { base, ms: Math.round(performance.now() - initStart) });
        return pose;
      } catch (error) {
        if (typeof pose.close === 'function') {
          try {
            pose.close();
          } catch (closeError) {
            log(2, 'INIT', 'Pose close failed after init error', closeError);
          }
        }
        throw error;
      }
    };

    const getNextBase = (): string | null => {
      if (typeof window.__MEDIAPIPE_POSE_NEXT_BASE__ === 'function') {
        return window.__MEDIAPIPE_POSE_NEXT_BASE__();
      }
      return null;
    };

    this.initPromise = (async () => {
      log(1, 'INIT', 'Initializing Pose...');

      const totalStart = performance.now();
      const deadline = totalStart + POSE_INIT_TOTAL_TIMEOUT_MS;
      let attempts = 0;
      let lastError: unknown = null;

      while (performance.now() < deadline) {
        if (signal?.aborted) {
          throw new Error('POSE_INIT_ABORTED');
        }
        const base = attempts === 0 ? DEFAULT_POSE_BASE : (getNextBase() || DEFAULT_POSE_BASE);
        const remainingBeforeAttempt = Math.max(0, deadline - performance.now());
        const poseWaitBudgetMs = Math.max(1000, Math.min(POSE_WAIT_GLOBAL_TIMEOUT_MS, remainingBeforeAttempt));

        try {
          await waitForPose(poseWaitBudgetMs);
          this.pose = await createPose(base);
          this.isReady = true;
          window.__MEDIAPIPE_POSE_CDN__ = base;

          if (attempts === 0) {
            log(1, 'INIT', 'Pose Ready');
          } else {
            log(1, 'INIT', `Pose Ready (retry #${attempts})`);
          }
          diagLog('init success', {
            attempts,
            ms: Math.round(performance.now() - totalStart),
            base
          });
          void this.prewarmPoseAssets(base);
          return;
        } catch (error) {
          if (signal?.aborted) {
            this.pose = null;
            this.isReady = false;
            throw new Error('POSE_INIT_ABORTED');
          }
          lastError = error;
          attempts += 1;
          const remainingMs = Math.max(0, deadline - performance.now());
          log(2, 'INIT', `Pose init attempt #${attempts} failed, retrying...`, error);
          diagLog('init attempt failed', {
            attempts,
            base,
            remainingMs: Math.round(remainingMs),
            error: String(error)
          });
          if (remainingMs <= 0) {
            break;
          }
          await sleep(Math.min(POSE_INIT_RETRY_DELAY_MS, remainingMs));
        }
      }

      this.pose = null;
      this.isReady = false;
      if (signal?.aborted) {
        throw new Error('POSE_INIT_ABORTED');
      }
      const timeoutMessage = `Pose initialize timeout after ${Math.round(POSE_INIT_TOTAL_TIMEOUT_MS / 1000)}s`;
      console.error('[MotionController] Init failed after timeout', { attempts, lastError });
      diagLog('retry failed after timeout', { attempts, error: String(lastError) });
      if (lastError instanceof Error && lastError.message) {
        throw new Error(`${timeoutMessage}: ${lastError.message}`);
      }
      throw new Error(timeoutMessage);
    })();

    this.initPromise = this.initPromise.catch((error) => {
      this.initPromise = null;
      throw error;
    });

    return this.withAbort(this.initPromise, signal, 'POSE_INIT_ABORTED');
  }

  async start(videoElement: HTMLVideoElement, options: StartOptions = {}) {
    const { signal } = options;
    if (signal?.aborted) {
      throw new Error('POSE_START_ABORTED');
    }
    if (this.isRunning) {
      this.video = videoElement;
      return;
    }
    log(1, 'START', 'Starting Motion Controller...');

    if (!this.pose) {
      await this.init({ signal });
      if (!this.pose) {
        throw new Error('Pose not initialized');
      }
    }
    if (signal?.aborted) {
      throw new Error('POSE_START_ABORTED');
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
    this.smoothedShoulderY = 0.5;
    this.smoothedHipY = 0.62;
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
    this.jumpReadyStableStartAt = null;
    this.jumpNoiseVelocity = 1;
    this.jumpNoiseBodyDy = 0.03;
    this.jumpNoiseHeadDy = 0.025;
    this.jumpNoiseShoulderDy = 0.025;
    this.jumpNoiseHipDy = 0.025;
    this.jumpNoiseShoulderVelocity = 0.9;
    this.jumpNoiseHorizontalVelocity = 0.35;
    this.jumpNoiseLift = 0.02;
    this.jumpNoiseVerticalDisagreement = 0.09;
    this.jumpLiftSignalPrev = 0;
    this.jumpLateralCoupling = 0.035;
    this.jumpIntentScore = 0;
    this.lastJumpReadyAt = 0;
    this.jumpBaselineBodyY = 0.5;
    this.jumpBaselineHeadY = 0.5;
    this.jumpBaselineShoulderY = 0.5;
    this.jumpBaselineHipY = 0.62;
    this.jumpBaselineShoulderWidth = 0.22;
    this.jumpBaselineTorsoHeight = 0.25;
    this.jumpCalibrationFrames = 0;
    this.jumpHasCalibration = false;
    this.smoothedUpperBodyHeight = 0.24;
    this.jumpQuietFrames = 0;
    this.jumpStableFrames = 0;
    this.jumpReliabilityScore = 1;
    this.missingHipFrames = 0;
    this.lastReliablePoseAt = 0;
    this.jumpSuppressUntil = 0;
    this.state.isJumping = false;
    this.state.bodyX = 0.5;
    this.state.rawNoseX = 0.5;
    this.state.rawNoseY = 0.5;
    this.state.rawFaceX = 0.5;
    this.state.rawFaceY = 0.5;
    this.state.rawFaceWidth = 0.18;
    this.state.rawFaceHeight = 0.24;
    this.state.rawShoulderY = 0.5;
    this.poseLandmarks = null;
    this.filteredPoseLandmarks = null;
    this.lastPoseLandmarksAt = 0;
    this.resetJumpReadiness();

    log(1, 'START', 'Loop starting');
    this.processFrame();
  }

  stop() {
    this.isRunning = false;
    this.isStarted = false;
    this.poseLandmarks = null;
    this.filteredPoseLandmarks = null;
    this.lastPoseLandmarksAt = 0;
    this.jumpCandidateFrames = 0;
    this.jumpArmed = true;
    this.lastJumpReadyAt = 0;
    this.jumpBaselineBodyY = 0.5;
    this.jumpBaselineHeadY = 0.5;
    this.jumpBaselineShoulderY = 0.5;
    this.jumpBaselineHipY = 0.62;
    this.jumpBaselineShoulderWidth = 0.22;
    this.jumpBaselineTorsoHeight = 0.25;
    this.jumpCalibrationFrames = 0;
    this.jumpHasCalibration = false;
    this.jumpNoiseShoulderVelocity = 0.9;
    this.jumpNoiseHorizontalVelocity = 0.35;
    this.jumpNoiseLift = 0.02;
    this.jumpNoiseVerticalDisagreement = 0.09;
    this.jumpLiftSignalPrev = 0;
    this.jumpLateralCoupling = 0.035;
    this.jumpIntentScore = 0;
    this.jumpQuietFrames = 0;
    this.jumpStableFrames = 0;
    this.jumpReliabilityScore = 1;
    this.missingHipFrames = 0;
    this.smoothedUpperBodyHeight = 0.24;
    this.lastReliablePoseAt = 0;
    this.jumpSuppressUntil = 0;
    this.resetJumpReadiness();
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

  private setJumpReadiness(next: JumpReadinessState): void {
    this.jumpReadiness = next;
  }

  private getJumpReadinessMessage(issues: JumpReadinessIssue[]): string {
    if (issues.includes('no_pose')) return '请站到镜头前并露出头部到髋部';
    if (issues.includes('upper_body_missing')) return '请露出头部、肩膀和髋部（可把设备稍放低）';
    if (issues.includes('too_far')) return '离镜头太远，请前进半步（建议约0.6~1.2米）';
    if (issues.includes('too_close')) return '离镜头太近，请后退半步（建议约0.6~1.2米）';
    if (issues.includes('off_center')) return '请站到画面中间';
    if (issues.includes('head_out_of_frame')) return '请让头部完整出现在画面内';
    if (issues.includes('too_unstable')) return '请先站稳，再开始跳';
    return '请按提示调整站位';
  }

  private resetJumpReadiness(message = '请站到镜头前并露出头部到髋部'): void {
    this.jumpReadyStableStartAt = null;
    this.setJumpReadiness({
      status: 'no_pose',
      isReady: false,
      message,
      requirements: this.JUMP_READY_REQUIREMENTS,
      stableProgress: 0
    });
  }

  private updateJumpReadiness(
    now: number,
    issues: JumpReadinessIssue[],
    isStableForCalibration: boolean,
    bodyCenterY: number,
    shoulderCenterY: number,
    hipCenterY: number,
    rawNoseY: number,
    shoulderWidth: number,
    torsoHeight: number,
    normalizedVelocityAbs: number,
    normalizedBodyDyAbs: number,
    normalizedHeadDyAbs: number,
    normalizedShoulderDyAbs: number,
    normalizedHipDyAbs: number
  ): void {
    const hadReady = this.jumpReadiness.isReady;
    if (issues.length > 0) {
      const hasPositionIssue = issues.some((issue) =>
        issue === 'upper_body_missing' ||
        issue === 'too_far' ||
        issue === 'too_close' ||
        issue === 'off_center' ||
        issue === 'head_out_of_frame'
      );
      const shouldHoldReady =
        hadReady &&
        now - this.lastJumpReadyAt <= this.JUMP_READY_HOLD_MS &&
        !issues.includes('no_pose') &&
        !hasPositionIssue;
      if (shouldHoldReady) {
        this.setJumpReadiness({
          status: 'ready',
          isReady: true,
          message: '跳跃检测已就绪',
          requirements: this.JUMP_READY_REQUIREMENTS,
          stableProgress: 1
        });
        return;
      }
      this.jumpReadyStableStartAt = null;
      this.setJumpReadiness({
        status: issues.includes('no_pose') ? 'no_pose' : 'adjusting',
        isReady: false,
        message: this.getJumpReadinessMessage(issues),
        requirements: this.JUMP_READY_REQUIREMENTS,
        stableProgress: 0
      });
      return;
    }

    if (!isStableForCalibration) {
      this.jumpReadyStableStartAt = null;
      this.setJumpReadiness({
        status: 'adjusting',
        isReady: false,
        message: this.getJumpReadinessMessage(['too_unstable']),
        requirements: this.JUMP_READY_REQUIREMENTS,
        stableProgress: 0
      });
      return;
    }

    if (this.jumpReadyStableStartAt === null) {
      this.jumpReadyStableStartAt = now;
    }

    const stableProgress = this.clamp((now - this.jumpReadyStableStartAt) / this.JUMP_READY_STABLE_MS, 0, 1);
    const isReady = stableProgress >= 1;
    if (isReady) {
      this.lastJumpReadyAt = now;
    }

    this.setJumpReadiness({
      status: isReady ? 'ready' : 'stabilizing',
      isReady,
      message: isReady ? '跳跃检测已就绪' : `保持站稳 ${Math.max(1, Math.ceil((1 - stableProgress) * 2))} 秒`,
      requirements: this.JUMP_READY_REQUIREMENTS,
      stableProgress
    });

    if (!hadReady && isReady) {
      this.neutralX = this.currentBodyX;
      this.smoothedBodyY = bodyCenterY;
      this.smoothedShoulderY = shoulderCenterY;
      this.smoothedHipY = hipCenterY;
      this.smoothedHeadY = rawNoseY;
      this.jumpBaselineBodyY = bodyCenterY;
      this.jumpBaselineHeadY = rawNoseY;
      this.jumpBaselineShoulderY = shoulderCenterY;
      this.jumpBaselineHipY = hipCenterY;
      this.jumpBaselineShoulderWidth = Math.max(shoulderWidth, this.jumpBaselineShoulderWidth);
      this.jumpBaselineTorsoHeight = Math.max(torsoHeight, this.jumpBaselineTorsoHeight);
      this.jumpCandidateFrames = 0;
      this.jumpArmed = true;
      this.jumpNoiseVelocity = this.clamp(Math.max(0.7, normalizedVelocityAbs), 0.7, 2.2);
      this.jumpNoiseBodyDy = this.clamp(Math.max(0.02, normalizedBodyDyAbs), 0.02, 0.09);
      this.jumpNoiseHeadDy = this.clamp(Math.max(0.02, normalizedHeadDyAbs), 0.02, 0.09);
      this.jumpNoiseShoulderDy = this.clamp(Math.max(0.018, normalizedShoulderDyAbs), 0.018, 0.1);
      this.jumpNoiseHipDy = this.clamp(Math.max(0.018, normalizedHipDyAbs), 0.018, 0.1);
      this.jumpNoiseShoulderVelocity = this.clamp(Math.max(0.7, normalizedVelocityAbs), 0.7, 2.6);
      this.jumpNoiseLift = 0.02;
      this.jumpNoiseVerticalDisagreement = 0.09;
      this.jumpLiftSignalPrev = 0;
      this.jumpIntentScore = 0;
      this.jumpCalibrationFrames = 1;
      this.jumpHasCalibration = true;
    } else if (isReady && isStableForCalibration) {
      const calibrationAlpha = 0.08;
      this.jumpBaselineBodyY = this.jumpBaselineBodyY * (1 - calibrationAlpha) + bodyCenterY * calibrationAlpha;
      this.jumpBaselineShoulderY = this.jumpBaselineShoulderY * (1 - calibrationAlpha) + shoulderCenterY * calibrationAlpha;
      this.jumpBaselineHipY = this.jumpBaselineHipY * (1 - calibrationAlpha) + hipCenterY * calibrationAlpha;
      this.jumpBaselineHeadY = this.jumpBaselineHeadY * (1 - calibrationAlpha) + rawNoseY * calibrationAlpha;
      this.jumpBaselineShoulderWidth = this.jumpBaselineShoulderWidth * (1 - calibrationAlpha) + shoulderWidth * calibrationAlpha;
      this.jumpBaselineTorsoHeight = this.jumpBaselineTorsoHeight * (1 - calibrationAlpha) + torsoHeight * calibrationAlpha;
      this.jumpCalibrationFrames = Math.min(80, this.jumpCalibrationFrames + 1);
      this.jumpHasCalibration = this.jumpCalibrationFrames >= 3;
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private stabilizePoseLandmarks(landmarks: PoseLandmark[], now: number): PoseLandmark[] {
    if (!this.filteredPoseLandmarks || this.filteredPoseLandmarks.length !== landmarks.length) {
      this.filteredPoseLandmarks = landmarks.map((landmark) => ({ ...landmark }));
      return this.filteredPoseLandmarks;
    }

    const elapsed = now - this.lastPoseLandmarksAt;
    const dtSec = Math.max(0.016, elapsed > 0 && elapsed < 500 ? elapsed / 1000 : 0.033);
    const baseAlpha = this.clamp(1 - Math.exp(-dtSec / 0.085), 0.16, 0.58);
    const previous = this.filteredPoseLandmarks;

    const stabilized = landmarks.map((landmark, index) => {
      const prev = previous[index] || landmark;
      const hasFiniteRaw =
        Number.isFinite(landmark.x) &&
        Number.isFinite(landmark.y) &&
        Number.isFinite(prev.x) &&
        Number.isFinite(prev.y);
      if (!hasFiniteRaw) {
        return {
          ...prev,
          visibility: landmark.visibility,
          presence: landmark.presence
        };
      }

      const confidence = this.getLandmarkConfidence(landmark);
      const dx = landmark.x - prev.x;
      const dy = landmark.y - prev.y;
      const motion = Math.abs(dx) + Math.abs(dy);

      let alpha = baseAlpha * (0.38 + confidence * 0.95);
      if (motion > 0.22 && confidence < 0.45) {
        alpha *= 0.35;
      } else if (motion > 0.08 && confidence > 0.6) {
        alpha *= 1.18;
      }
      alpha = this.clamp(alpha, 0.08, 0.82);

      const nextX = prev.x + dx * alpha;
      const nextY = prev.y + dy * alpha;
      const rawZ = typeof landmark.z === 'number' ? landmark.z : prev.z;
      const prevZ = typeof prev.z === 'number' ? prev.z : rawZ;
      const hasFiniteZ = Number.isFinite(rawZ) && Number.isFinite(prevZ);
      const nextZ = hasFiniteZ ? (prevZ as number) + ((rawZ as number) - (prevZ as number)) * alpha : rawZ;

      return {
        x: nextX,
        y: nextY,
        z: nextZ,
        visibility: landmark.visibility,
        presence: landmark.presence
      };
    });

    this.filteredPoseLandmarks = stabilized;
    return stabilized;
  }

  private toPoint(landmark?: PoseLandmark, minConfidence: number = 0.35): Point2D | null {
    if (!landmark) return null;
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
    const visibility = typeof landmark.visibility === 'number' ? landmark.visibility : 1;
    const presence = typeof landmark.presence === 'number' ? landmark.presence : 1;
    if (visibility < minConfidence || presence < minConfidence) return null;
    return { x: landmark.x, y: landmark.y };
  }

  private getLandmarkConfidence(landmark?: PoseLandmark): number {
    if (!landmark) return 0;
    const visibility = typeof landmark.visibility === 'number' ? landmark.visibility : 1;
    const presence = typeof landmark.presence === 'number' ? landmark.presence : 1;
    if (!Number.isFinite(visibility) || !Number.isFinite(presence)) return 0;
    return Math.min(visibility, presence);
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
    const rawLandmarks = Array.isArray(results.poseLandmarks) ? results.poseLandmarks : null;
    if (!rawLandmarks || rawLandmarks.length === 0) {
      this.missedDetections += 1;
      this.jumpCandidateFrames = 0;
      this.jumpIntentScore = 0;
      this.jumpStableFrames = 0;
      this.poseLandmarks = null;
      this.filteredPoseLandmarks = null;
      this.lastPoseLandmarksAt = 0;
      this.resetJumpReadiness('请站到镜头前并露出头部到髋部');
      this.lastResultTime = now;
      return;
    }

    const landmarks = this.stabilizePoseLandmarks(rawLandmarks, now);
    this.missedDetections = 0;
    this.poseLandmarks = landmarks;
    this.lastPoseLandmarksAt = now;

    const nose = this.toPoint(landmarks[0], 0.3);
    const leftShoulder = this.toPoint(landmarks[11], 0.33);
    const rightShoulder = this.toPoint(landmarks[12], 0.33);
    const leftHip = this.toPoint(landmarks[23], 0.22);
    const rightHip = this.toPoint(landmarks[24], 0.22);

    const fallbackCenter: Point2D = nose || { x: 0.5, y: 0.5 };
    const shoulderCenter = this.resolveCenter(leftShoulder, rightShoulder, fallbackCenter);
    const hipCenter = this.resolveCenter(leftHip, rightHip, shoulderCenter);
    const bodyCenter: Point2D = {
      x: (shoulderCenter.x + hipCenter.x) / 2,
      y: (shoulderCenter.y + hipCenter.y) / 2
    };

    const rawNoseX = nose?.x ?? this.smoothedNoseX;
    const rawNoseY = nose?.y ?? this.smoothedNoseY;

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
    this.smoothedTorsoHeight = this.smoothedTorsoHeight * 0.92 + torsoHeightCandidate * 0.08;

    const prevBodyX = this.currentBodyX;
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

    const laneChanged = this.state.x !== targetLane;
    if (laneChanged) {
      this.onMotionDetected?.('move');
    }
    this.state.x = targetLane;
    const horizontalVelocityNorm =
      Math.abs(this.currentBodyX - prevBodyX) /
      Math.max(dtSec, 0.016) /
      Math.max(this.smoothedShoulderWidth, 0.08);
    this.jumpNoiseHorizontalVelocity =
      this.jumpNoiseHorizontalVelocity * 0.92 + this.clamp(horizontalVelocityNorm, 0, 3.5) * 0.08;
    const horizontalGateThreshold = this.clamp(
      Math.max(0.62, this.jumpNoiseHorizontalVelocity * 1.75 + 0.12),
      0.6,
      2.6
    );
    const hasStrongLateralMotion = horizontalVelocityNorm > horizontalGateThreshold * 1.08;
    const lateralIntensity = horizontalVelocityNorm / Math.max(horizontalGateThreshold, 0.01);
    if (laneChanged || hasStrongLateralMotion) {
      this.jumpSuppressUntil = now + this.clamp(220 + lateralIntensity * 120, 220, 520);
      this.jumpStableFrames = 0;
    }

    const bodyDy = this.smoothedBodyY - bodyCenter.y;
    const shoulderDy = this.smoothedShoulderY - shoulderCenter.y;
    const hipDy = this.smoothedHipY - hipCenter.y;
    const headDy = this.smoothedHeadY - rawNoseY;
    const velocity = bodyDy / dtSec;
    const shoulderVelocity = shoulderDy / dtSec;
    const torsoNorm = Math.max(this.smoothedTorsoHeight, 0.1);
    const normalizedBodyDy = bodyDy / torsoNorm;
    const normalizedHeadDy = headDy / torsoNorm;
    const normalizedShoulderDy = shoulderDy / torsoNorm;
    const normalizedHipDy = hipDy / torsoNorm;
    const normalizedVelocity = velocity / torsoNorm;
    const normalizedShoulderVelocity = shoulderVelocity / torsoNorm;
    const normalizedVelocityAbs = Math.abs(normalizedVelocity);
    const normalizedShoulderVelocityAbs = Math.abs(normalizedShoulderVelocity);
    const normalizedBodyDyAbs = Math.abs(normalizedBodyDy);
    const normalizedHeadDyAbs = Math.abs(normalizedHeadDy);
    const normalizedShoulderDyAbs = Math.abs(normalizedShoulderDy);
    const normalizedHipDyAbs = Math.abs(normalizedHipDy);

    this.smoothedBodyY = this.smoothedBodyY * 0.9 + bodyCenter.y * 0.1;
    this.smoothedShoulderY = this.smoothedShoulderY * 0.9 + shoulderCenter.y * 0.1;
    this.smoothedHipY = this.smoothedHipY * 0.9 + hipCenter.y * 0.1;
    this.smoothedHeadY = this.smoothedHeadY * 0.9 + rawNoseY * 0.1;
    const hasShoulders = !!(leftShoulder && rightShoulder);
    const hasAnyHip = !!(leftHip || rightHip);
    this.missingHipFrames = hasAnyHip ? 0 : Math.min(180, this.missingHipFrames + 1);
    const hasCoreBody = hasShoulders && hasAnyHip;
    const hasJumpTrackUpperBody = hasShoulders && !!nose;
    const hasUpperBody = hasCoreBody && !!nose;
    const upperBodyHeightRaw = nose ? hipCenter.y - nose.y : this.smoothedUpperBodyHeight;
    const prevUpperBodyHeight = this.smoothedUpperBodyHeight;
    this.smoothedUpperBodyHeight = this.smoothedUpperBodyHeight * 0.88 + upperBodyHeightRaw * 0.12;
    const upperBodyHeight = this.smoothedUpperBodyHeight;
    const centerOffset = Math.abs(this.smoothedBoxCenterX - 0.5);
    const noseYForReadiness = this.smoothedNoseY;
    const leftHipConfidence = this.getLandmarkConfidence(landmarks[23]);
    const rightHipConfidence = this.getLandmarkConfidence(landmarks[24]);
    const shoulderConfidence = (this.getLandmarkConfidence(landmarks[11]) + this.getLandmarkConfidence(landmarks[12])) / 2;
    const hipConfidence = leftHip && rightHip ? (leftHipConfidence + rightHipConfidence) / 2 : Math.max(leftHipConfidence, rightHipConfidence);
    const noseConfidence = this.getLandmarkConfidence(landmarks[0]);
    const coreConfidence = hasAnyHip
      ? shoulderConfidence * 0.48 + hipConfidence * 0.34 + noseConfidence * 0.18
      : shoulderConfidence * 0.72 + noseConfidence * 0.28;
    const torsoShoulderRatio = torsoHeight / Math.max(shoulderWidth, 0.02);
    const isGeometryReasonable = hasAnyHip
      ? (
          shoulderWidth > 0.022 &&
          torsoHeight > 0.03 &&
          torsoShoulderRatio > 0.42 &&
          torsoShoulderRatio < 3.6
        )
      : shoulderWidth > 0.022;
    const hasReliableCore =
      (hasAnyHip ? hasCoreBody : hasJumpTrackUpperBody) &&
      coreConfidence >= (hasAnyHip ? 0.34 : 0.38) &&
      isGeometryReasonable;
    const verticalDisagreement = hasAnyHip
      ? Math.abs(normalizedShoulderDy - normalizedHipDy) * 0.7 + Math.abs(normalizedHeadDy - normalizedShoulderDy) * 0.3
      : Math.abs(normalizedHeadDy - normalizedShoulderDy);
    const shoulderTiltRatio =
      leftShoulder && rightShoulder
        ? Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(shoulderWidth, 0.04)
        : 0;
    let isOutlierFrame = false;
    if (this.lastReliablePoseAt > 0) {
      const upperBodyDrift = Math.abs(upperBodyHeightRaw - prevUpperBodyHeight) / Math.max(prevUpperBodyHeight, 0.12);
      const centerDrift = Math.abs(boxCenterX - this.smoothedBoxCenterX);
      const shoulderWidthDrift = shoulderWidth > 0 ? Math.abs(shoulderWidth - this.smoothedShoulderWidth) / Math.max(this.smoothedShoulderWidth, 0.08) : 0;
      const torsoDrift = torsoHeight > 0 ? Math.abs(torsoHeight - this.smoothedTorsoHeight) / Math.max(this.smoothedTorsoHeight, 0.08) : 0;
      const verticalConflict = hasAnyHip && (
        normalizedShoulderDy * normalizedHipDy < -0.01 &&
        normalizedShoulderDyAbs + normalizedHipDyAbs > 0.18
      );
      const structureConflict = verticalDisagreement > 0.28 && normalizedVelocityAbs < 2.3;
      const tiltConflict = shoulderTiltRatio > 0.98 && normalizedVelocityAbs > 0.82;
      isOutlierFrame =
        verticalConflict ||
        structureConflict ||
        tiltConflict ||
        upperBodyDrift > 0.58 ||
        shoulderWidthDrift > 0.62 ||
        torsoDrift > 0.7 ||
        (centerDrift > 0.22 && normalizedVelocityAbs < 0.95);
    }
    const isReliableFrame = hasReliableCore && !isOutlierFrame;
    this.jumpReliabilityScore = this.jumpReliabilityScore * 0.9 + (isReliableFrame ? 1 : 0) * 0.1;
    if (isReliableFrame) {
      this.lastReliablePoseAt = now;
    }
    const issues: JumpReadinessIssue[] = [];

    if (!hasUpperBody || coreConfidence < 0.3) {
      issues.push('upper_body_missing');
    }
    if (centerOffset > this.JUMP_MAX_CENTER_OFFSET) {
      issues.push('off_center');
    }
    if (noseYForReadiness < this.JUMP_MIN_NOSE_Y || noseYForReadiness > this.JUMP_MAX_NOSE_Y) {
      issues.push('head_out_of_frame');
    }
    const shoulderTooFar = shoulderWidth > 0 && shoulderWidth < 0.08;
    const shoulderTooClose = shoulderWidth > 0.5;
    if (upperBodyHeight !== null) {
      if (upperBodyHeight < this.JUMP_MIN_UPPER_BODY_HEIGHT || shoulderTooFar) {
        issues.push('too_far');
      } else if (upperBodyHeight > this.JUMP_MAX_UPPER_BODY_HEIGHT || shoulderTooClose) {
        issues.push('too_close');
      }
    }
    if (!isReliableFrame) {
      issues.push('too_unstable');
    }

    const isStableForCalibration =
      normalizedVelocityAbs < 2.7 &&
      normalizedBodyDyAbs < 0.18 &&
      normalizedShoulderDyAbs < 0.15 &&
      normalizedHipDyAbs < 0.15;
    this.updateJumpReadiness(
      now,
      issues,
      isStableForCalibration,
      bodyCenter.y,
      shoulderCenter.y,
      hipCenter.y,
      rawNoseY,
      shoulderWidth,
      torsoHeight,
      normalizedVelocityAbs,
      normalizedBodyDyAbs,
      normalizedHeadDyAbs,
      normalizedShoulderDyAbs,
      normalizedHipDyAbs
    );

    const allowHipFallback = !hasAnyHip && this.jumpHasCalibration && this.missingHipFrames <= 45;
    const jumpTrackStructureOk = hasJumpTrackUpperBody && (hasAnyHip || allowHipFallback);
    const canTrackJump =
      jumpTrackStructureOk &&
      (isReliableFrame || now - this.lastReliablePoseAt <= 260) &&
      upperBodyHeight >= this.JUMP_MIN_UPPER_BODY_HEIGHT * 0.5 &&
      upperBodyHeight <= this.clamp(this.JUMP_MAX_UPPER_BODY_HEIGHT * 1.04, 0.78, 1);
    const hasCalibratedJump =
      this.jumpHasCalibration ||
      this.jumpCalibrationFrames >= 2 ||
      this.lastJumpReadyAt > 0 ||
      this.jumpReadiness.isReady;
    const jumpSuppressedByLateral =
      now < this.jumpSuppressUntil ||
      horizontalVelocityNorm > horizontalGateThreshold * 0.96;

    if (!canTrackJump || !hasCalibratedJump || jumpSuppressedByLateral) {
      this.jumpCandidateFrames = 0;
      this.jumpIntentScore = 0;
      this.jumpArmed = true;
      this.jumpQuietFrames = 0;
      this.jumpLiftSignalPrev = 0;
      this.jumpStableFrames = Math.max(0, this.jumpStableFrames - 1);
      this.state.isJumping = false;
    } else {
      const stableFrameLimit = this.clamp(this.jumpNoiseVerticalDisagreement * 2.1 + 0.08, 0.12, 0.28);
      const isStableTrackingFrame =
        isReliableFrame &&
        !hasStrongLateralMotion &&
        horizontalVelocityNorm < horizontalGateThreshold * 0.88 &&
        verticalDisagreement < stableFrameLimit;
      this.jumpStableFrames = isStableTrackingFrame
        ? Math.min(16, this.jumpStableFrames + 1)
        : Math.max(0, this.jumpStableFrames - 1);

      const isLikelyIdle =
        normalizedVelocityAbs < 1 &&
        normalizedBodyDyAbs < 0.065 &&
        normalizedHeadDyAbs < 0.065 &&
        normalizedShoulderDyAbs < 0.06 &&
        normalizedHipDyAbs < 0.06 &&
        horizontalVelocityNorm < horizontalGateThreshold * 0.72 &&
        verticalDisagreement < stableFrameLimit * 0.88;
      if (isLikelyIdle) {
        this.jumpNoiseVelocity = this.jumpNoiseVelocity * 0.9 + normalizedVelocityAbs * 0.1;
        this.jumpNoiseBodyDy = this.jumpNoiseBodyDy * 0.9 + normalizedBodyDyAbs * 0.1;
        this.jumpNoiseHeadDy = this.jumpNoiseHeadDy * 0.9 + normalizedHeadDyAbs * 0.1;
        this.jumpNoiseShoulderDy = this.jumpNoiseShoulderDy * 0.9 + normalizedShoulderDyAbs * 0.1;
        this.jumpNoiseHipDy = this.jumpNoiseHipDy * 0.9 + normalizedHipDyAbs * 0.1;
        this.jumpNoiseShoulderVelocity = this.jumpNoiseShoulderVelocity * 0.9 + normalizedShoulderVelocityAbs * 0.1;
        this.jumpNoiseLift = this.jumpNoiseLift * 0.9 + Math.abs(this.jumpLiftSignalPrev) * 0.1;
        this.jumpNoiseVerticalDisagreement =
          this.jumpNoiseVerticalDisagreement * 0.9 + verticalDisagreement * 0.1;
        this.jumpQuietFrames = Math.min(8, this.jumpQuietFrames + 1);
        this.jumpIntentScore = this.jumpIntentScore * 0.7;
        this.jumpBaselineBodyY = this.jumpBaselineBodyY * 0.94 + bodyCenter.y * 0.06;
        this.jumpBaselineHeadY = this.jumpBaselineHeadY * 0.94 + rawNoseY * 0.06;
        this.jumpBaselineShoulderY = this.jumpBaselineShoulderY * 0.94 + shoulderCenter.y * 0.06;
        this.jumpBaselineHipY = this.jumpBaselineHipY * 0.94 + hipCenter.y * 0.06;
        this.jumpBaselineShoulderWidth = this.jumpBaselineShoulderWidth * 0.95 + shoulderWidth * 0.05;
        this.jumpBaselineTorsoHeight = this.jumpBaselineTorsoHeight * 0.95 + torsoHeight * 0.05;
        this.jumpCalibrationFrames = Math.min(120, this.jumpCalibrationFrames + 1);
        this.jumpHasCalibration = this.jumpCalibrationFrames >= 3;
      } else {
        this.jumpQuietFrames = Math.max(0, this.jumpQuietFrames - 1);
        this.jumpNoiseVerticalDisagreement =
          this.jumpNoiseVerticalDisagreement * 0.97 + verticalDisagreement * 0.03;
        if (normalizedVelocity < -0.18) {
          this.jumpBaselineBodyY = this.jumpBaselineBodyY * 0.975 + bodyCenter.y * 0.025;
          this.jumpBaselineHeadY = this.jumpBaselineHeadY * 0.975 + rawNoseY * 0.025;
          this.jumpBaselineShoulderY = this.jumpBaselineShoulderY * 0.975 + shoulderCenter.y * 0.025;
          this.jumpBaselineHipY = this.jumpBaselineHipY * 0.975 + hipCenter.y * 0.025;
        }
      }

      const scaleBias = this.clamp((this.jumpBaselineShoulderWidth - 0.22) / 0.12, -1, 1);
      const thresholdScale = 1 + scaleBias * 0.22;
      const velocityThreshold = this.clamp(Math.max(0.9, this.jumpNoiseVelocity * 1.58 + 0.14), 0.82, 2.6) * thresholdScale;
      const shoulderVelocityThreshold = this.clamp(
        Math.max(0.85, this.jumpNoiseShoulderVelocity * 1.45 + 0.09),
        0.82,
        2.8
      ) * thresholdScale;
      const displacementThreshold = this.clamp(Math.max(0.03, this.jumpNoiseBodyDy * 1.9 + 0.01), 0.03, 0.13) * thresholdScale;
      const headDisplacementThreshold = this.clamp(Math.max(0.02, this.jumpNoiseHeadDy * 1.75 + 0.006), 0.018, 0.085) * thresholdScale;
      const shoulderDisplacementThreshold = this.clamp(Math.max(0.02, this.jumpNoiseShoulderDy * 1.75 + 0.006), 0.018, 0.085) * thresholdScale;
      const hipDisplacementThreshold = this.clamp(Math.max(0.02, this.jumpNoiseHipDy * 1.75 + 0.006), 0.018, 0.085) * thresholdScale;
      const baselineBodyLift = (this.jumpBaselineBodyY - bodyCenter.y) / torsoNorm;
      const baselineHeadLift = (this.jumpBaselineHeadY - rawNoseY) / torsoNorm;
      const baselineShoulderLift = (this.jumpBaselineShoulderY - shoulderCenter.y) / torsoNorm;
      const baselineHipLift = (this.jumpBaselineHipY - hipCenter.y) / torsoNorm;
      const coherentLift = hasAnyHip ? Math.min(baselineShoulderLift, baselineHipLift) : baselineShoulderLift;
      const liftSignal = coherentLift * 0.7 + baselineBodyLift * 0.3;
      const liftVelocity = liftSignal - this.jumpLiftSignalPrev;
      const lateralLeak =
        Math.max(0, horizontalVelocityNorm - this.jumpNoiseHorizontalVelocity * 0.65) * this.jumpLateralCoupling;
      const compensatedLiftSignal = liftSignal - lateralLeak;
      const compensatedLiftVelocity = liftVelocity - lateralLeak * 0.3;
      this.jumpLiftSignalPrev = liftSignal;
      const baselineBodyLiftThreshold = Math.max(displacementThreshold * 0.7, 0.026);
      const baselineHeadLiftThreshold = Math.max(headDisplacementThreshold * 0.58, 0.012);
      const baselineCoherentLiftThreshold = Math.max(Math.max(shoulderDisplacementThreshold, hipDisplacementThreshold) * 0.78, 0.018);
      const liftSignalThreshold = this.clamp(Math.max(0.026, this.jumpNoiseLift * 3.2 + 0.012), 0.022, 0.11);

      const rearmBodyThreshold = Math.max(0.02, displacementThreshold * 0.4);
      if (
        !this.jumpArmed &&
        (
          normalizedBodyDy < -rearmBodyThreshold ||
          normalizedVelocity < -0.3 ||
          (compensatedLiftSignal < liftSignalThreshold * 0.45 && normalizedVelocity < 0.2)
        )
      ) {
        this.jumpArmed = true;
      }

      const coherentUpperBodyCandidate = hasAnyHip
        ? (
            normalizedShoulderDy > shoulderDisplacementThreshold * 0.76 &&
            normalizedHipDy > hipDisplacementThreshold * 0.76 &&
            coherentLift > baselineCoherentLiftThreshold
          )
        : (
            normalizedShoulderDy > shoulderDisplacementThreshold * 0.84 &&
            normalizedShoulderVelocity > shoulderVelocityThreshold * 0.84 &&
            baselineShoulderLift > baselineCoherentLiftThreshold * 0.9
          );
      const bodyLiftCandidate =
        normalizedBodyDy > displacementThreshold ||
        baselineBodyLift > baselineBodyLiftThreshold ||
        (!hasAnyHip && baselineShoulderLift > baselineCoherentLiftThreshold * 0.85);
      const headConfirmed =
        (
          normalizedHeadDy > headDisplacementThreshold &&
          baselineHeadLift > baselineHeadLiftThreshold
        ) ||
        (
          normalizedBodyDy > displacementThreshold * 1.32 &&
          baselineHeadLift > baselineHeadLiftThreshold * 0.62
        );
      const triggerVelocity = hasAnyHip ? normalizedVelocity : normalizedShoulderVelocity;
      const triggerVelocityThreshold = hasAnyHip ? velocityThreshold : shoulderVelocityThreshold;
      const strongBodyCandidate =
        triggerVelocity > triggerVelocityThreshold * 0.72 &&
        bodyLiftCandidate &&
        coherentUpperBodyCandidate;
      const upperBodyFallbackCandidate =
        triggerVelocity > triggerVelocityThreshold * 0.62 &&
        coherentUpperBodyCandidate &&
        (
          headConfirmed ||
          baselineHeadLift > baselineHeadLiftThreshold * 0.72 ||
          compensatedLiftSignal > liftSignalThreshold
        );
      const ratioToBaselineShoulder = shoulderWidth / Math.max(this.jumpBaselineShoulderWidth, 0.08);
      const ratioToBaselineTorso = torsoHeight / Math.max(this.jumpBaselineTorsoHeight, 0.1);
      const geometryCloseToCalibration = hasAnyHip
        ? (
            ratioToBaselineShoulder > 0.56 &&
            ratioToBaselineShoulder < 1.78 &&
            ratioToBaselineTorso > 0.52 &&
            ratioToBaselineTorso < 1.75
          )
        : (
            ratioToBaselineShoulder > 0.48 &&
            ratioToBaselineShoulder < 2.05
          );
      const lateralMotionRatio = horizontalVelocityNorm / Math.max(horizontalGateThreshold, 0.01);
      const verticalIntentRatio = Math.max(
        triggerVelocity / Math.max(triggerVelocityThreshold, 0.01),
        compensatedLiftSignal / Math.max(liftSignalThreshold, 0.01),
        coherentLift / Math.max(baselineCoherentLiftThreshold, 0.01)
      );
      const disagreementPenalty =
        verticalDisagreement / Math.max(this.jumpNoiseVerticalDisagreement * 1.8 + 0.08, 0.12);
      const geometryPenalty =
        Math.abs(ratioToBaselineShoulder - 1) * 0.85 +
        (hasAnyHip ? Math.abs(ratioToBaselineTorso - 1) * 0.75 : 0);
      const reliabilityPenalty = Math.max(0, 0.68 - this.jumpReliabilityScore) * 1.3;
      const intentSupport = this.clamp(
        (verticalIntentRatio - 0.56) * 0.78 +
          (headConfirmed ? 0.18 : 0) -
          lateralMotionRatio * 0.58 -
          disagreementPenalty * 0.55 -
          geometryPenalty * 0.32 -
          reliabilityPenalty,
        -1,
        1.45
      );
      if (intentSupport >= 0) {
        this.jumpIntentScore = this.clamp(this.jumpIntentScore * 0.72 + intentSupport * 0.88, 0, 3.6);
      } else {
        this.jumpIntentScore = this.clamp(this.jumpIntentScore * 0.55 + intentSupport * 0.22, 0, 3.6);
      }
      const intentScoreThreshold = this.clamp(
        (hasAnyHip ? 0.92 : 1.05) +
          Math.max(0, lateralMotionRatio - 0.72) * 0.26 +
          Math.max(0, 0.62 - this.jumpReliabilityScore) * 0.28,
        0.86,
        1.65
      );
      const requiredStableFrames = hasAnyHip ? 2 : 3;
      const hasStablePrecondition = this.jumpStableFrames >= requiredStableFrames;
      const verticalDominatesLateral =
        verticalIntentRatio > lateralMotionRatio * 1.08 || lateralMotionRatio < 0.76;
      const intentDominantCandidate =
        this.jumpIntentScore >= intentScoreThreshold &&
        intentSupport > 0 &&
        verticalDominatesLateral;

      if (
        horizontalVelocityNorm > horizontalGateThreshold * 0.72 &&
        normalizedVelocity > 0 &&
        liftSignal > 0 &&
        !intentDominantCandidate
      ) {
        const observedCoupling = liftSignal / Math.max(horizontalVelocityNorm, 0.05);
        this.jumpLateralCoupling = this.clamp(this.jumpLateralCoupling * 0.94 + observedCoupling * 0.06, 0.02, 0.14);
      } else if (this.jumpQuietFrames >= 2 && horizontalVelocityNorm < horizontalGateThreshold * 0.55) {
        this.jumpLateralCoupling = this.clamp(this.jumpLateralCoupling * 0.985 + 0.03 * 0.015, 0.02, 0.14);
      }

      const isCandidate =
        geometryCloseToCalibration &&
        hasStablePrecondition &&
        (strongBodyCandidate || upperBodyFallbackCandidate || intentDominantCandidate) &&
        compensatedLiftSignal > baselineBodyLiftThreshold * 0.82 &&
        (
          compensatedLiftVelocity > liftSignalThreshold * 0.03 ||
          (
            this.jumpCandidateFrames > 0 &&
            compensatedLiftSignal > baselineBodyLiftThreshold * 0.96
          )
        );

      this.jumpCandidateFrames = isCandidate
        ? Math.min(5, this.jumpCandidateFrames + 1)
        : Math.max(0, this.jumpCandidateFrames - (intentSupport < 0 ? 2 : 1));

      const isStrongSingleFrameCandidate =
        intentDominantCandidate &&
        triggerVelocity > triggerVelocityThreshold * 1.02 &&
        coherentLift > baselineCoherentLiftThreshold * 1.08 &&
        compensatedLiftSignal > liftSignalThreshold * 1.06 &&
        hasStablePrecondition;
      const hasNoisyTracking =
        this.jumpNoiseHorizontalVelocity > 0.65 ||
        this.jumpNoiseVerticalDisagreement > 0.11 ||
        this.jumpReliabilityScore < 0.55;
      const requiredFrames = isStrongSingleFrameCandidate && !hasNoisyTracking ? 1 : (hasNoisyTracking || !hasAnyHip ? 3 : 2);
      if (
        this.jumpArmed &&
        this.jumpCandidateFrames >= requiredFrames &&
        this.jumpIntentScore >= intentScoreThreshold * 0.95 &&
        !this.state.isJumping &&
        now - this.lastJumpTime > this.JUMP_COOLDOWN
      ) {
        log(
          1,
          'JUMP',
          `Jump! TVel: ${triggerVelocity.toFixed(2)}>${triggerVelocityThreshold.toFixed(2)}, Lift: ${compensatedLiftSignal.toFixed(3)}, Intent: ${this.jumpIntentScore.toFixed(2)}>=${intentScoreThreshold.toFixed(2)}`
        );
        this.state.isJumping = true;
        this.lastJumpTime = now;
        this.jumpCandidateFrames = 0;
        this.jumpIntentScore = 0;
        this.jumpLiftSignalPrev = 0;
        this.jumpArmed = false;
        this.jumpQuietFrames = 0;
        this.jumpSuppressUntil = Math.max(this.jumpSuppressUntil, now + 180);
        this.onMotionDetected?.('jump');
        setTimeout(() => {
          this.state.isJumping = false;
        }, 320);
      }
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

  public resetPoseObservation(): void {
    this.poseLandmarks = null;
    this.filteredPoseLandmarks = null;
    this.lastPoseLandmarksAt = 0;
    this.resetJumpReadiness();
  }

  public hasFreshPoseLandmarks(sinceTimestampMs: number): boolean {
    if (this.lastPoseLandmarksAt < sinceTimestampMs) return false;
    if (!this.poseLandmarks || this.poseLandmarks.length === 0) return false;
    return this.poseLandmarks.some((landmark) => {
      const visibility = typeof landmark.visibility === 'number' ? landmark.visibility : 1;
      const presence = typeof landmark.presence === 'number' ? landmark.presence : 1;
      return visibility > 0.35 && presence > 0.35;
    });
  }

  private async withAbort<T>(promise: Promise<T>, signal?: AbortSignal, abortMessage = 'ABORTED'): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
      throw new Error(abortMessage);
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(new Error(abortMessage));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise
        .then((value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        })
        .catch((error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }

  private async sleepWithAbort(ms: number, signal?: AbortSignal, abortMessage = 'ABORTED'): Promise<void> {
    if (!signal) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onAbort);
        reject(new Error(abortMessage));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export const motionController = new MotionController();
