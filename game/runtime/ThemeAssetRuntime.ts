import type Phaser from 'phaser';
import { prioritizeThemeInQueue } from '../../gameConfig';
import type { Theme, ThemeList } from '../../types';
import { extractThemesFromThemeList, findThemeById } from './themeListUtils';

interface ThemeAssetRuntimeSceneHost {
  cache: Phaser.Cache.CacheManager;
  load: Phaser.Loader.LoaderPlugin;
  textures: Phaser.Textures.TextureManager;
  currentTheme: string;
  currentThemes: string[];
  currentThemeIndex: number;
  imagesLoaded: boolean;
  imagesLoading: boolean;
  loadingPromise: Promise<void> | null;
  getImageTextureKey(questionItem: Theme['questions'][number], themeId: string): string;
  getAudioCacheKey(questionItem: Theme['questions'][number], themeId: string): string;
  setupThemeData(theme: Theme): void;
}

export class ThemeAssetRuntime {
  private readonly sceneRef: unknown;

  constructor(scene: unknown) {
    this.sceneRef = scene;
  }

  private get scene(): ThemeAssetRuntimeSceneHost {
    return this.sceneRef as ThemeAssetRuntimeSceneHost;
  }

  public initThemeDataFromCache(): void {
    const scene = this.scene;
    const themeList = scene.cache.json.get('themes_list');
    const theme = findThemeById(themeList, scene.currentTheme);

    if (!theme) {
      console.warn(`[MainScene] Theme ${scene.currentTheme} not found in cache. Attempting fallback fetch...`);
      void this.loadThemeDataFallback();
      return;
    }

    scene.setupThemeData(theme);
  }

  public async loadThemeDataFallback(): Promise<void> {
    const scene = this.scene;
    try {
      const { getThemesListFallbackUrl, getThemesListPrimaryUrl } = await import('@/src/config/r2Config');
      const fetchThemeList = async (url: string): Promise<ThemeList> => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as ThemeList;
        return data;
      };

      let themeList: ThemeList;
      try {
        themeList = await fetchThemeList(getThemesListPrimaryUrl());
      } catch (primaryError) {
        console.warn('[MainScene] CDN themes-list failed, falling back to local', primaryError);
        themeList = await fetchThemeList(getThemesListFallbackUrl());
      }

      scene.cache.json.add('themes_list', themeList);
      const theme = findThemeById(themeList, scene.currentTheme);
      if (theme) {
        console.log(`[MainScene] Fallback load successful for ${scene.currentTheme}`);
        scene.setupThemeData(theme);
      } else {
        console.error(`[MainScene] Theme ${scene.currentTheme} still not found after fallback`);
      }
    } catch (error) {
      console.error('[MainScene] Fallback load failed:', error);
    }
  }

  public async loadThemeImages(themeId?: string): Promise<void> {
    const scene = this.scene;
    const targetThemeId = themeId || scene.currentTheme;
    const isCurrentTheme = targetThemeId === scene.currentTheme;

    if (isCurrentTheme && scene.loadingPromise) {
      return scene.loadingPromise;
    }
    if (isCurrentTheme && scene.imagesLoaded) {
      return;
    }

    const themesList = scene.cache.json.get('themes_list');
    if (!themesList) {
      console.warn('[loadThemeImages] Themes list not loaded yet');
      return;
    }
    const targetTheme = findThemeById(themesList, targetThemeId);
    if (!targetTheme) {
      console.warn(`[loadThemeImages] Theme ${targetThemeId} not found`);
      return;
    }

    const missingImageQuestions = targetTheme.questions.filter((questionItem: Theme['questions'][number]) => {
      const key = scene.getImageTextureKey(questionItem, targetThemeId);
      return !scene.textures.exists(key);
    });
    const missingAudioQuestions = targetTheme.questions.filter((questionItem: Theme['questions'][number]) => {
      if (!questionItem.audio) return false;
      const key = scene.getAudioCacheKey(questionItem, targetThemeId);
      return !scene.cache.audio.exists(key);
    });

    if (missingImageQuestions.length > 0) {
      console.warn(
        `[MainScene] Missing ${missingImageQuestions.length} textures for ${targetThemeId}, loading fallback...`
      );
      const { getR2ImageUrl } = await import('@/src/config/r2Config');
      missingImageQuestions.forEach((questionItem: Theme['questions'][number]) => {
        const imageName = questionItem.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        const imagePath = getR2ImageUrl(imageName);
        const key = scene.getImageTextureKey(questionItem, targetThemeId);
        if (!scene.textures.exists(key)) {
          scene.load.image(key, imagePath);
        }
      });

      if (isCurrentTheme) {
        scene.imagesLoading = true;
      }

      const loadPromise = new Promise<void>((resolve) => {
        scene.load.once('complete', () => {
          if (isCurrentTheme) {
            scene.imagesLoading = false;
            scene.imagesLoaded = true;
            scene.loadingPromise = null;
          }
          resolve();
        });
        scene.load.start();
      });

      if (isCurrentTheme) {
        scene.loadingPromise = loadPromise;
      }
      if (missingAudioQuestions.length > 0) {
        this.preloadThemeAudiosInBackground(targetThemeId, missingAudioQuestions);
      }
      return loadPromise;
    }

    if (isCurrentTheme) {
      scene.imagesLoading = false;
      scene.imagesLoaded = true;
      scene.loadingPromise = null;
    }
    if (missingAudioQuestions.length > 0) {
      this.preloadThemeAudiosInBackground(targetThemeId, missingAudioQuestions);
    }
  }

  public preloadThemeAudiosInBackground(
    themeId: string,
    audioQuestions: Array<Theme['questions'][number]>
  ): void {
    const scene = this.scene;
    if (!audioQuestions || audioQuestions.length === 0) return;
    void (async () => {
      const { getR2ImageUrl } = await import('@/src/config/r2Config');
      let queuedAudioCount = 0;
      audioQuestions.forEach((questionItem: Theme['questions'][number]) => {
        if (!questionItem.audio) return;
        const audioKey = scene.getAudioCacheKey(questionItem, themeId);
        if (!audioKey || scene.cache.audio.exists(audioKey)) return;
        const audioPath = getR2ImageUrl(questionItem.audio);
        scene.load.audio(audioKey, audioPath);
        queuedAudioCount += 1;
      });
      if (queuedAudioCount === 0) return;
      console.log(`[MainScene] Background loading ${queuedAudioCount} theme audios for ${themeId}`);
      if (!scene.load.isLoading()) {
        scene.load.start();
      }
    })().catch((error: unknown) => {
      console.warn('[MainScene] Failed to queue background audio preload', error);
    });
  }

  public async preloadNextTheme(): Promise<void> {
    const scene = this.scene;
    try {
      let nextThemeId = '';
      if (scene.currentThemes.length > 0) {
        if (scene.currentThemeIndex >= scene.currentThemes.length - 1) {
          return;
        }
        nextThemeId = scene.currentThemes[scene.currentThemeIndex + 1];
      } else {
        const themesList = scene.cache.json.get('themes_list');
        if (!themesList) return;
        const themes = extractThemesFromThemeList(themesList);
        const currentIndex = themes.findIndex((item: Theme) => item.id === scene.currentTheme);
        if (currentIndex === -1 || currentIndex >= themes.length - 1) return;
        nextThemeId = themes[currentIndex + 1].id;
      }

      console.log(`[preloadNextTheme] Starting background preload for: ${nextThemeId}`);
      prioritizeThemeInQueue(nextThemeId);
    } catch (error) {
      console.warn('[preloadNextTheme] Error:', error);
    }
  }
}
