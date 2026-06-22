import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

import {
  buildOpenClawCompileCacheEnv,
  buildOpenClawGatewayExecArgv,
} from './openclawEngineManager';

describe('buildOpenClawCompileCacheEnv', () => {
  test('prevents the packaged launcher from respawning Electron Helper', () => {
    expect(buildOpenClawCompileCacheEnv('/tmp/openclaw-cache')).toEqual({
      NODE_COMPILE_CACHE: '/tmp/openclaw-cache',
      OPENCLAW_PACKAGED_COMPILE_CACHE_RESPAWNED: '1',
    });
  });
});

describe('buildOpenClawGatewayExecArgv', () => {
  test('adds a gateway heap limit when NODE_OPTIONS is empty', () => {
    expect(buildOpenClawGatewayExecArgv(undefined)).toEqual(['--max-old-space-size=4096']);
  });

  test('adds a gateway heap limit alongside unrelated NODE_OPTIONS', () => {
    expect(buildOpenClawGatewayExecArgv('--trace-warnings')).toEqual(['--max-old-space-size=4096']);
  });

  test('respects an existing max old space setting with equals syntax', () => {
    expect(buildOpenClawGatewayExecArgv('--max-old-space-size=8192 --trace-warnings')).toEqual([]);
  });

  test('respects an existing max old space setting with space syntax', () => {
    expect(buildOpenClawGatewayExecArgv('--max-old-space-size 8192 --trace-warnings')).toEqual([]);
  });
});
