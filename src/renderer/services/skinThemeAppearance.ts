import type { SkinPreferredAppearance as SkinPreferredAppearanceValue } from '../../shared/skin/constants';
import type { ActiveSkin } from './skin';
import { themeService } from './theme';

const SKIN_APPEARANCE_MARKER_KEY = 'lobster-skin-applied-appearance';

interface SkinAppearanceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface SkinAppearanceDependencies {
  storage: SkinAppearanceStorage | null;
  applyThemeAppearance: (appearance: SkinPreferredAppearanceValue) => Promise<boolean>;
}

const getDefaultStorage = (): SkinAppearanceStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const getDefaultDependencies = (): SkinAppearanceDependencies => ({
  storage: getDefaultStorage(),
  applyThemeAppearance: appearance => themeService.applyThemeAppearance(appearance),
});

const buildAppearanceMarker = (
  skinId: string,
  appearance: SkinPreferredAppearanceValue,
): string => `${skinId}:${appearance}`;

const removeAppearanceMarker = (storage: SkinAppearanceStorage | null): void => {
  try {
    storage?.removeItem(SKIN_APPEARANCE_MARKER_KEY);
  } catch {
    // The marker is an optimization; theme application remains functional without storage.
  }
};

export const clearSkinAppearanceMarker = (
  storage: SkinAppearanceStorage | null = getDefaultStorage(),
): void => {
  removeAppearanceMarker(storage);
};

export const applySkinPreferredAppearanceOnce = async (
  skin: Pick<ActiveSkin, 'id' | 'presentation'> | null,
  dependencies: SkinAppearanceDependencies = getDefaultDependencies(),
): Promise<boolean> => {
  const appearance = skin?.presentation?.preferredAppearance;
  if (!skin || !appearance) {
    removeAppearanceMarker(dependencies.storage);
    return false;
  }

  const marker = buildAppearanceMarker(skin.id, appearance);
  try {
    if (dependencies.storage?.getItem(SKIN_APPEARANCE_MARKER_KEY) === marker) {
      return false;
    }
  } catch {
    // Continue without marker-based de-duplication.
  }

  await dependencies.applyThemeAppearance(appearance);
  try {
    dependencies.storage?.setItem(SKIN_APPEARANCE_MARKER_KEY, marker);
  } catch {
    // Applying the existing theme is authoritative; marker persistence is best effort.
  }
  return true;
};

