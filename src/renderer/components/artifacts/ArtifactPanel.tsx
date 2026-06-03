import { ArtifactBrowserPartition } from '@shared/artifactPreview/constants';
import {
  type HtmlShareConfigurableStatus,
  HtmlShareErrorCode,
  HtmlShareStatus,
  type HtmlShareStatus as HtmlShareStatusValue,
} from '@shared/htmlShare/constants';
import type { LocalWebService } from '@shared/localWebServices/constants';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { authService } from '@/services/auth';
import { getPortalPricingUrl, isTestModeEnabled } from '@/services/endpoints';
import { i18nService } from '@/services/i18n';
import type { RootState } from '@/store';
import {
  addArtifact,
  ArtifactContentView,
  ArtifactSpecialTab,
  closePanel,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  openArtifactPreviewTab,
  selectActivePreviewTab,
  selectPanelWidth,
  setPanelWidth,
  setPreviewTabContentView,
} from '@/store/slices/artifactSlice';
import {
  type Artifact,
  type ArtifactType,
  ArtifactTypeValue,
  PREVIEWABLE_ARTIFACT_TYPES,
} from '@/types/artifact';
import { openLocalPathWithToast, revealLocalPathWithToast } from '@/utils/localFileActions';

import CopyIcon from '../icons/CopyIcon';
import ArtifactRenderer from './ArtifactRenderer';
import FileDirectoryView from './FileDirectoryView';
import CodeRenderer from './renderers/CodeRenderer';

const t = (key: string) => i18nService.t(key);

const BROWSER_OPENABLE_TYPES = new Set<ArtifactType>(['html', 'svg', 'mermaid']);

const SYSTEM_OPENABLE_TYPES = new Set<ArtifactType>(['document', 'video']);

const NON_CODE_TYPES = new Set<ArtifactType>([
  'document',
  'image',
  'video',
  'text',
  ArtifactTypeValue.LocalService,
]);

const COPYABLE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

const PANEL_CLOSE_DRAG_THRESHOLD = 48;
const FILE_LIST_DRAWER_TRANSITION_MS = 180;

const HtmlSharePhase = {
  Idle: 'idle',
  Checking: 'checking',
  Packing: 'packing',
  Uploading: 'uploading',
  Live: 'live',
  Failed: 'failed',
} as const;

type HtmlSharePhase = (typeof HtmlSharePhase)[keyof typeof HtmlSharePhase];

const HtmlShareDialogKind = {
  Subscription: 'subscription',
  Existing: 'existing',
  Result: 'result',
} as const;

type HtmlShareDialogKind = (typeof HtmlShareDialogKind)[keyof typeof HtmlShareDialogKind];

const HtmlSharePendingSource = {
  HtmlFile: 'htmlFile',
} as const;

interface HtmlSharePendingRequest {
  source: typeof HtmlSharePendingSource.HtmlFile;
  sessionId: string;
  artifactId: string;
  filePath: string;
  title: string;
}

interface HtmlShareDialogState {
  kind: HtmlShareDialogKind;
  title: string;
  message: string;
  shareId?: string;
  url?: string;
  shareCode?: string;
  shareCodeUnavailable?: boolean;
  status?: HtmlShareStatusValue;
  targetStatus?: HtmlShareConfigurableStatus;
  statusError?: string;
}

interface ExistingHtmlShareInfo {
  shareId: string;
  url: string;
  shareCode?: string;
  shareCodeUnavailable?: boolean;
  status?: HtmlShareStatusValue;
}

interface HtmlShareLookupState {
  filePath: string;
  isLoading: boolean;
  share?: ExistingHtmlShareInfo;
}

function getExistingHtmlShareInfo(
  share: {
    shareId?: string;
    url?: string;
    shareCode?: string;
    shareCodeUnavailable?: boolean;
    status?: HtmlShareStatusValue;
  } | null | undefined,
): ExistingHtmlShareInfo | null {
  if (!share?.shareId || !share.url) return null;
  return {
    shareId: share.shareId,
    url: share.url,
    shareCode: share.shareCode,
    shareCodeUnavailable: share.shareCodeUnavailable,
    status: share.status,
  };
}

function getConfigurableHtmlShareStatus(
  status?: HtmlShareStatusValue,
): HtmlShareConfigurableStatus | undefined {
  if (status === HtmlShareStatus.Failed) return undefined;
  return status === HtmlShareStatus.Disabled ? HtmlShareStatus.Disabled : HtmlShareStatus.Live;
}

function getHtmlShareStatusLabel(status?: HtmlShareStatusValue): string {
  if (status === HtmlShareStatus.Disabled) return t('htmlShareStatusDisabled');
  if (status === HtmlShareStatus.Failed) return t('htmlShareStatusFailed');
  return t('htmlShareStatusLive');
}

function getHtmlShareResultStatusLabel(status?: HtmlShareStatusValue): string {
  if (status === HtmlShareStatus.Disabled) return t('htmlShareResultStatusDisabled');
  if (status === HtmlShareStatus.Failed) return t('htmlShareResultStatusFailed');
  return '';
}

function getHtmlShareResultStatusClassName(status?: HtmlShareStatusValue): string {
  if (status === HtmlShareStatus.Disabled) {
    return 'bg-surface text-muted';
  }
  if (status === HtmlShareStatus.Failed) {
    return 'bg-red-500/10 text-red-500 dark:text-red-400';
  }
  return '';
}

function shouldShowHtmlShareResultStatus(status?: HtmlShareStatusValue): boolean {
  return status === HtmlShareStatus.Disabled || status === HtmlShareStatus.Failed;
}

function getHtmlShareFailureMessage(
  result:
    | {
        code?: number;
        error?: string;
      }
    | null
    | undefined,
): string {
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
  return result?.error || t('htmlShareFailed');
}

function isCopyableArtifact(artifact: Artifact): boolean {
  if (artifact.type === 'document' || artifact.type === 'video') return false;
  if (artifact.type === ArtifactTypeValue.LocalService) return false;
  if (artifact.type === 'image') {
    const filename = artifact.fileName || artifact.filePath || '';
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return COPYABLE_IMAGE_EXTENSIONS.has(ext);
  }
  return true;
}

function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert image to blob'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

function buildBrowserHtml(artifact: Artifact): string | null {
  switch (artifact.type) {
    case 'html':
      return artifact.content;
    case 'svg':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${artifact.title}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5}</style></head><body>${artifact.content}</body></html>`;
    case 'mermaid':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${artifact.title}</title><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:system-ui,sans-serif}</style></head><body><pre class="mermaid">${escapeHtml(artifact.content)}</pre><script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'});<\/script></body></html>`;
    default:
      return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ArtifactPanelProps {
  sessionId: string;
  artifacts: Artifact[];
  activeSpecialTab?: ArtifactSpecialTab;
  minPanelWidth?: number;
  maxPanelWidth?: number;
  browserAddress?: string;
  browserUrl?: string;
  onBrowserAddressChange?: (value: string) => void;
  onBrowserUrlChange?: (value: string) => void;
  onOpenFileListTab?: () => void;
  onOpenBrowserTab?: () => void;
  onBrowserAnnotationCaptured?: (payload: BrowserAnnotationPayload) => void;
}

export const BrowserAnnotationShape = {
  Rectangle: 'rectangle',
} as const;

export type BrowserAnnotationShape =
  (typeof BrowserAnnotationShape)[keyof typeof BrowserAnnotationShape];

export const BrowserAnnotationColor = {
  Blue: 'blue',
} as const;

export type BrowserAnnotationColor =
  (typeof BrowserAnnotationColor)[keyof typeof BrowserAnnotationColor];

export interface BrowserAnnotationElementInfo {
  tagName: string;
  text: string;
  color: string;
  fontFamily: string;
  width: number;
  height: number;
}

export interface BrowserAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserAnnotationScreenshotInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface BrowserAnnotationMarkInfo extends BrowserAnnotationRect {
  shape: BrowserAnnotationShape;
  color: BrowserAnnotationColor;
}

export interface BrowserAnnotationPayload {
  comment: string;
  imageDataUrl: string;
  pageUrl: string;
  pageTitle: string;
  screenshot: BrowserAnnotationScreenshotInfo;
  annotation: BrowserAnnotationMarkInfo;
  element: BrowserAnnotationElementInfo;
}

const ArtifactPanel: React.FC<ArtifactPanelProps> = ({
  sessionId,
  artifacts,
  activeSpecialTab = ArtifactSpecialTab.FileList,
  minPanelWidth = MIN_PANEL_WIDTH,
  maxPanelWidth = MAX_PANEL_WIDTH,
  browserAddress: controlledBrowserAddress,
  browserUrl: controlledBrowserUrl,
  onBrowserAddressChange,
  onBrowserUrlChange,
  onOpenFileListTab,
  onOpenBrowserTab,
  onBrowserAnnotationCaptured,
}) => {
  const dispatch = useDispatch();
  const panelWidth = useSelector(selectPanelWidth);
  const activePreviewTab = useSelector((state: RootState) =>
    selectActivePreviewTab(state, sessionId),
  );
  const authState = useSelector((state: RootState) => state.auth);
  const [showFileListDrawer, setShowFileListDrawer] = useState(false);
  const [isFileListDrawerVisible, setIsFileListDrawerVisible] = useState(false);
  const [localBrowserAddress, setLocalBrowserAddress] = useState('');
  const [localBrowserUrl, setLocalBrowserUrl] = useState('');
  const [htmlSharePhase, setHtmlSharePhase] = useState<HtmlSharePhase>(HtmlSharePhase.Idle);
  const [htmlShareDialog, setHtmlShareDialog] = useState<HtmlShareDialogState | null>(null);
  const [htmlSharePendingRequest, setHtmlSharePendingRequest] =
    useState<HtmlSharePendingRequest | null>(null);
  const [htmlShareLookup, setHtmlShareLookup] = useState<HtmlShareLookupState | null>(null);
  const [isHtmlShareStatusUpdating, setIsHtmlShareStatusUpdating] = useState(false);
  const [isHtmlShareEnabled, setIsHtmlShareEnabled] = useState(isTestModeEnabled);
  const [isArtifactActionsMenuOpen, setIsArtifactActionsMenuOpen] = useState(false);
  const fileListDrawerRef = useRef<HTMLDivElement>(null);
  const fileListButtonRef = useRef<HTMLButtonElement>(null);
  const artifactActionsMenuRef = useRef<HTMLDivElement>(null);
  const artifactActionsMenuButtonRef = useRef<HTMLButtonElement>(null);
  const fileListDrawerAnimationFrameRef = useRef<number | undefined>(undefined);
  const fileListDrawerCloseTimeoutRef = useRef<number | undefined>(undefined);

  const previewableArtifacts = artifacts.filter(a => PREVIEWABLE_ARTIFACT_TYPES.has(a.type));
  const artifactsById = useMemo(
    () => new Map(artifacts.map(artifact => [artifact.id, artifact])),
    [artifacts],
  );
  const selectedArtifact = activePreviewTab
    ? (artifactsById.get(activePreviewTab.artifactId) ?? null)
    : null;
  const selectedHtmlFilePath =
    selectedArtifact?.type === ArtifactTypeValue.Html ? selectedArtifact.filePath : undefined;
  const selectedHtmlShare =
    selectedHtmlFilePath && htmlShareLookup?.filePath === selectedHtmlFilePath
      ? htmlShareLookup.share
      : undefined;
  const selectedArtifactId = selectedArtifact?.id ?? null;
  const activeTab = activePreviewTab?.contentView ?? ArtifactContentView.Preview;
  const isDocumentArtifact = selectedArtifact?.type === 'document';

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const previousBodyCursor = useRef('');
  const [panelIsResizing, setPanelIsResizing] = useState(false);
  const constrainedMaxPanelWidth = Math.max(
    MIN_PANEL_WIDTH,
    Math.min(MAX_PANEL_WIDTH, maxPanelWidth),
  );
  const constrainedMinPanelWidth = Math.min(
    constrainedMaxPanelWidth,
    Math.max(MIN_PANEL_WIDTH, minPanelWidth),
  );
  const constrainedPanelWidth = Math.max(
    constrainedMinPanelWidth,
    Math.min(constrainedMaxPanelWidth, panelWidth),
  );
  const browserAddress = controlledBrowserAddress ?? localBrowserAddress;
  const browserUrl = controlledBrowserUrl ?? localBrowserUrl;
  const isHtmlSharing =
    htmlSharePhase === HtmlSharePhase.Checking ||
    htmlSharePhase === HtmlSharePhase.Packing ||
    htmlSharePhase === HtmlSharePhase.Uploading;
  let htmlShareButtonTitle = selectedHtmlShare ? t('htmlShareUpdateShare') : t('htmlShare');
  if (htmlSharePhase === HtmlSharePhase.Checking) {
    htmlShareButtonTitle = t('htmlShareScanning');
  } else if (htmlSharePhase === HtmlSharePhase.Packing) {
    htmlShareButtonTitle = t('htmlSharePacking');
  } else if (htmlSharePhase === HtmlSharePhase.Uploading) {
    htmlShareButtonTitle = t('htmlShareUploading');
  }
  const htmlShareButtonClass = selectedHtmlShare
    ? 'p-1 rounded bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50'
    : 'p-1 rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';
  const canShareHtmlArtifact = Boolean(
    isHtmlShareEnabled &&
      selectedArtifact?.type === ArtifactTypeValue.Html &&
      selectedHtmlFilePath,
  );
  const canUseHtmlShareDialogLink = Boolean(
    htmlShareDialog?.url &&
      htmlShareDialog.status !== HtmlShareStatus.Disabled &&
      htmlShareDialog.status !== HtmlShareStatus.Failed,
  );
  const isHtmlShareContentUpdateDisabled = Boolean(
    isHtmlShareStatusUpdating ||
      htmlShareDialog?.status === HtmlShareStatus.Disabled ||
      htmlShareDialog?.targetStatus === HtmlShareStatus.Disabled,
  );
  const isCompactHtmlToolbar = selectedArtifact?.type === ArtifactTypeValue.Html;
  const isCompactArtifactToolbar = Boolean(selectedArtifact);
  const showRefreshAction = Boolean(selectedArtifact?.filePath);
  const showCopyAction = Boolean(selectedArtifact && isCopyableArtifact(selectedArtifact));
  const showOpenBrowserAction = Boolean(
    selectedArtifact && BROWSER_OPENABLE_TYPES.has(selectedArtifact.type),
  );
  const showOpenWithAppAction = Boolean(
    selectedArtifact &&
      SYSTEM_OPENABLE_TYPES.has(selectedArtifact.type) &&
      selectedArtifact.filePath,
  );
  const showRevealInFolderAction = Boolean(selectedArtifact?.filePath);
  const showPrimaryOpenWithAppAction = Boolean(!isCompactHtmlToolbar && showOpenWithAppAction);
  const showPrimaryRevealInFolderAction = Boolean(
    !isCompactHtmlToolbar &&
      !showPrimaryOpenWithAppAction &&
      showRevealInFolderAction,
  );
  const showOpenBrowserActionInMenu = Boolean(!isCompactHtmlToolbar && showOpenBrowserAction);
  const showOpenWithAppActionInMenu = Boolean(isCompactHtmlToolbar && showOpenWithAppAction);
  const showRevealInFolderActionInMenu = Boolean(
    showRevealInFolderAction && !showPrimaryRevealInFolderAction,
  );
  const showArtifactActionsMenu = Boolean(
    isCompactArtifactToolbar &&
      (showRefreshAction ||
        showCopyAction ||
        showOpenBrowserActionInMenu ||
        showOpenWithAppActionInMenu ||
        showRevealInFolderActionInMenu),
  );

  const handleBrowserAddressChange = useCallback(
    (value: string) => {
      setLocalBrowserAddress(value);
      onBrowserAddressChange?.(value);
    },
    [onBrowserAddressChange],
  );

  const handleBrowserUrlChange = useCallback(
    (value: string) => {
      setLocalBrowserUrl(value);
      onBrowserUrlChange?.(value);
    },
    [onBrowserUrlChange],
  );

  const openFileListDrawer = useCallback(() => {
    if (fileListDrawerCloseTimeoutRef.current !== undefined) {
      window.clearTimeout(fileListDrawerCloseTimeoutRef.current);
      fileListDrawerCloseTimeoutRef.current = undefined;
    }
    if (fileListDrawerAnimationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(fileListDrawerAnimationFrameRef.current);
    }

    setShowFileListDrawer(true);
    fileListDrawerAnimationFrameRef.current = window.requestAnimationFrame(() => {
      fileListDrawerAnimationFrameRef.current = undefined;
      setIsFileListDrawerVisible(true);
    });
  }, []);

  const closeFileListDrawer = useCallback(() => {
    if (fileListDrawerAnimationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(fileListDrawerAnimationFrameRef.current);
      fileListDrawerAnimationFrameRef.current = undefined;
    }
    if (fileListDrawerCloseTimeoutRef.current !== undefined) {
      window.clearTimeout(fileListDrawerCloseTimeoutRef.current);
    }

    setIsFileListDrawerVisible(false);
    fileListDrawerCloseTimeoutRef.current = window.setTimeout(() => {
      setShowFileListDrawer(false);
      fileListDrawerCloseTimeoutRef.current = undefined;
    }, FILE_LIST_DRAWER_TRANSITION_MS);
  }, []);

  const toggleFileListDrawer = useCallback(() => {
    if (showFileListDrawer && isFileListDrawerVisible) {
      closeFileListDrawer();
      return;
    }

    openFileListDrawer();
  }, [closeFileListDrawer, isFileListDrawerVisible, openFileListDrawer, showFileListDrawer]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = constrainedPanelWidth;
      previousBodyCursor.current = document.body.style.cursor;
      document.body.style.cursor = 'col-resize';
      document.body.classList.add('select-none');
      setPanelIsResizing(true);

      const stopResizing = () => {
        isResizing.current = false;
        document.body.style.cursor = previousBodyCursor.current;
        document.body.classList.remove('select-none');
        setPanelIsResizing(false);
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!isResizing.current) return;
        moveEvent.preventDefault();
        const nextWidth = startWidth.current + startX.current - moveEvent.clientX;
        if (nextWidth < constrainedMinPanelWidth - PANEL_CLOSE_DRAG_THRESHOLD) {
          stopResizing();
          dispatch(closePanel({ sessionId }));
          return;
        }
        const clampedWidth = Math.max(
          constrainedMinPanelWidth,
          Math.min(constrainedMaxPanelWidth, nextWidth),
        );
        dispatch(setPanelWidth(clampedWidth));
      };

      const handlePointerUp = () => {
        stopResizing();
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
    },
    [
      constrainedMaxPanelWidth,
      constrainedMinPanelWidth,
      constrainedPanelWidth,
      dispatch,
      sessionId,
    ],
  );

  useEffect(() => {
    return () => {
      if (fileListDrawerAnimationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(fileListDrawerAnimationFrameRef.current);
      }
      if (fileListDrawerCloseTimeoutRef.current !== undefined) {
        window.clearTimeout(fileListDrawerCloseTimeoutRef.current);
      }
      document.body.style.cursor = previousBodyCursor.current;
      document.body.classList.remove('select-none');
    };
  }, []);

  useEffect(() => {
    const refreshHtmlShareAvailability = () => {
      const nextIsEnabled = isTestModeEnabled();
      setIsHtmlShareEnabled(nextIsEnabled);
      if (!nextIsEnabled) {
        setHtmlShareDialog(null);
        setHtmlSharePendingRequest(null);
        setHtmlShareLookup(null);
        setHtmlSharePhase(HtmlSharePhase.Idle);
        setIsHtmlShareStatusUpdating(false);
      }
    };

    window.addEventListener('config-updated', refreshHtmlShareAvailability);
    return () => {
      window.removeEventListener('config-updated', refreshHtmlShareAvailability);
    };
  }, []);

  useEffect(() => {
    if (
      !selectedHtmlFilePath ||
      !isHtmlShareEnabled ||
      !authState.isLoggedIn ||
      authState.quota?.subscriptionStatus !== 'active'
    ) {
      setHtmlShareLookup(null);
      return;
    }

    let isCancelled = false;
    const htmlShareApi = window.electron?.htmlShare;

    setHtmlShareLookup(previous => {
      if (previous?.filePath === selectedHtmlFilePath && previous.share) {
        return previous;
      }
      return { filePath: selectedHtmlFilePath, isLoading: true };
    });

    if (!htmlShareApi) {
      setHtmlShareLookup({ filePath: selectedHtmlFilePath, isLoading: false });
      return () => {
        isCancelled = true;
      };
    }

    htmlShareApi
      .getByHtmlFile({ filePath: selectedHtmlFilePath })
      .then(lookup => {
        if (isCancelled) return;
        const share = lookup?.success ? getExistingHtmlShareInfo(lookup.share) : null;
        setHtmlShareLookup(previous => {
          if (!share && previous?.filePath === selectedHtmlFilePath && previous.share) {
            return previous;
          }
          return {
            filePath: selectedHtmlFilePath,
            isLoading: false,
            ...(share ? { share } : {}),
          };
        });
      })
      .catch(() => {
        if (isCancelled) return;
        setHtmlShareLookup(previous => {
          if (previous?.filePath === selectedHtmlFilePath && previous.share) {
            return previous;
          }
          return { filePath: selectedHtmlFilePath, isLoading: false };
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [
    authState.isLoggedIn,
    authState.quota?.subscriptionStatus,
    isHtmlShareEnabled,
    selectedHtmlFilePath,
  ]);

  useEffect(() => {
    if (selectedArtifact) return;
    closeFileListDrawer();
    setIsArtifactActionsMenuOpen(false);
  }, [closeFileListDrawer, selectedArtifact]);

  useEffect(() => {
    closeFileListDrawer();
    setIsArtifactActionsMenuOpen(false);
  }, [activePreviewTab?.id, closeFileListDrawer]);

  useEffect(() => {
    if (!isArtifactActionsMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        artifactActionsMenuRef.current?.contains(target) ||
        artifactActionsMenuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setIsArtifactActionsMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsArtifactActionsMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isArtifactActionsMenuOpen]);

  useEffect(() => {
    if (!showFileListDrawer) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        fileListDrawerRef.current?.contains(target) ||
        fileListButtonRef.current?.contains(target)
      ) {
        return;
      }
      closeFileListDrawer();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFileListDrawer();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeFileListDrawer, showFileListDrawer]);

  // Auto-refresh when the previewed file changes on disk
  useEffect(() => {
    const filePath = selectedArtifact?.filePath;
    if (!filePath) return;

    let cleanup: (() => void) | undefined;
    let watchedPath: string | null = null;

    window.electron?.artifact?.watchFile(filePath);
    watchedPath = filePath;

    cleanup = window.electron?.artifact?.onFileChanged(({ filePath: changedPath }) => {
      if (changedPath === watchedPath) {
        handleRefreshRef.current();
      }
    });

    return () => {
      if (cleanup) cleanup();
      if (watchedPath) window.electron?.artifact?.unwatchFile(watchedPath);
    };
  }, [selectedArtifact?.filePath]);

  const openLocalServiceArtifact = useCallback(
    (artifact: Artifact): boolean => {
      if (artifact.type !== ArtifactTypeValue.LocalService) return false;
      const url = artifact.url || artifact.content;
      if (!url) return true;
      onOpenBrowserTab?.();
      handleBrowserAddressChange(url);
      handleBrowserUrlChange(url);
      return true;
    },
    [handleBrowserAddressChange, handleBrowserUrlChange, onOpenBrowserTab],
  );

  const handleSelectArtifact = useCallback(
    (id: string) => {
      const artifact = artifacts.find(item => item.id === id);
      if (artifact && openLocalServiceArtifact(artifact)) return;
      onOpenFileListTab?.();
      dispatch(openArtifactPreviewTab({ sessionId, artifactId: id }));
    },
    [artifacts, dispatch, onOpenFileListTab, openLocalServiceArtifact, sessionId],
  );

  const handleSelectArtifactFromDrawer = useCallback(
    (id: string) => {
      const artifact = artifacts.find(item => item.id === id);
      if (artifact && openLocalServiceArtifact(artifact)) {
        closeFileListDrawer();
        return;
      }
      dispatch(openArtifactPreviewTab({ sessionId, artifactId: id }));
      closeFileListDrawer();
    },
    [artifacts, closeFileListDrawer, dispatch, openLocalServiceArtifact, sessionId],
  );

  const handleSetContentView = useCallback(
    (contentView: ArtifactContentView) => {
      if (!activePreviewTab) return;
      dispatch(
        setPreviewTabContentView({
          sessionId,
          tabId: activePreviewTab.id,
          contentView,
        }),
      );
    },
    [activePreviewTab, dispatch, sessionId],
  );

  const handleCopy = useCallback(async () => {
    if (!selectedArtifact) return;
    if (selectedArtifact.type === 'image') {
      if (selectedArtifact.filePath) {
        const result = await window.electron?.clipboard?.writeImageFromFile(
          selectedArtifact.filePath,
        );
        if (!result?.success) {
          window.dispatchEvent(
            new CustomEvent('app:showToast', { detail: result?.error || t('copyFailed') }),
          );
          return;
        }
      } else if (selectedArtifact.content) {
        const blob = await dataUrlToPngBlob(selectedArtifact.content);
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      }
    } else {
      if (selectedArtifact.filePath && !selectedArtifact.content && selectedArtifact.type !== 'document') {
        const result = await window.electron?.dialog?.readTextFile?.(selectedArtifact.filePath);
        if (!result?.success || typeof result.content !== 'string') {
          window.dispatchEvent(new CustomEvent('app:showToast', { detail: result?.error || t('copyFailed') }));
          return;
        }
        await navigator.clipboard.writeText(result.content);
      } else {
        await navigator.clipboard.writeText(selectedArtifact.content);
      }
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: t('messageCopied') }));
  }, [selectedArtifact]);

  const handleRevealInFolder = useCallback(() => {
    if (!selectedArtifact?.filePath) return;
    void revealLocalPathWithToast(selectedArtifact.filePath);
  }, [selectedArtifact]);

  const handleOpenInBrowser = useCallback(() => {
    if (!selectedArtifact) return;

    // Mermaid needs HTML wrapper with mermaid.js to render in browser
    if (selectedArtifact.type === 'mermaid') {
      if (!selectedArtifact.content) return;
      const html = buildBrowserHtml(selectedArtifact);
      if (html) {
        window.electron?.shell?.openHtmlInBrowser(html);
      }
      return;
    }

    // Has file on disk: open directly via native path
    // NOTE: shell.openExternal with file:// URLs fails on Windows when path contains
    // non-ASCII characters (e.g. Chinese) — ERROR_FILE_NOT_FOUND (0x2).
    // Use shell.openPath which handles native Unicode paths correctly.
    if (selectedArtifact.filePath) {
      void openLocalPathWithToast(selectedArtifact.filePath);
      return;
    }

    // No file path: generate HTML and open via temp file
    if (!selectedArtifact.content) return;
    const html = buildBrowserHtml(selectedArtifact);
    if (html) {
      window.electron?.shell?.openHtmlInBrowser(html);
    }
  }, [selectedArtifact]);

  const openSubscriptionPage = useCallback(() => {
    window.electron?.shell?.openExternal(getPortalPricingUrl());
    setHtmlShareDialog(null);
  }, []);

  const formatShareClipboardText = useCallback((url: string, shareCode?: string): string => {
    if (!shareCode) return url;
    return `${t('htmlShareLink')}: ${url}\n${t('htmlShareCode')}: ${shareCode}`;
  }, []);

  const ensureHtmlShareAllowed = useCallback(async (): Promise<boolean> => {
    let latestIsLoggedIn = authState.isLoggedIn;
    let latestQuota = authState.quota;

    if (!latestIsLoggedIn || latestQuota?.subscriptionStatus !== 'active') {
      const refreshed = await authService.refreshAuthState();
      latestIsLoggedIn = refreshed.isLoggedIn;
      latestQuota = refreshed.quota;
    }

    if (!latestIsLoggedIn) {
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Subscription,
        title: t('htmlShareLoginRequiredTitle'),
        message: t('htmlShareLoginRequiredMessage'),
      });
      return false;
    }
    if (latestQuota?.subscriptionStatus !== 'active') {
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Subscription,
        title: t('htmlShareSubscriptionRequiredTitle'),
        message: t('htmlShareSubscriptionRequiredMessage'),
      });
      return false;
    }
    return true;
  }, [authState.isLoggedIn, authState.quota]);

  const handleCopyShareLink = useCallback(
    async (url?: string, shareCode?: string) => {
      if (!url) return;
      await navigator.clipboard.writeText(formatShareClipboardText(url, shareCode));
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: t('copied') }));
    },
    [formatShareClipboardText],
  );

  const handleOpenShareLink = useCallback((url?: string) => {
    if (!url) return;
    window.electron?.shell?.openExternal(url);
  }, []);

  const openExistingHtmlShareDialog = useCallback(
    (
      request: HtmlSharePendingRequest,
      share: ExistingHtmlShareInfo,
    ) => {
      setHtmlSharePendingRequest(request);
      setHtmlSharePhase(HtmlSharePhase.Live);
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Existing,
        title: t('htmlShareManageDialogTitle'),
        message: t('htmlShareExistingShareMessage'),
        shareId: share.shareId,
        url: share.url,
        shareCode: share.shareCode,
        shareCodeUnavailable: share.shareCodeUnavailable,
        status: share.status,
        targetStatus: getConfigurableHtmlShareStatus(share.status),
      });
    },
    [],
  );

  const rememberHtmlShare = useCallback((filePath: string, share: unknown) => {
    const existingShare = getExistingHtmlShareInfo(
      share as {
        shareId?: string;
        url?: string;
        shareCode?: string;
        shareCodeUnavailable?: boolean;
        status?: HtmlShareStatusValue;
      } | null | undefined,
    );
    if (!existingShare) return;
    setHtmlShareLookup({
      filePath,
      isLoading: false,
      share: existingShare,
    });
  }, []);

  const handleHtmlShareResult = useCallback(
    async (
      result: Awaited<
        ReturnType<NonNullable<typeof window.electron>['htmlShare']['createFromHtmlFile']>
      >,
      action: 'create' | 'update' = 'create',
    ) => {
      if (!result?.success || !result.url) {
        if (result?.code === HtmlShareErrorCode.SubscriptionRequired) {
          setHtmlShareDialog({
            kind: HtmlShareDialogKind.Subscription,
            title: t('htmlShareSubscriptionRequiredTitle'),
            message: t('htmlShareSubscriptionRequiredMessage'),
          });
          setHtmlSharePhase(HtmlSharePhase.Failed);
          return;
        }
        throw new Error(getHtmlShareFailureMessage(result));
      }
      setHtmlSharePhase(HtmlSharePhase.Live);
      if (result.status !== HtmlShareStatus.Disabled && result.status !== HtmlShareStatus.Failed) {
        await handleCopyShareLink(result.url, result.shareCode);
      }
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Result,
        title:
          action === 'update'
            ? t('htmlShareUpdated')
            : t('htmlShareSuccess'),
        message: result.shareCodeUnavailable
          ? t('htmlShareCodeUnavailable')
          : result.warnings?.length
          ? result.warnings.slice(0, 3).join('\n')
          : action === 'update'
            ? result.status === HtmlShareStatus.Disabled
              ? t('htmlShareUpdatedClosedMessage')
              : t('htmlShareUpdatedMessage')
            : t('htmlShareSuccessMessage'),
        url: result.url,
        shareCode: result.shareCode,
        shareCodeUnavailable: result.shareCodeUnavailable,
        status: result.status,
      });
    },
    [handleCopyShareLink],
  );

  const createHtmlShare = useCallback(async (request: HtmlSharePendingRequest) => {
    if (isHtmlSharing) return;
    setHtmlShareDialog(null);
    setHtmlSharePendingRequest(null);
    try {
      setHtmlSharePhase(HtmlSharePhase.Packing);
      setHtmlSharePhase(HtmlSharePhase.Uploading);
      const result = await window.electron?.htmlShare?.createFromHtmlFile({
        sessionId: request.sessionId,
        artifactId: request.artifactId,
        filePath: request.filePath,
        title: request.title,
      });
      await handleHtmlShareResult(result);
      rememberHtmlShare(request.filePath, result);
    } catch (error) {
      setHtmlSharePhase(HtmlSharePhase.Failed);
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Result,
        title: t('htmlShareFailed'),
        message: error instanceof Error ? error.message : t('htmlShareFailed'),
      });
    }
  }, [handleHtmlShareResult, isHtmlSharing, rememberHtmlShare]);

  const updateHtmlShare = useCallback(async () => {
    if (
      !htmlSharePendingRequest ||
      !htmlShareDialog?.shareId ||
      isHtmlSharing ||
      isHtmlShareContentUpdateDisabled
    )
      return;
    const request = htmlSharePendingRequest;
    const shareId = htmlShareDialog.shareId;
    const currentStatus = htmlShareDialog.status;
    setHtmlShareDialog(null);
    try {
      setHtmlSharePhase(HtmlSharePhase.Packing);
      setHtmlSharePhase(HtmlSharePhase.Uploading);
      const result = await window.electron?.htmlShare?.updateFromHtmlFile({
        shareId,
        sessionId: request.sessionId,
        artifactId: request.artifactId,
        filePath: request.filePath,
        title: request.title,
        currentStatus,
      });
      await handleHtmlShareResult(result, 'update');
      rememberHtmlShare(request.filePath, result);
    } catch (error) {
      setHtmlSharePhase(HtmlSharePhase.Failed);
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Result,
        title: t('htmlShareFailed'),
        message: error instanceof Error ? error.message : t('htmlShareFailed'),
      });
    }
  }, [
    handleHtmlShareResult,
    htmlShareDialog?.shareId,
    htmlShareDialog?.status,
    htmlSharePendingRequest,
    isHtmlShareContentUpdateDisabled,
    isHtmlSharing,
    rememberHtmlShare,
  ]);

  const toggleHtmlShareTargetStatus = useCallback(async () => {
    if (
      !htmlShareDialog ||
      htmlShareDialog.kind !== HtmlShareDialogKind.Existing ||
      !htmlShareDialog.shareId ||
      !htmlShareDialog.targetStatus ||
      isHtmlShareStatusUpdating
    ) {
      return;
    }
    const shareId = htmlShareDialog.shareId;
    const previousStatus = htmlShareDialog.targetStatus;
    const nextStatus =
      previousStatus === HtmlShareStatus.Live ? HtmlShareStatus.Disabled : HtmlShareStatus.Live;

    setIsHtmlShareStatusUpdating(true);
    setHtmlShareDialog(previous => {
      if (
        !previous ||
        previous.kind !== HtmlShareDialogKind.Existing ||
        previous.shareId !== shareId
      ) {
        return previous;
      }
      return {
        ...previous,
        status: nextStatus,
        targetStatus: nextStatus,
        statusError: undefined,
      };
    });
    try {
      const result = await window.electron?.htmlShare?.updateStatus({
        shareId,
        status: nextStatus,
      });
      if (!result?.success || !result.url) {
        throw new Error(getHtmlShareFailureMessage(result));
      }
      const resultStatus = getConfigurableHtmlShareStatus(result.status) ?? nextStatus;
      if (htmlSharePendingRequest) {
        rememberHtmlShare(htmlSharePendingRequest.filePath, {
          ...result,
          status: resultStatus,
        });
      }
      setHtmlShareDialog(previous => {
        if (
          !previous ||
          previous.kind !== HtmlShareDialogKind.Existing ||
          previous.shareId !== shareId
        ) {
          return previous;
        }
        return {
          ...previous,
          url: result.url ?? previous.url,
          shareCode: result.shareCode ?? previous.shareCode,
          shareCodeUnavailable:
            result.shareCodeUnavailable ?? previous.shareCodeUnavailable,
          status: resultStatus,
          targetStatus: resultStatus,
          statusError: undefined,
        };
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('htmlShareStatusUpdateFailed');
      setHtmlShareDialog(previous => {
        if (
          !previous ||
          previous.kind !== HtmlShareDialogKind.Existing ||
          previous.shareId !== shareId
        ) {
          return previous;
        }
        return {
          ...previous,
          status: previousStatus,
          targetStatus: previousStatus,
          statusError: message,
        };
      });
    } finally {
      setIsHtmlShareStatusUpdating(false);
    }
  }, [
    htmlShareDialog,
    htmlSharePendingRequest,
    isHtmlShareStatusUpdating,
    rememberHtmlShare,
  ]);

  const handleShareHtmlArtifact = useCallback(async () => {
    if (
      !isHtmlShareEnabled ||
      !selectedArtifact ||
      !selectedHtmlFilePath ||
      selectedArtifact.type !== ArtifactTypeValue.Html ||
      isHtmlSharing
    )
      return;
    if (!(await ensureHtmlShareAllowed())) return;
    const request: HtmlSharePendingRequest = {
      source: HtmlSharePendingSource.HtmlFile,
      sessionId,
      artifactId: selectedArtifact.id,
      filePath: selectedHtmlFilePath,
      title: selectedArtifact.title || selectedArtifact.fileName || t('htmlShare'),
    };
    try {
      if (selectedHtmlShare) {
        openExistingHtmlShareDialog(request, selectedHtmlShare);
        return;
      }
      setHtmlSharePhase(HtmlSharePhase.Checking);
      const lookup = await window.electron?.htmlShare?.getByHtmlFile({
        filePath: selectedHtmlFilePath,
      });
      if (!lookup?.success) {
        if (lookup?.code === HtmlShareErrorCode.FeatureUnavailable) {
          throw new Error(t('htmlShareUnavailableInProduction'));
        }
        throw new Error(lookup?.error || t('htmlShareFailed'));
      }
      const existingShare = getExistingHtmlShareInfo(lookup.share);
      if (existingShare) {
        rememberHtmlShare(request.filePath, existingShare);
        openExistingHtmlShareDialog(request, existingShare);
        return;
      }
      await createHtmlShare(request);
    } catch (error) {
      setHtmlSharePhase(HtmlSharePhase.Failed);
      setHtmlShareDialog({
        kind: HtmlShareDialogKind.Result,
        title: t('htmlShareFailed'),
        message: error instanceof Error ? error.message : t('htmlShareFailed'),
      });
    }
  }, [
    createHtmlShare,
    ensureHtmlShareAllowed,
    isHtmlShareEnabled,
    isHtmlSharing,
    openExistingHtmlShareDialog,
    rememberHtmlShare,
    selectedArtifact,
    selectedHtmlFilePath,
    selectedHtmlShare,
    sessionId,
  ]);

  const handleOpenWithApp = useCallback(() => {
    if (selectedArtifact?.filePath) {
      let filePath = selectedArtifact.filePath;
      if (filePath.startsWith('file:///')) {
        filePath = filePath.slice(7);
      } else if (filePath.startsWith('file://')) {
        filePath = filePath.slice(7);
      } else if (filePath.startsWith('file:/')) {
        filePath = filePath.slice(5);
      }
      // Strip leading / before Windows drive letter
      if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      void openLocalPathWithToast(filePath);
    }
  }, [selectedArtifact]);

  const handleRefresh = useCallback(async () => {
    if (!selectedArtifact?.filePath) return;
    if (selectedArtifact.type === 'video') {
      dispatch(addArtifact({
        sessionId: selectedArtifact.sessionId,
        artifact: { ...selectedArtifact, createdAt: Date.now() },
      }));
      return;
    }
    try {
      if (selectedArtifact.type === ArtifactTypeValue.Html) {
        dispatch(addArtifact({
          sessionId: selectedArtifact.sessionId,
          artifact: {
            ...selectedArtifact,
            contentVersion: Date.now(),
          },
        }));
        return;
      }

      const isTextType = selectedArtifact.type !== 'image' && selectedArtifact.type !== 'document';
      if (isTextType && window.electron?.dialog?.readTextFile) {
        const result = await window.electron.dialog.readTextFile(selectedArtifact.filePath);
        if (result?.success && typeof result.content === 'string') {
          dispatch(addArtifact({
            sessionId: selectedArtifact.sessionId,
            artifact: { ...selectedArtifact, content: result.content, contentVersion: Date.now() },
          }));
        }
        return;
      }

      const result = await window.electron.dialog.readFileAsDataUrl(selectedArtifact.filePath);
      if (result?.success && result.dataUrl) {
        const isTextType =
          selectedArtifact.type !== 'image' && selectedArtifact.type !== 'document';
        let content = result.dataUrl;
        if (isTextType) {
          try {
            const base64 = result.dataUrl.split(',')[1] || '';
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            content = new TextDecoder('utf-8').decode(bytes);
          } catch {
            content = result.dataUrl;
          }
        }
        dispatch(
          addArtifact({
            sessionId: selectedArtifact.sessionId,
            artifact: { ...selectedArtifact, content },
          }),
        );
      }
    } catch {
      // File unreadable or missing
    }
  }, [selectedArtifact, dispatch]);

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;

  const runArtifactMenuAction = useCallback((action: () => void) => {
    setIsArtifactActionsMenuOpen(false);
    action();
  }, []);

  return (
    <>
      {/* Drag handle */}
      <div
        className="w-1 shrink-0 touch-none cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        onPointerDown={handleResizeStart}
      />
      <aside
        style={{ width: constrainedPanelWidth, maxWidth: constrainedMaxPanelWidth }}
        className="shrink border-l border-border bg-background flex flex-col h-full overflow-hidden relative"
      >
        {panelIsResizing && (
          <div className="absolute inset-0 z-30 cursor-col-resize bg-transparent" />
        )}

        {selectedArtifact ? (
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            {/* Header: current file + actions */}
            <div className="h-10 flex items-center gap-2 px-3 border-b border-border shrink-0">
              <span className="text-sm font-medium truncate">
                {selectedArtifact.fileName || selectedArtifact.title}
              </span>
              <span className="text-xs uppercase text-muted">{selectedArtifact.type}</span>
              <span className="flex-1" />
              {showArtifactActionsMenu && (
                <div className="relative">
                  <button
                    ref={artifactActionsMenuButtonRef}
                    type="button"
                    onClick={() => setIsArtifactActionsMenuOpen(value => !value)}
                    className={`p-1 rounded transition-colors ${
                      isArtifactActionsMenuOpen
                        ? 'bg-surface text-foreground'
                        : 'text-secondary hover:text-foreground hover:bg-surface'
                    }`}
                    aria-label={t('artifactActionsMenu')}
                    title={t('artifactActionsMenu')}
                  >
                    <MoreHorizontalToolbarIcon />
                  </button>
                  {isArtifactActionsMenuOpen && (
                    <div
                      ref={artifactActionsMenuRef}
                      className="absolute right-0 top-7 z-40 w-32 rounded-lg border border-border bg-surface-raised p-1.5 text-sm text-foreground shadow-xl"
                    >
                      {showRefreshAction && (
                        <button
                          type="button"
                          onClick={() => runArtifactMenuAction(handleRefresh)}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
                        >
                          <RefreshIcon />
                          <span>{t('artifactRefresh')}</span>
                        </button>
                      )}
                      {showCopyAction && (
                        <button
                          type="button"
                          onClick={() => runArtifactMenuAction(() => void handleCopy())}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
                        >
                          <CopyIcon className="h-3.5 w-3.5" />
                          <span>{t('artifactCopyCode')}</span>
                        </button>
                      )}
                      {showOpenBrowserActionInMenu && (
                        <button
                          type="button"
                          onClick={() => runArtifactMenuAction(handleOpenInBrowser)}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
                        >
                          <BrowserIcon />
                          <span>{t('artifactOpenInBrowser')}</span>
                        </button>
                      )}
                      {showOpenWithAppActionInMenu && (
                        <button
                          type="button"
                          onClick={() => runArtifactMenuAction(handleOpenWithApp)}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
                        >
                          <OpenExternalIcon />
                          <span>{t('artifactOpenWithApp')}</span>
                        </button>
                      )}
                      {showRevealInFolderActionInMenu && (
                        <button
                          type="button"
                          onClick={() => runArtifactMenuAction(handleRevealInFolder)}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
                        >
                          <FolderIcon />
                          <span>{t('artifactOpenFolder')}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {canShareHtmlArtifact && (
                <button
                  onClick={handleShareHtmlArtifact}
                  disabled={isHtmlSharing}
                  className={htmlShareButtonClass}
                  aria-label={htmlShareButtonTitle}
                  title={htmlShareButtonTitle}
                >
                  <ShareIcon />
                </button>
              )}
              {isCompactHtmlToolbar && showOpenBrowserAction && (
                <button
                  onClick={handleOpenInBrowser}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactOpenInBrowser')}
                >
                  <OpenExternalIcon />
                </button>
              )}
              {showPrimaryOpenWithAppAction && (
                <button
                  onClick={handleOpenWithApp}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactOpenWithApp')}
                >
                  <OpenExternalIcon />
                </button>
              )}
              {showPrimaryRevealInFolderAction && (
                <button
                  onClick={handleRevealInFolder}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactOpenFolder')}
                >
                  <FolderIcon />
                </button>
              )}
              <button
                ref={fileListButtonRef}
                onClick={toggleFileListDrawer}
                className={`p-1 rounded transition-colors ${
                  isFileListDrawerVisible
                    ? 'text-primary bg-primary/10'
                    : 'text-secondary hover:text-foreground hover:bg-surface'
                }`}
                title={t('artifactFileList')}
              >
                <FileListIcon />
              </button>
            </div>

            {showFileListDrawer && (
              <div
                ref={fileListDrawerRef}
                className={`absolute top-10 right-0 bottom-0 z-20 flex w-[min(320px,86%)] flex-col border-l border-border bg-background shadow-xl transition-[transform,opacity] duration-[180ms] ease-out motion-reduce:transition-none ${
                  isFileListDrawerVisible
                    ? 'translate-x-0 opacity-100'
                    : 'translate-x-full opacity-0 pointer-events-none'
                }`}
              >
                <div className="h-9 flex items-center px-3 border-b border-border shrink-0">
                  <span className="text-xs font-medium text-secondary">
                    {t('artifactFileList')}
                  </span>
                </div>
                <FileDirectoryView
                  artifacts={previewableArtifacts}
                  selectedId={selectedArtifactId}
                  onSelect={handleSelectArtifactFromDrawer}
                  compact
                />
              </div>
            )}

            {/* Preview/Code tabs */}
            <div
              className={`flex border-b border-border shrink-0 ${isDocumentArtifact ? 'pl-4' : ''}`}
            >
              <button
                onClick={() => handleSetContentView(ArtifactContentView.Preview)}
                className={`${isDocumentArtifact ? 'px-0' : 'px-3'} py-1.5 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === ArtifactContentView.Preview
                    ? 'border-primary text-primary'
                    : 'border-transparent text-secondary hover:text-foreground'
                }`}
              >
                {t('artifactPreview')}
              </button>
              {!NON_CODE_TYPES.has(selectedArtifact.type) && (
                <button
                  onClick={() => handleSetContentView(ArtifactContentView.Code)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
                    activeTab === ArtifactContentView.Code
                      ? 'border-primary text-primary'
                      : 'border-transparent text-secondary hover:text-foreground'
                  }`}
                >
                  {t('artifactCode')}
                </button>
              )}
            </div>

            {/* Render area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeTab === ArtifactContentView.Preview ? (
                <ArtifactRenderer artifact={selectedArtifact} sessionArtifacts={artifacts} />
              ) : (
                <CodeRenderer artifact={selectedArtifact} />
              )}
            </div>
          </div>
        ) : activeSpecialTab === ArtifactSpecialTab.Browser ? (
          <BrowserTabContent
            address={browserAddress}
            currentUrl={browserUrl}
            sessionArtifacts={artifacts}
            onAddressChange={handleBrowserAddressChange}
            onCurrentUrlChange={handleBrowserUrlChange}
            onAnnotationCaptured={onBrowserAnnotationCaptured}
          />
        ) : (
          /* No artifact selected: show full-width file list */
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <FileDirectoryView
              artifacts={previewableArtifacts}
              selectedId={selectedArtifactId}
              onSelect={handleSelectArtifact}
            />
          </div>
        )}
      </aside>
      {htmlShareDialog &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 px-4">
            <div className="w-full max-w-[420px] rounded-lg border border-border bg-background p-4 shadow-2xl">
              <div className="text-sm font-semibold text-foreground">{htmlShareDialog.title}</div>
              {htmlShareDialog.kind === HtmlShareDialogKind.Existing ? (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <div className="whitespace-pre-wrap break-words text-sm leading-6 text-secondary">
                      {htmlShareDialog.message}
                    </div>
                    <div className="rounded-md border border-border bg-surface px-3 py-2">
                      <div className="text-xs text-muted">{t('htmlShareLink')}</div>
                      <div className="mt-1 break-words text-sm text-foreground">
                        {htmlShareDialog.url}
                      </div>
                    </div>
                  </div>
                  {htmlShareDialog.shareCode && (
                    <div className="rounded-md border border-border bg-surface px-3 py-2">
                      <div className="text-xs text-muted">{t('htmlShareCode')}</div>
                      <div className="mt-1 font-mono text-sm tracking-wider text-foreground">
                        {htmlShareDialog.shareCode}
                      </div>
                    </div>
                  )}
                  {htmlShareDialog.shareCodeUnavailable && (
                    <div className="text-xs leading-5 text-muted">
                      {t('htmlShareCodeUnavailable')}
                    </div>
                  )}
                  {htmlShareDialog.targetStatus && (
                    <div className="rounded-md border border-border bg-surface px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-muted">
                            {t('htmlShareAvailability')}
                          </div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {isHtmlShareStatusUpdating
                              ? t('htmlShareStatusUpdating')
                              : getHtmlShareStatusLabel(htmlShareDialog.targetStatus)}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted">
                            {htmlShareDialog.targetStatus === HtmlShareStatus.Live
                              ? t('htmlShareAvailabilityOpenHint')
                              : t('htmlShareAvailabilityClosedHint')}
                          </div>
                          {htmlShareDialog.statusError && (
                            <div className="mt-1 text-xs leading-5 text-red-500">
                              {htmlShareDialog.statusError}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={htmlShareDialog.targetStatus === HtmlShareStatus.Live}
                          aria-busy={isHtmlShareStatusUpdating}
                          aria-label={t('htmlShareAvailability')}
                          onClick={toggleHtmlShareTargetStatus}
                          disabled={isHtmlShareStatusUpdating}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                            htmlShareDialog.targetStatus === HtmlShareStatus.Live
                              ? 'bg-primary'
                              : 'bg-gray-300 dark:bg-gray-600'
                          } ${
                            isHtmlShareStatusUpdating
                              ? 'cursor-not-allowed opacity-70'
                              : ''
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              htmlShareDialog.targetStatus === HtmlShareStatus.Live
                                ? 'translate-x-6'
                                : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mt-3 space-y-3">
                    <div className="whitespace-pre-wrap break-words text-sm leading-6 text-secondary">
                      {htmlShareDialog.message}
                    </div>
                    {htmlShareDialog.url && (
                      <div className="rounded-md border border-border bg-surface px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium text-muted">
                            {t('htmlShareLink')}
                          </div>
                          {shouldShowHtmlShareResultStatus(htmlShareDialog.status) && (
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${getHtmlShareResultStatusClassName(htmlShareDialog.status)}`}
                            >
                              {getHtmlShareResultStatusLabel(htmlShareDialog.status)}
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-1 truncate text-sm leading-5 text-foreground"
                          title={htmlShareDialog.url}
                        >
                          {htmlShareDialog.url}
                        </div>
                      </div>
                    )}
                    {htmlShareDialog.shareCode && (
                      <div className="rounded-md border border-border bg-surface px-3 py-2">
                        <div className="text-xs font-medium text-muted">
                          {t('htmlShareCode')}
                        </div>
                        <div className="mt-1 font-mono text-base font-semibold tracking-wider text-foreground">
                          {htmlShareDialog.shareCode}
                        </div>
                      </div>
                    )}
                    {htmlShareDialog.shareCodeUnavailable &&
                      htmlShareDialog.message !== t('htmlShareCodeUnavailable') && (
                        <div className="text-xs leading-5 text-muted">
                          {t('htmlShareCodeUnavailable')}
                        </div>
                      )}
                  </div>
                </>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setHtmlShareDialog(null);
                    setHtmlSharePendingRequest(null);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface hover:text-foreground"
                >
                  {htmlShareDialog.kind === HtmlShareDialogKind.Result ||
                  htmlShareDialog.kind === HtmlShareDialogKind.Existing
                    ? t('close')
                    : t('cancel')}
                </button>
                {htmlShareDialog.kind === HtmlShareDialogKind.Subscription ? (
                  <button
                    type="button"
                    onClick={openSubscriptionPage}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {t('htmlShareOpenSubscription')}
                  </button>
                ) : htmlShareDialog.kind === HtmlShareDialogKind.Existing ? (
                  <>
                    {canUseHtmlShareDialogLink && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyShareLink(htmlShareDialog.url, htmlShareDialog.shareCode)
                        }
                        className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface hover:text-foreground"
                      >
                        {htmlShareDialog.shareCode
                          ? t('htmlShareCopyAll')
                          : t('htmlShareCopyLink')}
                      </button>
                    )}
                    {canUseHtmlShareDialogLink && (
                      <button
                        type="button"
                        onClick={() => handleOpenShareLink(htmlShareDialog.url)}
                        className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface hover:text-foreground"
                      >
                        {t('htmlShareOpenLink')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={updateHtmlShare}
                      disabled={isHtmlShareContentUpdateDisabled}
                      title={
                        htmlShareDialog.targetStatus === HtmlShareStatus.Disabled
                          ? t('htmlShareDisabledCannotUpdate')
                          : undefined
                      }
                      className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('htmlShareUpdate')}
                    </button>
                  </>
                ) : canUseHtmlShareDialogLink ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyShareLink(htmlShareDialog.url, htmlShareDialog.shareCode)
                      }
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface hover:text-foreground"
                    >
                      {htmlShareDialog.shareCode
                        ? t('htmlShareCopyAll')
                        : t('htmlShareCopyLink')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenShareLink(htmlShareDialog.url)}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      {t('htmlShareOpenLink')}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

type BrowserWebviewElement = HTMLElement & {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  capturePage?: () => Promise<{
    toDataURL: () => string;
    getSize?: () => { width: number; height: number };
  }>;
  executeJavaScript?: (code: string) => Promise<unknown>;
  loadURL?: (url: string) => Promise<void>;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  stop?: () => void;
  getURL?: () => string;
  getZoomFactor?: () => number;
  setZoomFactor?: (factor: number) => void;
};

const BrowserScreenshotStatus = {
  Idle: 'idle',
  Copied: 'copied',
  Error: 'error',
} as const;

type BrowserScreenshotStatus =
  (typeof BrowserScreenshotStatus)[keyof typeof BrowserScreenshotStatus];

const BrowserAnnotationStatus = {
  Sent: 'sent',
  Cancelled: 'cancelled',
} as const;

type BrowserAnnotationStatus =
  (typeof BrowserAnnotationStatus)[keyof typeof BrowserAnnotationStatus];

const BrowserToolbarAction = {
  Annotate: 'annotate',
  Screenshot: 'screenshot',
  OpenExternal: 'openExternal',
} as const;

type BrowserToolbarAction = (typeof BrowserToolbarAction)[keyof typeof BrowserToolbarAction];

const BrowserZoom = {
  Min: 0.25,
  Max: 3,
  Step: 0.1,
  Default: 1,
} as const;

const BrowserPageUrl = {
  Blank: 'about:blank',
} as const;

const LocalServiceDisplay = {
  Limit: 10,
} as const;

const BrowserDevicePresetId = {
  Responsive: 'responsive',
  FourK: '4k',
  LaptopLarge: 'laptop-large',
  Laptop: 'laptop',
  SurfacePro7: 'surface-pro-7',
  IPadAir: 'ipad-air',
  IPadMini: 'ipad-mini',
  SurfaceDuo: 'surface-duo',
  IPhone15ProMax: 'iphone-15-pro-max',
  Pixel8: 'pixel-8',
  IPhone15Pro: 'iphone-15-pro',
  SamsungGalaxyS24Ultra: 'samsung-galaxy-s24-ultra',
  IPhoneSe: 'iphone-se',
} as const;

type BrowserDevicePresetId = (typeof BrowserDevicePresetId)[keyof typeof BrowserDevicePresetId];

interface BrowserDevicePreset {
  id: BrowserDevicePresetId;
  labelKey?: string;
  label?: string;
  width: number;
  height: number;
}

const BrowserDeviceViewport = {
  MinSize: 50,
  MaxSize: 9999,
  DefaultWidth: 880,
  DefaultHeight: 888,
} as const;

const BrowserDeviceScale = {
  Min: 0.25,
  Max: 2,
  Default: 1,
} as const;

const BROWSER_DEVICE_PRESETS: BrowserDevicePreset[] = [
  {
    id: BrowserDevicePresetId.Responsive,
    labelKey: 'artifactBrowserDeviceResponsive',
    width: BrowserDeviceViewport.DefaultWidth,
    height: BrowserDeviceViewport.DefaultHeight,
  },
  { id: BrowserDevicePresetId.FourK, label: '4K', width: 3840, height: 2160 },
  { id: BrowserDevicePresetId.LaptopLarge, label: 'Laptop L', width: 1440, height: 900 },
  {
    id: BrowserDevicePresetId.Laptop,
    labelKey: 'artifactBrowserDeviceLaptop',
    width: 1366,
    height: 768,
  },
  { id: BrowserDevicePresetId.SurfacePro7, label: 'Surface Pro 7', width: 912, height: 1368 },
  { id: BrowserDevicePresetId.IPadAir, label: 'iPad Air', width: 820, height: 1180 },
  { id: BrowserDevicePresetId.IPadMini, label: 'iPad Mini', width: 768, height: 1024 },
  { id: BrowserDevicePresetId.SurfaceDuo, label: 'Surface Duo', width: 540, height: 720 },
  { id: BrowserDevicePresetId.IPhone15ProMax, label: 'iPhone 15 Pro Max', width: 430, height: 932 },
  { id: BrowserDevicePresetId.Pixel8, label: 'Pixel 8', width: 412, height: 915 },
  { id: BrowserDevicePresetId.IPhone15Pro, label: 'iPhone 15 Pro', width: 393, height: 852 },
  {
    id: BrowserDevicePresetId.SamsungGalaxyS24Ultra,
    label: 'Samsung Galaxy S24 Ultra',
    width: 384,
    height: 824,
  },
  { id: BrowserDevicePresetId.IPhoneSe, label: 'iPhone SE', width: 375, height: 667 },
];

const BROWSER_DEVICE_SCALE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

interface BrowserToolbarTooltipPosition {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

interface BrowserAnnotationResult {
  status: BrowserAnnotationStatus;
  comment?: string;
  pageUrl?: string;
  pageTitle?: string;
  element?: BrowserAnnotationElementInfo;
  rect?: BrowserAnnotationRect;
  viewport?: BrowserAnnotationScreenshotInfo;
}

function normalizeBrowserAnnotationRect(
  rect: BrowserAnnotationRect,
  viewport: BrowserAnnotationScreenshotInfo | undefined,
  screenshot: BrowserAnnotationScreenshotInfo,
): BrowserAnnotationMarkInfo {
  const screenshotWidth = screenshot.width > 0 ? screenshot.width : 1;
  const screenshotHeight = screenshot.height > 0 ? screenshot.height : 1;
  const viewportWidth = viewport?.width && viewport.width > 0 ? viewport.width : screenshotWidth;
  const viewportHeight =
    viewport?.height && viewport.height > 0 ? viewport.height : screenshotHeight;
  const scaleX = screenshotWidth / viewportWidth;
  const scaleY = screenshotHeight / viewportHeight;
  const x = Math.max(0, Math.min(screenshotWidth, Math.round(rect.x * scaleX)));
  const y = Math.max(0, Math.min(screenshotHeight, Math.round(rect.y * scaleY)));
  const maxWidth = Math.max(0, screenshotWidth - x);
  const maxHeight = Math.max(0, screenshotHeight - y);

  return {
    shape: BrowserAnnotationShape.Rectangle,
    color: BrowserAnnotationColor.Blue,
    x,
    y,
    width: Math.max(0, Math.min(maxWidth, Math.round(rect.width * scaleX))),
    height: Math.max(0, Math.min(maxHeight, Math.round(rect.height * scaleY))),
  };
}

function normalizeBrowserUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(https?|file):\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function clampBrowserZoomFactor(value: number): number {
  return Math.max(BrowserZoom.Min, Math.min(BrowserZoom.Max, Number(value.toFixed(2))));
}

function clampBrowserDeviceSize(value: number): number {
  if (!Number.isFinite(value)) return BrowserDeviceViewport.MinSize;
  return Math.max(
    BrowserDeviceViewport.MinSize,
    Math.min(BrowserDeviceViewport.MaxSize, Math.round(value)),
  );
}

function clampBrowserDeviceScale(value: number): number {
  if (!Number.isFinite(value)) return BrowserDeviceScale.Default;
  return Math.max(
    BrowserDeviceScale.Min,
    Math.min(BrowserDeviceScale.Max, Number(value.toFixed(2))),
  );
}

function getBrowserDevicePresetLabel(preset: BrowserDevicePreset): string {
  return preset.labelKey ? t(preset.labelKey) : (preset.label ?? preset.id);
}

function isLocalServiceHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === 'localhost' ||
    value === '127.0.0.1' ||
    value === '0.0.0.0' ||
    value === '[::1]' ||
    value === '::1'
  );
}

function parseLocalServiceArtifact(artifact: Artifact): LocalWebService | null {
  if (artifact.type !== ArtifactTypeValue.LocalService) return null;
  const rawUrl = artifact.url || artifact.content;
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl.trim());
    if (!isLocalServiceHostname(parsed.hostname) || !parsed.port) return null;
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return {
      id: `session-localhost:${port}`,
      title: artifact.title || `localhost:${port}`,
      url: rawUrl.trim(),
      host: parsed.hostname,
      port,
      online: false,
    };
  } catch {
    return null;
  }
}

function getSessionLocalServices(artifacts: Artifact[] | undefined): LocalWebService[] {
  const byPort = new Map<number, LocalWebService>();
  for (const artifact of artifacts ?? []) {
    const service = parseLocalServiceArtifact(artifact);
    if (!service || byPort.has(service.port)) continue;
    byPort.set(service.port, service);
  }
  return Array.from(byPort.values());
}

function mergeLocalServices(
  sessionServices: LocalWebService[],
  discoveredServices: LocalWebService[],
): LocalWebService[] {
  const byPort = new Map<number, LocalWebService>();
  const discoveredByPort = new Map(discoveredServices.map(service => [service.port, service]));

  for (const sessionService of sessionServices) {
    const discovered = discoveredByPort.get(sessionService.port);
    byPort.set(
      sessionService.port,
      discovered
        ? {
            ...sessionService,
            title: discovered.title || sessionService.title,
            url: sessionService.url || discovered.url,
            host: discovered.host || sessionService.host,
            online: true,
          }
        : sessionService,
    );
  }

  for (const discoveredService of discoveredServices) {
    if (!byPort.has(discoveredService.port)) {
      byPort.set(discoveredService.port, discoveredService);
    }
  }

  return Array.from(byPort.values()).slice(0, LocalServiceDisplay.Limit);
}

interface BrowserAnnotationLabels {
  instruction: string;
  placeholder: string;
  send: string;
  tag: string;
  size: string;
  color: string;
  font: string;
  statusSent: BrowserAnnotationStatus;
  statusCancelled: BrowserAnnotationStatus;
}

function buildBrowserAnnotationScript(labels: BrowserAnnotationLabels): string {
  return `
(() => {
  const labels = ${JSON.stringify(labels)};
  if (window.__lobsterAnnotationCleanup) {
    window.__lobsterAnnotationCleanup();
  }

  const overlayRoot = document.createElement('div');
  overlayRoot.setAttribute('data-lobster-annotation-ui', 'true');
  overlayRoot.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  const highlight = document.createElement('div');
  highlight.style.cssText = 'position:fixed;display:none;box-sizing:border-box;border:2px solid #1683ff;background:rgba(22,131,255,0.08);box-shadow:0 0 0 1px rgba(255,255,255,0.9);pointer-events:none;';

  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:fixed;display:none;max-width:260px;border-radius:8px;background:rgba(18,18,22,0.94);color:#fff;padding:8px 10px;font-size:12px;line-height:1.4;box-shadow:0 8px 22px rgba(0,0,0,0.28);pointer-events:none;';

  const composer = document.createElement('div');
  composer.setAttribute('data-lobster-annotation-ui', 'true');
  composer.style.cssText = 'position:fixed;display:none;min-width:300px;max-width:380px;border-radius:16px;background:rgba(22,22,24,0.96);color:#fff;padding:6px 7px;box-shadow:0 12px 32px rgba(0,0,0,0.28);pointer-events:auto;gap:6px;align-items:center;';

  const textarea = document.createElement('textarea');
  textarea.placeholder = labels.placeholder;
  textarea.rows = 1;
  textarea.style.cssText = 'min-width:0;flex:1;height:30px;max-height:84px;resize:none;border:0;outline:none;border-radius:10px;background:transparent;color:#fff;padding:5px 8px;font:13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>';
  sendButton.title = labels.send;
  sendButton.setAttribute('aria-label', labels.send);
  sendButton.style.cssText = 'width:32px;height:32px;border:0;border-radius:999px;background:#fff;color:#111;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:opacity 120ms ease, transform 120ms ease;';

  composer.append(textarea, sendButton);
  overlayRoot.append(highlight, tooltip, composer);
  document.documentElement.appendChild(overlayRoot);

  let selectedInfo = null;
  let frozen = false;
  let resolved = false;
  let resolvePromise;

  const cleanup = () => {
    if (!resolved) {
      finish({ status: labels.statusCancelled });
    }
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    overlayRoot.remove();
    delete window.__lobsterAnnotationCleanup;
  };

  const finish = (result) => {
    if (resolved) return;
    resolved = true;
    resolvePromise(result);
  };

  const isAnnotationUi = (target) => target?.closest?.('[data-lobster-annotation-ui="true"]');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const formatFont = (value) => cleanText(value).split(',')[0].replace(/["']/g, '').slice(0, 42);
  const hasComment = () => textarea.value.trim().length > 0;

  const updateSendState = () => {
    const enabled = hasComment();
    sendButton.disabled = !enabled;
    sendButton.style.opacity = enabled ? '1' : '0.42';
    sendButton.style.cursor = enabled ? 'pointer' : 'not-allowed';
    sendButton.style.transform = enabled ? 'scale(1)' : 'scale(0.98)';
  };

  const readInfo = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const tagName = element.tagName ? element.tagName.toLowerCase() : 'element';
    const elementText = element.getAttribute('aria-label') || element.getAttribute('alt') || element.innerText || element.textContent || '';
    return {
      tagName,
      text: cleanText(elementText),
      color: style.color || '',
      fontFamily: formatFont(style.fontFamily || ''),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  };

  const renderHighlight = (info) => {
    const rect = info.rect;
    highlight.style.display = 'block';
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  };

  const renderTooltip = (info) => {
    const rect = info.rect;
    tooltip.innerHTML = [
      '<div style="display:flex;gap:12px;justify-content:space-between;"><strong>' + info.tagName + '</strong><span>' + info.width + '×' + info.height + '</span></div>',
      '<div style="display:grid;grid-template-columns:auto 1fr;column-gap:10px;margin-top:4px;color:#d6d6d6;"><span>' + labels.color + '</span><strong style="color:#fff;font-weight:600;">' + (info.color || '-') + '</strong><span>' + labels.font + '</span><strong style="color:#fff;font-weight:600;">' + (info.fontFamily || '-') + '</strong></div>',
      info.text ? '<div style="margin-top:4px;color:#bbb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + info.text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) + '</div>' : ''
    ].join('');
    tooltip.style.display = 'block';
    tooltip.style.left = clamp(rect.left, 8, window.innerWidth - 270) + 'px';
    tooltip.style.top = clamp(rect.top - tooltip.offsetHeight - 10, 8, window.innerHeight - tooltip.offsetHeight - 8) + 'px';
  };

  const renderComposer = (info) => {
    const rect = info.rect;
    composer.style.display = 'flex';
    composer.style.left = clamp(rect.left + Math.min(100, rect.width / 2), 8, window.innerWidth - 388) + 'px';
    composer.style.top = clamp(rect.top + Math.min(32, rect.height / 2), 8, window.innerHeight - 52) + 'px';
    textarea.focus();
  };

  function handleMouseMove(event) {
    if (frozen || isAnnotationUi(event.target)) return;
    const element = event.target;
    if (!(element instanceof Element)) return;
    const info = readInfo(element);
    if (info.width <= 0 || info.height <= 0) return;
    selectedInfo = info;
    renderHighlight(info);
    renderTooltip(info);
  }

  function handleClick(event) {
    if (isAnnotationUi(event.target)) return;
    if (!selectedInfo) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    frozen = true;
    tooltip.style.display = 'none';
    renderHighlight(selectedInfo);
    renderComposer(selectedInfo);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish({ status: labels.statusCancelled });
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && selectedInfo) {
      event.preventDefault();
      sendButton.click();
    }
  }

  sendButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedInfo) return;
    if (!hasComment()) {
      updateSendState();
      textarea.focus();
      return;
    }
    composer.style.display = 'none';
    const { rect, ...element } = selectedInfo;
    finish({
      status: labels.statusSent,
      comment: textarea.value.trim(),
      pageUrl: location.href,
      pageTitle: document.title || '',
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      element,
    });
  });

  textarea.addEventListener('input', updateSendState);
  updateSendState();

  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  window.__lobsterAnnotationCleanup = cleanup;

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
})()
`;
}

interface BrowserTabContentProps {
  address: string;
  currentUrl: string;
  sessionArtifacts?: Artifact[];
  onAddressChange: (value: string) => void;
  onCurrentUrlChange: (value: string) => void;
  onAnnotationCaptured?: (payload: BrowserAnnotationPayload) => void;
}

const BrowserTabContent: React.FC<BrowserTabContentProps> = ({
  address,
  currentUrl,
  sessionArtifacts,
  onAddressChange,
  onCurrentUrlChange,
  onAnnotationCaptured,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotStatus, setScreenshotStatus] = useState<BrowserScreenshotStatus>(
    BrowserScreenshotStatus.Idle,
  );
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [localServices, setLocalServices] = useState<LocalWebService[]>([]);
  const [isLoadingLocalServices, setIsLoadingLocalServices] = useState(false);
  const [hoveredToolbarAction, setHoveredToolbarAction] = useState<BrowserToolbarAction | null>(
    null,
  );
  const [toolbarTooltipPosition, setToolbarTooltipPosition] =
    useState<BrowserToolbarTooltipPosition | null>(null);
  const [webviewNode, setWebviewNode] = useState<BrowserWebviewElement | null>(null);
  const [isWebviewReady, setIsWebviewReady] = useState(false);
  const [isBrowserMenuOpen, setIsBrowserMenuOpen] = useState(false);
  const [browserZoomFactor, setBrowserZoomFactor] = useState<number>(BrowserZoom.Default);
  const [isDeviceToolbarVisible, setIsDeviceToolbarVisible] = useState(false);
  const [devicePresetId, setDevicePresetId] = useState<BrowserDevicePresetId>(
    BrowserDevicePresetId.Responsive,
  );
  const [deviceWidth, setDeviceWidth] = useState<number>(BrowserDeviceViewport.DefaultWidth);
  const [deviceHeight, setDeviceHeight] = useState<number>(BrowserDeviceViewport.DefaultHeight);
  const [deviceScale, setDeviceScale] = useState<number>(BrowserDeviceScale.Default);
  const annotateButtonRef = useRef<HTMLDivElement>(null);
  const screenshotButtonRef = useRef<HTMLDivElement>(null);
  const openExternalButtonRef = useRef<HTMLDivElement>(null);
  const browserMenuButtonRef = useRef<HTMLButtonElement>(null);
  const browserMenuRef = useRef<HTMLDivElement>(null);
  const screenshotStatusTimeoutRef = useRef<number | undefined>(undefined);
  const lastRequestedUrlRef = useRef('');
  const lastRequestedWebviewRef = useRef<BrowserWebviewElement | null>(null);
  const webviewNodeRef = useRef<BrowserWebviewElement | null>(null);
  const sessionLocalServices = useMemo(
    () => getSessionLocalServices(sessionArtifacts),
    [sessionArtifacts],
  );

  useEffect(
    () => () => {
      if (screenshotStatusTimeoutRef.current !== undefined) {
        window.clearTimeout(screenshotStatusTimeoutRef.current);
      }
    },
    [],
  );

  const handleWebviewRef = useCallback((node: BrowserWebviewElement | null) => {
    if (webviewNodeRef.current === node) return;
    webviewNodeRef.current = node;
    lastRequestedUrlRef.current = '';
    lastRequestedWebviewRef.current = null;
    setIsWebviewReady(false);
    setWebviewNode(node);
  }, []);

  const loadLocalServices = useCallback(async () => {
    if (!window.electron?.artifact?.listLocalWebServices) return;
    setIsLoadingLocalServices(true);
    try {
      const services = await window.electron.artifact.listLocalWebServices({
        preferredPorts: sessionLocalServices.map(service => service.port),
      });
      setLocalServices(mergeLocalServices(sessionLocalServices, services));
    } catch {
      setLocalServices(sessionLocalServices.slice(0, LocalServiceDisplay.Limit));
    } finally {
      setIsLoadingLocalServices(false);
    }
  }, [sessionLocalServices]);

  useEffect(() => {
    if (currentUrl) return;
    void loadLocalServices();
  }, [currentUrl, loadLocalServices]);

  useEffect(() => {
    if (!isBrowserMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        browserMenuRef.current?.contains(target) ||
        browserMenuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setIsBrowserMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBrowserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBrowserMenuOpen]);

  const syncNavigationState = useCallback(
    (node: BrowserWebviewElement | null) => {
      if (!node) return;
      setCanGoBack(node.canGoBack?.() ?? false);
      setCanGoForward(node.canGoForward?.() ?? false);
      const nextUrl = node.getURL?.();
      if (nextUrl && nextUrl !== BrowserPageUrl.Blank) {
        onCurrentUrlChange(nextUrl);
        onAddressChange(nextUrl);
      }
    },
    [onAddressChange, onCurrentUrlChange],
  );

  const getToolbarActionElement = useCallback(
    (action: BrowserToolbarAction): HTMLDivElement | null => {
      switch (action) {
        case BrowserToolbarAction.Annotate:
          return annotateButtonRef.current;
        case BrowserToolbarAction.Screenshot:
          return screenshotButtonRef.current;
        case BrowserToolbarAction.OpenExternal:
          return openExternalButtonRef.current;
        default:
          return null;
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!hoveredToolbarAction) {
      setToolbarTooltipPosition(null);
      return;
    }

    const updatePosition = () => {
      const element = getToolbarActionElement(hoveredToolbarAction);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const placement = rect.top >= 34 ? 'top' : 'bottom';
      const top = placement === 'top' ? rect.top - 8 : rect.bottom + 8;
      const left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2));
      setToolbarTooltipPosition({ left, top, placement });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [getToolbarActionElement, hoveredToolbarAction]);

  useLayoutEffect(() => {
    if (!webviewNode) return;

    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => {
      setIsLoading(false);
      syncNavigationState(webviewNode);
    };
    const handleNavigate = (event: Event) => {
      const nextUrl = (event as Event & { url?: string }).url;
      if (nextUrl && nextUrl !== BrowserPageUrl.Blank) {
        onCurrentUrlChange(nextUrl);
        onAddressChange(nextUrl);
      }
      syncNavigationState(webviewNode);
    };
    const handleFailLoad = (event: Event) => {
      const detail = event as Event & { errorCode?: number };
      setIsLoading(false);
      if (detail.errorCode === -3) return;
      syncNavigationState(webviewNode);
    };
    const handleDomReady = () => {
      setIsWebviewReady(true);
      webviewNode.setZoomFactor?.(browserZoomFactor);
      handleStopLoading();
    };

    webviewNode.addEventListener('did-start-loading', handleStartLoading);
    webviewNode.addEventListener('did-stop-loading', handleStopLoading);
    webviewNode.addEventListener('did-fail-load', handleFailLoad);
    webviewNode.addEventListener('did-navigate', handleNavigate);
    webviewNode.addEventListener('did-navigate-in-page', handleNavigate);
    webviewNode.addEventListener('dom-ready', handleDomReady);
    return () => {
      webviewNode.removeEventListener('did-start-loading', handleStartLoading);
      webviewNode.removeEventListener('did-stop-loading', handleStopLoading);
      webviewNode.removeEventListener('did-fail-load', handleFailLoad);
      webviewNode.removeEventListener('did-navigate', handleNavigate);
      webviewNode.removeEventListener('did-navigate-in-page', handleNavigate);
      webviewNode.removeEventListener('dom-ready', handleDomReady);
    };
  }, [browserZoomFactor, onAddressChange, onCurrentUrlChange, syncNavigationState, webviewNode]);

  useEffect(() => {
    if (!isWebviewReady || !webviewNode?.setZoomFactor) return;
    webviewNode.setZoomFactor(browserZoomFactor);
  }, [browserZoomFactor, isWebviewReady, webviewNode]);

  useEffect(() => {
    if (!currentUrl || !isWebviewReady || !webviewNode?.loadURL) return;

    const loadedUrl = webviewNode.getURL?.();
    const isSamePendingRequest =
      lastRequestedWebviewRef.current === webviewNode && lastRequestedUrlRef.current === currentUrl;
    if (loadedUrl === currentUrl || isSamePendingRequest) return;

    lastRequestedUrlRef.current = currentUrl;
    lastRequestedWebviewRef.current = webviewNode;
    setIsLoading(true);
    let loadPromise: Promise<void>;
    try {
      loadPromise = webviewNode.loadURL(currentUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('dom-ready') || message.includes('attached to the DOM')) {
        setIsWebviewReady(false);
        return;
      }
      lastRequestedUrlRef.current = '';
      lastRequestedWebviewRef.current = null;
      setIsLoading(false);
      return;
    }
    loadPromise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ERR_ABORTED') || message.includes('(-3)')) return;
      lastRequestedUrlRef.current = '';
      lastRequestedWebviewRef.current = null;
      setIsLoading(false);
    });
  }, [currentUrl, isWebviewReady, webviewNode]);

  const handleNavigate = useCallback(() => {
    const nextUrl = normalizeBrowserUrl(address);
    if (!nextUrl) return;
    onCurrentUrlChange(nextUrl);
    onAddressChange(nextUrl);
  }, [address, onAddressChange, onCurrentUrlChange]);

  const handleOpenLocalService = useCallback(
    (service: LocalWebService) => {
      onCurrentUrlChange(service.url);
      onAddressChange(service.url);
    },
    [onAddressChange, onCurrentUrlChange],
  );

  const handleAddressKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        handleNavigate();
      }
    },
    [handleNavigate],
  );

  const handleOpenExternal = useCallback(() => {
    if (!currentUrl) return;
    window.electron?.shell?.openExternal(currentUrl);
  }, [currentUrl]);

  const handleToggleDeviceToolbar = useCallback(() => {
    setIsDeviceToolbarVisible(value => !value);
    setIsBrowserMenuOpen(false);
  }, []);

  const handleDevicePresetChange = useCallback((value: string) => {
    const preset = BROWSER_DEVICE_PRESETS.find(item => item.id === value);
    if (!preset) return;
    setDevicePresetId(preset.id);
    setDeviceWidth(preset.width);
    setDeviceHeight(preset.height);
  }, []);

  const handleDeviceWidthChange = useCallback((value: string) => {
    setDevicePresetId(BrowserDevicePresetId.Responsive);
    setDeviceWidth(clampBrowserDeviceSize(Number(value)));
  }, []);

  const handleDeviceHeightChange = useCallback((value: string) => {
    setDevicePresetId(BrowserDevicePresetId.Responsive);
    setDeviceHeight(clampBrowserDeviceSize(Number(value)));
  }, []);

  const handleRotateDevice = useCallback(() => {
    setDevicePresetId(BrowserDevicePresetId.Responsive);
    setDeviceWidth(deviceHeight);
    setDeviceHeight(deviceWidth);
  }, [deviceHeight, deviceWidth]);

  const handleDeviceScaleChange = useCallback((value: string) => {
    setDeviceScale(clampBrowserDeviceScale(Number(value)));
  }, []);

  const applyBrowserZoom = useCallback(
    (nextFactor: number) => {
      const clampedFactor = clampBrowserZoomFactor(nextFactor);
      setBrowserZoomFactor(clampedFactor);
      webviewNode?.setZoomFactor?.(clampedFactor);
    },
    [webviewNode],
  );

  const handleZoomOut = useCallback(() => {
    applyBrowserZoom(browserZoomFactor - BrowserZoom.Step);
  }, [applyBrowserZoom, browserZoomFactor]);

  const handleZoomIn = useCallback(() => {
    applyBrowserZoom(browserZoomFactor + BrowserZoom.Step);
  }, [applyBrowserZoom, browserZoomFactor]);

  const handleResetZoom = useCallback(() => {
    applyBrowserZoom(BrowserZoom.Default);
  }, [applyBrowserZoom]);

  const handleOpenBlankPage = useCallback(() => {
    setIsBrowserMenuOpen(false);
    lastRequestedUrlRef.current = '';
    lastRequestedWebviewRef.current = null;
    onAddressChange('');
    onCurrentUrlChange('');
  }, [onAddressChange, onCurrentUrlChange]);

  const handleClearBrowserCookies = useCallback(async () => {
    setIsBrowserMenuOpen(false);
    try {
      const result = await window.electron?.artifact?.clearBrowserCookies?.();
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: result?.success
            ? t('artifactBrowserCookiesCleared')
            : result?.error || t('artifactBrowserClearCookiesFailed'),
        }),
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: t('artifactBrowserClearCookiesFailed'),
        }),
      );
    }
  }, []);

  const handleClearBrowserCache = useCallback(async () => {
    setIsBrowserMenuOpen(false);
    try {
      const result = await window.electron?.artifact?.clearBrowserCache?.();
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: result?.success
            ? t('artifactBrowserCacheCleared')
            : result?.error || t('artifactBrowserClearCacheFailed'),
        }),
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: t('artifactBrowserClearCacheFailed'),
        }),
      );
    }
  }, []);

  const setTemporaryScreenshotStatus = useCallback((status: BrowserScreenshotStatus) => {
    setScreenshotStatus(status);
    if (screenshotStatusTimeoutRef.current !== undefined) {
      window.clearTimeout(screenshotStatusTimeoutRef.current);
    }
    screenshotStatusTimeoutRef.current = window.setTimeout(() => {
      setScreenshotStatus(BrowserScreenshotStatus.Idle);
      screenshotStatusTimeoutRef.current = undefined;
    }, 1600);
  }, []);

  const handleCaptureScreenshot = useCallback(async () => {
    if (!webviewNode?.capturePage || !currentUrl || isCapturingScreenshot) return;
    setIsCapturingScreenshot(true);
    try {
      const image = await webviewNode.capturePage();
      const result = await window.electron?.clipboard?.writeImageFromDataUrl(image.toDataURL());
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to write browser screenshot to clipboard');
      }
      setTemporaryScreenshotStatus(BrowserScreenshotStatus.Copied);
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: t('artifactBrowserScreenshotCopied'),
        }),
      );
    } catch {
      setTemporaryScreenshotStatus(BrowserScreenshotStatus.Error);
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: t('artifactBrowserScreenshotFailed'),
        }),
      );
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [currentUrl, isCapturingScreenshot, setTemporaryScreenshotStatus, webviewNode]);

  const handleToggleAnnotation = useCallback(async () => {
    if (!webviewNode?.executeJavaScript || !webviewNode.capturePage || !currentUrl) return;
    if (isAnnotating) {
      await webviewNode
        .executeJavaScript('window.__lobsterAnnotationCleanup?.()')
        .catch(() => undefined);
      setIsAnnotating(false);
      return;
    }
    setIsAnnotating(true);
    try {
      const labels: BrowserAnnotationLabels = {
        instruction: t('artifactBrowserAnnotationInstruction'),
        placeholder: t('artifactBrowserAnnotationPlaceholder'),
        send: t('artifactBrowserAnnotationSend'),
        tag: t('artifactBrowserAnnotationLabelTag'),
        size: t('artifactBrowserAnnotationLabelSize'),
        color: t('artifactBrowserAnnotationLabelColor'),
        font: t('artifactBrowserAnnotationLabelFont'),
        statusSent: BrowserAnnotationStatus.Sent,
        statusCancelled: BrowserAnnotationStatus.Cancelled,
      };
      const result = (await webviewNode.executeJavaScript(buildBrowserAnnotationScript(labels))) as
        | BrowserAnnotationResult
        | undefined;
      if (result?.status !== BrowserAnnotationStatus.Sent || !result.element || !result.rect)
        return;

      await new Promise(resolve => window.setTimeout(resolve, 80));
      const image = await webviewNode.capturePage();
      const imageDataUrl = image.toDataURL();
      const imageSize = image.getSize?.();
      const screenshot: BrowserAnnotationScreenshotInfo = {
        width: Math.round(imageSize?.width || result.viewport?.width || 0),
        height: Math.round(imageSize?.height || result.viewport?.height || 0),
        devicePixelRatio: result.viewport?.devicePixelRatio || window.devicePixelRatio || 1,
      };
      const annotation = normalizeBrowserAnnotationRect(result.rect, result.viewport, screenshot);
      onAnnotationCaptured?.({
        comment: result.comment?.trim() ?? '',
        imageDataUrl,
        pageUrl: result.pageUrl || currentUrl,
        pageTitle: result.pageTitle || '',
        screenshot,
        annotation,
        element: result.element,
      });
    } catch {
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: t('artifactBrowserScreenshotFailed'),
        }),
      );
    } finally {
      await webviewNode
        ?.executeJavaScript?.('window.__lobsterAnnotationCleanup?.()')
        .catch(() => undefined);
      setIsAnnotating(false);
    }
  }, [currentUrl, isAnnotating, onAnnotationCaptured, webviewNode]);

  const screenshotButtonTitle =
    screenshotStatus === BrowserScreenshotStatus.Copied
      ? t('artifactBrowserScreenshotCopied')
      : screenshotStatus === BrowserScreenshotStatus.Error
        ? t('artifactBrowserScreenshotFailed')
        : t('artifactBrowserScreenshot');

  const hoveredToolbarLabel =
    hoveredToolbarAction === BrowserToolbarAction.Annotate
      ? t('artifactBrowserAnnotate')
      : hoveredToolbarAction === BrowserToolbarAction.Screenshot
        ? t('artifactBrowserScreenshot')
        : hoveredToolbarAction === BrowserToolbarAction.OpenExternal
          ? t('artifactBrowserOpenExternal')
          : '';
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <button
          type="button"
          onClick={() => webviewNode?.goBack?.()}
          disabled={!canGoBack}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={t('artifactBrowserBack')}
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          onClick={() => webviewNode?.goForward?.()}
          disabled={!canGoForward}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={t('artifactBrowserForward')}
        >
          <ChevronRightBrowserIcon />
        </button>
        <button
          type="button"
          onClick={() => (isLoading ? webviewNode?.stop?.() : webviewNode?.reload?.())}
          disabled={!currentUrl}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={isLoading ? t('artifactBrowserStop') : t('artifactBrowserReload')}
        >
          {isLoading ? <StopIcon /> : <RefreshIcon />}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2 focus-within:border-primary">
          <BrowserIcon />
          <input
            type="text"
            value={address}
            onChange={event => onAddressChange(event.target.value)}
            onKeyDown={handleAddressKeyDown}
            placeholder={t('artifactBrowserUrlPlaceholder')}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
          />
        </div>
        <div
          ref={annotateButtonRef}
          className="flex h-7 w-7 shrink-0 items-center justify-center"
          onMouseEnter={() => setHoveredToolbarAction(BrowserToolbarAction.Annotate)}
          onMouseLeave={() => setHoveredToolbarAction(null)}
        >
          <button
            type="button"
            onClick={handleToggleAnnotation}
            disabled={!currentUrl}
            className={`inline-flex h-7 w-7 items-center justify-center rounded text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              isAnnotating
                ? 'bg-primary/10 text-primary'
                : 'text-secondary hover:bg-surface hover:text-foreground'
            }`}
            aria-label={t('artifactBrowserAnnotate')}
            title={isAnnotating ? t('artifactBrowserAnnotating') : t('artifactBrowserAnnotate')}
          >
            <AnnotateIcon />
          </button>
        </div>
        {isAnnotating && (
          <button
            type="button"
            onClick={handleToggleAnnotation}
            className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/15"
            title={t('artifactBrowserAnnotating')}
          >
            {t('artifactBrowserAnnotating')}
          </button>
        )}
        <div
          ref={screenshotButtonRef}
          className="flex h-7 w-7 shrink-0 items-center justify-center"
          onMouseEnter={() => setHoveredToolbarAction(BrowserToolbarAction.Screenshot)}
          onMouseLeave={() => setHoveredToolbarAction(null)}
        >
          <button
            type="button"
            onClick={handleCaptureScreenshot}
            disabled={!currentUrl || isCapturingScreenshot}
            className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              screenshotStatus === BrowserScreenshotStatus.Copied
                ? 'text-primary hover:bg-surface'
                : screenshotStatus === BrowserScreenshotStatus.Error
                  ? 'text-red-500 hover:bg-surface'
                  : 'text-secondary hover:bg-surface hover:text-foreground'
            }`}
            aria-label={t('artifactBrowserScreenshot')}
            title={screenshotButtonTitle}
          >
            {screenshotStatus === BrowserScreenshotStatus.Copied ? (
              <ScreenshotCopiedIcon />
            ) : (
              <ScreenshotIcon />
            )}
          </button>
        </div>
        <div
          ref={openExternalButtonRef}
          className="flex h-7 w-7 shrink-0 items-center justify-center"
          onMouseEnter={() => setHoveredToolbarAction(BrowserToolbarAction.OpenExternal)}
          onMouseLeave={() => setHoveredToolbarAction(null)}
        >
          <button
            type="button"
            onClick={handleOpenExternal}
            disabled={!currentUrl}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t('artifactBrowserOpenExternal')}
            title={t('artifactBrowserOpenExternal')}
          >
            <BrowserIcon />
          </button>
        </div>
        <button
          ref={browserMenuButtonRef}
          type="button"
          onClick={() => setIsBrowserMenuOpen(value => !value)}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors ${
            isBrowserMenuOpen
              ? 'bg-surface text-foreground'
              : 'text-secondary hover:bg-surface hover:text-foreground'
          }`}
          aria-label={t('artifactBrowserMenu')}
          title={t('artifactBrowserMenu')}
        >
          <MoreVerticalIcon />
        </button>
      </div>
      {isBrowserMenuOpen && (
        <div
          ref={browserMenuRef}
          className="absolute right-3 top-10 z-40 w-56 rounded-lg border border-border bg-surface-raised p-2 text-sm text-foreground shadow-xl"
        >
          <button
            type="button"
            onClick={handleOpenBlankPage}
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
          >
            {t('artifactBrowserBlankPage')}
          </button>
          <button
            type="button"
            onClick={handleToggleDeviceToolbar}
            className={`flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors hover:bg-surface ${
              isDeviceToolbarVisible ? 'bg-surface text-foreground' : ''
            }`}
          >
            {isDeviceToolbarVisible
              ? t('artifactBrowserHideDeviceToolbar')
              : t('artifactBrowserShowDeviceToolbar')}
          </button>
          <div className="my-1 border-t border-border" />
          <div className="flex h-9 items-center gap-2 px-2">
            <span className="min-w-0 flex-1 text-xs text-secondary">
              {t('artifactBrowserZoom')}
            </span>
            <div className="flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={browserZoomFactor <= BrowserZoom.Min}
                className="inline-flex h-full w-7 items-center justify-center text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                title={t('artifactBrowserZoomOut')}
              >
                <MinusIcon />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="h-full min-w-[54px] border-x border-border px-2 text-center text-xs text-foreground transition-colors hover:bg-surface"
                title={t('artifactBrowserResetZoom')}
              >
                {Math.round(browserZoomFactor * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={browserZoomFactor >= BrowserZoom.Max}
                className="inline-flex h-full w-7 items-center justify-center text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                title={t('artifactBrowserZoomIn')}
              >
                <PlusIcon />
              </button>
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={handleClearBrowserCookies}
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
          >
            {t('artifactBrowserClearCookies')}
          </button>
          <button
            type="button"
            onClick={handleClearBrowserCache}
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors hover:bg-surface"
          >
            {t('artifactBrowserClearCache')}
          </button>
        </div>
      )}
      {hoveredToolbarLabel &&
        toolbarTooltipPosition &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] leading-none text-background shadow-sm"
            style={{
              left: toolbarTooltipPosition.left,
              top: toolbarTooltipPosition.top,
              transform:
                toolbarTooltipPosition.placement === 'top'
                  ? 'translate(-50%, -100%)'
                  : 'translate(-50%, 0)',
            }}
          >
            {hoveredToolbarLabel}
          </div>,
          document.body,
        )}
      {currentUrl ? (
        <div className="flex min-h-0 flex-1 flex-col bg-background">
          {isDeviceToolbarVisible && (
            <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-2 text-xs text-secondary">
              <span className="shrink-0 text-foreground">{t('artifactBrowserDeviceSize')}</span>
              <select
                value={devicePresetId}
                onChange={event => handleDevicePresetChange(event.target.value)}
                className="h-7 w-[176px] rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                title={t('artifactBrowserDevicePreset')}
              >
                {BROWSER_DEVICE_PRESETS.map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {getBrowserDevicePresetLabel(preset)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={BrowserDeviceViewport.MinSize}
                max={BrowserDeviceViewport.MaxSize}
                value={deviceWidth}
                onChange={event => handleDeviceWidthChange(event.target.value)}
                className="h-7 w-[72px] rounded-md border border-border bg-surface px-2 text-center text-xs text-foreground outline-none focus:border-primary"
                aria-label={t('artifactBrowserDeviceWidth')}
                title={t('artifactBrowserDeviceWidth')}
              />
              <span className="text-muted">x</span>
              <input
                type="number"
                min={BrowserDeviceViewport.MinSize}
                max={BrowserDeviceViewport.MaxSize}
                value={deviceHeight}
                onChange={event => handleDeviceHeightChange(event.target.value)}
                className="h-7 w-[72px] rounded-md border border-border bg-surface px-2 text-center text-xs text-foreground outline-none focus:border-primary"
                aria-label={t('artifactBrowserDeviceHeight')}
                title={t('artifactBrowserDeviceHeight')}
              />
              <button
                type="button"
                onClick={handleRotateDevice}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground"
                title={t('artifactBrowserDeviceRotate')}
              >
                <RotateDeviceIcon />
              </button>
              <select
                value={deviceScale}
                onChange={event => handleDeviceScaleChange(event.target.value)}
                className="h-7 w-[82px] rounded-md border border-border bg-transparent px-2 text-xs text-secondary outline-none hover:bg-surface hover:text-foreground focus:border-primary"
                title={t('artifactBrowserDeviceScale')}
              >
                {BROWSER_DEVICE_SCALE_OPTIONS.map(scale => (
                  <option key={scale} value={scale}>
                    {Math.round(scale * 100)}%
                  </option>
                ))}
              </select>
              <span className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => setIsDeviceToolbarVisible(false)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground"
                title={t('artifactBrowserHideDeviceToolbar')}
              >
                <CloseIcon />
              </button>
            </div>
          )}
          <div
            className={`min-h-0 flex-1 overflow-auto ${isDeviceToolbarVisible ? 'bg-surface px-5 py-4' : 'bg-white'}`}
          >
            <div
              className={
                isDeviceToolbarVisible ? 'mx-auto overflow-hidden shadow-sm' : 'h-full w-full'
              }
              style={
                isDeviceToolbarVisible
                  ? {
                      width: deviceWidth * deviceScale,
                      height: deviceHeight * deviceScale,
                    }
                  : undefined
              }
            >
              <div
                className="h-full w-full origin-top-left bg-white"
                style={
                  isDeviceToolbarVisible
                    ? {
                        width: deviceWidth,
                        height: deviceHeight,
                        transform: `scale(${deviceScale})`,
                      }
                    : undefined
                }
              >
                {React.createElement('webview', {
                  ref: handleWebviewRef,
                  src: BrowserPageUrl.Blank,
                  partition: ArtifactBrowserPartition.Default,
                  className: 'h-full w-full bg-white',
                  allowpopups: 'false',
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="text-xs text-muted">{t('artifactBrowserLocalServices')}</div>
              <button
                type="button"
                onClick={loadLocalServices}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title={t('artifactBrowserLocalServicesRefresh')}
                disabled={isLoadingLocalServices}
              >
                <RefreshIcon />
              </button>
            </div>
            {localServices.length > 0 ? (
              <div className="space-y-2">
                {localServices.map(service => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleOpenLocalService(service)}
                    className="group flex w-full items-center gap-3 rounded-lg border border-border bg-background p-2 text-left transition-colors hover:border-primary/35 hover:bg-surface"
                  >
                    <div className="flex h-[52px] w-[84px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
                      <div className="flex h-3 items-center gap-1 border-b border-border px-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
                        <span className="h-1.5 w-1.5 rounded-full bg-yellow-400/70" />
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400/70" />
                      </div>
                      <div className="flex flex-1 items-center px-2 text-[8px] leading-tight text-muted">
                        <span className="line-clamp-2">{service.title}</span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {service.title}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {service.host}:{service.port}
                      </div>
                    </div>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${service.online ? 'bg-emerald-400' : 'bg-muted'}`}
                      title={service.online ? t('artifactBrowserLocalServiceOnline') : undefined}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                {isLoadingLocalServices
                  ? t('artifactBrowserLocalServicesLoading')
                  : t('artifactBrowserLocalServicesEmpty')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const FolderIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" />
  </svg>
);

const BrowserIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
    <path d="M2 8h12" />
  </svg>
);

const AnnotateIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 2.25c3.35 0 6 2.2 6 5.05 0 2.84-2.65 5.05-6 5.05-.7 0-1.36-.1-1.98-.29L3.55 13.5c-.46.27-.96-.23-.69-.69l1.06-1.82C2.74 10.08 2 8.79 2 7.3c0-2.85 2.65-5.05 6-5.05z" />
    <path d="M8 5.75v3.5M6.25 7.5h3.5" />
  </svg>
);

const ScreenshotIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5.25 4.25l.55-1.1A1.5 1.5 0 017.14 2.3h1.72a1.5 1.5 0 011.34.85l.55 1.1h1.75A1.5 1.5 0 0114 5.75v6A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.75v-6a1.5 1.5 0 011.5-1.5h1.75z" />
    <circle cx="8" cy="8.6" r="2.3" />
  </svg>
);

const ScreenshotCopiedIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 8.2l3 3 6-6.4" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 3L5 8l5 5" />
  </svg>
);

const ChevronRightBrowserIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 3l5 5-5 5" />
  </svg>
);

const StopIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4.25 4.25h7.5v7.5h-7.5z" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 9v3.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 012 12.5v-7A1.5 1.5 0 013.5 4H7" />
    <path d="M10 2h4v4" />
    <path d="M7 9l7-7" />
  </svg>
);

const ShareIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="4" cy="8" r="1.8" />
    <circle cx="11.5" cy="4" r="1.8" />
    <circle cx="11.5" cy="12" r="1.8" />
    <path d="M5.6 7.15l4.3-2.3" />
    <path d="M5.6 8.85l4.3 2.3" />
  </svg>
);

const MoreHorizontalToolbarIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="8.6" r="1.15" />
    <circle cx="8" cy="8.6" r="1.15" />
    <circle cx="12" cy="8.6" r="1.15" />
  </svg>
);

const FileListIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4.5 2.881c0-.644.522-1.167 1.167-1.167h2.552c.323 0 .635.117.878.33l.58.507c.243.213.555.33.877.33h3.351c.736 0 1.333.597 1.333 1.333v5.945c0 .49-.398.889-.889.889" />
    <path d="M1.143 6.476c0-.736.597-1.333 1.333-1.333h2.314c.323 0 .635.117.878.33l.58.507c.242.213.554.33.877.33h3.351c.736 0 1.333.597 1.333 1.334v4.833c0 .736-.597 1.333-1.333 1.333H2.476c-.736 0-1.333-.597-1.333-1.333V6.476z" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13.5 8a5.5 5.5 0 01-9.55 3.75" />
    <path d="M2.5 8a5.5 5.5 0 019.55-3.75" />
    <path d="M12.05 1.25v3h-3" />
    <path d="M3.95 14.75v-3h3" />
  </svg>
);

const MoreVerticalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="8" cy="3.5" r="1.1" />
    <circle cx="8" cy="8" r="1.1" />
    <circle cx="8" cy="12.5" r="1.1" />
  </svg>
);

const MinusIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 8h8" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M8 4v8" />
    <path d="M4 8h8" />
  </svg>
);

const RotateDeviceIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5.5 2.5h5A1.5 1.5 0 0112 4v8a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 014 12V4a1.5 1.5 0 011.5-1.5z" />
    <path d="M7 4h2" />
    <path d="M7.5 12h1" />
    <path d="M14 8a6 6 0 01-1.76 4.24" />
    <path d="M13.5 9.9L12.24 12.24 9.9 11" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
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

export default ArtifactPanel;
