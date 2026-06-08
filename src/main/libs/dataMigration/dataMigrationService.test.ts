import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';
import { afterEach, expect, test } from 'vitest';

import { DataMigrationRestoreStatus } from '../../../shared/dataMigration/constants';
import { DB_FILENAME } from '../../appConstants';
import {
  createMigrationArchiveSync,
  inspectMigrationArchiveSync,
  performPendingDataMigrationRestoreSync,
  writePendingRestoreRequestSync,
} from './dataMigrationService';

const tempRoots: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-data-migration-test-'));
  tempRoots.push(dir);
  return dir;
};

const writeFile = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

const listArchiveEntries = (archivePath: string): string[] => {
  const entries: string[] = [];
  tar.list({
    sync: true,
    file: archivePath,
    onentry: entry => entries.push(entry.path),
  });
  return entries.sort();
};

const extractArchive = (archivePath: string): string => {
  const extractRoot = makeTempDir();
  tar.extract({
    sync: true,
    file: archivePath,
    cwd: extractRoot,
  });
  return extractRoot;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createMigrationArchive excludes cache and log data and writes a manifest', () => {
  const root = makeTempDir();
  const userData = path.join(root, 'LobsterAI');
  const archivePath = path.join(root, 'backup.tar.gz');

  writeFile(path.join(userData, 'Cache', 'cache.bin'), 'cache');
  writeFile(path.join(userData, 'Code Cache', 'code.bin'), 'code-cache');
  writeFile(path.join(userData, 'GPUCache', 'gpu.bin'), 'gpu-cache');
  writeFile(path.join(userData, 'logs', 'main.log'), 'log');
  writeFile(path.join(userData, 'Cookies'), 'cookies');
  writeFile(path.join(userData, 'DIPS-journal'), 'dips');
  writeFile(path.join(userData, '.com.github.Electron.test'), 'electron-marker');
  writeFile(path.join(userData, 'openclaw', 'state', 'openclaw.json'), '{}');
  writeFile(path.join(userData, 'SKILLs', 'demo', 'SKILL.md'), '# Demo');

  createMigrationArchiveSync({ userDataPath: userData, outputPath: archivePath });

  const entries = listArchiveEntries(archivePath);
  expect(entries).toContain('LobsterAI/.lobsterai-migration.json');
  expect(entries).toContain('LobsterAI/openclaw/state/openclaw.json');
  expect(entries).toContain('LobsterAI/SKILLs/demo/SKILL.md');
  expect(entries.some(entry => entry.includes('/Cache/'))).toBe(false);
  expect(entries.some(entry => entry.includes('/Code Cache/'))).toBe(false);
  expect(entries.some(entry => entry.includes('/GPUCache/'))).toBe(false);
  expect(entries.some(entry => entry.includes('/logs/'))).toBe(false);
  expect(entries.some(entry => entry.includes('/Cookies'))).toBe(false);
  expect(entries.some(entry => entry.includes('/DIPS'))).toBe(false);
  expect(entries.some(entry => entry.includes('/.com.github.Electron.'))).toBe(false);
});

test('createMigrationArchive replaces the live sqlite database with the snapshot', () => {
  const root = makeTempDir();
  const userData = path.join(root, 'LobsterAI');
  const archivePath = path.join(root, 'backup.tar.gz');
  const sqliteSnapshotPath = path.join(root, 'snapshot.sqlite');

  writeFile(path.join(userData, DB_FILENAME), 'live-db');
  writeFile(path.join(userData, `${DB_FILENAME}-wal`), 'live-wal');
  writeFile(sqliteSnapshotPath, 'snapshot-db');

  createMigrationArchiveSync({
    userDataPath: userData,
    outputPath: archivePath,
    sqliteSnapshotPath,
  });

  const extractRoot = extractArchive(archivePath);
  expect(fs.readFileSync(path.join(extractRoot, 'LobsterAI', DB_FILENAME), 'utf8')).toBe('snapshot-db');
  expect(fs.existsSync(path.join(extractRoot, 'LobsterAI', `${DB_FILENAME}-wal`))).toBe(false);
});

test('inspectMigrationArchive accepts legacy Windows PowerShell archive root', () => {
  const root = makeTempDir();
  const legacyRoot = path.join(root, 'AppData', 'Roaming', 'LobsterAI');
  const archivePath = path.join(root, 'legacy.tar.gz');
  writeFile(path.join(legacyRoot, DB_FILENAME), 'legacy-db');

  tar.create({
    sync: true,
    gzip: true,
    file: archivePath,
    cwd: root,
  }, ['AppData']);

  const info = inspectMigrationArchiveSync(archivePath);
  expect(info.root).toBe('AppData/Roaming/LobsterAI');
  expect(info.rootKind).toBe('legacy-windows');
});

test('inspectMigrationArchive rejects parent-directory archive paths', () => {
  const root = makeTempDir();
  const source = path.join(root, 'source');
  const archivePath = path.join(root, 'evil.tar.gz');
  writeFile(path.join(source, 'payload.txt'), 'evil');

  tar.create({
    sync: true,
    gzip: true,
    file: archivePath,
    cwd: source,
    prefix: '../evil',
  }, ['payload.txt']);

  expect(() => inspectMigrationArchiveSync(archivePath)).toThrow(/parent-directory path/);
});

test('performPendingDataMigrationRestoreSync creates rollback and restores backup data', () => {
  const root = makeTempDir();
  const sourceUserData = path.join(root, 'source', 'LobsterAI');
  const targetUserData = path.join(root, 'target', 'LobsterAI');
  const rollbackRoot = path.join(root, 'rollbacks');
  const archivePath = path.join(root, 'source-backup.tar.gz');

  writeFile(path.join(sourceUserData, DB_FILENAME), 'source-db');
  writeFile(path.join(sourceUserData, 'SKILLs', 'demo', 'SKILL.md'), '# Demo');
  writeFile(path.join(targetUserData, DB_FILENAME), 'target-db');

  createMigrationArchiveSync({ userDataPath: sourceUserData, outputPath: archivePath });
  writePendingRestoreRequestSync(targetUserData, archivePath);

  const result = performPendingDataMigrationRestoreSync({
    userDataPath: targetUserData,
    rollbackRootPath: rollbackRoot,
    now: new Date('2026-06-08T01:02:03Z'),
  });

  expect(result?.status).toBe(DataMigrationRestoreStatus.Success);
  expect(result?.rollbackPath).toBeTruthy();
  expect(fs.existsSync(result?.rollbackPath || '')).toBe(true);
  expect(fs.readFileSync(path.join(targetUserData, DB_FILENAME), 'utf8')).toBe('source-db');
  expect(fs.readFileSync(path.join(targetUserData, 'SKILLs', 'demo', 'SKILL.md'), 'utf8')).toBe('# Demo');
});

test('performPendingDataMigrationRestoreSync replaces data in place and preserves runtime locks', () => {
  const root = makeTempDir();
  const sourceUserData = path.join(root, 'source', 'LobsterAI');
  const targetUserData = path.join(root, 'target', 'LobsterAI');
  const rollbackRoot = path.join(root, 'rollbacks');
  const archivePath = path.join(root, 'source-backup.tar.gz');

  writeFile(path.join(sourceUserData, DB_FILENAME), 'source-db');
  writeFile(path.join(sourceUserData, 'openclaw', 'state', 'openclaw.json'), '{"source":true}');
  writeFile(path.join(targetUserData, DB_FILENAME), 'target-db');
  writeFile(path.join(targetUserData, 'old-only.txt'), 'old');
  writeFile(path.join(targetUserData, 'SingletonLock'), 'runtime-lock');

  createMigrationArchiveSync({ userDataPath: sourceUserData, outputPath: archivePath });
  writePendingRestoreRequestSync(targetUserData, archivePath);

  const result = performPendingDataMigrationRestoreSync({
    userDataPath: targetUserData,
    rollbackRootPath: rollbackRoot,
    now: new Date('2026-06-08T01:02:03Z'),
  });

  expect(result?.status).toBe(DataMigrationRestoreStatus.Success);
  expect(fs.readFileSync(path.join(targetUserData, DB_FILENAME), 'utf8')).toBe('source-db');
  expect(fs.readFileSync(path.join(targetUserData, 'openclaw', 'state', 'openclaw.json'), 'utf8')).toBe('{"source":true}');
  expect(fs.existsSync(path.join(targetUserData, 'old-only.txt'))).toBe(false);
  expect(fs.readFileSync(path.join(targetUserData, 'SingletonLock'), 'utf8')).toBe('runtime-lock');
});

test('performPendingDataMigrationRestoreSync keeps existing data when restore fails', () => {
  const root = makeTempDir();
  const targetUserData = path.join(root, 'target', 'LobsterAI');
  const rollbackRoot = path.join(root, 'rollbacks');
  const archivePath = path.join(root, 'missing-backup.tar.gz');

  writeFile(path.join(targetUserData, DB_FILENAME), 'target-db');
  writePendingRestoreRequestSync(targetUserData, archivePath);

  const result = performPendingDataMigrationRestoreSync({
    userDataPath: targetUserData,
    rollbackRootPath: rollbackRoot,
    now: new Date('2026-06-08T01:02:03Z'),
  });

  expect(result?.status).toBe(DataMigrationRestoreStatus.Failed);
  expect(fs.readFileSync(path.join(targetUserData, DB_FILENAME), 'utf8')).toBe('target-db');
});
