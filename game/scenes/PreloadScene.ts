import { getCachedThemes, getPreloadedThemeAudioBlobUrl } from '@/gameConfig';
import {
    getLocalAssetUrl,
    getR2ImageUrl,
    getThemesListFallbackUrl,
    getThemesListPrimaryUrl
} from '@/src/config/r2Config';
import Phaser from 'phaser';
import { Theme, ThemeId } from '../../types';

const REWARD_VOICE_WORDS = ['perfect', 'super', 'great', 'amazing', 'awesome', 'excellent', 'try_again'] as const;
const ROUND1_VOLUME_BORDER_SVG_CACHE_BUSTER = 'v=20260303_volume_border_split';
const ROUND1_VOLUME_FILL_SVG_CACHE_BUSTER = 'v=20260303_volume_fill_split';
const ROUND1_MIC_SVG_CACHE_BUSTER = 'v=20260301_mic_ring_hd';
const ROUND1_FEEDBACK_BADGE_SVG_CACHE_BUSTER = 'v=20260305_feedback_badge_hq_v4';
const ROUND1_FEEDBACK_BADGE_MIN_DISPLAY_WIDTH = 216;
const ROUND1_FEEDBACK_BADGE_MAX_DISPLAY_WIDTH = 540;
const ROUND1_FEEDBACK_BADGE_VIEWPORT_WIDTH_RATIO = 0.66;
const ROUND1_FEEDBACK_BADGE_VIEWPORT_HEIGHT_RATIO = 0.48;
const ROUND1_FEEDBACK_BADGE_ASPECT_RATIO = {
  reward_excellent: 460 / 120,
  reward_great: 300 / 120,
  reward_try_again: 360 / 120
} as const;

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
    const soundBase = 'assets/kenney/Sounds/';
    const kenneyBase = 'assets/kenney/Vector/';
    
    const getLocalUrl = (path: string) => getLocalAssetUrl(path);

    this.load.audio('sfx_jump', [
        getLocalUrl(`${soundBase}sfx_jump-high.mp3`),
        getLocalUrl(`${soundBase}sfx_jump-high.ogg`)
    ]);
    this.load.audio('sfx_success', [
        getLocalUrl(`${soundBase}sfx_coin.mp3`),
        getLocalUrl(`${soundBase}sfx_coin.ogg`)
    ]);
    this.load.audio('sfx_failure', [
        getLocalUrl(`${soundBase}sfx_disappear.mp3`),
        getLocalUrl(`${soundBase}sfx_disappear.ogg`)
    ]);
    this.load.audio('sfx_bump', [
        getLocalUrl(`${soundBase}sfx_bump.mp3`),
        getLocalUrl(`${soundBase}sfx_bump.ogg`)
    ]);
    this.load.audio('sfx_record_start', getLocalUrl(`${soundBase}glass_001.ogg`));

    REWARD_VOICE_WORDS.forEach((word) => {
      const voiceKey = `voice_${word}`;
      const voiceUrl = getLocalUrl(`${soundBase}${word}.mp3`);
      console.log(`[PreloadScene] Loading voice audio: ${voiceKey} from ${voiceUrl}`);
      this.load.audio(voiceKey, voiceUrl);
    });
    
    const { width, height } = this.scale;
    const gameScale = height / 1080;
    const rawDpr = this.registry.get('dpr') || 1;
    const textureBoostRaw = this.registry.get('textureBoost');
    const textureBoost = typeof textureBoostRaw === 'number' && Number.isFinite(textureBoostRaw)
      ? Phaser.Math.Clamp(textureBoostRaw, 1, 1.4)
      : 1;
    const dprScale = Math.max(1, Math.min(rawDpr * textureBoost, 3.2));
    const targetBeeSize = Math.round(100 * gameScale * dprScale);
    const charTextureSize = Math.round(180 * gameScale * dprScale);
    const tileTextureSize = Math.round(320 * gameScale * dprScale);
    // Pronunciation-round UI textures are generated from SVG; size them based on actual display bounds
    // to avoid unnecessary GPU memory usage on mobile/iPad while keeping crisp edges.
    const shortestViewportSide = Math.max(1, Math.min(width, height));
    const roundCardDisplaySize = Phaser.Math.Clamp(
      Math.min(shortestViewportSide * 0.28, height * 0.62),
      220 * gameScale,
      780 * gameScale
    );
    const roundCardTextureSize = Math.round(
      Phaser.Math.Clamp(roundCardDisplaySize * dprScale * 1.25, 512, 1792)
    );
    const round1MicIconDisplaySize = Math.round(Math.max(52, 80 * gameScale));
    const round1MicTextureSize = Math.round(
      Phaser.Math.Clamp(round1MicIconDisplaySize * dprScale * 3.2, 256, 768)
    );
    const round1VolumeFrameDisplayHeight = Phaser.Math.Clamp(320 * gameScale, 220, 420);
    const round1VolumeFrameTextureHeight = Math.round(
      Phaser.Math.Clamp(round1VolumeFrameDisplayHeight * dprScale * 2.6, 896, 2304)
    );
    const round1VolumeFrameTextureWidth = Math.round(
      Phaser.Math.Clamp(round1VolumeFrameTextureHeight * 0.25, 224, 640)
    );
    
    if (!this.textures.exists('p1_stand')) {
        this.load.svg('p1_stand', getLocalUrl(`${kenneyBase}Characters/character_pink_idle.svg`), { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_jump', getLocalUrl(`${kenneyBase}Characters/character_pink_jump.svg`), { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_walk_a', getLocalUrl(`${kenneyBase}Characters/character_pink_walk_a.svg`), { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_walk_b', getLocalUrl(`${kenneyBase}Characters/character_pink_walk_b.svg`), { width: charTextureSize, height: charTextureSize });
    }
        
    if (!this.textures.exists('tile_box')) {
        this.load.svg('tile_box', getLocalUrl(`${kenneyBase}Tiles/block_empty.svg`), { width: tileTextureSize, height: tileTextureSize });
    }
    if (!this.textures.exists('tile_card_frame_hd')) {
        this.load.svg('tile_card_frame_hd', getLocalUrl(`${kenneyBase}Tiles/card.svg`), { width: roundCardTextureSize, height: roundCardTextureSize });
    }
        
    if (!this.textures.exists('bee_a')) {
        this.load.svg('bee_a', getLocalUrl(`${kenneyBase}Enemies/bee_a.svg`), { width: targetBeeSize, height: targetBeeSize });
    }
    if (!this.textures.exists('bee_b')) {
        this.load.svg('bee_b', getLocalUrl(`${kenneyBase}Enemies/bee_b.svg`), { width: targetBeeSize, height: targetBeeSize });
    }

    const safeRewardSize = Math.min(512, Math.max(192, Math.round(220 * gameScale * dprScale)));
    const safeIconSize = Math.min(512, Math.max(192, Math.round(200 * gameScale * dprScale)));
    const round1FeedbackBadgeDisplayWidth = Phaser.Math.Clamp(
      Math.min(
        this.scale.width * ROUND1_FEEDBACK_BADGE_VIEWPORT_WIDTH_RATIO,
        this.scale.height * ROUND1_FEEDBACK_BADGE_VIEWPORT_HEIGHT_RATIO
      ),
      ROUND1_FEEDBACK_BADGE_MIN_DISPLAY_WIDTH,
      ROUND1_FEEDBACK_BADGE_MAX_DISPLAY_WIDTH
    );
    const round1FeedbackBadgeTextureWidth = Math.round(
      Phaser.Math.Clamp(round1FeedbackBadgeDisplayWidth * dprScale * 2.1, 384, 3072)
    );
    const getFeedbackBadgeTextureHeight = (aspectRatio: number): number => Math.round(
      Phaser.Math.Clamp(
        round1FeedbackBadgeTextureWidth / Phaser.Math.Clamp(aspectRatio, 1.6, 4.6),
        96,
        1024
      )
    );

    if (!this.textures.exists('star_gold')) {
      this.load.svg('star_gold', getLocalUrl(`${kenneyBase}Tiles/star.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('mushroom_red', getLocalUrl(`${kenneyBase}Tiles/mushroom_red.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('mushroom_brown', getLocalUrl(`${kenneyBase}Tiles/mushroom_brown.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_blue', getLocalUrl(`${kenneyBase}Tiles/gem_blue.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_red', getLocalUrl(`${kenneyBase}Tiles/gem_red.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_green', getLocalUrl(`${kenneyBase}Tiles/gem_green.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('gem_yellow', getLocalUrl(`${kenneyBase}Tiles/gem_yellow.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('grass', getLocalUrl(`${kenneyBase}Tiles/grass.svg`), { width: safeRewardSize, height: safeRewardSize });
      this.load.svg('grass_purple', getLocalUrl(`${kenneyBase}Tiles/grass_purple.svg`), { width: safeRewardSize, height: safeRewardSize });
      
      this.load.svg('icon_retry', getLocalUrl(`${kenneyBase}Tiles/replay_256dp.svg`), { width: safeIconSize, height: safeIconSize });
      this.load.svg('icon_next', getLocalUrl(`${kenneyBase}Tiles/keyboard_double_arrow_right_256dp.svg`), { width: safeIconSize, height: safeIconSize });
    }
    if (!this.textures.exists('reward_excellent')) {
      this.load.svg('reward_excellent', `${getLocalUrl(`${kenneyBase}Tiles/excellent.svg`)}?${ROUND1_FEEDBACK_BADGE_SVG_CACHE_BUSTER}`, {
        width: round1FeedbackBadgeTextureWidth,
        height: getFeedbackBadgeTextureHeight(ROUND1_FEEDBACK_BADGE_ASPECT_RATIO.reward_excellent)
      });
    }
    if (!this.textures.exists('reward_great')) {
      this.load.svg('reward_great', `${getLocalUrl(`${kenneyBase}Tiles/great.svg`)}?${ROUND1_FEEDBACK_BADGE_SVG_CACHE_BUSTER}`, {
        width: round1FeedbackBadgeTextureWidth,
        height: getFeedbackBadgeTextureHeight(ROUND1_FEEDBACK_BADGE_ASPECT_RATIO.reward_great)
      });
    }
    if (!this.textures.exists('reward_try_again')) {
      this.load.svg('reward_try_again', `${getLocalUrl(`${kenneyBase}Tiles/try_again.svg`)}?${ROUND1_FEEDBACK_BADGE_SVG_CACHE_BUSTER}`, {
        width: round1FeedbackBadgeTextureWidth,
        height: getFeedbackBadgeTextureHeight(ROUND1_FEEDBACK_BADGE_ASPECT_RATIO.reward_try_again)
      });
    }

    if (!this.textures.exists('tile_speaker_icon_hd')) {
      this.load.svg(
        'tile_speaker_icon_hd',
        `${getLocalUrl(`${kenneyBase}Tiles/speaker.svg`)}?${ROUND1_MIC_SVG_CACHE_BUSTER}`,
        { width: round1MicTextureSize, height: round1MicTextureSize }
      );
    }
    if (!this.textures.exists('round1_volume_border_hd')) {
      this.load.svg('round1_volume_border_hd', `${getLocalUrl(`${kenneyBase}Tiles/volume_border.svg`)}?${ROUND1_VOLUME_BORDER_SVG_CACHE_BUSTER}`, {
        width: round1VolumeFrameTextureWidth,
        height: round1VolumeFrameTextureHeight
      });
    }
    if (!this.textures.exists('round1_volume_fill_hd')) {
      this.load.svg('round1_volume_fill_hd', `${getLocalUrl(`${kenneyBase}Tiles/volume_fill.svg`)}?${ROUND1_VOLUME_FILL_SVG_CACHE_BUSTER}`, {
        width: round1VolumeFrameTextureWidth,
        height: round1VolumeFrameTextureHeight
      });
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
