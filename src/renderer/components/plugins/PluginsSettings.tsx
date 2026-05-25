import { ArrowPathIcon, Cog6ToothIcon,PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef,useState } from 'react';

import { i18nService } from '../../services/i18n';
import PluginConfigPage from './PluginConfigPage';

type PluginSource = 'npm' | 'clawhub' | 'git' | 'local' | 'openclaw';

interface PluginListItem {
  pluginId: string;
  version?: string;
  description?: string;
  source: PluginSource | 'bundled';
  enabled: boolean;
  canUninstall: boolean;
  hasConfig: boolean;
}

interface InstallForm {
  source: PluginSource;
  spec: string;
  registry: string;
  version: string;
}

export default function PluginsSettings() {
  const [plugins, setPlugins] = useState<PluginListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<string>('');
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [configPluginId, setConfigPluginId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [detectedPlugins, setDetectedPlugins] = useState<string[] | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const [form, setForm] = useState<InstallForm>({
    source: 'npm',
    spec: '',
    registry: '',
    version: '',
  });

  const loadPlugins = useCallback(async () => {
    const result = await window.electron?.plugins.list();
    if (result?.success && result.plugins) {
      setPlugins(result.plugins);
    }
    setLoading(false);
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await window.electron?.plugins.sync();
      if (result && result.synced.length > 0) {
        await loadPlugins();
      }
    } finally {
      setSyncing(false);
      setDetectedPlugins(null);
    }
  }, [loadPlugins]);

  useEffect(() => {
    // On mount: load plugins and detect any unsynced ones from OpenClaw
    const init = async () => {
      await loadPlugins();
      const detectResult = await window.electron?.plugins.detect();
      if (detectResult && detectResult.plugins.length > 0) {
        setDetectedPlugins(detectResult.plugins);
      }
    };
    init();
  }, [loadPlugins]);

  // Listen for install log events
  useEffect(() => {
    if (!installing) return;
    const cleanup = window.electron?.plugins.onInstallLog((line: string) => {
      setInstallLog(prev => prev + line);
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    });
    return cleanup;
  }, [installing]);

  const handleToggle = async (pluginId: string, enabled: boolean) => {
    await window.electron?.plugins.setEnabled(pluginId, enabled);
    setPlugins(prev =>
      prev.map(p => p.pluginId === pluginId ? { ...p, enabled } : p),
    );
  };

  const handleUninstall = async (pluginId: string) => {
    setUninstalling(true);
    const result = await window.electron?.plugins.uninstall(pluginId);
    setUninstalling(false);
    if (result?.ok) {
      setPlugins(prev => prev.filter(p => p.pluginId !== pluginId));
    }
    setConfirmUninstall(null);
  };

  const handleInstall = async () => {
    if (!form.spec.trim()) return;
    setInstalling(true);
    setInstallError(null);
    setInstallLog('');

    const params: {
      source: PluginSource;
      spec: string;
      registry?: string;
      version?: string;
    } = {
      source: form.source,
      spec: form.spec.trim(),
    };

    if (form.source === 'npm') {
      if (form.registry.trim()) params.registry = form.registry.trim();
      if (form.version.trim()) params.version = form.version.trim();
    } else if (form.source === 'git') {
      if (form.version.trim()) params.version = form.version.trim();
    }

    const result = await window.electron?.plugins.install(params);
    setInstalling(false);

    if (result?.ok) {
      setShowInstallModal(false);
      setForm({ source: 'npm', spec: '', registry: '', version: '' });
      loadPlugins();
    } else {
      setInstallError(result?.error || i18nService.t('pluginsInstallFailed'));
    }
  };

  const sourceLabel = (source: PluginSource | 'bundled') => {
    switch (source) {
      case 'npm': return i18nService.t('pluginsSourceNpm');
      case 'clawhub': return i18nService.t('pluginsSourceClawhub');
      case 'git': return i18nService.t('pluginsSourceGit');
      case 'local': return i18nService.t('pluginsSourceLocal');
      case 'openclaw': return i18nService.t('pluginsSourceOpenclaw');
      case 'bundled': return 'Bundled';
    }
  };

  // Sub-view: Plugin config page
  if (configPluginId) {
    return (
      <PluginConfigPage
        pluginId={configPluginId}
        onBack={() => setConfigPluginId(null)}
      />
    );
  }

  return (
    <div className="space-y-6 px-1">
      {/* Syncing overlay */}
      {syncing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-xl shadow-lg p-6 flex items-center gap-3">
            <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-foreground">{i18nService.t('pluginsSyncing')}</span>
          </div>
        </div>
      )}

      {/* Detect confirmation dialog */}
      {detectedPlugins && !syncing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-foreground mb-2">
              {i18nService.t('pluginsSyncTitle')}
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              {i18nService.t('pluginsSyncFound').replace('{count}', String(detectedPlugins.length))}
            </p>
            <div className="mb-4 max-h-32 overflow-y-auto rounded-md border border-border bg-surface-raised p-2">
              {detectedPlugins.map(id => (
                <div key={id} className="text-xs text-foreground py-0.5 font-mono">{id}</div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              {i18nService.t('pluginsSyncLater')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDetectedPlugins(null)}
                className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('pluginsSyncSkip')}
              </button>
              <button
                type="button"
                onClick={runSync}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {i18nService.t('pluginsSyncNow')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {i18nService.t('pluginsTitle')}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {i18nService.t('pluginsDesc')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowInstallModal(true); setInstallLog(''); setInstallError(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          {i18nService.t('pluginsInstall')}
        </button>
      </div>

      {/* Plugin List */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
      ) : plugins.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">{i18nService.t('pluginsEmpty')}</p>
          <p className="text-xs text-muted-foreground mt-1">{i18nService.t('pluginsEmptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map(plugin => (
            <div
              key={plugin.pluginId}
              className="flex items-center justify-between rounded-lg border border-border p-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      plugin.enabled ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                  <span className="text-sm font-medium text-foreground truncate">
                    {plugin.pluginId}
                  </span>
                  {plugin.version && (
                    <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                  )}
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface-raised text-muted-foreground">
                    {sourceLabel(plugin.source)}
                  </span>
                </div>
                {plugin.description && (
                  <p className="text-xs text-muted-foreground mt-1 ml-4">
                    {plugin.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                {plugin.hasConfig && (
                  <button
                    type="button"
                    onClick={() => setConfigPluginId(plugin.pluginId)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors"
                    title={i18nService.t('pluginsConfigTitle')}
                  >
                    <Cog6ToothIcon className="h-4 w-4" />
                  </button>
                )}
                {plugin.canUninstall && (
                  <button
                    type="button"
                    onClick={() => setConfirmUninstall(plugin.pluginId)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title={i18nService.t('pluginsUninstall')}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={plugin.enabled}
                  onClick={() => handleToggle(plugin.pluginId, !plugin.enabled)}
                  className={`
                    relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full
                    transition-colors duration-200 ease-in-out focus:outline-none
                    ${plugin.enabled ? 'bg-primary' : 'bg-border dark:bg-border'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 rounded-full bg-white shadow-sm
                      transition-transform duration-200 ease-in-out
                      ${plugin.enabled ? 'translate-x-5' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Install Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">
              {i18nService.t('pluginsInstallTitle')}
            </h3>

            {/* Source selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">
                {i18nService.t('pluginsSource')}
              </label>
              <div className="flex gap-1 flex-wrap">
                {(['npm', 'clawhub', 'git', 'local', 'openclaw'] as PluginSource[]).map(src => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, source: src, spec: '' }))}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                      form.source === src
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-surface-raised text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {sourceLabel(src)}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic fields based on source */}
            <div className="space-y-3">
              {form.source === 'npm' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {i18nService.t('pluginsPackageName')}
                    </label>
                    <input
                      type="text"
                      value={form.spec}
                      onChange={e => setForm(f => ({ ...f, spec: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="e.g. nsp-clawguard"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {i18nService.t('pluginsVersion')}
                    </label>
                    <input
                      type="text"
                      value={form.version}
                      onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={i18nService.t('pluginsVersionPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {i18nService.t('pluginsRegistry')}
                    </label>
                    <input
                      type="text"
                      value={form.registry}
                      onChange={e => setForm(f => ({ ...f, registry: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={i18nService.t('pluginsRegistryPlaceholder')}
                    />
                  </div>
                </>
              )}

              {form.source === 'clawhub' && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {i18nService.t('pluginsPackageName')}
                  </label>
                  <input
                    type="text"
                    value={form.spec}
                    onChange={e => setForm(f => ({ ...f, spec: e.target.value }))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="e.g. openclaw-codex-app-server"
                  />
                </div>
              )}

              {form.source === 'git' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {i18nService.t('pluginsGitUrl')}
                    </label>
                    <input
                      type="text"
                      value={form.spec}
                      onChange={e => setForm(f => ({ ...f, spec: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={i18nService.t('pluginsGitUrlPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {i18nService.t('pluginsVersion')}
                    </label>
                    <input
                      type="text"
                      value={form.version}
                      onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="tag / branch / commit"
                    />
                  </div>
                </>
              )}

              {form.source === 'local' && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {i18nService.t('pluginsLocalPath')}
                  </label>
                  <input
                    type="text"
                    value={form.spec}
                    onChange={e => setForm(f => ({ ...f, spec: e.target.value }))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="C:\\path\\to\\plugin or ./plugin.tgz"
                  />
                </div>
              )}

              {form.source === 'openclaw' && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    {i18nService.t('pluginsSyncDesc')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInstallModal(false);
                      runSync();
                    }}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? i18nService.t('pluginsSyncing') : i18nService.t('pluginsSyncButton')}
                  </button>
                </div>
              )}
            </div>

            {/* Install Log */}
            {form.source !== 'openclaw' && (installing || installLog) && (
              <pre
                ref={logRef}
                className="mt-3 text-xs font-mono bg-surface-raised border border-border rounded-md p-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground"
              >
                {installLog || 'Waiting...'}
              </pre>
            )}

            {/* Error */}
            {form.source !== 'openclaw' && installError && (
              <div className="mt-3 text-xs text-destructive bg-destructive/10 rounded-md p-2">
                {installError}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => { setShowInstallModal(false); setInstallError(null); setInstallLog(''); }}
                className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('cancel')}
              </button>
              {form.source !== 'openclaw' && (
                <button
                  type="button"
                  onClick={handleInstall}
                  disabled={installing || !form.spec.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {installing ? i18nService.t('pluginsInstalling') : i18nService.t('pluginsInstall')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Uninstall Confirmation Modal */}
      {confirmUninstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-xl shadow-lg w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-foreground mb-2">
              {i18nService.t('pluginsUninstallConfirm')}
            </h3>
            <p className="text-sm text-muted-foreground mb-5">
              {confirmUninstall}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmUninstall(null)}
                disabled={uninstalling}
                className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleUninstall(confirmUninstall)}
                disabled={uninstalling}
                className="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uninstalling ? i18nService.t('pluginsUninstalling') : i18nService.t('pluginsUninstall')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
