import fs from 'fs';
import path from 'path';

const HTML_REFERENCE_PATTERN =
  /\b(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;

const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?["']([^"')]+)["']\s*\)?/gi;

function isRemoteOrSpecialReference(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|mailto:|tel:)/i.test(value.trim());
}

function stripReferenceQuery(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? '';
}

function resolveDependency(rootDir: string, fromFile: string, reference: string): string | null {
  const cleanReference = stripReferenceQuery(reference.trim());
  if (!cleanReference || isRemoteOrSpecialReference(cleanReference)) return null;

  const baseDir = cleanReference.startsWith('/')
    ? rootDir
    : path.dirname(fromFile);
  const resolved = path.resolve(baseDir, cleanReference.replace(/^\/+/, ''));
  const relative = path.relative(rootDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function scanReferences(content: string): string[] {
  const references: string[] = [];
  for (const pattern of [HTML_REFERENCE_PATTERN, CSS_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const value = match[1] || match[2];
      if (value) references.push(value);
    }
  }
  return references;
}

export interface HtmlDependencyScanResult {
  missing: string[];
}

export async function scanHtmlDependencies(rootDir: string, entryFile: string): Promise<HtmlDependencyScanResult> {
  const pending = [path.resolve(rootDir, entryFile)];
  const visited = new Set<string>();
  const missing = new Set<string>();

  while (pending.length) {
    const filePath = pending.shift()!;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    let content = '';
    try {
      content = await fs.promises.readFile(filePath, 'utf8');
    } catch {
      missing.add(path.relative(rootDir, filePath));
      continue;
    }

    for (const reference of scanReferences(content)) {
      const resolved = resolveDependency(rootDir, filePath, reference);
      if (!resolved) continue;
      try {
        const stat = await fs.promises.stat(resolved);
        if (!stat.isFile()) {
          missing.add(path.relative(rootDir, resolved));
          continue;
        }
        if (/\.(?:html?|css)$/i.test(resolved)) {
          pending.push(resolved);
        }
      } catch {
        missing.add(path.relative(rootDir, resolved));
      }
    }
  }

  return { missing: Array.from(missing).sort() };
}
