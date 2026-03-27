import type { Theme } from '../../types';

interface ThemeListWithThemes {
  themes?: Theme[];
}

interface ThemeListWithLevels {
  levels?: Record<string, { themes?: Theme[] }>;
}

export const extractThemesFromThemeList = (themeList: unknown): Theme[] => {
  if (!themeList || typeof themeList !== 'object') {
    return [];
  }

  const themeListWithThemes = themeList as ThemeListWithThemes;
  if (Array.isArray(themeListWithThemes.themes)) {
    return themeListWithThemes.themes;
  }

  const themeListWithLevels = themeList as ThemeListWithLevels;
  if (!themeListWithLevels.levels || typeof themeListWithLevels.levels !== 'object') {
    return [];
  }

  return Object.values(themeListWithLevels.levels).flatMap((level) => {
    return Array.isArray(level?.themes) ? level.themes : [];
  });
};

export const findThemeById = (themeList: unknown, themeId: string): Theme | undefined => {
  if (!themeId) {
    return undefined;
  }

  return extractThemesFromThemeList(themeList).find((theme) => theme.id === themeId);
};
