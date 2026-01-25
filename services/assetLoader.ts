import { getR2AssetUrl } from '@/src/config/r2Config';
import { motionController } from './motionController';
import { preloadThemeImages } from '@/gameConfig';
import { ThemeId } from '@/types';

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
      try {
        if (path.endsWith('.mp3') || path.endsWith('.ogg')) {
          const audio = new Audio();
          audio.src = url;
          audio.preload = 'auto';
          await new Promise<void>((resolve) => {
             const onLoaded = () => {
                 cleanup();
                 resolve();
             };
             const onError = () => {
                 cleanup();
                 resolve(); // Continue on error
             };
             const cleanup = () => {
                 audio.removeEventListener('canplaythrough', onLoaded);
                 audio.removeEventListener('error', onError);
             };
             
             audio.addEventListener('canplaythrough', onLoaded);
             audio.addEventListener('error', onError);
             audio.load();
          });
        } else {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = url;
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Continue on error
          });
        }
      } catch (e) {
        console.warn(`Failed to preload ${path}`, e);
      }
      // Just increment count, don't update status text for every single file
      loadedCount++;
      const progress = Math.min(100, Math.round((loadedCount / totalItems) * 100));
      onProgress(progress, 'Loading Game Assets...');
    });
    
    // We don't await assetPromises individually in the loop for progress updates 
    // because we updated the count inside. But we need to wait for all of them.
    // However, to make the progress bar move smoothly, we can't just await Promise.all at the end if we want updates.
    // The inner callback already updates progress.
    
    // 3. Preload ONLY the First Theme's Images
    // We do this in parallel with game assets or after? 
    // Let's do it in parallel to maximize bandwidth.
    
    const firstThemeId = selectedThemes[0];
    const themePromise = (async () => {
        if (firstThemeId) {
            await preloadThemeImages(firstThemeId);
            updateProgress('Loading Theme...');
        }
    })();

    await Promise.all([...assetPromises, themePromise]);
    
    onProgress(100, 'Ready!');
    
  } catch (error) {
    console.error('Asset loading failed:', error);
    onProgress(100, 'Starting Game...');
  }
}
