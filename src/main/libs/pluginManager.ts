import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { CoworkStore, PluginSource } from '../coworkStore';
import { getElectronNodeRuntimePath } from './coworkUtil';
import { findThirdPartyExtensionsDir, listBundledOpenClawExtensionManifests } from './openclawLocalExtensions';

export interface PluginInstallParams {
  source: PluginSource;
  spec: string;
  registry?: string;
  version?: string;
}

export type PluginInstallLogCallback = (line: string) => void;

export interface PluginInstallResult {
  ok: boolean;
  pluginId?: string;
  version?: string;
  error?: string;
}

export interface PluginConfigUiHint {
  label?: string;
  help?: string;
  sensitive?: boolean;
  advanced?: boolean;
  placeholder?: string;
  order?: number;
}

export interface PluginConfigSchema {
  configSchema: Record<string, unknown>;
  uiHints: Record<string, PluginConfigUiHint>;
}

export interface PluginListItem {
  pluginId: string;
  version?: string;
  description?: string;
  source: PluginSource | 'bundled';
  enabled: boolean;
  canUninstall: boolean;
  hasConfig: boolean;
}

interface PluginManifest {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  configSchema?: Record<string, unknown>;
  uiHints?: Record<string, PluginConfigUiHint>;
}

function getOpenClawMjsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'cfmind', 'openclaw.mjs');
  }
  return path.join(app.getAppPath(), 'vendor', 'openclaw-runtime', 'current', 'openclaw.mjs');
}

function getExtensionsDir(): string | null {
  return findThirdPartyExtensionsDir();
}

function readPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, 'openclaw.plugin.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
  } catch {
    return null;
  }
}

function readPluginVersion(pluginDir: string): string | undefined {
  const pkgPath = path.join(pluginDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || undefined;
  } catch {
    return undefined;
  }
}

function runAsync(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; shell?: boolean; onLog?: (line: string) => void },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env || process.env,
      shell: opts.shell || false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (opts.onLog) opts.onLog(text);
    });
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (opts.onLog) opts.onLog(text);
    });

    const timer = opts.timeout
      ? setTimeout(() => { child.kill(); reject(new Error('Process timed out')); }, opts.timeout)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Resolve the bundled npm-cli.js path so we don't depend on npm being in PATH.
 * On macOS, Electron apps launched from Dock/Launchpad have a minimal PATH that
 * typically doesn't include nvm/homebrew/volta-managed npm installations.
 */
function resolveNpmCliJs(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [
        path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(process.cwd(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

/** Resolve npm command and base args, preferring the bundled npm-cli.js. */
function resolveNpmCommand(): { command: string; baseArgs: string[]; env: NodeJS.ProcessEnv; shell: boolean } {
  const npmCliJs = resolveNpmCliJs();
  if (npmCliJs) {
    return {
      command: getElectronNodeRuntimePath(),
      baseArgs: [npmCliJs],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
    };
  }
  // Fallback: rely on system npm in PATH
  const isWin = process.platform === 'win32';
  return {
    command: isWin ? 'npm.cmd' : 'npm',
    baseArgs: [],
    env: { ...process.env },
    shell: isWin,
  };
}

/** Humanize a camelCase/snake_case key into a label */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Walk a JSON Schema `properties` tree and generate uiHint entries for any
 * property that doesn't already have one.  Produces dot-separated paths
 * (e.g. "embedding.apiKey") that SchemaForm expects.
 */
function generateHintsFromSchema(
  schema: Record<string, unknown>,
  existingHints: Record<string, PluginConfigUiHint>,
  prefix = '',
): Record<string, PluginConfigUiHint> {
  const hints = { ...existingHints };
  const properties = (schema.properties ?? schema) as Record<string, Record<string, unknown>>;

  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== 'object') continue;
    const dotPath = prefix ? `${prefix}.${key}` : key;

    if (prop.type === 'object' && prop.properties) {
      // Add a group hint if missing
      if (!hints[dotPath]) {
        hints[dotPath] = { label: humanizeKey(key) };
      }
      // Recurse into nested object properties
      const nested = generateHintsFromSchema(
        prop as Record<string, unknown>,
        hints,
        dotPath,
      );
      Object.assign(hints, nested);
    } else if (prop.type && prop.type !== 'object') {
      // Leaf property — add hint if missing
      if (!hints[dotPath]) {
        const isSensitive = /key|secret|token|password/i.test(key);
        hints[dotPath] = {
          label: humanizeKey(key),
          ...(isSensitive ? { sensitive: true } : {}),
          ...(typeof prop.default !== 'undefined' ? { placeholder: String(prop.default) } : {}),
        };
      }
    }
  }

  return hints;
}

export class PluginManager {
  private store: CoworkStore;

  constructor(store: CoworkStore) {
    this.store = store;
  }

  async listPlugins(): Promise<PluginListItem[]> {
    const userPlugins = this.store.listUserPlugins();
    const extensionsDir = getExtensionsDir();

    const items: PluginListItem[] = [];

    for (const plugin of userPlugins) {
      let description: string | undefined;
      let version = plugin.version;
      let hasConfig = false;

      if (extensionsDir) {
        const pluginDir = path.join(extensionsDir, plugin.pluginId);
        const manifest = readPluginManifest(pluginDir);
        if (manifest) {
          description = manifest.description || manifest.name;
          hasConfig = !!(manifest.configSchema
            && typeof manifest.configSchema === 'object'
            && (manifest.configSchema as Record<string, unknown>).properties
            && Object.keys((manifest.configSchema as Record<string, unknown>).properties as object).length > 0);
        }
        if (!version) {
          version = readPluginVersion(pluginDir);
        }
      }

      items.push({
        pluginId: plugin.pluginId,
        version,
        description,
        source: plugin.source,
        enabled: plugin.enabled,
        canUninstall: true,
        hasConfig,
      });
    }

    return items;
  }

  async installPlugin(params: PluginInstallParams, onLog?: PluginInstallLogCallback): Promise<PluginInstallResult> {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) {
      return { ok: false, error: 'Extensions directory not found' };
    }

    const openclawMjs = getOpenClawMjsPath();
    if (!fs.existsSync(openclawMjs)) {
      return { ok: false, error: `OpenClaw CLI not found at ${openclawMjs}` };
    }

    try {
      let installSpec: string;

      switch (params.source) {
        case 'clawhub':
          installSpec = `clawhub:${params.spec}`;
          break;

        case 'npm':
          onLog?.(`Packing ${params.spec}${params.version ? '@' + params.version : ''} from npm...\n`);
          installSpec = await this.packNpmPlugin(params, onLog);
          break;

        case 'git':
          onLog?.(`Cloning ${params.spec}...\n`);
          installSpec = await this.packGitPlugin(params, onLog);
          break;

        case 'local':
          installSpec = params.spec;
          break;

        default:
          return { ok: false, error: `Unknown source: ${params.source}` };
      }

      // Run openclaw plugins install into a temp staging directory, then copy
      // to the actual extensions dir. This avoids:
      // 1. EPERM from gateway locking the target directory
      // 2. Path mismatch (openclaw creates extensions/ subdir under STATE_DIR)
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-plugin-stage-'));
      onLog?.(`Installing plugin from ${installSpec}...\n`);
      const installEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENCLAW_STATE_DIR: stagingDir,
      };
      // Pass custom registry to npm (used by openclaw's internal npm install)
      if (params.registry) {
        installEnv.npm_config_registry = params.registry;
      }
      const result = await runAsync(
        process.execPath,
        [openclawMjs, 'plugins', 'install', installSpec, '--force'],
        {
          cwd: stagingDir,
          env: installEnv,
          timeout: 5 * 60 * 1000,
          onLog,
        },
      );

      if (result.code !== 0) {
        return { ok: false, error: result.stderr || `Install exited with code ${result.code}` };
      }

      // Discover plugin from staging extensions/ subdir and copy to final location
      const stagedExtDir = path.join(stagingDir, 'extensions');
      const pluginId = this.discoverInstalledPluginId(
        fs.existsSync(stagedExtDir) ? stagedExtDir : stagingDir,
        params,
      );
      if (!pluginId) {
        return { ok: false, error: 'Plugin installed but could not determine plugin ID' };
      }

      const stagedPluginDir = path.join(stagedExtDir, pluginId);
      const targetPluginDir = path.join(extensionsDir, pluginId);

      // Copy from staging to final extensions directory (async to avoid blocking main thread)
      onLog?.(`Copying ${pluginId} to extensions directory...\n`);
      try {
        if (fs.existsSync(targetPluginDir)) {
          await fs.promises.rm(targetPluginDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
        }
      } catch {
        // On Windows the gateway may hold file handles; proceed with force-overwrite
      }
      await fs.promises.cp(stagedPluginDir, targetPluginDir, { recursive: true, force: true });
      onLog?.(`Done.\n`);

      // Cleanup staging
      fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});

      const version = readPluginVersion(targetPluginDir) || params.version;

      // Record in store
      this.store.addUserPlugin({
        pluginId,
        source: params.source,
        spec: params.spec,
        registry: params.registry,
        version,
        enabled: true,
        installedAt: Date.now(),
      });

      onLog?.(`Plugin ${pluginId}@${version || 'unknown'} installed successfully.\n`);
      return { ok: true, pluginId, version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  async uninstallPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) {
      return { ok: false, error: 'Extensions directory not found' };
    }

    const pluginDir = path.join(extensionsDir, pluginId);
    try {
      if (fs.existsSync(pluginDir)) {
        await fs.promises.rm(pluginDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to remove plugin directory: ${message}` };
    }

    this.store.removeUserPlugin(pluginId);
    return { ok: true };
  }

  setPluginEnabled(pluginId: string, enabled: boolean): void {
    this.store.setUserPluginEnabled(pluginId, enabled);
  }

  getPluginConfigSchema(pluginId: string): PluginConfigSchema | null {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) return null;

    const pluginDir = path.join(extensionsDir, pluginId);
    const manifest = readPluginManifest(pluginDir);
    const schemaProps = (manifest?.configSchema as Record<string, unknown> | undefined)?.properties;
    if (!schemaProps || Object.keys(schemaProps as object).length === 0) {
      return null;
    }

    const uiHints = manifest.uiHints ?? {};
    // Auto-generate uiHints from configSchema properties when not provided
    const mergedHints = generateHintsFromSchema(manifest.configSchema, uiHints);

    return {
      configSchema: manifest.configSchema,
      uiHints: mergedHints,
    };
  }

  getPluginConfig(pluginId: string): Record<string, unknown> | null {
    return this.store.getUserPluginConfig(pluginId);
  }

  savePluginConfig(pluginId: string, config: Record<string, unknown>): void {
    this.store.setUserPluginConfig(pluginId, config);
  }

  private async packNpmPlugin(params: PluginInstallParams, onLog?: PluginInstallLogCallback): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-plugin-'));
    const spec = params.version ? `${params.spec}@${params.version}` : params.spec;
    const npm = resolveNpmCommand();
    const args = [...npm.baseArgs, 'pack', spec, '--pack-destination', tmpDir];

    if (params.registry) {
      args.push(`--registry=${params.registry}`);
    }

    const result = await runAsync(npm.command, args, {
      cwd: tmpDir,
      env: {
        ...npm.env,
        npm_config_prefer_offline: '',
        npm_config_prefer_online: '',
      },
      timeout: 3 * 60 * 1000,
      shell: npm.shell,
      onLog,
    });

    if (result.code !== 0) {
      throw new Error(`npm pack ${spec} failed: ${result.stderr}`);
    }

    const tgzName = result.stdout.split('\n').pop();
    if (!tgzName) {
      throw new Error('npm pack produced no output');
    }
    return path.join(tmpDir, tgzName);
  }

  private async packGitPlugin(params: PluginInstallParams, onLog?: PluginInstallLogCallback): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-plugin-git-'));
    const sourceDir = path.join(tmpDir, 'source');

    const gitUrl = params.spec;
    const ref = params.version;

    const cloneArgs = ['clone', '--depth', '1'];
    if (ref) {
      cloneArgs.push('--branch', ref);
    }
    cloneArgs.push(gitUrl, sourceDir);

    const cloneResult = await runAsync('git', cloneArgs, {
      cwd: tmpDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 5 * 60 * 1000,
      onLog,
    });

    if (cloneResult.code !== 0) {
      throw new Error(`git clone failed: ${cloneResult.stderr}`);
    }

    // Pack the cloned source
    const npm = resolveNpmCommand();
    const packResult = await runAsync(npm.command, [...npm.baseArgs, 'pack', sourceDir, '--pack-destination', tmpDir], {
      cwd: tmpDir,
      env: npm.env,
      timeout: 3 * 60 * 1000,
      shell: npm.shell,
      onLog,
    });

    if (packResult.code !== 0) {
      throw new Error(`npm pack (git source) failed: ${packResult.stderr}`);
    }

    const tgzName = packResult.stdout.split('\n').pop();
    if (!tgzName) {
      throw new Error('npm pack produced no output for git source');
    }
    return path.join(tmpDir, tgzName);
  }

  private discoverInstalledPluginId(extensionsDir: string, params: PluginInstallParams): string | null {
    // Try to find the plugin by scanning the extensions directory for recently added entries
    try {
      const entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
        .filter(e => e.isDirectory());

      for (const entry of entries) {
        const manifest = readPluginManifest(path.join(extensionsDir, entry.name));
        if (manifest?.id) {
          // Check if this could be the plugin we just installed
          const specLower = params.spec.toLowerCase();
          const idLower = manifest.id.toLowerCase();
          if (idLower.includes(specLower) || specLower.includes(idLower) || entry.name === params.spec) {
            return manifest.id;
          }
        }
      }

      // Fallback: use the spec as plugin ID (common for clawhub/npm packages)
      const lastSegment = params.spec.split('/').pop() || params.spec;
      const candidateDir = path.join(extensionsDir, lastSegment);
      if (fs.existsSync(candidateDir)) {
        const manifest = readPluginManifest(candidateDir);
        return manifest?.id || lastSegment;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Detect plugins present in OpenClaw's extensions directory but missing from
   * the local SQLite store. Returns a read-only list without writing anything.
   */
  detectPluginsFromOpenClaw(): { plugins: string[]; error?: string } {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) {
      return { plugins: [], error: 'Extensions directory not found' };
    }

    const hiddenIds = getHiddenPluginIds();
    const existingPlugins = this.store.listUserPlugins();
    const existingIds = new Set(existingPlugins.map(p => p.pluginId));

    const plugins: string[] = [];

    try {
      const entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
        .filter(e => e.isDirectory());

      for (const entry of entries) {
        const pluginDir = path.join(extensionsDir, entry.name);
        const manifest = readPluginManifest(pluginDir);
        const pluginId = manifest?.id || entry.name;

        if (existingIds.has(pluginId)) continue;
        if (isHiddenPlugin(pluginId, hiddenIds)) continue;

        plugins.push(pluginId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { plugins, error: message };
    }

    return { plugins };
  }

  /**
   * Sync plugins from OpenClaw's extensions directory into the local SQLite store.
   * Discovers plugins installed outside of LobsterAI (via AI conversation, CLI, or
   * OpenClaw Web UI) and adds them to the user_plugins table so they appear in the
   * plugin management UI.
   */
  async syncPluginsFromOpenClaw(): Promise<{ synced: string[]; error?: string }> {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) {
      return { synced: [], error: 'Extensions directory not found' };
    }

    const hiddenIds = getHiddenPluginIds();
    const existingPlugins = this.store.listUserPlugins();
    const existingIds = new Set(existingPlugins.map(p => p.pluginId));

    // Read openclaw.json to get enabled state for each plugin
    const configEntries = readOpenClawConfigEntries();

    const synced: string[] = [];

    try {
      const entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
        .filter(e => e.isDirectory());

      for (const entry of entries) {
        const pluginDir = path.join(extensionsDir, entry.name);
        const manifest = readPluginManifest(pluginDir);
        const pluginId = manifest?.id || entry.name;

        // Skip if already in SQLite or if it's a hidden/internal plugin
        if (existingIds.has(pluginId)) continue;
        if (isHiddenPlugin(pluginId, hiddenIds)) continue;

        // Determine enabled state from openclaw.json
        const configEntry = configEntries[pluginId] as { enabled?: boolean } | undefined;
        const enabled = configEntry?.enabled !== false;

        const version = readPluginVersion(pluginDir);

        this.store.addUserPlugin({
          pluginId,
          source: 'openclaw',
          spec: pluginId,
          version,
          enabled,
          installedAt: Date.now(),
        });

        synced.push(pluginId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { synced, error: message };
    }

    if (synced.length > 0) {
      console.log(`[PluginManager] synced ${synced.length} plugin(s) from OpenClaw: ${synced.join(', ')}`);
    }

    return { synced };
  }
}

/** Plugins that should never appear in the user-managed plugin list. */
const INTERNAL_PLUGIN_IDS = [
  'ask-user-question',
  'memory-core',
  'qwen-portal-auth',
  'qqbot',
  'acpx',
];

/** Read preinstalled plugin IDs from package.json openclaw.plugins field. */
function readPreinstalledPluginIdsFromPackageJson(): string[] {
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const plugins = pkg.openclaw?.plugins;
    if (!Array.isArray(plugins)) return [];
    return plugins
      .map((p: { id?: string }) => p.id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/** Build the set of plugin IDs that should be hidden from the user. */
function getHiddenPluginIds(): Set<string> {
  const hidden = new Set<string>();

  // Preinstalled (IM channel) plugins from package.json
  for (const id of readPreinstalledPluginIdsFromPackageJson()) {
    hidden.add(id);
  }

  // Bundled extensions shipped with the runtime
  for (const manifest of listBundledOpenClawExtensionManifests()) {
    hidden.add(manifest.pluginId);
  }

  // Hardcoded internal plugins
  for (const id of INTERNAL_PLUGIN_IDS) {
    hidden.add(id);
  }

  return hidden;
}

/** Check if a plugin should be hidden from the user. */
function isHiddenPlugin(pluginId: string, hiddenIds: Set<string>): boolean {
  if (hiddenIds.has(pluginId)) return true;
  // Provider plugins (e.g. @openclaw/anthropic-provider) are internal
  if (pluginId.startsWith('@openclaw/')) return true;
  return false;
}

/** Read plugins.entries from the openclaw.json config file. */
function readOpenClawConfigEntries(): Record<string, unknown> {
  try {
    const configPath = path.join(app.getPath('userData'), 'openclaw', 'state', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return (config?.plugins?.entries ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}
