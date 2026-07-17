import { describe, expect, test, vi } from 'vitest';

import {
  SkinPreferredAppearance,
  SkinPresentationMode,
} from '../../shared/skin/constants';
import type { ActiveSkin } from './skin';
import {
  applySkinPreferredAppearanceOnce,
  clearSkinAppearanceMarker,
} from './skinThemeAppearance';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
};

const darkSkin: Pick<ActiveSkin, 'id' | 'presentation'> = {
  id: 'dark-red',
  presentation: {
    mode: SkinPresentationMode.ImmersiveShell,
    preferredAppearance: SkinPreferredAppearance.Dark,
    palette: {
      canvas: '#110a0a',
      panel: '#1f0e0e',
      panelRaised: '#2d1515',
      accent: '#e5b941',
      accentForeground: '#160b0d',
      accentAlt: '#d4372b',
      foreground: '#f2e6d9',
      muted: '#b8948a',
      border: '#745126',
    },
  },
};

describe('skin preferred appearance application', () => {
  test('applies one skin appearance once and remembers the completed activation', async () => {
    const storage = createStorage();
    const applyThemeAppearance = vi.fn(async () => true);
    const dependencies = { storage, applyThemeAppearance };

    await expect(applySkinPreferredAppearanceOnce(darkSkin, dependencies)).resolves.toBe(true);
    await expect(applySkinPreferredAppearanceOnce(darkSkin, dependencies)).resolves.toBe(false);

    expect(applyThemeAppearance).toHaveBeenCalledOnce();
    expect(applyThemeAppearance).toHaveBeenCalledWith(SkinPreferredAppearance.Dark);
  });

  test('clears the activation marker after the skin is disabled', async () => {
    const storage = createStorage();
    const applyThemeAppearance = vi.fn(async () => true);
    const dependencies = { storage, applyThemeAppearance };

    await applySkinPreferredAppearanceOnce(darkSkin, dependencies);
    clearSkinAppearanceMarker(storage);
    await applySkinPreferredAppearanceOnce(darkSkin, dependencies);

    expect(applyThemeAppearance).toHaveBeenCalledTimes(2);
  });

  test('does not change the theme for a legacy skin without presentation metadata', async () => {
    const storage = createStorage();
    const applyThemeAppearance = vi.fn(async () => true);

    await expect(applySkinPreferredAppearanceOnce(
      { id: 'legacy-skin' },
      { storage, applyThemeAppearance },
    )).resolves.toBe(false);

    expect(applyThemeAppearance).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledOnce();
  });
});

