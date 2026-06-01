import { ArrowDownTrayIcon, ArrowLeftIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { kitService } from '../../services/kit';
import { resolveLocalizedText } from '../../services/skill';
import { setInstalledKits as setInstalledKitsAction, setMarketplaceKits } from '../../store/slices/kitSlice';
import type { InstalledKit, MarketplaceKit } from '../../types/kit';
import Modal from '../common/Modal';
import SearchIcon from '../icons/SearchIcon';
import SidebarKitsIcon from '../icons/SidebarKitsIcon';

const KitOperationType = {
  Install: 'install',
  Uninstall: 'uninstall',
} as const;

type KitOperationType = typeof KitOperationType[keyof typeof KitOperationType];

interface KitsManagerProps {
  onTryAsking?: (text: string, kitId: string) => void;
}

const KitsManager: React.FC<KitsManagerProps> = ({ onTryAsking }) => {
  const dispatch = useDispatch();
  const [kits, setKits] = useState<MarketplaceKit[]>([]);
  const [installedKits, setInstalledKits] = useState<Record<string, InstalledKit>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKit, setSelectedKit] = useState<MarketplaceKit | null>(null);
  const [operatingKitId, setOperatingKitId] = useState<string | null>(null);
  const [operationType, setOperationType] = useState<KitOperationType | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{ kitId: string; text: string } | null>(null);
  const [kitPendingUninstall, setKitPendingUninstall] = useState<MarketplaceKit | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [marketKits, installed] = await Promise.all([
      kitService.fetchMarketplaceKits(),
      kitService.getInstalledKits(),
    ]);
    setKits(marketKits);
    setInstalledKits(installed);
    dispatch(setMarketplaceKits(marketKits));
    dispatch(setInstalledKitsAction(installed));
    setIsLoading(false);
  }, [dispatch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredKits = useMemo(() => {
    let results = kits;
    // Search filtering
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      results = results.filter((kit) => {
        const name = resolveLocalizedText(kit.name).toLowerCase();
        const desc = resolveLocalizedText(kit.description).toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    return results;
  }, [kits, searchQuery]);

  const handleInstall = async (kit: MarketplaceKit) => {
    setOperatingKitId(kit.id);
    setOperationType(KitOperationType.Install);
    try {
      const result = await kitService.installKit(kit);
      if (result.success) {
        const installed = await kitService.getInstalledKits();
        setInstalledKits(installed);
        dispatch(setInstalledKitsAction(installed));
      } else {
        console.error('[KitsManager] Install failed:', result.error);
      }
    } finally {
      setOperatingKitId(null);
      setOperationType(null);
    }
  };

  const handleRequestUninstall = (kit: MarketplaceKit) => {
    setKitPendingUninstall(kit);
  };

  const handleCancelUninstall = () => {
    if (operationType === KitOperationType.Uninstall) return;
    setKitPendingUninstall(null);
  };

  const handleUninstall = async (kitId: string) => {
    setOperatingKitId(kitId);
    setOperationType(KitOperationType.Uninstall);
    try {
      const result = await kitService.uninstallKit(kitId);
      if (result.success) {
        const installed = await kitService.getInstalledKits();
        setInstalledKits(installed);
        dispatch(setInstalledKitsAction(installed));
      } else {
        console.error('[KitsManager] Uninstall failed:', result.error);
      }
    } finally {
      setOperatingKitId(null);
      setOperationType(null);
      setKitPendingUninstall(null);
    }
  };

  const handleConfirmUninstall = async () => {
    if (!kitPendingUninstall || operationType === KitOperationType.Uninstall) return;
    await handleUninstall(kitPendingUninstall.id);
  };

  const isKitInstalled = (kitId: string) => !!installedKits[kitId];
  const isOperating = (kitId: string) => operatingKitId === kitId;

  const handleTryAskingClick = (text: string, kitId: string) => {
    if (isKitInstalled(kitId)) {
      onTryAsking?.(text, kitId);
    } else {
      setInstallPrompt({ kitId, text });
    }
  };

  const handleInstallAndTry = async () => {
    if (!installPrompt || !selectedKit) return;
    const { kitId, text } = installPrompt;
    setInstallPrompt(null);
    await handleInstall(selectedKit);
    // After install, check if it succeeded and navigate
    const installed = await kitService.getInstalledKits();
    if (installed[kitId]) {
      onTryAsking?.(text, kitId);
    }
  };

  const uninstallConfirmModal = kitPendingUninstall ? (
    <Modal
      onClose={handleCancelUninstall}
      overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
      className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface shadow-modal p-5"
    >
      <div className="text-lg font-semibold text-foreground">
        {i18nService.t('kitUninstall')}
      </div>
      <p className="mt-2 text-sm text-secondary">
        {i18nService.t('kitUninstallConfirm').replace(
          '{name}',
          resolveLocalizedText(kitPendingUninstall.name),
        )}
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancelUninstall}
          disabled={operationType === KitOperationType.Uninstall}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-secondary hover:bg-surface-raised transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {i18nService.t('cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirmUninstall}
          disabled={operationType === KitOperationType.Uninstall}
          className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {i18nService.t('confirmDelete')}
        </button>
      </div>
    </Modal>
  ) : null;

  // Detail view
  if (selectedKit) {
    const installed = isKitInstalled(selectedKit.id);
    const operating = isOperating(selectedKit.id);

    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          type="button"
          onClick={() => setSelectedKit(null)}
          className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {i18nService.t('kitBack')}
        </button>

        {/* Kit header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0">
              <SidebarKitsIcon className="h-6 w-6 text-secondary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{resolveLocalizedText(selectedKit.name)}</h2>
            </div>
          </div>
          {installed ? (
            <button
              type="button"
              disabled={operating}
              onClick={() => handleRequestUninstall(selectedKit)}
              className="p-1.5 rounded-lg text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={operating}
              onClick={() => handleInstall(selectedKit)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              {operating && operationType === KitOperationType.Install
                ? i18nService.t('kitInstalling')
                : i18nService.t('kitInstall')}
            </button>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-secondary leading-relaxed">
          {resolveLocalizedText(selectedKit.description)}
        </p>

        {/* Try asking */}
        {selectedKit.tryAsking && selectedKit.tryAsking.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              {i18nService.t('kitTryAsking')}
            </h3>
            <div className="space-y-2">
              {selectedKit.tryAsking.map((prompt, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-surface hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => handleTryAskingClick(resolveLocalizedText(prompt), selectedKit.id)}
                >
                  <span className="text-sm text-foreground">{resolveLocalizedText(prompt)}</span>
                  <ArrowLeftIcon className="h-3.5 w-3.5 text-secondary rotate-180 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills list */}
        {selectedKit.skills && selectedKit.skills.list.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              {i18nService.t('kitSkills')} {selectedKit.skills.list.length}
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedKit.skills.list.map((skill) => (
                <span
                  key={skill.id}
                  className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg bg-surface-raised text-secondary border border-border"
                >
                  {resolveLocalizedText(skill.name).replace(/^\//, '')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Install confirmation dialog */}
        {installPrompt && (
          <Modal
            onClose={() => setInstallPrompt(null)}
            overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
            className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface shadow-modal overflow-hidden"
          >
            <div className="px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">
                {i18nService.t('kitInstallRequired')}
              </h2>
              <p className="mt-1.5 text-sm leading-5 text-secondary">
                {i18nService.t('kitInstallRequiredDesc')}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setInstallPrompt(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleInstallAndTry}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
              >
                {i18nService.t('kitInstall')}
              </button>
            </div>
          </Modal>
        )}

        {uninstallConfirmModal}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      {/* Description */}
      <div>
        <p className="text-sm text-secondary">
          {i18nService.t('kitDescription')}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={i18nService.t('kitSearchPlaceholder')}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface text-foreground placeholder:text-secondary/60 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-secondary hover:text-foreground transition-colors"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-border">
        <button
          type="button"
          className="px-4 py-2 text-sm font-medium text-foreground transition-colors relative"
        >
          {i18nService.t('kitMarketplace')}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
        </button>
      </div>

      {/* Kit grid */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-secondary">
          {i18nService.t('kitLoading')}
        </div>
      ) : filteredKits.length === 0 ? (
        <div className="text-center py-12 text-sm text-secondary">
          {i18nService.t('kitEmpty')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredKits.map((kit) => {
            const installed = isKitInstalled(kit.id);
            const operating = isOperating(kit.id);

            return (
              <div
                key={kit.id}
                className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary cursor-pointer flex flex-col"
                onClick={() => setSelectedKit(kit)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
                      <SidebarKitsIcon className="h-4 w-4 text-secondary" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {resolveLocalizedText(kit.name)}
                      </span>
                    </div>
                  </div>
                  {installed ? (
                    <button
                      type="button"
                      disabled={operating}
                      onClick={(e) => { e.stopPropagation(); handleRequestUninstall(kit); }}
                      className="p-1 rounded-lg text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-50"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={operating}
                      onClick={(e) => { e.stopPropagation(); handleInstall(kit); }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors flex-shrink-0 disabled:opacity-50"
                    >
                      <ArrowDownTrayIcon className="h-3 w-3" />
                      {operating && operationType === KitOperationType.Install
                        ? i18nService.t('kitInstalling')
                        : i18nService.t('kitInstall')}
                    </button>
                  )}
                </div>

                <p className="text-xs text-secondary line-clamp-2 mb-2 flex-1">
                  {resolveLocalizedText(kit.description)}
                </p>

                {/* Bottom metadata row */}
                <div className="flex items-center gap-2 text-[10px] text-secondary">
                  {kit.author && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-primary-muted text-primary font-medium">
                        {i18nService.t('kitOfficial')}
                      </span>
                      <span>·</span>
                    </>
                  )}
                  {kit.version && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                        v{kit.version}
                      </span>
                      <span>·</span>
                    </>
                  )}
                  {kit.skills && kit.skills.list.length > 0 && (
                    <span>
                      {i18nService.t('kitSkillCount').replace('{count}', String(kit.skills.list.length))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uninstallConfirmModal}
    </div>
  );
};

export default KitsManager;
