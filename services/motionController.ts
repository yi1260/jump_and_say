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
  private missedDetections: number = 0;
  private readonly MAX_MISSED_DETECTIONS = 12;

  // Thresholds for Face Motion
  // X: 0.5 is center. > 0.62 is Right, < 0.38 is Left. (Modified for better sensitivity)
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
  public isNoseDetected: boolean = false;
  public onMotionDetected: ((type: 'jump' | 'move') => void) | null = null;

  private initPromise: Promise<void> | null = null;
  
  // Smoothing vars
  private currentHeadX: number = 0.5;
  private smoothedHeadY: number = 0.5;
  private smoothedNoseX: number = 0.5;
  private smoothedNoseY: number = 0.5;
  private smoothedFaceCenterX: number = 0.5;
  private smoothedFaceCenterY: number = 0.5;
  private smoothedFaceWidth: number = 0.18;
  private smoothedFaceHeight: number = 0.24;
  private smoothedFaceSize: number = 0;
  private jumpCandidateFrames: number = 0;
  private jumpArmed: boolean = true;
  
  // Optical Flow vars
  private prevFrameData: Uint8ClampedArray | null = null;
  private opticalFlowY: number = 0;
  private opticalFlowCanvas: HTMLCanvasElement | null = null;
  private opticalFlowContext: CanvasRenderingContext2D | null = null;

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
        model: 'full',
        minDetectionConfidence: 0.4,
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
          'face_detection_full_range.tflite'
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
    this.missedDetections = 0;

    // Reset state
    this.currentHeadX = 0.5;
    this.smoothedHeadY = 0.5;
    this.smoothedNoseX = 0.5;
    this.smoothedNoseY = 0.5;
    this.smoothedFaceCenterX = 0.5;
    this.smoothedFaceCenterY = 0.5;
    this.smoothedFaceWidth = 0.18;
    this.smoothedFaceHeight = 0.24;
    this.smoothedFaceSize = 0;
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

  // Calculate simple optical flow for vertical movement
  private calculateOpticalFlow(video: HTMLVideoElement, bbox: any) {
    if (!this.opticalFlowCanvas) {
        this.opticalFlowCanvas = document.createElement('canvas');
        this.opticalFlowCanvas.width = 64; // Small resolution for performance
        this.opticalFlowCanvas.height = 48;
        this.opticalFlowContext = this.opticalFlowCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!this.opticalFlowContext) return 0;

    // Draw current frame to small canvas
    this.opticalFlowContext.drawImage(video, 0, 0, 64, 48);
    const frameData = this.opticalFlowContext.getImageData(0, 0, 64, 48).data;

    let totalDy = 0;
    let validPoints = 0;

    if (this.prevFrameData) {
        // Calculate vertical flow only in the center region (where the person is likely to be)
        // Skip edges to avoid background noise
        const width = 64;
        const height = 48;
        const marginX = 16;
        const marginY = 8;
        
        // Simple block matching or brightness difference gradient
        // Here we use a very simplified gradient approach:
        // If pixel(x, y) is similar to pixel(x, y+1) in prev frame -> moving up
        
        // Actually, a simpler approach for "Jump" detection in games:
        // Just check if the whole image shifted up.
        // We compare row R in current frame with row R+1 in prev frame.
        
        // Let's implement a sparse Lucas-Kanade like check on a grid
        const step = 4;
        for (let y = marginY; y < height - marginY - step; y += step) {
            for (let x = marginX; x < width - marginX; x += step) {
                const idx = (y * width + x) * 4;
                const brightness = (frameData[idx] + frameData[idx+1] + frameData[idx+2]) / 3;
                
                // Search for best match in vertical neighborhood in previous frame
                let bestDy = 0;
                let minDiff = 255;
                
                // Search range: -4 to +4 pixels vertically
                for (let dy = -4; dy <= 4; dy++) {
                    const searchY = y + dy;
                    if (searchY < 0 || searchY >= height) continue;
                    
                    const prevIdx = (searchY * width + x) * 4;
                    const prevBrightness = (this.prevFrameData[prevIdx] + this.prevFrameData[prevIdx+1] + this.prevFrameData[prevIdx+2]) / 3;
                    
                    const diff = Math.abs(brightness - prevBrightness);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestDy = dy;
                    }
                }
                
                // If we found a good match
                if (minDiff < 30) {
                   // If best match in prev frame was at y+dy, it means pixels moved by -dy
                   // Example: Current pixel at Y=10 matches Prev pixel at Y=12 (dy=2)
                   // It means the object moved UP by 2 pixels (from 12 to 10)
                   // So movement is -bestDy
                   totalDy += (-bestDy);
                   validPoints++;
                }
            }
        }
    }

    // Store for next frame
    this.prevFrameData = new Uint8ClampedArray(frameData);

    return validPoints > 0 ? totalDy / validPoints : 0;
  }

  private onResults(results: any) {
      const now = performance.now();
      if (!results.detections || results.detections.length === 0) {
          this.missedDetections += 1;
          this.jumpCandidateFrames = 0;
          if (this.missedDetections > this.MAX_MISSED_DETECTIONS) {
              this.isNoseDetected = false;
          }
          return;
      }

      this.isNoseDetected = true;
      this.missedDetections = 0;
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
      const rawFaceCenterX = typeof bbox?.xCenter === 'number' ? bbox.xCenter : rawFaceX;
      const rawFaceCenterY = typeof bbox?.yCenter === 'number' ? bbox.yCenter : rawFaceY;
      const rawFaceWidth = typeof bbox?.width === 'number' ? bbox.width : 0.18;
      const rawFaceHeight = typeof bbox?.height === 'number' ? bbox.height : 0.24;
      const mirroredX = 1 - rawFaceX;

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

      // Standard face width ~0.18 in normalized coords
      const refFaceWidth = 0.18;
      const currentFaceWidth = typeof bbox?.width === 'number' ? bbox.width : 0.15;
      // Clamp scale factor between 0.2 (far) and 1.2 (near)
      // Allow it to go lower (0.2) to support further distances (e.g. 3-4 meters)
      const scaleFactor = Math.min(1.2, Math.max(0.2, currentFaceWidth / refFaceWidth));

      // --- 1. Update X (Horizontal) ---
      // Smooth interpolation: 60% old, 40% new for better responsiveness
      // Reduced smoothing from 0.7 to 0.6 to reduce latency
      this.currentHeadX = this.currentHeadX * 0.6 + mirroredX * 0.4;
      
      this.state.bodyX = this.currentHeadX;
      this.state.rawNoseX = rawFaceX;
      this.state.rawNoseY = rawFaceY;
      this.state.rawFaceX = rawFaceCenterX;
      this.state.rawFaceY = rawFaceCenterY;
      this.state.rawFaceWidth = rawFaceWidth;
      this.state.rawFaceHeight = rawFaceHeight;
      this.smoothedNoseX = this.smoothedNoseX * (1 - noseAlpha) + rawFaceX * noseAlpha;
      this.smoothedNoseY = this.smoothedNoseY * (1 - noseAlpha) + rawFaceY * noseAlpha;
      this.smoothedFaceCenterX = this.smoothedFaceCenterX * (1 - noseAlpha) + rawFaceCenterX * noseAlpha;
      this.smoothedFaceCenterY = this.smoothedFaceCenterY * (1 - noseAlpha) + rawFaceCenterY * noseAlpha;
      this.smoothedFaceWidth = this.smoothedFaceWidth * (1 - noseAlpha) + rawFaceWidth * noseAlpha;
      this.smoothedFaceHeight = this.smoothedFaceHeight * (1 - noseAlpha) + rawFaceHeight * noseAlpha;

      // Lane Logic
      // Scale threshold with distance. If far (scale < 1), threshold reduces.
      // Base threshold 0.12 * scaleFactor
      const dynamicXThreshold = Math.max(0.04, this.xThreshold * scaleFactor);
      
      let targetLane = 0;
      if (this.currentHeadX < (0.5 - dynamicXThreshold)) {
          targetLane = -1; // Left
      } else if (this.currentHeadX > (0.5 + dynamicXThreshold)) {
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

      // Optical Flow Check
      // Calculate optical flow movement (positive = UP)
      // This runs on every frame but only when results are available to save power
      const opticalFlowMovement = this.video ? this.calculateOpticalFlow(this.video, bbox) : 0;
      // Smooth the flow value
      this.opticalFlowY = this.opticalFlowY * 0.5 + opticalFlowMovement * 0.5;

      // Jump Trigger
      // Velocity > 1.2 (Fast upward)
      // Displacement > 0.04 (Significant distance)
      
      const velocityThreshold = 2.4 * scaleFactor;
      const displacementThreshold = 0.09 * scaleFactor;

      // Robustness Improvements:
      // 1. Stricter Size Stability: Reduced from 0.35 to 0.25 to prevent false positives during fast forward/backward movement
      // 2. Forward Movement Suppression: If face is significantly larger than smoothed average (>15%) AND moving up, 
      //    it's likely the user zooming in (perspective shift), not jumping.
      // 3. Optical Flow Confirmation: Require at least some upward pixel movement (> 0.2 pixels avg) to confirm jump
      
      const isZoomingIn = faceSize > this.smoothedFaceSize * 1.15;
      const isMovingUp = dy > 0;
      const isOpticalFlowUp = this.opticalFlowY > 0.2; // Threshold for upward pixel movement
      
      // Only allow jump if size is stable AND we are not just zooming in AND optical flow agrees (or is neutral)
      if (faceSizeRatio < 0.25 && !(isZoomingIn && isMovingUp)) {
          if (!this.jumpArmed && dy < 0.02 * scaleFactor) {
              this.jumpArmed = true;
          }
          
          // Primary check: Face velocity & displacement
          const isFaceJump = velocity > velocityThreshold && dy > displacementThreshold;
          
          // Secondary check: Optical flow must NOT be strongly downward (which would contradict upward face movement)
          // Ideally it should be positive. We accept it if it's > 0.2
          const isFlowValid = isOpticalFlowUp;
          
          // Combine checks:
          // We trust Face Detection mostly, but use Optical Flow to VETO false positives.
          // However, if Face Detection is VERY strong (velocity > threshold * 1.5), we might skip flow check to be responsive.
          // But for now, let's require flow confirmation to solve the "leaning forward" issue.
          // When leaning forward, face moves UP in frame, but shoulders/body might not move much or move forward.
          // Optical flow on the whole frame (mostly body) should reflect the true motion.
          
          const isCandidate = isFaceJump && isFlowValid;

          this.jumpCandidateFrames = isCandidate ? Math.min(4, this.jumpCandidateFrames + 1) : Math.max(0, this.jumpCandidateFrames - 1);
          if (this.jumpArmed && this.jumpCandidateFrames >= 3 && !this.state.isJumping && now - this.lastJumpTime > this.JUMP_COOLDOWN) {
              log(1, 'JUMP', `Jump! Vel: ${velocity.toFixed(2)}, Dy: ${dy.toFixed(2)}, Flow: ${this.opticalFlowY.toFixed(2)}`);
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
      this.state.smoothedState.rawFaceX = this.smoothedFaceCenterX;
      this.state.smoothedState.rawFaceY = this.smoothedFaceCenterY;
      this.state.smoothedState.rawFaceWidth = this.smoothedFaceWidth;
      this.state.smoothedState.rawFaceHeight = this.smoothedFaceHeight;
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
