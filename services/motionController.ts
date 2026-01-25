import { MotionState } from '../types';

declare const Pose: any;

interface ImportMeta {
  readonly prod?: boolean;
}

interface WindowWithCDN extends Window {
  __MEDIAPIPE_CDN__?: string;
  tf?: any;
  innerWidth: number;
}

declare const window: WindowWithCDN;

const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
const CURRENT_LOG_LEVEL = (import.meta as { prod?: boolean }).prod ? LOG_LEVEL.WARN : LOG_LEVEL.INFO;

function log(level: number, tag: string, message: string, data?: any) {
  if (level < CURRENT_LOG_LEVEL) return;
  const prefix = `[${tag}]`;
  if (level === LOG_LEVEL.DEBUG) console.debug(prefix, message, data);
  else if (level === LOG_LEVEL.INFO) console.info(prefix, message, data);
  else if (level === LOG_LEVEL.WARN) console.warn(prefix, message, data);
  else console.error(prefix, message, data);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

class AdaptiveCalibrator {
  private jumpDisplacements: number[] = [];
  private readonly maxSamples = 5;
  private readonly calibrationFactor = 0.6;

  addJumpSample(displacement: number): void {
    if (this.jumpDisplacements.length < this.maxSamples) {
      this.jumpDisplacements.push(displacement);
      log(1, 'CALIB', `Calibration sample ${this.jumpDisplacements.length}/${this.maxSamples}: ${displacement.toFixed(4)}`);
    }
  }

  getCalibratedThreshold(baseThreshold: number): number {
    if (this.jumpDisplacements.length < 3) {
      return baseThreshold;
    }
    const avg = this.jumpDisplacements.reduce((a, b) => a + b, 0) / this.jumpDisplacements.length;
    const calibrated = avg * this.calibrationFactor;
    // log(1, 'CALIB', `Calibrated threshold: ${baseThreshold.toFixed(4)} -> ${calibrated.toFixed(4)} (avg: ${avg.toFixed(4)})`);
    return Math.min(calibrated, baseThreshold * 1.5);
  }

  isCalibrating(): boolean {
    return this.jumpDisplacements.length < this.maxSamples;
  }

  getProgress(): number {
    return this.jumpDisplacements.length / this.maxSamples;
  }
}

const NOSE_SMOOTHING = 0.8;
const SIGNAL_SMOOTHING = 0.5;
const BASELINE_ADAPTION_RATE = 0.03;
const JUMP_COOLDOWN = 400;
const VISIBILITY_THRESHOLD = 0.4;

export class MotionController {
  private pose: any = null;
  private video: HTMLVideoElement | null = null;
  private isRunning: boolean = false;
  private requestRef: number | null = null;
  private lastFrameTime: number = 0;
  private readonly TARGET_FPS = 30;
  private readonly FRAME_MIN_TIME = 1000 / 30;

  private xThreshold: number = 0.15;
  private jumpThresholdY: number = 0.08;

  private jumpStableFrames: number = 0;
  private requiredStableFrames: number = 2;

  private consecutiveMissedDetections: number = 0;
  private maxMissedFrames: number = 15;
  private framesSinceRecovery: number = 0;
  private recoveryStableFrames: number = 3;

  private shoulderWidthBase: number = 0;
  private currentShoulderWidth: number = 0;

  private currentNoseX: number = 0.5;
  private currentNoseY: number = 0.5;
  private currentBodyX: number = 0.5;
  private restingShoulderY: number = 0.5;
  private smoothedShoulderY: number = 0.5;
  private lastJumpTime: number = 0;

  public state: MotionState = {
    x: 0,
    bodyX: 0.5,
    isJumping: false,
    rawNoseX: 0.5,
    rawNoseY: 0.5,
    rawShoulderY: 0.5
  };

  public isReady: boolean = false;
  public isStarted: boolean = false;
  public isNoseDetected: boolean = false;
  private hasFatalError: boolean = false;
  public onMotionDetected: ((type: 'jump' | 'move') => void) | null = null;

  private initPromise: Promise<void> | null = null;
  private isIPad: boolean = false;
  private isAndroid: boolean = false;
  private isMobilePhone: boolean = false;
  private actualFPS: number = 30;

  private calibrator = new AdaptiveCalibrator();
  private lastNoseXForGradual: number = 0.5;
  private lastNoseYForGradual: number = 0.5;
  private trackingQuality: number = 1.0;
  private lastResultsTimeMs: number | null = null;

  private neutralBodyX: number = 0.5;
  private neutralBodyXSum: number = 0;
  private neutralBodyXSamples: number = 0;
  private neutralBodyXTargetSamples: number = 20;

  private lastYSignal: number | null = null;
  private lastYVelocityStableFrames: number = 0;
  private jumpVelocityThreshold: number = 0.25; // Relaxed from 0.40 for easier jumping
  private jumpArmed: boolean = true;

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const startTime = performance.now();
      log(1, 'INIT', 'Initializing Pose...');

      const ua = navigator.userAgent;
      this.isIPad = /iPad|Macintosh/i.test(ua) && 'ontouchend' in document;
      this.isAndroid = /Android/i.test(ua);
      this.isMobilePhone = /iPhone|Android|Mobile/i.test(ua) && !/iPad|Tablet/i.test(ua);

      if (this.isMobilePhone || this.isAndroid) {
        this.requiredStableFrames = 2;
      } else if (this.isIPad) {
        this.requiredStableFrames = 3;
      } else {
        this.requiredStableFrames = 3;
      }

      log(1, 'INIT', `Device: isIPad=${this.isIPad}, isAndroid=${this.isAndroid}, isMobilePhone=${this.isMobilePhone}`);

      // Wait for MediaPipe script to load (with timeout)
      if (typeof Pose === 'undefined') {
        log(2, 'INIT', 'MediaPipe Pose not ready, waiting...');
        let attempts = 0;
        while (typeof Pose === 'undefined' && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
          if (typeof Pose !== 'undefined') {
            log(1, 'INIT', 'MediaPipe Pose loaded after wait');
            break;
          }
        }

        if (typeof Pose === 'undefined') {
          const errorMsg = 'MediaPipe Pose script not loaded after 10s. Please check your connection.';
          log(3, 'INIT', errorMsg);
          alert(errorMsg);
          throw new Error(errorMsg);
        }
      }

      try {
        this.isReady = false;
        this.hasFatalError = false;

        const baseCandidates = Array.from(
          new Set<string>([
            this.ensureTrailingSlash(window.__MEDIAPIPE_CDN__ || '/mediapipe/'),
            this.ensureTrailingSlash('/mediapipe/')
          ])
        );

        let initialized = false;
        let lastError: unknown = null;

        for (const baseUrl of baseCandidates) {
          log(1, 'INIT', `Trying MediaPipe base: ${baseUrl}`);

          try {
            await this.initWithBase(baseUrl);
            initialized = true;
            break;
          } catch (e) {
            lastError = e;
            log(2, 'INIT', `MediaPipe init failed for base: ${baseUrl}`, e);
            this.pose?.close?.();
            this.pose = null;
            this.isReady = false;
            this.hasFatalError = false;
          }
        }

        if (!initialized) {
          this.initPromise = null;
          const errorMsg = 'MediaPipe 初始化失败（依赖文件加载或 WASM 运行失败）';
          log(3, 'INIT', errorMsg, lastError);
          throw lastError instanceof Error ? lastError : new Error(errorMsg);
        }

        const duration = (performance.now() - startTime).toFixed(0);
        log(1, 'INIT', `Pose initialization completed in ${duration}ms`);
      } catch (error) {
        this.initPromise = null;
        log(3, 'INIT', 'Failed to initialize Pose', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  private ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
  }

  private async initWithBase(baseUrl: string): Promise<void> {
    const resolvedBaseUrl = this.ensureTrailingSlash(baseUrl);

    this.pose = new Pose({
      locateFile: (file: string) => {
        const effectiveFile = this.getEffectiveMediapipeFile(file);
        const url = `${resolvedBaseUrl}${effectiveFile}`;
        log(1, 'CDN', `Locating file: ${file} -> ${url}`);
        return url;
      }
    });

    const minDetectionConf = (this.isIPad || this.isAndroid || this.isMobilePhone) ? 0.3 : 0.5;
    const minTrackingConf = (this.isIPad || this.isAndroid || this.isMobilePhone) ? 0.3 : 0.5;

    this.pose.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      minDetectionConfidence: minDetectionConf,
      minTrackingConfidence: minTrackingConf,
      selfieMode: false
    });

    log(1, 'INIT', `Confidence: Detection=${minDetectionConf}, Tracking=${minTrackingConf}`);

    this.pose.onResults(this.onResults.bind(this));

    await this.prefetchMediapipeDependencies(resolvedBaseUrl);
    await this.warmupPose(5000);

    this.isReady = true;
    log(1, 'INIT', `MediaPipe ready with base: ${resolvedBaseUrl}`);
  }

  private getEffectiveMediapipeFile(file: string): string {
    if (this.isIPad && file.startsWith('pose_solution_simd_wasm_bin')) {
      return file.replace('pose_solution_simd_wasm_bin', 'pose_solution_wasm_bin');
    }
    return file;
  }

  private async prefetchMediapipeDependencies(baseUrl: string): Promise<void> {
    const files = [
      'pose_solution_packed_assets_loader.js',
      'pose_solution_packed_assets.data',
      'pose_solution_wasm_bin.js',
      'pose_solution_wasm_bin.wasm'
    ];

    for (const file of files) {
      const url = `${baseUrl}${file}`;
      await this.prefetchBinary(url, 15000, 2);
    }
  }

  private async prefetchBinary(url: string, timeoutMs: number, retries: number): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        log(1, 'CDN', `Prefetching: ${url} (attempt ${attempt + 1}/${retries + 1})`);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(url, { mode: 'cors', cache: 'reload', signal: controller.signal });
        window.clearTimeout(timeoutId);

        if (!resp.ok) {
          throw new Error(`Prefetch failed: ${resp.status} ${resp.statusText}`);
        }

        await resp.arrayBuffer();
        log(1, 'CDN', `Prefetch ok: ${url}`);
        return;
      } catch (e) {
        lastError = e;
        log(2, 'CDN', `Prefetch error: ${url}`, e);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Prefetch failed: ${url}`);
  }

  private async warmupPose(timeoutMs: number): Promise<void> {
    if (!this.pose) throw new Error('Pose not initialized');

    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 64;
    dummyCanvas.height = 64;
    const ctx = dummyCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create canvas context for warmup');

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 64, 64);

    log(1, 'INIT', 'Warm-up send begin');

    const warmupPromise: Promise<void> = this.pose.send({ image: dummyCanvas });
    const timeoutPromise = new Promise<void>((_, reject) => {
      window.setTimeout(() => reject(new Error('Warm-up timeout')), timeoutMs);
    });

    await Promise.race([warmupPromise, timeoutPromise]);
    log(1, 'INIT', 'Warm-up send ok');
  }

  async start(videoElement: HTMLVideoElement) {
    if (this.isRunning) {
      log(1, 'START', 'Already running, updating video element');
      this.video = videoElement;
      return;
    }
    log(1, 'START', 'Starting...');
    if (!this.pose) {
      await this.init();
    }
    this.video = videoElement;
    this.isRunning = true;
    this.isStarted = true;

    this.currentNoseX = 0.5;
    this.lastNoseXForGradual = 0.5;
    this.currentNoseY = 0.5;
    this.lastNoseYForGradual = 0.5;
    this.currentBodyX = 0.5;
    this.restingShoulderY = 0.5;
    this.smoothedShoulderY = 0.5;
    this.consecutiveMissedDetections = 0;
    this.trackingQuality = 1.0;
    this.lastResultsTimeMs = null;

    this.neutralBodyX = 0.5;
    this.neutralBodyXSum = 0;
    this.neutralBodyXSamples = 0;

    this.lastYSignal = null;
    this.lastYVelocityStableFrames = 0;
    this.jumpArmed = true;

    log(1, 'START', 'Beginning frame processing loop');
    this.processFrame();
  }

  stop() {
    log(1, 'STOP', 'Stopping...');
    this.isRunning = false;
    this.isStarted = false;
    if (this.requestRef) cancelAnimationFrame(this.requestRef);
  }

  calibrate() {
    if (this.state.rawShoulderY) {
      this.restingShoulderY = this.smoothedShoulderY;
      this.shoulderWidthBase = this.currentShoulderWidth;
    }
    this.neutralBodyX = this.state.bodyX;
    this.neutralBodyXSum = 0;
    this.neutralBodyXSamples = 0;
  }

  private async processFrame() {
    if (!this.isRunning) return;

    // If not ready or video not ready, skip processing but KEEP LOOP ALIVE
    if (!this.pose || !this.isReady || this.hasFatalError || !this.video || this.video.readyState < 2) {
      if (this.isRunning) {
        // Log occasionally to help debugging why it's waiting
        if (Math.random() < 0.01) {
           log(1, 'LOOP', `Waiting... isReady=${this.isReady}, hasPose=${!!this.pose}, video=${this.video?.readyState}, fatal=${this.hasFatalError}`);
        }
        this.requestRef = requestAnimationFrame(() => this.processFrame());
      }
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= this.FRAME_MIN_TIME) {
        try {
          await this.pose.send({ image: this.video });
          this.lastFrameTime = now;

          const actualFrameTime = elapsed;
          this.actualFPS = this.actualFPS * 0.9 + (1000 / actualFrameTime) * 0.1;
          if (Math.random() < 0.01) {
            log(0, 'FPS', `Actual FPS: ${this.actualFPS.toFixed(1)}`);
          }
        } catch (e) {
          const errorStr = String(e);

          if (this.isIPad) {
            if (errorStr.includes('memory') || errorStr.includes('WebGL')) {
              log(2, 'IPAD', 'Memory/WebGL error, continuing...');
              return;
            }
          }

          if (errorStr.includes('graph') || errorStr.includes('tflite')) {
            log(3, 'FATAL', 'MediaPipe graph error, stopping loop');
            this.hasFatalError = true;
            return;
          }

          if (errorStr.includes('WASM') || errorStr.includes('undefined')) {
            const logRate = this.isIPad ? 0.02 : 0.05;
            if (Math.random() < logRate) {
              log(2, 'STABIL', 'MediaPipe still stabilizing...');
            }
          } else {
            log(2, 'FRAME', 'Frame processing error', e);
          }
        }
    }

    if (this.isRunning) {
      this.requestRef = requestAnimationFrame(() => this.processFrame());
    }
  }

  private handleLostTracking(reason: string) {
    this.isNoseDetected = false;
    this.state.isJumping = false;
    
    this.jumpStableFrames = 0;
    this.lastResultsTimeMs = null;
    this.lastYSignal = null;
    this.lastYVelocityStableFrames = 0;
    this.jumpArmed = true;
    
    if (this.consecutiveMissedDetections > 5) {
        this.smoothedShoulderY = 0.5; 
    }

    this.consecutiveMissedDetections++;
    this.framesSinceRecovery = 0;

    this.trackingQuality = Math.max(0.1, 1 - (this.consecutiveMissedDetections / this.maxMissedFrames));

    // Reset neutralBodyX to 0.5 (center) on tracking loss to clear bad calibration
    if (this.consecutiveMissedDetections >= this.maxMissedFrames) {
      // log(2, 'TRACK', `Tracking lost for ${this.maxMissedFrames} frames (${reason}), gradual reset`);

      const gradualReturnRate = 0.02;
      this.lastNoseXForGradual = this.lastNoseXForGradual * (1 - gradualReturnRate) + 0.5 * gradualReturnRate;
      this.lastNoseYForGradual = this.lastNoseYForGradual * (1 - gradualReturnRate) + 0.5 * gradualReturnRate;
      this.state.rawNoseX = this.lastNoseXForGradual;
      this.state.rawNoseY = this.lastNoseYForGradual;
      
      // Slowly drift neutralBodyX back to 0.5 if tracking is lost
      this.neutralBodyX = this.neutralBodyX * 0.98 + 0.5 * 0.02;

      if (this.consecutiveMissedDetections >= 90) {
        this.restingShoulderY = 0.5;
        this.smoothedShoulderY = 0.5;
        this.neutralBodyX = 0.5; // Force reset
        this.consecutiveMissedDetections = 0;
        log(2, 'TRACK', 'Full reset after extended tracking loss');
      }
    } else if (this.consecutiveMissedDetections % 15 === 0) {
      log(2, 'TRACK', `Tracking flickering (${reason}), frames: ${this.consecutiveMissedDetections}`);
    }
  }

  private onResults(results: any) {
    if (!this.isRunning) return;

    const nowMs = performance.now();
    const dtSec = this.lastResultsTimeMs === null ? (1 / this.TARGET_FPS) : clamp((nowMs - this.lastResultsTimeMs) / 1000, 1 / 120, 0.2);
    this.lastResultsTimeMs = nowMs;

    if (!results || !results.poseLandmarks) {
      this.handleLostTracking('No results');
      return;
    }

    const landmarks = results.poseLandmarks;
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const noseVis = nose?.visibility ?? 0;
    const leftShoulderVis = leftShoulder?.visibility ?? 0;
    const rightShoulderVis = rightShoulder?.visibility ?? 0;
    const leftHipVis = leftHip?.visibility ?? 0;
    const rightHipVis = rightHip?.visibility ?? 0;

    const noseOk = noseVis > VISIBILITY_THRESHOLD;
    const shouldersOk = leftShoulderVis > VISIBILITY_THRESHOLD && rightShoulderVis > VISIBILITY_THRESHOLD;
    const hipsOk = leftHipVis > VISIBILITY_THRESHOLD && rightHipVis > VISIBILITY_THRESHOLD;

    if (!noseOk && !shouldersOk && !hipsOk) {
      this.handleLostTracking('Landmarks not visible');
      return;
    }

    this.isNoseDetected = noseOk;

    const conf = shouldersOk && hipsOk
      ? Math.min(leftShoulderVis, rightShoulderVis, leftHipVis, rightHipVis)
      : shouldersOk
        ? Math.min(leftShoulderVis, rightShoulderVis)
        : noseOk
          ? noseVis
          : 0;
    this.trackingQuality = clamp(this.trackingQuality * 0.9 + conf * 0.1, 0.1, 1.0);

    this.consecutiveMissedDetections = 0;
    this.framesSinceRecovery++;
    if (this.framesSinceRecovery < this.recoveryStableFrames) {
      this.jumpStableFrames = 0;
      this.state.isJumping = false;
      this.lastYVelocityStableFrames = 0;
      this.jumpArmed = false;
    }

    if (noseOk) {
      this.currentNoseX = (nose.x * NOSE_SMOOTHING) + (this.currentNoseX * (1 - NOSE_SMOOTHING));
      this.currentNoseY = (nose.y * NOSE_SMOOTHING) + (this.currentNoseY * (1 - NOSE_SMOOTHING));
      this.state.rawNoseX = this.currentNoseX;
      this.state.rawNoseY = this.currentNoseY;
      this.lastNoseXForGradual = this.currentNoseX;
      this.lastNoseYForGradual = this.currentNoseY;
    }

    if (shouldersOk) {
      this.currentShoulderWidth = Math.sqrt(
        Math.pow(leftShoulder.x - rightShoulder.x, 2) +
        Math.pow(leftShoulder.y - rightShoulder.y, 2)
      );
      if (this.shoulderWidthBase === 0) {
        this.shoulderWidthBase = this.currentShoulderWidth;
      }
    }

    this.updateThresholds();

    const shoulderCenterX = shouldersOk ? (leftShoulder.x + rightShoulder.x) / 2 : null;
    const hipCenterX = hipsOk ? (leftHip.x + rightHip.x) / 2 : null;

    let bodyXCandidate: number | null = null;
    if (shouldersOk && hipsOk && shoulderCenterX !== null && hipCenterX !== null) {
      bodyXCandidate = hipCenterX * 0.65 + shoulderCenterX * 0.35;
    } else if (shouldersOk && shoulderCenterX !== null) {
      bodyXCandidate = shoulderCenterX;
    } else if (noseOk) {
      bodyXCandidate = nose.x;
    }

    if (bodyXCandidate !== null) {
      const updateOk = (shouldersOk || hipsOk) ? conf > 0.35 : conf > 0.65;
      if (updateOk) {
        const alpha = clamp(0.35 + this.trackingQuality * 0.3, 0.35, 0.65);
        const desired = bodyXCandidate * alpha + this.currentBodyX * (1 - alpha);
        const modeFactor = shouldersOk ? 1 : 0.6;
        // Increased maxDelta to make X movement more responsive (0.12 -> 0.15)
        const maxDelta = clamp(dtSec * (1.2 + 0.8 * this.trackingQuality) * modeFactor, 0.015, shouldersOk ? 0.15 : 0.08);
        this.currentBodyX = this.currentBodyX + clamp(desired - this.currentBodyX, -maxDelta, maxDelta);
      }
    }

    const rawControlX = 1 - this.currentBodyX;
    
    // Disable startup calibration for X-axis center
    // It's too risky if the user starts off-center. Assume 0.5 is center.
    /* 
    if (this.neutralBodyXSamples < this.neutralBodyXTargetSamples && shouldersOk && this.trackingQuality > 0.6) {
      this.neutralBodyXSum += rawControlX;
      this.neutralBodyXSamples++;
      if (this.neutralBodyXSamples >= this.neutralBodyXTargetSamples) {
        this.neutralBodyX = this.neutralBodyXSum / this.neutralBodyXSamples;
      }
    }
    */

    // Always drift neutralBodyX very slowly towards 0.5 to correct for any long-term drift
    // but trust 0.5 as the absolute truth for "center"
    this.neutralBodyX = this.neutralBodyX * 0.995 + 0.5 * 0.005;

    const adjustedControlX = clamp(rawControlX - this.neutralBodyX + 0.5, 0, 1);
    this.state.bodyX = adjustedControlX;

    // Note: Lane directions were inverted. 
    // rawControlX = 1 (Left of screen) should map to Left Lane (-1)
    // rawControlX = 0 (Right of screen) should map to Right Lane (1)
    // adjustedControlX > 0.5 + threshold means rawControlX is large (Left) -> Target Lane -1
    // adjustedControlX < 0.5 - threshold means rawControlX is small (Right) -> Target Lane 1
    
    let targetLane = 0;
    if (adjustedControlX > (0.5 + this.xThreshold)) {
      targetLane = -1; // Was 1 (Right), now -1 (Left)
    } else if (adjustedControlX < (0.5 - this.xThreshold)) {
      targetLane = 1;  // Was -1 (Left), now 1 (Right)
    } else {
      targetLane = 0;
    }
    if (this.state.x !== targetLane) {
      this.onMotionDetected?.('move');
    }
    this.state.x = targetLane;

    if (!shouldersOk) {
      this.state.isJumping = false;
      return;
    }

    const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipCenterY = hipsOk ? (leftHip.y + rightHip.y) / 2 : null;
    const ySignal = hipCenterY === null ? shoulderCenterY : (hipCenterY * 0.6 + shoulderCenterY * 0.4);

    if ((this.smoothedShoulderY === 0.5 && Math.abs(ySignal - 0.5) > 0.1) || this.framesSinceRecovery < 5) {
      this.smoothedShoulderY = ySignal;
      this.restingShoulderY = ySignal;
      this.lastYSignal = ySignal;
      this.lastYVelocityStableFrames = 0;
    }

    this.smoothedShoulderY = (ySignal * SIGNAL_SMOOTHING) + (this.smoothedShoulderY * (1 - SIGNAL_SMOOTHING));
    this.state.rawShoulderY = this.smoothedShoulderY;

    if (!this.state.isJumping) {
      this.restingShoulderY = (this.smoothedShoulderY * BASELINE_ADAPTION_RATE) + (this.restingShoulderY * (1 - BASELINE_ADAPTION_RATE));
    }

    const displacement = this.restingShoulderY - this.smoothedShoulderY;
    const yVel = this.lastYSignal === null ? 0 : ((this.lastYSignal - this.smoothedShoulderY) / dtSec);
    this.lastYSignal = this.smoothedShoulderY;

    const now = Date.now();
    const effectiveThreshold = this.calibrator.isCalibrating()
      ? this.jumpThresholdY
      : this.calibrator.getCalibratedThreshold(this.jumpThresholdY);

    const velocityOk = yVel > this.jumpVelocityThreshold;
    const displacementOk = displacement > effectiveThreshold;

    if (this.framesSinceRecovery >= 5 && displacement < effectiveThreshold * 0.3) {
      this.jumpArmed = true;
    }

    if (this.jumpArmed && velocityOk && displacementOk && (now - this.lastJumpTime > JUMP_COOLDOWN)) {
      this.lastYVelocityStableFrames++;
      if (this.lastYVelocityStableFrames >= this.requiredStableFrames) {
        if (this.calibrator.isCalibrating()) {
          this.calibrator.addJumpSample(displacement);
        }
        this.state.isJumping = true;
        this.lastJumpTime = now;
        this.jumpStableFrames = 0;
        this.lastYVelocityStableFrames = 0;
        this.jumpArmed = false;
        this.onMotionDetected?.('jump');
        setTimeout(() => { this.state.isJumping = false; }, 400);
      }
    } else {
      this.lastYVelocityStableFrames = 0;
    }
  }

  private updateThresholds() {
    if (!this.video || this.video.videoWidth === 0) return;

    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    const aspectRatio = width / height;

    const distanceScale = this.shoulderWidthBase > 0 ? (this.currentShoulderWidth / this.shoulderWidthBase) : 1;
    const clampedDistanceScale = Math.max(0.5, Math.min(1.3, distanceScale)); // Cap at 1.3 to prevent excessive strictness when close

    const isTablet = window.innerWidth >= 768;

    // Dynamic threshold scaling based on distance (closer = larger threshold needed)
    // Significantly reduced thresholds to make movement easier/less strict
    if (this.isIPad) {
      if (aspectRatio > 1) {
        this.xThreshold = 0.12 * clampedDistanceScale; // Reduced from 0.20
        this.jumpThresholdY = 0.10 * clampedDistanceScale;
      } else {
        this.xThreshold = 0.15 * clampedDistanceScale; // Reduced from 0.25
        this.jumpThresholdY = 0.07 * clampedDistanceScale;
      }
    } else if (this.isMobilePhone || this.isAndroid) {
      if (aspectRatio > 1) {
        this.xThreshold = 0.15 * clampedDistanceScale; // Reduced from 0.22
        this.jumpThresholdY = 0.03 * clampedDistanceScale;
      } else {
        this.xThreshold = 0.18 * clampedDistanceScale; // Reduced from 0.30
        this.jumpThresholdY = 0.025 * clampedDistanceScale;
      }
    } else {
      if (aspectRatio > 1) {
        if (isTablet) {
          this.xThreshold = 0.15 * clampedDistanceScale; // Reduced from 0.22
          this.jumpThresholdY = 0.07 * clampedDistanceScale;
        } else {
          this.xThreshold = 0.12 * clampedDistanceScale; // Reduced from 0.20
          this.jumpThresholdY = 0.03 * clampedDistanceScale;
        }
      } else {
        this.xThreshold = 0.18 * clampedDistanceScale; // Reduced from 0.28
        this.jumpThresholdY = 0.03 * clampedDistanceScale;
      }
    }

    if ((this.isIPad || this.isMobilePhone || this.isAndroid) && Math.random() < 0.005) {
      log(0, 'THRESH', `xThreshold: ${this.xThreshold.toFixed(3)}, jumpThreshold: ${this.jumpThresholdY.toFixed(3)}`);
    }
  }

  public getCalibrationProgress(): number {
    return this.calibrator.getProgress();
  }

  public isCalibrating(): boolean {
    return this.calibrator.isCalibrating();
  }
}

export const motionController = new MotionController();
