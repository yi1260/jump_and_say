import { preloadThemeImages } from '@/gameConfig';
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
  'assets/kenney/Vector/Backgrounds/background_clouds.svg'
];

const PRELOAD_TIMEOUT = 15000; // 增加到 15 秒超时，允许更慢的网络拉取基础素材
const PRELOAD_RETRIES = 1;    // 基础素材失败后允许重试 1 次

export async function preloadAllGameAssets(
  selectedThemes: ThemeId[], 
  onProgress: (progress: number, status: string) => void
) {
  let loadedCount = 0;
  // Calculate total items
  // 1 (MediaPipe) + Game Assets + 1 (First Theme)
  const totalItems = 1 + GAME_ASSETS.length + 1;
  
  const updateProgress = (status: string) => {
    loadedCount++;
    const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
    onProgress(progress, status);
  };

  try {
    // 1. Initialize MediaPipe (AI Models)
    onProgress(0, 'Initializing AI...');
    await motionController.init();
    updateProgress('AI Ready');

    // 2. Preload Game Assets (Parallel)
    const assetPromises = GAME_ASSETS.map(async (path) => {
      const url = getR2AssetUrl(path);
      
      const loadWithRetry = async (retriesLeft: number): Promise<void> => {
        try {
          if (path.endsWith('.mp3') || path.endsWith('.ogg')) {
            // Use fetch with AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), PRELOAD_TIMEOUT);
            
            try {
              const response = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              await response.arrayBuffer();
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
    const firstThemeId = selectedThemes[0];
    const themePromise = (async () => {
        if (firstThemeId) {
            await preloadThemeImages(firstThemeId);
            updateProgress('Loading Theme...');
        }
    })();

    await Promise.all([...assetPromises, themesListPromise, themePromise]);
    
    onProgress(100, 'Ready!');
    
  } catch (error) {
    console.error('Asset loading failed:', error);
    onProgress(100, 'Starting Game...');
  }
}
