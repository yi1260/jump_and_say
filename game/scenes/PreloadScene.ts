import { getCachedThemes, getPreloadedThemeAudioBlobUrl } from '@/gameConfig';
import {
  getLocalAssetUrl,
  getR2AssetUrl,
  getR2ImageUrl,
  getThemesListFallbackUrl,
  getThemesListPrimaryUrl
} from '@/src/config/r2Config';
import Phaser from 'phaser';
import { Theme, ThemeId } from '../../types';

const REWARD_VOICE_WORDS = ['perfect', 'super', 'great', 'amazing', 'awesome', 'excellent'] as const;

export class PreloadScene extends Phaser.Scene {
  private currentTheme: ThemeId = '';
  private retryAttempts = new Map<string, number>();
  private localFallbackAttempted = new Set<string>();
  private themesListFallbackTried = false;
  private themeAudioFallbackUrls = new Map<string, string>();
  private readonly MAX_FILE_RETRIES = 3;

  constructor() {
    super({ key: 'PreloadScene' });
  }

  private ensureThemesListCached(themesList: { themes: Theme[] }) {
    // Keep MainScene in sync: it relies on Phaser JSON cache for theme data.
    this.cache.json.add('themes_list', themesList);
  }

  init(data: { theme?: ThemeId }) {
    const initialThemes = this.registry.get('initialThemes');
    const initialTheme = this.registry.get('initialTheme');
    this.currentTheme = data.theme || initialTheme || (initialThemes && initialThemes.length > 0 ? initialThemes[0] : '') || '';
    this.retryAttempts.clear();
    this.localFallbackAttempted.clear();
    this.themesListFallbackTried = false;
    this.themeAudioFallbackUrls.clear();
  }

  preload() {
    console.time('[PreloadScene] preload');
    
    // Register loader events
    this.load.on('complete', () => {
      console.timeEnd('[PreloadScene] preload');
      this.scene.start('MainScene', { theme: this.currentTheme, dpr: this.registry.get('dpr') || 1 });
    });
    
    // Use 'filecomplete' is not enough for URL. Use 'onload' internal event?
    // Phaser 3 emits 'load' event on the LoaderPlugin for each file.
    // Signature: (file: Phaser.Loader.File)
    this.load.on('load', (file: Phaser.Loader.File) => {
        const fileUrl = typeof file.url === 'string' ? file.url : String(file.url ?? '');
        const successRetryKey = `${file.type}:${file.key}:${fileUrl}`;
        this.retryAttempts.delete(successRetryKey);
        let cacheStatus = 'UNKNOWN';
        let duration = '';
        
        if (performance && file.url) {
            // Check performance entries for this URL
            // file.url might be relative or absolute. Performance entries are usually absolute.
            const entries = performance.getEntriesByName(file.url.toString()); // file.url is string
            if (entries.length === 0 && typeof file.url === 'string' && !file.url.startsWith('http')) {
                 // Try resolving relative URL
                 const absoluteUrl = new URL(file.url, window.location.href).href;
                 const absEntries = performance.getEntriesByName(absoluteUrl);
                 if (absEntries.length > 0) {
                     const entry = absEntries[absEntries.length - 1] as PerformanceResourceTiming;
                     if (entry.transferSize === 0) cacheStatus = 'HIT (SW/Disk)';
                     else if (entry.transferSize > 0 && entry.transferSize < entry.encodedBodySize) cacheStatus = 'HIT (Revalidated)';
                     else cacheStatus = 'MISS (Network)';
                     duration = `${entry.duration.toFixed(0)}ms`;
                 }
            } else if (entries.length > 0) {
                 const entry = entries[entries.length - 1] as PerformanceResourceTiming;
                 if (entry.transferSize === 0) cacheStatus = 'HIT (SW/Disk)';
                 else if (entry.transferSize > 0 && entry.transferSize < entry.encodedBodySize) cacheStatus = 'HIT (Revalidated)';
                 else cacheStatus = 'MISS (Network)';
                 duration = `${entry.duration.toFixed(0)}ms`;
            }
        }
        
        console.log(`[Loader] Loaded: ${file.key} (${file.type}) - ${duration} [Cache: ${cacheStatus}] from ${file.url}`);
    });

    // Add retry logic for failed assets
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
        const fileUrl = typeof file.url === 'string' ? file.url : String(file.url ?? '');
        const retryKey = `${file.type}:${file.key}:${fileUrl}`;
        console.warn(`[Loader] Error loading ${file.key} from ${fileUrl}`);

        if (file.type === 'audio' && typeof file.url === 'string' && file.url.startsWith('blob:')) {
          const fallbackUrl = this.themeAudioFallbackUrls.get(file.key);
          if (fallbackUrl) {
            console.warn(`[Loader] Blob audio load failed for ${file.key}, fallback to CDN URL: ${fallbackUrl}`);
            this.load.audio(file.key, fallbackUrl);
            this.load.start();
            return;
          }
        }

        const enqueueByType = (url: string): void => {
          switch (file.type) {
            case 'image':
              this.load.image(file.key, url);
              return;
            case 'svg':
              this.load.svg(file.key, url, (file as { config?: unknown }).config);
              return;
            case 'audio':
              this.load.audio(file.key, url);
              return;
            case 'json':
              this.load.json(file.key, url);
              return;
            default:
              this.load.image(file.key, url);
          }
        };

        if (file.key === 'themes_list' && file.type === 'json' && !this.themesListFallbackTried) {
          this.themesListFallbackTried = true;
          const fallbackUrl = getThemesListFallbackUrl();
          console.warn(`[Loader] themes_list load failed, attempting local fallback: ${fallbackUrl}`);
          this.load.json('themes_list', fallbackUrl);
          this.load.start();
          return;
        }

        if (fileUrl.includes('cdn.maskmysheet.com') && fileUrl.includes('/assets/')) {
          const fallbackTag = `${file.type}:${file.key}`;
          if (!this.localFallbackAttempted.has(fallbackTag)) {
            this.localFallbackAttempted.add(fallbackTag);
            const newUrl = getLocalAssetUrl(fileUrl);
            if (newUrl !== fileUrl) {
              console.log(`[Loader] CDN load failed for ${file.key}, attempting local fallback: ${newUrl}`);
              enqueueByType(newUrl);
              this.load.start();
              return;
            }
          }
        }

        const retries = this.retryAttempts.get(retryKey) ?? 0;
        if (retries >= this.MAX_FILE_RETRIES) {
          console.error(`[Loader] Failed to load ${file.key} after ${this.MAX_FILE_RETRIES} attempts.`, { fileUrl });
          return;
        }

        this.retryAttempts.set(retryKey, retries + 1);
        const delayMs = 1000 * (retries + 1);
        console.log(`[Loader] Retrying ${file.key} (Attempt ${retries + 1}/${this.MAX_FILE_RETRIES}) in ${delayMs}ms...`);
        window.setTimeout(() => {
          if (!fileUrl) return;
          enqueueByType(fileUrl);
          this.load.start();
        }, delayMs);
    });

    // --- Load Theme Assets ---
    // Ensure cross-origin loading for WebGL
    this.load.crossOrigin = 'anonymous';
    
    // Increase concurrency to speed up loading
    // Default is 32, but we can set it higher if needed, though 32 is usually plenty.
    // However, parallel loading of images is key.
    this.load.maxParallelDownloads = 16; 

    // Load Game Assets (Audio & SVGs)
    this.loadGameAssets();

    // Strategy 1: Check Registry (injected from React)
    const allThemes = this.registry.get('allThemes');
    if (allThemes && Array.isArray(allThemes) && allThemes.length > 0) {
        console.log('[PreloadScene] Using injected themes data from registry');
        this.ensureThemesListCached({ themes: allThemes });
        this.loadThemeAssets({ themes: allThemes });
        return;
    }

    // Strategy 2: Check Global Cache (from gameConfig)
    const cachedThemes = getCachedThemes();
    if (cachedThemes && cachedThemes.length > 0) {
        console.log('[PreloadScene] Using cached themes from gameConfig');
        this.ensureThemesListCached({ themes: cachedThemes });
        this.loadThemeAssets({ themes: cachedThemes });
        return;
    }

    // Strategy 3: Check Phaser Cache
    const themesList = this.cache.json.get('themes_list');
    if (themesList) {
      this.ensureThemesListCached(themesList);
      this.loadThemeAssets(themesList);
      return;
    }

    // Strategy 4: Fetch from Network (Fallback)
    console.log('[PreloadScene] Falling back to network fetch for themes-list');
    this.load.json('themes_list', getThemesListPrimaryUrl());
    this.load.once('filecomplete-json-themes_list', () => {
      const loaded = this.cache.json.get('themes_list');
      if (loaded) this.loadThemeAssets(loaded);
    });
  }

  private loadGameAssets() {
    // Determine base URL: use R2 if in production (import.meta.env.PROD), otherwise local
    // const useR2 = import.meta.env.PROD; 
    // Actually, user wants to solve speed issues, so we should prefer R2 if possible.
    // Let's use a helper that can be toggled or use R2 by default for these assets.
    // For now, let's stick to the requested change to use R2.
    
    const soundBase = 'assets/kenney/Sounds/';
    const kenneyBase = 'assets/kenney/Vector/';
    
    // Helper to get full URL
    const getUrl = (path: string) => getR2AssetUrl(path);

    this.load.audio('sfx_jump', [
        getUrl(`${soundBase}sfx_jump-high.mp3`),
        getUrl(`${soundBase}sfx_jump-high.ogg`)
    ]);
    this.load.audio('sfx_success', [
        getUrl(`${soundBase}sfx_coin.mp3`),
        getUrl(`${soundBase}sfx_coin.ogg`)
    ]);
    this.load.audio('sfx_failure', [
        getUrl(`${soundBase}sfx_disappear.mp3`),
        getUrl(`${soundBase}sfx_disappear.ogg`)
    ]);
    this.load.audio('sfx_bump', [
        getUrl(`${soundBase}sfx_bump.mp3`),
        getUrl(`${soundBase}sfx_bump.ogg`)
    ]);

    REWARD_VOICE_WORDS.forEach((word) => {
      const voiceKey = `voice_${word}`;
      const voiceUrl = getUrl(`${soundBase}${word}.mp3`);
      console.log(`[PreloadScene] Loading voice audio: ${voiceKey} from ${voiceUrl}`);
      this.load.audio(voiceKey, voiceUrl);
    });
    
    const { height } = this.scale;
    const gameScale = height / 1080;
    const rawDpr = this.registry.get('dpr') || window.devicePixelRatio || 1;
    const dprScale = Math.min(rawDpr, 2);
    const targetBeeSize = Math.round(100 * gameScale * dprScale);
    const charTextureSize = Math.round(180 * gameScale * dprScale);
    const tileTextureSize = Math.round(320 * gameScale * dprScale);
    
    if (!this.textures.exists('p1_stand')) {
        this.load.svg('p1_stand', getUrl(`${kenneyBase}Characters/character_pink_idle.svg`), { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_jump', getUrl(`${kenneyBase}Characters/character_pink_jump.svg`), { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_walk_a', getUrl(`${kenneyBase}Characters/character_pink_walk_a.svg`), { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_walk_b', getUrl(`${kenneyBase}Characters/character_pink_walk_b.svg`), { width: charTextureSize, height: charTextureSize });
    }
        
    if (!this.textures.exists('tile_box')) {
        this.load.svg('tile_box', getUrl(`${kenneyBase}Tiles/block_empty.svg`), { width: tileTextureSize, height: tileTextureSize });
    }
        
    if (!this.textures.exists('bee_a')) {
        this.load.svg('bee_a', getUrl(`${kenneyBase}Enemies/bee_a.svg`), { width: targetBeeSize, height: targetBeeSize });
    }
    if (!this.textures.exists('bee_b')) {
        this.load.svg('bee_b', getUrl(`${kenneyBase}Enemies/bee_b.svg`), { width: targetBeeSize, height: targetBeeSize });
    }

    // Reward & UI sizes
    const safeRewardSize = Math.min(512, Math.max(192, Math.round(220 * gameScale * dprScale)));
    const safeIconSize = Math.min(512, Math.max(192, Math.round(200 * gameScale * dprScale)));

    if (!this.textures.exists('star_gold')) {
      this.load.svg('star_gold', getUrl(`${kenneyBase}Tiles/star.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('mushroom_red', getUrl(`${kenneyBase}Tiles/mushroom_red.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('mushroom_brown', getUrl(`${kenneyBase}Tiles/mushroom_brown.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_blue', getUrl(`${kenneyBase}Tiles/gem_blue.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_red', getUrl(`${kenneyBase}Tiles/gem_red.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_green', getUrl(`${kenneyBase}Tiles/gem_green.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_yellow', getUrl(`${kenneyBase}Tiles/gem_yellow.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('grass', getUrl(`${kenneyBase}Tiles/grass.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('grass_purple', getUrl(`${kenneyBase}Tiles/grass_purple.svg`), { width: safeRewardSize, height: safeRewardSize });
      
      // UI Icons
      this.load.svg('icon_retry', getUrl(`${kenneyBase}Tiles/replay_256dp.svg`), { width: safeIconSize, height: safeIconSize });
      this.load.svg('icon_next', getUrl(`${kenneyBase}Tiles/keyboard_double_arrow_right_256dp.svg`), { width: safeIconSize, height: safeIconSize });
    }
  }

  private loadThemeAssets(themesList: any) {
    const themes = themesList.themes || [];
    const targetTheme = themes.find((t: Theme) => t.id === this.currentTheme);

    if (!targetTheme) {
        console.error(`[PreloadScene] Theme ${this.currentTheme} not found`);
        return;
    }

    const audioCount = targetTheme.questions.filter((q: Theme['questions'][number]) => Boolean(q.audio)).length;
    console.log(`[PreloadScene] Queueing ${targetTheme.questions.length} images + ${audioCount} audios for ${this.currentTheme}`);
    
    targetTheme.questions.forEach((q: Theme['questions'][number]) => {
        // Force .webp extension
        const imageName = q.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        const imagePath = getR2ImageUrl(imageName);
        // Standardize key format: theme_{id}_{image_name_no_ext}
        const key = `theme_${this.currentTheme}_${q.image.replace(/\.(png|jpg|jpeg|webp)$/i, '')}`;
        
        // Only load if not already in texture manager
        if (!this.textures.exists(key)) {
            this.load.image(key, imagePath);
        }

        if (q.audio) {
            const audioPath = getR2ImageUrl(q.audio);
            const audioKey = `theme_audio_${this.currentTheme}_${q.audio.replace(/\.(mp3|wav|ogg|m4a)$/i, '')}`;
            this.themeAudioFallbackUrls.set(audioKey, audioPath);
            const blobAudioUrl = getPreloadedThemeAudioBlobUrl(audioPath);
            const loadUrl = blobAudioUrl || audioPath;
            if (!this.cache.audio.exists(audioKey)) {
                this.load.audio(audioKey, loadUrl);
            }
        }
    });
  }
}
