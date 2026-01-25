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
 * Uses Selective Background Update to solve "Static User Disappearing".
 * Uses Head-biased Centroid for better L/R control.
 */
class PixelMotionProcessor {
    private canvas: OffscreenCanvas | HTMLCanvasElement;
    private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    private width = 64; // Low res for speed
    private height = 48;
    private backgroundData: Float32Array | null = null;
    
    // Config
    private readonly diffThreshold = 20; // Lowered to catch more motion
    private readonly motionThreshold = 8; // Pixels required
    private readonly learningRate = 0.05; // Base learning rate
    
    // Persistence
    private lastResult: { x: number, y: number, minY: number } | null = null;

    constructor() {
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

    process(video: HTMLVideoElement): { 
        x: number, 
        y: number, 
        isMotion: boolean, 
        minY: number 
    } | null {
        if (!this.ctx || video.videoWidth === 0) return null;

        try {
            this.ctx.drawImage(video, 0, 0, this.width, this.height);
            const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
            const data = imageData.data;
            const len = data.length;

            if (!this.backgroundData) {
                this.backgroundData = new Float32Array(len);
                for (let i = 0; i < len; i++) {
                    this.backgroundData[i] = data[i];
                }
                return { x: 0.5, y: 0.5, isMotion: false, minY: 1.0 };
            }

            let sumX = 0;
            let count = 0;
            
            // For Head Tracking (Top 20 pixels)
            const foregroundPixels: {x: number, y: number}[] = [];

            for (let i = 0; i < len; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                
                const bgR = this.backgroundData[i];
                const bgG = this.backgroundData[i+1];
                const bgB = this.backgroundData[i+2];

                const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
                
                // Selective Update Logic
                if (diff > this.diffThreshold * 3) {
                    // FOREGROUND (User)
                    // Update background VERY slowly to prevent user from fading into background
                    // but allow some adaptation for lighting changes
                    const slowRate = this.learningRate * 0.05; 
                    this.backgroundData[i] = bgR * (1 - slowRate) + r * slowRate;
                    this.backgroundData[i+1] = bgG * (1 - slowRate) + g * slowRate;
                    this.backgroundData[i+2] = bgB * (1 - slowRate) + b * slowRate;

                    const idx = i / 4;
                    const x = idx % this.width;
                    const y = Math.floor(idx / this.width);
                    
                    // Store for analysis
                    foregroundPixels.push({x, y});
                    
                    sumX += x;
                    count++;
                } else {
                    // BACKGROUND
                    // Update normally to adapt to lighting/camera noise
                    this.backgroundData[i] = bgR * (1 - this.learningRate) + r * this.learningRate;
                    this.backgroundData[i+1] = bgG * (1 - this.learningRate) + g * this.learningRate;
                    this.backgroundData[i+2] = bgB * (1 - this.learningRate) + b * this.learningRate;
                }
            }

            if (count < this.motionThreshold) {
                // Persistence: If motion stops, assume user is still there (just still)
                if (this.lastResult) {
                    return { ...this.lastResult, isMotion: true };
                }
                return { x: 0.5, y: 0.5, isMotion: false, minY: 1.0 };
            }

            // --- Advanced Centroid Logic ---
            // We want to favor the "Head" position for X control, as it leans more than the feet.
            // 1. Sort pixels by Y (ascending, 0 is top)
            foregroundPixels.sort((a, b) => a.y - b.y);
            
            // 2. Take top 20% pixels (Head area)
            const topCount = Math.max(1, Math.floor(count * 0.2));
            let headSumX = 0;
            let headMinY = this.height;
            
            for(let i=0; i<topCount; i++) {
                headSumX += foregroundPixels[i].x;
                if (foregroundPixels[i].y < headMinY) headMinY = foregroundPixels[i].y;
            }
            
            const headX = (headSumX / topCount) / this.width;
            const bodyX = (sumX / count) / this.width; // General center of mass
            
            // Weighted X: 70% Head, 30% Body
            // This makes it responsive to leaning
            const weightedX = headX * 0.7 + bodyX * 0.3;
            
            // Mirror X (Camera Left is Screen Right)
            const finalX = 1 - weightedX;
            const normMinY = headMinY / this.height;

            const result = { 
                x: finalX, 
                y: 0.5, 
                isMotion: true,
                minY: normMinY
            };
            
            this.lastResult = result;
            return result;
            
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
  private readonly FRAME_MIN_TIME = 1000 / 30;

  // Thresholds
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
  public isNoseDetected: boolean = true;
  public onMotionDetected: ((type: 'jump' | 'move') => void) | null = null;

  private initPromise: Promise<void> | null = null;
  private pixelProcessor: PixelMotionProcessor | null = null;
  
  // Smoothing vars
  private currentBodyX: number = 0.5;
  private smoothedMinY: number = 0.5;
  
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
    this.smoothedMinY = 0.5;
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
            const targetMinY = result.minY;

            // --- 2. Update X (Horizontal) ---
            // Use faster smoothing for responsiveness
            this.currentBodyX = this.currentBodyX * 0.7 + targetX * 0.3;
            
            // Map to State
            this.state.bodyX = this.currentBodyX;
            this.state.rawNoseX = this.currentBodyX; // Visual feedback
            
            // For Y visual, we show the "Top" of the motion blob (Head)
            // But we smooth it heavily for display to avoid flicker
            this.state.rawNoseY = this.state.rawNoseY * 0.8 + targetMinY * 0.2; 

            // Lane Logic
            let targetLane = 0;
            if (this.currentBodyX > (0.5 + this.xThreshold)) {
                targetLane = -1; // Left (Screen Left / Lane -1)
            } else if (this.currentBodyX < (0.5 - this.xThreshold)) {
                targetLane = 1;  // Right (Screen Right / Lane 1)
            } else {
                targetLane = 0;  // Center
            }
            
            if (this.state.x !== targetLane) {
                this.onMotionDetected?.('move');
            }
            this.state.x = targetLane;

            // --- 3. Update Y (Jump) ---
            // Jump Logic: Detect rapid UPWARD movement of the TOP EDGE (minY)
            // Lower Y value = Higher on screen
            
            // Calculate velocity of the top edge
            // Positive Velocity = Moving UP (Old Y > New Y)
            const dy = this.smoothedMinY - targetMinY; 
            const dtSec = elapsed / 1000;
            const velocity = dy / (dtSec > 0 ? dtSec : 0.033); 
            
            // Update smoothed baseline (follow the head slowly)
            this.smoothedMinY = this.smoothedMinY * 0.9 + targetMinY * 0.1;
            this.state.rawShoulderY = this.smoothedMinY;

            // Jump Trigger
            // Increased Thresholds significantly to prevent false positives
            // Velocity > 2.0 (Fast)
            // Displacement > 0.08 (Big move)
            if (velocity > 2.0 && dy > 0.08 && !this.state.isJumping) {
                if (now - this.lastJumpTime > this.JUMP_COOLDOWN) {
                    log(1, 'JUMP', `Jump! Vel: ${velocity.toFixed(2)}, Dy: ${dy.toFixed(2)}`);
                    this.state.isJumping = true;
                    this.lastJumpTime = now;
                    this.onMotionDetected?.('jump');
                    
                    setTimeout(() => { this.state.isJumping = false; }, 400);
                }
            }
        } 

        // --- 4. Sync Smoothed State ---
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

    if (this.isRunning) {
      this.requestRef = requestAnimationFrame(() => this.processFrame());
    }
  }
}

export const motionController = new MotionController();
