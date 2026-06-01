import { expect, test } from 'vitest';

import {
  getLargeMarkdownPreview,
  isInternalHref,
  safeUrlTransform,
  shouldUseLargeMarkdownPreview,
} from './MarkdownContent';

test('large markdown preview threshold only applies to oversized content', () => {
  expect(shouldUseLargeMarkdownPreview('x'.repeat(8 * 1024))).toBe(false);
  expect(shouldUseLargeMarkdownPreview('x'.repeat(8 * 1024 + 1))).toBe(true);
});

test('large markdown preview keeps the head and latest tail', () => {
  const content = `head-${'x'.repeat(8 * 1024)}-middle-${'y'.repeat(8 * 1024)}-tail`;
  const preview = getLargeMarkdownPreview(content);

  expect(preview.startsWith('head-')).toBe(true);
  expect(preview).toContain('\n...\n');
  expect(preview.endsWith('-tail')).toBe(true);
  expect(preview.length).toBeLessThan(content.length);
});

test('kit links are treated as safe internal links', () => {
  expect(safeUrlTransform('kit://design@lobsterai-kits')).toBe('kit://design@lobsterai-kits');
  expect(isInternalHref('kit://design@lobsterai-kits')).toBe(true);
});

test('unsafe markdown protocols are still stripped', () => {
  expect(safeUrlTransform('javascript:alert(1)')).toBe('');
});
