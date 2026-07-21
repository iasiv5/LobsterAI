import { AuthSubscriptionStatus } from '@shared/auth/constants';
import { describe, expect, test, vi } from 'vitest';

import {
  ArtifactSubscriptionBlockReason,
  ArtifactSubscriptionFeature,
  getArtifactSubscriptionDecision,
  getArtifactSubscriptionPromptCopyKeys,
  resolveArtifactSubscriptionDecision,
} from './artifactSubscriptionGate';

describe('artifactSubscriptionGate', () => {
  test('allows an active subscriber without refreshing auth state', async () => {
    const refreshSnapshot = vi.fn();
    await expect(resolveArtifactSubscriptionDecision({
      isLoggedIn: true,
      subscriptionStatus: AuthSubscriptionStatus.Active,
    }, refreshSnapshot)).resolves.toEqual({ allowed: true });
    expect(refreshSnapshot).not.toHaveBeenCalled();
  });

  test('uses refreshed auth state before blocking the action', async () => {
    const refreshSnapshot = vi.fn().mockResolvedValue({
      isLoggedIn: true,
      subscriptionStatus: AuthSubscriptionStatus.Active,
    });
    await expect(resolveArtifactSubscriptionDecision({
      isLoggedIn: true,
      subscriptionStatus: AuthSubscriptionStatus.Free,
    }, refreshSnapshot)).resolves.toEqual({ allowed: true });
    expect(refreshSnapshot).toHaveBeenCalledOnce();
  });

  test('distinguishes login and subscription blockers', () => {
    expect(getArtifactSubscriptionDecision({
      isLoggedIn: false,
      subscriptionStatus: AuthSubscriptionStatus.Free,
    })).toEqual({
      allowed: false,
      reason: ArtifactSubscriptionBlockReason.LoginRequired,
    });
    expect(getArtifactSubscriptionDecision({
      isLoggedIn: true,
      subscriptionStatus: AuthSubscriptionStatus.Free,
    })).toEqual({
      allowed: false,
      reason: ArtifactSubscriptionBlockReason.SubscriptionRequired,
    });
  });

  test.each([
    [
      ArtifactSubscriptionFeature.Share,
      ArtifactSubscriptionBlockReason.LoginRequired,
      'htmlShareLoginRequiredTitle',
    ],
    [
      ArtifactSubscriptionFeature.Share,
      ArtifactSubscriptionBlockReason.SubscriptionRequired,
      'htmlShareSubscriptionRequiredTitle',
    ],
    [
      ArtifactSubscriptionFeature.Deployment,
      ArtifactSubscriptionBlockReason.LoginRequired,
      'nodeDeploymentLoginRequiredTitle',
    ],
    [
      ArtifactSubscriptionFeature.Deployment,
      ArtifactSubscriptionBlockReason.SubscriptionRequired,
      'nodeDeploymentSubscriptionRequiredTitle',
    ],
  ])('maps %s and %s to feature-specific copy', (feature, reason, expectedTitleKey) => {
    expect(getArtifactSubscriptionPromptCopyKeys(feature, reason).titleKey).toBe(expectedTitleKey);
  });
});
