import {
  HtmlShareAccessMode,
  type HtmlShareAccessMode as HtmlShareAccessModeValue,
  HtmlShareDisabledSource,
  type HtmlShareDisabledSource as HtmlShareDisabledSourceValue,
  HtmlShareErrorCode,
  HtmlShareStatus,
  type HtmlShareStatus as HtmlShareStatusValue,
} from '@shared/htmlShare/constants';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';

import { authService } from '@/services/auth';
import { copyTextToClipboard } from '@/services/clipboard';
import { getPortalPricingUrl, PortalPricingKeyfrom } from '@/services/endpoints';
import { i18nService } from '@/services/i18n';
import type { RootState } from '@/store';
import type { Artifact } from '@/types/artifact';

import { reportArtifactPreviewAction } from './artifactAnalytics';
import { buildArtifactFileShareCopyText } from './artifactFileShareCopy';
import {
  ArtifactFileShareCopyStatus,
  ArtifactFileShareOperation,
  ArtifactFileSharePhase,
  ArtifactFileShareUpdateStatus,
} from './ArtifactFileShareDialog';
import ArtifactFileShareDialog from './ArtifactFileShareDialog';
import {
  ArtifactFileShareIntent,
  type ArtifactFileShareIntent as ArtifactFileShareIntentValue,
  getArtifactFileShareCreateAccessMode,
  isArtifactFileSharePermissionDirty,
} from './artifactFileShareDialogModel';
import {
  ArtifactFileSharePermission,
  type ArtifactFileSharePermission as ArtifactFileSharePermissionValue,
  ArtifactFileSharePermissionChangeAction,
  buildArtifactFileSharePermissionPlan,
  deriveArtifactFileSharePermission,
  isArtifactFileShareResumeLocked,
} from './artifactFileSharePermission';
import {
  type ArtifactFileShareRequest,
  ArtifactFileShareRequestSource,
  buildArtifactFileShareRequest,
  getArtifactFileShareSourceType,
  isArtifactFileShareable,
} from './artifactFileSharePolicy';
import {
  ArtifactSubscriptionBlockReason,
  ArtifactSubscriptionFeature,
  type ArtifactSubscriptionPromptState,
  resolveArtifactSubscriptionDecision,
} from './artifactSubscriptionGate';
import ArtifactSubscriptionPromptDialog from './ArtifactSubscriptionPromptDialog';

const t = (key: string) => i18nService.t(key);

interface ArtifactFileShareRecord {
  shareId: string;
  url: string;
  accessMode: HtmlShareAccessModeValue;
  shareCode?: string;
  shareCodeUnavailable?: boolean;
  status: HtmlShareStatusValue;
  disabledSource?: HtmlShareDisabledSourceValue | null;
}

interface ArtifactFileShareDialogState {
  artifact: Artifact;
  request?: ArtifactFileShareRequest;
  phase: ArtifactFileSharePhase;
  intent?: ArtifactFileShareIntentValue;
  operation?: ArtifactFileShareOperation;
  share?: ArtifactFileShareRecord;
  selectedPermission?: ArtifactFileSharePermissionValue;
  message?: string;
  error?: string;
}

interface PreparedArtifactFileShare {
  share?: ArtifactFileShareRecord;
}

interface ArtifactFileShareControllerValue {
  openShare: (artifact: Artifact) => Promise<void>;
}

interface ArtifactFileShareProviderProps {
  sessionId: string;
  children: ReactNode;
}

type HtmlShareApi = NonNullable<typeof window.electron>['htmlShare'];
type HtmlShareResult = Awaited<ReturnType<HtmlShareApi['createFromHtmlFile']>>;

const ArtifactFileShareContext = createContext<ArtifactFileShareControllerValue | null>(null);

class ArtifactFileShareRequestError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'ArtifactFileShareRequestError';
    this.code = code;
  }
}

function isSubscriptionRequiredError(error: unknown): boolean {
  return error instanceof ArtifactFileShareRequestError &&
    error.code === HtmlShareErrorCode.SubscriptionRequired;
}

function normalizeAccessMode(accessMode?: HtmlShareAccessModeValue): HtmlShareAccessModeValue {
  return accessMode === HtmlShareAccessMode.Public
    ? HtmlShareAccessMode.Public
    : HtmlShareAccessMode.Code;
}

function getFailureMessage(result: { code?: number; error?: string } | null | undefined): string {
  if (result?.code === HtmlShareErrorCode.SubscriptionRequired) {
    return t('htmlShareSubscriptionRequiredMessage');
  }
  if (result?.code === HtmlShareErrorCode.FeatureUnavailable) {
    return t('htmlShareUnavailableInProduction');
  }
  if (result?.code === HtmlShareErrorCode.ReopenUnavailable) {
    return t('htmlShareReopenUnavailable');
  }
  if (result?.code === HtmlShareErrorCode.ActiveShareLimitReached) {
    return t('htmlShareActiveLimitReached');
  }
  if (result?.code === HtmlShareErrorCode.DisabledCannotUpdate) {
    return t('htmlShareDisabledCannotUpdate');
  }
  if (result?.code === HtmlShareErrorCode.UnsafeSvg) {
    return t('artifactShareSvgRejected');
  }
  return result?.error || t('htmlShareFailed');
}

function getShareRecord(
  value:
    | {
        success?: boolean;
        shareId?: string;
        url?: string;
        accessMode?: HtmlShareAccessModeValue;
        shareCode?: string;
        shareCodeUnavailable?: boolean;
        status?: HtmlShareStatusValue;
        disabledSource?: HtmlShareDisabledSourceValue | null;
      }
    | null
    | undefined,
  previous?: ArtifactFileShareRecord,
): ArtifactFileShareRecord | null {
  const shareId = value?.shareId || previous?.shareId;
  const url = value?.url || previous?.url;
  if (!shareId || !url) return null;

  const accessMode = normalizeAccessMode(value?.accessMode ?? previous?.accessMode);
  const status = value?.status ?? previous?.status ?? HtmlShareStatus.Live;
  const shareCode =
    accessMode === HtmlShareAccessMode.Code ? (value?.shareCode ?? previous?.shareCode) : undefined;
  const shareCodeUnavailable =
    accessMode === HtmlShareAccessMode.Code
      ? (value?.shareCodeUnavailable ?? (shareCode ? false : previous?.shareCodeUnavailable))
      : undefined;

  return {
    shareId,
    url,
    accessMode,
    shareCode,
    shareCodeUnavailable,
    status,
    disabledSource:
      status === HtmlShareStatus.Disabled
        ? (value?.disabledSource ?? previous?.disabledSource)
        : undefined,
  };
}

function requireShareRecord(
  result: HtmlShareResult,
  previous?: ArtifactFileShareRecord,
): ArtifactFileShareRecord {
  if (!result?.success) {
    throw new ArtifactFileShareRequestError(getFailureMessage(result), result?.code);
  }
  const share = getShareRecord(result, previous);
  if (!share) {
    throw new ArtifactFileShareRequestError(getFailureMessage(result), result?.code);
  }
  return share;
}

async function createShare(
  api: HtmlShareApi,
  request: ArtifactFileShareRequest,
  accessMode: HtmlShareAccessModeValue,
): Promise<HtmlShareResult> {
  if (request.source === ArtifactFileShareRequestSource.HtmlFile) {
    return api.createFromHtmlFile({
      sessionId: request.sessionId,
      artifactId: request.artifactId,
      filePath: request.filePath || '',
      title: request.title,
      accessMode,
    });
  }
  return api.createFromArtifactFile({
    sourceType: request.sourceType,
    sessionId: request.sessionId,
    artifactId: request.artifactId,
    title: request.title,
    accessMode,
    fileName: request.fileName,
    filePath: request.filePath,
    content: request.content,
    remoteUrl: request.remoteUrl,
  });
}

async function updateShareFile(
  api: HtmlShareApi,
  request: ArtifactFileShareRequest,
  share: ArtifactFileShareRecord,
  accessMode = share.accessMode,
): Promise<HtmlShareResult> {
  if (request.source === ArtifactFileShareRequestSource.HtmlFile) {
    return api.updateFromHtmlFile({
      shareId: share.shareId,
      sessionId: request.sessionId,
      artifactId: request.artifactId,
      filePath: request.filePath || '',
      title: request.title,
      currentStatus: share.status,
      accessMode,
    });
  }
  return api.updateFromArtifactFile({
    sourceType: request.sourceType,
    shareId: share.shareId,
    sessionId: request.sessionId,
    artifactId: request.artifactId,
    title: request.title,
    accessMode,
    fileName: request.fileName,
    filePath: request.filePath,
    content: request.content,
    remoteUrl: request.remoteUrl,
    currentStatus: share.status,
  });
}

function logShare(level: 'debug' | 'warn', message: string): void {
  window.electron?.log?.fromRenderer?.(level, 'ArtifactFileShare', message);
}

export function ArtifactFileShareProvider({ sessionId, children }: ArtifactFileShareProviderProps) {
  const authState = useSelector((state: RootState) => state.auth);
  const [dialog, setDialog] = useState<ArtifactFileShareDialogState | null>(null);
  const [subscriptionPrompt, setSubscriptionPrompt] =
    useState<ArtifactSubscriptionPromptState | null>(null);
  const [copyStatus, setCopyStatus] = useState<ArtifactFileShareCopyStatus>(
    ArtifactFileShareCopyStatus.Idle,
  );
  const [updateStatus, setUpdateStatus] = useState<ArtifactFileShareUpdateStatus>(
    ArtifactFileShareUpdateStatus.Idle,
  );
  const generationRef = useRef(0);
  const mutationBarriersRef = useRef(new Map<string, Promise<void>>());
  const preparationPromisesRef = useRef(new Map<string, Promise<PreparedArtifactFileShare>>());
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current !== undefined) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = undefined;
    }
  }, []);

  const resetFeedback = useCallback(() => {
    clearFeedbackTimer();
    setCopyStatus(ArtifactFileShareCopyStatus.Idle);
    setUpdateStatus(ArtifactFileShareUpdateStatus.Idle);
  }, [clearFeedbackTimer]);

  useEffect(() => {
    generationRef.current += 1;
    setDialog(null);
    setSubscriptionPrompt(null);
    resetFeedback();
  }, [resetFeedback, sessionId]);

  useEffect(() => () => clearFeedbackTimer(), [clearFeedbackTimer]);

  const closeDialog = useCallback(() => {
    generationRef.current += 1;
    setDialog(null);
    resetFeedback();
  }, [resetFeedback]);

  const closeSubscriptionPrompt = useCallback(() => {
    generationRef.current += 1;
    setSubscriptionPrompt(null);
  }, []);

  const isDialogOpen = Boolean(dialog);
  const isDialogBusy = Boolean(dialog?.operation);
  const dialogFocusKey = dialog ? `${dialog.artifact.id}:${dialog.phase}` : '';

  useEffect(() => {
    if (!isDialogOpen) return undefined;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [isDialogOpen]);

  useEffect(() => {
    if (!dialogFocusKey) return undefined;
    const frameId = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isDialogBusy) return;
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialogElement = closeButtonRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (!dialogElement) return;
      const focusableElements = Array.from(
        dialogElement.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (!dialogElement.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDialog, dialogFocusKey, isDialogBusy]);

  const showTimedCopyStatus = useCallback(
    (status: ArtifactFileShareCopyStatus) => {
      clearFeedbackTimer();
      setCopyStatus(status);
      feedbackTimerRef.current = window.setTimeout(() => {
        setCopyStatus(ArtifactFileShareCopyStatus.Idle);
        feedbackTimerRef.current = undefined;
      }, 2200);
    },
    [clearFeedbackTimer],
  );

  const showTimedUpdateSuccess = useCallback(() => {
    clearFeedbackTimer();
    setUpdateStatus(ArtifactFileShareUpdateStatus.Updated);
    feedbackTimerRef.current = window.setTimeout(() => {
      setUpdateStatus(ArtifactFileShareUpdateStatus.Idle);
      feedbackTimerRef.current = undefined;
    }, 2200);
  }, [clearFeedbackTimer]);

  const getSubscriptionDecision = useCallback(async () => {
    return resolveArtifactSubscriptionDecision({
      isLoggedIn: authState.isLoggedIn,
      subscriptionStatus: authState.quota?.subscriptionStatus,
    }, async () => {
      const refreshed = await authService.refreshAuthState();
      return {
        isLoggedIn: refreshed.isLoggedIn,
        subscriptionStatus: refreshed.quota?.subscriptionStatus,
      };
    });
  }, [authState.isLoggedIn, authState.quota]);

  const lookupShare = useCallback(async (api: HtmlShareApi, request: ArtifactFileShareRequest) => {
    return request.source === ArtifactFileShareRequestSource.HtmlFile
      ? api.getByHtmlFile({ filePath: request.filePath || '' })
      : api.getByArtifactFile({
          sourceType: request.sourceType,
          sessionId: request.sessionId,
          artifactId: request.artifactId,
          filePath: request.filePath,
        });
  }, []);

  const refreshShare = useCallback(
    async (
      api: HtmlShareApi,
      request: ArtifactFileShareRequest,
      fallback: ArtifactFileShareRecord,
    ): Promise<ArtifactFileShareRecord> => {
      try {
        const lookup = await lookupShare(api, request);
        if (lookup?.success) return getShareRecord(lookup.share, fallback) ?? fallback;
      } catch {
        // Keep the last confirmed response when the follow-up lookup is unavailable.
      }
      return fallback;
    },
    [lookupShare],
  );

  const loadShare = useCallback(
    (api: HtmlShareApi, request: ArtifactFileShareRequest): Promise<PreparedArtifactFileShare> => {
      const key = request.lookupKey;
      const pending = preparationPromisesRef.current.get(key);
      if (pending) return pending;

      const preparation = (async (): Promise<PreparedArtifactFileShare> => {
        const lookup = await lookupShare(api, request);
        if (!lookup?.success) {
          throw new ArtifactFileShareRequestError(getFailureMessage(lookup), lookup?.code);
        }

        const existingShare = getShareRecord(lookup.share);
        if (existingShare) {
          return { share: existingShare };
        }
        return {};
      })().finally(() => {
        if (preparationPromisesRef.current.get(key) === preparation) {
          preparationPromisesRef.current.delete(key);
        }
      });

      preparationPromisesRef.current.set(key, preparation);
      return preparation;
    },
    [lookupShare],
  );

  const initializeShare = useCallback(
    async (artifact: Artifact, request: ArtifactFileShareRequest): Promise<void> => {
      const api = window.electron?.htmlShare;
      const runId = generationRef.current + 1;
      generationRef.current = runId;
      resetFeedback();
      setDialog(null);
      setSubscriptionPrompt(null);

      try {
        const subscriptionDecision = await getSubscriptionDecision();
        if (generationRef.current !== runId) return;
        if (!subscriptionDecision.allowed) {
          setSubscriptionPrompt({
            feature: ArtifactSubscriptionFeature.Share,
            reason: subscriptionDecision.reason,
          });
          return;
        }
        setDialog({
          artifact,
          request,
          phase: ArtifactFileSharePhase.Preparing,
          selectedPermission: ArtifactFileSharePermission.Code,
          message: t('artifactFileShareChecking'),
        });
        if (!api) throw new Error(t('htmlShareUnavailableInProduction'));

        const mutationBarrier = mutationBarriersRef.current.get(request.lookupKey);
        if (mutationBarrier) await mutationBarrier;
        if (generationRef.current !== runId) return;

        const prepared = await loadShare(api, request);
        if (generationRef.current !== runId) return;
        const intent = prepared.share
          ? ArtifactFileShareIntent.Manage
          : ArtifactFileShareIntent.Create;
        const selectedPermission = prepared.share
          ? deriveArtifactFileSharePermission(prepared.share)
          : ArtifactFileSharePermission.Code;
        setDialog({
          artifact,
          request,
          phase: ArtifactFileSharePhase.Ready,
          intent,
          share: prepared.share,
          selectedPermission,
        });
      } catch (error) {
        if (generationRef.current !== runId) return;
        if (isSubscriptionRequiredError(error)) {
          setDialog(null);
          setSubscriptionPrompt({
            feature: ArtifactSubscriptionFeature.Share,
            reason: ArtifactSubscriptionBlockReason.SubscriptionRequired,
          });
          return;
        }
        const message = error instanceof Error ? error.message : t('htmlShareFailed');
        logShare('warn', `Failed to prepare share for artifact ${request.artifactId}: ${message}`);
        setDialog({
          artifact,
          request,
          phase: ArtifactFileSharePhase.Error,
          selectedPermission: ArtifactFileSharePermission.Code,
          error: message,
        });
      }
    },
    [getSubscriptionDecision, loadShare, resetFeedback],
  );

  const openShare = useCallback(
    async (artifact: Artifact): Promise<void> => {
      const sourceType = getArtifactFileShareSourceType(artifact);
      reportArtifactPreviewAction({
        actionType: 'share_html_click',
        source: 'conversation_artifact_card',
        artifact,
        params: { shareSourceType: sourceType ?? undefined },
      });

      const request = isArtifactFileShareable(artifact)
        ? buildArtifactFileShareRequest(artifact, sessionId, t('htmlShare'))
        : null;
      if (!request) {
        generationRef.current += 1;
        setDialog({
          artifact,
          phase: ArtifactFileSharePhase.Error,
          error: t('artifactShareSourceUnavailable'),
        });
        return;
      }
      await initializeShare(artifact, request);
    },
    [initializeShare, sessionId],
  );

  const retryShare = useCallback(() => {
    if (!dialog?.request) return;
    void initializeShare(dialog.artifact, dialog.request);
  }, [dialog, initializeShare]);

  const selectPermission = useCallback(
    (targetPermission: ArtifactFileSharePermissionValue): void => {
      const snapshot = dialog;
      if (
        !snapshot?.request ||
        snapshot.phase !== ArtifactFileSharePhase.Ready ||
        !snapshot.intent ||
        snapshot.operation ||
        (snapshot.intent === ArtifactFileShareIntent.Create &&
          targetPermission === ArtifactFileSharePermission.Stopped) ||
        mutationBarriersRef.current.has(snapshot.request.lookupKey)
      ) {
        return;
      }
      resetFeedback();
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? {
              ...previous,
              selectedPermission: targetPermission,
              error: undefined,
              message: undefined,
            }
          : previous,
      );
    },
    [dialog, resetFeedback],
  );

  const submitCreateShare = useCallback(async (): Promise<void> => {
    const snapshot = dialog;
    const targetPermission = snapshot?.selectedPermission;
    if (
      !snapshot?.request ||
      snapshot.phase !== ArtifactFileSharePhase.Ready ||
      snapshot.intent !== ArtifactFileShareIntent.Create ||
      snapshot.share ||
      !targetPermission ||
      targetPermission === ArtifactFileSharePermission.Stopped ||
      snapshot.operation ||
      mutationBarriersRef.current.has(snapshot.request.lookupKey)
    ) {
      return;
    }
    const api = window.electron?.htmlShare;
    const accessMode = getArtifactFileShareCreateAccessMode(targetPermission);
    if (!api || !accessMode) return;
    const runId = generationRef.current + 1;
    generationRef.current = runId;
    let releaseMutationBarrier: (() => void) | undefined;
    const mutationBarrier = new Promise<void>(resolve => {
      releaseMutationBarrier = resolve;
    });
    const mutationKey = snapshot.request.lookupKey;
    mutationBarriersRef.current.set(mutationKey, mutationBarrier);
    resetFeedback();
    setDialog(previous =>
      previous && previous.artifact.id === snapshot.artifact.id
        ? {
            ...previous,
            operation: ArtifactFileShareOperation.Creating,
            error: undefined,
            message: undefined,
          }
        : previous,
    );

    try {
      const result = await createShare(api, snapshot.request, accessMode);
      let share = requireShareRecord(result);
      if (generationRef.current !== runId) return;
      share = await refreshShare(api, snapshot.request, share);
      if (generationRef.current !== runId) return;
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? {
              ...previous,
              intent: ArtifactFileShareIntent.Manage,
              share,
              selectedPermission: deriveArtifactFileSharePermission(share),
              operation: undefined,
              message: result.warnings?.length
                ? result.warnings.slice(0, 3).join('\n')
                : t('htmlShareSuccessMessage'),
              error: undefined,
            }
          : previous,
      );
      logShare(
        'debug',
        `Created ${snapshot.request.sourceType} share for artifact ${snapshot.request.artifactId}.`,
      );
    } catch (error) {
      if (generationRef.current !== runId) return;
      if (isSubscriptionRequiredError(error)) {
        setDialog(null);
        setSubscriptionPrompt({
          feature: ArtifactSubscriptionFeature.Share,
          reason: ArtifactSubscriptionBlockReason.SubscriptionRequired,
        });
        return;
      }
      const message = error instanceof Error ? error.message : t('htmlShareFailed');
      logShare(
        'warn',
        `Failed to create share for artifact ${snapshot.request.artifactId}: ${message}`,
      );
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? { ...previous, operation: undefined, error: message }
          : previous,
      );
    } finally {
      if (mutationBarriersRef.current.get(mutationKey) === mutationBarrier) {
        mutationBarriersRef.current.delete(mutationKey);
      }
      releaseMutationBarrier?.();
    }
  }, [dialog, refreshShare, resetFeedback]);

  const submitPermissionChange = useCallback(async (): Promise<void> => {
    const snapshot = dialog;
    const targetPermission = snapshot?.selectedPermission;
    if (
      !snapshot?.request ||
      snapshot.phase !== ArtifactFileSharePhase.Ready ||
      snapshot.intent !== ArtifactFileShareIntent.Manage ||
      !snapshot.share ||
      !targetPermission ||
      snapshot.operation ||
      mutationBarriersRef.current.has(snapshot.request.lookupKey)
    ) {
      return;
    }
    const permissionPlan = buildArtifactFileSharePermissionPlan(snapshot.share, targetPermission);
    if (
      permissionPlan.length === 0 ||
      permissionPlan.some(step => step.action === ArtifactFileSharePermissionChangeAction.Blocked)
    ) {
      return;
    }

    const api = window.electron?.htmlShare;
    if (!api) return;
    const runId = generationRef.current + 1;
    generationRef.current = runId;
    let releaseMutationBarrier: (() => void) | undefined;
    const mutationBarrier = new Promise<void>(resolve => {
      releaseMutationBarrier = resolve;
    });
    const mutationKey = snapshot.request.lookupKey;
    mutationBarriersRef.current.set(mutationKey, mutationBarrier);
    const originalShare = snapshot.share;
    setDialog(previous =>
      previous && previous.artifact.id === snapshot.artifact.id
        ? {
            ...previous,
            operation: ArtifactFileShareOperation.Permission,
            error: undefined,
            message: undefined,
          }
        : previous,
    );

    let lastConfirmedShare = originalShare;
    try {
      let nextShare = originalShare;
      for (const step of permissionPlan) {
        if (step.action === ArtifactFileSharePermissionChangeAction.UpdateAccess) {
          nextShare = requireShareRecord(
            await api.updateAccessMode({
              shareId: nextShare.shareId,
              accessMode: step.accessMode,
            }),
            nextShare,
          );
        } else if (step.action === ArtifactFileSharePermissionChangeAction.UpdateStatus) {
          nextShare = requireShareRecord(
            await api.updateStatus({
              shareId: nextShare.shareId,
              status: step.status,
            }),
            nextShare,
          );
        } else if (step.action === ArtifactFileSharePermissionChangeAction.RestoreActiveLimit) {
          nextShare = requireShareRecord(
            await updateShareFile(api, snapshot.request, nextShare, nextShare.accessMode),
            nextShare,
          );
        }
        lastConfirmedShare = nextShare;
        if (generationRef.current !== runId) return;
      }

      nextShare = await refreshShare(api, snapshot.request, nextShare);
      if (generationRef.current !== runId) return;
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? {
              ...previous,
              share: nextShare,
              selectedPermission: deriveArtifactFileSharePermission(nextShare),
              operation: undefined,
              message: t('artifactFileSharePermissionUpdated'),
              error: undefined,
            }
          : previous,
      );
    } catch (error) {
      if (generationRef.current !== runId) return;
      if (isSubscriptionRequiredError(error)) {
        setDialog(null);
        setSubscriptionPrompt({
          feature: ArtifactSubscriptionFeature.Share,
          reason: ArtifactSubscriptionBlockReason.SubscriptionRequired,
        });
        return;
      }
      const refreshedShare = await refreshShare(api, snapshot.request, lastConfirmedShare);
      if (generationRef.current !== runId) return;
      const retryPlan = buildArtifactFileSharePermissionPlan(refreshedShare, targetPermission);
      const canRetry = !retryPlan.some(
        step => step.action === ArtifactFileSharePermissionChangeAction.Blocked,
      );
      const message =
        error instanceof Error ? error.message : t('htmlShareAccessModeUpdateFailed');
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? {
              ...previous,
              share: refreshedShare,
              selectedPermission: canRetry
                ? targetPermission
                : deriveArtifactFileSharePermission(refreshedShare),
              operation: undefined,
              error: message,
            }
          : previous,
      );
    } finally {
      if (mutationBarriersRef.current.get(mutationKey) === mutationBarrier) {
        mutationBarriersRef.current.delete(mutationKey);
      }
      releaseMutationBarrier?.();
    }
  }, [dialog, refreshShare]);

  const updateFile = useCallback(async (): Promise<void> => {
    const snapshot = dialog;
    if (
      !snapshot?.request ||
      snapshot.phase !== ArtifactFileSharePhase.Ready ||
      snapshot.intent !== ArtifactFileShareIntent.Manage ||
      !snapshot.share ||
      snapshot.operation ||
      snapshot.share.status === HtmlShareStatus.Disabled ||
      snapshot.share.status === HtmlShareStatus.Failed ||
      snapshot.selectedPermission !== deriveArtifactFileSharePermission(snapshot.share) ||
      mutationBarriersRef.current.has(snapshot.request.lookupKey)
    ) {
      return;
    }
    const api = window.electron?.htmlShare;
    if (!api) return;
    const runId = generationRef.current + 1;
    generationRef.current = runId;
    let releaseMutationBarrier: (() => void) | undefined;
    const mutationBarrier = new Promise<void>(resolve => {
      releaseMutationBarrier = resolve;
    });
    const mutationKey = snapshot.request.lookupKey;
    mutationBarriersRef.current.set(mutationKey, mutationBarrier);
    resetFeedback();
    setDialog(previous =>
      previous
        ? {
            ...previous,
            operation: ArtifactFileShareOperation.UpdateFile,
            error: undefined,
            message: undefined,
          }
        : previous,
    );

    try {
      let share = requireShareRecord(
        await updateShareFile(api, snapshot.request, snapshot.share),
        snapshot.share,
      );
      if (generationRef.current !== runId) return;
      share = await refreshShare(api, snapshot.request, share);
      if (generationRef.current !== runId) return;
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? {
              ...previous,
              share,
              selectedPermission: deriveArtifactFileSharePermission(share),
              operation: undefined,
              message: undefined,
            }
          : previous,
      );
      showTimedUpdateSuccess();
    } catch (error) {
      if (generationRef.current !== runId) return;
      if (isSubscriptionRequiredError(error)) {
        setDialog(null);
        setSubscriptionPrompt({
          feature: ArtifactSubscriptionFeature.Share,
          reason: ArtifactSubscriptionBlockReason.SubscriptionRequired,
        });
        return;
      }
      const message = error instanceof Error ? error.message : t('htmlShareFailed');
      setDialog(previous =>
        previous && previous.artifact.id === snapshot.artifact.id
          ? { ...previous, operation: undefined, error: message }
          : previous,
      );
    } finally {
      if (mutationBarriersRef.current.get(mutationKey) === mutationBarrier) {
        mutationBarriersRef.current.delete(mutationKey);
      }
      releaseMutationBarrier?.();
    }
  }, [dialog, refreshShare, resetFeedback, showTimedUpdateSuccess]);

  const copyShare = useCallback(async (): Promise<void> => {
    const share = dialog?.share;
    if (
      !share ||
      dialog?.intent !== ArtifactFileShareIntent.Manage ||
      dialog.selectedPermission !== deriveArtifactFileSharePermission(share) ||
      dialog.operation
    ) {
      return;
    }
    const copyResult = buildArtifactFileShareCopyText({
      accessMode: share.accessMode,
      status:
        share.status === HtmlShareStatus.Disabled ? HtmlShareStatus.Disabled : HtmlShareStatus.Live,
      url: share.url,
      shareCode: share.shareCode,
      labels: {
        link: t('htmlShareClipboardLinkLabel'),
        shareCode: t('htmlShareCode'),
      },
    });
    if (!copyResult.copyable) {
      showTimedCopyStatus(ArtifactFileShareCopyStatus.Failed);
      return;
    }
    const runId = generationRef.current;
    const copied = await copyTextToClipboard(copyResult.text);
    if (generationRef.current !== runId) return;
    showTimedCopyStatus(
      copied ? ArtifactFileShareCopyStatus.Copied : ArtifactFileShareCopyStatus.Failed,
    );
  }, [dialog, showTimedCopyStatus]);

  const openSubscriptionPage = useCallback(() => {
    void window.electron?.shell?.openExternal(getPortalPricingUrl(PortalPricingKeyfrom.HtmlShare));
    closeSubscriptionPrompt();
  }, [closeSubscriptionPrompt]);

  const contextValue = useMemo<ArtifactFileShareControllerValue>(
    () => ({ openShare }),
    [openShare],
  );

  const share = dialog?.share;
  const committedPermission = share
    ? deriveArtifactFileSharePermission(share)
    : undefined;
  const selectedPermission = dialog?.selectedPermission ??
    committedPermission ??
    ArtifactFileSharePermission.Code;
  const isPermissionDirty = isArtifactFileSharePermissionDirty(
    dialog?.intent,
    committedPermission,
    selectedPermission,
  );
  const stoppedNotice =
    share?.status !== HtmlShareStatus.Disabled
      ? undefined
      : share.disabledSource === HtmlShareDisabledSource.ActiveLimit
        ? t('htmlShareStoppedByActiveLimitNotice')
        : share.disabledSource === HtmlShareDisabledSource.Admin
          ? t('htmlShareStoppedByAdminNotice')
          : share.disabledSource === HtmlShareDisabledSource.Moderation
            ? t('htmlShareStoppedByModerationNotice')
            : t('htmlShareStoppedNotice');
  const isPermissionLocked = Boolean(
    share?.status === HtmlShareStatus.Failed ||
    (share?.status === HtmlShareStatus.Disabled &&
      isArtifactFileShareResumeLocked(share.disabledSource)),
  );
  const dialogMessage =
    dialog?.message ??
    (share?.status === HtmlShareStatus.Failed ? t('htmlShareResultStatusFailed') : undefined);
  const copyResult = share
    ? buildArtifactFileShareCopyText({
        accessMode: share.accessMode,
        status:
          share.status === HtmlShareStatus.Disabled
            ? HtmlShareStatus.Disabled
            : HtmlShareStatus.Live,
        url: share.url,
        shareCode: share.shareCode,
        labels: {
          link: t('htmlShareClipboardLinkLabel'),
          shareCode: t('htmlShareCode'),
        },
      })
    : null;
  const permissionPlan = share && isPermissionDirty
    ? buildArtifactFileSharePermissionPlan(share, selectedPermission)
    : [];
  const canCreate = Boolean(
    dialog?.phase === ArtifactFileSharePhase.Ready &&
    dialog.intent === ArtifactFileShareIntent.Create &&
    !dialog.operation &&
    selectedPermission !== ArtifactFileSharePermission.Stopped,
  );
  const canSubmitPermission = Boolean(
    dialog?.phase === ArtifactFileSharePhase.Ready &&
    dialog.intent === ArtifactFileShareIntent.Manage &&
    isPermissionDirty &&
    !isPermissionLocked &&
    !dialog.operation &&
    permissionPlan.length > 0 &&
    !permissionPlan.some(
      step => step.action === ArtifactFileSharePermissionChangeAction.Blocked,
    ),
  );
  const canCopy = Boolean(
    dialog?.phase === ArtifactFileSharePhase.Ready &&
    dialog.intent === ArtifactFileShareIntent.Manage &&
    !dialog.operation &&
    !isPermissionDirty &&
    copyResult?.copyable,
  );
  const canUpdateFile = Boolean(
    dialog?.phase === ArtifactFileSharePhase.Ready &&
    dialog.intent === ArtifactFileShareIntent.Manage &&
    !dialog.operation &&
    !isPermissionDirty &&
    share &&
    share.status !== HtmlShareStatus.Disabled &&
    share.status !== HtmlShareStatus.Failed,
  );

  const dialogPortal =
    dialog && typeof document !== 'undefined'
      ? createPortal(
          <ArtifactFileShareDialog
            artifact={dialog.artifact}
            phase={dialog.phase}
            operation={dialog.operation}
            intent={dialog.intent}
            committedPermission={committedPermission}
            selectedPermission={selectedPermission}
            isPermissionDirty={isPermissionDirty}
            stoppedNotice={stoppedNotice}
            isPermissionLocked={isPermissionLocked}
            message={dialogMessage}
            error={dialog.error}
            shareCodeUnavailable={Boolean(
              share?.accessMode === HtmlShareAccessMode.Code &&
              !isPermissionDirty &&
              (share.shareCodeUnavailable || !share.shareCode),
            )}
            canRetry={Boolean(dialog.request)}
            canCreate={canCreate}
            canSubmitPermission={canSubmitPermission}
            canCopy={canCopy}
            canUpdateFile={canUpdateFile}
            copyStatus={copyStatus}
            updateStatus={updateStatus}
            closeButtonRef={closeButtonRef}
            onClose={closeDialog}
            onRetry={retryShare}
            onPermissionChange={selectPermission}
            onCreate={() => void submitCreateShare()}
            onSubmitPermission={() => void submitPermissionChange()}
            onUpdateFile={() => void updateFile()}
            onCopy={() => void copyShare()}
          />,
          document.body,
        )
      : null;

  const subscriptionPromptPortal = subscriptionPrompt ? (
    <ArtifactSubscriptionPromptDialog
      feature={subscriptionPrompt.feature}
      reason={subscriptionPrompt.reason}
      onCancel={closeSubscriptionPrompt}
      onSubscribe={openSubscriptionPage}
    />
  ) : null;

  return (
    <ArtifactFileShareContext.Provider value={contextValue}>
      {children}
      {dialogPortal}
      {subscriptionPromptPortal}
    </ArtifactFileShareContext.Provider>
  );
}

export function useOptionalArtifactFileShare(): ArtifactFileShareControllerValue | null {
  return useContext(ArtifactFileShareContext);
}
