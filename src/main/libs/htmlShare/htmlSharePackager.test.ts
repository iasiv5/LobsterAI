import fs from 'fs';
import JSZip from 'jszip';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { packageHtmlFile } from './htmlSharePackager';

const tempRoots: string[] = [];
const archiveRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-html-share-packager-test-'));
  tempRoots.push(root);
  return root;
}

async function writeFile(filePath: string, content: string | Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}

async function getArchiveEntries(archivePath: string): Promise<string[]> {
  archiveRoots.push(path.dirname(archivePath));
  const data = await fs.promises.readFile(archivePath);
  const zip = await JSZip.loadAsync(data);
  return Object.values(zip.files)
    .filter(file => !file.dir)
    .map(file => file.name)
    .sort((a, b) => a.localeCompare(b));
}

afterEach(async () => {
  await Promise.all([
    ...tempRoots.splice(0).map(root => fs.promises.rm(root, { recursive: true, force: true })),
    ...archiveRoots.splice(0).map(root => fs.promises.rm(root, { recursive: true, force: true })),
  ]);
});

describe('htmlSharePackager', () => {
  test('packages only the dependency closure for an HTML file', async () => {
    const root = await createTempRoot();
    await writeFile(
      path.join(root, 'pond.html'),
      [
        '<!doctype html>',
        '<link rel="stylesheet" href="pond.css">',
        '<img src="frog.png">',
        '<script src="pond.js"></script>',
      ].join('\n'),
    );
    await writeFile(path.join(root, 'pond.css'), 'body { color: green; }');
    await writeFile(path.join(root, 'pond.js'), 'console.log("pond");');
    await writeFile(path.join(root, 'frog.png'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(root, 'unrelated.md'), 'do not include');
    await writeFile(path.join(root, 'other.html'), '<p>do not include</p>');

    const packaged = await packageHtmlFile(path.join(root, 'pond.html'));
    const entries = await getArchiveEntries(packaged.archivePath);

    expect(packaged.entryFile).toBe('pond.html');
    expect(entries).toEqual(['frog.png', 'pond.css', 'pond.html', 'pond.js']);
    expect(packaged.warnings).toEqual([]);
  });

  test('recursively includes CSS imports and url dependencies', async () => {
    const root = await createTempRoot();
    await writeFile(
      path.join(root, 'index.html'),
      '<!doctype html><link rel="stylesheet" href="styles/main.css">',
    );
    await writeFile(
      path.join(root, 'styles/main.css'),
      '@import "./theme.css"; body { background: url("../assets/bg.png?v=1"); }',
    );
    await writeFile(
      path.join(root, 'styles/theme.css'),
      '@font-face { src: url("../assets/font.woff2#font"); }',
    );
    await writeFile(path.join(root, 'assets/bg.png'), Buffer.from([1]));
    await writeFile(path.join(root, 'assets/font.woff2'), Buffer.from([2]));

    const packaged = await packageHtmlFile(path.join(root, 'index.html'));
    const entries = await getArchiveEntries(packaged.archivePath);

    expect(entries).toEqual([
      'assets/bg.png',
      'assets/font.woff2',
      'index.html',
      'styles/main.css',
      'styles/theme.css',
    ]);
  });

  test('supports referenced assets outside the HTML directory within the project boundary', async () => {
    const root = await createTempRoot();
    await writeFile(path.join(root, 'package.json'), '{"name":"fixture"}');
    await writeFile(
      path.join(root, 'pages/pond.html'),
      [
        '<!doctype html>',
        '<link rel="stylesheet" href="../assets/pond.css">',
        '<img src="../assets/fish.jpeg">',
      ].join('\n'),
    );
    await writeFile(path.join(root, 'assets/pond.css'), 'body { color: blue; }');
    await writeFile(path.join(root, 'assets/fish.jpeg'), Buffer.from([3]));
    await writeFile(path.join(root, 'notes.md'), 'do not include');

    const packaged = await packageHtmlFile(path.join(root, 'pages/pond.html'));
    const entries = await getArchiveEntries(packaged.archivePath);

    expect(packaged.entryFile).toBe('pages/pond.html');
    expect(entries).toEqual(['assets/fish.jpeg', 'assets/pond.css', 'pages/pond.html']);
  });

  test('blocks sensitive workspace directories even when referenced', async () => {
    const root = await createTempRoot();
    await writeFile(
      path.join(root, 'index.html'),
      [
        '<!doctype html>',
        '<a href="memory/day.md">memory</a>',
        '<script src=".openclaw/state.js"></script>',
      ].join('\n'),
    );
    await writeFile(path.join(root, 'memory/day.md'), 'private');
    await writeFile(path.join(root, '.openclaw/state.js'), 'console.log("private");');

    const packaged = await packageHtmlFile(path.join(root, 'index.html'));
    const entries = await getArchiveEntries(packaged.archivePath);

    expect(entries).toEqual(['index.html']);
    expect(packaged.warnings).toEqual([
      'Blocked referenced resource: .openclaw/state.js',
      'Blocked referenced resource: memory/day.md',
    ]);
  });
});
