import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

import {
  type DataMigrationLastRestoreResult,
  DataMigrationRestoreStatus,
} from '../../../shared/dataMigration/constants';
import { APP_NAME, DB_FILENAME } from '../../appConstants';

const CURRENT_ARCHIVE_ROOT = APP_NAME;
const LEGACY_WINDOWS_ARCHIVE_ROOT = 'AppData/Roaming/LobsterAI';
const MANIFEST_FILE_NAME = '.lobsterai-migration.json';
const PENDING_RESTORE_FILE_NAME = '.lobsterai-data-migration-restore-pending.json';
const LAST_RESTORE_RESULT_FILE_NAME = '.lobsterai-data-migration-restore-result.json';
const ARCHIVE_FORMAT = 'lobsterai-user-data';
const ARCHIVE_FORMAT_VERSION = 1;

const EXCLUDED_TOP_LEVEL_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Service Worker',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'blob_storage',
  'Crashpad',
  'logs',
  'lockfile',
  PENDING_RESTORE_FILE_NAME,
  LAST_RESTORE_RESULT_FILE_NAME,
]);

const EXCLUDED_TOP_LEVEL_PREFIXES = [
  'Cookies',
  'DIPS',
  '.com.github.Electron.',
];

const ALLOWED_ENTRY_TYPES = new Set([
  'File',
  'OldFile',
  'Directory',
]);

export type DataMigrationArchiveKind = 'backup' | 'rollback';

export interface CreateMigrationArchiveInput {
  userDataPath: string;
  outputPath: string;
  sqliteSnapshotPath?: string;
  now?: Date;
  archiveKind?: DataMigrationArchiveKind;
}

export interface CreateMigrationArchiveResult {
  outputPath: string;
  sizeBytes: number;
}

export interface MigrationArchiveInfo {
  archivePath: string;
  root: string;
  rootKind: 'current' | 'legacy-windows';
  entryCount: number;
}

export interface PendingDataMigrationRestoreRequest {
  archivePath: string;
  requestedAt: string;
}

export interface PerformPendingDataMigrationRestoreInput {
  userDataPath: string;
  rollbackRootPath: string;
  now?: Date;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

export const formatDataMigrationTimestamp = (date = new Date()): string => (
  `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
);

export const buildDataMigrationBackupFileName = (date = new Date()): string =>
  `lobsterai-backup-${formatDataMigrationTimestamp(date)}.tar.gz`;

export const buildDataMigrationRollbackFileName = (date = new Date()): string =>
  `lobsterai-rollback-${formatDataMigrationTimestamp(date)}.tar.gz`;

export const ensureTarGzFileName = (filePath: string): string => {
  const trimmed = filePath.trim();
  return /\.tar\.gz$/i.test(trimmed) ? trimmed : `${trimmed}.tar.gz`;
};

export const getPendingRestoreRequestPath = (userDataPath: string): string =>
  path.join(userDataPath, PENDING_RESTORE_FILE_NAME);

export const getLastRestoreResultPath = (userDataPath: string): string =>
  path.join(userDataPath, LAST_RESTORE_RESULT_FILE_NAME);

const resolvePath = (value: string): string => path.resolve(value);

const isPathInside = (candidatePath: string, parentPath: string): boolean => {
  const relative = path.relative(resolvePath(parentPath), resolvePath(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const isExcludedTopLevelEntry = (relativePosixPath: string): boolean => {
  const firstSegment = relativePosixPath.split('/')[0] || '';
  return EXCLUDED_TOP_LEVEL_NAMES.has(firstSegment)
    || EXCLUDED_TOP_LEVEL_PREFIXES.some(prefix => firstSegment.startsWith(prefix));
};

const shouldExcludeSourcePath = (
  relativePosixPath: string,
  absolutePath: string,
  input: CreateMigrationArchiveInput,
): boolean => {
  if (!relativePosixPath) return false;
  if (isExcludedTopLevelEntry(relativePosixPath)) return true;

  const firstSegment = relativePosixPath.split('/')[0] || '';
  if (input.sqliteSnapshotPath) {
    if (
      firstSegment === DB_FILENAME
      || firstSegment === `${DB_FILENAME}-wal`
      || firstSegment === `${DB_FILENAME}-shm`
    ) {
      return true;
    }
  }

  return isPathInside(absolutePath, input.outputPath);
};

const ensureDirSync = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const removeDirIfExistsSync = (dirPath: string): void => {
  fs.rmSync(dirPath, { recursive: true, force: true });
};

const copyFileSync = (sourcePath: string, targetPath: string): void => {
  ensureDirSync(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
};

const copyDirectorySync = (
  sourceRoot: string,
  targetRoot: string,
  shouldExclude?: (relativePosixPath: string, absolutePath: string) => boolean,
): void => {
  const copyEntry = (sourcePath: string, targetPath: string, relativePosixPath: string): void => {
    if (shouldExclude?.(relativePosixPath, sourcePath)) return;

    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) return;

    if (stat.isDirectory()) {
      ensureDirSync(targetPath);
      for (const entry of fs.readdirSync(sourcePath)) {
        const childRelative = relativePosixPath
          ? `${relativePosixPath}/${entry}`
          : entry;
        copyEntry(path.join(sourcePath, entry), path.join(targetPath, entry), childRelative);
      }
      return;
    }

    if (stat.isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  };

  copyEntry(sourceRoot, targetRoot, '');
};

const writeJsonSync = (filePath: string, value: unknown): void => {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const readJsonFileSync = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const buildManifest = (input: CreateMigrationArchiveInput): Record<string, unknown> => {
  const now = input.now ?? new Date();
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_FORMAT_VERSION,
    appName: APP_NAME,
    archiveKind: input.archiveKind ?? 'backup',
    archiveRoot: CURRENT_ARCHIVE_ROOT,
    createdAt: now.toISOString(),
    platform: process.platform,
    arch: process.arch,
    includesWorkingDirectories: false,
    excludedTopLevelNames: [...EXCLUDED_TOP_LEVEL_NAMES].sort(),
    excludedTopLevelPrefixes: [...EXCLUDED_TOP_LEVEL_PREFIXES].sort(),
  };
};

export const createMigrationArchiveSync = (
  input: CreateMigrationArchiveInput,
): CreateMigrationArchiveResult => {
  const userDataPath = resolvePath(input.userDataPath);
  const outputPath = resolvePath(input.outputPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-data-migration-'));
  const stageParent = path.join(tempRoot, 'stage');
  const stageUserDataRoot = path.join(stageParent, CURRENT_ARCHIVE_ROOT);

  try {
    ensureDirSync(stageUserDataRoot);
    copyDirectorySync(
      userDataPath,
      stageUserDataRoot,
      (relativePosixPath, absolutePath) => shouldExcludeSourcePath(relativePosixPath, absolutePath, {
        ...input,
        userDataPath,
        outputPath,
      }),
    );

    if (input.sqliteSnapshotPath) {
      copyFileSync(resolvePath(input.sqliteSnapshotPath), path.join(stageUserDataRoot, DB_FILENAME));
    }

    writeJsonSync(path.join(stageUserDataRoot, MANIFEST_FILE_NAME), buildManifest(input));

    ensureDirSync(path.dirname(outputPath));
    tar.create({
      sync: true,
      gzip: true,
      file: outputPath,
      cwd: stageParent,
      portable: true,
    }, [CURRENT_ARCHIVE_ROOT]);

    return {
      outputPath,
      sizeBytes: fs.statSync(outputPath).size,
    };
  } finally {
    removeDirIfExistsSync(tempRoot);
  }
};

export const createMigrationArchive = async (
  input: CreateMigrationArchiveInput,
): Promise<CreateMigrationArchiveResult> => createMigrationArchiveSync(input);

const normalizeArchiveEntryPath = (entryPath: string): string => {
  let normalized = entryPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  return normalized;
};

const assertSafeArchiveEntryPath = (entryPath: string): string => {
  const normalized = normalizeArchiveEntryPath(entryPath);
  if (!normalized || normalized.includes('\0')) {
    throw new Error('Backup archive contains an empty or invalid path.');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Backup archive contains an absolute path: ${entryPath}`);
  }
  if (normalized.split('/').some(segment => segment === '..')) {
    throw new Error(`Backup archive contains a parent-directory path: ${entryPath}`);
  }
  return normalized;
};

const resolveArchiveRoot = (entryPath: string): Pick<MigrationArchiveInfo, 'root' | 'rootKind'> | null => {
  if (entryPath === CURRENT_ARCHIVE_ROOT || entryPath.startsWith(`${CURRENT_ARCHIVE_ROOT}/`)) {
    return { root: CURRENT_ARCHIVE_ROOT, rootKind: 'current' };
  }
  if (
    entryPath === LEGACY_WINDOWS_ARCHIVE_ROOT
    || entryPath.startsWith(`${LEGACY_WINDOWS_ARCHIVE_ROOT}/`)
  ) {
    return { root: LEGACY_WINDOWS_ARCHIVE_ROOT, rootKind: 'legacy-windows' };
  }
  return null;
};

const isArchiveRootParentDirectory = (entryPath: string): boolean => (
  `${LEGACY_WINDOWS_ARCHIVE_ROOT}/`.startsWith(`${entryPath}/`)
  || `${CURRENT_ARCHIVE_ROOT}/`.startsWith(`${entryPath}/`)
);

const inspectArchiveEntry = (
  archivePath: string,
  entry: { path: string; type?: string },
  state: { root: Pick<MigrationArchiveInfo, 'root' | 'rootKind'> | null; entryCount: number },
): void => {
  const normalizedPath = assertSafeArchiveEntryPath(entry.path);
  if (entry.type && !ALLOWED_ENTRY_TYPES.has(entry.type)) {
    throw new Error(`Backup archive contains an unsupported entry type: ${entry.type}`);
  }

  const root = resolveArchiveRoot(normalizedPath);
  if (!root) {
    if (entry.type === 'Directory' && isArchiveRootParentDirectory(normalizedPath)) {
      return;
    }
    throw new Error(`Backup archive does not contain ${APP_NAME} user data: ${entry.path}`);
  }
  if (state.root && state.root.root !== root.root) {
    throw new Error(`Backup archive contains multiple root directories: ${archivePath}`);
  }
  state.root = root;
  state.entryCount += 1;
};

export const inspectMigrationArchiveSync = (archivePath: string): MigrationArchiveInfo => {
  const resolvedArchivePath = resolvePath(archivePath);
  const state: { root: Pick<MigrationArchiveInfo, 'root' | 'rootKind'> | null; entryCount: number } = {
    root: null,
    entryCount: 0,
  };

  tar.list({
    sync: true,
    file: resolvedArchivePath,
    onentry: entry => inspectArchiveEntry(resolvedArchivePath, entry, state),
  });

  if (!state.root || state.entryCount <= 0) {
    throw new Error('Backup archive is empty or missing LobsterAI user data.');
  }

  return {
    archivePath: resolvedArchivePath,
    root: state.root.root,
    rootKind: state.root.rootKind,
    entryCount: state.entryCount,
  };
};

export const inspectMigrationArchive = async (archivePath: string): Promise<MigrationArchiveInfo> =>
  inspectMigrationArchiveSync(archivePath);

const extractMigrationArchiveToTempSync = (
  archivePath: string,
): { tempRoot: string; sourceRoot: string; info: MigrationArchiveInfo } => {
  const info = inspectMigrationArchiveSync(archivePath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-data-migration-restore-'));

  try {
    tar.extract({
      sync: true,
      file: info.archivePath,
      cwd: tempRoot,
      preservePaths: false,
      unlink: true,
      filter: (entryPath, entry) => {
        const normalizedPath = assertSafeArchiveEntryPath(entryPath);
        if ('type' in entry && entry.type && !ALLOWED_ENTRY_TYPES.has(entry.type)) {
          throw new Error(`Backup archive contains an unsupported entry type: ${entry.type}`);
        }
        const root = resolveArchiveRoot(normalizedPath);
        const isDirectoryEntry = 'type' in entry
          ? entry.type === 'Directory'
          : entry.isDirectory();
        return Boolean(
          (root && root.root === info.root)
          || (isDirectoryEntry && isArchiveRootParentDirectory(normalizedPath)),
        );
      },
    });

    const sourceRoot = path.join(tempRoot, ...info.root.split('/'));
    if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
      throw new Error('Backup archive did not extract a valid LobsterAI user data directory.');
    }
    return { tempRoot, sourceRoot, info };
  } catch (error) {
    removeDirIfExistsSync(tempRoot);
    throw error;
  }
};

export const writePendingRestoreRequestSync = (
  userDataPath: string,
  archivePath: string,
  now = new Date(),
): PendingDataMigrationRestoreRequest => {
  const request = {
    archivePath: resolvePath(archivePath),
    requestedAt: now.toISOString(),
  };
  writeJsonSync(getPendingRestoreRequestPath(userDataPath), request);
  return request;
};

export const consumeLastRestoreResultSync = (
  userDataPath: string,
): DataMigrationLastRestoreResult | null => {
  const resultPath = getLastRestoreResultPath(userDataPath);
  const result = readJsonFileSync<DataMigrationLastRestoreResult>(resultPath);
  if (result) {
    try {
      fs.unlinkSync(resultPath);
    } catch {
      // Ignore marker cleanup failures.
    }
  }
  return result;
};

const writeRestoreResultSync = (userDataPath: string, result: DataMigrationLastRestoreResult): void => {
  writeJsonSync(getLastRestoreResultPath(userDataPath), result);
};

const buildFailedRestoreResult = (
  archivePath: string,
  rollbackPath: string | undefined,
  error: unknown,
  now: Date,
): DataMigrationLastRestoreResult => ({
  status: DataMigrationRestoreStatus.Failed,
  archivePath,
  rollbackPath,
  restoredAt: now.toISOString(),
  error: error instanceof Error ? error.message : String(error),
});

const clearRestorableUserDataSync = (userDataPath: string): void => {
  ensureDirSync(userDataPath);
  for (const entry of fs.readdirSync(userDataPath)) {
    if (isExcludedTopLevelEntry(entry)) continue;
    removeDirIfExistsSync(path.join(userDataPath, entry));
  }
};

const replaceRestorableUserDataSync = (sourceRoot: string, userDataPath: string): void => {
  clearRestorableUserDataSync(userDataPath);
  copyDirectorySync(sourceRoot, userDataPath);
};

const restoreRollbackArchiveSync = (rollbackPath: string, userDataPath: string): void => {
  const rollback = extractMigrationArchiveToTempSync(rollbackPath);
  try {
    replaceRestorableUserDataSync(rollback.sourceRoot, userDataPath);
  } finally {
    removeDirIfExistsSync(rollback.tempRoot);
  }
};

export const performPendingDataMigrationRestoreSync = (
  input: PerformPendingDataMigrationRestoreInput,
): DataMigrationLastRestoreResult | null => {
  const pendingPath = getPendingRestoreRequestPath(input.userDataPath);
  const request = readJsonFileSync<PendingDataMigrationRestoreRequest>(pendingPath);
  if (!request?.archivePath) return null;

  const now = input.now ?? new Date();
  let rollbackPath: string | undefined;
  let rollbackReady = false;
  let extractedTempRoot: string | null = null;
  let targetWasTouched = false;

  try {
    try {
      fs.unlinkSync(pendingPath);
    } catch {
      // The request has already been read; continue.
    }

    ensureDirSync(input.rollbackRootPath);
    if (fs.existsSync(input.userDataPath)) {
      rollbackPath = path.join(input.rollbackRootPath, buildDataMigrationRollbackFileName(now));
      createMigrationArchiveSync({
        userDataPath: input.userDataPath,
        outputPath: rollbackPath,
        now,
        archiveKind: 'rollback',
      });
      rollbackReady = true;
    }

    const extracted = extractMigrationArchiveToTempSync(request.archivePath);
    extractedTempRoot = extracted.tempRoot;

    targetWasTouched = true;
    replaceRestorableUserDataSync(extracted.sourceRoot, input.userDataPath);

    const result: DataMigrationLastRestoreResult = {
      status: DataMigrationRestoreStatus.Success,
      archivePath: request.archivePath,
      rollbackPath,
      restoredAt: now.toISOString(),
    };
    writeRestoreResultSync(input.userDataPath, result);
    return result;
  } catch (error) {
    if (targetWasTouched && rollbackReady && rollbackPath) {
      try {
        restoreRollbackArchiveSync(rollbackPath, input.userDataPath);
      } catch {
        // Leave the original error as the reported failure.
      }
    }
    const result = buildFailedRestoreResult(request.archivePath, rollbackPath, error, now);
    try {
      writeRestoreResultSync(input.userDataPath, result);
    } catch {
      // If even marker writing fails, return the result to the caller.
    }
    return result;
  } finally {
    if (extractedTempRoot) {
      removeDirIfExistsSync(extractedTempRoot);
    }
  }
};
