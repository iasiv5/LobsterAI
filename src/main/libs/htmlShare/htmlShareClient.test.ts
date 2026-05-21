import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  HtmlShareAccessMode,
  HtmlShareSourceType,
  HtmlShareStatus,
} from '../../../shared/htmlShare/constants';
import { buildHtmlSharePublicUrl, uploadHtmlShare } from './htmlShareClient';

const tempRoots: string[] = [];

const createArchiveFile = async (): Promise<string> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-html-share-client-test-'));
  tempRoots.push(root);
  const archivePath = path.join(root, 'share.zip');
  await fs.promises.writeFile(archivePath, 'zip-content');
  return archivePath;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(root => fs.promises.rm(root, { recursive: true, force: true })),
  );
});

describe('htmlShareClient', () => {
  test('builds environment-specific public share URLs', () => {
    expect(buildHtmlSharePublicUrl('https://lobsterai-server.inner.youdao.com/s', 'shr_123')).toBe(
      'https://lobsterai-server.inner.youdao.com/s/shr_123/',
    );
    expect(buildHtmlSharePublicUrl('https://lobsterai-server.youdao.com/s/', 'shr_123')).toBe(
      'https://lobsterai-server.youdao.com/s/shr_123/',
    );
  });

  test('uploads to the selected server and returns the selected public URL', async () => {
    const archivePath = await createArchiveFile();
    let requestedUrl = '';

    const result = await uploadHtmlShare(
      'https://lobsterai-server.inner.youdao.com',
      'https://lobsterai-server.inner.youdao.com/s',
      async url => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              shareId: 'shr_test',
              url: 'https://lobsterai-server.youdao.com/s/shr_test/',
              accessMode: HtmlShareAccessMode.Code,
              shareCode: 'K7Q9P2',
              status: HtmlShareStatus.Live,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
      {
        archivePath,
        sourceType: HtmlShareSourceType.HtmlFile,
        accessMode: HtmlShareAccessMode.Code,
        sessionId: 'session-1',
        artifactId: 'artifact-1',
        title: 'Preview',
        entryFile: 'index.html',
        sourceSha256: 'hash',
      },
    );

    expect(requestedUrl).toBe('https://lobsterai-server.inner.youdao.com/api/html-shares');
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://lobsterai-server.inner.youdao.com/s/shr_test/');
    expect(result.shareCode).toBe('K7Q9P2');
  });
});
