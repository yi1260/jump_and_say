import { isThemePreloaded, preloadThemeImagesStrict } from '@/gameConfig';
import { getR2AssetUrl, getR2ThemesListCdnUrl, getR2ThemesListUrl } from '@/src/config/r2Config';
import { ThemeId } from '@/types';
import { motionController } from './motionController';

const GAME_ASSETS = [
  // Sounds
  'assets/kenney/Sounds/sfx_jump-high.mp3',
  'assets/kenney/Sounds/sfx_coin.mp3',
  'assets/kenney/Sounds/sfx_disappear.mp3',
  'assets/kenney/Sounds/sfx_bump.mp3',
  'assets/kenney/Sounds/funny-kids-video-322163.mp3',
  
  // SVGs
  'assets/kenney/Vector/Characters/character_pink_idle.svg',
  'assets/kenney/Vector/Characters/character_pink_jump.svg',
  'assets/kenney/Vector/Characters/character_pink_walk_a.svg',
  'assets/kenney/Vector/Characters/character_pink_walk_b.svg',
  'assets/kenney/Vector/Tiles/block_empty.svg',
  'assets/kenney/Vector/Enemies/bee_a.svg',
  'assets/kenney/Vector/Enemies/bee_b.svg',
  'assets/kenney/Vector/Tiles/star.svg',
  'assets/kenney/Vector/Backgrounds/background_clouds.svg',
  
  // Rewards & Icons (Moved from MainScene lazy load)
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

const PRELOAD_TIMEOUT = 15000; // 增加到 15 秒超时，允许更慢的网络拉取基础素材
const PRELOAD_RETRIES = 1;    // 基础素材失败后允许重试 1 次
let gameAssetsPreloaded = false;

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

const logAssetTiming = (label: string, url: string, durationMs: number) => {
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

export async function preloadAllGameAssets(
  selectedThemes: ThemeId[], 
  onProgress: (progress: number, status: string) => void
) {
  let loadedCount = 0;
  const firstThemeId = selectedThemes[0];
  const themeAlreadyPreloaded = firstThemeId ? isThemePreloaded(firstThemeId) : false;

  // Calculate total items
  // 1 (MediaPipe) + Game Assets + 1 (First Theme)
  const totalItems = 1 + GAME_ASSETS.length + 1;
  
  const updateProgress = (status: string) => {
    loadedCount++;
    const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
    onProgress(progress, status);
  };
  const updateStatus = (status: string) => {
    const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
    onProgress(progress, status);
  };

  try {
    // 1. Initialize MediaPipe (AI Models)
    onProgress(0, 'Initializing AI...');
    if (!motionController.isReady) {
      await motionController.init();
    }
    updateProgress('AI Ready');

    // 2. Preload Game Assets (Parallel)
    const assetPromises = gameAssetsPreloaded
      ? []
      : GAME_ASSETS.map(async (path) => {
          const url = getR2AssetUrl(path);
          
          const loadWithRetry = async (retriesLeft: number): Promise<void> => {
            try {
              const start = performance.now();
              if (path.endsWith('.mp3') || path.endsWith('.ogg')) {
                // Use fetch with AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), PRELOAD_TIMEOUT);
                
                try {
                  const response = await fetch(url, { signal: controller.signal });
                  clearTimeout(timeoutId);
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  await response.arrayBuffer();
                  logAssetTiming(path, url, performance.now() - start);
                } catch (err) {
                  clearTimeout(timeoutId);
                  throw err;
                }
              } else {
                // Use Image with explicit timeout
                await new Promise<void>((resolve, reject) => {
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  const timeoutId = setTimeout(() => {
                    img.src = ''; // 停止加载
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
              }
            } catch (e) {
              if (retriesLeft > 0) {
                console.warn(`Retrying ${path} (${retriesLeft} retries left)...`);
                return loadWithRetry(retriesLeft - 1);
              }
              throw e;
            }
          };

          try {
            await loadWithRetry(PRELOAD_RETRIES);
          } catch (e) {
            console.warn(`Failed to preload ${path} after retries`, e);
          }
          
          // Just increment count, don't update status text for every single file
          loadedCount++;
          const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
          onProgress(progress, 'Loading Game Assets...');
        });
    if (gameAssetsPreloaded) {
      loadedCount += GAME_ASSETS.length;
      const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
      onProgress(progress, 'Loading Game Assets...');
    }
    
    // 3. Preload Themes List JSON explicitly
    // This ensures themes-list.json is in the browser cache when Phaser requests it
    // although we plan to pass the data directly to Phaser to bypass the request entirely.
    // But it's good practice to have it cached anyway.
    const themesListPromise = (async () => {
         try {
             const fetchJson = async (url: string): Promise<void> => {
               const response = await fetch(url);
               if (!response.ok) throw new Error(`HTTP ${response.status}`);
               await response.json();
             };
             try {
               await fetchJson(getR2ThemesListUrl());
             } catch (localError) {
               console.warn('Failed to preload local themes-list.json, falling back to R2', localError);
               await fetchJson(getR2ThemesListCdnUrl());
             }
         } catch (e) {
             console.warn('Failed to preload themes-list.json', e);
         }
    })();

    // 4. Preload ONLY the First Theme's Images
    const themePromise = (async () => {
      if (firstThemeId) {
        if (themeAlreadyPreloaded) {
          loadedCount++;
          const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
          onProgress(progress, 'Theme Cached');
          return;
        }
        updateStatus('Loading Theme...');
        await preloadThemeImagesStrict(firstThemeId, updateStatus);
        updateProgress('Theme Ready');
      }
    })();

    await Promise.all([...assetPromises, themesListPromise, themePromise]);
    if (!gameAssetsPreloaded) {
      gameAssetsPreloaded = true;
    }
    
    onProgress(100, 'Ready!');
    
  } catch (error) {
    console.error('Asset loading failed:', error);
    throw error;
  }
}
