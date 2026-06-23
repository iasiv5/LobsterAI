import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import {
  type ShareDeploymentAnalyzeProjectInput,
  ShareDeploymentCandidateSource,
  type ShareDeploymentDetectCandidatesInput,
  type ShareDeploymentProjectAnalysis,
  type ShareDeploymentProjectCandidate,
  ShareDeploymentPackageManager,
} from '../../../shared/shareDeployment/constants';

const execFileAsync = promisify(execFile);

export const NODE_SERVICE_DEPLOYMENT_LIMITS = {
  MaxFiles: 5000,
  MaxTotalBytes: 100 * 1024 * 1024,
  MaxArchiveBytes: 15 * 1024 * 1024,
} as const;

const PACKAGE_JSON_FILE_NAME = 'package.json';

const BLOCKED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.vite',
  '.cache',
  '.turbo',
  '.vercel',
  '.serverless',
  'coverage',
  'dist',
  'build',
  'tmp',
  'temp',
  'logs',
]);

const BLOCKED_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log',
  'pnpm-debug.log',
]);

const PROJECT_MARKER_NAMES = [
  PACKAGE_JSON_FILE_NAME,
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  '.git',
];

interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  scripts?: Record<string, string>;
  engines?: {
    node?: string;
  };
}

export interface NodeServicePackageEntry {
  absolutePath: string;
  archiveName: string;
  size: number;
}

export interface NodeServiceProjectPackagePlan {
  analysis: ShareDeploymentProjectAnalysis;
  entries: NodeServicePackageEntry[];
}

function normalizeArchiveName(value: string): string {
  return value.split(path.sep).join('/');
}

function parseLocalServicePort(value?: string): number | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    const port = Number(url.port);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  } catch {
    // The caller will surface a missing port as a validation issue.
  }
  return undefined;
}

function isEnvFileName(name: string): boolean {
  return /^\.env(?:\.|$)/i.test(name);
}

function isSecretLikeFileName(name: string): boolean {
  return /(?:^|[-_.])(secret|credential|credentials|token|private[-_.]?key)(?:[-_.]|$)/i.test(name);
}

function isBlockedFileName(name: string): boolean {
  return BLOCKED_FILE_NAMES.has(name) || isEnvFileName(name) || isSecretLikeFileName(name);
}

function isBlockedPathPart(part: string): boolean {
  return BLOCKED_DIRECTORY_NAMES.has(part);
}

function isBlockedRootDirectory(resolvedDirectory: string): boolean {
  const normalized = path.resolve(resolvedDirectory);
  const parsed = path.parse(normalized);
  if (normalized === parsed.root) return true;

  const homeDir = path.resolve(os.homedir());
  const blockedRoots = new Set([
    homeDir,
    path.resolve(os.tmpdir()),
    path.resolve(parsed.root, 'tmp'),
    path.resolve(parsed.root, 'var', 'tmp'),
  ]);

  if (process.platform === 'win32') {
    blockedRoots.add(path.resolve(homeDir, 'Desktop'));
    blockedRoots.add(path.resolve(homeDir, 'Documents'));
    blockedRoots.add(path.resolve(homeDir, 'Downloads'));
  } else {
    blockedRoots.add('/Users');
    blockedRoots.add('/home');
    blockedRoots.add(path.resolve(homeDir, 'Desktop'));
    blockedRoots.add(path.resolve(homeDir, 'Documents'));
    blockedRoots.add(path.resolve(homeDir, 'Downloads'));
  }

  return blockedRoots.has(normalized);
}

async function readPackageJson(projectDirectory: string): Promise<PackageJson | null> {
  try {
    const text = await fs.promises.readFile(path.join(projectDirectory, PACKAGE_JSON_FILE_NAME), 'utf8');
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasProjectMarker(directory: string): Promise<boolean> {
  for (const markerName of PROJECT_MARKER_NAMES) {
    if (await pathExists(path.join(directory, markerName))) return true;
  }
  return false;
}

async function findNearestProjectDirectory(startDirectory: string): Promise<string | null> {
  let current = path.resolve(startDirectory);
  while (true) {
    if (await hasProjectMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function findProjectDirectoryCandidate(startDirectory?: string): Promise<string | null> {
  if (!startDirectory?.trim()) return null;
  const resolved = path.resolve(startDirectory.trim());
  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  return await findNearestProjectDirectory(resolved);
}

function resolvePackageManager(projectDirectory: string): ShareDeploymentPackageManager {
  if (fs.existsSync(path.join(projectDirectory, 'pnpm-lock.yaml'))) {
    return ShareDeploymentPackageManager.Pnpm;
  }
  if (fs.existsSync(path.join(projectDirectory, 'yarn.lock'))) {
    return ShareDeploymentPackageManager.Yarn;
  }
  if (fs.existsSync(path.join(projectDirectory, 'package-lock.json'))) {
    return ShareDeploymentPackageManager.Npm;
  }
  return ShareDeploymentPackageManager.Npm;
}

function resolveInstallCommand(packageManager: ShareDeploymentPackageManager): string {
  switch (packageManager) {
    case ShareDeploymentPackageManager.Pnpm:
      return 'pnpm install --frozen-lockfile';
    case ShareDeploymentPackageManager.Yarn:
      return 'yarn install --frozen-lockfile';
    case ShareDeploymentPackageManager.Npm:
    default:
      return 'npm ci';
  }
}

function resolveStartCommand(packageJson: PackageJson | null): string {
  const scripts = packageJson?.scripts ?? {};
  if (typeof scripts.start === 'string' && scripts.start.trim()) return 'npm run start';
  if (typeof scripts.serve === 'string' && scripts.serve.trim()) return 'npm run serve';
  if (typeof scripts.dev === 'string' && scripts.dev.trim()) return 'npm run dev';
  return '';
}

function resolveNodeVersion(packageJson: PackageJson | null): string {
  const engine = packageJson?.engines?.node;
  if (typeof engine !== 'string') return '20';
  const majorMatch = engine.match(/(?:^|[^\d])(\d{2})(?:[^\d]|$)/);
  const major = majorMatch?.[1];
  if (major === '18' || major === '20' || major === '22') return major;
  return '20';
}

async function collectPackageEntries(
  projectDirectory: string,
): Promise<{
  entries: NodeServicePackageEntry[];
  totalBytes: number;
  excludedCount: number;
  warnings: string[];
  blockers: string[];
}> {
  const entries: NodeServicePackageEntry[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  let totalBytes = 0;
  let excludedCount = 0;

  async function walk(directory: string): Promise<void> {
    const children = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = path.relative(projectDirectory, absolutePath);
      const relativeParts = relativePath.split(path.sep).filter(Boolean);
      if (relativeParts.some(isBlockedPathPart) || isBlockedFileName(child.name)) {
        excludedCount += 1;
        continue;
      }
      if (child.isSymbolicLink()) {
        excludedCount += 1;
        continue;
      }
      if (child.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!child.isFile()) {
        excludedCount += 1;
        continue;
      }

      const stat = await fs.promises.stat(absolutePath);
      totalBytes += stat.size;
      entries.push({
        absolutePath,
        archiveName: normalizeArchiveName(relativePath),
        size: stat.size,
      });
      if (entries.length > NODE_SERVICE_DEPLOYMENT_LIMITS.MaxFiles) {
        blockers.push(`Project has more than ${NODE_SERVICE_DEPLOYMENT_LIMITS.MaxFiles} files after exclusions.`);
        return;
      }
      if (totalBytes > NODE_SERVICE_DEPLOYMENT_LIMITS.MaxTotalBytes) {
        blockers.push(
          `Project files exceed ${Math.floor(NODE_SERVICE_DEPLOYMENT_LIMITS.MaxTotalBytes / 1024 / 1024)}MB after exclusions.`,
        );
        return;
      }
    }
  }

  await walk(projectDirectory);

  if (excludedCount > 0) {
    warnings.push(`${excludedCount} files or directories will be excluded from the deployment package.`);
  }

  return {
    entries: entries.sort((a, b) => a.archiveName.localeCompare(b.archiveName)),
    totalBytes,
    excludedCount,
    warnings,
    blockers,
  };
}

export async function buildNodeServiceProjectPackagePlan(
  input: ShareDeploymentAnalyzeProjectInput,
): Promise<NodeServiceProjectPackagePlan> {
  const projectDirectory = path.resolve(input.projectDirectory.trim());
  const warnings: string[] = [];
  const blockers: string[] = [];

  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(projectDirectory);
  } catch {
    blockers.push('Project directory does not exist.');
  }

  if (stat && !stat.isDirectory()) {
    blockers.push('Project path must be a directory.');
  }

  if (isBlockedRootDirectory(projectDirectory)) {
    blockers.push('Choose a project subdirectory instead of a system, home, or shared root directory.');
  }

  const packageJson = await readPackageJson(projectDirectory);
  if (!packageJson) {
    blockers.push('Project directory must contain package.json.');
  }

  const packageManager = resolvePackageManager(projectDirectory);
  const installCommand = resolveInstallCommand(packageManager);
  const startCommand = resolveStartCommand(packageJson);
  const nodeVersion = resolveNodeVersion(packageJson);
  const port = parseLocalServicePort(input.localServiceUrl);

  if (!startCommand) {
    blockers.push('package.json must define a start, serve, or dev script.');
  }
  if (!port) {
    blockers.push('Local service URL must include a valid port.');
  }
  if (startCommand === 'npm run dev') {
    warnings.push('Only a dev script was found. Confirm the service can run in a cloud deployment.');
  }
  if (packageManager === ShareDeploymentPackageManager.Npm && !fs.existsSync(path.join(projectDirectory, 'package-lock.json'))) {
    warnings.push('No package-lock.json was found. npm install behavior may be less reproducible.');
  }

  const collected = stat?.isDirectory()
    ? await collectPackageEntries(projectDirectory)
    : {
        entries: [],
        totalBytes: 0,
        excludedCount: 0,
        warnings: [],
        blockers: [],
      };

  const analysis: ShareDeploymentProjectAnalysis = {
    success: blockers.length === 0 && collected.blockers.length === 0,
    projectDirectory,
    packageName: typeof packageJson?.name === 'string' ? packageJson.name : undefined,
    packageVersion: typeof packageJson?.version === 'string' ? packageJson.version : undefined,
    packageManager,
    nodeVersion,
    installCommand,
    startCommand,
    port,
    totalFiles: collected.entries.length,
    totalBytes: collected.totalBytes,
    excludedCount: collected.excludedCount,
    warnings: [...warnings, ...collected.warnings],
    blockers: [...blockers, ...collected.blockers],
  };

  return {
    analysis,
    entries: collected.entries,
  };
}

export async function analyzeNodeServiceProjectDirectory(
  input: ShareDeploymentAnalyzeProjectInput,
): Promise<ShareDeploymentProjectAnalysis> {
  try {
    return (await buildNodeServiceProjectPackagePlan(input)).analysis;
  } catch (error) {
    return {
      success: false,
      projectDirectory: input.projectDirectory,
      packageManager: ShareDeploymentPackageManager.Unknown,
      nodeVersion: '20',
      installCommand: 'npm ci',
      startCommand: '',
      totalFiles: 0,
      totalBytes: 0,
      excludedCount: 0,
      warnings: [],
      blockers: [error instanceof Error ? error.message : 'Failed to analyze project directory.'],
    };
  }
}

async function getPidListeningOnPort(port: number): Promise<string | null> {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
      timeout: 1500,
    });
    const pidLine = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => /^p\d+$/.test(line));
    return pidLine ? pidLine.slice(1) : null;
  } catch {
    return null;
  }
}

async function getProcessCwd(pid: string): Promise<string | null> {
  if (process.platform === 'win32') return null;
  if (process.platform === 'darwin') {
    const procCwd = `/proc/${pid}/cwd`;
    try {
      return await fs.promises.realpath(procCwd);
    } catch {
      // macOS does not expose /proc by default; fall through to lsof.
    }
  }
  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
      timeout: 1500,
    });
    const cwdLine = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.startsWith('n'));
    return cwdLine ? cwdLine.slice(1) : null;
  } catch {
    return null;
  }
}

function pushUniqueCandidate(
  candidates: ShareDeploymentProjectCandidate[],
  candidate: ShareDeploymentProjectCandidate | null,
): void {
  if (!candidate?.directory) return;
  const normalized = path.resolve(candidate.directory);
  if (candidates.some(item => path.resolve(item.directory) === normalized)) return;
  candidates.push({
    ...candidate,
    directory: normalized,
  });
}

export async function detectNodeServiceProjectCandidates(
  input: ShareDeploymentDetectCandidatesInput,
): Promise<ShareDeploymentProjectCandidate[]> {
  const candidates: ShareDeploymentProjectCandidate[] = [];
  const port = parseLocalServicePort(input.localServiceUrl);

  if (port) {
    const pid = await getPidListeningOnPort(port);
    const cwd = pid ? await getProcessCwd(pid) : null;
    const projectDirectory = cwd ? await findProjectDirectoryCandidate(cwd) : null;
    pushUniqueCandidate(
      candidates,
      projectDirectory
        ? {
            directory: projectDirectory,
            source: ShareDeploymentCandidateSource.Process,
            confidence: 95,
            reason: `Matched the process listening on port ${port}.`,
          }
        : null,
    );
  }

  const workspaceProjectDirectory = await findProjectDirectoryCandidate(input.workingDirectory);
  pushUniqueCandidate(
    candidates,
    workspaceProjectDirectory
      ? {
          directory: workspaceProjectDirectory,
          source: ShareDeploymentCandidateSource.Workspace,
          confidence: 80,
          reason: 'Matched the current workspace directory.',
        }
      : null,
  );

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
