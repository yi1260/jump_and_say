import { getR2ImageUrl, getR2ThemesListCdnUrl, getR2ThemesListUrl, handleR2Error } from '@/src/config/r2Config';
import { Theme, ThemeList } from './types';

let cachedThemes: Theme[] | null = null;

export function getCachedThemes(): Theme[] | null {
  return cachedThemes;
}

export async function loadThemes(): Promise<Theme[]> {
  if (cachedThemes) {
    return cachedThemes;
  }

  try {
    const fetchThemesList = async (url: string): Promise<ThemeList> => {
      const response = await fetch(url, { cache: 'default' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as ThemeList;
    };

    let themeList: ThemeList | null = null;
    try {
      themeList = await fetchThemesList(getR2ThemesListUrl());
    } catch (localError) {
      console.warn('[loadThemes] Local themes-list failed, falling back to R2 CDN', localError);
      themeList = await fetchThemesList(getR2ThemesListCdnUrl());
    }

    // Mark all themes as available by default (trust themes-list.json)
    // This avoids the expensive image availability checks
    const themesWithAvailability = themeList.themes.map((theme) => ({
      ...theme,
      isAvailable: theme.questions && theme.questions.length > 0
    }));

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
let globalPreloadQueue: { url: string; themeId: string }[] = [];
let isPreloadingActive = false;
let isHighPriorityLoading = false; // Flag to pause background preloading (for priority loads)
let isBackgroundPaused = false;    // Flag to pause background preloading (for gameplay)
const MAX_CONCURRENT_DOWNLOADS = 6;
let activeDownloads = 0;

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
  
  themes.forEach((theme, index) => {
    // Skip checking for icon.png as it doesn't exist in the themes list
    // and causes 404 errors
    
    if (theme.questions) {
      theme.questions.forEach(q => {
        const imageName = q.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        globalPreloadQueue.push({
          url: getR2ImageUrl(imageName),
          themeId: theme.id
        });
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
  
  console.log(`[Preloader] Prioritized ${items.length} images for theme: ${themeId}`);

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
      preloadSingleImage(item.url).finally(() => {
        activeDownloads--;
        processPreloadQueue();
      });
    }
  }
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

  // Remove images for this theme from the background queue since we are loading them now
  // This prevents double-loading and prioritizes this theme
  const themeUrls = new Set(theme.questions.map(q => getR2ImageUrl(q.image)));
  globalPreloadQueue = globalPreloadQueue.filter(item => !themeUrls.has(item.url));
  
  console.log(`[preloadThemeImages] Preloading ${theme.questions.length} images for theme: ${themeId}. (Background active downloads: ${activeDownloads})`);
  const startTime = performance.now();

  // Use a batch processing approach to avoid overwhelming the browser/network
  const BATCH_SIZE = 4;
  const questions = theme.questions;
  
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);
    const batchStartTime = performance.now();
    console.log(`[preloadThemeImages] Starting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(questions.length / BATCH_SIZE)} (Items ${i + 1}-${Math.min(i + BATCH_SIZE, questions.length)})`);
    
    const batchPromises = batch.map((q, batchIndex) => {
      const globalIndex = i + batchIndex;
      const imgStartTime = performance.now();
      const imageName = q.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
      const imgUrl = getR2ImageUrl(imageName);

      const loadWithRetry = (retriesLeft: number): Promise<void> => {
        return new Promise<void>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            // Increase timeout to 15 seconds
            const timeout = setTimeout(() => {
              const duration = (performance.now() - imgStartTime).toFixed(2);
              console.warn(`[preloadThemeImages] ❌ Timeout loading: ${q.image} (${globalIndex + 1}/${theme.questions.length}) - ${duration}ms. Retries left: ${retriesLeft}`);
              
              if (retriesLeft > 0) {
                  console.log(`[preloadThemeImages] 🔄 Retrying: ${q.image}`);
                  resolve(loadWithRetry(retriesLeft - 1));
              } else {
                  resolve();
              }
            }, 15000); 
            
            img.onload = () => {
              clearTimeout(timeout);
              const duration = (performance.now() - imgStartTime).toFixed(2);
              
              // Simple heuristic: if it loads extremely fast (< 50ms), it's likely from cache (memory or disk)
              // Note: Service Worker cache hits might take slightly longer but still be fast
              // Precise network vs cache detection for Images is limited without Performance API entries which might be restricted by CORS
              const isFastLoad = parseFloat(duration) < 50;
              let sourceLabel = isFastLoad ? '📦 CACHE (Likely)' : '🌐 CDN';
              
              console.log(`[preloadThemeImages] ✅ Loaded: ${q.image} (${globalIndex + 1}/${theme.questions.length}) - ${duration}ms [${sourceLabel}]`);
              resolve();
            };
    
            img.onerror = (e) => {
              clearTimeout(timeout);
              const duration = (performance.now() - imgStartTime).toFixed(2);
              console.warn(`[preloadThemeImages] ❌ Failed to preload: ${q.image} - ${duration}ms (URL: ${imgUrl})`);
              
              if (retriesLeft > 0) {
                  console.log(`[preloadThemeImages] 🔄 Retrying after error: ${q.image}`);
                  setTimeout(() => {
                      resolve(loadWithRetry(retriesLeft - 1));
                  }, 500); // Wait a bit before retry
              } else {
                  console.warn(`[preloadThemeImages] Failure details: URL=${imgUrl}`, e);
                  resolve();
              }
            };
            
            try {
              console.log(`[preloadThemeImages] ⏳ Requesting: ${q.image} (${globalIndex + 1}/${theme.questions.length}) [CDN]`);
              img.src = imgUrl;
            } catch (err) {
              console.warn(`[preloadThemeImages] Error setting image src:`, err);
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
  onStatus?: (status: string) => void
): Promise<void> {
  if (!cachedThemes) {
    await loadThemes();
  }

  const theme = cachedThemes?.find(t => t.id === themeId);
  if (!theme || !theme.questions || theme.questions.length === 0) {
    throw new Error(`[preloadThemeImagesStrict] Theme not found or has no questions: ${themeId}`);
  }

  isHighPriorityLoading = true;

  const themeUrls = new Set(theme.questions.map(q => getR2ImageUrl(q.image)));
  globalPreloadQueue = globalPreloadQueue.filter(item => !themeUrls.has(item.url));

  console.log(`[preloadThemeImagesStrict] Preloading ${theme.questions.length} images for theme: ${themeId}`);

  const BATCH_SIZE = 4;
  const RETRY_DELAY_MS = 1500;
  const TIMEOUT_MS = 30000;
  const MAX_RETRIES = 6;

  const getCdnLabel = (imgUrl: string): string => {
    try {
      return new URL(imgUrl).origin;
    } catch {
      return imgUrl;
    }
  };

  const loadWithRetryLimited = async (imgUrl: string, label: string): Promise<void> => {
    const cdnLabel = getCdnLabel(imgUrl);
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      attempt += 1;
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          const timeout = setTimeout(() => {
            img.src = '';
            reject(new Error('Timeout'));
          }, TIMEOUT_MS);

          img.onload = () => {
            clearTimeout(timeout);
            resolve();
          };
          img.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Load error'));
          };
          img.src = imgUrl;
        });
        return;
      } catch (error) {
        if (attempt > MAX_RETRIES) {
          throw new Error(`[preloadThemeImagesStrict] Failed after ${MAX_RETRIES} retries: ${label} (${imgUrl})`);
        }
        onStatus?.(`Theme loading slow, retrying... (${label}) ${cdnLabel}`);
        console.warn(`[preloadThemeImagesStrict] Retry ${attempt}/${MAX_RETRIES} for ${label} @ ${cdnLabel}`, { imgUrl, error });
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  };

  try {
    const questions = theme.questions;
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((q, batchIndex) => {
        const globalIndex = i + batchIndex;
        const imageName = q.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        const imgUrl = getR2ImageUrl(imageName);
        const label = `${globalIndex + 1}/${questions.length}`;
        return loadWithRetryLimited(imgUrl, label);
      });
      await Promise.all(batchPromises);
    }
  } finally {
    isHighPriorityLoading = false;
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
