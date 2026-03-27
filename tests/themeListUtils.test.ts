import test from 'node:test';
import assert from 'node:assert/strict';

import { extractThemesFromThemeList, findThemeById } from '../game/runtime/themeListUtils.ts';

test('extractThemesFromThemeList supports levels structure', () => {
  const themeList = {
    levels: {
      A: {
        themes: [
          { id: 'alpha', name: 'Alpha', icon: 'a', questions: [] }
        ]
      },
      B: {
        themes: [
          { id: 'beta', name: 'Beta', icon: 'b', questions: [] }
        ]
      }
    }
  };

  const themes = extractThemesFromThemeList(themeList);

  assert.equal(themes.length, 2);
  assert.deepEqual(themes.map((theme) => theme.id), ['alpha', 'beta']);
});

test('findThemeById supports flat themes structure', () => {
  const themeList = {
    themes: [
      { id: 'alpha', name: 'Alpha', icon: 'a', questions: [] },
      { id: 'beta', name: 'Beta', icon: 'b', questions: [] }
    ]
  };

  const theme = findThemeById(themeList, 'beta');

  assert.ok(theme);
  assert.equal(theme.id, 'beta');
});
