import { MotionState } from '../types';

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

// Type definition for MediaPipe FaceDetection
declare global {
    interface Window {
        FaceDetection: any;
        __MEDIAPIPE_FACE_DETECTION_CDN__?: string;
    }
}

export class MotionController {
  private video: HTMLVideoElement | null = null;
  private faceDetector: any = null;
  private isRunning: boolean = false;
  private requestRef: number | null = null;
  private lastFrameTime: number = 0;
  private readonly FRAME_MIN_TIME = 1000 / 30; // 30 FPS cap

  // Thresholds for Face Motion
  // X: 0.5 is center. > 0.6 is Right, < 0.4 is Left.
  private xThreshold: number = 0.12; 
  
  public state: MotionState = {
    x: 0,
    bodyX: 0.5,
    isJumping: false,
    rawNoseX: 0.5,
    rawNoseY: 0.5,
    rawShoulderY: 0.5,
    smoothedState: {
        x: 0,
        bodyX: 0.5,
        isJumping: false,
        rawNoseX: 0.5,
        rawNoseY: 0.5,
        rawShoulderY: 0.5
    }
  };

  public smoothedState: MotionState = {
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
  public onMotionDetected: ((type: 'jump' | 'move') => void) | null = null;

  private initPromise: Promise<void> | null = null;
  
  // Smoothing vars
  private currentHeadX: number = 0.5;
  private smoothedHeadY: number = 0.5;
  private smoothedNoseX: number = 0.5;
  private smoothedNoseY: number = 0.5;
  private smoothedFaceSize: number = 0;
  private jumpCandidateFrames: number = 0;
  private jumpArmed: boolean = true;
  
  // Jump Logic
  private lastJumpTime: number = 0;
  private readonly JUMP_COOLDOWN = 800;

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

    const waitForFaceDetection = async (): Promise<void> => {
      const start = performance.now();
      let attempts = 0;
      while (!window.FaceDetection && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      if (!window.FaceDetection) {
        throw new Error('FaceDetection library not found');
      }
      diagLog('FaceDetection global ready', { ms: Math.round(performance.now() - start), attempts });
    };

    const createDetector = async (baseOverride?: string): Promise<any> => {
      const base = baseOverride || window.__MEDIAPIPE_FACE_DETECTION_CDN__ || '/mediapipe/face_detection/';
      const faceDetection = new window.FaceDetection({
        locateFile: (file: string) => {
          const fileName = file.split('/').pop();
          return `${base}${fileName}`;
        }
      });

      faceDetection.setOptions({
        model: 'short',
        minDetectionConfidence: 0.5,
        selfieMode: false
      });

      faceDetection.onResults(this.onResults.bind(this));

      if (diagEnabled && 'caches' in window && typeof caches.match === 'function') {
        const probeFiles = [
          'face_detection.js',
          'face_detection_solution_simd_wasm_bin.js',
          'face_detection_solution_simd_wasm_bin.wasm',
          'face_detection_solution_wasm_bin.js',
          'face_detection_solution_wasm_bin.wasm',
          'face_detection_short_range.tflite'
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
      await withTimeout(faceDetection.initialize(), 8000, 'FaceDetection initialize timeout');
      diagLog('initialize done', { base, ms: Math.round(performance.now() - initStart) });

      return faceDetection;
    };

    this.initPromise = (async () => {
      log(1, 'INIT', 'Initializing Face Detection...');

      try {
        const totalStart = performance.now();
        await waitForFaceDetection();
        this.faceDetector = await createDetector();
        this.isReady = true;
        log(1, 'INIT', 'Face Detection Ready');
        diagLog('init success', { ms: Math.round(performance.now() - totalStart), base: window.__MEDIAPIPE_FACE_DETECTION_CDN__ || '/mediapipe/face_detection/' });
      } catch (e) {
        log(2, 'INIT', 'Primary Face Detection init failed, retrying with local files...', e);
        diagLog('init failed, fallback to local', { error: String(e) });
        try {
          const fallbackStart = performance.now();
          await waitForFaceDetection();
          this.faceDetector = await createDetector('/mediapipe/face_detection/');
          this.isReady = true;
          log(1, 'INIT', 'Face Detection Ready (local fallback)');
          diagLog('fallback success', { ms: Math.round(performance.now() - fallbackStart) });
        } catch (fallbackError) {
          this.faceDetector = null;
          this.isReady = false;
          console.error('[MotionController] Init failed', fallbackError);
          diagLog('fallback failed', { error: String(fallbackError) });
          throw fallbackError;
        }
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
    
    if (!this.faceDetector) {
        await this.init();
        if (!this.faceDetector) {
          throw new Error('Face detector not initialized');
        }
    }
    
    this.video = videoElement;
    this.isRunning = true;
    this.isStarted = true;
    this.isNoseDetected = false;

    // Reset state
    this.currentHeadX = 0.5;
    this.smoothedHeadY = 0.5;
    this.smoothedNoseX = 0.5;
    this.smoothedNoseY = 0.5;
    this.smoothedFaceSize = 0;
    this.jumpCandidateFrames = 0;
    this.jumpArmed = true;
    this.state.isJumping = false;
    this.state.bodyX = 0.5;
    this.state.rawNoseX = 0.5;
    this.state.rawNoseY = 0.5;

    log(1, 'START', 'Loop starting');
    this.processFrame();
  }

  stop() {
    this.isRunning = false;
    this.isStarted = false;
    // faceDetector doesn't have a stop method, just stop feeding it frames
  }

  // No-op for compatibility
  calibrate() {}
  getCalibrationProgress() { return 1; }
  isCalibrating() { return false; }

  private onResults(results: any) {
      if (!results.detections || results.detections.length === 0) {
          this.isNoseDetected = false;
          this.jumpCandidateFrames = 0;
          return;
      }

      this.isNoseDetected = true;
      const detection = results.detections[0];
      const bbox = detection.boundingBox; // { xCenter, yCenter, width, height }
      const keypoints: Array<{ x?: number; y?: number; name?: string }> = Array.isArray(detection.keypoints)
        ? detection.keypoints
        : [];
      const noseKeypoint =
        keypoints.find((kp) => typeof kp.name === 'string' && kp.name.toLowerCase().includes('nose')) ||
        keypoints[2] ||
        null;
      const rawFaceX = typeof noseKeypoint?.x === 'number' ? noseKeypoint.x : bbox.xCenter;
      const rawFaceY = typeof noseKeypoint?.y === 'number' ? noseKeypoint.y : bbox.yCenter;
      const mirroredX = 1 - rawFaceX;

      const now = performance.now();
      const elapsed = now - this.lastFrameTime;
      const dtSec = Math.max(0.016, elapsed > 0 && elapsed < 500 ? elapsed / 1000 : 0.033);
      const noseAlpha = 1 - Math.exp(-dtSec / 0.08);
      const faceSize = (typeof bbox?.width === 'number' ? bbox.width : 0) * (typeof bbox?.height === 'number' ? bbox.height : 0);
      if (this.smoothedFaceSize <= 0) {
          this.smoothedFaceSize = faceSize;
      } else {
          this.smoothedFaceSize = this.smoothedFaceSize * 0.95 + faceSize * 0.05;
      }
      const faceSizeRatio = this.smoothedFaceSize > 0 ? Math.abs(faceSize - this.smoothedFaceSize) / this.smoothedFaceSize : 0;

      // --- 1. Update X (Horizontal) ---
      // Smooth interpolation
      this.currentHeadX = this.currentHeadX * 0.7 + mirroredX * 0.3;
      
      this.state.bodyX = this.currentHeadX;
      this.state.rawNoseX = rawFaceX;
      this.state.rawNoseY = rawFaceY;
      this.smoothedNoseX = this.smoothedNoseX * (1 - noseAlpha) + rawFaceX * noseAlpha;
      this.smoothedNoseY = this.smoothedNoseY * (1 - noseAlpha) + rawFaceY * noseAlpha;

      // Lane Logic
      let targetLane = 0;
      if (this.currentHeadX < (0.5 - this.xThreshold)) {
          targetLane = -1; // Left
      } else if (this.currentHeadX > (0.5 + this.xThreshold)) {
          targetLane = 1;  // Right
      } else {
          targetLane = 0;  // Center
      }

      if (this.state.x !== targetLane) {
          this.onMotionDetected?.('move');
      }
      this.state.x = targetLane;

      // --- 2. Update Y (Jump) ---
      // Jump Logic: Detect rapid UPWARD movement of the HEAD
      // Up = Negative Y direction (0 is top)
      
      // Calculate velocity
      // Positive Velocity = Moving UP (Old Y > New Y)
      const dy = this.smoothedHeadY - rawFaceY;
      const velocity = dy / dtSec;
      
      // Update smoothed baseline (follow head slowly to adapt to height)
      this.smoothedHeadY = this.smoothedHeadY * 0.96 + rawFaceY * 0.04;
      this.state.rawShoulderY = this.smoothedHeadY;

      // Jump Trigger
      // Velocity > 1.2 (Fast upward)
      // Displacement > 0.04 (Significant distance)
      if (faceSizeRatio < 0.35) {
          if (!this.jumpArmed && dy < 0.03) {
              this.jumpArmed = true;
          }
          const isCandidate = velocity > 1.9 && dy > 0.07;
          this.jumpCandidateFrames = isCandidate ? Math.min(3, this.jumpCandidateFrames + 1) : Math.max(0, this.jumpCandidateFrames - 1);
          if (this.jumpArmed && this.jumpCandidateFrames >= 2 && !this.state.isJumping && now - this.lastJumpTime > this.JUMP_COOLDOWN) {
              log(1, 'JUMP', `Jump! Vel: ${velocity.toFixed(2)}, Dy: ${dy.toFixed(2)}`);
              this.state.isJumping = true;
              this.lastJumpTime = now;
              this.jumpCandidateFrames = 0;
              this.jumpArmed = false;
              this.onMotionDetected?.('jump');
              setTimeout(() => { this.state.isJumping = false; }, 450);
          }
      } else {
          this.jumpCandidateFrames = 0;
      }

      // --- 3. Sync Smoothed State ---
      if (!this.state.smoothedState) {
           this.state.smoothedState = { ...this.state };
      }
      
      this.state.smoothedState.bodyX = this.state.bodyX;
      this.state.smoothedState.rawNoseX = this.smoothedNoseX;
      this.state.smoothedState.rawNoseY = this.smoothedNoseY;
      this.state.smoothedState.x = this.state.x;
      this.state.smoothedState.isJumping = this.state.isJumping;
      
      this.smoothedState = this.state.smoothedState;
      this.lastFrameTime = now;
  }

  private async processFrame() {
    if (!this.isRunning || !this.video || !this.faceDetector) return;

    try {
        // Send frame to Face Detector
        // Note: Face Detector is async, result handled in onResults
        if (this.video.videoWidth > 0 && !this.video.paused) {
            await this.faceDetector.send({image: this.video});
        }
    } catch (e) {
        console.warn("Face detection send error", e);
    }

    if (this.isRunning) {
      // Throttle to target FPS? FaceDetector is usually fast enough
      // But we can use requestAnimationFrame loop to drive the sending
      this.requestRef = requestAnimationFrame(() => this.processFrame());
    }
  }
}

export const motionController = new MotionController();
