import type { RefObject } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

import {
  ArtifactFileSharePermission,
  type ArtifactFileSharePermission as ArtifactFileSharePermissionValue,
} from './artifactFileSharePermission';
import ArtifactPreviewIdentity from './ArtifactPreviewIdentity';

const t = (key: string) => i18nService.t(key);

export const ArtifactFileSharePhase = {
  Preparing: 'preparing',
  Ready: 'ready',
  Entitlement: 'entitlement',
  Error: 'error',
} as const;

export type ArtifactFileSharePhase =
  (typeof ArtifactFileSharePhase)[keyof typeof ArtifactFileSharePhase];

export const ArtifactFileShareOperation = {
  Creating: 'creating',
  Permission: 'permission',
  UpdateFile: 'update_file',
} as const;

export type ArtifactFileShareOperation =
  (typeof ArtifactFileShareOperation)[keyof typeof ArtifactFileShareOperation];

export const ArtifactFileShareCopyStatus = {
  Idle: 'idle',
  Copied: 'copied',
  Failed: 'failed',
} as const;

export type ArtifactFileShareCopyStatus =
  (typeof ArtifactFileShareCopyStatus)[keyof typeof ArtifactFileShareCopyStatus];

export const ArtifactFileShareUpdateStatus = {
  Idle: 'idle',
  Updated: 'updated',
} as const;

export type ArtifactFileShareUpdateStatus =
  (typeof ArtifactFileShareUpdateStatus)[keyof typeof ArtifactFileShareUpdateStatus];

interface ArtifactFileShareDialogProps {
  artifact: Artifact;
  phase: ArtifactFileSharePhase;
  operation?: ArtifactFileShareOperation;
  permission: ArtifactFileSharePermissionValue;
  pendingPermission?: ArtifactFileSharePermissionValue;
  stoppedNotice?: string;
  isPermissionLocked?: boolean;
  message?: string;
  error?: string;
  shareCodeUnavailable?: boolean;
  canRetry: boolean;
  canCopy: boolean;
  canUpdateFile: boolean;
  copyStatus: ArtifactFileShareCopyStatus;
  updateStatus: ArtifactFileShareUpdateStatus;
  showSubscriptionAction?: boolean;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onRetry: () => void;
  onOpenSubscription: () => void;
  onPermissionChange: (permission: ArtifactFileSharePermissionValue) => void;
  onUpdateFile: () => void;
  onCopy: () => void;
}

const CloseIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4.5 4.5l7 7" />
    <path d="M11.5 4.5l-7 7" />
  </svg>
);

const LoadingIndicator = () => (
  <span
    className="inline-block h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary motion-safe:animate-spin"
    aria-hidden="true"
  />
);

const PERMISSION_OPTIONS: ReadonlyArray<{
  value: ArtifactFileSharePermissionValue;
  labelKey: string;
}> = [
  {
    value: ArtifactFileSharePermission.Public,
    labelKey: 'htmlShareAccessModePublic',
  },
  {
    value: ArtifactFileSharePermission.Code,
    labelKey: 'artifactFileShareCodeAccess',
  },
  {
    value: ArtifactFileSharePermission.Stopped,
    labelKey: 'artifactFileShareStopAccess',
  },
];

const ArtifactFileShareDialog = ({
  artifact,
  phase,
  operation,
  permission,
  pendingPermission,
  stoppedNotice,
  isPermissionLocked = false,
  message,
  error,
  shareCodeUnavailable = false,
  canRetry,
  canCopy,
  canUpdateFile,
  copyStatus,
  updateStatus,
  showSubscriptionAction = false,
  closeButtonRef,
  onClose,
  onRetry,
  onOpenSubscription,
  onPermissionChange,
  onUpdateFile,
  onCopy,
}: ArtifactFileShareDialogProps) => {
  const isPreparing = phase === ArtifactFileSharePhase.Preparing;
  const isReady = phase === ArtifactFileSharePhase.Ready;
  const isPermissionUpdating = operation === ArtifactFileShareOperation.Permission;
  const isUpdatingFile = operation === ArtifactFileShareOperation.UpdateFile;
  const permissionDisabled = !isReady || Boolean(operation) || isPermissionLocked;
  const displayedPermission = pendingPermission ?? permission;
  const copyButtonLabel =
    copyStatus === ArtifactFileShareCopyStatus.Copied
      ? t('copied')
      : copyStatus === ArtifactFileShareCopyStatus.Failed
        ? t('copyFailed')
        : t('htmlShareCopyLink');
  const updateButtonLabel = isUpdatingFile
    ? t('htmlShareUpdatingFile')
    : updateStatus === ArtifactFileShareUpdateStatus.Updated
      ? t('htmlShareUpdateComplete')
      : t('htmlShareUpdateFile');

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={isPreparing || Boolean(operation)}
        aria-labelledby="artifact-file-share-dialog-title"
        aria-describedby="artifact-file-share-dialog-description"
        className="relative w-full max-w-[440px] rounded-2xl bg-background p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="artifact-file-share-dialog-title"
            className="text-lg font-semibold leading-7 text-foreground"
          >
            {t('htmlShare')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground"
            aria-label={t('close')}
            title={t('close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mt-3 rounded-xl bg-surface px-3 py-3">
          <ArtifactPreviewIdentity artifact={artifact} />
        </div>

        <div className="mt-5">
          <div className="flex min-h-5 items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('artifactFileShareAccessPermission')}
            </h3>
            {stoppedNotice && (
              <span className="text-xs font-medium text-red-500" role="status">
                {stoppedNotice}
              </span>
            )}
          </div>

          <div
            className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3"
            role="radiogroup"
            aria-label={t('artifactFileShareAccessPermission')}
          >
            {PERMISSION_OPTIONS.map(option => {
              const isSelected = displayedPermission === option.value;
              const isPending = isPermissionUpdating && pendingPermission === option.value;
              return (
                <label
                  key={option.value}
                  className={`inline-flex min-h-10 items-center gap-2 text-sm transition-colors ${
                    permissionDisabled
                      ? 'cursor-not-allowed text-muted'
                      : 'cursor-pointer text-foreground'
                  }`}
                >
                  <input
                    type="radio"
                    name="artifact-file-share-permission"
                    value={option.value}
                    checked={isSelected}
                    disabled={permissionDisabled}
                    onChange={() => onPermissionChange(option.value)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{t(option.labelKey)}</span>
                  {isPending && <LoadingIndicator />}
                </label>
              );
            })}
          </div>

          <div
            id="artifact-file-share-dialog-description"
            className="mt-3 min-h-5 text-xs leading-5 text-muted"
          >
            {isPreparing && (
              <span className="inline-flex items-center gap-2" role="status">
                <LoadingIndicator />
                {message || t('artifactFileSharePreparing')}
              </span>
            )}
            {!isPreparing && isPermissionUpdating && !error && (
              <span role="status">{t('htmlShareAccessModeUpdating')}</span>
            )}
            {!isPreparing && error && (
              <span className="text-red-500" role="alert">
                {error}
              </span>
            )}
            {!isPreparing && !error && !isPermissionUpdating && message && (
              <span role="status">{message}</span>
            )}
            {!isPreparing && !error && !message && shareCodeUnavailable && (
              <span>{t('htmlShareCodeUnavailable')}</span>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
          {phase === ArtifactFileSharePhase.Error && canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-10 min-w-[88px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {t('artifactFileShareRetry')}
            </button>
          )}
          {phase === ArtifactFileSharePhase.Entitlement && showSubscriptionAction && (
            <button
              type="button"
              onClick={onOpenSubscription}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {t('htmlShareOpenSubscription')}
            </button>
          )}
          {(isPreparing || isReady) && (
            <>
              <button
                type="button"
                onClick={onUpdateFile}
                disabled={!canUpdateFile || Boolean(operation)}
                title={
                  permission === ArtifactFileSharePermission.Stopped
                    ? t('htmlShareDisabledCannotUpdate')
                    : undefined
                }
                className="inline-flex h-10 min-w-[96px] items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateButtonLabel}
              </button>
              <button
                type="button"
                onClick={onCopy}
                disabled={!canCopy || Boolean(operation)}
                className={`inline-flex h-10 min-w-[104px] items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  copyStatus === ArtifactFileShareCopyStatus.Failed
                    ? 'bg-red-500 text-white hover:bg-red-500/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary-hover'
                }`}
              >
                {copyButtonLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ArtifactFileShareDialog;
