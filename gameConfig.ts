import { getR2ImageUrl, getR2ThemesListUrl, handleR2Error } from '@/src/config/r2Config';
import { Theme, ThemeList } from './types';

let cachedThemes: Theme[] | null = null;

export async function loadThemes(): Promise<Theme[]> {
  if (cachedThemes) {
    return cachedThemes;
  }

  try {
    const response = await fetch(getR2ThemesListUrl());
    if (!response.ok) {
      handleR2Error(new Error(`HTTP ${response.status}`), 'Failed to load themes list');
    }

    const themeList: ThemeList = await response.json();

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
    
    // Start background preloading of theme images
    // We start with the first few themes as they are most likely to be played
    startBackgroundPreloading(themesWithAvailability);
    
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
const MAX_CONCURRENT_DOWNLOADS = 4;
let activeDownloads = 0;

function startBackgroundPreloading(themes: Theme[]) {
  // Flatten all images from all themes into a queue
  // We skip the first theme as it's likely being loaded by the game scene directly
  // or will be prioritized if requested
  globalPreloadQueue = [];
  
  themes.forEach((theme, index) => {
    // Skip checking for icon.png as it doesn't exist in the themes list
    // and causes 404 errors
    
    if (theme.questions) {
      theme.questions.forEach(q => {
        globalPreloadQueue.push({
          url: getR2ImageUrl(q.image),
          themeId: theme.id
        });
      });
    }
  });

  if (!isPreloadingActive) {
    processPreloadQueue();
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
  if (globalPreloadQueue.length === 0) {
    isPreloadingActive = false;
    console.log('[Preloader] All background assets preloaded');
    return;
  }

  isPreloadingActive = true;

  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && globalPreloadQueue.length > 0) {
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

function preloadSingleImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve();
    img.onerror = () => {
      // Silently fail for background preloads to avoid console spam
      resolve(); 
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

  // Remove images for this theme from the background queue since we are loading them now
  // This prevents double-loading and prioritizes this theme
  const themeUrls = new Set(theme.questions.map(q => getR2ImageUrl(q.image)));
  globalPreloadQueue = globalPreloadQueue.filter(item => !themeUrls.has(item.url));
  
  console.log(`[preloadThemeImages] Preloading ${theme.questions.length} images for theme: ${themeId}`);
  
  const loadPromises = theme.questions.map((q, index) => {
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        console.warn(`[preloadThemeImages] Timeout loading: ${q.image} (${index + 1}/${theme.questions.length})`);
        resolve();
      }, 10000); // 10 second timeout per image
      
      img.onload = () => {
        clearTimeout(timeout);
        // Only log every 5 images or the last one to reduce noise
        if ((index + 1) % 5 === 0 || (index + 1) === theme.questions.length) {
          console.log(`[preloadThemeImages] Progress: ${index + 1}/${theme.questions.length}`);
        }
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timeout);
        console.warn(`[preloadThemeImages] Failed to preload: ${q.image}`);
        resolve();
      };
      try {
        img.src = getR2ImageUrl(q.image);
      } catch (err) {
        console.warn(`[preloadThemeImages] Error setting image src:`, err);
        resolve();
      }
    });
  });
  
  try {
    // Use Promise.allSettled instead of Promise.all to continue even if some fail
    await Promise.allSettled(loadPromises);
    console.log(`[preloadThemeImages] Preloading completed for theme: ${themeId}`);
  } catch (error) {
    console.error(`[preloadThemeImages] Error preloading images for ${themeId}:`, error);
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
