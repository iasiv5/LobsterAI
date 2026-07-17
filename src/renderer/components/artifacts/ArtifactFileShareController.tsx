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
  operation?: ArtifactFileShareOperation;
  share?: ArtifactFileShareRecord;
  pendingPermission?: ArtifactFileSharePermissionValue;
  message?: string;
  error?: string;
  showSubscriptionAction?: boolean;
}

interface PreparedArtifactFileShare {
  share: ArtifactFileShareRecord;
  warnings?: string[];
  created: boolean;
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
  if (!result?.success) throw new Error(getFailureMessage(result));
  const share = getShareRecord(result, previous);
  if (!share) throw new Error(getFailureMessage(result));
  return share;
}

async function createShare(
  api: HtmlShareApi,
  request: ArtifactFileShareRequest,
): Promise<HtmlShareResult> {
  if (request.source === ArtifactFileShareRequestSource.HtmlFile) {
    return api.createFromHtmlFile({
      sessionId: request.sessionId,
      artifactId: request.artifactId,
      filePath: request.filePath || '',
      title: request.title,
      accessMode: HtmlShareAccessMode.Code,
    });
  }
  return api.createFromArtifactFile({
    sourceType: request.sourceType,
    sessionId: request.sessionId,
    artifactId: request.artifactId,
    title: request.title,
    accessMode: HtmlShareAccessMode.Code,
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
    resetFeedback();
  }, [resetFeedback, sessionId]);

  useEffect(() => () => clearFeedbackTimer(), [clearFeedbackTimer]);

  const closeDialog = useCallback(() => {
    generationRef.current += 1;
    setDialog(null);
    resetFeedback();
  }, [resetFeedback]);

  const isDialogOpen = Boolean(dialog);
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
  }, [closeDialog, dialogFocusKey]);

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

  const getEntitlementMessage = useCallback(async (): Promise<{
    allowed: boolean;
    message?: string;
  }> => {
    let isLoggedIn = authState.isLoggedIn;
    let quota = authState.quota;
    if (!isLoggedIn || quota?.subscriptionStatus !== 'active') {
      const refreshed = await authService.refreshAuthState();
      isLoggedIn = refreshed.isLoggedIn;
      quota = refreshed.quota;
    }
    if (!isLoggedIn) {
      return { allowed: false, message: t('htmlShareLoginRequiredMessage') };
    }
    if (quota?.subscriptionStatus !== 'active') {
      return { allowed: false, message: t('htmlShareSubscriptionRequiredMessage') };
    }
    return { allowed: true };
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

  const prepareShare = useCallback(
    (api: HtmlShareApi, request: ArtifactFileShareRequest): Promise<PreparedArtifactFileShare> => {
      const key = request.lookupKey;
      const pending = preparationPromisesRef.current.get(key);
      if (pending) return pending;

      const preparation = (async (): Promise<PreparedArtifactFileShare> => {
        const lookup = await lookupShare(api, request);
        if (!lookup?.success) throw new Error(getFailureMessage(lookup));

        const existingShare = getShareRecord(lookup.share);
        if (existingShare) {
          return { share: existingShare, created: false };
        }

        const result = await createShare(api, {
          ...request,
          accessMode: HtmlShareAccessMode.Code,
        });
        return {
          share: requireShareRecord(result),
          warnings: result.warnings,
          created: true,
        };
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
      setDialog({
        artifact,
        request,
        phase: ArtifactFileSharePhase.Preparing,
        pendingPermission: ArtifactFileSharePermission.Code,
        message: t('artifactFileSharePreparing'),
      });

      try {
        const entitlement = await getEntitlementMessage();
        if (generationRef.current !== runId) return;
        if (!entitlement.allowed) {
          setDialog(previous =>
            previous && previous.artifact.id === artifact.id
              ? {
                  ...previous,
                  phase: ArtifactFileSharePhase.Entitlement,
                  pendingPermission: undefined,
                  message: entitlement.message,
                  showSubscriptionAction: true,
                }
              : previous,
          );
          return;
        }
        if (!api) throw new Error(t('htmlShareUnavailableInProduction'));

        const mutationBarrier = mutationBarriersRef.current.get(request.lookupKey);
        if (mutationBarrier) await mutationBarrier;
        if (generationRef.current !== runId) return;

        const prepared = await prepareShare(api, request);
        if (generationRef.current !== runId) return;
        setDialog({
          artifact,
          request: prepared.created
            ? { ...request, accessMode: HtmlShareAccessMode.Code }
            : request,
          phase: ArtifactFileSharePhase.Ready,
          share: prepared.share,
          message: prepared.warnings?.length ? prepared.warnings.slice(0, 3).join('\n') : undefined,
        });
        if (prepared.created) {
          logShare(
            'debug',
            `Created ${request.sourceType} share for artifact ${request.artifactId}.`,
          );
        }
      } catch (error) {
        if (generationRef.current !== runId) return;
        const message = error instanceof Error ? error.message : t('htmlShareFailed');
        logShare('warn', `Failed to prepare share for artifact ${request.artifactId}: ${message}`);
        setDialog(previous =>
          previous && previous.artifact.id === artifact.id
            ? {
                ...previous,
                phase: ArtifactFileSharePhase.Error,
                operation: undefined,
                pendingPermission: undefined,
                message: undefined,
                error: message,
              }
            : previous,
        );
      }
    },
    [getEntitlementMessage, prepareShare, resetFeedback],
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

  const changePermission = useCallback(
    async (targetPermission: ArtifactFileSharePermissionValue): Promise<void> => {
      const snapshot = dialog;
      if (
        !snapshot?.request ||
        snapshot.phase !== ArtifactFileSharePhase.Ready ||
        !snapshot.share ||
        mutationBarriersRef.current.has(snapshot.request.lookupKey)
      ) {
        return;
      }
      const permissionPlan = buildArtifactFileSharePermissionPlan(snapshot.share, targetPermission);
      if (
        permissionPlan.length === 0 ||
        permissionPlan.some(step => step.action === ArtifactFileSharePermissionChangeAction.Blocked)
      )
        return;

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
        previous
          ? {
              ...previous,
              operation: ArtifactFileShareOperation.Permission,
              pendingPermission: targetPermission,
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
                operation: undefined,
                pendingPermission: undefined,
                error: undefined,
              }
            : previous,
        );
      } catch (error) {
        if (generationRef.current !== runId) return;
        const refreshedShare = await refreshShare(api, snapshot.request, lastConfirmedShare);
        if (generationRef.current !== runId) return;
        const message =
          error instanceof Error ? error.message : t('htmlShareAccessModeUpdateFailed');
        setDialog(previous =>
          previous && previous.artifact.id === snapshot.artifact.id
            ? {
                ...previous,
                share: refreshedShare,
                operation: undefined,
                pendingPermission: undefined,
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
    },
    [dialog, refreshShare],
  );

  const updateFile = useCallback(async (): Promise<void> => {
    const snapshot = dialog;
    if (
      !snapshot?.request ||
      snapshot.phase !== ArtifactFileSharePhase.Ready ||
      !snapshot.share ||
      snapshot.share.status === HtmlShareStatus.Disabled ||
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
              operation: undefined,
              message: undefined,
            }
          : previous,
      );
      showTimedUpdateSuccess();
    } catch (error) {
      if (generationRef.current !== runId) return;
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
    if (!share) return;
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
  }, [dialog?.share, showTimedCopyStatus]);

  const openSubscriptionPage = useCallback(() => {
    void window.electron?.shell?.openExternal(getPortalPricingUrl(PortalPricingKeyfrom.HtmlShare));
  }, []);

  const contextValue = useMemo<ArtifactFileShareControllerValue>(
    () => ({ openShare }),
    [openShare],
  );

  const share = dialog?.share;
  const permission = share
    ? deriveArtifactFileSharePermission(share)
    : ArtifactFileSharePermission.Code;
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
  const canCopy = Boolean(dialog?.phase === ArtifactFileSharePhase.Ready && copyResult?.copyable);
  const canUpdateFile = Boolean(
    dialog?.phase === ArtifactFileSharePhase.Ready &&
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
            permission={permission}
            pendingPermission={dialog.pendingPermission}
            stoppedNotice={stoppedNotice}
            isPermissionLocked={isPermissionLocked}
            message={dialogMessage}
            error={dialog.error}
            shareCodeUnavailable={Boolean(
              share?.accessMode === HtmlShareAccessMode.Code &&
              (share.shareCodeUnavailable || !share.shareCode),
            )}
            canRetry={Boolean(dialog.request)}
            canCopy={canCopy}
            canUpdateFile={canUpdateFile}
            copyStatus={copyStatus}
            updateStatus={updateStatus}
            showSubscriptionAction={dialog.showSubscriptionAction}
            closeButtonRef={closeButtonRef}
            onClose={closeDialog}
            onRetry={retryShare}
            onOpenSubscription={openSubscriptionPage}
            onPermissionChange={permissionValue => void changePermission(permissionValue)}
            onUpdateFile={() => void updateFile()}
            onCopy={() => void copyShare()}
          />,
          document.body,
        )
      : null;

  return (
    <ArtifactFileShareContext.Provider value={contextValue}>
      {children}
      {dialogPortal}
    </ArtifactFileShareContext.Provider>
  );
}

export function useOptionalArtifactFileShare(): ArtifactFileShareControllerValue | null {
  return useContext(ArtifactFileShareContext);
}
