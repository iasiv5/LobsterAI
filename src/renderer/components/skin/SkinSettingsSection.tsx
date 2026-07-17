import React, { useState } from 'react';

import { SkinAssetSlot } from '../../../shared/skin/constants';
import { useSkin } from '../../providers/SkinProvider';
import { i18nService } from '../../services/i18n';
import { buildSkinAssetUrl } from '../../services/skin';
import TrashIcon from '../icons/TrashIcon';
import SkinDeleteConfirmDialog from './SkinDeleteConfirmDialog';

const SkinActionErrorKind = {
  Apply: 'apply',
  Deactivate: 'deactivate',
  Delete: 'delete',
} as const;

type SkinActionError = typeof SkinActionErrorKind[keyof typeof SkinActionErrorKind] | null;

const SkinActionErrorI18nKey = {
  [SkinActionErrorKind.Apply]: 'aiSkinApplyFailed',
  [SkinActionErrorKind.Deactivate]: 'aiSkinRestoreFailed',
  [SkinActionErrorKind.Delete]: 'aiSkinDeleteFailed',
} as const;

interface PendingSkinDeletion {
  id: string;
  label: string;
  isActive: boolean;
}

const SkinSettingsSection: React.FC = () => {
  const {
    activeSkin,
    apply,
    deactivate,
    deleteSkin,
    isLoading,
    refreshVersion,
    savedSkins,
  } = useSkin();
  const [applyingSkinId, setApplyingSkinId] = useState<string | null>(null);
  const [deletingSkinId, setDeletingSkinId] = useState<string | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [actionError, setActionError] = useState<SkinActionError>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingSkinDeletion | null>(null);

  const handleApply = async (skinId: string) => {
    setActionError(null);
    setApplyingSkinId(skinId);
    try {
      await apply(skinId);
    } catch (error) {
      console.error('[Skin] Failed to apply a saved skin', error);
      setActionError(SkinActionErrorKind.Apply);
    } finally {
      setApplyingSkinId(null);
    }
  };

  const handleDeactivate = async () => {
    setActionError(null);
    setIsDeactivating(true);
    try {
      await deactivate();
    } catch (error) {
      console.error('[Skin] Failed to restore the default skin', error);
      setActionError(SkinActionErrorKind.Deactivate);
    } finally {
      setIsDeactivating(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeletion) return;
    setActionError(null);
    setDeletingSkinId(pendingDeletion.id);
    try {
      await deleteSkin(pendingDeletion.id);
      setPendingDeletion(null);
    } catch (error) {
      console.error('[Skin] Failed to delete a saved skin', error);
      setActionError(SkinActionErrorKind.Delete);
      setPendingDeletion(null);
    } finally {
      setDeletingSkinId(null);
    }
  };

  const activeSkinLabel = activeSkin?.name ?? activeSkin?.id;
  const isMutating = applyingSkinId !== null || deletingSkinId !== null || isDeactivating;

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">
            {i18nService.t('aiSkin')}
          </h4>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {i18nService.t('aiSkinDescription')}
          </p>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {activeSkinLabel
              ? `${i18nService.t('aiSkinActive')}: ${activeSkinLabel}`
              : i18nService.t('aiSkinNone')}
          </p>
          {actionError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {i18nService.t(SkinActionErrorI18nKey[actionError])}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleDeactivate()}
          disabled={!activeSkin || isLoading || isMutating}
          className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeactivating
            ? i18nService.t('aiSkinRestoring')
            : i18nService.t('aiSkinRestoreDefault')}
        </button>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div>
          <h5 className="text-xs font-medium text-foreground">
            {i18nService.t('aiSkinLibrary')}
          </h5>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {i18nService.t('aiSkinPreviewHint')}
          </p>
        </div>

        {savedSkins.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {savedSkins.map((skin) => {
              const isActive = skin.id === activeSkin?.id;
              const backdropUrl = buildSkinAssetUrl(
                skin.assets[SkinAssetSlot.WorkspaceBackdrop],
                refreshVersion,
              );
              const emblemUrl = buildSkinAssetUrl(
                skin.assets[SkinAssetSlot.HomeEmblem],
                refreshVersion,
              );
              const label = skin.name ?? skin.id;

              return (
                <article
                  key={skin.id}
                  className={`relative h-36 overflow-hidden rounded-xl border bg-background ${
                    isActive ? 'border-primary' : 'border-border'
                  }`}
                >
                  {backdropUrl && (
                    <img
                      src={backdropUrl}
                      alt=""
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-cover object-center"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/5" />
                  {emblemUrl && (
                    <img
                      src={emblemUrl}
                      alt=""
                      draggable={false}
                      className="absolute left-3 top-3 h-11 w-11 rounded-lg border border-white/40 bg-white/85 object-contain p-1 shadow-sm"
                    />
                  )}
                  {isActive && (
                    <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-sm">
                      {i18nService.t('aiSkinCurrent')}
                    </span>
                  )}
                  <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-white drop-shadow-sm">
                      {label}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => void handleApply(skin.id)}
                          disabled={isLoading || isMutating}
                          className="shrink-0 rounded-lg bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {applyingSkinId === skin.id
                            ? i18nService.t('aiSkinApplying')
                            : i18nService.t('aiSkinApply')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDeletion({
                            id: skin.id,
                            label,
                            isActive,
                          })
                        }
                        disabled={isLoading || isMutating}
                        title={i18nService.t('aiSkinDelete')}
                        aria-label={i18nService.t('aiSkinDeleteLabel').replace('{name}', label)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/90 text-destructive shadow-sm backdrop-blur-sm transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-secondary">
            {isLoading ? i18nService.t('loading') : i18nService.t('aiSkinEmpty')}
          </div>
        )}
      </div>
      {pendingDeletion && (
        <SkinDeleteConfirmDialog
          skinName={pendingDeletion.label}
          isActive={pendingDeletion.isActive}
          isDeleting={deletingSkinId === pendingDeletion.id}
          onCancel={() => setPendingDeletion(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </section>
  );
};

export default SkinSettingsSection;
