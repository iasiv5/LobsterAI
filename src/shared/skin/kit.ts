import { SkinWorkflowKind } from './constants';

export const SkinPackKitId = {
  BuiltIn: 'ai-skin-designer',
} as const;

export type SkinPackKitId = typeof SkinPackKitId[keyof typeof SkinPackKitId];

export const SkinPackSkillId = {
  BuiltIn: 'skin-creator',
} as const;

export type SkinPackSkillId = typeof SkinPackSkillId[keyof typeof SkinPackSkillId];

export const SkinPackKitBundle = {
  BuiltIn: `builtin://${SkinPackKitId.BuiltIn}`,
} as const;

export const SkinPackKitMetadata = {
  Version: '0.3.0',
  IconUrl: 'https://ydhardwarebusiness.nosdn.127.net/1df64d1ffdd4213a763bfb7f86883515.png',
  WorkflowKind: SkinWorkflowKind.SkinPack,
} as const;
