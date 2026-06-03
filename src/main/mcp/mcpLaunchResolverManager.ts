import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { getElectronNodeRuntimePath } from '../libs/coworkUtil';
import { findSystemNodePath } from '../libs/resolveStdioCommand';
import {
  createMcpLaunchSourceFingerprint,
  isNpxMcpServer,
  type McpLaunchResolution,
  McpLaunchResolutionStatus,
  McpLaunchResolverKind,
} from './mcpLaunchResolution';
import type { McpServerRecord } from './mcpStore';
import { McpStore } from './mcpStore';

const INSTALL_TIMEOUT_MS = 120_000;
const NPM_VIEW_TIMEOUT_MS = 20_000;
const STALE_INSTALLING_MS = INSTALL_TIMEOUT_MS + 30_000;

type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

type NpmCommand = {
  command: string;
  baseArgs: string[];
  env: Record<string, string>;
};

type ParsedNpxSpec = {
  packageName: string;
  requestedVersion: string;
  installSpec: string;
  extraArgs: string[];
};

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, error?: unknown): void {
  const prefix = `[McpLaunchResolver] ${message}`;
  if (level === 'ERROR') {
    console.error(prefix, error);
  } else if (level === 'WARN') {
    if (error !== undefined) console.warn(prefix, error);
    else console.warn(prefix);
  } else {
    console.log(prefix);
  }
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp';
}

function parsePackageSpec(spec: string): { packageName: string; requestedVersion: string } | null {
  const trimmed = spec.trim();
  if (
    !trimmed
    || trimmed.startsWith('.')
    || trimmed.startsWith('/')
    || trimmed.startsWith('\\')
    || trimmed.startsWith('file:')
    || trimmed.startsWith('http:')
    || trimmed.startsWith('https:')
    || trimmed.startsWith('git+')
  ) {
    return null;
  }

  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash < 0) return null;
    const versionAt = trimmed.indexOf('@', slash + 1);
    if (versionAt < 0) {
      return { packageName: trimmed, requestedVersion: 'latest' };
    }
    return {
      packageName: trimmed.slice(0, versionAt),
      requestedVersion: trimmed.slice(versionAt + 1) || 'latest',
    };
  }

  const versionAt = trimmed.indexOf('@');
  if (versionAt < 0) {
    return { packageName: trimmed, requestedVersion: 'latest' };
  }
  return {
    packageName: trimmed.slice(0, versionAt),
    requestedVersion: trimmed.slice(versionAt + 1) || 'latest',
  };
}

function parseNpxArgs(args: string[]): ParsedNpxSpec | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-y' || arg === '--yes') continue;
    if (arg === '--') {
      if (i + 1 >= args.length) return null;
      const parsed = parsePackageSpec(args[i + 1]);
      if (!parsed) return null;
      return {
        ...parsed,
        installSpec: `${parsed.packageName}@${parsed.requestedVersion}`,
        extraArgs: args.slice(i + 2),
      };
    }
    if (arg === '-p' || arg === '--package' || arg.startsWith('--package=')) {
      return null;
    }
    if (arg.startsWith('-')) continue;
    const parsed = parsePackageSpec(arg);
    if (!parsed) return null;
    return {
      ...parsed,
      installSpec: `${parsed.packageName}@${parsed.requestedVersion}`,
      extraArgs: args.slice(i + 1),
    };
  }
  return null;
}

export function packageRootFromInstallDir(installDir: string, packageName: string): string {
  const parts = packageName.startsWith('@')
    ? packageName.split('/')
    : [packageName];
  return path.join(installDir, 'node_modules', ...parts);
}

export function isStaleInstallingResolution(
  resolution: McpLaunchResolution | undefined,
  now = Date.now(),
): boolean {
  return (
    resolution?.status === McpLaunchResolutionStatus.Installing
    && now - resolution.updatedAt > STALE_INSTALLING_MS
  );
}

function resolvePackageBin(packageRoot: string, packageName: string): string {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  if (typeof pkg.bin === 'string' && pkg.bin.trim()) {
    return path.join(packageRoot, pkg.bin);
  }
  if (pkg.bin && typeof pkg.bin === 'object') {
    const shortName = packageName.split('/').pop() || packageName;
    const preferred = pkg.bin[shortName] || pkg.bin[packageName] || Object.values(pkg.bin)[0];
    if (preferred) return path.join(packageRoot, preferred);
  }
  throw new Error(`Package "${packageName}" does not declare a runnable bin entry.`);
}

function readInstalledVersion(packageRoot: string): string {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
  return pkg.version || 'unknown';
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
  },
): Promise<RunResult> {
  const startedAt = Date.now();
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function resolveNpmCommand(): NpmCommand {
  const electronNode = getElectronNodeRuntimePath();
  const npmCliCandidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : '',
    path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(process.cwd(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);

  const systemNode = findSystemNodePath();
  if (systemNode) {
    const systemNpmCli = path.join(path.dirname(systemNode), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(systemNpmCli)) {
      return { command: systemNode, baseArgs: [systemNpmCli], env: {} };
    }
  }

  const bundledNpmCli = npmCliCandidates.find(candidate => fs.existsSync(candidate));
  if (bundledNpmCli) {
    return {
      command: systemNode || electronNode,
      baseArgs: [bundledNpmCli],
      env: systemNode ? {} : { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    baseArgs: [],
    env: {},
  };
}

function resolveNodeCommand(): { command: string; env: Record<string, string> } {
  const systemNode = findSystemNodePath();
  if (systemNode) return { command: systemNode, env: {} };
  return {
    command: getElectronNodeRuntimePath(),
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

export class McpLaunchResolverManager {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: McpStore,
    private readonly onChanged: () => void,
    private readonly onResolutionReady: (reason: string) => void,
  ) {}

  canOptimize(server: McpServerRecord): boolean {
    return server.transportType === 'stdio' && isNpxMcpServer(server);
  }

  getReadyResolution(server: McpServerRecord): McpLaunchResolution | undefined {
    const resolution = this.store.getLaunchResolution(server.id);
    if (!resolution) return undefined;
    if (resolution.sourceFingerprint !== createMcpLaunchSourceFingerprint(server)) return undefined;
    if (resolution.status !== McpLaunchResolutionStatus.Ready) return undefined;
    if (!resolution.command || !resolution.args?.length) return undefined;
    return resolution;
  }

  shouldStartResolution(server: McpServerRecord, status: McpLaunchResolutionStatus): boolean {
    if (status === McpLaunchResolutionStatus.Failed) return false;
    if (status !== McpLaunchResolutionStatus.Installing) return true;
    if (this.inFlight.has(server.id)) return false;

    const resolution = this.store.getLaunchResolution(server.id);
    if (!isStaleInstallingResolution(resolution)) return false;
    log('WARN', `retrying stale MCP launch installation for server "${server.name}"`);
    return true;
  }

  ensureResolved(serverId: string, reason: string): void {
    if (this.inFlight.has(serverId)) return;
    const task = this.resolveServer(serverId, reason)
      .catch(error => {
        log('ERROR', `background resolution failed for server ${serverId}`, error);
      })
      .finally(() => {
        this.inFlight.delete(serverId);
      });
    this.inFlight.set(serverId, task);
  }

  async retry(serverId: string): Promise<void> {
    if (this.inFlight.has(serverId)) {
      await this.inFlight.get(serverId);
      return;
    }
    const task = this.resolveServer(serverId, 'manual-retry')
      .finally(() => {
        this.inFlight.delete(serverId);
      });
    this.inFlight.set(serverId, task);
    await task;
  }

  private async resolveServer(serverId: string, reason: string): Promise<void> {
    const server = this.store.getServer(serverId);
    if (!server || !server.enabled) return;
    const startedAt = Date.now();
    const fingerprint = createMcpLaunchSourceFingerprint(server);
    const existing = this.store.getLaunchResolution(server.id);
    if (
      existing?.sourceFingerprint === fingerprint
      && existing.status === McpLaunchResolutionStatus.Ready
      && existing.command
      && existing.args?.length
    ) {
      log('INFO', `server "${server.name}" already has a ready launch resolution`);
      return;
    }

    if (!this.canOptimize(server)) {
      this.store.upsertLaunchResolution({
        serverId: server.id,
        resolverKind: McpLaunchResolverKind.Raw,
        sourceFingerprint: fingerprint,
        status: McpLaunchResolutionStatus.Unsupported,
        error: 'Only standard npx stdio MCP servers are optimized in this version.',
        updatedAt: Date.now(),
      });
      this.onChanged();
      return;
    }

    const parsed = parseNpxArgs(server.args || []);
    if (!parsed) {
      this.store.upsertLaunchResolution({
        serverId: server.id,
        resolverKind: McpLaunchResolverKind.Npx,
        sourceFingerprint: fingerprint,
        status: McpLaunchResolutionStatus.Unsupported,
        error: 'This npx command shape is not supported for managed installation.',
        updatedAt: Date.now(),
      });
      this.onChanged();
      return;
    }

    const installDir = path.join(
      app.getPath('userData'),
      'openclaw',
      'mcp-packages',
      `${sanitizeForPath(server.id)}-${sanitizeForPath(parsed.packageName)}`,
    );
    fs.mkdirSync(installDir, { recursive: true });

    this.store.upsertLaunchResolution({
      serverId: server.id,
      resolverKind: McpLaunchResolverKind.Npx,
      sourceFingerprint: fingerprint,
      status: McpLaunchResolutionStatus.Installing,
      packageName: parsed.packageName,
      requestedVersion: parsed.requestedVersion,
      installDir,
      updatedAt: Date.now(),
    });
    this.onChanged();

    log(
      'INFO',
      `installing MCP server "${server.name}" package ${parsed.installSpec} (reason=${reason})`,
    );

    try {
      const npm = resolveNpmCommand();
      const viewStartedAt = Date.now();
      const viewResult = await runCommand(
        npm.command,
        [...npm.baseArgs, 'view', parsed.installSpec, 'version', '--json'],
        { env: npm.env, timeoutMs: NPM_VIEW_TIMEOUT_MS },
      );
      log(
        'INFO',
        `resolved npm metadata for "${server.name}" in ${Date.now() - viewStartedAt}ms (exit=${viewResult.code})`,
      );

      const installStartedAt = Date.now();
      const installResult = await runCommand(
        npm.command,
        [
          ...npm.baseArgs,
          'install',
          '--prefix',
          installDir,
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          parsed.installSpec,
        ],
        { env: npm.env, timeoutMs: INSTALL_TIMEOUT_MS },
      );
      log(
        'INFO',
        `installed package for "${server.name}" in ${Date.now() - installStartedAt}ms (exit=${installResult.code})`,
      );
      if (installResult.code !== 0) {
        throw new Error(installResult.stderr.trim() || `npm install exited with code ${installResult.code}`);
      }

      const packageRoot = packageRootFromInstallDir(installDir, parsed.packageName);
      const binPath = resolvePackageBin(packageRoot, parsed.packageName);
      const resolvedVersion = readInstalledVersion(packageRoot);
      const node = resolveNodeCommand();
      const resolvedAt = Date.now();
      this.store.upsertLaunchResolution({
        serverId: server.id,
        resolverKind: McpLaunchResolverKind.Npx,
        sourceFingerprint: fingerprint,
        status: McpLaunchResolutionStatus.Ready,
        packageName: parsed.packageName,
        requestedVersion: parsed.requestedVersion,
        resolvedVersion,
        installDir,
        command: node.command,
        args: [binPath, ...parsed.extraArgs],
        env: node.env,
        installedAt: resolvedAt,
        resolvedAt,
        updatedAt: resolvedAt,
      });
      log(
        'INFO',
        `MCP server "${server.name}" launch path is ready in ${Date.now() - startedAt}ms; version=${resolvedVersion}`,
      );
      this.onChanged();
      this.onResolutionReady(`mcp-launch-ready:${server.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.upsertLaunchResolution({
        serverId: server.id,
        resolverKind: McpLaunchResolverKind.Npx,
        sourceFingerprint: fingerprint,
        status: McpLaunchResolutionStatus.Failed,
        packageName: parsed.packageName,
        requestedVersion: parsed.requestedVersion,
        installDir,
        error: message,
        updatedAt: Date.now(),
      });
      log(
        'WARN',
        `failed to resolve MCP server "${server.name}" after ${Date.now() - startedAt}ms: ${message}`,
      );
      this.onChanged();
      this.onResolutionReady(`mcp-launch-failed:${server.name}`);
    }
  }
}
