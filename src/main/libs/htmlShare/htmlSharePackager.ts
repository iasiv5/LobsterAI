import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';

import { scanHtmlDependencies } from './htmlDependencyScanner';

const MAX_CLIENT_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_CLIENT_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_CLIENT_SINGLE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CLIENT_FILE_COUNT = 500;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.vite',
  '.cache',
  'coverage',
]);

const EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.txt',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.mp3',
  '.mp4',
  '.webm',
  '.ogg',
]);

export interface HtmlSharePackageResult {
  archivePath: string;
  sourceSha256: string;
  entryFile: string;
  rootDir: string;
  totalFiles: number;
  totalBytes: number;
  warnings: string[];
}

interface StaticFileEntry {
  absolutePath: string;
  archiveName: string;
  size: number;
}

function normalizeArchiveName(value: string): string {
  return value.split(path.sep).join('/');
}

function isExcludedFileName(name: string): boolean {
  return EXCLUDED_FILE_NAMES.has(name) || /^\.env(?:\.|$)/i.test(name);
}

function isAllowedStaticFile(filePath: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collectStaticFiles(rootDir: string): Promise<StaticFileEntry[]> {
  const entries: StaticFileEntry[] = [];

  const visit = async (dir: string) => {
    const children = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (child.isSymbolicLink()) {
        throw new Error(`Symbolic links cannot be shared: ${path.relative(rootDir, path.join(dir, child.name))}`);
      }
      if (child.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(child.name)) continue;
        await visit(path.join(dir, child.name));
        continue;
      }
      if (!child.isFile() || isExcludedFileName(child.name)) continue;

      const absolutePath = path.join(dir, child.name);
      if (!isAllowedStaticFile(absolutePath)) continue;

      const stat = await fs.promises.stat(absolutePath);
      if (stat.size > MAX_CLIENT_SINGLE_FILE_BYTES) {
        throw new Error(`File is too large to share: ${path.relative(rootDir, absolutePath)}`);
      }

      entries.push({
        absolutePath,
        archiveName: normalizeArchiveName(path.relative(rootDir, absolutePath)),
        size: stat.size,
      });

      if (entries.length > MAX_CLIENT_FILE_COUNT) {
        throw new Error(`Too many files to share. The limit is ${MAX_CLIENT_FILE_COUNT}.`);
      }
    }
  };

  await visit(rootDir);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes > MAX_CLIENT_TOTAL_BYTES) {
    throw new Error(`Share content is too large. The limit is ${Math.floor(MAX_CLIENT_TOTAL_BYTES / 1024 / 1024)}MB.`);
  }

  return entries.sort((a, b) => a.archiveName.localeCompare(b.archiveName));
}

async function writeZip(entries: StaticFileEntry[]): Promise<{ archivePath: string; sourceSha256: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-html-share-'));
  const archivePath = path.join(tempDir, 'share.zip');
  const zipFile = new yazl.ZipFile();
  console.debug(`[HtmlShare] writing share archive with ${entries.length} files`);

  zipFile.on('error', (err) => {
    (zipFile.outputStream as unknown as { destroy(err: Error): void }).destroy(err as Error);
  });

  for (const entry of entries) {
    zipFile.addFile(entry.absolutePath, entry.archiveName);
  }

  const outputStream = fs.createWriteStream(archivePath);
  const pipelinePromise = pipeline(zipFile.outputStream, outputStream);
  zipFile.end();
  await pipelinePromise;

  const stat = await fs.promises.stat(archivePath);
  if (stat.size > MAX_CLIENT_ARCHIVE_BYTES) {
    throw new Error(`Share archive is too large. The limit is ${Math.floor(MAX_CLIENT_ARCHIVE_BYTES / 1024 / 1024)}MB.`);
  }

  const buffer = await fs.promises.readFile(archivePath);
  const sourceSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  console.debug(
    `[HtmlShare] wrote share archive with ${stat.size} bytes and hash ${sourceSha256}`,
  );
  return {
    archivePath,
    sourceSha256,
  };
}

export async function packageHtmlFile(filePath: string): Promise<HtmlSharePackageResult> {
  const resolvedFilePath = path.resolve(filePath);
  console.debug(`[HtmlShare] packaging HTML file at ${resolvedFilePath}`);
  const stat = await fs.promises.stat(resolvedFilePath);
  if (!stat.isFile()) {
    throw new Error('HTML artifact file does not exist.');
  }
  if (!/\.html?$/i.test(resolvedFilePath)) {
    throw new Error('Only HTML files can be shared.');
  }

  return packageStaticDirectory(path.dirname(resolvedFilePath), path.basename(resolvedFilePath));
}

export async function packageStaticDirectory(rootDir: string, entryFile = 'index.html'): Promise<HtmlSharePackageResult> {
  const resolvedRootDir = path.resolve(rootDir);
  const entryPath = path.resolve(resolvedRootDir, entryFile);
  const relativeEntry = path.relative(resolvedRootDir, entryPath);
  console.debug(`[HtmlShare] packaging static directory ${resolvedRootDir} with entry ${entryFile}`);
  if (!relativeEntry || relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
    throw new Error('Entry HTML must be inside the shared directory.');
  }

  const entryStat = await fs.promises.stat(entryPath);
  if (!entryStat.isFile()) {
    throw new Error('Shared output directory must contain an entry HTML file.');
  }

  const files = await collectStaticFiles(resolvedRootDir);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  console.debug(
    `[HtmlShare] collected ${files.length} static files with ${totalBytes} bytes before compression`,
  );
  if (!files.some(file => file.archiveName === normalizeArchiveName(relativeEntry))) {
    throw new Error('Entry HTML was excluded from the share archive.');
  }

  const dependencyScan = await scanHtmlDependencies(resolvedRootDir, relativeEntry);
  console.debug(
    `[HtmlShare] dependency scan found ${dependencyScan.missing.length} missing referenced resources`,
  );
  const { archivePath, sourceSha256 } = await writeZip(files);

  return {
    archivePath,
    sourceSha256,
    entryFile: normalizeArchiveName(relativeEntry),
    rootDir: resolvedRootDir,
    totalFiles: files.length,
    totalBytes,
    warnings: dependencyScan.missing.map(item => `Missing referenced resource: ${item}`),
  };
}
