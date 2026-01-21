import { getR2ImageUrl, getR2ThemesListUrl } from '@/src/config/r2Config';
import Phaser from 'phaser';
import { Theme, ThemeId } from '../../types';

export class PreloadScene extends Phaser.Scene {
  private currentTheme: ThemeId = '';

  constructor() {
    super({ key: 'PreloadScene' });
  }

  init(data: { theme?: ThemeId }) {
    const initialThemes = this.registry.get('initialThemes');
    const initialTheme = this.registry.get('initialTheme');
    this.currentTheme = data.theme || (initialThemes && initialThemes.length > 0 ? initialThemes[0] : initialTheme) || '';
  }

  preload() {
    console.time('[PreloadScene] preload');
    
    // Register loader events
    this.load.on('complete', () => {
      console.timeEnd('[PreloadScene] preload');
      this.scene.start('MainScene', { theme: this.currentTheme, dpr: this.registry.get('dpr') || 1 });
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

    const themesList = this.cache.json.get('themes_list');
    if (themesList) {
      this.loadThemeAssets(themesList);
      return;
    }

    this.load.json('themes_list', getR2ThemesListUrl());
    this.load.once('filecomplete-json-themes_list', () => {
      const loaded = this.cache.json.get('themes_list');
      if (loaded) this.loadThemeAssets(loaded);
    });
  }

  private loadGameAssets() {
    const soundBase = 'asserts/kenney/Sounds/';
    this.load.audio('sfx_jump', [
        `${soundBase}sfx_jump-high.mp3`,
        `${soundBase}sfx_jump-high.ogg`
    ]);
    this.load.audio('sfx_success', [
        `${soundBase}sfx_coin.mp3`,
        `${soundBase}sfx_coin.ogg`
    ]);
    this.load.audio('sfx_failure', [
        `${soundBase}sfx_disappear.mp3`,
        `${soundBase}sfx_disappear.ogg`
    ]);
    this.load.audio('sfx_bump', [
        `${soundBase}sfx_bump.mp3`,
        `${soundBase}sfx_bump.ogg`
    ]);

    const kenneyBase = '/asserts/kenney/Vector/';
    
    const { height } = this.scale;
    const gameScale = height / 1080;
    const rawDpr = this.registry.get('dpr') || window.devicePixelRatio || 1;
    const dprScale = Math.min(rawDpr, 2);
    const targetBeeSize = Math.round(100 * gameScale * dprScale);
    const charTextureSize = Math.round(180 * gameScale * dprScale);
    const tileTextureSize = Math.round(320 * gameScale * dprScale);
    
    if (!this.textures.exists('p1_stand')) {
        this.load.svg('p1_stand', `${kenneyBase}Characters/character_pink_idle.svg`, { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_jump', `${kenneyBase}Characters/character_pink_jump.svg`, { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_walk_a', `${kenneyBase}Characters/character_pink_walk_a.svg`, { width: charTextureSize, height: charTextureSize });
        this.load.svg('p1_walk_b', `${kenneyBase}Characters/character_pink_walk_b.svg`, { width: charTextureSize, height: charTextureSize });
    }
        
    if (!this.textures.exists('tile_box')) {
        this.load.svg('tile_box', `${kenneyBase}Tiles/block_empty.svg`, { width: tileTextureSize, height: tileTextureSize });
    }
        
    if (!this.textures.exists('bee_a')) {
        this.load.svg('bee_a', `${kenneyBase}Enemies/bee_a.svg`, { width: targetBeeSize, height: targetBeeSize });
    }
    if (!this.textures.exists('bee_b')) {
        this.load.svg('bee_b', `${kenneyBase}Enemies/bee_b.svg`, { width: targetBeeSize, height: targetBeeSize });
    }
  }

  private loadThemeAssets(themesList: any) {
    const themes = themesList.themes || [];
    const targetTheme = themes.find((t: Theme) => t.id === this.currentTheme);

    if (!targetTheme) {
        console.error(`[PreloadScene] Theme ${this.currentTheme} not found`);
        return;
    }

    console.log(`[PreloadScene] Queueing ${targetTheme.questions.length} images for ${this.currentTheme}`);
    
    targetTheme.questions.forEach((q: any) => {
        // Force .webp extension
        const imageName = q.image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        const imagePath = getR2ImageUrl(imageName);
        // Standardize key format: theme_{id}_{image_name_no_ext}
        const key = `theme_${this.currentTheme}_${q.image.replace(/\.(png|jpg|jpeg|webp)$/i, '')}`;
        
        // Only load if not already in texture manager
        if (!this.textures.exists(key)) {
            this.load.image(key, imagePath);
        }
    });
  }
}
