import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { SkinAssetSlot } from '../../shared/skin/constants';
import {
  type ActiveSkin,
  buildSkinAssetUrl,
  skinService,
} from '../services/skin';
import { applySkinPreferredAppearanceOnce } from '../services/skinThemeAppearance';

interface SkinContextValue {
  activeSkin: ActiveSkin | null;
  savedSkins: ActiveSkin[];
  isLoading: boolean;
  refreshVersion: number;
  refresh: () => Promise<void>;
  apply: (skinId: string) => Promise<void>;
  deactivate: () => Promise<void>;
  deleteSkin: (skinId: string) => Promise<void>;
}

const SkinContext = createContext<SkinContextValue | null>(null);

export const SkinProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [activeSkin, setActiveSkin] = useState<ActiveSkin | null>(null);
  const [savedSkins, setSavedSkins] = useState<ActiveSkin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const loadSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setIsLoading(true);

    try {
      const [nextSkin, nextSavedSkins] = await Promise.all([
        skinService.getActive(),
        skinService.list(),
      ]);
      if (loadSequence !== loadSequenceRef.current) return;

      setActiveSkin(nextSkin);
      setSavedSkins(nextSavedSkins);
      setRefreshVersion(version => version + 1);
    } catch (error) {
      if (loadSequence !== loadSequenceRef.current) return;
      console.error('[Skin] Failed to load the active skin', error);
    } finally {
      if (loadSequence === loadSequenceRef.current) setIsLoading(false);
    }
  }, []);

  const apply = useCallback(async (skinId: string) => {
    await skinService.apply(skinId);
    await refresh();
  }, [refresh]);

  const deactivate = useCallback(async () => {
    await skinService.deactivate();
    await refresh();
  }, [refresh]);

  const deleteSkin = useCallback(async (skinId: string) => {
    await skinService.delete(skinId);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    return skinService.subscribe(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (isLoading) return;
    void applySkinPreferredAppearanceOnce(activeSkin).catch((error) => {
      console.error('[Skin] Failed to apply the recommended color appearance', error);
    });
  }, [activeSkin, isLoading]);

  const value = useMemo<SkinContextValue>(() => ({
    activeSkin,
    savedSkins,
    isLoading,
    refreshVersion,
    refresh,
    apply,
    deactivate,
    deleteSkin,
  }), [
    activeSkin,
    apply,
    deactivate,
    deleteSkin,
    isLoading,
    refresh,
    refreshVersion,
    savedSkins,
  ]);

  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
};

export const useSkin = (): SkinContextValue => {
  const context = useContext(SkinContext);
  if (!context) throw new Error('useSkin must be used within SkinProvider');
  return context;
};

export const useSkinAsset = (slot: SkinAssetSlot): string | null => {
  const { activeSkin, refreshVersion } = useSkin();
  return useMemo(
    () => buildSkinAssetUrl(activeSkin?.assets[slot], refreshVersion),
    [activeSkin, refreshVersion, slot],
  );
};
