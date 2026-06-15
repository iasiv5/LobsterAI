import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';

import { HtmlShareSourceType } from '../../../shared/htmlShare/constants';

const MAX_CLIENT_ARCHIVE_BYTES = 22 * 1024 * 1024;
const MAX_CLIENT_SINGLE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CLIENT_DOCUMENT_ARCHIVE_BYTES = 105 * 1024 * 1024;
const MAX_CLIENT_DOCUMENT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS = 3;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv;charset=UTF-8',
  tsv: 'text/tab-separated-values;charset=UTF-8',
};
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export type ArtifactFileShareSourceType =
  | typeof HtmlShareSourceType.ImageFile
  | typeof HtmlShareSourceType.SvgFile
  | typeof HtmlShareSourceType.DocumentFile;

export interface ArtifactFileSharePackageInput {
  sourceType: ArtifactFileShareSourceType;
  fileName?: string;
  filePath?: string;
  content?: string;
  remoteUrl?: string;
}

export interface ArtifactFileSharePackageResult {
  archivePath: string;
  sourceSha256: string;
  entryFile: string;
  totalFiles: 1;
  totalBytes: number;
  contentType: string;
  warnings: string[];
}

interface LoadedArtifactFile {
  bytes: Buffer;
  fileName: string;
  contentType?: string;
}

function extensionFromName(fileName: string | undefined): string {
  if (!fileName) return '';
  const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function cleanFileName(fileName: string, fallback: string): string {
  const baseName = path.basename(fileName).replace(/[\\/]/g, '').trim();
  const cleaned = baseName.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned || fallback;
}

function imageMagicExtension(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function contentTypeForImageExtension(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return `image/${extension}`;
}

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3];
  return {
    contentType,
    bytes: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
  };
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase();
  return (
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80') ||
    value.startsWith('::ffff:127.') ||
    value.startsWith('::ffff:10.') ||
    value.startsWith('::ffff:192.168.') ||
    value.startsWith('::ffff:169.254.')
  );
}

async function assertSafeRemoteImageUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) image URLs can be shared.');
  }
  if (url.username || url.password) {
    throw new Error('Image URLs with credentials cannot be shared.');
  }
  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost image URLs cannot be shared.');
  }
  const directIpVersion = net.isIP(hostname);
  const addresses = directIpVersion
    ? [{ address: hostname, family: directIpVersion }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error('Image URL host could not be resolved.');
  }
  for (const address of addresses) {
    if (address.family === 4 && isPrivateIPv4(address.address)) {
      throw new Error('Private network image URLs cannot be shared.');
    }
    if (address.family === 6 && isPrivateIPv6(address.address)) {
      throw new Error('Private network image URLs cannot be shared.');
    }
  }
}

async function downloadRemoteImage(remoteUrl: string): Promise<LoadedArtifactFile> {
  let currentUrl = new URL(remoteUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REMOTE_REDIRECTS; redirectCount += 1) {
    await assertSafeRemoteImageUrl(currentUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REMOTE_REDIRECTS) {
          throw new Error('Image URL redirected too many times.');
        }
        currentUrl = new URL(location, currentUrl);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Image download failed with HTTP ${response.status}.`);
      }
      const declaredLength = Number(response.headers.get('content-length') || '0');
      if (declaredLength > MAX_CLIENT_SINGLE_FILE_BYTES) {
        throw new Error('Image exceeds the share size limit.');
      }
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (contentType && !IMAGE_CONTENT_TYPES[contentType]) {
        throw new Error('Remote URL did not return a supported image type.');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_CLIENT_SINGLE_FILE_BYTES) {
        throw new Error('Image exceeds the share size limit.');
      }
      return {
        bytes,
        contentType,
        fileName: cleanFileName(path.basename(currentUrl.pathname), 'image'),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Image URL redirected too many times.');
}

async function loadArtifactFile(input: ArtifactFileSharePackageInput): Promise<LoadedArtifactFile> {
  if (input.filePath) {
    const resolvedPath = path.resolve(input.filePath);
    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error('Shared artifact file does not exist.');
    }
    const maxBytes =
      input.sourceType === HtmlShareSourceType.DocumentFile
        ? MAX_CLIENT_DOCUMENT_FILE_BYTES
        : MAX_CLIENT_SINGLE_FILE_BYTES;
    if (stat.size > maxBytes) {
      throw new Error('Artifact exceeds the share size limit.');
    }
    return {
      bytes: await fs.promises.readFile(resolvedPath),
      fileName: input.fileName || path.basename(resolvedPath),
    };
  }

  if (input.sourceType === HtmlShareSourceType.ImageFile) {
    const content = input.content?.trim();
    const dataUrl = content?.startsWith('data:') ? parseDataUrl(content) : null;
    if (dataUrl) {
      return {
        bytes: dataUrl.bytes,
        contentType: dataUrl.contentType,
        fileName: input.fileName || 'image',
      };
    }
    const remoteUrl = input.remoteUrl || (/^https?:\/\//i.test(content || '') ? content : '');
    if (remoteUrl) {
      return downloadRemoteImage(remoteUrl);
    }
    throw new Error('Current image preview content cannot be shared.');
  }

  if (input.sourceType === HtmlShareSourceType.DocumentFile) {
    if (input.remoteUrl) {
      throw new Error('Remote document URLs cannot be shared.');
    }
    const content = input.content?.trim();
    const dataUrl = content?.startsWith('data:') ? parseDataUrl(content) : null;
    if (!dataUrl) {
      throw new Error('Current document preview content cannot be shared.');
    }
    return {
      bytes: dataUrl.bytes,
      contentType: dataUrl.contentType,
      fileName: input.fileName || 'document',
    };
  }

  if (input.remoteUrl) {
    throw new Error('Remote SVG URLs cannot be shared.');
  }
  const content = input.content?.trim();
  if (!content) {
    throw new Error('Current SVG preview content cannot be shared.');
  }
  const dataUrl = content.startsWith('data:') ? parseDataUrl(content) : null;
  return {
    bytes: dataUrl ? dataUrl.bytes : Buffer.from(content, 'utf8'),
    contentType: dataUrl?.contentType || 'image/svg+xml',
    fileName: input.fileName || 'image.svg',
  };
}

function normalizeImageFile(loaded: LoadedArtifactFile): LoadedArtifactFile {
  const magicExtension = imageMagicExtension(loaded.bytes);
  const contentTypeExtension = loaded.contentType ? IMAGE_CONTENT_TYPES[loaded.contentType] : undefined;
  const nameExtension = extensionFromName(loaded.fileName);
  const expectedExtension = nameExtension || contentTypeExtension || magicExtension;
  if (!magicExtension || !expectedExtension || !IMAGE_EXTENSIONS.has(expectedExtension)) {
    throw new Error('Current image type is not supported for sharing.');
  }
  if (expectedExtension !== magicExtension && !(expectedExtension === 'jpeg' && magicExtension === 'jpg')) {
    throw new Error('Image extension does not match the file content.');
  }
  const fileName = cleanFileName(
    extensionFromName(loaded.fileName) ? loaded.fileName : `image.${magicExtension}`,
    `image.${magicExtension}`,
  );
  return {
    bytes: loaded.bytes,
    fileName,
    contentType: contentTypeForImageExtension(magicExtension),
  };
}

function assertSafeSvgClientSide(bytes: Buffer): void {
  const text = bytes.toString('utf8');
  const normalized = text
    .replace(/\sxmlns(?::[a-z0-9_-]+)?\s*=\s*(['"])https?:\/\/www\.w3\.org\/[^'"]+\1/gi, '')
    .toLowerCase();
  if (
    !normalized.includes('<svg') ||
    normalized.includes('<script') ||
    /\son[a-z]+\s*=/.test(normalized) ||
    normalized.includes('javascript:') ||
    normalized.includes('<foreignobject') ||
    normalized.includes('<image') ||
    normalized.includes('<use') ||
    hasUnsafeSvgReference(normalized) ||
    normalized.includes('<!doctype')
  ) {
    throw new Error('SVG contains unsafe content and cannot be shared.');
  }
}

function hasUnsafeSvgReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, '');
  return (
    compact.includes('javascript:') ||
    compact.includes('data:') ||
    normalized.includes('http://') ||
    normalized.includes('https://') ||
    normalized.includes('//') ||
    normalized.includes('@import') ||
    hasUnsafeSvgUrlFunction(normalized)
  );
}

function hasUnsafeSvgUrlFunction(value: string): boolean {
  let index = 0;
  while ((index = value.indexOf('url(', index)) >= 0) {
    const start = index + 4;
    const end = value.indexOf(')', start);
    if (end < 0) return true;
    let reference = value.slice(start, end).trim();
    if (
      (reference.startsWith('"') && reference.endsWith('"')) ||
      (reference.startsWith("'") && reference.endsWith("'"))
    ) {
      reference = reference.slice(1, -1).trim();
    }
    if (!reference.startsWith('#') || reference.length <= 1) return true;
    index = end + 1;
  }
  return false;
}

function normalizeSvgFile(loaded: LoadedArtifactFile): LoadedArtifactFile {
  const nameExtension = extensionFromName(loaded.fileName);
  if (nameExtension && nameExtension !== 'svg') {
    throw new Error('Only SVG files can be shared as SVG.');
  }
  assertSafeSvgClientSide(loaded.bytes);
  const cleanedFileName = cleanFileName(loaded.fileName || 'image.svg', 'image.svg');
  return {
    bytes: loaded.bytes,
    fileName: extensionFromName(cleanedFileName)
      ? cleanedFileName.replace(/\.[^.]+$/, '.svg')
      : `${cleanedFileName}.svg`,
    contentType: 'image/svg+xml',
  };
}

function normalizeDocumentFile(loaded: LoadedArtifactFile): LoadedArtifactFile {
  const extension = extensionFromName(loaded.fileName);
  if (!extension || !DOCUMENT_CONTENT_TYPES[extension]) {
    throw new Error('Current document type is not supported for sharing.');
  }
  if (loaded.bytes.length > MAX_CLIENT_DOCUMENT_FILE_BYTES) {
    throw new Error('Artifact exceeds the share size limit.');
  }
  if (!matchesDocumentMagic(extension, loaded.bytes)) {
    throw new Error('Document extension does not match the file content.');
  }
  const fileName = cleanFileName(loaded.fileName || `document.${extension}`, `document.${extension}`);
  return {
    bytes: loaded.bytes,
    fileName: extensionFromName(fileName) ? fileName : `${fileName}.${extension}`,
    contentType: DOCUMENT_CONTENT_TYPES[extension],
  };
}

function matchesDocumentMagic(extension: string, bytes: Buffer): boolean {
  if (extension === 'pdf') {
    return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (extension === 'csv' || extension === 'tsv') {
    return !bytes.includes(0);
  }
  if (extension === 'docx' || extension === 'pptx' || extension === 'xlsx') {
    return bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
  }
  return false;
}

async function writeSingleFileZip(file: LoadedArtifactFile): Promise<{ archivePath: string; sourceSha256: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-artifact-share-'));
  const archivePath = path.join(tempDir, 'share.zip');
  const sourcePath = path.join(tempDir, file.fileName);
  await fs.promises.writeFile(sourcePath, file.bytes);

  const zipFile = new yazl.ZipFile();
  zipFile.on('error', (err) => {
    (zipFile.outputStream as unknown as { destroy(err: Error): void }).destroy(err as Error);
  });
  zipFile.addFile(sourcePath, file.fileName);
  const outputStream = fs.createWriteStream(archivePath);
  const pipelinePromise = pipeline(zipFile.outputStream, outputStream);
  zipFile.end();
  await pipelinePromise;

  const stat = await fs.promises.stat(archivePath);
  const maxArchiveBytes =
    DOCUMENT_CONTENT_TYPES[extensionFromName(file.fileName)]
      ? MAX_CLIENT_DOCUMENT_ARCHIVE_BYTES
      : MAX_CLIENT_ARCHIVE_BYTES;
  if (stat.size > maxArchiveBytes) {
    throw new Error('Share archive exceeds the size limit.');
  }
  const archiveBytes = await fs.promises.readFile(archivePath);
  return {
    archivePath,
    sourceSha256: crypto.createHash('sha256').update(archiveBytes).digest('hex'),
  };
}

export async function packageArtifactFile(
  input: ArtifactFileSharePackageInput,
): Promise<ArtifactFileSharePackageResult> {
  const loaded = await loadArtifactFile(input);
  const maxBytes =
    input.sourceType === HtmlShareSourceType.DocumentFile
      ? MAX_CLIENT_DOCUMENT_FILE_BYTES
      : MAX_CLIENT_SINGLE_FILE_BYTES;
  if (loaded.bytes.length > maxBytes) {
    throw new Error('Artifact exceeds the share size limit.');
  }
  const normalized =
    input.sourceType === HtmlShareSourceType.ImageFile
      ? normalizeImageFile(loaded)
      : input.sourceType === HtmlShareSourceType.DocumentFile
        ? normalizeDocumentFile(loaded)
        : normalizeSvgFile(loaded);
  const { archivePath, sourceSha256: archiveSha256 } = await writeSingleFileZip(normalized);
  return {
    archivePath,
    sourceSha256: input.sourceType === HtmlShareSourceType.DocumentFile
      ? crypto.createHash('sha256').update(normalized.bytes).digest('hex')
      : archiveSha256,
    entryFile: normalized.fileName,
    totalFiles: 1,
    totalBytes: normalized.bytes.length,
    contentType: normalized.contentType || 'application/octet-stream',
    warnings: [],
  };
}
