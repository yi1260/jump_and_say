import { getR2ImageUrl, getR2ThemesListCdnUrl, getR2ThemesListUrl, handleR2Error } from '@/src/config/r2Config';
import { Theme, ThemeList } from './types';

let cachedThemes: Theme[] | null = null;
const preloadedThemeIds = new Set<string>();
const preloadedCoverUrls = new Set<string>();
const failedCoverUrls = new Set<string>();
const coverPreloadInFlight = new Map<string, Promise<void>>();
const preloadedThemeAudioBlobUrls = new Map<string, string>();
const preloadedThemeAudioBlobOrder: string[] = [];
const MAX_PRELOADED_THEME_AUDIO_BLOBS = 48;
type PreloadAssetType = 'image' | 'audio';
type ThemePreloadQueueItem = { url: string; themeId: string; type: PreloadAssetType };
const THEMES_LIST_TIMEOUT_MS = 20000;
const THEMES_LIST_MAX_RETRIES = 3;
const THEMES_LIST_RETRY_DELAY_MS = 1500;
const COVER_PRELOAD_TIMEOUT_MS = 12000;
const COVER_PRELOAD_MAX_RETRIES = 2;
const COVER_PRELOAD_CONCURRENCY = 6;

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

const logThemeTiming = (label: string, url: string, durationMs: number) => {
  const timing = getLastResourceTiming(url);
  const cacheLabel = inferCacheLabel(timing, durationMs);
  if (timing) {
    console.log(
      `[ThemeTiming] ${label} ${durationMs.toFixed(1)}ms [${cacheLabel}]`,
      { url, transferSize: timing.transferSize, encodedBodySize: timing.encodedBodySize, decodedBodySize: timing.decodedBodySize }
    );
  } else {
    console.log(`[ThemeTiming] ${label} ${durationMs.toFixed(1)}ms [${cacheLabel}]`, { url });
  }
};

const sleep = (ms: number): Promise<void> => (
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  })
);

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'default' });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchThemesListWithRetry = async (url: string): Promise<ThemeList> => {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < THEMES_LIST_MAX_RETRIES) {
    attempt += 1;
    try {
      const response = await fetchWithTimeout(url, THEMES_LIST_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as ThemeList;
    } catch (error) {
      lastError = error;
      if (attempt >= THEMES_LIST_MAX_RETRIES) {
        break;
      }
      const delayMs = THEMES_LIST_RETRY_DELAY_MS * attempt;
      console.warn(`[Themes] Request failed, retrying ${attempt}/${THEMES_LIST_MAX_RETRIES}: ${url}`, {
        error,
        delayMs
      });
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? new Error(`[Themes] Failed after retries: ${url}. ${lastError.message}`)
    : new Error(`[Themes] Failed after retries: ${url}`);
};

const inferAudioMimeType = (url: string): string => {
  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.mp3')) return 'audio/mpeg';
  if (cleanUrl.endsWith('.wav')) return 'audio/wav';
  if (cleanUrl.endsWith('.ogg')) return 'audio/ogg';
  if (cleanUrl.endsWith('.m4a')) return 'audio/mp4';
  return 'application/octet-stream';
};

export function getCachedThemes(): Theme[] | null {
  return cachedThemes;
}

export function getPreloadedThemeAudioBlobUrl(sourceUrl: string): string | null {
  return preloadedThemeAudioBlobUrls.get(sourceUrl) || null;
}

export function isThemePreloaded(themeId: string): boolean {
  return preloadedThemeIds.has(themeId);
}

export async function loadThemes(): Promise<Theme[]> {
  if (cachedThemes) {
    return cachedThemes;
  }

  try {
    let themeList: ThemeList | null = null;
    try {
      themeList = await fetchThemesListWithRetry(getR2ThemesListUrl());
    } catch (localError) {
      console.warn('[loadThemes] Local themes-list failed, falling back to R2 CDN', localError);
      themeList = await fetchThemesListWithRetry(getR2ThemesListCdnUrl());
    }

    // Flatten themes from levels structure
    const allThemes: Theme[] = [];
    
    if (themeList.levels) {
      Object.entries(themeList.levels).forEach(([level, levelData]) => {
        if (levelData?.themes) {
          levelData.themes.forEach(theme => {
            allThemes.push({
              ...theme,
              level,
              isAvailable: theme.questions && theme.questions.length > 0
            });
          });
        }
      });
    } else if ((themeList as any).themes) {
      // Backward compatibility for old structure
      const oldThemes = (themeList as any).themes as Theme[];
      allThemes.push(...oldThemes.map(theme => ({
        ...theme,
        isAvailable: theme.questions && theme.questions.length > 0
      })));
    }

    const themesWithAvailability = allThemes;

    // Sort themes alphabetically by name
    themesWithAvailability.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    cachedThemes = themesWithAvailability;

    return themesWithAvailability;
  } catch (error) {
    handleR2Error(error, 'Error loading themes');
  }
}

/**
 * Global background preloading queue management
 */
let globalPreloadQueue: ThemePreloadQueueItem[] = [];
let isPreloadingActive = false;
let isHighPriorityLoading = false; // Flag to pause background preloading (for priority loads)
let isBackgroundPaused = false;    // Flag to pause background preloading (for gameplay)
const MAX_CONCURRENT_DOWNLOADS = 6;
let activeDownloads = 0;

const getThemeImageUrl = (imagePath: string): string => {
  const imageName = imagePath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
  return getR2ImageUrl(imageName);
};

const getThemeAudioUrl = (audioPath: string): string => getR2ImageUrl(audioPath);

const collectThemeAssetItems = (theme: Theme): Array<{ type: PreloadAssetType; url: string; label: string }> => {
  const items: Array<{ type: PreloadAssetType; url: string; label: string }> = [];
  theme.questions.forEach((question, index) => {
    items.push({
      type: 'image',
      url: getThemeImageUrl(question.image),
      label: `${index + 1}/${theme.questions.length} image`
    });
    if (question.audio) {
      items.push({
        type: 'audio',
        url: getThemeAudioUrl(question.audio),
        label: `${index + 1}/${theme.questions.length} audio`
      });
    }
  });
  return items;
};

export function pauseBackgroundPreloading() {
  if (!isBackgroundPaused) {
    isBackgroundPaused = true;
    isPreloadingActive = false;
    console.log('[Preloader] Background preloading paused for gameplay');
  }
}

export function resumeBackgroundPreloading() {
  if (isBackgroundPaused) {
    isBackgroundPaused = false;
    console.log('[Preloader] Background preloading resumed');
    if (globalPreloadQueue.length > 0) {
      processPreloadQueue();
    }
  }
}

export function startBackgroundPreloading(themes: Theme[]) {
  // Flatten all images from all themes into a queue
  // We skip the first theme as it's likely being loaded by the game scene directly
  // or will be prioritized if requested
  globalPreloadQueue = [];
  
  themes.forEach((theme) => {
    // Skip checking for icon.png as it doesn't exist in the themes list
    // and causes 404 errors
    
    if (theme.questions) {
      theme.questions.forEach(q => {
        globalPreloadQueue.push({
          url: getThemeImageUrl(q.image),
          themeId: theme.id,
          type: 'image'
        });
        if (q.audio) {
          globalPreloadQueue.push({
            url: getThemeAudioUrl(q.audio),
            themeId: theme.id,
            type: 'audio'
          });
        }
      });
    }
  });

  if (!isPreloadingActive) {
    const start = () => processPreloadQueue();
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(start);
    } else {
      setTimeout(start, 3000);
    }
  }
}

/**
 * Preload theme cover images for smoother theme selection rendering.
 * This is intentionally fire-and-forget and does not affect game flow.
 */
const loadCoverWithRetry = async (coverUrl: string): Promise<void> => {
  let attempt = 0;
  while (attempt <= COVER_PRELOAD_MAX_RETRIES) {
    attempt += 1;
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timeoutId = window.setTimeout(() => {
          img.src = '';
          reject(new Error('Timeout'));
        }, COVER_PRELOAD_TIMEOUT_MS);

        img.onload = () => {
          clearTimeout(timeoutId);
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeoutId);
          reject(new Error('Load error'));
        };
        img.src = coverUrl;
      });
      preloadedCoverUrls.add(coverUrl);
      return;
    } catch (error) {
      if (attempt > COVER_PRELOAD_MAX_RETRIES) {
        throw error;
      }
      const delayMs = 500 * attempt;
      await sleep(delayMs);
    }
  }
};

export function isCoverPreloaded(coverUrl: string): boolean {
  return preloadedCoverUrls.has(coverUrl);
}

export function isCoverFailed(coverUrl: string): boolean {
  return failedCoverUrls.has(coverUrl);
}

export function markCoverPreloaded(coverUrl: string): void {
  preloadedCoverUrls.add(coverUrl);
  failedCoverUrls.delete(coverUrl);
}

export function markCoverFailed(coverUrl: string): void {
  failedCoverUrls.add(coverUrl);
  coverPreloadInFlight.delete(coverUrl);
}

export function preloadCoverUrl(coverUrl: string): Promise<void> {
  if (preloadedCoverUrls.has(coverUrl)) {
    return Promise.resolve();
  }
  if (failedCoverUrls.has(coverUrl)) {
    return Promise.resolve();
  }

  const inFlight = coverPreloadInFlight.get(coverUrl);
  if (inFlight) {
    return inFlight;
  }

  const preloadPromise = loadCoverWithRetry(coverUrl)
    .then(() => {
      preloadedCoverUrls.add(coverUrl);
      failedCoverUrls.delete(coverUrl);
    })
    .catch((error: unknown) => {
      failedCoverUrls.add(coverUrl);
      throw error;
    })
    .finally(() => {
      coverPreloadInFlight.delete(coverUrl);
    });

  coverPreloadInFlight.set(coverUrl, preloadPromise);
  return preloadPromise;
}

export function preloadCoverImages(themes: Theme[]): void {
  const coverUrls = themes
    .map((theme: Theme) => theme.cover)
    .filter((coverPath: string | undefined): coverPath is string => Boolean(coverPath))
    .map((coverPath: string) => getR2ImageUrl(coverPath))
    .filter((coverUrl: string) => !preloadedCoverUrls.has(coverUrl))
    .filter((coverUrl: string) => !failedCoverUrls.has(coverUrl));

  if (coverUrls.length === 0) {
    return;
  }

  void (async () => {
    for (let i = 0; i < coverUrls.length; i += COVER_PRELOAD_CONCURRENCY) {
      const batch = coverUrls.slice(i, i + COVER_PRELOAD_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (coverUrl: string) => {
          try {
            await preloadCoverUrl(coverUrl);
          } catch (_error) {}
        })
      );
    }
  })();
}

/**
 * Prioritize a specific theme in the background preload queue
 * Moves its images to the front of the queue
 */
export function prioritizeThemeInQueue(themeId: string) {
  // Find items for this theme in the queue
  const items = globalPreloadQueue.filter(item => item.themeId === themeId);
  
  if (items.length === 0) return; // Already processed or not found

  // Remove them from current position
  globalPreloadQueue = globalPreloadQueue.filter(item => item.themeId !== themeId);
  
  // Add them to the front
  globalPreloadQueue.unshift(...items);
  
  console.log(`[Preloader] Prioritized ${items.length} assets for theme: ${themeId}`);

  // If not active, start processing
  if (!isPreloadingActive) {
    processPreloadQueue();
  }
}

function processPreloadQueue() {
  if (isHighPriorityLoading || isBackgroundPaused) {
    // Pause background loading if high priority loading is active OR gameplay is active
    isPreloadingActive = false;
    return;
  }

  if (globalPreloadQueue.length === 0) {
    isPreloadingActive = false;
    console.log('[Preloader] All background assets preloaded');
    return;
  }

  isPreloadingActive = true;

  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && globalPreloadQueue.length > 0) {
    // Double check flag inside loop
    if (isHighPriorityLoading || isBackgroundPaused) {
      isPreloadingActive = false;
      return;
    }

    const item = globalPreloadQueue.shift();
    if (item) {
      activeDownloads++;
      preloadSingleAsset(item.url, item.type).finally(() => {
        activeDownloads--;
        processPreloadQueue();
      });
    }
  }
}

function preloadSingleAsset(url: string, type: PreloadAssetType, retries = 0): Promise<void> {
  if (type === 'audio') {
    return preloadSingleAudio(url, retries);
  }
  return preloadSingleImage(url, retries);
}

function preloadSingleAudio(url: string, retries = 0): Promise<void> {
  return new Promise((resolve) => {
    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(() => resolve())
      .catch(() => {
        if (retries < 1) {
          setTimeout(() => {
            preloadSingleAudio(url, retries + 1).then(resolve);
          }, 1000);
        } else {
          resolve();
        }
      });
  });
}

function preloadSingleImage(url: string, retries = 0): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve();
    img.onerror = () => {
      // Silently fail for background preloads to avoid console spam
      // But retry once if it's a network error
      if (retries < 1) {
          setTimeout(() => {
              preloadSingleImage(url, retries + 1).then(resolve);
          }, 1000);
      } else {
          resolve(); 
      }
    };
    img.src = url;
  });
}


/**
 * Pre-load all images for a specific theme
 * Returns a promise that resolves when all images are loaded
 */
export async function preloadThemeImages(themeId: string): Promise<void> {
  if (!cachedThemes) {
    await loadThemes();
  }
  
  const theme = cachedThemes?.find(t => t.id === themeId);
  if (!theme || !theme.questions) {
    console.warn(`[preloadThemeImages] Theme not found or has no questions: ${themeId}`);
    return;
  }

  // PAUSE background preloading
  isHighPriorityLoading = true;

  // Remove this theme assets from queue since we are loading them now
  const themeAssets = collectThemeAssetItems(theme);
  const themeUrls = new Set(themeAssets.map(asset => asset.url));
  globalPreloadQueue = globalPreloadQueue.filter(item => !themeUrls.has(item.url));
  
  console.log(`[preloadThemeImages] Preloading ${themeAssets.length} assets for theme: ${themeId}. (Background active downloads: ${activeDownloads})`);
  const startTime = performance.now();

  // Use a batch processing approach to avoid overwhelming the browser/network
  const BATCH_SIZE = 4;
  const assets = themeAssets;
  
  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const batch = assets.slice(i, i + BATCH_SIZE);
    const batchStartTime = performance.now();
    console.log(`[preloadThemeImages] Starting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(assets.length / BATCH_SIZE)} (Items ${i + 1}-${Math.min(i + BATCH_SIZE, assets.length)})`);
    
    const batchPromises = batch.map((asset, batchIndex) => {
      const globalIndex = i + batchIndex;
          const assetStartTime = performance.now();
          const assetUrl = asset.url;
          const assetType = asset.type;
          const label = `${assetType}:${asset.label}`;

      const loadWithRetry = (retriesLeft: number): Promise<void> => {
        return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              const duration = (performance.now() - assetStartTime).toFixed(2);
              console.warn(`[preloadThemeImages] ❌ Timeout loading: ${label} (${globalIndex + 1}/${assets.length}) - ${duration}ms. Retries left: ${retriesLeft}`);
              
              if (retriesLeft > 0) {
                  console.log(`[preloadThemeImages] 🔄 Retrying: ${label}`);
                  resolve(loadWithRetry(retriesLeft - 1));
              } else {
                  resolve();
              }
            }, 15000);
            
            const onSuccess = () => {
              clearTimeout(timeout);
              const duration = (performance.now() - assetStartTime).toFixed(2);
              const isFastLoad = parseFloat(duration) < 50;
              const sourceLabel = isFastLoad ? '📦 CACHE (Likely)' : '🌐 CDN';
              console.log(`[preloadThemeImages] ✅ Loaded: ${label} (${globalIndex + 1}/${assets.length}) - ${duration}ms [${sourceLabel}]`);
              logThemeTiming(`[preloadThemeImages] ${label} (${globalIndex + 1}/${assets.length})`, assetUrl, parseFloat(duration));
              resolve();
            };

            const onError = (e: unknown) => {
              clearTimeout(timeout);
              const duration = (performance.now() - assetStartTime).toFixed(2);
              console.warn(`[preloadThemeImages] ❌ Failed to preload: ${label} - ${duration}ms (URL: ${assetUrl})`);
              
              if (retriesLeft > 0) {
                  console.log(`[preloadThemeImages] 🔄 Retrying after error: ${label}`);
                  setTimeout(() => {
                      resolve(loadWithRetry(retriesLeft - 1));
                  }, 500);
              } else {
                  console.warn(`[preloadThemeImages] Failure details: URL=${assetUrl}`, e);
                  resolve();
              }
            };

            try {
              console.log(`[preloadThemeImages] ⏳ Requesting: ${label} (${globalIndex + 1}/${assets.length}) [CDN]`);
              if (assetType === 'audio') {
                fetch(assetUrl)
                  .then((response) => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.arrayBuffer();
                  })
                  .then(onSuccess)
                  .catch(onError);
              } else {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = onSuccess;
                img.onerror = onError;
                img.src = assetUrl;
              }
            } catch (err) {
              console.warn(`[preloadThemeImages] Error requesting asset:`, err);
              clearTimeout(timeout);
              resolve();
            }
          });
      };

      return loadWithRetry(1); // Try once, then retry once (total 2 attempts), then fallback
    });

    try {
      // Wait for the current batch to finish before starting the next one
      await Promise.allSettled(batchPromises);
      const batchDuration = (performance.now() - batchStartTime).toFixed(2);
      console.log(`[preloadThemeImages] Batch ${Math.floor(i / BATCH_SIZE) + 1} completed in ${batchDuration}ms`);
    } catch (error) {
      console.error(`[preloadThemeImages] Error processing batch starting at ${i}:`, error);
    }
  }

  const totalDuration = (performance.now() - startTime).toFixed(2);
  console.log(`[preloadThemeImages] Preloading completed for theme: ${themeId} in ${totalDuration}ms`);
  
  // RESUME background preloading
  isHighPriorityLoading = false;
  // Restart queue processing if there are items left
  if (globalPreloadQueue.length > 0) {
      processPreloadQueue();
  }
}

export async function preloadThemeImagesStrict(
  themeId: string,
  onStatus?: (status: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  if (preloadedThemeIds.has(themeId)) {
    console.log(`[preloadThemeImagesStrict] Theme already preloaded, skipping: ${themeId}`);
    return;
  }
  if (!cachedThemes) {
    await loadThemes();
  }

  const theme = cachedThemes?.find(t => t.id === themeId);
  if (!theme || !theme.questions || theme.questions.length === 0) {
    throw new Error(`[preloadThemeImagesStrict] Theme not found or has no questions: ${themeId}`);
  }

  isHighPriorityLoading = true;
  let completed = false;

  const themeAssets = collectThemeAssetItems(theme);
  const themeUrls = new Set(themeAssets.map(asset => asset.url));
  globalPreloadQueue = globalPreloadQueue.filter(item => !themeUrls.has(item.url));

  console.log(`[preloadThemeImagesStrict] Preloading ${themeAssets.length} assets for theme: ${themeId}`);

  const BATCH_SIZE = 4;
  const RETRY_DELAY_MS = 1500;
  const TIMEOUT_MS = 30000;
  const MAX_RETRIES = 6;
  const throwIfAborted = (): void => {
    if (abortSignal?.aborted) {
      throw new Error('THEME_PRELOAD_ABORTED');
    }
  };

  const sleepWithAbort = async (ms: number): Promise<void> => {
    if (!abortSignal) {
      await sleep(ms);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timeoutId);
        abortSignal.removeEventListener('abort', onAbort);
        reject(new Error('THEME_PRELOAD_ABORTED'));
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const getCdnLabel = (imgUrl: string): string => {
    try {
      return new URL(imgUrl).origin;
    } catch {
      return imgUrl;
    }
  };

  const loadWithRetryLimited = async (assetUrl: string, label: string, assetType: PreloadAssetType): Promise<void> => {
    const cdnLabel = getCdnLabel(assetUrl);
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      attempt += 1;
      try {
        throwIfAborted();
        const start = performance.now();
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let timeoutId: number | null = null;
          let abortHandler: (() => void) | null = null;
          let audioController: AbortController | null = null;
          const cleanup = () => {
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
            }
            if (abortSignal && abortHandler) {
              abortSignal.removeEventListener('abort', abortHandler);
            }
          };
          const finishResolve = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          };
          const finishReject = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };

          if (abortSignal) {
            abortHandler = () => {
              if (audioController) {
                audioController.abort();
              }
              finishReject(new Error('THEME_PRELOAD_ABORTED'));
            };
            if (abortSignal.aborted) {
              abortHandler();
              return;
            }
            abortSignal.addEventListener('abort', abortHandler, { once: true });
          }

          if (assetType === 'audio') {
            audioController = new AbortController();
            timeoutId = window.setTimeout(() => {
              audioController?.abort();
              finishReject(new Error('Timeout'));
            }, TIMEOUT_MS);

            fetch(assetUrl, { signal: audioController.signal })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}`);
                }
                return response.arrayBuffer();
              })
              .then((buffer) => {
                // Reuse audio bytes in Phaser preload via blob URL to avoid re-downloading on scene enter.
                const previousBlobUrl = preloadedThemeAudioBlobUrls.get(assetUrl);
                if (previousBlobUrl) {
                  URL.revokeObjectURL(previousBlobUrl);
                }
                const blob = new Blob([buffer], { type: inferAudioMimeType(assetUrl) });
                const blobUrl = URL.createObjectURL(blob);
                preloadedThemeAudioBlobUrls.set(assetUrl, blobUrl);
                preloadedThemeAudioBlobOrder.push(assetUrl);
                while (preloadedThemeAudioBlobOrder.length > MAX_PRELOADED_THEME_AUDIO_BLOBS) {
                  const evictedUrl = preloadedThemeAudioBlobOrder.shift();
                  if (!evictedUrl) break;
                  const evictedBlobUrl = preloadedThemeAudioBlobUrls.get(evictedUrl);
                  if (evictedBlobUrl) {
                    URL.revokeObjectURL(evictedBlobUrl);
                    preloadedThemeAudioBlobUrls.delete(evictedUrl);
                  }
                }
                logThemeTiming(`[preloadThemeImagesStrict] ${label}`, assetUrl, performance.now() - start);
                finishResolve();
              })
              .catch((error) => {
                finishReject(error instanceof Error ? error : new Error(String(error)));
              });
            return;
          }

          const img = new Image();
          img.crossOrigin = 'anonymous';
          timeoutId = window.setTimeout(() => {
            img.src = '';
            finishReject(new Error('Timeout'));
          }, TIMEOUT_MS);

          img.onload = () => {
            logThemeTiming(`[preloadThemeImagesStrict] ${label}`, assetUrl, performance.now() - start);
            finishResolve();
          };
          img.onerror = () => {
            finishReject(new Error('Load error'));
          };
          img.src = assetUrl;
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.message === 'THEME_PRELOAD_ABORTED') {
          throw error;
        }
        if (attempt > MAX_RETRIES) {
          throw new Error(`[preloadThemeImagesStrict] Failed after ${MAX_RETRIES} retries: ${label} (${assetUrl})`);
        }
        onStatus?.(`Theme loading slow, retrying... (${label})`);
        console.warn(`[preloadThemeImagesStrict] Retry ${attempt}/${MAX_RETRIES} for ${label} @ ${cdnLabel}`, { assetUrl, error });
        await sleepWithAbort(RETRY_DELAY_MS);
      }
    }
  };

  try {
    const assets = themeAssets;
    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      throwIfAborted();
      const batch = assets.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((asset, batchIndex) => {
        const globalIndex = i + batchIndex;
        const label = `${globalIndex + 1}/${assets.length} ${asset.type}`;
        return loadWithRetryLimited(asset.url, label, asset.type);
      });
      await Promise.all(batchPromises);
    }
    completed = true;
  } finally {
    isHighPriorityLoading = false;
    if (completed) {
      preloadedThemeIds.add(themeId);
    }
    if (globalPreloadQueue.length > 0) {
      processPreloadQueue();
    }
  }
}

export function getThemeImagePath(themeId: string, imageName: string): string {
  // Force .webp extension
  const finalImageName = imageName.replace(/\.(png|jpg|jpeg)$/i, '.webp');
  return getR2ImageUrl(`${themeId}/${finalImageName}`);
}

export function getThemeIconPath(themeId: string): string {
  // Use .webp for icons too
  return getR2ImageUrl(`${themeId}/icon.webp`);
}
