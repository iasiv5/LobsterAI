import { AuthSubscriptionStatus } from '@shared/auth/constants';

export const ArtifactSubscriptionFeature = {
  Share: 'share',
  Deployment: 'deployment',
} as const;

export type ArtifactSubscriptionFeature =
  (typeof ArtifactSubscriptionFeature)[keyof typeof ArtifactSubscriptionFeature];

export const ArtifactSubscriptionBlockReason = {
  LoginRequired: 'login_required',
  SubscriptionRequired: 'subscription_required',
} as const;

export type ArtifactSubscriptionBlockReason =
  (typeof ArtifactSubscriptionBlockReason)[keyof typeof ArtifactSubscriptionBlockReason];

export interface ArtifactSubscriptionPromptState {
  feature: ArtifactSubscriptionFeature;
  reason: ArtifactSubscriptionBlockReason;
}

export interface ArtifactSubscriptionSnapshot {
  isLoggedIn: boolean;
  subscriptionStatus?: string | null;
}

export type ArtifactSubscriptionDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: ArtifactSubscriptionBlockReason;
    };

export interface ArtifactSubscriptionPromptCopyKeys {
  titleKey: string;
  messageKey: string;
}

const ARTIFACT_SUBSCRIPTION_PROMPT_COPY_KEYS: Record<
  ArtifactSubscriptionFeature,
  Record<ArtifactSubscriptionBlockReason, ArtifactSubscriptionPromptCopyKeys>
> = {
  [ArtifactSubscriptionFeature.Share]: {
    [ArtifactSubscriptionBlockReason.LoginRequired]: {
      titleKey: 'htmlShareLoginRequiredTitle',
      messageKey: 'htmlShareLoginRequiredMessage',
    },
    [ArtifactSubscriptionBlockReason.SubscriptionRequired]: {
      titleKey: 'htmlShareSubscriptionRequiredTitle',
      messageKey: 'htmlShareSubscriptionRequiredMessage',
    },
  },
  [ArtifactSubscriptionFeature.Deployment]: {
    [ArtifactSubscriptionBlockReason.LoginRequired]: {
      titleKey: 'nodeDeploymentLoginRequiredTitle',
      messageKey: 'nodeDeploymentLoginRequiredMessage',
    },
    [ArtifactSubscriptionBlockReason.SubscriptionRequired]: {
      titleKey: 'nodeDeploymentSubscriptionRequiredTitle',
      messageKey: 'nodeDeploymentSubscriptionRequiredMessage',
    },
  },
};

export function getArtifactSubscriptionDecision(
  snapshot: ArtifactSubscriptionSnapshot,
): ArtifactSubscriptionDecision {
  if (!snapshot.isLoggedIn) {
    return {
      allowed: false,
      reason: ArtifactSubscriptionBlockReason.LoginRequired,
    };
  }
  if (snapshot.subscriptionStatus !== AuthSubscriptionStatus.Active) {
    return {
      allowed: false,
      reason: ArtifactSubscriptionBlockReason.SubscriptionRequired,
    };
  }
  return { allowed: true };
}

export async function resolveArtifactSubscriptionDecision(
  snapshot: ArtifactSubscriptionSnapshot,
  refreshSnapshot: () => Promise<ArtifactSubscriptionSnapshot>,
): Promise<ArtifactSubscriptionDecision> {
  const initialDecision = getArtifactSubscriptionDecision(snapshot);
  if (initialDecision.allowed) return initialDecision;
  return getArtifactSubscriptionDecision(await refreshSnapshot());
}

export function getArtifactSubscriptionPromptCopyKeys(
  feature: ArtifactSubscriptionFeature,
  reason: ArtifactSubscriptionBlockReason,
): ArtifactSubscriptionPromptCopyKeys {
  return ARTIFACT_SUBSCRIPTION_PROMPT_COPY_KEYS[feature][reason];
}
