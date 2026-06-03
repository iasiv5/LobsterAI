import {
  DocumentArrowDownIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import type { CoworkImageAttachmentPreview } from '../../../shared/cowork/imageAttachments';
import {
  type CoworkSelectedTextSnippet,
  CoworkSelectedTextSource,
  type CoworkSelectedTextValidationError,
  normalizeCoworkSelectedTextSnippets,
} from '../../../shared/cowork/selectedText';
import { dedupeArtifactsForDisplay, normalizeFilePathForDedup, normalizeLocalServiceUrlForDedup, parseFileLinksFromMessage, parseFilePathsFromText, parseLocalServiceUrlsFromText, parseMediaTokensFromText, parseRemoteImageArtifactsFromText, parseToolArtifact, parseToolResultMediaArtifacts, shouldParseFilePathsFromToolResult, stripFileLinksFromText } from '../../services/artifactParser';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import {
  selectCurrentMessagesLength,
  selectCurrentSession,
  selectIsStreaming,
  selectLastMessageContent,
  selectRemoteManaged,
} from '../../store/selectors/coworkSelectors';
import {
  activateArtifactBrowserTab,
  activateArtifactFileListTab,
  activateArtifactPreviewTab,
  addArtifact,
  type ArtifactPreviewTab,
  ArtifactSpecialTab,
  closeArtifactPreviewTab,
  closePanel,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  selectActivePreviewTab,
  selectIsPanelOpen,
  selectPanelWidth,
  togglePanel,
} from '../../store/slices/artifactSlice';
import { addDraftSelectedTextSnippet } from '../../store/slices/coworkSlice';
import { setActiveKitIds } from '../../store/slices/kitSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import type { Artifact } from '../../types/artifact';
import { ArtifactTypeValue, PREVIEWABLE_ARTIFACT_TYPES } from '../../types/artifact';
import type { CoworkImageAttachment, CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import type { MediaAttachmentRef } from '../../types/mediaGeneration';
import { ArtifactPanel, type BrowserAnnotationPayload } from '../artifacts';
import ComposeIcon from '../icons/ComposeIcon';
import FileTypeIcon from '../icons/fileTypes/FileTypeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import AssistantTurnBlock, { ContextCompactionDivider } from './AssistantTurnBlock';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from './constants';
import ContextUsageIndicator from './ContextUsageIndicator';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import LazyRenderTurn, { clearHeightCache } from './LazyRenderTurn';
import {
  buildConversationTurns,
  buildDisplayItems,
  COWORK_DETAIL_CONTENT_CLASS,
  COWORK_DETAIL_GUTTER_CLASS,
  hasRenderableAssistantContent,
} from './messageDisplayUtils';
import UserMessageItem from './UserMessageItem';
interface CoworkSessionDetailProps {
  onManageSkills?: () => void;
  onManageKits?: () => void;
  onContinue: (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[], mediaReferences?: MediaAttachmentRef[], selectedTextSnippets?: CoworkSelectedTextSnippet[]) => boolean | void | Promise<boolean | void>;
  onStop: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const AUTO_SCROLL_THRESHOLD = 120;
const NAV_SCROLL_LOCK_DURATION = 800;
const NAV_BOTTOM_SNAP_THRESHOLD = 20;
const ARTIFACT_PANEL_TRANSITION_MS = 200;
const ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH = 4;
const COWORK_DETAIL_MIN_WIDTH = 480;
const ARTIFACT_PANEL_MIN_WIDTH_RATIO = 1 / 6;
const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const SELECTED_TEXT_ACTION_HALF_WIDTH = 72;
const SELECTED_TEXT_ACTION_SUPPRESS_MS = 250;
type SelectedAssistantTextRange = {
  text: string;
  sourceMessageId: string;
  rect: DOMRect;
};
const SELECTED_TEXT_ERROR_I18N_KEYS: Record<CoworkSelectedTextValidationError, string> = {
  empty: 'coworkSelectedTextInvalid',
  invalid: 'coworkSelectedTextInvalid',
  too_long: 'coworkSelectedTextTooLong',
  too_many: 'coworkSelectedTextTooMany',
  total_too_long: 'coworkSelectedTextTotalTooLong',
  duplicate: 'coworkSelectedTextDuplicate',
};

const extractBase64FromDataUrl = (dataUrl: string): { mimeType: string; base64Data: string } | null => {
  const match = /^data:(.+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
};

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const formatExportTimestamp = (value: Date): string => {
  const pad = (num: number): string => String(num).padStart(2, '0');
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
};

const logDetailDiagnostic = (message: string): void => {
  console.log(`[CoworkSessionDetail] ${message}`);
  window.electron?.log?.fromRenderer?.('info', 'CoworkSessionDetail', message);
};

const getSelectedAssistantTextRange = (): SelectedAssistantTextRange | null => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.parentElement;
  const endElement = range.endContainer.parentElement;
  const startMessage = startElement?.closest<HTMLElement>('[data-cowork-assistant-message-id]');
  const endMessage = endElement?.closest<HTMLElement>('[data-cowork-assistant-message-id]');
  const sourceMessageId = startMessage?.dataset.coworkAssistantMessageId;
  const text = selection.toString().trim();
  if (!sourceMessageId || startMessage !== endMessage || !text) {
    return null;
  }
  return {
    text,
    sourceMessageId,
    rect: range.getBoundingClientRect(),
  };
};

const getSelectedTextActionLeft = (rect: DOMRect, container: HTMLDivElement): number => {
  const containerRect = container.getBoundingClientRect();
  const selectionCenterX = rect.left - containerRect.left + rect.width / 2;
  return Math.min(
    container.clientWidth - SELECTED_TEXT_ACTION_HALF_WIDTH,
    Math.max(SELECTED_TEXT_ACTION_HALF_WIDTH, selectionCenterX),
  );
};

const getSelectedTextActionTop = (
  rect: DOMRect,
  container: HTMLDivElement,
): number => {
  const containerRect = container.getBoundingClientRect();
  const rawTop = container.scrollTop + rect.top - containerRect.top - 42;
  const minTop = container.scrollTop + 8;
  const maxTop = container.scrollTop + container.clientHeight - 48;
  return Math.min(maxTop, Math.max(minTop, rawTop));
};

type CaptureRect = { x: number; y: number; width: number; height: number };

const MAX_EXPORT_CANVAS_HEIGHT = 32760;
const MAX_EXPORT_SEGMENTS = 240;

const waitForNextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const loadImageFromBase64 = (pngBase64: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode captured image'));
    img.src = `data:image/png;base64,${pngBase64}`;
  });

const domRectToCaptureRect = (rect: DOMRect): CaptureRect => ({
  x: Math.max(0, Math.round(rect.x)),
  y: Math.max(0, Math.round(rect.y)),
  width: Math.max(0, Math.round(rect.width)),
  height: Math.max(0, Math.round(rect.height)),
});

/** Format a date as "YYYY年MM月DD日" for the export header. */
const formatExportDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
};

/** Draw a rounded-rectangle path (for card clipping / filling). */
const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
};

/**
 * Compose a final export canvas with a rounded-card layout:
 *   outer background → rounded card → header (title + date) → content → footer (logo + tagline)
 */
const composeExportCanvas = async (
  contentCanvas: HTMLCanvasElement,
  title: string,
  createdAt: number,
): Promise<HTMLCanvasElement> => {
  const isDark = document.documentElement.classList.contains('dark');
  const dpr = window.devicePixelRatio || 1;
  const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  const contentW = contentCanvas.width;   // CSS px
  const contentH = contentCanvas.height;  // CSS px

  // ── Layout constants (CSS px) ──
  const outerPadX = 24;          // horizontal breathing room around card
  const outerPadTop = 28;        // top breathing room
  const outerPadBottom = 28;     // bottom breathing room
  const cardRadius = 16;         // card corner radius
  const cardInnerPadX = 28;      // text indent inside card
  const headerHeight = 80;       // header area inside card
  const footerHeight = 80;       // footer area inside card
  const dividerThick = 1;
  const logoCssSize = 34;

  // ── Colors ──
  const outerBg = isDark ? '#111111' : '#f0f0f0';
  const cardBg = isDark ? '#1e1e1e' : '#ffffff';
  const cardShadowColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)';
  const titleColor = isDark ? '#eeeeee' : '#1a1a1a';
  const dateColor = isDark ? '#888888' : '#999999';
  const dividerColor = isDark ? '#2a2a2a' : '#ebebeb';
  const brandColor = isDark ? '#e0e0e0' : '#1a1a1a';
  const subtitleColor = isDark ? '#888888' : '#888888';

  // ── Compute dimensions ──
  const cardW = contentW;
  const cardH = headerHeight + dividerThick + contentH + dividerThick + footerHeight;
  const totalW = cardW + outerPadX * 2;
  const totalH = cardH + outerPadTop + outerPadBottom;

  const final = document.createElement('canvas');
  final.width = Math.round(totalW * dpr);
  final.height = Math.round(totalH * dpr);
  const ctx = final.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.scale(dpr, dpr);

  // ── Outer background ──
  ctx.fillStyle = outerBg;
  ctx.fillRect(0, 0, totalW, totalH);

  // ── Card shadow ──
  ctx.save();
  ctx.shadowColor = cardShadowColor;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = cardBg;
  roundRectPath(ctx, outerPadX, outerPadTop, cardW, cardH, cardRadius);
  ctx.fill();
  ctx.restore();

  // ── Clip to card bounds so content doesn't bleed past rounded corners ──
  ctx.save();
  roundRectPath(ctx, outerPadX, outerPadTop, cardW, cardH, cardRadius);
  ctx.clip();

  // card-local origin helpers
  const cx = outerPadX;           // card left
  const cy = outerPadTop;         // card top

  // ── Header ──
  const titleFontSize = 17;
  const dateFontSize = 12;
  ctx.textBaseline = 'middle';

  // Title
  ctx.fillStyle = titleColor;
  ctx.font = `600 ${titleFontSize}px ${fontStack}`;
  const maxTitleW = cardW - cardInnerPadX * 2;
  let displayTitle = title || 'Cowork Session';
  if (ctx.measureText(displayTitle).width > maxTitleW) {
    while (displayTitle.length > 1 && ctx.measureText(displayTitle + '…').width > maxTitleW) {
      displayTitle = displayTitle.slice(0, -1);
    }
    displayTitle += '…';
  }
  const headerCenterY = cy + headerHeight / 2;
  ctx.fillText(displayTitle, cx + cardInnerPadX, headerCenterY - dateFontSize / 2 - 3);

  // Date
  ctx.fillStyle = dateColor;
  ctx.font = `400 ${dateFontSize}px ${fontStack}`;
  ctx.fillText(formatExportDate(createdAt), cx + cardInnerPadX, headerCenterY + titleFontSize / 2 + 3);

  // ── Top divider ──
  ctx.fillStyle = dividerColor;
  ctx.fillRect(cx + cardInnerPadX, cy + headerHeight, cardW - cardInnerPadX * 2, dividerThick);

  // ── Content ──
  const contentY = cy + headerHeight + dividerThick;
  ctx.drawImage(contentCanvas, cx, contentY, contentW, contentH);

  // ── Bottom divider ──
  const bottomDivY = contentY + contentH;
  ctx.fillStyle = dividerColor;
  ctx.fillRect(cx + cardInnerPadX, bottomDivY, cardW - cardInnerPadX * 2, dividerThick);

  // ── Footer ──
  const footerTop = bottomDivY + dividerThick;
  const footerCenterY = footerTop + footerHeight / 2;

  // Load logo
  const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load logo'));
    img.src = 'logo.png';
  });

  // Logo with rounded clipping
  const logoX = cx + cardInnerPadX;
  const logoY = footerCenterY - logoCssSize / 2;
  const logoRadius = 8;
  ctx.save();
  roundRectPath(ctx, logoX, logoY, logoCssSize, logoCssSize, logoRadius);
  ctx.clip();
  ctx.drawImage(logoImg, logoX, logoY, logoCssSize, logoCssSize);
  ctx.restore();

  // Re-clip to card (previous clip was consumed by logo)
  ctx.save();
  roundRectPath(ctx, outerPadX, outerPadTop, cardW, cardH, cardRadius);
  ctx.clip();

  // Brand text
  const textX = logoX + logoCssSize + 12;
  const brandFontSize = 13;
  const taglineFontSize = 11;

  ctx.fillStyle = brandColor;
  ctx.font = `600 ${brandFontSize}px ${fontStack}`;
  ctx.fillText('LobsterAI — 全场景个人助理 Agent', textX, footerCenterY - taglineFontSize / 2 - 2);

  ctx.fillStyle = subtitleColor;
  ctx.font = `400 ${taglineFontSize}px ${fontStack}`;
  ctx.fillText('7×24 小时帮你干活的全场景个人助理，由网易有道开发', textX, footerCenterY + brandFontSize / 2 + 3);

  ctx.restore(); // card clip

  return final;
};

const ArtifactPanelIcon: React.FC<React.SVGProps<SVGSVGElement> & { open?: boolean }> = ({ open, ...props }) => {
  const dividerX = open ? 10.5 : 12.5;
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <line x1={dividerX} y1="2" x2={dividerX} y2="14" />
    </svg>
  );
};

const ArtifactTabCloseIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...props}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
);

const ArtifactTabPlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...props}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

const ArtifactBrowserTabIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
    <path d="M2 8h12" />
  </svg>
);

class ArtifactPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('[ArtifactPanel] render error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <aside className="w-[420px] shrink-0 border-l border-border bg-background flex flex-col h-full items-center justify-center p-4">
          <p className="text-sm text-red-500 mb-2">Artifact panel error</p>
          <pre className="text-xs text-muted whitespace-pre-wrap max-w-full overflow-auto mb-3">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); this.props.onClose(); }}
            className="px-3 py-1.5 text-xs rounded-lg bg-surface hover:bg-surface-hover text-foreground"
          >
            Close
          </button>
        </aside>
      );
    }
    return this.props.children;
  }
}

// Streaming activity bar shown between messages and input
const StreamingActivityBar: React.FC<{ messages: CoworkMessage[]; isContextMaintenance?: boolean }> = ({
  messages,
  isContextMaintenance = false,
}) => {
  // Walk messages backwards to find the latest tool_use without a paired tool_result
  const getStatusText = (): string => {
    if (isContextMaintenance) {
      return i18nService.t('coworkContextMaintenanceRunning');
    }
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();
    for (const msg of messages) {
      const id = msg.metadata?.toolUseId;
      if (typeof id === 'string') {
        if (msg.type === 'tool_result') toolResultIds.add(id);
        if (msg.type === 'tool_use') toolUseIds.add(id);
      }
    }
    // Walk backwards to find latest unresolved tool_use
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'tool_use') {
        const id = msg.metadata?.toolUseId;
        if (typeof id === 'string' && !toolResultIds.has(id)) {
          const toolName = typeof msg.metadata?.toolName === 'string' ? msg.metadata.toolName : null;
          if (toolName) {
            return `${i18nService.t('coworkToolRunning')} ${toolName}...`;
          }
        }
      }
    }
    return `${i18nService.t('coworkToolRunning')}`;
  };

  return (
    <div className={`shrink-0 animate-fade-in ${COWORK_DETAIL_GUTTER_CLASS}`}>
      <div className={COWORK_DETAIL_CONTENT_CLASS}>
        <div className="streaming-bar" />
        <div className="py-1">
          <span className="text-xs text-secondary">
            {getStatusText()}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Path resolution utilities (used by resolveLocalFilePath) ─────────────────

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const stripHashAndQuery = (value: string): string => value.split('#')[0].split('?')[0];

const stripFileProtocol = (value: string): string => {
  let cleaned = value.replace(/^file:\/\//i, '');
  if (/^\/[A-Za-z]:/.test(cleaned)) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
};

const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(value);

const isAbsolutePath = (value: string): boolean => (
  value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
);

const isRelativePath = (value: string): boolean => !isAbsolutePath(value) && !hasScheme(value);

const parseRootRelativePath = (value: string): string | null => {
  const trimmed = value.trim();
  if (!/^file:\/\//i.test(trimmed)) return null;
  const separatorIndex = trimmed.indexOf('::');
  if (separatorIndex < 0) return null;

  const rootPart = trimmed.slice(0, separatorIndex);
  const relativePart = trimmed.slice(separatorIndex + 2);
  if (!relativePart.trim()) return null;

  const rootPath = safeDecodeURIComponent(stripFileProtocol(stripHashAndQuery(rootPart)));
  const relativePath = safeDecodeURIComponent(stripHashAndQuery(relativePart));
  if (!rootPath || !relativePath) return null;

  const normalizedRoot = rootPath.replace(/[\\/]+$/, '');
  const normalizedRelative = relativePath.replace(/^[\\/]+/, '');
  if (!normalizedRelative) return null;

  return `${normalizedRoot}/${normalizedRelative}`;
};

const normalizeLocalPath = (
  value: string
): { path: string; isRelative: boolean; isAbsolute: boolean } | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fileScheme = /^file:\/\//i.test(trimmed);
  const schemePresent = hasScheme(trimmed);
  if (schemePresent && !fileScheme && !isAbsolutePath(trimmed)) return null;

  let raw = trimmed;
  if (fileScheme) {
    raw = stripFileProtocol(raw);
  }
  raw = stripHashAndQuery(raw);
  const decoded = safeDecodeURIComponent(raw);
  const path = decoded || raw;
  if (!path) return null;

  const isAbsolute = isAbsolutePath(path);
  const isRelative = isRelativePath(path);
  return { path, isRelative, isAbsolute };
};

const toAbsolutePathFromCwd = (filePath: string, cwd: string): string => {
  if (isAbsolutePath(filePath)) {
    return filePath;
  }
  return `${cwd.replace(/\/$/, '')}/${filePath.replace(/^\.\//, '')}`;
};

const EMPTY_ARTIFACTS: Artifact[] = [];
const EMPTY_PREVIEW_TABS: ArtifactPreviewTab[] = [];

const CoworkSessionDetail: React.FC<CoworkSessionDetailProps> = ({
  onManageSkills,
  onManageKits,
  onContinue,
  onStop,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const dispatch = useDispatch();
  const isMac = window.electron.platform === 'darwin';
  const currentSession = useSelector(selectCurrentSession);
  const isStreaming = useSelector(selectIsStreaming);
  const remoteManaged = useSelector(selectRemoteManaged);
  const lastMessageContent = useSelector(selectLastMessageContent);
  const messagesLength = useSelector(selectCurrentMessagesLength);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const marketplaceKits = useSelector((state: RootState) => state.kit.marketplaceKits);
  const selectedDraftSnippets = useSelector((state: RootState) =>
    currentSession?.id ? state.cowork.draftSelectedTextSnippets[currentSession.id] ?? [] : []
  );
  const contextUsage = useSelector((state: RootState) =>
    currentSession?.id ? state.cowork.contextUsageBySessionId[currentSession.id] : undefined
  );
  const isContextCompacting = useSelector((state: RootState) =>
    currentSession?.id ? state.cowork.compactingSessionIds.includes(currentSession.id) : false
  );
  const isContextMaintenance = useSelector((state: RootState) =>
    currentSession?.id ? state.cowork.contextMaintenanceSessionIds.includes(currentSession.id) : false
  );
  const isContextBusy = isContextCompacting || isContextMaintenance;
  const isSessionBusy = isStreaming || isContextMaintenance;
  const detailRootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<CoworkPromptInputRef>(null);
  const compactConfirmRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [showCompactConfirm, setShowCompactConfirm] = useState(false);
  const [selectedTextAction, setSelectedTextAction] = useState<{
    text: string;
    sourceMessageId: string;
    left: number;
    top: number;
  } | null>(null);
  const isLoadingMoreMessagesRef = useRef(false);
  const prevScrollHeightRef = useRef<number | null>(null);
  const suppressSelectedTextActionUntilRef = useRef(0);

  const closeSelectedTextAction = useCallback((options: {
    clearSelection?: boolean;
    suppressNextMouseUp?: boolean;
  } = {}) => {
    if (options.suppressNextMouseUp) {
      suppressSelectedTextActionUntilRef.current = Date.now() + SELECTED_TEXT_ACTION_SUPPRESS_MS;
    }
    if (options.clearSelection) {
      window.getSelection()?.removeAllRanges();
    }
    setSelectedTextAction(null);
  }, []);

  const syncSelectedTextActionPosition = useCallback((options: {
    closeWhenMissing?: boolean;
  } = {}) => {
    const selectedRange = getSelectedAssistantTextRange();
    if (!selectedRange) {
      if (options.closeWhenMissing) {
        closeSelectedTextAction();
      }
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      closeSelectedTextAction();
      return;
    }
    setSelectedTextAction({
      text: selectedRange.text,
      sourceMessageId: selectedRange.sourceMessageId,
      left: getSelectedTextActionLeft(selectedRange.rect, container),
      top: getSelectedTextActionTop(selectedRange.rect, container),
    });
  }, [closeSelectedTextAction]);

  // Clear lazy-render height cache when session changes
  const sessionId = currentSession?.id;
  useEffect(() => {
    clearHeightCache();
  }, [sessionId]);

  useEffect(() => {
    setShowCompactConfirm(false);
    closeSelectedTextAction({ clearSelection: true });
  }, [closeSelectedTextAction, sessionId]);

  useEffect(() => {
    if (!selectedTextAction) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-cowork-selected-text-action]')) {
        return;
      }
      closeSelectedTextAction({ clearSelection: true, suppressNextMouseUp: true });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSelectedTextAction({ clearSelection: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeSelectedTextAction, selectedTextAction]);

  useEffect(() => {
    if (!showCompactConfirm) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && compactConfirmRef.current?.contains(target)) {
        return;
      }
      setShowCompactConfirm(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCompactConfirm(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showCompactConfirm]);

  // Rail navigation states
  const [currentRailIndex, setCurrentRailIndex] = useState(-1);
  const currentRailIndexRef = useRef(-1);
  const railItemCountRef = useRef(0);
  // Mapping: turnIndex → { first: firstRailIdx, last: lastRailIdx }
  const turnToRailRangeRef = useRef<{ first: number; last: number }[]>([]);
  const isNavigatingRef = useRef(false);
  const navigatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnElsCacheRef = useRef<HTMLElement[]>([]);
  const railLinesRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const [hoveredRailIndex, setHoveredRailIndex] = useState<number | null>(null);
  const [isRailHovered, setIsRailHovered] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{ label: string; top: number; right: number; isUser: boolean } | null>(null);

  // Export states
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);

  useEffect(() => {
    setShouldAutoScroll(true);
  }, [currentSession?.id]);

  const handleCompactContext = useCallback(() => {
    if (!currentSession?.id) {
      console.warn('[CoworkSessionDetail] manual context compaction was ignored because no session is selected.');
      return;
    }
    if (isContextBusy) {
      console.debug('[CoworkSessionDetail] manual context compaction was ignored because compaction is already running.');
      return;
    }
    if (isSessionBusy || currentSession.status === CoworkSessionStatusValue.Running) {
      console.debug('[CoworkSessionDetail] manual context compaction was ignored because the session is still running.');
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkContextCompactBlockedRunning'),
      }));
      return;
    }
    console.debug('[CoworkSessionDetail] manual context compaction confirmation toggled.');
    setShowCompactConfirm(prev => !prev);
  }, [currentSession?.id, currentSession?.status, isContextBusy, isSessionBusy]);

  const handleCancelCompactContext = useCallback(() => {
    console.debug('[CoworkSessionDetail] manual context compaction was canceled by the user.');
    setShowCompactConfirm(false);
  }, []);

  const handleConfirmCompactContext = useCallback(() => {
    if (!currentSession?.id) {
      setShowCompactConfirm(false);
      console.warn('[CoworkSessionDetail] manual context compaction confirmation was ignored because no session is selected.');
      return;
    }
    console.log(`[CoworkSessionDetail] manual context compaction confirmed for session ${currentSession.id}.`);
    setShowCompactConfirm(false);
    void coworkService.compactContext(currentSession.id);
  }, [currentSession?.id]);

  const handleForkMessage = useCallback((messageId: string) => {
    if (!currentSession?.id) {
      console.warn('[CoworkFork] message fork was ignored because no session is selected');
      return;
    }
    if (isStreaming || currentSession.status === CoworkSessionStatusValue.Running) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkForkRunningBlocked'),
      }));
      console.warn('[CoworkFork] message fork was rejected because the session is still running');
      return;
    }

    console.log(`[CoworkFork] requesting a fork from assistant message ${messageId} in session ${currentSession.id}`);
    void coworkService.forkSession({
      sessionId: currentSession.id,
      forkedFromMessageId: messageId,
    });
  }, [currentSession?.id, currentSession?.status, isStreaming]);

  const handleAssistantTextSelection = useCallback(() => {
    if (remoteManaged) return;
    if (Date.now() < suppressSelectedTextActionUntilRef.current) {
      return;
    }
    suppressSelectedTextActionUntilRef.current = 0;
    syncSelectedTextActionPosition({ closeWhenMissing: true });
  }, [remoteManaged, syncSelectedTextActionPosition]);

  const handleAddSelectedText = useCallback(() => {
    if (!currentSession?.id || !selectedTextAction) return;
    const snippet: CoworkSelectedTextSnippet = {
      id: `selected-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: selectedTextAction.text,
      sourceMessageId: selectedTextAction.sourceMessageId,
      sourceMessageType: CoworkSelectedTextSource.AssistantMessage,
      createdAt: Date.now(),
    };
    const result = normalizeCoworkSelectedTextSnippets([...selectedDraftSnippets, snippet]);
    if (result.success === false) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t(SELECTED_TEXT_ERROR_I18N_KEYS[result.error]),
      }));
      return;
    }
    dispatch(addDraftSelectedTextSnippet({ draftKey: currentSession.id, snippet }));
    logDetailDiagnostic(
      `added a selected text excerpt to the draft for session ${currentSession.id}; `
      + `${result.snippets.length} excerpts now contain ${result.snippets.reduce((total, item) => total + item.text.length, 0)} characters`,
    );
    closeSelectedTextAction({ clearSelection: true });
    promptInputRef.current?.focus();
  }, [closeSelectedTextAction, currentSession?.id, dispatch, selectedDraftSnippets, selectedTextAction]);

  const handleLocateSelectedText = useCallback((sourceMessageId: string) => {
    const container = scrollContainerRef.current;
    const element = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-cowork-assistant-message-id]') ?? [],
    ).find(candidate => candidate.dataset.coworkAssistantMessageId === sourceMessageId);
    if (!element) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkSelectedTextSourceUnavailable'),
      }));
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('ring-2', 'ring-primary/50', 'rounded-lg');
    window.setTimeout(() => {
      element.classList.remove('ring-2', 'ring-primary/50', 'rounded-lg');
    }, 1600);
  }, []);

  // ─── Artifact detection ─────────────────────────────────────────────
  const isPanelOpen = useSelector((state: RootState) => selectIsPanelOpen(state, sessionId));
  const panelWidth = useSelector(selectPanelWidth);
  const [shouldRenderArtifactPanel, setShouldRenderArtifactPanel] = useState(isPanelOpen);
  const [isArtifactPanelVisible, setIsArtifactPanelVisible] = useState(isPanelOpen);
  const [isArtifactPanelTransitioning, setIsArtifactPanelTransitioning] = useState(false);
  const [isFileListPreviewTabOpen, setIsFileListPreviewTabOpen] = useState(isPanelOpen);
  const [isBrowserPreviewTabOpen, setIsBrowserPreviewTabOpen] = useState(false);
  const [activeSpecialPreviewTab, setActiveSpecialPreviewTab] = useState<ArtifactSpecialTab>(ArtifactSpecialTab.FileList);
  const [browserPreviewAddress, setBrowserPreviewAddress] = useState('');
  const [browserPreviewUrl, setBrowserPreviewUrl] = useState('');
  const [showArtifactAddMenu, setShowArtifactAddMenu] = useState(false);
  const [artifactAddMenuPosition, setArtifactAddMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [artifactTabsCanScrollLeft, setArtifactTabsCanScrollLeft] = useState(false);
  const [artifactTabsCanScrollRight, setArtifactTabsCanScrollRight] = useState(false);
  const [artifactTabsIsOverflowing, setArtifactTabsIsOverflowing] = useState(false);
  const [artifactPanelMinWidth, setArtifactPanelMinWidth] = useState(MIN_PANEL_WIDTH);
  const [artifactPanelMaxWidth, setArtifactPanelMaxWidth] = useState(MAX_PANEL_WIDTH);
  const previousArtifactPanelOpenRef = useRef(isPanelOpen);
  const fileListPreviewTabOpenBySessionRef = useRef<Record<string, boolean>>({});
  const browserPreviewTabOpenBySessionRef = useRef<Record<string, boolean>>({});
  const activeSpecialPreviewTabBySessionRef = useRef<Record<string, ArtifactSpecialTab>>({});
  const browserPreviewAddressBySessionRef = useRef<Record<string, string>>({});
  const browserPreviewUrlBySessionRef = useRef<Record<string, string>>({});
  const artifactAddButtonRef = useRef<HTMLButtonElement>(null);
  const artifactAddMenuRef = useRef<HTMLDivElement>(null);
  const artifactTabsScrollRef = useRef<HTMLDivElement>(null);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const rawSessionArtifacts = useSelector((state: RootState) =>
    sessionId ? state.artifact.artifactsBySession[sessionId] ?? EMPTY_ARTIFACTS : EMPTY_ARTIFACTS
  );
  const sessionArtifacts = useMemo(
    () => dedupeArtifactsForDisplay(rawSessionArtifacts),
    [rawSessionArtifacts],
  );
  const artifactPreviewTabs = useSelector((state: RootState) =>
    sessionId ? state.artifact.previewTabsBySession[sessionId] ?? EMPTY_PREVIEW_TABS : EMPTY_PREVIEW_TABS
  );
  const activeArtifactPreviewTab = useSelector((state: RootState) =>
    sessionId ? selectActivePreviewTab(state, sessionId) : null
  );
  const artifactTabsWithArtifacts = useMemo(() => {
    const artifactsById = new Map(sessionArtifacts.map(artifact => [artifact.id, artifact]));
    return artifactPreviewTabs
      .map(tab => ({ tab, artifact: artifactsById.get(tab.artifactId) }))
      .filter((item): item is { tab: typeof artifactPreviewTabs[number]; artifact: Artifact } => Boolean(item.artifact));
  }, [artifactPreviewTabs, sessionArtifacts]);
  const shouldPinArtifactAddTab = artifactTabsIsOverflowing || artifactTabsCanScrollLeft || artifactTabsCanScrollRight;

  const loadedFileIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let animationFrame: number | undefined;
    let transitionTimeout: number | undefined;
    const wasOpen = previousArtifactPanelOpenRef.current;

    previousArtifactPanelOpenRef.current = isPanelOpen;

    if (wasOpen === isPanelOpen) {
      return undefined;
    }

    if (isPanelOpen) {
      setShouldRenderArtifactPanel(true);
      setIsArtifactPanelVisible(false);
      setIsArtifactPanelTransitioning(true);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => {
          setIsArtifactPanelVisible(true);
          transitionTimeout = window.setTimeout(() => {
            setIsArtifactPanelTransitioning(false);
          }, ARTIFACT_PANEL_TRANSITION_MS);
        });
      });
    } else {
      setIsArtifactPanelTransitioning(true);
      setIsArtifactPanelVisible(false);
      transitionTimeout = window.setTimeout(() => {
        setShouldRenderArtifactPanel(false);
        setIsArtifactPanelTransitioning(false);
      }, ARTIFACT_PANEL_TRANSITION_MS);
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (transitionTimeout !== undefined) {
        window.clearTimeout(transitionTimeout);
      }
    };
  }, [isPanelOpen]);

  const updateArtifactPanelMaxWidth = useCallback(() => {
    const contentWidth = contentRowRef.current?.clientWidth ?? 0;
    if (contentWidth <= 0) return;
    const availablePanelWidth = contentWidth - COWORK_DETAIL_MIN_WIDTH - ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH;
    const nextMaxWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, availablePanelWidth));
    const proportionalMinWidth = Math.floor(contentWidth * ARTIFACT_PANEL_MIN_WIDTH_RATIO);
    const nextMinWidth = Math.min(nextMaxWidth, Math.max(MIN_PANEL_WIDTH, proportionalMinWidth));
    setArtifactPanelMinWidth(nextMinWidth);
    setArtifactPanelMaxWidth(nextMaxWidth);
  }, []);

  useLayoutEffect(() => {
    updateArtifactPanelMaxWidth();
    const container = contentRowRef.current;
    window.addEventListener('resize', updateArtifactPanelMaxWidth);

    if (typeof ResizeObserver === 'undefined' || !container) {
      return () => {
        window.removeEventListener('resize', updateArtifactPanelMaxWidth);
      };
    }

    const resizeObserver = new ResizeObserver(updateArtifactPanelMaxWidth);
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateArtifactPanelMaxWidth);
    };
  }, [currentSession?.id, updateArtifactPanelMaxWidth]);

  useEffect(() => {
    setIsFileListPreviewTabOpen(sessionId ? fileListPreviewTabOpenBySessionRef.current[sessionId] ?? false : false);
    setIsBrowserPreviewTabOpen(sessionId ? browserPreviewTabOpenBySessionRef.current[sessionId] ?? false : false);
    setActiveSpecialPreviewTab(sessionId
      ? activeSpecialPreviewTabBySessionRef.current[sessionId] ?? ArtifactSpecialTab.FileList
      : ArtifactSpecialTab.FileList);
    setBrowserPreviewAddress(sessionId ? browserPreviewAddressBySessionRef.current[sessionId] ?? '' : '');
    setBrowserPreviewUrl(sessionId ? browserPreviewUrlBySessionRef.current[sessionId] ?? '' : '');
    setShowArtifactAddMenu(false);
    loadedFileIdsRef.current = new Set();
  }, [sessionId]);

  const setSessionFileListPreviewTabOpen = useCallback((open: boolean) => {
    setIsFileListPreviewTabOpen(open);
    if (sessionId) {
      fileListPreviewTabOpenBySessionRef.current[sessionId] = open;
    }
  }, [sessionId]);

  const setSessionBrowserPreviewTabOpen = useCallback((open: boolean) => {
    setIsBrowserPreviewTabOpen(open);
    if (sessionId) {
      browserPreviewTabOpenBySessionRef.current[sessionId] = open;
    }
  }, [sessionId]);

  const setSessionActiveSpecialPreviewTab = useCallback((tab: ArtifactSpecialTab) => {
    setActiveSpecialPreviewTab(tab);
    if (sessionId) {
      activeSpecialPreviewTabBySessionRef.current[sessionId] = tab;
    }
  }, [sessionId]);

  const handleBrowserPreviewAddressChange = useCallback((value: string) => {
    setBrowserPreviewAddress(value);
    if (sessionId) {
      browserPreviewAddressBySessionRef.current[sessionId] = value;
    }
  }, [sessionId]);

  const handleBrowserPreviewUrlChange = useCallback((value: string) => {
    setBrowserPreviewUrl(value);
    if (sessionId) {
      browserPreviewUrlBySessionRef.current[sessionId] = value;
    }
  }, [sessionId]);

  const clearBrowserPreviewState = useCallback(() => {
    setBrowserPreviewAddress('');
    setBrowserPreviewUrl('');
    if (sessionId) {
      delete browserPreviewAddressBySessionRef.current[sessionId];
      delete browserPreviewUrlBySessionRef.current[sessionId];
    }
  }, [sessionId]);

  const handleOpenArtifactFileListTab = useCallback(() => {
    setSessionFileListPreviewTabOpen(true);
    setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.FileList);
    if (sessionId) {
      dispatch(activateArtifactFileListTab({ sessionId }));
    }
  }, [dispatch, sessionId, setSessionActiveSpecialPreviewTab, setSessionFileListPreviewTabOpen]);

  const handleActivateArtifactFileListTab = useCallback(() => {
    if (!sessionId) return;
    setSessionFileListPreviewTabOpen(true);
    setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.FileList);
    dispatch(activateArtifactFileListTab({ sessionId }));
  }, [dispatch, sessionId, setSessionActiveSpecialPreviewTab, setSessionFileListPreviewTabOpen]);

  const handleOpenArtifactBrowserTab = useCallback(() => {
    setShowArtifactAddMenu(false);
    if (!sessionId) return;
    setSessionBrowserPreviewTabOpen(true);
    setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.Browser);
    dispatch(activateArtifactBrowserTab({ sessionId }));
  }, [dispatch, sessionId, setSessionActiveSpecialPreviewTab, setSessionBrowserPreviewTabOpen]);

  const handleOpenLocalServiceArtifact = useCallback((artifact: Artifact) => {
    const url = artifact.url || artifact.content;
    if (!url) return;
    handleOpenArtifactBrowserTab();
    handleBrowserPreviewAddressChange(url);
    handleBrowserPreviewUrlChange(url);
  }, [handleBrowserPreviewAddressChange, handleBrowserPreviewUrlChange, handleOpenArtifactBrowserTab]);

  const handleOpenArtifactFileListFromMenu = useCallback(() => {
    setShowArtifactAddMenu(false);
    handleOpenArtifactFileListTab();
  }, [handleOpenArtifactFileListTab]);

  const handleCloseArtifactFileListTab = useCallback(() => {
    const wasActive = !activeArtifactPreviewTab && activeSpecialPreviewTab === ArtifactSpecialTab.FileList;
    setSessionFileListPreviewTabOpen(false);
    if (!sessionId) {
      dispatch(closePanel(undefined));
      return;
    }

    if (!wasActive) return;

    const nextTabId = artifactTabsWithArtifacts[0]?.tab.id;
    if (nextTabId) {
      dispatch(activateArtifactPreviewTab({ sessionId, tabId: nextTabId }));
      return;
    }

    if (isBrowserPreviewTabOpen) {
      setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.Browser);
      dispatch(activateArtifactBrowserTab({ sessionId }));
      return;
    }

    dispatch(closePanel({ sessionId }));
  }, [
    activeArtifactPreviewTab,
    activeSpecialPreviewTab,
    artifactTabsWithArtifacts,
    dispatch,
    isBrowserPreviewTabOpen,
    sessionId,
    setSessionActiveSpecialPreviewTab,
    setSessionFileListPreviewTabOpen,
  ]);

  const handleActivateArtifactBrowserTab = useCallback(() => {
    if (!sessionId) return;
    setSessionBrowserPreviewTabOpen(true);
    setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.Browser);
    dispatch(activateArtifactBrowserTab({ sessionId }));
  }, [dispatch, sessionId, setSessionActiveSpecialPreviewTab, setSessionBrowserPreviewTabOpen]);

  const handleCloseArtifactBrowserTab = useCallback(() => {
    const wasActive = !activeArtifactPreviewTab && activeSpecialPreviewTab === ArtifactSpecialTab.Browser;
    setSessionBrowserPreviewTabOpen(false);
    clearBrowserPreviewState();
    if (!sessionId) {
      dispatch(closePanel(undefined));
      return;
    }

    if (!wasActive) return;

    const nextTabId = artifactTabsWithArtifacts[0]?.tab.id;
    if (nextTabId) {
      dispatch(activateArtifactPreviewTab({ sessionId, tabId: nextTabId }));
      return;
    }

    if (isFileListPreviewTabOpen) {
      setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.FileList);
      dispatch(activateArtifactFileListTab({ sessionId }));
      return;
    }

    dispatch(closePanel({ sessionId }));
  }, [
    activeArtifactPreviewTab,
    activeSpecialPreviewTab,
    artifactTabsWithArtifacts,
    dispatch,
    clearBrowserPreviewState,
    isFileListPreviewTabOpen,
    sessionId,
    setSessionActiveSpecialPreviewTab,
    setSessionBrowserPreviewTabOpen,
  ]);

  const handleActivateArtifactTab = useCallback((tabId: string) => {
    if (!sessionId) return;
    dispatch(activateArtifactPreviewTab({ sessionId, tabId }));
  }, [dispatch, sessionId]);

  const handleCloseArtifactTab = useCallback((tabId: string) => {
    if (!sessionId) return;
    const remainingTabs = artifactTabsWithArtifacts.filter(({ tab }) => tab.id !== tabId);
    dispatch(closeArtifactPreviewTab({ sessionId, tabId }));
    if (remainingTabs.length === 0 && !isFileListPreviewTabOpen && !isBrowserPreviewTabOpen) {
      dispatch(closePanel({ sessionId }));
    }
  }, [artifactTabsWithArtifacts, dispatch, isBrowserPreviewTabOpen, isFileListPreviewTabOpen, sessionId]);

  const handleToggleArtifactPanel = useCallback(() => {
    if (isPanelOpen) {
      setShowArtifactAddMenu(false);
      dispatch(closePanel(sessionId ? { sessionId } : undefined));
      return;
    }

    if (!sessionId) {
      dispatch(togglePanel(undefined));
      return;
    }

    if (artifactTabsWithArtifacts.length === 0 && !isFileListPreviewTabOpen && !isBrowserPreviewTabOpen) {
      setSessionFileListPreviewTabOpen(true);
      setSessionActiveSpecialPreviewTab(ArtifactSpecialTab.FileList);
      dispatch(activateArtifactFileListTab({ sessionId }));
      return;
    }

    dispatch(togglePanel({ sessionId }));
  }, [
    artifactTabsWithArtifacts.length,
    dispatch,
    isBrowserPreviewTabOpen,
    isFileListPreviewTabOpen,
    isPanelOpen,
    sessionId,
    setSessionActiveSpecialPreviewTab,
    setSessionFileListPreviewTabOpen,
  ]);

  const handleToggleArtifactAddMenu = useCallback(() => {
    setShowArtifactAddMenu(open => !open);
  }, []);

  useLayoutEffect(() => {
    if (!showArtifactAddMenu) {
      setArtifactAddMenuPosition(null);
      return undefined;
    }

    const updateMenuPosition = () => {
      const rect = artifactAddButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setArtifactAddMenuPosition({
        left: Math.round(Math.max(8, Math.min(window.innerWidth - 184, rect.right - 176))),
        top: Math.round(rect.bottom + 6),
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [showArtifactAddMenu]);

  const updateArtifactTabsScrollState = useCallback(() => {
    const element = artifactTabsScrollRef.current;
    if (!element) {
      setArtifactTabsCanScrollLeft(false);
      setArtifactTabsCanScrollRight(false);
      setArtifactTabsIsOverflowing(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setArtifactTabsCanScrollLeft(element.scrollLeft > 1);
    setArtifactTabsCanScrollRight(element.scrollLeft < maxScrollLeft - 1);
    setArtifactTabsIsOverflowing(element.scrollWidth > element.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    const container = artifactTabsScrollRef.current;
    if (!container || !isArtifactPanelVisible) return undefined;

    const animationFrame = window.requestAnimationFrame(() => {
      const activeTab = container.querySelector<HTMLElement>('[data-artifact-preview-active="true"]');
      if (!activeTab) {
        updateArtifactTabsScrollState();
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeTab.getBoundingClientRect();
      const visibleLeft = containerRect.left;
      const visibleRight = containerRect.right - (shouldPinArtifactAddTab ? 36 : 0);
      const padding = 8;

      if (activeRect.left < visibleLeft + padding) {
        container.scrollLeft -= visibleLeft + padding - activeRect.left;
      } else if (activeRect.right > visibleRight - padding) {
        container.scrollLeft += activeRect.right - visibleRight + padding;
      }

      updateArtifactTabsScrollState();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    activeArtifactPreviewTab?.id,
    activeSpecialPreviewTab,
    isArtifactPanelVisible,
    isBrowserPreviewTabOpen,
    isFileListPreviewTabOpen,
    shouldPinArtifactAddTab,
    updateArtifactTabsScrollState,
  ]);

  useLayoutEffect(() => {
    const element = artifactTabsScrollRef.current;
    if (!element || !isArtifactPanelVisible) {
      setArtifactTabsCanScrollLeft(false);
      setArtifactTabsCanScrollRight(false);
      setArtifactTabsIsOverflowing(false);
      return undefined;
    }

    updateArtifactTabsScrollState();
    const animationFrame = window.requestAnimationFrame(updateArtifactTabsScrollState);
    element.addEventListener('scroll', updateArtifactTabsScrollState, { passive: true });

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateArtifactTabsScrollState)
      : null;
    resizeObserver?.observe(element);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      element.removeEventListener('scroll', updateArtifactTabsScrollState);
      resizeObserver?.disconnect();
    };
  }, [
    activeArtifactPreviewTab?.id,
    activeSpecialPreviewTab,
    artifactPanelMaxWidth,
    artifactPanelMinWidth,
    artifactTabsWithArtifacts.length,
    isArtifactPanelVisible,
    isBrowserPreviewTabOpen,
    isFileListPreviewTabOpen,
    panelWidth,
    updateArtifactTabsScrollState,
  ]);

  useEffect(() => {
    if (!showArtifactAddMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (artifactAddMenuRef.current?.contains(target) || artifactAddButtonRef.current?.contains(target)) {
        return;
      }
      setShowArtifactAddMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowArtifactAddMenu(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showArtifactAddMenu]);

  useEffect(() => {
    if (!sessionId || !currentSession?.messages?.length) return;
    if (isStreaming) return;

    try {
      const messages = currentSession.messages;
      const detected: Artifact[] = [];
      const seenFilePaths = new Set<string>();
      const seenLocalServiceUrls = new Set<string>();
      const rememberArtifactFilePaths = (artifacts: Artifact[]) => {
        for (const artifact of artifacts) {
          if (artifact.filePath) {
            seenFilePaths.add(normalizeFilePathForDedup(artifact.filePath));
          }
        }
      };

      for (const msg of messages) {
        if (msg.type === 'assistant' && !msg.metadata?.isThinking && msg.content) {
          const localServiceArtifacts = parseLocalServiceUrlsFromText(msg.content, msg.id, sessionId);
          for (const serviceArtifact of localServiceArtifacts) {
            const url = serviceArtifact.url || serviceArtifact.content;
            const normalized = normalizeLocalServiceUrlForDedup(url);
            if (url && !seenLocalServiceUrls.has(normalized)) {
              seenLocalServiceUrls.add(normalized);
              detected.push(serviceArtifact);
            }
          }

          const fileLinks = parseFileLinksFromMessage(msg.content, msg.id, sessionId);
          for (const fl of fileLinks) {
            const normalized = fl.filePath ? normalizeFilePathForDedup(fl.filePath) : '';
            if (fl.filePath && !seenFilePaths.has(normalized)) {
              seenFilePaths.add(normalized);
              detected.push(fl);
            }
          }

          const contentWithoutFileLinks = stripFileLinksFromText(msg.content);
          const pathArtifacts = parseFilePathsFromText(contentWithoutFileLinks, msg.id, sessionId);
          for (const pa of pathArtifacts) {
            const normalized = pa.filePath ? normalizeFilePathForDedup(pa.filePath) : '';
            if (pa.filePath && !seenFilePaths.has(normalized)) {
              seenFilePaths.add(normalized);
              detected.push(pa);
            }
          }

          detected.push(...parseRemoteImageArtifactsFromText(msg.content, msg.id, sessionId, 'artifact-remote-assistant'));
        }

        if (msg.type === 'tool_result') {
          const toolMediaArtifacts = parseToolResultMediaArtifacts(msg, sessionId);
          if (toolMediaArtifacts.length > 0) {
            detected.push(...toolMediaArtifacts);
            rememberArtifactFilePaths(toolMediaArtifacts);
            continue;
          }

          if (!msg.content) continue;

          const mediaArtifacts = parseMediaTokensFromText(msg.content, msg.id, sessionId);
          for (const ma of mediaArtifacts) {
            const normalized = ma.filePath ? normalizeFilePathForDedup(ma.filePath) : '';
            if (ma.filePath && !seenFilePaths.has(normalized)) {
              seenFilePaths.add(normalized);
              detected.push(ma);
            }
          }

          // Only parse bare file paths from tool results of image generation tools.
          // Other tools (e.g. Bash running `find`) may output many file paths in their
          // results that should NOT become artifacts.
          const toolUseId = msg.metadata?.toolUseId;
          const pairedToolUse = toolUseId
            ? messages.find(m => m.type === 'tool_use' && m.metadata?.toolUseId === toolUseId)
            : undefined;
          const toolName = pairedToolUse?.metadata?.toolName
            ? String(pairedToolUse.metadata.toolName)
            : '';
          if (shouldParseFilePathsFromToolResult(toolName)) {
            const pathArtifacts = parseFilePathsFromText(msg.content, msg.id, sessionId, 'artifact-toolresult');
            for (const pa of pathArtifacts) {
              const normalized = pa.filePath ? normalizeFilePathForDedup(pa.filePath) : '';
              if (pa.filePath && !seenFilePaths.has(normalized)) {
                seenFilePaths.add(normalized);
                detected.push(pa);
              }
            }
          }
          detected.push(...parseRemoteImageArtifactsFromText(msg.content, msg.id, sessionId, 'artifact-remote-toolresult'));
        }

        if (msg.type === 'system') {
          const toolMediaArtifacts = parseToolResultMediaArtifacts(msg, sessionId);
          if (toolMediaArtifacts.length > 0) {
            detected.push(...toolMediaArtifacts);
            rememberArtifactFilePaths(toolMediaArtifacts);
            continue;
          }

          if (!msg.content) continue;

          const fileLinks = parseFileLinksFromMessage(msg.content, msg.id, sessionId);
          for (const fl of fileLinks) {
            const normalized = fl.filePath ? normalizeFilePathForDedup(fl.filePath) : '';
            if (fl.filePath && !seenFilePaths.has(normalized)) {
              seenFilePaths.add(normalized);
              detected.push(fl);
            }
          }

          const contentWithoutFileLinks = stripFileLinksFromText(msg.content);
          const pathArtifacts = parseFilePathsFromText(contentWithoutFileLinks, msg.id, sessionId, 'artifact-system-path');
          for (const pa of pathArtifacts) {
            const normalized = pa.filePath ? normalizeFilePathForDedup(pa.filePath) : '';
            if (pa.filePath && !seenFilePaths.has(normalized)) {
              seenFilePaths.add(normalized);
              detected.push(pa);
            }
          }

          detected.push(...parseRemoteImageArtifactsFromText(msg.content, msg.id, sessionId, 'artifact-remote-system'));
        }
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.type === 'tool_use') {
          const toolUseId = msg.metadata?.toolUseId;
          const toolResult = toolUseId
            ? messages.find(m => m.type === 'tool_result' && m.metadata?.toolUseId === toolUseId)
            : messages[i + 1]?.type === 'tool_result' ? messages[i + 1] : undefined;
          const toolArtifact = parseToolArtifact(msg, toolResult, sessionId);
          if (toolArtifact && toolArtifact.filePath) {
            const normalized = normalizeFilePathForDedup(toolArtifact.filePath);
            if (!seenFilePaths.has(normalized)) {
              seenFilePaths.add(normalized);
              detected.push(toolArtifact);
            }
          }
        }
      }

      const cwd = currentSession.cwd;
      for (const artifact of detected) {
        if (artifact.type === ArtifactTypeValue.LocalService) {
          dispatch(addArtifact({ sessionId, artifact }));
        }
      }

      const toLoad = detected.filter(a => a.filePath && !loadedFileIdsRef.current.has(a.id));
      if (toLoad.length === 0) return;

      const loadFiles = async () => {
        for (const artifact of toLoad) {
          let rawPath = artifact.filePath!;
          if (rawPath.startsWith('file:///')) {
            rawPath = rawPath.slice(7);
          } else if (rawPath.startsWith('file://')) {
            rawPath = rawPath.slice(7);
          } else if (rawPath.startsWith('file:/')) {
            rawPath = rawPath.slice(5);
          }
          // Strip leading / before Windows drive letter
          if (/^\/[A-Za-z]:/.test(rawPath)) {
            rawPath = rawPath.slice(1);
          }
          const absPath = rawPath.startsWith('/')
            ? rawPath
            : (/^[A-Za-z]:/.test(rawPath) ? rawPath : `${cwd}/${rawPath}`);
          if (artifact.type === 'video') {
            loadedFileIdsRef.current.add(artifact.id);
            dispatch(addArtifact({
              sessionId,
              artifact: { ...artifact, content: '', filePath: absPath },
            }));
            continue;
          }
          if (artifact.type === ArtifactTypeValue.Html) {
            try {
              const stat = await window.electron.dialog.statFile(absPath);
              if (stat?.success && stat.isFile) {
                dispatch(addArtifact({
                  sessionId,
                  artifact: { ...artifact, content: '', filePath: absPath, contentVersion: Date.now() },
                }));
              }
            } catch {
              // File unreadable or missing.
            }
            loadedFileIdsRef.current.add(artifact.id);
            continue;
          }
          try {
            const result = await window.electron.dialog.readFileAsDataUrl(absPath);
            if (result?.success && result.dataUrl) {
              const isTextType = artifact.type !== 'image' && artifact.type !== 'document';
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
              loadedFileIdsRef.current.add(artifact.id);
              dispatch(addArtifact({
                sessionId,
                artifact: { ...artifact, content, filePath: absPath },
              }));
            } else {
              // File does not exist or is unreadable — mark as loaded to avoid retrying
              loadedFileIdsRef.current.add(artifact.id);
            }
          } catch {
            // File unreadable or missing — mark as loaded to avoid retrying
            loadedFileIdsRef.current.add(artifact.id);
          }
        }
      };
      loadFiles();
    } catch (err) {
      console.error('[ArtifactDetection] failed:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- uses messagesLength as stable proxy for currentSession.messages
  }, [sessionId, messagesLength, isStreaming, dispatch]);

  // Mid-turn artifact detection: detect MEDIA/file artifacts from backfilled tool results
  // while still streaming. The main effect above skips when isStreaming=true, but incremental
  // backfill can populate tool_result text mid-turn. This effect handles that case.
  useEffect(() => {
    if (!sessionId || !isStreaming || !currentSession?.messages?.length) return;

    try {
      const messages = currentSession.messages;
      const cwd = currentSession.cwd;
      const toLoad: Artifact[] = [];
      const seenFilePaths = new Set<string>();

      for (const msg of messages) {
        if (msg.type !== 'tool_result' || !msg.content || !msg.metadata?.isFinal) continue;
        if (loadedFileIdsRef.current.has(msg.id)) continue;

        // Only detect explicit MEDIA: tokens in tool results — do NOT parse bare file paths
        // here, because tool output (e.g. `ls`) may contain many irrelevant file paths.
        const mediaArtifacts = parseMediaTokensFromText(msg.content, msg.id, sessionId);
        for (const ma of mediaArtifacts) {
          const normalized = ma.filePath ? normalizeFilePathForDedup(ma.filePath) : '';
          if (ma.filePath && !seenFilePaths.has(normalized) && !loadedFileIdsRef.current.has(ma.id)) {
            seenFilePaths.add(normalized);
            toLoad.push(ma);
          }
        }
      }

      if (toLoad.length === 0) return;

      const loadFiles = async () => {
        for (const artifact of toLoad) {
          if (loadedFileIdsRef.current.has(artifact.id)) continue;
          let rawPath = artifact.filePath!;
          if (rawPath.startsWith('file:///')) {
            rawPath = rawPath.slice(7);
          } else if (rawPath.startsWith('file://')) {
            rawPath = rawPath.slice(7);
          } else if (rawPath.startsWith('file:/')) {
            rawPath = rawPath.slice(5);
          }
          if (/^\/[A-Za-z]:/.test(rawPath)) {
            rawPath = rawPath.slice(1);
          }
          const absPath = rawPath.startsWith('/')
            ? rawPath
            : (/^[A-Za-z]:/.test(rawPath) ? rawPath : `${cwd}/${rawPath}`);
          if (artifact.type === ArtifactTypeValue.Html) {
            try {
              const stat = await window.electron.dialog.statFile(absPath);
              if (stat?.success && stat.isFile) {
                dispatch(addArtifact({
                  sessionId,
                  artifact: { ...artifact, content: '', filePath: absPath, contentVersion: Date.now() },
                }));
              }
            } catch {
              // File unreadable or missing.
            }
            loadedFileIdsRef.current.add(artifact.id);
            continue;
          }
          try {
            const result = await window.electron.dialog.readFileAsDataUrl(absPath);
            if (result?.success && result.dataUrl) {
              const isTextType = artifact.type !== 'image' && artifact.type !== 'document';
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
              loadedFileIdsRef.current.add(artifact.id);
              dispatch(addArtifact({
                sessionId,
                artifact: { ...artifact, content, filePath: absPath },
              }));
            } else {
              loadedFileIdsRef.current.add(artifact.id);
            }
          } catch {
            loadedFileIdsRef.current.add(artifact.id);
          }
        }
      };
      loadFiles();
    } catch (err) {
      console.error('[ArtifactDetection:midTurn] failed:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mid-turn artifact detection for backfilled tool results
  }, [sessionId, messagesLength, isStreaming, dispatch]);
  // Cleanup nav timers on unmount
  useEffect(() => {
    return () => {
      if (navigatingTimerRef.current) clearTimeout(navigatingTimerRef.current);
    };
  }, []);

  // Reset nav state when session changes
  useEffect(() => {
    setIsScrollable(false);
    setCurrentRailIndex(-1);
    currentRailIndexRef.current = -1;
    isNavigatingRef.current = false;
    turnElsCacheRef.current = [];
    if (navigatingTimerRef.current) clearTimeout(navigatingTimerRef.current);
    setHoveredRailIndex(null);
  }, [currentSession?.id]);

  useEffect(() => {
    const handleOpenShareOptions = (event: Event) => {
      const detail = (event as CustomEvent<CoworkOpenShareOptionsEventDetail>).detail;
      if (!detail?.sessionId || detail.sessionId !== currentSession?.id) return;
      setShowExportOptions(true);
    };

    window.addEventListener(CoworkUiEvent.OpenShareOptions, handleOpenShareOptions);
    return () => {
      window.removeEventListener(CoworkUiEvent.OpenShareOptions, handleOpenShareOptions);
    };
  }, [currentSession?.id]);

  const sessionToMarkdown = useCallback((): string => {
    if (!currentSession) return '';
    const lines: string[] = [];
    lines.push(`# ${currentSession.title}`);
    lines.push('');
    lines.push(`> ${i18nService.t('coworkExportCreatedAt')}: ${new Date(currentSession.createdAt).toLocaleString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    for (const msg of currentSession.messages) {
      if (msg.type === 'user') {
        lines.push(`## 🧑 User`);
        lines.push('');
        if (msg.metadata?.selectedTextSnippets?.length) {
          lines.push(`### ${i18nService.t('coworkSelectedTextExportHeading')}`);
          lines.push('');
          for (const snippet of msg.metadata.selectedTextSnippets) {
            lines.push(...snippet.text.split('\n').map(line => `> ${line}`));
            lines.push('');
          }
        }
        lines.push(msg.content);
        lines.push('');
      } else if (msg.type === 'assistant') {
        lines.push(`## 🤖 Assistant`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      } else if (msg.type === 'tool_use' && msg.metadata?.toolName) {
        lines.push(`### 🔧 Tool: ${msg.metadata.toolName}`);
        lines.push('');
        if (msg.metadata.toolInput) {
          lines.push('```json');
          lines.push(JSON.stringify(msg.metadata.toolInput, null, 2));
          lines.push('```');
          lines.push('');
        }
      } else if (msg.type === 'tool_result') {
        lines.push('#### Tool Result');
        lines.push('');
        lines.push('```');
        lines.push(msg.content.slice(0, 2000) + (msg.content.length > 2000 ? '\n... (truncated)' : ''));
        lines.push('```');
        lines.push('');
      }
    }
    return lines.join('\n');
  }, [currentSession]);

  const sessionToJSON = useCallback((): string => {
    if (!currentSession) return '{}';
    return JSON.stringify({
      title: currentSession.title,
      createdAt: new Date(currentSession.createdAt).toISOString(),
      updatedAt: new Date(currentSession.updatedAt).toISOString(),
      status: currentSession.status,
      messages: currentSession.messages.map(msg => ({
        type: msg.type,
        content: msg.content,
        timestamp: new Date(msg.timestamp).toISOString(),
        ...(msg.metadata?.toolName ? { toolName: msg.metadata.toolName } : {}),
        ...(msg.metadata?.toolInput ? { toolInput: msg.metadata.toolInput } : {}),
        ...(msg.metadata?.selectedTextSnippets?.length ? { selectedTextSnippets: msg.metadata.selectedTextSnippets } : {}),
      })),
    }, null, 2);
  }, [currentSession]);

  const handleExportText = useCallback(async (format: 'md' | 'json') => {
    if (!currentSession) return;
    const content = format === 'md' ? sessionToMarkdown() : sessionToJSON();
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = sanitizeExportFileName(`${currentSession.title}-${timestamp}.${format}`);
    try {
      const result = await window.electron.cowork.exportSessionText({
        content,
        defaultFileName: fileName,
        fileExtension: format,
      });
      if (result.success && !result.canceled) {
        window.dispatchEvent(new CustomEvent('app:showToast', {
          detail: i18nService.t('coworkExportTextSuccess'),
        }));
      } else if (!result.success) {
        throw new Error(result.error || 'Export failed');
      }
    } catch (error) {
      console.error('Failed to export session text:', error);
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkExportTextFailed'),
      }));
    }
  }, [currentSession, sessionToMarkdown, sessionToJSON]);

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentSession || isExportingImage) return;
    setIsExportingImage(true);

    window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const scrollContainer = scrollContainerRef.current;
          if (!scrollContainer) {
            throw new Error('Capture target not found');
          }
          const initialScrollTop = scrollContainer.scrollTop;
          try {
            const scrollRect = domRectToCaptureRect(scrollContainer.getBoundingClientRect());
            if (scrollRect.width <= 0 || scrollRect.height <= 0) {
              throw new Error('Invalid capture area');
            }

            const scrollContentHeight = Math.max(scrollContainer.scrollHeight, scrollContainer.clientHeight);
            if (scrollContentHeight <= 0) {
              throw new Error('Invalid content height');
            }

            const toContentY = (viewportY: number): number => {
              const y = scrollContainer.scrollTop + (viewportY - scrollRect.y);
              return Math.max(0, Math.min(scrollContentHeight, y));
            };

            const userAnchors = scrollContainer.querySelectorAll<HTMLElement>('[data-export-role="user-message"]');
            const assistantAnchors = scrollContainer.querySelectorAll<HTMLElement>('[data-export-role="assistant-block"]');

            let contentStart = 0;
            let contentEnd = scrollContentHeight;

            if (userAnchors.length > 0) {
              contentStart = toContentY(userAnchors[0].getBoundingClientRect().top);
            } else if (assistantAnchors.length > 0) {
              contentStart = toContentY(assistantAnchors[0].getBoundingClientRect().top);
            }

            if (assistantAnchors.length > 0) {
              const lastAssistant = assistantAnchors[assistantAnchors.length - 1];
              contentEnd = toContentY(lastAssistant.getBoundingClientRect().bottom);
            } else if (userAnchors.length > 0) {
              const lastUser = userAnchors[userAnchors.length - 1];
              contentEnd = toContentY(lastUser.getBoundingClientRect().bottom);
            }

            const maxStart = Math.max(0, scrollContentHeight - 1);
            contentStart = Math.max(0, Math.min(maxStart, Math.round(contentStart)));
            contentEnd = Math.max(contentStart + 1, Math.min(scrollContentHeight, Math.round(contentEnd)));

            const outputHeight = contentEnd - contentStart;

            if (outputHeight > MAX_EXPORT_CANVAS_HEIGHT) {
              throw new Error(`Export image is too tall (${outputHeight}px)`);
            }

            const segmentsEstimate = Math.ceil(outputHeight / Math.max(1, scrollRect.height)) + 1;
            if (segmentsEstimate > MAX_EXPORT_SEGMENTS) {
              throw new Error('Export image is too long');
            }

            const canvas = document.createElement('canvas');
            canvas.width = scrollRect.width;
            canvas.height = outputHeight;
            const context = canvas.getContext('2d');
            if (!context) {
              throw new Error('Canvas context unavailable');
            }

            const captureAndLoad = async (rect: CaptureRect): Promise<HTMLImageElement> => {
              const chunk = await coworkService.captureSessionImageChunk({ rect });
              if (!chunk.success || !chunk.pngBase64) {
                throw new Error(chunk.error || 'Failed to capture image chunk');
              }
              return loadImageFromBase64(chunk.pngBase64);
            };

            scrollContainer.scrollTop = Math.min(contentStart, Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight));
            await waitForNextFrame();
            await waitForNextFrame();

            const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            let contentOffset = contentStart;
            while (contentOffset < contentEnd) {
              const targetScrollTop = Math.min(contentOffset, maxScrollTop);
              scrollContainer.scrollTop = targetScrollTop;
              await waitForNextFrame();
              await waitForNextFrame();

              const chunkImage = await captureAndLoad(scrollRect);
              const sourceYOffset = Math.max(0, contentOffset - targetScrollTop);
              const drawableHeight = Math.min(scrollRect.height - sourceYOffset, contentEnd - contentOffset);
              if (drawableHeight <= 0) {
                throw new Error('Failed to stitch export image');
              }
              const scaleY = chunkImage.naturalHeight / scrollRect.height;
              const sourceYInImage = Math.max(0, Math.round(sourceYOffset * scaleY));
              const sourceHeightInImage = Math.max(1, Math.min(
                chunkImage.naturalHeight - sourceYInImage,
                Math.round(drawableHeight * scaleY),
              ));

              context.drawImage(
                chunkImage,
                0,
                sourceYInImage,
                chunkImage.naturalWidth,
                sourceHeightInImage,
                0,
                contentOffset - contentStart,
                scrollRect.width,
                drawableHeight,
              );

              contentOffset += drawableHeight;
            }

            // Compose final canvas with branded header and footer
            const finalCanvas = await composeExportCanvas(
              canvas,
              currentSession.title,
              currentSession.createdAt,
            );

            const pngDataUrl = finalCanvas.toDataURL('image/png');
            const base64Index = pngDataUrl.indexOf(',');
            if (base64Index < 0) {
              throw new Error('Failed to encode export image');
            }

            const timestamp = formatExportTimestamp(new Date());
            const saveResult = await coworkService.saveSessionResultImage({
              pngBase64: pngDataUrl.slice(base64Index + 1),
              defaultFileName: sanitizeExportFileName(`${currentSession.title}-${timestamp}.png`),
            });
            if (saveResult.success && !saveResult.canceled) {
              window.dispatchEvent(new CustomEvent('app:showToast', {
                detail: i18nService.t('coworkExportImageSuccess'),
              }));
              return;
            }
            if (!saveResult.success) {
              throw new Error(saveResult.error || 'Failed to export image');
            }
          } finally {
            scrollContainer.scrollTop = initialScrollTop;
          }
        } catch (error) {
          console.error('Failed to export session image:', error);
          window.dispatchEvent(new CustomEvent('app:showToast', {
            detail: i18nService.t('coworkExportImageFailed'),
          }));
        } finally {
          setIsExportingImage(false);
        }
      })();
    });
  };

  const handleMessagesScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceToBottom <= AUTO_SCROLL_THRESHOLD;
    setShouldAutoScroll((prev) => (prev === isNearBottom ? prev : isNearBottom));

    // Check if content overflows the container (use functional updater to avoid redundant re-renders)
    const scrollable = container.scrollHeight > container.clientHeight;
    setIsScrollable((prev) => (prev === scrollable ? prev : scrollable));
    if (!scrollable) return;

    // Load older messages when scrolled near the top
    if (container.scrollTop <= 80 && !isLoadingMoreMessagesRef.current) {
      const sessionId = currentSession?.id;
      const offset = currentSession?.messagesOffset ?? 0;
      if (sessionId && offset > 0) {
        isLoadingMoreMessagesRef.current = true;
        setIsLoadingMoreMessages(true);
        prevScrollHeightRef.current = container.scrollHeight;
        logDetailDiagnostic(`loading older messages after scrolling near the top for session ${sessionId}; current offset is ${offset}.`);
        coworkService.loadMoreMessages(sessionId).catch(() => {
          prevScrollHeightRef.current = null;
          isLoadingMoreMessagesRef.current = false;
          setIsLoadingMoreMessages(false);
        });
      }
    }


    // Skip index recalculation during programmatic navigation
    if (isNavigatingRef.current) return;

    // Use turn-level elements (always in DOM, even for lazy-rendered turns) for scroll detection
    const turnEls = turnElsCacheRef.current;
    const railCount = railItemCountRef.current;
    if (turnEls.length === 0 || railCount === 0) return;

    // If at very bottom, snap to last rail item
    if (distanceToBottom <= NAV_BOTTOM_SNAP_THRESHOLD) {
      const lastRail = railCount - 1;
      if (currentRailIndexRef.current !== lastRail) {
        currentRailIndexRef.current = lastRail;
        setCurrentRailIndex(lastRail);
      }
      return;
    }

    // Find current turn based on turn element offsetTop
    const scrollTop = container.scrollTop;
    let currentTurn = 0;
    for (let i = 0; i < turnEls.length; i++) {
      if (turnEls[i].offsetTop <= scrollTop + 80) {
        currentTurn = i;
      } else {
        break;
      }
    }

    // Map turn to rail index: check if scrolled past the midpoint of the turn
    // (first half → user message = first rail item, second half → assistant = last rail item)
    const range = turnToRailRangeRef.current[currentTurn];
    if (!range) return;
    let railIdx = range.first;
    if (range.first !== range.last) {
      const turnEl = turnEls[currentTurn];
      const nextTurnTop = currentTurn + 1 < turnEls.length
        ? turnEls[currentTurn + 1].offsetTop
        : container.scrollHeight;
      const turnMid = turnEl.offsetTop + (nextTurnTop - turnEl.offsetTop) / 2;
      if (scrollTop + 80 >= turnMid) {
        railIdx = range.last;
      }
    }

    if (currentRailIndexRef.current !== railIdx) {
      currentRailIndexRef.current = railIdx;
      setCurrentRailIndex(railIdx);
    }
  }, [currentSession?.id, currentSession?.messagesOffset]);

  // Auto-load older messages if content doesn't fill the container (no scrollbar = onScroll never fires)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingMoreMessagesRef.current) return;
    const sessionId = currentSession?.id;
    const offset = currentSession?.messagesOffset ?? 0;
    if (!sessionId || offset <= 0) return;
    if (container.scrollHeight <= container.clientHeight) {
      isLoadingMoreMessagesRef.current = true;
      setIsLoadingMoreMessages(true);
      prevScrollHeightRef.current = container.scrollHeight;
      logDetailDiagnostic(
        `auto-loading older messages because session ${sessionId} content height ${container.scrollHeight} does not exceed viewport height ${container.clientHeight}; current offset is ${offset}.`,
      );
      coworkService.loadMoreMessages(sessionId).catch(() => {
        prevScrollHeightRef.current = null;
        isLoadingMoreMessagesRef.current = false;
        setIsLoadingMoreMessages(false);
      });
    }
  }, [currentSession?.id, currentSession?.messagesOffset, currentSession?.messages.length]);

  // Restore scroll position synchronously before browser paint when messages are prepended
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || prevScrollHeightRef.current === null) return;
    const newScrollHeight = container.scrollHeight;
    container.scrollTop += newScrollHeight - prevScrollHeightRef.current;
    prevScrollHeightRef.current = null;
    isLoadingMoreMessagesRef.current = false;
    setIsLoadingMoreMessages(false);
  }, [currentSession?.messages.length]);

  const navigateToRailItem = useCallback((railIndex: number) => {
    if (railIndex < 0 || railIndex >= railItemCountRef.current) return;

    // Find the turn that contains this rail item
    const ranges = turnToRailRangeRef.current;
    let targetTurnIdx = -1;
    for (let t = 0; t < ranges.length; t++) {
      if (ranges[t] && railIndex >= ranges[t].first && railIndex <= ranges[t].last) {
        targetTurnIdx = t;
        break;
      }
    }

    isNavigatingRef.current = true;
    if (navigatingTimerRef.current) clearTimeout(navigatingTimerRef.current);
    navigatingTimerRef.current = setTimeout(() => { isNavigatingRef.current = false; }, NAV_SCROLL_LOCK_DURATION);

    // Try to scroll to the exact data-rail-index element if it's in the DOM
    const container = scrollContainerRef.current;
    if (container) {
      const el = container.querySelector<HTMLElement>(`[data-rail-index="${railIndex}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (targetTurnIdx >= 0) {
        // Fallback: scroll to the turn element (always in DOM)
        const turnEls = turnElsCacheRef.current;
        if (targetTurnIdx < turnEls.length) {
          turnEls[targetTurnIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    currentRailIndexRef.current = railIndex;
    setCurrentRailIndex(railIndex);
  }, []);

  // lastMessageContent and messagesLength are now sourced from memoized
  // selectors (selectLastMessageContent / selectCurrentMessagesLength)
  // so there is no need to derive them from currentSession here.

  const resolveLocalFilePath = useCallback((href: string, text: string) => {
    const hrefValue = typeof href === 'string' ? href.trim() : '';
    const textValue = typeof text === 'string' ? text.trim() : '';
    if (!hrefValue && !textValue) return null;

    const hrefRootRelative = hrefValue ? parseRootRelativePath(hrefValue) : null;
    if (hrefRootRelative) {
      return hrefRootRelative;
    }

    const hrefPath = hrefValue ? normalizeLocalPath(hrefValue) : null;
    if (hrefPath) {
      if (hrefPath.isRelative && currentSession?.cwd) {
        return toAbsolutePathFromCwd(hrefPath.path, currentSession.cwd);
      }
      if (hrefPath.isAbsolute) {
        return hrefPath.path;
      }
    }

    const textRootRelative = textValue ? parseRootRelativePath(textValue) : null;
    if (textRootRelative) {
      return textRootRelative;
    }

    const textPath = textValue ? normalizeLocalPath(textValue) : null;
    if (textPath) {
      if (textPath.isRelative && currentSession?.cwd) {
        return toAbsolutePathFromCwd(textPath.path, currentSession.cwd);
      }
      if (textPath.isAbsolute) {
        return textPath.path;
      }
    }

    return null;
  }, [currentSession?.cwd]);

  const mapDisplayText = useCallback((value: string): string => {
    return value;
  }, []);

  const handleReEdit = useCallback((message: CoworkMessage) => {
    const ref = promptInputRef.current;
    if (!ref) return;
    void (async () => {
      const metadata = message.metadata as CoworkMessageMetadata | undefined;
      const imagePreviews = Array.isArray(metadata?.imageAttachmentPreviews)
        ? metadata.imageAttachmentPreviews as CoworkImageAttachmentPreview[]
        : [];
      let imageAttachments = ((metadata?.imageAttachments ?? []) as CoworkImageAttachment[]);

      if (imagePreviews.length > 0 && imageAttachments.length === 0) {
        const restoredImages: CoworkImageAttachment[] = [];
        for (const preview of imagePreviews) {
          if (!preview.localPath) {
            showToast(i18nService.t('coworkImageAttachmentOriginalMissing'));
            return;
          }
          try {
            const readResult = await window.electron.dialog.readFileAsDataUrl(preview.localPath);
            if (!readResult.success || !readResult.dataUrl) {
              showToast(i18nService.t('coworkImageAttachmentOriginalMissing'));
              return;
            }
            const extracted = extractBase64FromDataUrl(readResult.dataUrl);
            if (!extracted) {
              showToast(i18nService.t('coworkImageAttachmentOriginalMissing'));
              return;
            }
            restoredImages.push({
              name: preview.name,
              mimeType: extracted.mimeType,
              base64Data: extracted.base64Data,
              localPath: preview.localPath,
            });
          } catch (error) {
            console.warn('[CoworkSessionDetail] failed to restore image attachment for re-edit:', error);
            showToast(i18nService.t('coworkImageAttachmentOriginalMissing'));
            return;
          }
        }
        imageAttachments = restoredImages;
      }

      // Set text content
      if (message.content?.trim()) {
        ref.setValue(message.content);
      }
      // Restore image attachments (always call to clear previous attachments)
      ref.setImageAttachments(imageAttachments);
      const selectedTextSnippets = (metadata?.selectedTextSnippets ?? []) as CoworkSelectedTextSnippet[];
      ref.setSelectedTextSnippets(selectedTextSnippets);
      // Restore active skills
      const skillIds = metadata?.skillIds ?? [];
      dispatch(setActiveSkillIds(skillIds));
      const kitIds = metadata?.kitIds ?? [];
      dispatch(setActiveKitIds(kitIds));
      // Focus the input
      ref.focus();
    })();
  }, [dispatch]);

  const handleBrowserAnnotationCaptured = useCallback((payload: BrowserAnnotationPayload) => {
    promptInputRef.current?.insertBrowserAnnotation(payload);
  }, []);

  const messages = currentSession?.messages;
  const displayItems = useMemo(() => messages ? buildDisplayItems(messages) : [], [messages]);
  const turns = useMemo(() => buildConversationTurns(displayItems), [displayItems]);

  // Cache turn-level DOM elements (data-turn-index, always in DOM even for lazy turns)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) { turnElsCacheRef.current = []; return; }
    turnElsCacheRef.current = Array.from(
      container.querySelectorAll<HTMLElement>('[data-turn-index]')
    );
  }, [turns]);

  // Sync rail index when turns change or rail first appears (isScrollable becomes true)
  useEffect(() => {
    // After turns/scrollable change, if rail index is uninitialized (-1) or out of bounds,
    // wait for next frame so render IIFE has updated railItemCountRef, then sync
    const frameId = requestAnimationFrame(() => {
      const count = railItemCountRef.current;
      if (count === 0) return;
      const idx = currentRailIndexRef.current;
      if (idx < 0 || idx >= count) {
        const resolved = count - 1;
        currentRailIndexRef.current = resolved;
        setCurrentRailIndex(resolved);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [turns, isScrollable]);

  // Scroll rail lines container to keep active item visible (without affecting page scroll)
  useEffect(() => {
    const container = railLinesRef.current;
    if (!container || currentRailIndex < 0) return;
    const activeEl = container.children[currentRailIndex] as HTMLElement | undefined;
    if (!activeEl) return;
    // Manual scroll calculation to avoid scrollIntoView bubbling to parent scrollable
    const elTop = activeEl.offsetTop;
    const elBottom = elTop + activeEl.offsetHeight;
    if (elTop < container.scrollTop) {
      container.scrollTop = elTop;
    } else if (elBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = elBottom - container.clientHeight;
    }
  }, [currentRailIndex]);

  // Auto scroll to bottom when new messages arrive or content updates (streaming)
  useEffect(() => {
    if (!shouldAutoScroll) {
      return;
    }
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setIsScrollable(container.scrollHeight > container.clientHeight);
    }
    // Sync rail index to last when auto-scrolled to bottom
    if (turns.length > 0) {
      // Use -1 when rail hasn't rendered yet (count is 0),
      // so the render IIFE resolvedRailIndex fallback picks the last item
      const lastRail = railItemCountRef.current > 0 ? railItemCountRef.current - 1 : -1;
      currentRailIndexRef.current = lastRail;
      setCurrentRailIndex(lastRail);
    }
  }, [messagesLength, lastMessageContent, isContextCompacting, isStreaming, shouldAutoScroll, turns.length]);


  if (!currentSession) {
    return null;
  }

  const artifactPanelFrameWidth = isArtifactPanelVisible
    ? Math.max(artifactPanelMinWidth, Math.min(panelWidth, artifactPanelMaxWidth)) + ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH
    : 0;
  const artifactHeaderWidth = isArtifactPanelVisible
    ? Math.max(0, artifactPanelFrameWidth - ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH)
    : undefined;
  const shouldShowTurnNavigationRail = turns.length > 1 && isScrollable;

  const renderConversationTurns = () => {
    let railCounter = 0;
    if (turns.length === 0) {
      if (!isStreaming) return null;
      return (
        <div data-export-role="assistant-block">
          <AssistantTurnBlock
            turn={{
              id: 'streaming-only',
              userMessage: null,
              assistantItems: [],
            }}
            resolveLocalFilePath={resolveLocalFilePath}
            showTypingIndicator
            showCopyButtons={!isStreaming}
          />
        </div>
      );
    }

    return turns.map((turn, index) => {
      const isLastTurn = index === turns.length - 1;
      const showTypingIndicator = isStreaming && isLastTurn && !hasRenderableAssistantContent(turn);
      const showAssistantBlock = turn.assistantItems.length > 0 || showTypingIndicator;
      // Always render last 3 turns (needed for streaming, auto-scroll, and smooth UX)
      const alwaysRender = index >= turns.length - 3;

      // Compute rail indices for user/assistant messages (must match rail IIFE logic)
      const hasAssistantContent = turn.assistantItems.some(
        item => item.type === 'assistant' && Boolean(item.message?.content),
      );
      const userRailIdx = turn.userMessage ? railCounter++ : -1;
      const asstRailIdx = hasAssistantContent ? railCounter++ : -1;

      const turnMessageIds = new Set<string>();
      for (const item of turn.assistantItems) {
        if (item.type === 'assistant' || item.type === 'system' || item.type === 'tool_result') {
          turnMessageIds.add(item.message.id);
        } else if (item.type === 'tool_group') {
          turnMessageIds.add(item.group.toolUse.id);
          if (item.group.toolResult) {
            turnMessageIds.add(item.group.toolResult.id);
          }
        }
      }
      const turnArtifacts = sessionArtifacts.filter(
        a => turnMessageIds.has(a.messageId) && PREVIEWABLE_ARTIFACT_TYPES.has(a.type)
      );

      return (
        <LazyRenderTurn key={turn.id} turnId={turn.id} alwaysRender={alwaysRender} data-turn-index={index}>
          {turn.userMessage && (
            <div data-export-role="user-message" className={isLastTurn ? 'animate-message-in' : undefined} {...(userRailIdx >= 0 ? { 'data-rail-index': userRailIdx } : undefined)}>
              <UserMessageItem
                message={turn.userMessage}
                skills={skills}
                marketplaceKits={marketplaceKits}
                onReEdit={remoteManaged ? undefined : handleReEdit}
                onLocateSelectedText={handleLocateSelectedText}
              />
            </div>
          )}
          {showAssistantBlock && (
            <div data-export-role="assistant-block" className={isLastTurn ? 'animate-message-in' : undefined} {...(asstRailIdx >= 0 ? { 'data-rail-index': asstRailIdx } : undefined)}>
              <AssistantTurnBlock
                turn={turn}
                artifacts={turnArtifacts}
                resolveLocalFilePath={resolveLocalFilePath}
                mapDisplayText={mapDisplayText}
                onOpenLocalService={handleOpenLocalServiceArtifact}
                onForkMessage={remoteManaged ? undefined : handleForkMessage}
                showTypingIndicator={showTypingIndicator}
                showCopyButtons={!isStreaming || !isLastTurn}
              />
            </div>
          )}
        </LazyRenderTurn>
      );
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header — spans full width */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border bg-background shrink-0">
        {/* Left side: Toggle buttons (when collapsed) + Title */}
        <div className="flex h-full flex-1 items-center gap-2 min-w-0">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          <h1 className="text-sm leading-none font-medium text-foreground truncate max-w-[360px]">
            {currentSession.title || i18nService.t('coworkNewSession')}
          </h1>
        </div>

        {/* Right side: Artifact toggle */}
        <div
          className={`non-draggable flex h-full shrink-0 items-center gap-1 ${
            isArtifactPanelVisible ? '-mr-4 border-l border-border pr-4' : ''
          }`}
          style={artifactHeaderWidth !== undefined ? { width: artifactHeaderWidth } : undefined}
        >
          {isArtifactPanelVisible && (
            <div className="flex h-full min-w-0 flex-1 items-center">
              <div className="relative flex h-full min-w-0 flex-1">
                <div
                  ref={artifactTabsScrollRef}
                  className="scrollbar-hidden flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
                >
                  <div className="flex h-full min-w-max items-center gap-1 pl-4 pr-3">
                  {isFileListPreviewTabOpen && (
                    <div
                      data-artifact-preview-active={
                        !activeArtifactPreviewTab && activeSpecialPreviewTab === ArtifactSpecialTab.FileList
                          ? 'true'
                          : undefined
                      }
                      className={`group flex h-7 max-w-[190px] items-center rounded-lg text-xs transition-colors ${
                        activeArtifactPreviewTab || activeSpecialPreviewTab !== ArtifactSpecialTab.FileList
                          ? 'text-secondary hover:bg-surface hover:text-foreground'
                          : 'bg-surface-raised text-foreground shadow-sm'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={handleActivateArtifactFileListTab}
                        className="flex min-w-0 items-center gap-1.5 px-2 text-left"
                        title={i18nService.t('artifactFileList')}
                      >
                        <ArtifactPanelIcon className="h-3.5 w-3.5 shrink-0" open />
                        <span className="truncate">{i18nService.t('artifactFileList')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseArtifactFileListTab();
                        }}
                        className={`mr-1 rounded p-0.5 transition-colors ${
                          activeArtifactPreviewTab || activeSpecialPreviewTab !== ArtifactSpecialTab.FileList
                            ? 'text-transparent group-hover:text-secondary group-hover:hover:bg-surface-hover group-hover:hover:text-foreground'
                            : 'text-secondary hover:bg-surface-hover hover:text-foreground'
                        }`}
                        title={i18nService.t('artifactCloseTab')}
                      >
                        <ArtifactTabCloseIcon className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {isBrowserPreviewTabOpen && (
                    <div
                      data-artifact-preview-active={
                        !activeArtifactPreviewTab && activeSpecialPreviewTab === ArtifactSpecialTab.Browser
                          ? 'true'
                          : undefined
                      }
                      className={`group flex h-7 max-w-[190px] items-center rounded-lg text-xs transition-colors ${
                        activeArtifactPreviewTab || activeSpecialPreviewTab !== ArtifactSpecialTab.Browser
                          ? 'text-secondary hover:bg-surface hover:text-foreground'
                          : 'bg-surface-raised text-foreground shadow-sm'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={handleActivateArtifactBrowserTab}
                        className="flex min-w-0 items-center gap-1.5 px-2 text-left"
                        title={i18nService.t('artifactBrowserTab')}
                      >
                        <ArtifactBrowserTabIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{i18nService.t('artifactBrowserTab')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseArtifactBrowserTab();
                        }}
                        className={`mr-1 rounded p-0.5 transition-colors ${
                          activeArtifactPreviewTab || activeSpecialPreviewTab !== ArtifactSpecialTab.Browser
                            ? 'text-transparent group-hover:text-secondary group-hover:hover:bg-surface-hover group-hover:hover:text-foreground'
                            : 'text-secondary hover:bg-surface-hover hover:text-foreground'
                        }`}
                        title={i18nService.t('artifactCloseTab')}
                      >
                        <ArtifactTabCloseIcon className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {artifactTabsWithArtifacts.map(({ tab, artifact }) => {
                    const isActive = tab.id === activeArtifactPreviewTab?.id;
                    const fileName = artifact.fileName || artifact.title;
                    return (
                      <div
                        key={tab.id}
                        data-artifact-preview-active={isActive ? 'true' : undefined}
                        className={`group flex h-7 max-w-[190px] shrink-0 items-center rounded-lg text-xs transition-colors ${
                          isActive
                            ? 'bg-surface-raised text-foreground shadow-sm'
                            : 'text-secondary hover:bg-surface hover:text-foreground'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleActivateArtifactTab(tab.id)}
                          className="flex min-w-0 max-w-[158px] items-center gap-1.5 px-2 text-left"
                          title={fileName}
                        >
                          <FileTypeIcon fileName={fileName} className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{fileName}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCloseArtifactTab(tab.id);
                          }}
                          className={`mr-1 rounded p-0.5 transition-colors ${
                            isActive
                              ? 'text-secondary hover:bg-surface-hover hover:text-foreground'
                              : 'text-transparent group-hover:text-secondary group-hover:hover:bg-surface-hover group-hover:hover:text-foreground'
                          }`}
                          title={i18nService.t('artifactCloseTab')}
                        >
                          <ArtifactTabCloseIcon className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                  {shouldPinArtifactAddTab ? (
                    <div className="h-full w-9 shrink-0" aria-hidden="true" />
                  ) : (
                    <div className="z-20 flex h-full shrink-0 items-center bg-background pl-1 pr-1">
                      <button
                        ref={artifactAddButtonRef}
                        type="button"
                        onClick={handleToggleArtifactAddMenu}
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface hover:text-foreground ${
                          showArtifactAddMenu ? 'bg-surface text-foreground' : ''
                        }`}
                        aria-label={i18nService.t('artifactAddTab')}
                        title={i18nService.t('artifactAddTab')}
                      >
                        <ArtifactTabPlusIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  </div>
                </div>
                {shouldPinArtifactAddTab && (
                  <div className="absolute inset-y-0 right-0 z-20 flex items-center bg-background pl-1 pr-1">
                    <button
                      ref={artifactAddButtonRef}
                      type="button"
                      onClick={handleToggleArtifactAddMenu}
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface hover:text-foreground ${
                        showArtifactAddMenu ? 'bg-surface text-foreground' : ''
                      }`}
                      aria-label={i18nService.t('artifactAddTab')}
                      title={i18nService.t('artifactAddTab')}
                    >
                      <ArtifactTabPlusIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {(artifactTabsCanScrollLeft || artifactTabsCanScrollRight) && (
                  <>
                    {artifactTabsCanScrollLeft && (
                      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background from-[34%] via-background/80 via-[66%] to-transparent backdrop-blur-sm [mask-image:linear-gradient(to_right,black_0%,black_40%,rgba(0,0,0,0.75)_72%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,black_0%,black_40%,rgba(0,0,0,0.75)_72%,transparent_100%)]" />
                    )}
                    {artifactTabsCanScrollRight && (
                      <div className="pointer-events-none absolute inset-y-0 right-[36px] z-10 w-12 bg-gradient-to-l from-background from-[18%] via-background/80 via-[58%] to-transparent backdrop-blur-sm [mask-image:linear-gradient(to_left,black_0%,black_30%,rgba(0,0,0,0.75)_68%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_left,black_0%,black_30%,rgba(0,0,0,0.75)_68%,transparent_100%)]" />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {/* Artifact panel toggle */}
          <button
            type="button"
            onClick={handleToggleArtifactPanel}
            className="relative h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
            aria-label={i18nService.t('artifactPanelToggle')}
          >
            <ArtifactPanelIcon className="h-4 w-4" open={isPanelOpen} />
          </button>

          <WindowTitleBar inline className="ml-1" />
        </div>
      </div>

      {showArtifactAddMenu && artifactAddMenuPosition && createPortal(
        <div
          ref={artifactAddMenuRef}
          className="fixed z-50 w-44 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
          style={{ left: artifactAddMenuPosition.left, top: artifactAddMenuPosition.top }}
        >
          <button
            type="button"
            onClick={handleOpenArtifactFileListFromMenu}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface"
          >
            <ArtifactPanelIcon className="h-4 w-4 shrink-0" open />
            <span className="truncate">{i18nService.t('artifactOpenFileTab')}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenArtifactBrowserTab}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface"
          >
            <ArtifactBrowserTabIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{i18nService.t('artifactBrowserTab')}</span>
          </button>
        </div>,
        document.body
      )}

      {/* Export Options Modal */}
      {showExportOptions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
          onClick={() => setShowExportOptions(false)}
        >
          <div
            className="w-full max-w-xs mx-4 dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal overflow-hidden modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b dark:border-claude-darkBorder border-claude-border">
              <h3 className="text-base font-semibold dark:text-claude-darkText text-claude-text">
                {i18nService.t('coworkExportAs')}
              </h3>
            </div>
            <div className="py-1">
              <button
                type="button"
                onClick={(e) => { setShowExportOptions(false); handleShareClick(e); }}
                disabled={isExportingImage}
                className="w-full flex items-center gap-3 px-5 py-3 text-left text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors disabled:opacity-50"
              >
                <PhotoIcon className="h-5 w-5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <div>
                  <div className="font-medium">{i18nService.t('coworkExportImage')}</div>
                  <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">{i18nService.t('coworkExportImageDesc')}</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setShowExportOptions(false); handleExportText('md'); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <DocumentArrowDownIcon className="h-5 w-5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <div>
                  <div className="font-medium">Markdown</div>
                  <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">{i18nService.t('coworkExportMarkdownDesc')}</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setShowExportOptions(false); handleExportText('json'); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-left text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                <DocumentArrowDownIcon className="h-5 w-5 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
                <div>
                  <div className="font-medium">JSON</div>
                  <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">{i18nService.t('coworkExportJSONDesc')}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content row: chat + artifact panel */}
      <div ref={contentRowRef} className="flex-1 flex overflow-hidden">
      <div ref={detailRootRef} className="flex-1 flex flex-col bg-background h-full" style={{ minWidth: COWORK_DETAIL_MIN_WIDTH }}>
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          onScroll={handleMessagesScroll}
          onMouseUp={handleAssistantTextSelection}
          className="relative h-full min-h-0 overflow-y-auto pt-3"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          {selectedTextAction && (
            <button
              type="button"
              data-cowork-selected-text-action
              onClick={handleAddSelectedText}
              className="absolute z-40 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-popover transition-colors hover:bg-surface-raised"
              style={{ left: selectedTextAction.left, top: selectedTextAction.top }}
            >
              {i18nService.t('coworkSelectedTextAddToChat')}
            </button>
          )}
          {isLoadingMoreMessages && (
            <div className="py-2 text-center text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('loading')}
            </div>
          )}
          {renderConversationTurns()}
          {isContextCompacting && (
            <div className={`${COWORK_DETAIL_GUTTER_CLASS} animate-message-in`}>
              <div className={COWORK_DETAIL_CONTENT_CLASS}>
                <ContextCompactionDivider
                  label={i18nService.t('coworkContextCompacting')}
                  active
                />
              </div>
            </div>
          )}
          <div className="h-20" />
        </div>

        {/* Turn Navigation Rail — to the left of scrollbar */}
        {shouldShowTurnNavigationRail && (
          <div
            className="absolute right-[18px] top-1/2 -translate-y-1/2 w-5 flex flex-col items-end z-10"
            style={{ maxHeight: 'calc(100% - 40px)' }}
            onMouseEnter={() => setIsRailHovered(true)}
            onMouseLeave={() => {
              setIsRailHovered(false);
              setHoveredRailIndex(null);
              setRailTooltip(null);
            }}
          >
            {/* Up Arrow */}
            <button
              type="button"
              onClick={() => {
                const resolvedRail = currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex;
                if (resolvedRail <= 0) return;
                navigateToRailItem(resolvedRail - 1);
              }}
              onMouseEnter={() => { setHoveredRailIndex(null); }}
              className={`shrink-0 flex items-center justify-center w-5 h-5 mb-2 -mr-[5px] rounded-full transition-all text-neutral-600 dark:text-neutral-400
                ${!isRailHovered
                  ? 'opacity-0 pointer-events-none'
                  : (currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex) <= 0
                    ? 'opacity-30 cursor-default'
                    : 'cursor-pointer hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>

            {/* Message Lines */}
            <div
              ref={railLinesRef}
              className="overflow-y-auto min-h-0 flex-1"
              style={{ scrollbarWidth: 'none' }}
            >
            {(() => {
              // Build flat list of messages with their content length and turn index
              const MIN_W = 6;  // px
              const MAX_W = 16; // px
              // Strip common markdown syntax for tooltip display
              const stripMd = (s: string) => s
                .replace(/^#+\s+/gm, '')
                .replace(/```[\s\S]*?```/g, ' ')
                .replace(/`[^`]*`/g, ' ')
                .replace(/[*_~>]/g, '')
                .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                .replace(/\s+/g, ' ')
                .trim();
              // Get first meaningful text snippet from content
              const getLabel = (content: string, fallback: string) => {
                const stripped = stripMd(content);
                return stripped.slice(0, 50) || fallback;
              };
              type RailItem = { key: string; turnIndex: number; label: string; contentLen: number; isUser: boolean };
              const items: RailItem[] = [];
              for (let i = 0; i < turns.length; i++) {
                const turn = turns[i];
                if (turn.userMessage) {
                  const content = turn.userMessage.content ?? '';
                  items.push({
                    key: `${turn.id}-user`,
                    turnIndex: i,
                    label: getLabel(content, `Turn ${i + 1}`),
                    contentLen: content.length,
                    isUser: true,
                  });
                }
                // Aggregate all assistant content into one line per turn
                let asstContent = '';
                for (const item of turn.assistantItems) {
                  if (item.type === 'assistant' && item.message?.content) {
                    asstContent += item.message.content;
                  }
                }
                if (asstContent) {
                  items.push({
                    key: `${turn.id}-asst`,
                    turnIndex: i,
                    label: getLabel(asstContent, 'LobsterAI'),
                    contentLen: asstContent.length,
                    isUser: false,
                  });
                }
              }
              const maxLen = items.reduce((acc, m) => Math.max(acc, m.contentLen), 1);
              // Sync rail item count and turn-to-rail mapping
              railItemCountRef.current = items.length;
              const rangeMap: { first: number; last: number }[] = [];
              for (let ri = 0; ri < items.length; ri++) {
                const ti = items[ri].turnIndex;
                if (!rangeMap[ti]) {
                  rangeMap[ti] = { first: ri, last: ri };
                } else {
                  rangeMap[ti].last = ri;
                }
              }
              turnToRailRangeRef.current = rangeMap;

              // Clamp rail index to valid range
              const resolvedRailIndex = currentRailIndex < 0 || currentRailIndex >= items.length
                ? items.length - 1
                : currentRailIndex;

              return items.map((msg, idx) => {
                const isActive = idx === resolvedRailIndex;
                const isHovered = idx === hoveredRailIndex;
                const ratio = msg.contentLen / maxLen;
                const lineW = Math.round(MIN_W + ratio * (MAX_W - MIN_W));
                return (
                  <button
                    key={msg.key}
                    type="button"
                    onClick={() => {
                      navigateToRailItem(idx);
                    }}
                    onMouseEnter={(e) => {
                      setHoveredRailIndex(idx);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const top = Math.max(8, Math.min(rect.top + rect.height / 2, window.innerHeight - 8));
                      setRailTooltip({
                        label: msg.label,
                        top,
                        right: window.innerWidth - rect.left + 8,
                        isUser: msg.isUser,
                      });
                    }}
                    onMouseLeave={() => setRailTooltip(null)}
                    className="flex items-center justify-end cursor-pointer w-5 py-[5px]"
                  >
                    <div
                      className={`h-[2px] rounded-full transition-all ${
                        isActive || isHovered
                          ? 'bg-neutral-800 dark:bg-neutral-200'
                          : 'bg-neutral-300 dark:bg-neutral-600'
                      }`}
                      style={{ width: isActive || isHovered ? MAX_W : lineW }}
                    />
                  </button>
                );
              });
            })()}
            </div>

            {/* Down Arrow */}
            <button
              type="button"
              onClick={() => {
                const maxRail = railItemCountRef.current - 1;
                const resolvedRail = currentRailIndex < 0 ? maxRail : currentRailIndex;
                if (resolvedRail >= maxRail) return;
                navigateToRailItem(resolvedRail + 1);
              }}
              onMouseEnter={() => { setHoveredRailIndex(null); }}
              className={`shrink-0 flex items-center justify-center w-5 h-5 mt-2 -mr-[5px] rounded-full transition-all text-neutral-600 dark:text-neutral-400
                ${!isRailHovered
                  ? 'opacity-0 pointer-events-none'
                  : (currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex) >= railItemCountRef.current - 1
                    ? 'opacity-30 cursor-default'
                    : 'cursor-pointer hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>
        )}

        {railTooltip && createPortal(
          <div
            className={`fixed z-[100] px-3.5 py-2 text-[13px] leading-snug pointer-events-none overflow-hidden
              max-w-[240px] shadow-[0_2px_12px_rgba(0,0,0,0.12)]
              border dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]
              ${railTooltip.isUser
                ? 'rounded-[12px_12px_4px_12px] bg-white border-neutral-200/80 dark:bg-neutral-800 dark:border-neutral-700'
                : 'rounded-xl bg-neutral-50 border-neutral-200/80 dark:bg-neutral-800 dark:border-neutral-700'
              }`}
            style={{
              top: railTooltip.top,
              right: railTooltip.right,
              transform: 'translateY(-50%)',
            }}
          >
            {!railTooltip.isUser && (
              <div className="text-[12px] font-medium mb-0.5 text-neutral-800 dark:text-neutral-200">
                LobsterAI:
              </div>
            )}
            <div
              className="text-neutral-600 dark:text-neutral-300"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-all',
              }}
            >
              {railTooltip.label}
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* Streaming Activity Bar */}
      {isSessionBusy && <StreamingActivityBar messages={currentSession.messages} isContextMaintenance={isContextMaintenance} />}

      {/* Input Area */}
      <div className={`pt-0 pb-4 shrink-0 ${COWORK_DETAIL_GUTTER_CLASS}`}>
        <div className={COWORK_DETAIL_CONTENT_CLASS}>
          <CoworkPromptInput
            ref={promptInputRef}
            onSubmit={onContinue}
            onStop={onStop}
            isStreaming={isSessionBusy}
            placeholder={i18nService.t(remoteManaged ? 'coworkRemoteManagedPlaceholder' : 'coworkContinuePlaceholder')}
            disabled={remoteManaged}
            size="large"
            remoteManaged={remoteManaged}
            onManageSkills={remoteManaged ? undefined : onManageSkills}
            onManageKits={remoteManaged ? undefined : onManageKits}
            showModelSelector={true}
            showReadOnlyContext={true}
            readOnlyContextTrailingText={i18nService.t('aiGeneratedDisclaimer')}
            workingDirectory={currentSession?.cwd ?? ''}
            contextAgentId={currentSession?.agentId}
            sessionId={currentSession?.id}
            contextUsageControl={(
              <div ref={compactConfirmRef} className="relative inline-flex flex-shrink-0">
                <ContextUsageIndicator
                  usage={contextUsage}
                  compacting={isContextBusy}
                  disabled={remoteManaged || !currentSession?.id}
                  onCompact={handleCompactContext}
                  showTooltip={!showCompactConfirm}
                  active={showCompactConfirm}
                  className="-mr-1"
                />
                {showCompactConfirm && (
                  <div className="absolute bottom-full left-1/2 z-50 mb-1.5 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-surface p-1.5 shadow-popover">
                    <button
                      type="button"
                      onClick={handleCancelCompactContext}
                      className="whitespace-nowrap rounded-md bg-surface-raised px-2.5 py-1 text-center text-[11px] font-medium leading-4 text-secondary transition-colors hover:text-foreground"
                    >
                      {i18nService.t('cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmCompactContext}
                      className="whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-center text-[11px] font-semibold leading-4 text-white transition-colors hover:bg-primary-hover"
                    >
                      {i18nService.t('coworkContextCompactConfirmActionShort')}
                    </button>
                  </div>
                )}
              </div>
            )}
          />
        </div>
      </div>
    </div>
    {shouldRenderArtifactPanel && (
      <div
        className={`h-full shrink-0 overflow-hidden ${
          isArtifactPanelTransitioning
            ? 'transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none'
            : ''
        } ${isArtifactPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        style={{
          width: artifactPanelFrameWidth,
          maxWidth: artifactPanelMaxWidth + ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH,
        }}
        aria-hidden={!isPanelOpen}
      >
        <div
          className="flex h-full"
          style={{ width: artifactPanelFrameWidth }}
        >
          <ArtifactPanelErrorBoundary onClose={() => dispatch(closePanel({ sessionId: currentSession.id }))}>
            <ArtifactPanel
              sessionId={currentSession.id}
              artifacts={sessionArtifacts}
              activeSpecialTab={activeSpecialPreviewTab}
              minPanelWidth={artifactPanelMinWidth}
              maxPanelWidth={artifactPanelMaxWidth}
              browserAddress={browserPreviewAddress}
              browserUrl={browserPreviewUrl}
              onBrowserAddressChange={handleBrowserPreviewAddressChange}
              onBrowserUrlChange={handleBrowserPreviewUrlChange}
              onOpenFileListTab={handleOpenArtifactFileListTab}
              onOpenBrowserTab={handleOpenArtifactBrowserTab}
              onBrowserAnnotationCaptured={handleBrowserAnnotationCaptured}
            />
          </ArtifactPanelErrorBoundary>
        </div>
      </div>
    )}
    </div>
    </div>
  );
};

export default CoworkSessionDetail;
