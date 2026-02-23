export type CameraPlatform = 'ios' | 'android' | 'harmony' | 'desktop' | 'unknown';

export interface CameraPlatformInfo {
  platform: CameraPlatform;
  isTablet: boolean;
  isMobile: boolean;
}

export type CameraPipelineErrorCode =
  | 'CAMERA_API_MISSING'
  | 'CAMERA_PERMISSION_TIMEOUT'
  | 'CAMERA_LATE_STREAM_DISCARDED'
  | 'VIDEO_PLAY_FAILED'
  | 'VIDEO_STREAM_NOT_RENDERING';

export class CameraPipelineError extends Error {
  public readonly code: CameraPipelineErrorCode;

  constructor(code: CameraPipelineErrorCode, message: string) {
    super(message);
    this.name = 'CameraPipelineError';
    this.code = code;
  }
}

interface EnsureRenderableOptions {
  stage: string;
  metadataTimeoutMs?: number;
  playTimeoutMs?: number;
  frameTimeoutMs?: number;
  waitUnmuteMs?: number;
}

interface AcquireRenderableStreamOptions {
  videoElement: HTMLVideoElement;
  existingStream?: MediaStream | null;
  permissionTimeoutMs: number;
  renderRetryCount?: number;
}

type VideoElementWithFrameStats = HTMLVideoElement & {
  webkitDecodedFrameCount?: number;
};

type VideoFrameMetadataLike = {
  mediaTime?: number;
  presentedFrames?: number;
};

const TERMINAL_GET_USER_MEDIA_ERRORS = new Set([
  'NotAllowedError',
  'NotReadableError',
  'TrackStartError',
  'SecurityError',
  'AbortError',
  'InvalidStateError'
]);

const waitMs = (ms: number): Promise<void> => (
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  })
);

export const isCameraPipelineError = (value: unknown): value is CameraPipelineError => (
  value instanceof CameraPipelineError
);

export class CameraSessionManager {
  private acquireStreamInFlight: Promise<MediaStream> | null = null;

  public resolvePlatformInfo(): CameraPlatformInfo {
    const ua = navigator.userAgent;
    const isTouchMac = /Macintosh/i.test(ua) && 'ontouchend' in document;
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || isTouchMac;
    const isHarmony = /HarmonyOS|OpenHarmony|OHOS|HMOS|ArkWeb/i.test(ua);
    const isAndroid = /Android/i.test(ua) && !isHarmony;
    const isTablet = /iPad|Tablet/i.test(ua) || (isTouchMac && !/Mobile/i.test(ua));
    const isMobile = isIOS || isAndroid || isHarmony || /Mobile/i.test(ua);

    if (isIOS) return { platform: 'ios', isTablet, isMobile: true };
    if (isHarmony) return { platform: 'harmony', isTablet, isMobile: true };
    if (isAndroid) return { platform: 'android', isTablet, isMobile: true };
    if (!isMobile) return { platform: 'desktop', isTablet: false, isMobile: false };
    return { platform: 'unknown', isTablet, isMobile };
  }

  public getRenderRetryCount(platformInfo = this.resolvePlatformInfo()): number {
    return platformInfo.platform === 'ios' ? 3 : 1;
  }

  public buildConstraintProfiles(platformInfo = this.resolvePlatformInfo()): MediaTrackConstraints[] {
    if (platformInfo.platform === 'ios') {
      return [
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 960, max: 1280 },
          height: { ideal: 540, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        },
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 640, max: 960 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        },
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 }
        }
      ];
    }

    if (platformInfo.platform === 'android' || platformInfo.platform === 'harmony') {
      return [
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        },
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 960, max: 1280 },
          height: { ideal: 540, max: 720 },
          frameRate: { ideal: 20, max: 30 }
        },
        {
          facingMode: { ideal: 'user' }
        }
      ];
    }

    if (platformInfo.platform === 'desktop') {
      return [
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        },
        {
          facingMode: { ideal: 'user' },
          width: { ideal: 960, max: 1280 },
          height: { ideal: 540, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        }
      ];
    }

    return [
      {
        facingMode: { ideal: 'user' },
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 24, max: 30 }
      },
      {
        facingMode: { ideal: 'user' }
      }
    ];
  }

  public cleanupSession(videoElement: HTMLVideoElement | null, stream: MediaStream | null): void {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (!videoElement) return;
    this.detachVideoElement(videoElement, true);
  }

  public async acquireRenderableStream(options: AcquireRenderableStreamOptions): Promise<MediaStream> {
    if (this.acquireStreamInFlight) {
      return this.acquireStreamInFlight;
    }

    this.acquireStreamInFlight = this.acquireRenderableStreamInternal(options).finally(() => {
      this.acquireStreamInFlight = null;
    });

    return this.acquireStreamInFlight;
  }

  private async acquireRenderableStreamInternal(options: AcquireRenderableStreamOptions): Promise<MediaStream> {
    const {
      videoElement,
      existingStream,
      permissionTimeoutMs,
      renderRetryCount = this.getRenderRetryCount()
    } = options;
    const platformInfo = this.resolvePlatformInfo();
    const profiles = this.buildConstraintProfiles(platformInfo);
    await this.waitForStableCameraStartWindow(platformInfo);

    if (existingStream && existingStream.active) {
      try {
        await this.ensureRenderablePreviewWithRebind(videoElement, existingStream, {
          stage: 'reuse-existing-stream'
        });
        return existingStream;
      } catch (error) {
        console.warn('[Camera] Existing stream reuse failed, requesting fresh stream.', {
          error,
          tracks: this.getVideoTrackDiagnostics(existingStream)
        });
        existingStream.getTracks().forEach((track) => track.stop());
        this.detachVideoElement(videoElement, true);
      }
    }

    let lastRenderError: unknown = null;
    for (let attempt = 0; attempt <= renderRetryCount; attempt += 1) {
      const profileStartIndex = profiles.length > 0 ? attempt % profiles.length : 0;
      const stream = await this.requestCameraStreamWithTimeout(profiles, permissionTimeoutMs, profileStartIndex);
      try {
        if (platformInfo.platform === 'ios') {
          await this.waitForVideoElementVisible(videoElement, 1800, `fresh-stream-attempt-${attempt + 1}`);
          await this.ensureRenderablePreviewWithRebind(videoElement, stream, {
            stage: `fresh-stream-attempt-${attempt + 1}`
          });
        } else {
          await this.ensureStreamRenderableWithProbe(stream, {
            stage: `fresh-stream-attempt-${attempt + 1}`
          });
          await this.ensureRenderablePreviewWithRebind(videoElement, stream, {
            stage: `fresh-stream-attempt-${attempt + 1}:bind-preview`
          });
        }
        return stream;
      } catch (error) {
        lastRenderError = error;
        stream.getTracks().forEach((track) => track.stop());
        this.detachVideoElement(videoElement, true);

        const isRenderError =
          (error instanceof CameraPipelineError && error.code === 'VIDEO_STREAM_NOT_RENDERING') ||
          (error instanceof Error && error.message === 'VIDEO_STREAM_NOT_RENDERING');
        if (!isRenderError || attempt >= renderRetryCount) {
          throw error;
        }

        console.warn('[Camera] Stream not renderable, retrying with a fresh stream.', {
          attempt: attempt + 1,
          maxRetries: renderRetryCount + 1
        });

        // WebKit on iPad can return "live but muted forever" after interrupted sessions.
        // A short environment-camera kick often unsticks the media pipeline.
        if (platformInfo.platform === 'ios') {
          await this.performIosCameraKick();
        }
        await waitMs(platformInfo.platform === 'ios' ? 520 : 350);
      }
    }

    if (lastRenderError instanceof Error) {
      throw lastRenderError;
    }
    throw new CameraPipelineError('VIDEO_STREAM_NOT_RENDERING', 'Video stream is not renderable');
  }

  private async waitForStableCameraStartWindow(platformInfo: CameraPlatformInfo): Promise<void> {
    if (document.visibilityState !== 'visible') {
      const becameVisible = await new Promise<boolean>((resolve) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          document.removeEventListener('visibilitychange', onVisibilityChange);
          resolve(false);
        }, 1600);
        const onVisibilityChange = () => {
          if (settled || document.visibilityState !== 'visible') return;
          settled = true;
          window.clearTimeout(timeoutId);
          document.removeEventListener('visibilitychange', onVisibilityChange);
          resolve(true);
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
      });
      if (!becameVisible) {
        return;
      }
    }

    const waitReadyStateUntil = performance.now() + 1800;
    while (document.readyState === 'loading' && performance.now() < waitReadyStateUntil) {
      await waitMs(80);
    }

    if (platformInfo.platform === 'ios') {
      await waitMs(220);
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
    }
  }

  public async recoverForegroundPreview(videoElement: HTMLVideoElement, stream: MediaStream): Promise<void> {
    await this.waitForVideoElementVisible(videoElement, 1000, 'foreground-recover');
    await this.ensureRenderablePreviewWithRebind(videoElement, stream, {
      stage: 'foreground-recover',
      metadataTimeoutMs: 2200,
      playTimeoutMs: 3500,
      frameTimeoutMs: 2600,
      waitUnmuteMs: 2200
    });
  }

  public hasUsableLiveTrack(stream: MediaStream): boolean {
    return stream.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled);
  }

  public getVideoTrackDiagnostics(stream: MediaStream): Array<Record<string, unknown>> {
    return stream.getVideoTracks().map((track) => {
      let settings: MediaTrackSettings = {};
      try {
        settings = track.getSettings();
      } catch {
        settings = {};
      }
      return {
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        label: track.label,
        settings
      };
    });
  }

  private async requestCameraStreamWithTimeout(
    profiles: MediaTrackConstraints[],
    permissionTimeoutMs: number,
    profileStartIndex = 0
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new CameraPipelineError('CAMERA_API_MISSING', 'navigator.mediaDevices.getUserMedia is unavailable');
    }

    let shouldDiscardLateStream = false;
    const streamRequest = this.requestCameraStream(profiles, profileStartIndex).then((stream) => {
      if (shouldDiscardLateStream) {
        stream.getTracks().forEach((track) => track.stop());
        throw new CameraPipelineError('CAMERA_LATE_STREAM_DISCARDED', 'Late stream discarded after timeout');
      }
      return stream;
    });

    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<MediaStream>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new CameraPipelineError('CAMERA_PERMISSION_TIMEOUT', 'Camera permission request timeout'));
      }, permissionTimeoutMs);
    });

    try {
      return await Promise.race([streamRequest, timeoutPromise]);
    } catch (error) {
      if (isCameraPipelineError(error) && error.code === 'CAMERA_PERMISSION_TIMEOUT') {
        shouldDiscardLateStream = true;
      }
      throw error;
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  private async requestCameraStream(
    profiles: MediaTrackConstraints[],
    profileStartIndex: number
  ): Promise<MediaStream> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < profiles.length; attempt += 1) {
      const profileIndex = (profileStartIndex + attempt) % profiles.length;
      const constraints = profiles[profileIndex];
      try {
        return await navigator.mediaDevices.getUserMedia({ video: constraints });
      } catch (error) {
        lastError = error;
        const errorName = error instanceof DOMException ? error.name : '';
        console.warn('[Camera] getUserMedia attempt failed', {
          attempt: attempt + 1,
          totalAttempts: profiles.length,
          profileIndex: profileIndex + 1,
          errorName,
          constraints
        });
        if (TERMINAL_GET_USER_MEDIA_ERRORS.has(errorName)) {
          throw error;
        }
      }
    }

    try {
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (fallbackError) {
      throw fallbackError ?? lastError;
    }
  }

  private configureVideoElement(videoElement: HTMLVideoElement): void {
    videoElement.muted = true;
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.setAttribute('muted', 'true');
    videoElement.setAttribute('autoplay', 'true');
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('webkit-playsinline', 'true');
  }

  private detachVideoElement(videoElement: HTMLVideoElement, hardReset: boolean): void {
    try {
      videoElement.pause();
    } catch {
      // Ignore pause failure.
    }
    videoElement.srcObject = null;
    videoElement.removeAttribute('src');
    if (hardReset) {
      videoElement.load();
    }
  }

  private async ensureRenderablePreview(
    videoElement: HTMLVideoElement,
    stream: MediaStream,
    options: EnsureRenderableOptions
  ): Promise<void> {
    this.configureVideoElement(videoElement);
    if (videoElement.srcObject !== stream) {
      this.detachVideoElement(videoElement, true);
      videoElement.srcObject = stream;
    }

    const metadataTimeoutMs = options.metadataTimeoutMs ?? 4500;
    const metadataResult = await this.waitForVideoReadiness(videoElement, metadataTimeoutMs);
    if (metadataResult !== 'ready') {
      console.warn('[Camera] Video readiness check did not reach ready state before play()', {
        stage: options.stage,
        metadataResult,
        readyState: videoElement.readyState,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight
      });
      this.logVideoRenderDiagnostics(`${options.stage}:metadata-${metadataResult}`, videoElement, stream);
    }

    const waitUnmuteMs = options.waitUnmuteMs ?? 1800;
    const hasLiveUnmutedTrack = await this.waitForUnmutedLiveTrack(stream, waitUnmuteMs);
    if (!hasLiveUnmutedTrack) {
      console.warn('[Camera] Track remained muted before play(), continuing with frame probe.', {
        stage: options.stage,
        tracks: this.getVideoTrackDiagnostics(stream)
      });
    }

    const playTimeoutMs = options.playTimeoutMs ?? 4200;
    await this.playVideoWithTimeout(videoElement, stream, playTimeoutMs, options.stage);

    const frameTimeoutMs = options.frameTimeoutMs ?? 4200;
    const hasFrameProgress = await this.waitForFrameProgress(videoElement, stream, frameTimeoutMs);
    if (!hasFrameProgress) {
      this.logVideoRenderDiagnostics(`${options.stage}:frame-timeout`, videoElement, stream);
      throw new CameraPipelineError('VIDEO_STREAM_NOT_RENDERING', 'VIDEO_STREAM_NOT_RENDERING');
    }
  }

  private async ensureRenderablePreviewWithRebind(
    videoElement: HTMLVideoElement,
    stream: MediaStream,
    options: EnsureRenderableOptions
  ): Promise<void> {
    try {
      await this.ensureRenderablePreview(videoElement, stream, options);
    } catch (error) {
      const isRenderError =
        (error instanceof CameraPipelineError && error.code === 'VIDEO_STREAM_NOT_RENDERING') ||
        (error instanceof Error && error.message === 'VIDEO_STREAM_NOT_RENDERING');
      if (!isRenderError) {
        throw error;
      }

      console.warn('[Camera] Preview render probe failed, trying hard rebind once.', {
        stage: options.stage,
        tracks: this.getVideoTrackDiagnostics(stream)
      });

      this.detachVideoElement(videoElement, true);
      await waitMs(140);
      await this.ensureRenderablePreview(videoElement, stream, {
        ...options,
        stage: `${options.stage}:hard-rebind`
      });
    }
  }

  private async ensureStreamRenderableWithProbe(stream: MediaStream, options: EnsureRenderableOptions): Promise<void> {
    const probeVideo = document.createElement('video');
    this.configureVideoElement(probeVideo);
    probeVideo.style.position = 'fixed';
    probeVideo.style.width = '1px';
    probeVideo.style.height = '1px';
    probeVideo.style.opacity = '0';
    probeVideo.style.pointerEvents = 'none';
    probeVideo.style.left = '-9999px';
    probeVideo.style.top = '-9999px';
    document.body.appendChild(probeVideo);

    try {
      await this.ensureRenderablePreview(probeVideo, stream, {
        ...options,
        stage: `${options.stage}:probe`,
        metadataTimeoutMs: options.metadataTimeoutMs ?? 3200,
        playTimeoutMs: options.playTimeoutMs ?? 3600,
        frameTimeoutMs: options.frameTimeoutMs ?? 3600,
        waitUnmuteMs: options.waitUnmuteMs ?? 1800
      });
    } finally {
      this.detachVideoElement(probeVideo, true);
      if (probeVideo.parentNode) {
        probeVideo.parentNode.removeChild(probeVideo);
      }
    }
  }

  private async playVideoWithTimeout(
    videoElement: HTMLVideoElement,
    stream: MediaStream,
    timeoutMs: number,
    stage: string
  ): Promise<void> {
    const playPromise = videoElement.play();
    const playOutcome = await Promise.race<'played' | 'timeout'>([
      playPromise.then(() => 'played'),
      new Promise<'timeout'>((resolve) => {
        window.setTimeout(() => resolve('timeout'), timeoutMs);
      })
    ]).catch((playError: unknown) => {
      const playName = playError instanceof DOMException ? playError.name : 'UnknownError';
      const playMessage = playError instanceof Error ? playError.message : String(playError);
      throw new CameraPipelineError('VIDEO_PLAY_FAILED', `VIDEO_PLAY_FAILED:${playName}:${playMessage}`);
    });

    if (playOutcome === 'timeout') {
      const hasUsableVideoSize = videoElement.videoWidth > 0 && videoElement.videoHeight > 0;
      const hasLiveVideoTrack = stream.getVideoTracks().some((track) => track.readyState === 'live');
      if (!hasUsableVideoSize || !hasLiveVideoTrack) {
        this.logVideoRenderDiagnostics(`${stage}:play-timeout-no-size-or-track`, videoElement, stream);
        throw new CameraPipelineError('VIDEO_STREAM_NOT_RENDERING', 'VIDEO_STREAM_NOT_RENDERING');
      }
      console.warn('[Camera] video.play() timed out, probing for renderable frames...', {
        stage,
        readyState: videoElement.readyState,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        hasLiveVideoTrack,
        paused: videoElement.paused
      });
    }
  }

  private async waitForVideoReadiness(
    videoElement: HTMLVideoElement,
    timeoutMs: number
  ): Promise<'ready' | 'timeout' | 'error'> {
    return new Promise<'ready' | 'timeout' | 'error'>((resolve) => {
      if (videoElement.readyState >= 1 || (videoElement.videoWidth > 0 && videoElement.videoHeight > 0)) {
        resolve('ready');
        return;
      }

      let resolved = false;
      const checkReady = (): void => {
        if (resolved) return;
        if (videoElement.readyState >= 1 || (videoElement.videoWidth > 0 && videoElement.videoHeight > 0)) {
          resolved = true;
          cleanup();
          resolve('ready');
        }
      };

      const timeoutId = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve('timeout');
      }, timeoutMs);
      const pollId = window.setInterval(() => {
        checkReady();
      }, 120);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        window.clearInterval(pollId);
        videoElement.removeEventListener('loadedmetadata', onReady);
        videoElement.removeEventListener('loadeddata', onReady);
        videoElement.removeEventListener('canplay', onReady);
        videoElement.removeEventListener('playing', onReady);
        videoElement.removeEventListener('resize', onReady);
        videoElement.removeEventListener('error', onError);
      };

      const onReady = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve('ready');
      };

      const onError = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve('error');
      };

      videoElement.addEventListener('loadedmetadata', onReady, { once: true });
      videoElement.addEventListener('loadeddata', onReady, { once: true });
      videoElement.addEventListener('canplay', onReady, { once: true });
      videoElement.addEventListener('playing', onReady, { once: true });
      videoElement.addEventListener('resize', onReady, { once: true });
      videoElement.addEventListener('error', onError, { once: true });
    });
  }

  private async waitForVideoElementVisible(
    videoElement: HTMLVideoElement,
    timeoutMs: number,
    stage: string
  ): Promise<void> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (document.visibilityState !== 'visible') {
        await waitMs(80);
        continue;
      }

      const style = window.getComputedStyle(videoElement);
      const parent = videoElement.parentElement;
      const parentStyle = parent ? window.getComputedStyle(parent) : null;
      const rect = videoElement.getBoundingClientRect();
      const isVisible =
        videoElement.isConnected &&
        rect.width >= 24 &&
        rect.height >= 24 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.01 &&
        (!parentStyle ||
          (parentStyle.display !== 'none' &&
            parentStyle.visibility !== 'hidden' &&
            Number.parseFloat(parentStyle.opacity || '1') > 0.01));
      if (isVisible) {
        return;
      }

      await waitMs(80);
    }

    console.warn('[Camera] Video element visibility precheck timed out, proceeding.', {
      stage,
      isConnected: videoElement.isConnected,
      clientWidth: videoElement.clientWidth,
      clientHeight: videoElement.clientHeight,
      visibilityState: document.visibilityState
    });
  }

  private async waitForUnmutedLiveTrack(stream: MediaStream, timeoutMs: number): Promise<boolean> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      const hasUnmutedLiveTrack = stream
        .getVideoTracks()
        .some((track) => track.readyState === 'live' && track.enabled && !track.muted);
      if (hasUnmutedLiveTrack) {
        return true;
      }
      await waitMs(120);
    }
    return false;
  }

  private async waitForFrameProgress(
    videoElement: HTMLVideoElement,
    stream: MediaStream,
    maxWaitMs: number
  ): Promise<boolean> {
    const videoWithStats = videoElement as VideoElementWithFrameStats;
    const baselineCurrentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0;
    const baselineDecodedFrameCount =
      typeof videoWithStats.webkitDecodedFrameCount === 'number' ? videoWithStats.webkitDecodedFrameCount : 0;

    let callbackDisposed = false;
    let callbackHandle: number | null = null;
    let hasFrameCallbackMediaTimeProgress = false;
    let hasFrameCallbackPresentedFramesProgress = false;

    const scheduleFrameCallback = (): void => {
      if (typeof videoElement.requestVideoFrameCallback !== 'function') {
        return;
      }
      callbackHandle = videoElement.requestVideoFrameCallback((_, metadata: VideoFrameMetadataLike) => {
        if (callbackDisposed) return;
        if (typeof metadata.mediaTime === 'number' && metadata.mediaTime > baselineCurrentTime + 0.015) {
          hasFrameCallbackMediaTimeProgress = true;
        }
        if (typeof metadata.presentedFrames === 'number' && metadata.presentedFrames > 0) {
          hasFrameCallbackPresentedFramesProgress = true;
        }
        scheduleFrameCallback();
      });
    };

    scheduleFrameCallback();

    try {
      const startedAt = performance.now();
      while (performance.now() - startedAt < maxWaitMs) {
        const videoTracks = stream.getVideoTracks();
        const hasLiveTrack = videoTracks.some((track) => track.readyState === 'live' && track.enabled);
        const hasUsableVideoSize = videoElement.videoWidth > 0 && videoElement.videoHeight > 0;
        const isVideoElementActive = !videoElement.paused && !videoElement.ended;
        const currentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : baselineCurrentTime;
        const hasTimeProgressed = currentTime > baselineCurrentTime + 0.02;
        const decodedFrameCount =
          typeof videoWithStats.webkitDecodedFrameCount === 'number'
            ? videoWithStats.webkitDecodedFrameCount
            : baselineDecodedFrameCount;
        const hasDecodedFrameCountProgress = decodedFrameCount > baselineDecodedFrameCount;
        const hasFrameProgress =
          hasTimeProgressed ||
          hasDecodedFrameCountProgress ||
          hasFrameCallbackMediaTimeProgress ||
          hasFrameCallbackPresentedFramesProgress;

        if (
          hasLiveTrack &&
          hasUsableVideoSize &&
          isVideoElementActive &&
          hasFrameProgress
        ) {
          return true;
        }

        await waitMs(120);
      }
      return false;
    } finally {
      callbackDisposed = true;
      if (callbackHandle !== null && typeof videoElement.cancelVideoFrameCallback === 'function') {
        videoElement.cancelVideoFrameCallback(callbackHandle);
      }
    }
  }

  private async performIosCameraKick(): Promise<void> {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return;

    let probeStream: MediaStream | null = null;
    const probeVideo = document.createElement('video');
    this.configureVideoElement(probeVideo);

    try {
      probeStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 320, max: 640 },
          height: { ideal: 240, max: 480 },
          frameRate: { ideal: 20, max: 30 }
        }
      });
      probeVideo.srcObject = probeStream;
      await Promise.race([
        probeVideo.play().catch(() => undefined),
        waitMs(700)
      ]);
      await waitMs(120);
    } catch (error) {
      console.warn('[Camera] iOS camera kick skipped:', error);
    } finally {
      if (probeStream) {
        probeStream.getTracks().forEach((track) => track.stop());
      }
      this.detachVideoElement(probeVideo, false);
    }
  }

  private logVideoRenderDiagnostics(stage: string, videoElement: HTMLVideoElement, stream: MediaStream): void {
    const computedStyle = window.getComputedStyle(videoElement);
    const parentElement = videoElement.parentElement;
    const parentStyle = parentElement ? window.getComputedStyle(parentElement) : null;
    console.warn('[Camera] Preview diagnostics', {
      stage,
      paused: videoElement.paused,
      ended: videoElement.ended,
      muted: videoElement.muted,
      readyState: videoElement.readyState,
      networkState: videoElement.networkState,
      currentTime: videoElement.currentTime,
      videoWidth: videoElement.videoWidth,
      videoHeight: videoElement.videoHeight,
      clientWidth: videoElement.clientWidth,
      clientHeight: videoElement.clientHeight,
      isConnected: videoElement.isConnected,
      visibilityState: document.visibilityState,
      css: {
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        opacity: computedStyle.opacity
      },
      parentCss: parentStyle
        ? {
          display: parentStyle.display,
          visibility: parentStyle.visibility,
          opacity: parentStyle.opacity,
          overflow: parentStyle.overflow
        }
        : null,
      tracks: this.getVideoTrackDiagnostics(stream)
    });
  }
}
