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
  
  // Jump Logic
  private lastJumpTime: number = 0;
  private readonly JUMP_COOLDOWN = 600;

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      log(1, 'INIT', 'Initializing Face Detection...');
      
      // Wait for global FaceDetection to be loaded
      let attempts = 0;
      while (!window.FaceDetection && attempts < 50) {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
      }

      if (!window.FaceDetection) {
          console.error('[MotionController] FaceDetection library not found');
          return;
      }

      try {
        const faceDetection = new window.FaceDetection({
            locateFile: (file: string) => {
                // If using local path, we don't need to strip path, it's flat
                // If using CDN, we force flat filename
                const cdnBase = window.__MEDIAPIPE_FACE_DETECTION_CDN__ || '/mediapipe/face_detection/';
                const fileName = file.split('/').pop();
                return `${cdnBase}${fileName}`;
            }
        });

        faceDetection.setOptions({
            model: 'short',
            minDetectionConfidence: 0.5,
            selfieMode: true
        });

        faceDetection.onResults(this.onResults.bind(this));
        
        // Initialize the graph
        await faceDetection.initialize();
        
        this.faceDetector = faceDetection;
        this.isReady = true;
        log(1, 'INIT', 'Face Detection Ready');
      } catch (e) {
        console.error('[MotionController] Init failed', e);
      }
    })();

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
    }
    
    this.video = videoElement;
    this.isRunning = true;
    this.isStarted = true;
    this.isNoseDetected = false;

    // Reset state
    this.currentHeadX = 0.5;
    this.smoothedHeadY = 0.5;
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
          return;
      }

      this.isNoseDetected = true;
      const detection = results.detections[0];
      const bbox = detection.boundingBox; // { xCenter, yCenter, width, height }
      
      // Get Head Center (Note: MediaPipe Face Detection returns normalized coordinates 0-1)
      // xCenter: 0 (Left) -> 1 (Right). But for selfie camera, we want Mirror effect.
      // Physical Left -> Camera Right (High X) -> 1-X -> Low X (Left)
      const targetX = 1 - bbox.xCenter; 
      const targetY = bbox.yCenter;

      const now = performance.now();
      const elapsed = now - this.lastFrameTime;
      // Handle first frame delta
      const dtSec = elapsed > 0 ? elapsed / 1000 : 0.033;

      // --- 1. Update X (Horizontal) ---
      // Smooth interpolation
      this.currentHeadX = this.currentHeadX * 0.7 + targetX * 0.3;
      
      this.state.bodyX = this.currentHeadX;
      this.state.rawNoseX = this.currentHeadX;
      this.state.rawNoseY = targetY; // Direct mapping for visual feedback

      // Lane Logic
      let targetLane = 0;
      if (this.currentHeadX > (0.5 + this.xThreshold)) {
          targetLane = -1; // Left
      } else if (this.currentHeadX < (0.5 - this.xThreshold)) {
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
      const dy = this.smoothedHeadY - targetY;
      const velocity = dy / dtSec;
      
      // Update smoothed baseline (follow head slowly to adapt to height)
      this.smoothedHeadY = this.smoothedHeadY * 0.9 + targetY * 0.1;
      this.state.rawShoulderY = this.smoothedHeadY;

      // Jump Trigger
      // Velocity > 1.2 (Fast upward)
      // Displacement > 0.04 (Significant distance)
      if (velocity > 1.2 && dy > 0.04 && !this.state.isJumping) {
          if (now - this.lastJumpTime > this.JUMP_COOLDOWN) {
              log(1, 'JUMP', `Jump! Vel: ${velocity.toFixed(2)}, Dy: ${dy.toFixed(2)}`);
              this.state.isJumping = true;
              this.lastJumpTime = now;
              this.onMotionDetected?.('jump');
              
              setTimeout(() => { this.state.isJumping = false; }, 400);
          }
      }

      // --- 3. Sync Smoothed State ---
      if (!this.state.smoothedState) {
           this.state.smoothedState = { ...this.state };
      }
      
      this.state.smoothedState.bodyX = this.state.bodyX;
      this.state.smoothedState.rawNoseX = this.state.rawNoseX;
      this.state.smoothedState.rawNoseY = this.state.rawNoseY;
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
