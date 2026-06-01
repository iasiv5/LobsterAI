import { CheckIcon } from '@heroicons/react/24/outline';
import Lottie from 'lottie-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { getProviderIcon } from '../../providers/uiRegistry';
import { authService } from '../../services/auth';
import { i18nService } from '../../services/i18n';
import { localStore } from '../../services/store';
import { RootState } from '../../store';
import { setMediaModels, setMediaSelection } from '../../store/slices/coworkSlice';
import type { MediaGenerationMode, MediaModel } from '../../types/mediaGeneration';
import MagicIcon from '../icons/MagicIcon';
import mediaGenAnimation from '../icons/MediaGenIcon.json';

interface SavedMediaSelection {
  image?: { modelId: string; modelName: string };
  video?: { modelId: string; modelName: string };
}

const MEDIA_SELECTION_KV_KEY = 'media_selection';

const MEDIA_ICON_HINTS: Array<{ pattern: RegExp; providerKey: string }> = [
  { pattern: /doubao|seedream|豆包/i, providerKey: 'doubao' },
  { pattern: /minimax/i, providerKey: 'minimax' },
  { pattern: /qwen|qwq|wan2\.7|z-image/i, providerKey: 'qwen' },
  { pattern: /kling/i, providerKey: 'kling' },
  { pattern: /happyhorse|happy.horse/i, providerKey: 'happyhorse' },
];

const resolveMediaModelIcon = (model: MediaModel): React.ReactNode => {
  const text = `${model.displayName} ${model.modelId}`;
  const hint = MEDIA_ICON_HINTS.find(({ pattern }) => pattern.test(text));
  return getProviderIcon(hint?.providerKey ?? '');
};

interface MediaModelPickerProps {
  draftKey: string;
  disabled?: boolean;
}

const MediaModelPicker: React.FC<MediaModelPickerProps> = ({ draftKey, disabled }) => {
  const dispatch = useDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hoveredModel, setHoveredModel] = useState<MediaModel | null>(null);
  const [hoverCardStyle, setHoverCardStyle] = useState<React.CSSProperties>({});
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const authQuota = useSelector((state: RootState) => state.auth.quota);
  const canUseMediaGeneration = isLoggedIn && (authQuota?.subscriptionStatus === 'active' || authQuota?.hasPaidCredits === true);

  const mediaModels = useSelector((state: RootState) => state.cowork.mediaModels);
  const selection = useSelector((state: RootState) => state.cowork.mediaSelection[draftKey]);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const fetchModels = useCallback(async () => {
    const hasCachedModels = mediaModels.image.length > 0 || mediaModels.video.length > 0;
    if (!hasCachedModels) {
      setIsLoading(true);
    }
    try {
      const [imageResult, videoResult] = await Promise.all([
        window.electron.media.getModels('image'),
        window.electron.media.getModels('video'),
      ]);
      if (!imageResult.success) console.warn('[MediaModelPicker] image models fetch failed:', imageResult.error);
      if (!videoResult.success) console.warn('[MediaModelPicker] video models fetch failed:', videoResult.error);
      dispatch(setMediaModels({
        image: (imageResult.models || []) as MediaModel[],
        video: (videoResult.models || []) as MediaModel[],
      }));
      const imageModels = (imageResult.models || []) as MediaModel[];
      const videoModels = (videoResult.models || []) as MediaModel[];
      const currentSelection = selectionRef.current;
      if (!currentSelection || currentSelection.mode === 'none') {
        const saved = await localStore.getItem<SavedMediaSelection>(MEDIA_SELECTION_KV_KEY);
        const imageEntry = saved?.image;
        const videoEntry = saved?.video;
        const imageValid = imageEntry && imageModels.some(m => m.modelId === imageEntry.modelId);
        const videoValid = videoEntry && videoModels.some(m => m.modelId === videoEntry.modelId);

        if (imageValid && videoValid) {
          dispatch(setMediaSelection({
            draftKey,
            selection: {
              mode: 'auto',
              modelId: imageEntry.modelId,
              modelName: imageEntry.modelName,
              imageModelId: imageEntry.modelId,
              videoModelId: videoEntry!.modelId,
            },
          }));
        } else if (imageValid) {
          dispatch(setMediaSelection({
            draftKey,
            selection: { mode: 'image', modelId: imageEntry.modelId, modelName: imageEntry.modelName },
          }));
        } else if (videoValid) {
          dispatch(setMediaSelection({
            draftKey,
            selection: { mode: 'video', modelId: videoEntry!.modelId, modelName: videoEntry!.modelName },
          }));
          setActiveTab('video');
        }
      }
    } catch (err) {
      console.error('[MediaModelPicker] Failed to fetch models:', err);
    } finally {
      setIsLoading(false);
    }
  }, [dispatch, draftKey, mediaModels.image.length, mediaModels.video.length]);

  useEffect(() => {
    if (isOpen && canUseMediaGeneration) {
      fetchModels();
    }
  }, [isOpen, canUseMediaGeneration, fetchModels]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selection && selection.mode !== 'none') return;

    let cancelled = false;
    (async () => {
      const saved = await localStore.getItem<SavedMediaSelection>(MEDIA_SELECTION_KV_KEY);
      if (cancelled) return;
      const imageEntry = saved?.image;
      const videoEntry = saved?.video;
      if (imageEntry && videoEntry) {
        dispatch(setMediaSelection({
          draftKey,
          selection: {
            mode: 'auto',
            modelId: imageEntry.modelId,
            modelName: imageEntry.modelName,
            imageModelId: imageEntry.modelId,
            videoModelId: videoEntry.modelId,
          },
        }));
      } else if (imageEntry) {
        dispatch(setMediaSelection({
          draftKey,
          selection: { mode: 'image', modelId: imageEntry.modelId, modelName: imageEntry.modelName },
        }));
      } else if (videoEntry) {
        dispatch(setMediaSelection({
          draftKey,
          selection: { mode: 'video', modelId: videoEntry.modelId, modelName: videoEntry.modelName },
        }));
        setActiveTab('video');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, dispatch]);

  const handleSelect = async (mode: MediaGenerationMode, model?: MediaModel) => {
    const saved = await localStore.getItem<SavedMediaSelection>(MEDIA_SELECTION_KV_KEY) || {};
    const currentModelId = mode === 'image'
      ? (selection?.imageModelId ?? (selection?.mode === 'image' ? selection?.modelId : undefined))
      : (selection?.videoModelId ?? (selection?.mode === 'video' ? selection?.modelId : undefined));
    const isDeselect = model && currentModelId === model.modelId;

    if (isDeselect) {
      delete saved[mode as 'image' | 'video'];
    } else if (model) {
      saved[mode as 'image' | 'video'] = { modelId: model.modelId, modelName: model.displayName };
    }
    localStore.setItem(MEDIA_SELECTION_KV_KEY, saved);

    const hasImage = !!saved.image;
    const hasVideo = !!saved.video;

    if (hasImage && hasVideo) {
      dispatch(setMediaSelection({
        draftKey,
        selection: {
          mode: 'auto',
          modelId: saved[mode as 'image' | 'video']?.modelId,
          modelName: saved[mode as 'image' | 'video']?.modelName,
          imageModelId: saved.image!.modelId,
          videoModelId: saved.video!.modelId,
        },
      }));
    } else if (hasImage) {
      dispatch(setMediaSelection({
        draftKey,
        selection: { mode: 'image', modelId: saved.image!.modelId, modelName: saved.image!.modelName },
      }));
    } else if (hasVideo) {
      dispatch(setMediaSelection({
        draftKey,
        selection: { mode: 'video', modelId: saved.video!.modelId, modelName: saved.video!.modelName },
      }));
    } else {
      dispatch(setMediaSelection({ draftKey, selection: { mode: 'none' } }));
    }
  };

  const handleLogin = async () => {
    setIsOpen(false);
    await authService.login();
  };

  const handleSubscribe = async () => {
    setIsOpen(false);
    const { getPortalPricingUrl } = await import('../../services/endpoints');
    await window.electron.shell.openExternal(getPortalPricingUrl());
  };

  const handleModelHover = (model: MediaModel, event: React.MouseEvent<HTMLButtonElement>) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const itemRect = event.currentTarget.getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      const desc = model.description || model.capabilities || model.pricingDescription;
      if (!desc && !model.unitCredits) {
        setHoveredModel(null);
        return;
      }
      const dropdownEl = dropdownRef.current;
      if (!dropdownEl) return;
      const dropdownRect = dropdownEl.getBoundingClientRect();
      const spaceRight = window.innerWidth - dropdownRect.right;
      const cardWidth = 280;
      const style: React.CSSProperties = {
        position: 'fixed',
        zIndex: 10001,
      };
      const cardHeight = 300;
      if (itemRect.top + cardHeight > window.innerHeight) {
        style.bottom = 8;
      } else {
        style.top = itemRect.top;
      }
      if (spaceRight >= cardWidth + 8) {
        style.left = dropdownRect.right + 8;
      } else {
        style.right = window.innerWidth - dropdownRect.left + 8;
      }
      setHoverCardStyle(style);
      setHoveredModel(model);
    }, 200);
  };

  const handleModelHoverEnd = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredModel(null);
  };

  useEffect(() => {
    if (!isOpen) setHoveredModel(null);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const renderHoverCard = () => {
    if (!hoveredModel) return null;
    const desc = hoveredModel.description || hoveredModel.capabilities || hoveredModel.pricingDescription;
    const unitLabel = hoveredModel.unitLabel || (hoveredModel.mediaType === 'image' ? '张' : '个');
    const pricing = hoveredModel.pricing as {
      billingUnit?: string;
      tiers?: Array<{
        resolution?: string;
        duration?: number;
        audio?: boolean;
        hasVideoInput?: boolean;
        costYuan?: number;
        pricePerMillionTokens?: number;
      }>;
    } | undefined;
    const tiers = pricing?.tiers;
    const billingUnit = pricing?.billingUnit;

    const formatTierLabel = (tier: { resolution?: string; duration?: number; audio?: boolean; hasVideoInput?: boolean }) => {
      const parts: string[] = [];
      if (tier.resolution) parts.push(tier.resolution);
      if (tier.duration) parts.push(`${tier.duration}秒`);
      if (tier.audio) parts.push('有声音');
      if (tier.hasVideoInput === true) parts.push('含视频输入');
      if (tier.hasVideoInput === false) parts.push('不含视频输入');
      return parts.join(' ') || '-';
    };

    const tierCredits = (tier: { costYuan?: number; pricePerMillionTokens?: number }) => {
      if (tier.pricePerMillionTokens != null) return Math.round(tier.pricePerMillionTokens * 100);
      if (tier.costYuan != null) return Math.round(tier.costYuan * 100);
      return 0;
    };

    const tierUnitSuffix = billingUnit === 'per_second' ? '秒'
      : billingUnit === 'per_video' ? '个'
      : billingUnit === 'per_token' ? '百万tokens'
      : unitLabel;

    const hasVideoInputTiers = tiers && tiers.some(t => t.hasVideoInput !== undefined);
    const tierRows = (() => {
      if (!tiers || tiers.length <= 1) return null;
      if (!hasVideoInputTiers) return null;
      const resolutions = [...new Set(tiers.map(t => t.resolution).filter(Boolean))] as string[];
      return resolutions.map(res => {
        const withVideo = tiers.find(t => t.resolution === res && t.hasVideoInput === true);
        const withoutVideo = tiers.find(t => t.resolution === res && t.hasVideoInput === false);
        return { resolution: res, withVideo, withoutVideo };
      });
    })();

    const card = (
      <div style={hoverCardStyle} className="w-[280px] rounded-xl border border-border bg-surface shadow-popover p-3 pointer-events-none">
        <div className="text-[13px] font-semibold text-foreground leading-5">
          {hoveredModel.displayName}
        </div>
        {desc && (
          <div className="mt-1 text-[11px] text-secondary leading-4">
            {desc}
          </div>
        )}
        {tiers && tiers.length > 1 ? (
          tierRows ? (
            <table className="mt-2 w-full text-[10px] text-secondary border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left font-medium py-0.5 pr-1"></th>
                  <th className="text-right font-medium py-0.5 px-1">含视频输入</th>
                  <th className="text-right font-medium py-0.5">不含视频输入</th>
                </tr>
              </thead>
              <tbody>
                {tierRows.map((row) => (
                  <tr key={row.resolution}>
                    <td className="py-0.5 pr-1">{row.resolution}</td>
                    <td className="text-right py-0.5 px-1">{row.withVideo ? tierCredits(row.withVideo) : '-'}</td>
                    <td className="text-right py-0.5">{row.withoutVideo ? tierCredits(row.withoutVideo) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/50">
                  <td colSpan={3} className="text-right pt-0.5 text-[9px] text-tertiary">
                    {i18nService.t('authCreditsUnit')}/{tierUnitSuffix}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="mt-2 w-full text-[10px] text-secondary border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left font-medium py-0.5 pr-2">{i18nService.t('mediaTierSpecLabel')}</th>
                  <th className="text-right font-medium py-0.5">{i18nService.t('authCreditsUnit')}/{tierUnitSuffix}</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier, i) => (
                  <tr key={i}>
                    <td className="py-0.5 pr-2">{formatTierLabel(tier)}</td>
                    <td className="text-right py-0.5">{tierCredits(tier)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : hoveredModel.unitCredits != null && hoveredModel.unitCredits > 0 ? (
          <div className="mt-2 text-[11px] text-secondary">
            ({i18nService.t('modelCostMultiplierLabel')} {hoveredModel.unitCredits} {i18nService.t('authCreditsUnit')}/{unitLabel})
          </div>
        ) : null}
      </div>
    );
    return createPortal(card, document.body);
  };

  const currentModels = activeTab === 'image' ? mediaModels.image : mediaModels.video;

  const triggerIcon = (
    <MagicIcon className="h-5 w-5" />
  );

  const renderPromptPanel = (title: string, desc: string, btnLabel: string, onBtn: () => void, secondaryLabel?: string, onSecondary?: () => void) => (
    <div className="px-4 py-5">
      <div className="flex justify-center mb-3">
        <Lottie
          animationData={mediaGenAnimation}
          loop={false}
          autoplay={true}
          style={{ width: 80, height: 80 }}
          key={Date.now()}
        />
      </div>
      <div className="text-[13px] font-medium text-foreground text-center">{title}</div>
      <div className="text-[12px] text-secondary mt-1 text-center">{desc}</div>
      <button
        type="button"
        onClick={onBtn}
        className="mt-3 w-full rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary/90 transition-colors"
      >
        {btnLabel}
      </button>
      {secondaryLabel && onSecondary && (
        <div
          onClick={onSecondary}
          className="mt-2 text-center text-[12px] text-secondary hover:text-foreground cursor-pointer transition-colors"
        >
          {secondaryLabel}
        </div>
      )}
    </div>
  );

  const renderDropdownContent = () => {
    if (!isLoggedIn) {
      return renderPromptPanel(
        i18nService.t('mediaLoginTitle'),
        i18nService.t('mediaLoginDesc'),
        i18nService.t('mediaLoginBtn'),
        handleLogin,
        i18nService.t('mediaLearnMore'),
        handleSubscribe,
      );
    }

    if (!canUseMediaGeneration) {
      return renderPromptPanel(
        i18nService.t('mediaSubscribeTitle'),
        i18nService.t('mediaSubscribeDesc'),
        i18nService.t('mediaSubscribeBtn'),
        handleSubscribe,
      );
    }

  const handleTabSwitch = (tab: 'image' | 'video') => {
    setActiveTab(tab);
  };

    return (
      <>
        {/* Tabs */}
        <div className="border-b border-border/60 p-2">
          <div className="flex rounded-lg bg-surface-raised p-0.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'image'}
              onClick={() => handleTabSwitch('image')}
              className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-center text-[12px] font-medium leading-4 transition-colors ${
                activeTab === 'image'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-secondary hover:text-foreground'
              }`}
            >
              <span className="truncate">{i18nService.t('mediaImage')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'video'}
              onClick={() => handleTabSwitch('video')}
              className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-center text-[12px] font-medium leading-4 transition-colors ${
                activeTab === 'video'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-secondary hover:text-foreground'
              }`}
            >
              <span className="truncate">{i18nService.t('mediaVideo')}</span>
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="max-h-72 overflow-y-auto py-1">
          {isLoading ? (
            <div className="px-2 py-3 text-center text-xs text-secondary">
              {i18nService.t('mediaLoadingModels')}
            </div>
          ) : currentModels.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-secondary">
              {i18nService.t('mediaNoModels')}
            </div>
          ) : (
            currentModels.map((model) => {
              const isSelected = activeTab === 'image'
                ? (selection?.imageModelId === model.modelId || (selection?.mode === 'image' && selection?.modelId === model.modelId))
                : (selection?.videoModelId === model.modelId || (selection?.mode === 'video' && selection?.modelId === model.modelId));
              return (
                <button
                  key={model.modelId}
                  type="button"
                  onClick={() => handleSelect(activeTab, model)}
                  onMouseEnter={(e) => handleModelHover(model, e)}
                  onMouseLeave={handleModelHoverEnd}
                  className={`flex w-full items-center gap-2.5 rounded px-2 py-2 text-left text-xs transition-colors hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover ${isSelected ? 'dark:bg-claude-darkSurfaceHover/50 bg-claude-surfaceHover/50' : ''}`}
                >
                  <span className="shrink-0 h-4 w-4 [&_svg]:h-4 [&_svg]:w-4">{resolveMediaModelIcon(model)}</span>
                  <span className="min-w-0 truncate text-[13px] font-normal leading-5">{model.displayName}</span>
                  {activeTab === 'image' && model.unitCredits != null && model.unitCredits > 0 && (
                    <span className="shrink-0 text-[11px] text-secondary whitespace-nowrap">
                      x{model.unitCredits} {i18nService.t('authCreditsUnit')}/{model.unitLabel || '张'}
                    </span>
                  )}
                  <span className="flex-1" />
                  {isSelected && (
                    <CheckIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </>
    );
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex h-[34px] w-[34px] items-center justify-center rounded-lg transition-colors ${
          selection && selection.mode !== 'none'
            ? 'text-foreground hover:bg-surface-raised'
            : 'text-secondary hover:bg-surface-raised hover:text-foreground/80'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {triggerIcon}
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 z-50 mb-1 w-60 rounded-xl border border-border bg-surface shadow-popover overflow-hidden"
        >
          {renderDropdownContent()}
        </div>
      )}
      {renderHoverCard()}
    </div>
  );
};

export default MediaModelPicker;
