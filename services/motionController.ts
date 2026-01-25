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
 * Uses Zone-based detection for X-axis stability.
 * Uses Top-Edge tracking for Jump detection.
 */
class PixelMotionProcessor {
    private canvas: OffscreenCanvas | HTMLCanvasElement;
    private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    private width = 64; // Low res for speed
    private height = 48;
    private backgroundData: Float32Array | null = null;
    
    // Config
    private readonly diffThreshold = 30; // Increased threshold to reduce noise (20 -> 30)
    private readonly motionThreshold = 10; // Increased pixel count required (5 -> 10)
    private readonly learningRate = 0.05; // Slightly faster adaptation to handle lighting changes

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
        minY: number, 
        leftMass: number, 
        rightMass: number,
        centerMass: number 
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
                return { x: 0.5, y: 0.5, isMotion: false, minY: 1.0, leftMass: 0, rightMass: 0, centerMass: 0 };
            }

            let leftMass = 0;
            let centerMass = 0;
            let rightMass = 0;
            let minY = this.height;
            let count = 0;

            const leftBoundary = Math.floor(this.width * 0.33);
            const rightBoundary = Math.floor(this.width * 0.66);

            for (let i = 0; i < len; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                
                const bgR = this.backgroundData[i];
                const bgG = this.backgroundData[i+1];
                const bgB = this.backgroundData[i+2];

                const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
                
                if (diff > this.diffThreshold * 3) {
                    const idx = i / 4;
                    const x = idx % this.width;
                    const y = Math.floor(idx / this.width);
                    
                    // Count mass in zones
                    // Mirror X for logic (Camera Left is Screen Right)
                    // But here we process raw camera pixels.
                    // Camera: Left side of image -> User's Right hand (in mirror) -> Screen Right
                    // Camera: Right side of image -> User's Left hand -> Screen Left
                    
                    // Let's count in Camera coordinates first
                    if (x < leftBoundary) rightMass++; // Camera Left = Screen Right
                    else if (x > rightBoundary) leftMass++; // Camera Right = Screen Left
                    else centerMass++;

                    if (y < minY) minY = y;
                    
                    count++;
                }

                // Update background
                this.backgroundData[i] = bgR * (1 - this.learningRate) + r * this.learningRate;
                this.backgroundData[i+1] = bgG * (1 - this.learningRate) + g * this.learningRate;
                this.backgroundData[i+2] = bgB * (1 - this.learningRate) + b * this.learningRate;
            }

            if (count < this.motionThreshold) {
                return { x: 0.5, y: 0.5, isMotion: false, minY: 1.0, leftMass: 0, rightMass: 0, centerMass: 0 };
            }

            // Normalize minY
            const normMinY = minY / this.height;
            
            // Determine X based on Mass Balance
            let finalX = 0.5;
            const totalMass = leftMass + centerMass + rightMass;
            
            // If significant mass on one side
            if (leftMass > totalMass * 0.4 && leftMass > rightMass * 1.5) {
                finalX = 0.2; // Left Lane
            } else if (rightMass > totalMass * 0.4 && rightMass > leftMass * 1.5) {
                finalX = 0.8; // Right Lane
            } else {
                finalX = 0.5; // Center Lane
            }

            return { 
                x: finalX, 
                y: 0.5, // Not used for X-logic anymore
                isMotion: true,
                minY: normMinY,
                leftMass,
                rightMass,
                centerMass
            }; 
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
  private xThreshold: number = 0.15; 
  
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
  private readonly JUMP_COOLDOWN = 800; // Increased cooldown

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
            this.currentBodyX = this.currentBodyX * 0.6 + targetX * 0.4;
            
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
                // Note: Game logic maps Lane -1 to Left
            } else if (this.currentBodyX < (0.5 - this.xThreshold)) {
                targetLane = 1;  // Right (Screen Right / Lane 1)
            } else {
                targetLane = 0;  // Center
            }
            
            // Fix Lane Mapping: 
            // In Game: 0=Left, 1=Center, 2=Right (Indices)
            // In Controller: -1=Left, 0=Center, 1=Right
            // Wait, let's check MainScene.ts usage.
            // MainScene uses: if (bodyX < POS_TO_LEFT) return 0; (Left)
            // bodyX is 0..1. 0 is Left.
            // currentBodyX: 0.2 (Left), 0.5 (Center), 0.8 (Right)
            // So my targetX assignments above (0.2, 0.8) are correct.

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
            // Requirements:
            // 1. Velocity > 1.5 (Fast upward movement)
            // 2. Displacement > 0.05 (Significant distance)
            // 3. Current Head is high enough (targetMinY < 0.4)? No, maybe user is short.
            if (velocity > 1.5 && dy > 0.05 && !this.state.isJumping) {
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
