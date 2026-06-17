import { describe, test } from 'vitest';

import { expectPatchContains } from './patchTestUtils';

describe('openclaw-im-bound-agent-run-cwd.patch', () => {
  test('keeps agent cwd schema and runtime resolution in the current OpenClaw patch set', () => {
    expectPatchContains('openclaw-im-bound-agent-run-cwd.patch', [
      'resolveAgentRunCwd',
      'cfg.agents?.defaults?.cwd',
      'cwd: z.string().optional()',
      'workspaceDir: runCwd',
    ]);
  });
});
