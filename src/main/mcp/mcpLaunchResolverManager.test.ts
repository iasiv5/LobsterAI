import path from 'path';
import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getName: () => 'LobsterAI',
    getPath: () => process.cwd(),
    isPackaged: false,
  },
  session: { defaultSession: { resolveProxy: vi.fn() } },
}));

import { McpLaunchResolutionStatus, McpLaunchResolverKind } from './mcpLaunchResolution';
import {
  isStaleInstallingResolution,
  packageRootFromInstallDir,
} from './mcpLaunchResolverManager';

test('packageRootFromInstallDir preserves scoped npm package paths', () => {
  expect(packageRootFromInstallDir('C:\\managed', '@upstash/context7-mcp')).toBe(
    path.join('C:\\managed', 'node_modules', '@upstash', 'context7-mcp'),
  );
});

test('packageRootFromInstallDir resolves unscoped npm package paths', () => {
  expect(packageRootFromInstallDir('C:\\managed', 'tavily-mcp')).toBe(
    path.join('C:\\managed', 'node_modules', 'tavily-mcp'),
  );
});

test('isStaleInstallingResolution detects abandoned installs', () => {
  const now = 1_000_000;

  expect(isStaleInstallingResolution({
    serverId: 'server-1',
    resolverKind: McpLaunchResolverKind.Npx,
    sourceFingerprint: 'fingerprint',
    status: McpLaunchResolutionStatus.Installing,
    updatedAt: now - 151_000,
  }, now)).toBe(true);

  expect(isStaleInstallingResolution({
    serverId: 'server-1',
    resolverKind: McpLaunchResolverKind.Npx,
    sourceFingerprint: 'fingerprint',
    status: McpLaunchResolutionStatus.Installing,
    updatedAt: now - 149_000,
  }, now)).toBe(false);
});
