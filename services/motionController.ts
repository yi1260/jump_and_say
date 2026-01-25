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

/**
 * A lightweight pixel difference motion detector.
 * Detects center of motion to emulate body position.
 */
class PixelMotionProcessor {
    private canvas: OffscreenCanvas | HTMLCanvasElement;
    private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    private width = 64; // Low res for speed
    private height = 48;
    private backgroundData: Float32Array | null = null;
    
    // Config
    private readonly diffThreshold = 20; // Pixel diff threshold (0-255)
    private readonly motionThreshold = 5; // Minimum active pixels to trigger update
    private readonly learningRate = 0.025; // Slower adaptation to prevent "fading" when standing still
    
    // Persistence
    private lastValidX = 0.5;
    private lastValidY = 0.5;
    private lastValidTime = 0;
    private readonly persistenceDuration = 1500; // Hold position for 1.5s after motion stops

    constructor() {
        // Safe canvas creation
        try {
            if (typeof OffscreenCanvas !== 'undefined') {
                this.canvas = new OffscreenCanvas(this.width, this.height);
            } else {
                this.canvas = document.createElement('canvas');
                this.canvas.width = this.width;
                this.canvas.height = this.height;
            }
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as any;
        } catch (e) {
            console.error('[PixelMotion] Failed to create canvas context', e);
            this.canvas = document.createElement('canvas'); // Fallback
            this.ctx = null;
        }
    }

    process(video: HTMLVideoElement): { x: number, y: number, isMotion: boolean, debug?: any } | null {
        if (!this.ctx || video.videoWidth === 0) return null;

        try {
            // Draw current frame
            this.ctx.drawImage(video, 0, 0, this.width, this.height);
            const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
            const data = imageData.data;
            const len = data.length;

            // Init background if needed
            if (!this.backgroundData) {
                this.backgroundData = new Float32Array(len);
                for (let i = 0; i < len; i++) {
                    this.backgroundData[i] = data[i];
                }
                return { x: 0.5, y: 0.5, isMotion: false };
            }

            let sumX = 0;
            let sumY = 0;
            let count = 0;

            // Compare with background
            for (let i = 0; i < len; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                
                const bgR = this.backgroundData[i];
                const bgG = this.backgroundData[i+1];
                const bgB = this.backgroundData[i+2];

                // Diff
                const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
                
                // Threshold
                if (diff > this.diffThreshold * 3) { // *3 because we sum RGB
                    const idx = i / 4;
                    const x = idx % this.width;
                    const y = Math.floor(idx / this.width);
                    
                    sumX += x;
                    sumY += y;
                    count++;
                }

                // Update background (Running Average)
                // Use a slower learning rate to keep the background stable
                this.backgroundData[i] = bgR * (1 - this.learningRate) + r * this.learningRate;
                this.backgroundData[i+1] = bgG * (1 - this.learningRate) + g * this.learningRate;
                this.backgroundData[i+2] = bgB * (1 - this.learningRate) + b * this.learningRate;
            }

            const now = performance.now();

            if (count < this.motionThreshold) {
                // If no motion, hold position for a while (persistence)
                if (now - this.lastValidTime < this.persistenceDuration) {
                    return { x: this.lastValidX, y: this.lastValidY, isMotion: true };
                }
                return { x: 0.5, y: 0.5, isMotion: false };
            }

            const centerX = (sumX / count) / this.width;
            const centerY = (sumY / count) / this.height;

            // Mirror X for selfie view
            // Physical Left -> Camera Right (High X) -> 1-X -> Low X (Left)
            const finalX = 1 - centerX;
            const finalY = centerY;

            // Update persistence
            this.lastValidX = finalX;
            this.lastValidY = finalY;
            this.lastValidTime = now;

            return { x: finalX, y: finalY, isMotion: true }; 
        } catch (e) {
            console.warn("Pixel process error", e);
            return null;
        }
    }
}

export class MotionController {
  private video: HTMLVideoElement | null = null;
  private isRunning: boolean = false;
  private requestRef: number | null = null;
  private lastFrameTime: number = 0;
  private readonly TARGET_FPS = 30;
  private readonly FRAME_MIN_TIME = 1000 / 30;

  // Thresholds for Pixel Motion
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
  public isNoseDetected: boolean = true; // Always true for pixel motion once started
  public onMotionDetected: ((type: 'jump' | 'move') => void) | null = null;

  private initPromise: Promise<void> | null = null;
  
  private pixelProcessor: PixelMotionProcessor | null = null;
  
  private currentBodyX: number = 0.5;
  private smoothedShoulderY: number = 0.5;
  
  // Jump Logic
  private lastJumpTime: number = 0;
  private readonly JUMP_COOLDOWN = 600;

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      log(1, 'INIT', 'Initializing Pixel Motion Controller...');
      try {
        this.pixelProcessor = new PixelMotionProcessor();
        this.isReady = true;
        log(1, 'INIT', 'Pixel Motion Ready');
      } catch (e) {
        console.error('[MotionController] Init failed', e);
        // Still set ready to true to prevent blocking, but functionality will be impaired
        this.isReady = true; 
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
    
    if (!this.pixelProcessor) {
        await this.init();
    }
    
    this.video = videoElement;
    this.isRunning = true;
    this.isStarted = true;
    this.isNoseDetected = true; 

    // Reset state
    this.currentBodyX = 0.5;
    this.smoothedShoulderY = 0.5;
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
    if (this.requestRef) cancelAnimationFrame(this.requestRef);
  }

  // No-op for compatibility
  calibrate() {}
  getCalibrationProgress() { return 1; }
  isCalibrating() { return false; }

  private async processFrame() {
    if (!this.isRunning || !this.video || !this.pixelProcessor) return;

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= this.FRAME_MIN_TIME) {
        // --- 1. Process Motion ---
        const result = this.pixelProcessor.process(this.video);
        
        if (result && result.isMotion) {
            const targetX = result.x;
            const targetY = result.y;

            // --- 2. Update X (Horizontal) ---
            // Smooth interpolation (0.7/0.3 is responsive but smooth)
            this.currentBodyX = this.currentBodyX * 0.7 + targetX * 0.3;
            
            // Map to State
            this.state.bodyX = this.currentBodyX;
            this.state.rawNoseX = this.currentBodyX; // Map centroid X to nose X for Red Ball
            this.state.rawNoseY = targetY;           // Map centroid Y to nose Y for Red Ball

            // Lane Logic
            let targetLane = 0;
            if (this.currentBodyX > (0.5 + this.xThreshold)) {
                targetLane = -1; // Left
            } else if (this.currentBodyX < (0.5 - this.xThreshold)) {
                targetLane = 1;  // Right
            } else {
                targetLane = 0;  // Center
            }

            if (this.state.x !== targetLane) {
                // log(0, 'MOVE', `Lane: ${targetLane} (X: ${this.currentBodyX.toFixed(2)})`);
                this.onMotionDetected?.('move');
            }
            this.state.x = targetLane;

            // --- 3. Update Y (Jump) ---
            // Calculate velocity (Up is negative Y in pixels, so Old - New is positive up)
            const dy = this.smoothedShoulderY - targetY;
            const dtSec = elapsed / 1000;
            const velocity = dy / (dtSec > 0 ? dtSec : 0.033); 
            
            // Update smoothed baseline
            this.smoothedShoulderY = this.smoothedShoulderY * 0.8 + targetY * 0.2;
            this.state.rawShoulderY = this.smoothedShoulderY;

            // Jump Trigger
            // Relaxed Thresholds: Vel > 0.5, dy > 0.03
            if (velocity > 0.5 && dy > 0.03 && !this.state.isJumping) {
                if (now - this.lastJumpTime > this.JUMP_COOLDOWN) {
                    log(1, 'JUMP', `Jump Detected! Vel: ${velocity.toFixed(2)}, Dy: ${dy.toFixed(2)}`);
                    this.state.isJumping = true;
                    this.lastJumpTime = now;
                    this.onMotionDetected?.('jump');
                    
                    // Auto-reset jump state
                    setTimeout(() => { this.state.isJumping = false; }, 400);
                }
            }
        } 

        // --- 4. Sync Smoothed State ---
        // Ensure sub-object exists
        if (!this.state.smoothedState) {
             this.state.smoothedState = { ...this.state };
        }
        
        // Always sync the latest calculation to smoothedState
        // MainScene uses smoothedState for smooth rendering
        this.state.smoothedState.bodyX = this.state.bodyX;
        this.state.smoothedState.rawNoseX = this.state.rawNoseX;
        this.state.smoothedState.rawNoseY = this.state.rawNoseY;
        this.state.smoothedState.x = this.state.x;
        this.state.smoothedState.isJumping = this.state.isJumping;
        
        // Link the top-level property for compatibility
        this.smoothedState = this.state.smoothedState;

        this.lastFrameTime = now;
    }

    if (this.isRunning) {
      this.requestRef = requestAnimationFrame(() => this.processFrame());
    }
  }
}

export const motionController = new MotionController();
