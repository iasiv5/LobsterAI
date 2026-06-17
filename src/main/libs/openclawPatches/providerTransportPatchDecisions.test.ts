import { describe, test } from 'vitest';

import { expectCurrentOpenClawPatchMissing } from './patchTestUtils';

describe('provider transport OpenClaw patch decisions', () => {
  test('does not carry extra_body passthrough patch because OpenClaw 6.1 has upstream support', () => {
    expectCurrentOpenClawPatchMissing('openclaw-extra-body-passthrough.patch');
  });

  test('does not carry Codex native transport patch because OpenClaw 6.1 routes ChatGPT Codex natively', () => {
    expectCurrentOpenClawPatchMissing('openclaw-codex-use-native-transport.patch');
  });

  test('does not carry DeepSeek V4 thinking mode patch because OpenClaw 6.1 has upstream thinking wrappers', () => {
    expectCurrentOpenClawPatchMissing('openclaw-deepseek-v4-thinking-mode.patch');
  });

  test('does not carry DeepSeek/MiMo reasoning replay patch because OpenClaw 6.1 has upstream replay hooks', () => {
    expectCurrentOpenClawPatchMissing('openclaw-deepseek-mimo-reasoning-replay.patch');
  });
});
