import { isThemePreloaded, preloadThemeImagesStrict } from '@/gameConfig';
import { getR2AssetUrl, getThemesListFallbackUrl, getThemesListPrimaryUrl } from '@/src/config/r2Config';
import { ThemeId } from '@/types';
import { motionController } from './motionController';

const GAME_ASSETS = [
  'assets/kenney/Sounds/sfx_jump-high.mp3',
  'assets/kenney/Sounds/sfx_coin.mp3',
  'assets/kenney/Sounds/sfx_disappear.mp3',
  'assets/kenney/Sounds/sfx_bump.mp3',
  'assets/kenney/Sounds/funny-kids-video-322163.mp3',
  'assets/kenney/Sounds/perfect.mp3',
  'assets/kenney/Sounds/super.mp3',
  'assets/kenney/Sounds/great.mp3',
  'assets/kenney/Sounds/amazing.mp3',
  'assets/kenney/Sounds/awesome.mp3',
  'assets/kenney/Sounds/excellent.mp3',
  'assets/kenney/Vector/Characters/character_pink_idle.svg',
  'assets/kenney/Vector/Characters/character_pink_jump.svg',
  'assets/kenney/Vector/Characters/character_pink_walk_a.svg',
  'assets/kenney/Vector/Characters/character_pink_walk_b.svg',
  'assets/kenney/Vector/Tiles/block_empty.svg',
  'assets/kenney/Vector/Enemies/bee_a.svg',
  'assets/kenney/Vector/Enemies/bee_b.svg',
  'assets/kenney/Vector/Tiles/star.svg',
  'assets/kenney/Vector/Backgrounds/background_clouds.svg',
  'assets/kenney/Vector/Tiles/mushroom_red.svg',
  'assets/kenney/Vector/Tiles/mushroom_brown.svg',
  'assets/kenney/Vector/Tiles/gem_blue.svg',
  'assets/kenney/Vector/Tiles/gem_red.svg',
  'assets/kenney/Vector/Tiles/gem_green.svg',
  'assets/kenney/Vector/Tiles/gem_yellow.svg',
  'assets/kenney/Vector/Tiles/grass.svg',
  'assets/kenney/Vector/Tiles/grass_purple.svg',
  'assets/kenney/Vector/Tiles/replay_256dp.svg',
  'assets/kenney/Vector/Tiles/keyboard_double_arrow_right_256dp.svg'
];

const PRELOAD_TIMEOUT = 20000;
const PRELOAD_RETRIES = 2;
const THEMES_LIST_TIMEOUT = 20000;
const THEMES_LIST_RETRIES = 3;
let gameAssetsPreloaded = false;
let themesListPreloaded = false;

const getLastResourceTiming = (url: string): PerformanceResourceTiming | null => {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') return null;
  const entries = performance.getEntriesByName(url);
  if (!entries || entries.length === 0) return null;
  const entry = entries[entries.length - 1];
  if ('transferSize' in entry) {
    return entry as PerformanceResourceTiming;
  }
  return null;
};

const inferCacheLabel = (timing: PerformanceResourceTiming | null, durationMs: number): string => {
  if (timing) {
    if (timing.transferSize === 0 && timing.decodedBodySize > 0) return 'CACHE (transferSize=0)';
    if (timing.transferSize > 0) return 'NETWORK';
  }
  if (durationMs < 50) return 'CACHE (heuristic<50ms)';
  return 'UNKNOWN';
};

const logAssetTiming = (label: string, url: string, durationMs: number): void => {
  const timing = getLastResourceTiming(url);
  const cacheLabel = inferCacheLabel(timing, durationMs);
  if (timing) {
    console.log(
      `[AssetTiming] ${label} ${durationMs.toFixed(1)}ms [${cacheLabel}]`,
      { url, transferSize: timing.transferSize, encodedBodySize: timing.encodedBodySize, decodedBodySize: timing.decodedBodySize }
    );
  } else {
    console.log(
      `[AssetTiming] ${label} ${durationMs.toFixed(1)}ms [${cacheLabel}]`,
      { url }
    );
  }
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const sleep = (ms: number): Promise<void> => (
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  })
);

const preloadSingleGameAsset = async (path: string): Promise<void> => {
  const url = getR2AssetUrl(path);

  const loadWithRetry = async (retriesLeft: number): Promise<void> => {
    try {
      const start = performance.now();
      if (path.endsWith('.mp3') || path.endsWith('.ogg')) {
        const response = await fetchWithTimeout(url, PRELOAD_TIMEOUT);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.arrayBuffer();
        logAssetTiming(path, url, performance.now() - start);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeoutId = window.setTimeout(() => {
          img.src = '';
          reject(new Error('Timeout'));
        }, PRELOAD_TIMEOUT);

        img.onload = () => {
          clearTimeout(timeoutId);
          logAssetTiming(path, url, performance.now() - start);
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeoutId);
          reject(new Error('Load error'));
        };
        img.src = url;
      });
    } catch (error) {
      if (retriesLeft > 0) {
        const retryDelayMs = (PRELOAD_RETRIES - retriesLeft + 1) * 800;
        console.warn(`Retrying ${path} (${retriesLeft} retries left) in ${retryDelayMs}ms...`);
        await sleep(retryDelayMs);
        return loadWithRetry(retriesLeft - 1);
      }
      throw error;
    }
  };

  await loadWithRetry(PRELOAD_RETRIES);
};

const preloadThemesListJson = async (): Promise<void> => {
  if (themesListPreloaded) return;

  const fetchJsonWithRetry = async (url: string): Promise<void> => {
    let attempt = 0;
    while (attempt < THEMES_LIST_RETRIES) {
      attempt += 1;
      try {
        const response = await fetchWithTimeout(url, THEMES_LIST_TIMEOUT);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json();
        return;
      } catch (error) {
        if (attempt >= THEMES_LIST_RETRIES) {
          throw error;
        }
        const delayMs = attempt * 1200;
        console.warn(`[AssetLoader] themes-list request failed, retrying ${attempt}/${THEMES_LIST_RETRIES}: ${url}`, {
          error,
          delayMs
        });
        await sleep(delayMs);
      }
    }
  };

  try {
    await fetchJsonWithRetry(getThemesListPrimaryUrl());
    themesListPreloaded = true;
  } catch (primaryError) {
    console.warn('Failed to preload themes-list from CDN, falling back to local', primaryError);
    await fetchJsonWithRetry(getThemesListFallbackUrl());
    themesListPreloaded = true;
  }
};

const loadCoreAssetsInLoadingPhase = async (onAssetSettled?: () => void): Promise<void> => {
  if (!motionController.isReady) {
    await motionController.init();
  }

  if (!gameAssetsPreloaded) {
    const CONCURRENCY = 2;
    for (let i = 0; i < GAME_ASSETS.length; i += CONCURRENCY) {
      const batch = GAME_ASSETS.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (path) => {
          try {
            await preloadSingleGameAsset(path);
          } catch (error) {
            console.warn(`Failed to preload ${path} after retries`, error);
          } finally {
            onAssetSettled?.();
          }
        })
      );
    }
    gameAssetsPreloaded = true;
  } else if (onAssetSettled) {
    for (let i = 0; i < GAME_ASSETS.length; i += 1) {
      onAssetSettled();
    }
  }

  try {
    await preloadThemesListJson();
  } catch (error) {
    console.warn('Failed to preload themes-list.json', error);
  }
};

export async function preloadAllGameAssets(
  selectedThemes: ThemeId[],
  onProgress: (progress: number, status: string) => void
): Promise<void> {
  let loadedCount = 0;
  const firstThemeId = selectedThemes[0];
  const themeAlreadyPreloaded = firstThemeId ? isThemePreloaded(firstThemeId) : false;
  const totalItems = 1 + GAME_ASSETS.length + 1;

  const updateProgress = (status: string): void => {
    loadedCount += 1;
    const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
    onProgress(progress, status);
  };

  const updateStatus = (status: string): void => {
    const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
    onProgress(progress, status);
  };

  try {
    onProgress(0, '正在启动识别引擎...');
    await loadCoreAssetsInLoadingPhase(() => {
      loadedCount += 1;
      const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
      onProgress(progress, '正在加载游戏资源...');
    });
    updateProgress('识别引擎已就绪');

    const themePromise = (async () => {
      if (!firstThemeId) return;

      if (themeAlreadyPreloaded) {
        loadedCount += 1;
        const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
        onProgress(progress, '题目图片已缓存');
        return;
      }

      updateStatus('正在准备题目图片...');
      // First theme must be fully prepared before leaving loading phase.
      // Otherwise MainScene will fall back to in-scene loading and cause visible delay.
      await preloadThemeImagesStrict(firstThemeId, updateStatus);
      updateProgress('题目图片准备完成');
    })();

    await themePromise;
    onProgress(100, '加载完成');
  } catch (error) {
    console.error('Asset loading failed:', error);
    throw error;
  }
}
