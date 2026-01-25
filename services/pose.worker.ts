/// <reference lib="webworker" />

declare const self: DedicatedWorkerGlobalScope;
declare const Pose: any;

interface InitMessage {
  type: 'init';
  cdnUrl: string;
  config: {
    isIPad: boolean;
    isAndroid: boolean;
    isMobilePhone: boolean;
  };
}

interface FrameMessage {
  type: 'frame';
  image: ImageBitmap;
}

// Global error handlers to catch script errors and promise rejections
self.addEventListener('error', (event: ErrorEvent) => {
  const msg = event.message;
  const filename = event.filename;
  const lineno = event.lineno;
  console.error('[Worker Global Error]', msg, filename, lineno, event.error);
  self.postMessage({ 
    type: 'error', 
    error: `Worker Error: ${msg} (Line ${lineno})` 
  });
});

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[Worker Unhandled Rejection]', event.reason);
  self.postMessage({ 
    type: 'error', 
    error: `Unhandled Rejection: ${event.reason}` 
  });
});

self.onmessage = async (e: MessageEvent<InitMessage | FrameMessage>) => {
  if (e.data.type === 'init') {
    await init(e.data.cdnUrl, e.data.config);
  } else if (e.data.type === 'frame') {
    if (pose) {
      try {
        await pose.send({ image: e.data.image });
      } catch (err) {
        console.error('[Worker] Pose send error:', err);
      } finally {
        // Important: close the ImageBitmap to release memory
        e.data.image.close();
      }
    } else {
        e.data.image.close();
    }
  }
};

let pose: any = null;

async function init(cdnUrl: string, config: { isIPad: boolean; isAndroid: boolean; isMobilePhone: boolean }) {
  const baseUrl = cdnUrl.endsWith('/') ? cdnUrl : `${cdnUrl}/`;
  
  // Load the script
  try {
    // @ts-ignore
    self.importScripts(`${baseUrl}pose.js`);
  } catch (err) {
    console.error('[Worker] Failed to load pose.js', err);
    self.postMessage({ type: 'error', error: 'Failed to load pose.js' });
    return;
  }

  if (typeof Pose === 'undefined') {
    console.error('[Worker] Pose is undefined after importScripts');
    self.postMessage({ type: 'error', error: 'Pose undefined' });
    return;
  }

  pose = new Pose({
    locateFile: (file: string) => {
        // IPad fix from original code
        if (config.isIPad && file.startsWith('pose_solution_simd_wasm_bin')) {
            return `${baseUrl}${file.replace('pose_solution_simd_wasm_bin', 'pose_solution_wasm_bin')}`;
        }
        return `${baseUrl}${file}`;
    }
  });

  const minDetectionConf = (config.isIPad || config.isAndroid || config.isMobilePhone) ? 0.3 : 0.5;
  const minTrackingConf = (config.isIPad || config.isAndroid || config.isMobilePhone) ? 0.3 : 0.5;

  pose.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,
    minDetectionConfidence: minDetectionConf,
    minTrackingConfidence: minTrackingConf,
    selfieMode: false
  });

  pose.onResults((results: any) => {
    // We only need to send back the landmarks
    const simplifiedResults = {
        poseLandmarks: results.poseLandmarks
    };
    self.postMessage({ type: 'result', results: simplifiedResults });
  });

  // Prefetch dependencies
  await prefetchMediapipeDependencies(baseUrl);

  // Warmup
  const dummyCanvas = new OffscreenCanvas(64, 64);
  const ctx = dummyCanvas.getContext('2d');
  if (ctx) {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 64, 64);
      try {
        await pose.send({ image: dummyCanvas });
        self.postMessage({ type: 'ready' });
      } catch (e) {
          console.error('[Worker] Warmup failed', e);
      }
  } else {
      self.postMessage({ type: 'ready' });
  }
}

async function prefetchMediapipeDependencies(baseUrl: string): Promise<void> {
    const files = [
      'pose_solution_packed_assets_loader.js',
      'pose_solution_packed_assets.data',
      'pose_solution_simd_wasm_bin.js',
      'pose_solution_simd_wasm_bin.wasm',
      'pose_solution_wasm_bin.js',
      'pose_solution_wasm_bin.wasm'
    ];

    for (const file of files) {
      const url = `${baseUrl}${file}`;
      await prefetchBinary(url, 15000, 2);
    }
}

async function prefetchBinary(url: string, timeoutMs: number, retries: number): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(url, { mode: 'cors', cache: 'reload', signal: controller.signal });
        clearTimeout(timeoutId);

        if (!resp.ok) throw new Error(`Prefetch failed: ${resp.status}`);
        await resp.arrayBuffer();
        return;
      } catch (e) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
}
