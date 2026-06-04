import crypto from 'crypto';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  session,
  shell,
  type WebContents,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';

import { CoworkSystemMessageKind } from '../common/coworkSystemMessages';
import type { OpenClawSessionPatch } from '../common/openclawSession';
import { buildSessionTitleFromInput } from '../common/sessionTitle';
import { buildScheduledTaskEnginePrompt } from '../scheduledTask/enginePrompt';
import {
  migrateScheduledTaskRunsToOpenclaw,
  migrateScheduledTasksToOpenclaw,
} from '../scheduledTask/migrate';
import { AgentId, AgentIpcChannel } from '../shared/agent/constants';
import { AppUpdateIpc } from '../shared/appUpdate/constants';
import { ArtifactBrowserPartition, ArtifactPreviewIpc, ArtifactPreviewProtocol } from '../shared/artifactPreview/constants';
import { AuthIpcChannel } from '../shared/auth/constants';
import {
  type BrowserDiagnosticResultStep,
  BrowserDiagnosticStatus,
  BrowserDiagnosticStep,
  BrowserIpc,
  BrowserRuntimeProfile,
  type BrowserWebAccessConfig,
  normalizeBrowserWebAccessConfig,
} from '../shared/browserWebAccess/constants';
import { ClipboardIpc } from '../shared/clipboard/constants';
import {
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  CoworkContextUsageFailureReason,
  CoworkContextUsageSource,
  CoworkForkMode,
  CoworkIpcChannel,
} from '../shared/cowork/constants';
import {
  buildCoworkImageAttachmentPreviews,
  type CoworkImageAttachmentPreview,
  formatCoworkImageAttachmentLimit,
  validateCoworkImageAttachmentSize,
} from '../shared/cowork/imageAttachments';
import {
  type CoworkSelectedTextSnippet,
  normalizeCoworkSelectedTextSnippets,
} from '../shared/cowork/selectedText';
import { DialogIpc } from '../shared/dialog/constants';
import {
  HtmlShareAccessMode,
  type HtmlShareConfigurableStatus,
  HtmlShareErrorCode,
  HtmlShareIpc,
  HtmlShareSourceType,
  HtmlShareStatus,
  type HtmlShareStatus as HtmlShareStatusValue,
} from '../shared/htmlShare/constants';
import type {
  KitReference,
  ResolvedKitCapabilities,
} from '../shared/kit/constants';
import {
  type ListLocalWebServicesOptions,
  type LocalWebService,
  LocalWebServicesIpc,
} from '../shared/localWebServices/constants';
import { PlatformRegistry } from '../shared/platform';
import { ProviderName } from '../shared/providers';
import type { ShellOpenFailureReason as ShellOpenFailureReasonType } from '../shared/shell/constants';
import { ShellOpenFailureReason } from '../shared/shell/constants';
import { AgentManager } from './agentManager';
import { APP_NAME } from './appConstants';
import { authQuotaGateStateFromQuota, AuthSubscriptionStatus, createDefaultAuthQuotaGateState, normalizeAuthQuota } from './authQuota';
import { getAutoLaunchEnabled, isAutoLaunched, setAutoLaunchEnabled } from './autoLaunchManager';
import { type CoworkForkContextMessage, type CoworkMessage, CoworkStore } from './coworkStore';
import { setLanguage, t } from './i18n';
import { IMGatewayConfig, IMGatewayManager } from './im';
import {
  approvePairingCode,
  listPairingRequests,
  readAllowFromStore,
  rejectPairingRequest,
} from './im/imPairingStore';
import { pollNimQrLogin, startNimQrLogin } from './im/nimQrLoginService';
import type {
  DingTalkInstanceConfig,
  DiscordInstanceConfig,
  EmailMultiInstanceConfig,
  FeishuInstanceConfig,
  NimInstanceConfig,
  Platform,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from './im/types';
import { registerAsrIpcHandlers } from './ipcHandlers/asr';
import { registerCoworkSubagentHandlers } from './ipcHandlers/coworkSubagent';
import { registerKitHandlers } from './ipcHandlers/kits';
import { registerMcpHandlers } from './ipcHandlers/mcp';
import { registerNimQrLoginHandlers } from './ipcHandlers/nimQrLogin';
import { registerPluginHandlers } from './ipcHandlers/plugins';
import {
  getCronJobService,
  initCronJobServiceManager,
  initScheduledTaskHelpers,
  registerScheduledTaskHandlers,
} from './ipcHandlers/scheduledTask';
import { registerSkillHandlers } from './ipcHandlers/skills';
import {
  type CoworkAgentEngine,
  CoworkEngineRouter,
  OpenClawRuntimeAdapter,
  type PermissionResult,
} from './libs/agentEngine';
import { AppUpdateCoordinator, INSTALLATION_UUID_KEY } from './libs/appUpdateCoordinator';
import { AuthCallbackRouter } from './libs/authCallbackRouter';
import {
  clearServerModelMetadata,
  getAllServerModelMetadata,
  getCurrentApiConfig,
  resolveAllEnabledProviderConfigs,
  resolveCurrentApiConfig,
  resolveRawApiConfig,
  setAuthTokensGetter,
  setServerBaseUrlGetter,
  setStoreGetter,
  updateServerModelMetadata,
} from './libs/claudeSettings';
import {
  clearCopilotTokenState,
  initCopilotTokenManager,
  refreshCopilotTokenNow,
  setCopilotTokenState,
} from './libs/copilotTokenManager';
import { saveCoworkApiConfig } from './libs/coworkConfigStore';
import { getCoworkLogPath } from './libs/coworkLogger';
import {
  registerProxyTokenRefresher,
  startCoworkOpenAICompatProxy,
  stopCoworkOpenAICompatProxy,
} from './libs/coworkOpenAICompatProxy';
import {
  generateSessionTitle,
  probeCoworkModelReadiness,
} from './libs/coworkUtil';
import {
  getHtmlSharePublicBaseUrl,
  getKitStoreUrl,
  getPortalTasksUrl,
  getServerApiBaseUrl,
  getSkillStoreUrl,
  refreshEndpointsTestMode,
} from './libs/endpoints';
import {
  mergeEnterpriseOpenclawConfig,
  resolveEnterpriseConfigPath,
  syncEnterpriseConfig,
} from './libs/enterpriseConfigSync';
import {
  createOfficePreviewSession,
  createPreviewSession,
  destroyPreviewSession,
  isPreviewServerUrl,
  stopHtmlPreviewServer,
} from './libs/htmlPreviewServer';
import {
  getHtmlShareBySource,
  updateHtmlShare,
  updateHtmlShareStatus,
  uploadHtmlShare,
} from './libs/htmlShare/htmlShareClient';
import { packageHtmlFile } from './libs/htmlShare/htmlSharePackager';
import { getKeyfromAttribution, initializeKeyfromAttribution } from './libs/keyfromAttribution';
import { exportLogsZip } from './libs/logExport';
import { type PersistedGeneratedImageAsset, persistGeneratedImageAssets, type PersistGeneratedImageAssetsResult, persistGeneratedVideoAssets, type RemoteGeneratedMediaAsset } from './libs/mediaAssetPersistence';
import { migrateAgentModelRefs, parsePrimaryModelRef, resolveQualifiedAgentModelRef } from './libs/openclawAgentModels';
import {
  buildManagedSessionKey,
  DEFAULT_MANAGED_AGENT_ID,
  OpenClawChannelSessionSync,
  parseManagedSessionKey,
} from './libs/openclawChannelSessionSync';
import {
  classifyAppConfigChange,
  classifyCoworkConfigChange,
  classifyImOpenClawConfigChange,
  createStableConfigFingerprint,
  OpenClawConfigImpact,
  OpenClawConfigImpactReason,
  removeImpactDecisionReasons,
} from './libs/openclawConfigImpact';
import { buildProviderSelection, OpenClawConfigSync } from './libs/openclawConfigSync';
import { OpenClawEngineManager, type OpenClawEngineStatus } from './libs/openclawEngineManager';
import {
  addMemoryEntry,
  deleteMemoryEntry,
  ensureDefaultIdentity,
  getMainAgentWorkspacePath,
  migrateSqliteToMemoryMd,
  readBootstrapFile,
  readMemoryEntries,
  resolveMemoryFilePath,
  searchMemoryEntries,
  updateMemoryEntry,
  writeBootstrapFile,
} from './libs/openclawMemoryFile';
import { collectReferencedEnvVarNames, pickReferencedSecretEnvVars } from './libs/openclawSecretEnv';
import { startOpenClawTokenProxy, stopOpenClawTokenProxy } from './libs/openclawTokenProxy';
import { migrateMainAgentWorkspace } from './libs/openclawWorkspaceMigration';
import { isHiddenUserPluginId } from './libs/pluginManager';
import { ensurePythonRuntimeReady } from './libs/pythonRuntime';
import { serializeForLog } from './libs/sanitizeForLog';
import { SqliteBackupManager } from './libs/sqliteBackup/sqliteBackupManager';
import { runStartupCacheWarmup } from './libs/startupCacheWarmup';
import {
  applySystemProxyEnv,
  resolveSystemProxyUrlForTargets,
  restoreOriginalProxyEnv,
  setSystemProxyEnabled,
} from './libs/systemProxy';
import { getLogFilePath, getRecentMainLogEntries, initLogger } from './logger';
import { type AskUserResponse, McpRuntime } from './mcp/mcpRuntime';
import {
  MediaGenerationGateReason,
  MediaGenerationTool,
  type MediaSelectionState,
  resolveMediaGenerationGate,
} from './mediaGenerationPolicy';
import {
  applyMediaReferencesToGenerationParams,
  type MediaAttachmentRefMain,
  MediaGenerationRequestType,
  summarizeMediaGenerationParamsForLog,
} from './mediaGenerationReferences';
import { OpenClawSessionIpc } from './openclawSession/constants';
import { OpenClawSessionPolicyIpc } from './openclawSessionPolicy/constants';
import {
  loadOpenClawSessionPolicyConfig,
  saveOpenClawSessionPolicyConfig,
} from './openclawSessionPolicy/store';
import { SkillManager } from './skillManager';
import { getSkillServiceManager } from './skillServices';
import { SqliteStore } from './sqliteStore';
import { StartupProfiler } from './startupProfiler';
import { SubagentMessageStore } from './subagentMessageStore';
import { SubagentRunStore } from './subagentRunStore';
import { createTray, destroyTray, updateTrayMenu } from './trayManager';
import {
  AppWindowStoreKey,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  resolveInitialAppWindowState,
} from './windowState';
import { createWindowStatePersistManager } from './windowStatePersist';

protocol.registerSchemesAsPrivileged([
  {
    scheme: ArtifactPreviewProtocol.LocalFile,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const gwDiagTs = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const tz = d.getTimezoneOffset();
  const sign = tz <= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  return `[GW-RESTART-DIAG] ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
};

// 设置应用程序名称
app.name = APP_NAME;
app.setName(APP_NAME);

const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;
const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_UPDATE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ENGINE_NOT_READY_CODE = 'ENGINE_NOT_READY';
const LOCAL_WEB_SERVICE_PROBE_TIMEOUT_MS = 700;
const LOCAL_WEB_SERVICE_TITLE_MAX_LENGTH = 80;
const LOCAL_WEB_SERVICE_PORTS = Array.from(
  new Set([
    3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3333, 4000, 4173, 5000, 5173,
    5174, 5175, 5176, 5177, 5178, 5179, 5180, 8000, 8080, 8081, 8888,
  ]),
).sort((a, b) => a - b);
const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
};

interface HtmlShareCreateFromHtmlFileInput {
  sessionId: string;
  artifactId: string;
  filePath: string;
  title: string;
}

interface HtmlShareUpdateFromHtmlFileInput extends HtmlShareCreateFromHtmlFileInput {
  shareId: string;
  currentStatus?: HtmlShareStatusValue;
}

interface HtmlShareGetByHtmlFileInput {
  filePath: string;
}

interface HtmlShareUpdateStatusInput {
  shareId: string;
  status: HtmlShareConfigurableStatus;
}

function sanitizeHtmlShareString(
  value: unknown,
  fieldName: string,
  maxLength = IPC_STRING_MAX_CHARS,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} is too long.`);
  }
  return trimmed;
}

function sanitizeHtmlShareTitle(value: unknown): string {
  return sanitizeHtmlShareString(value, 'title', 255);
}

function validateHtmlShareAccessMode(value: unknown): void {
  if (value === undefined) return;
  const accessMode = sanitizeHtmlShareString(value, 'accessMode', 32);
  if (accessMode !== HtmlShareAccessMode.Code) {
    throw new Error('accessMode must be code.');
  }
}

function sanitizeHtmlShareConfigurableStatus(
  value: unknown,
): HtmlShareConfigurableStatus | undefined {
  if (value === undefined) return undefined;
  const status = sanitizeHtmlShareString(value, 'status', 32);
  if (status !== HtmlShareStatus.Live && status !== HtmlShareStatus.Disabled) {
    throw new Error('status must be live or disabled.');
  }
  return status;
}

function sanitizeHtmlShareStatus(value: unknown): HtmlShareStatusValue | undefined {
  if (value === undefined) return undefined;
  const status = sanitizeHtmlShareString(value, 'currentStatus', 32);
  if (
    status !== HtmlShareStatus.Live &&
    status !== HtmlShareStatus.Disabled &&
    status !== HtmlShareStatus.Failed
  ) {
    throw new Error('currentStatus must be live, disabled, or failed.');
  }
  return status;
}

function sanitizeCreateFromHtmlFileInput(input: unknown): HtmlShareCreateFromHtmlFileInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid HTML share request.');
  }
  const source = input as Record<string, unknown>;
  validateHtmlShareAccessMode(source.accessMode);
  return {
    sessionId: sanitizeHtmlShareString(source.sessionId, 'sessionId', 128),
    artifactId: sanitizeHtmlShareString(source.artifactId, 'artifactId', 128),
    filePath: sanitizeHtmlShareString(source.filePath, 'filePath', 4096),
    title: sanitizeHtmlShareTitle(source.title),
  };
}

function sanitizeUpdateFromHtmlFileInput(input: unknown): HtmlShareUpdateFromHtmlFileInput {
  const source = sanitizeCreateFromHtmlFileInput(input);
  const record = input as Record<string, unknown>;
  return {
    ...source,
    shareId: sanitizeHtmlShareString(record.shareId, 'shareId', 64),
    currentStatus: sanitizeHtmlShareStatus(record.currentStatus),
  };
}

function sanitizeGetByHtmlFileInput(input: unknown): HtmlShareGetByHtmlFileInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid HTML share lookup request.');
  }
  const source = input as Record<string, unknown>;
  return {
    filePath: sanitizeHtmlShareString(source.filePath, 'filePath', 4096),
  };
}

function sanitizeUpdateHtmlShareStatusInput(input: unknown): HtmlShareUpdateStatusInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid HTML share status request.');
  }
  const source = input as Record<string, unknown>;
  const status = sanitizeHtmlShareConfigurableStatus(source.status);
  if (!status) {
    throw new Error('status is required.');
  }
  return {
    shareId: sanitizeHtmlShareString(source.shareId, 'shareId', 64),
    status,
  };
}

function normalizeHtmlShareSourceFilePath(filePath: string): string {
  let normalized = filePath.trim();
  if (/^file:\/\//i.test(normalized)) {
    normalized = safeDecodeURIComponent(normalized.replace(/^file:\/\//i, ''));
  }
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  normalized = path.resolve(normalized).replace(/\\/g, '/');
  return normalized.toLowerCase();
}

function buildHtmlShareClientSourceKey(filePath: string): string {
  const normalizedPath = normalizeHtmlShareSourceFilePath(filePath);
  return crypto
    .createHash('sha256')
    .update(`${HtmlShareSourceType.HtmlFile}:${normalizedPath}`)
    .digest('hex');
}

const cleanHtmlTitle = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, LOCAL_WEB_SERVICE_TITLE_MAX_LENGTH);

const extractHtmlTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return cleanHtmlTitle(
    match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
};

const probeLocalWebService = async (port: number): Promise<LocalWebService | null> => {
  const url = `http://localhost:${port}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_WEB_SERVICE_PROBE_TIMEOUT_MS);

  try {
    const response = await session.defaultSession.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return null;
    }

    const html = await response.text();
    const title = extractHtmlTitle(html) || `localhost:${port}`;
    return {
      id: `localhost:${port}`,
      title,
      url,
      host: 'localhost',
      port,
      online: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const sanitizeLocalWebServicePorts = (ports: unknown): number[] => {
  if (!Array.isArray(ports)) return [];
  return Array.from(
    new Set(
      ports
        .filter((port): port is number => Number.isInteger(port) && port > 0 && port <= 65535)
        .slice(0, IPC_MAX_ITEMS),
    ),
  );
};
const LOCAL_FILE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

type ByteRange = {
  start: number;
  end: number;
};

function getLocalFileProtocolPath(requestUrl: string): string {
  const url = new URL(requestUrl);
  let filePath = decodeURIComponent(url.pathname);
  if (url.host && process.platform !== 'win32') {
    filePath = `/${decodeURIComponent(url.host)}${filePath}`;
  }
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return filePath;
}

function getLocalFileMimeType(filePath: string): string {
  return LOCAL_FILE_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function parseByteRange(rangeHeader: string | null, fileSize: number): ByteRange | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, startText, endText] = match;
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: Math.max(fileSize - 1, 0),
    };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : fileSize - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  };
}

async function createLocalFileProtocolResponse(request: Request): Promise<Response> {
  try {
    const filePath = getLocalFileProtocolPath(request.url);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return new Response('Not found', { status: 404 });
    }

    const mimeType = getLocalFileMimeType(filePath);
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType,
    };
    const rangeHeader = request.headers.get('range');
    const range = parseByteRange(rangeHeader, stat.size);

    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${stat.size}`,
        },
      });
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      return new Response(
        Readable.toWeb(fs.createReadStream(filePath, { start: range.start, end: range.end })) as BodyInit,
        {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(contentLength),
            'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
          },
        },
      );
    }

    return new Response(
      Readable.toWeb(fs.createReadStream(filePath)) as BodyInit,
      {
        status: 200,
        headers: {
          ...baseHeaders,
          'Content-Length': String(stat.size),
        },
      },
    );
  } catch (error) {
    console.warn('[ArtifactPreview] local file request failed:', error);
    return new Response('Not found', { status: 404 });
  }
}

function sanitizeOptionalPatchValue(
  value: unknown,
  maxChars = IPC_STRING_MAX_CHARS,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('Session patch value must be a string or null.');
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error('Session patch value is too long.');
  }
  return trimmed;
}

function sanitizeOpenClawSessionPatch(input: unknown): OpenClawSessionPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid session patch payload.');
  }

  const source = input as Record<string, unknown>;
  const patch: OpenClawSessionPatch = {};

  const model = sanitizeOptionalPatchValue(source.model);
  if (model !== undefined) patch.model = model;

  const thinkingLevel = sanitizeOptionalPatchValue(source.thinkingLevel);
  if (thinkingLevel !== undefined) patch.thinkingLevel = thinkingLevel;

  const reasoningLevel = sanitizeOptionalPatchValue(source.reasoningLevel);
  if (reasoningLevel !== undefined) patch.reasoningLevel = reasoningLevel;

  const elevatedLevel = sanitizeOptionalPatchValue(source.elevatedLevel);
  if (elevatedLevel !== undefined) patch.elevatedLevel = elevatedLevel;

  const responseUsage = sanitizeOptionalPatchValue(source.responseUsage);
  if (responseUsage !== undefined)
    patch.responseUsage = responseUsage as OpenClawSessionPatch['responseUsage'];

  const sendPolicy = sanitizeOptionalPatchValue(source.sendPolicy);
  if (sendPolicy !== undefined) patch.sendPolicy = sendPolicy as OpenClawSessionPatch['sendPolicy'];

  if (Object.keys(patch).length === 0) {
    throw new Error('Session patch is empty.');
  }

  return patch;
}

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const resolveDefaultAgentModelRef = (): string => {
  const apiResolution = resolveRawApiConfig();
  const config = apiResolution.config;
  if (!config?.model?.trim()) {
    return '';
  }

  return buildProviderSelection({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    modelId: config.model.trim(),
    apiType: config.apiType,
    providerName: apiResolution.providerMetadata?.providerName,
    authType: apiResolution.providerMetadata?.authType,
    codingPlanEnabled: apiResolution.providerMetadata?.codingPlanEnabled,
    supportsImage: apiResolution.providerMetadata?.supportsImage,
    modelName: apiResolution.providerMetadata?.modelName,
  }).primaryModel;
};

const buildAvailableOpenClawProviders = (): Record<string, { models: Array<{ id: string }> }> => {
  const providerMap: Record<string, { models: Array<{ id: string }> }> = {};

  for (const provider of resolveAllEnabledProviderConfigs()) {
    for (const model of provider.models) {
      const selection = buildProviderSelection({
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        modelId: model.id,
        apiType: provider.apiType,
        providerName: provider.providerName,
        authType: provider.authType,
        codingPlanEnabled: provider.codingPlanEnabled,
        supportsImage: model.supportsImage,
        modelName: model.name,
      });

      if (!providerMap[selection.providerId]) {
        providerMap[selection.providerId] = { models: [] };
      }
      if (
        !providerMap[selection.providerId].models.some(
          entry => entry.id === selection.sessionModelId,
        )
      ) {
        providerMap[selection.providerId].models.push({ id: selection.sessionModelId });
      }
    }
  }

  return providerMap;
};

const normalizeOpenClawModelRef = (modelRef: string): string => {
  const normalized = modelRef.trim();
  if (!normalized) return normalized;

  const qualification = resolveQualifiedAgentModelRef({
    agentModel: normalized,
    availableProviders: buildAvailableOpenClawProviders(),
  });

  return qualification.status === 'qualified' ? qualification.primaryModel : normalized;
};

const sanitizeAttachmentFileName = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'attachment';
  const fileName = path.basename(raw);
  const sanitized = fileName.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
};

const inferAttachmentExtension = (fileName: string, mimeType?: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (typeof mimeType === 'string') {
    const normalized = mimeType.toLowerCase().split(';')[0].trim();
    return MIME_EXTENSION_MAP[normalized] ?? '';
  }
  return '';
};

const resolveInlineAttachmentDir = (cwd?: string): string => {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
  if (trimmed) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, '.cowork-temp', 'attachments', 'manual');
    }
  }
  return path.join(app.getPath('temp'), 'lobsterai', 'attachments');
};

const ensurePngFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.png') ? value : `${value}.png`;
};

const ensureZipFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.zip') ? value : `${value}.zip`;
};

const padTwoDigits = (value: number): string => value.toString().padStart(2, '0');

const buildLogExportFileName = (): string => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${padTwoDigits(now.getMonth() + 1)}${padTwoDigits(now.getDate())}`;
  const timePart = `${padTwoDigits(now.getHours())}${padTwoDigits(now.getMinutes())}${padTwoDigits(now.getSeconds())}`;
  return `lobsterai-logs-${datePart}-${timePart}.zip`;
};

const OPENCLAW_DAILY_LOG_RETENTION_DAYS = 7;
const OPENCLAW_DAILY_LOG_RE = /^openclaw-\d{4}-\d{2}-\d{2}\.log$/;

function getRecentOpenClawDailyLogEntries(
  logDir: string | null,
): Array<{ archiveName: string; filePath: string }> {
  if (!logDir || !fs.existsSync(logDir)) return [];

  const cutoffMs = Date.now() - OPENCLAW_DAILY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return fs
    .readdirSync(logDir)
    .filter(f => OPENCLAW_DAILY_LOG_RE.test(f))
    .map(f => ({ archiveName: f, filePath: path.join(logDir, f) }))
    .filter(({ filePath }) => {
      try {
        return fs.statSync(filePath).mtimeMs >= cutoffMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName));
}

const truncateIpcString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated in main IPC forwarding]`;
};

const sanitizeIpcPayload = (value: unknown, depth = 0, seen?: WeakSet<object>): unknown => {
  const localSeen = seen ?? new WeakSet<object>();
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateIpcString(value, IPC_STRING_MAX_CHARS);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (depth >= IPC_MAX_DEPTH) {
    return '[truncated-depth]';
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, IPC_MAX_ITEMS)
      .map(entry => sanitizeIpcPayload(entry, depth + 1, localSeen));
    if (value.length > IPC_MAX_ITEMS) {
      result.push(`[truncated-items:${value.length - IPC_MAX_ITEMS}]`);
    }
    return result;
  }
  if (typeof value === 'object') {
    if (localSeen.has(value as object)) {
      return '[circular]';
    }
    localSeen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, IPC_MAX_KEYS)) {
      result[key] = sanitizeIpcPayload(entry, depth + 1, localSeen);
    }
    if (entries.length > IPC_MAX_KEYS) {
      result.__truncated_keys__ = entries.length - IPC_MAX_KEYS;
    }
    return result;
  }
  return String(value);
};

const sanitizeCoworkMessageForIpc = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const messageRecord = message as { metadata?: unknown; content?: unknown };

  // Preserve image metadata as-is; previews are already size-bounded, while
  // legacy imageAttachments may contain historical base64 payloads.
  let sanitizedMetadata: unknown;
  if (messageRecord.metadata && typeof messageRecord.metadata === 'object') {
    const { imageAttachments, imageAttachmentPreviews, ...rest } = messageRecord.metadata as Record<string, unknown>;
    const sanitizedRest = sanitizeIpcPayload(rest) as Record<string, unknown> | undefined;
    sanitizedMetadata = {
      ...(sanitizedRest && typeof sanitizedRest === 'object' ? sanitizedRest : {}),
      ...(Array.isArray(imageAttachments) && imageAttachments.length > 0
        ? { imageAttachments }
        : {}),
      ...(Array.isArray(imageAttachmentPreviews) && imageAttachmentPreviews.length > 0
        ? { imageAttachmentPreviews }
        : {}),
    };
  } else {
    sanitizedMetadata = undefined;
  }

  return {
    ...message,
    content:
      typeof messageRecord.content === 'string'
        ? truncateIpcString(messageRecord.content, IPC_MESSAGE_CONTENT_MAX_CHARS)
        : '',
    metadata: sanitizedMetadata,
  };
};

const sanitizePermissionRequestForIpc = (request: unknown): unknown => {
  if (!request || typeof request !== 'object') {
    return request;
  }
  const requestRecord = request as { toolInput?: unknown };
  return {
    ...request,
    toolInput: sanitizeIpcPayload(requestRecord.toolInput ?? {}),
  };
};

type CaptureRect = { x: number; y: number; width: number; height: number };

const normalizeCaptureRect = (rect?: Partial<CaptureRect> | null): CaptureRect | null => {
  if (!rect) return null;
  const normalized = {
    x: Math.max(0, Math.round(typeof rect.x === 'number' ? rect.x : 0)),
    y: Math.max(0, Math.round(typeof rect.y === 'number' ? rect.y : 0)),
    width: Math.max(0, Math.round(typeof rect.width === 'number' ? rect.width : 0)),
    height: Math.max(0, Math.round(typeof rect.height === 'number' ? rect.height : 0)),
  };
  return normalized.width > 0 && normalized.height > 0 ? normalized : null;
};

const resolveTaskWorkingDirectory = (workspaceRoot: string): string => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  // Reject bare Windows drive roots (e.g. "D:\") — mkdir on drive roots causes EPERM,
  // and some agent engines (OpenClaw) also fail when given a drive root as workspace.
  if (process.platform === 'win32' && /^[a-zA-Z]:\\?$/.test(resolvedWorkspaceRoot)) {
    throw new Error(
      `Cannot use a drive root as the working directory (${resolvedWorkspaceRoot}). Please select a subfolder instead, for example: ${resolvedWorkspaceRoot}Projects`,
    );
  }
  if (!fs.existsSync(resolvedWorkspaceRoot)) {
    fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  }
  if (!fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`Selected workspace is not a directory: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

const getDefaultExportImageName = (defaultFileName?: string): string => {
  const normalized =
    typeof defaultFileName === 'string' && defaultFileName.trim()
      ? defaultFileName.trim()
      : `cowork-session-${Date.now()}`;
  return ensurePngFileName(sanitizeExportFileName(normalized));
};

const savePngWithDialog = async (
  webContents: WebContents,
  pngData: Buffer,
  defaultFileName?: string,
): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> => {
  const defaultName = getDefaultExportImageName(defaultFileName);
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const saveOptions = {
    title: 'Export Session Image',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  };
  const saveResult = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: true, canceled: true };
  }

  const outputPath = ensurePngFileName(saveResult.filePath);
  await fs.promises.writeFile(outputPath, pngData);
  return { success: true, canceled: false, path: outputPath };
};

const configureUserDataPath = (): void => {
  const appDataPath = app.getPath('appData');
  const preferredUserDataPath = path.join(appDataPath, APP_NAME);
  const currentUserDataPath = app.getPath('userData');

  if (currentUserDataPath !== preferredUserDataPath) {
    app.setPath('userData', preferredUserDataPath);
    console.log(`[Main] userData path updated: ${currentUserDataPath} -> ${preferredUserDataPath}`);
  }
};

configureUserDataPath();
initLogger();

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5175';
const enableVerboseLogging =
  process.env.ELECTRON_ENABLE_LOGGING === '1' || process.env.ELECTRON_ENABLE_LOGGING === 'true';
const disableGpu =
  process.env.LOBSTERAI_DISABLE_GPU === '1' ||
  process.env.LOBSTERAI_DISABLE_GPU === 'true' ||
  process.env.ELECTRON_DISABLE_GPU === '1' ||
  process.env.ELECTRON_DISABLE_GPU === 'true';
const reloadOnChildProcessGone =
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === '1' ||
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === 'true';
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_COLORS = {
  dark: { color: '#0F1117', symbolColor: '#E4E5E9' },
  // Align light title bar with app light surface-muted tone to reduce visual contrast.
  light: { color: '#F3F4F6', symbolColor: '#1A1D23' },
} as const;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeWindowsShellPath = (inputPath: string): string => {
  const trimmed = inputPath.trim();
  if (!trimmed) return inputPath;

  let normalized = trimmed;
  if (/^(?:file|localfile):\/\//i.test(normalized)) {
    normalized = safeDecodeURIComponent(normalized.replace(/^(?:file|localfile):\/\//i, ''));
  }

  if (!isWindows) {
    return normalized;
  }

  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }

  const unixDriveMatch = normalized.match(/^[/\\]([A-Za-z])[/\\](.+)$/);
  if (unixDriveMatch) {
    const drive = unixDriveMatch[1].toUpperCase();
    const rest = unixDriveMatch[2].replace(/[/\\]+/g, '\\');
    return `${drive}:\\${rest}`;
  }

  if (/^[A-Za-z]:[/\\]/.test(normalized)) {
    const drive = normalized[0].toUpperCase();
    const rest = normalized.slice(1).replace(/\//g, '\\');
    return `${drive}${rest}`;
  }

  return normalized;
};

// ==================== macOS Permissions ====================

/**
 * Check calendar permission on macOS by attempting to access Calendar app
 * Returns: 'authorized' | 'denied' | 'restricted' | 'not-determined'
 * On Windows, checks if Outlook is available
 * On Linux, returns 'not-supported'
 */
const checkCalendarPermission = async (): Promise<string> => {
  if (process.platform === 'darwin') {
    try {
      // Try to access Calendar to check permission
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Quick test to see if we can access Calendar
      await execAsync('osascript -l JavaScript -e \'Application("Calendar").name()\'', {
        timeout: 5000,
      });
      console.log('[Permissions] macOS Calendar access: authorized');
      return 'authorized';
    } catch (error: unknown) {
      const stderr =
        typeof error === 'object' && error && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr ?? '')
          : '';
      // Check if it's a permission error
      if (
        stderr.includes('不能获取对象') ||
        stderr.includes('not authorized') ||
        stderr.includes('Permission denied')
      ) {
        console.log('[Permissions] macOS Calendar access: not-determined (needs permission)');
        return 'not-determined';
      }
      console.warn('[Permissions] Failed to check macOS calendar permission:', error);
      return 'not-determined';
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a system-level calendar permission like macOS
    // Instead, we check if Outlook is available
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Check if Outlook COM object is accessible
      const checkScript = `
        try {
          $Outlook = New-Object -ComObject Outlook.Application
          $Outlook.Version
        } catch { exit 1 }
      `;
      await execAsync('powershell -Command "' + checkScript + '"', { timeout: 10000 });
      console.log('[Permissions] Windows Outlook is available');
      return 'authorized';
    } catch {
      console.log('[Permissions] Windows Outlook not available or not accessible');
      return 'not-determined';
    }
  }

  return 'not-supported';
};

/**
 * Request calendar permission on macOS
 * On Windows, attempts to initialize Outlook COM object
 */
const requestCalendarPermission = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    try {
      // On macOS, we trigger permission by trying to access Calendar
      // The system will show permission dialog if needed
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      await execAsync(
        'osascript -l JavaScript -e \'Application("Calendar").calendars()[0].name()\'',
        { timeout: 10000 },
      );
      return true;
    } catch (error) {
      console.warn('[Permissions] Failed to request macOS calendar permission:', error);
      return false;
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a permission dialog for COM objects
    // We just check if Outlook is available
    const status = await checkCalendarPermission();
    return status === 'authorized';
  }

  return false;
};

// 配置应用
// Linux/Windows 禁用 Chromium 沙箱：桌面应用渲染自有代码，风险可控；
// Windows 下以管理员运行时沙箱无法降权会导致 GPU 进程启动失败 (error_code=18)
if (isLinux || isWindows) {
  app.commandLine.appendSwitch('no-sandbox');
}
if (isLinux) {
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}
if (disableGpu) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  // 禁用硬件加速
  app.disableHardwareAcceleration();
}
if (enableVerboseLogging) {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}

// 配置网络服务
app.on('ready', () => {
  // 配置网络服务重启策略
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'off',
  });
});

// 添加错误处理
app.on('render-process-gone', (_event, webContents, details) => {
  console.error('Render process gone:', details);
  const shouldReload =
    details.reason === 'crashed' ||
    details.reason === 'killed' ||
    details.reason === 'oom' ||
    details.reason === 'launch-failed' ||
    details.reason === 'integrity-failure';
  if (shouldReload) {
    scheduleReload(`render-process-gone (${details.reason})`, webContents);
  }
});

app.on('child-process-gone', (_event, details) => {
  console.error('Child process gone:', details);
  if (reloadOnChildProcessGone && (details.type === 'GPU' || details.type === 'Utility')) {
    scheduleReload(`child-process-gone (${details.type}/${details.reason})`);
  }
});

// 处理未捕获的异常
process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection:', error);
});

process.on('exit', code => {
  console.log(`[Main] Process exiting with code: ${code}`);
});

let store: SqliteStore | null = null;
let coworkStore: CoworkStore | null = null;
let openClawRuntimeAdapter: OpenClawRuntimeAdapter | null = null;
let coworkEngineRouter: CoworkEngineRouter | null = null;
let skillManager: SkillManager | null = null;
let mcpRuntime: McpRuntime | null = null;
let imGatewayManager: IMGatewayManager | null = null;
let storeInitPromise: Promise<SqliteStore> | null = null;
let sqliteBackupManager: SqliteBackupManager | null = null;
let openClawEngineManager: OpenClawEngineManager | null = null;
let openClawConfigSync: OpenClawConfigSync | null = null;
let openClawBootstrapPromise: Promise<OpenClawEngineStatus> | null = null;
let cachedSubscriptionStatus: string = AuthSubscriptionStatus.Free;
let cachedMediaGenerationEntitled = false;
let openClawStatusForwarderBound = false;
let coworkRuntimeForwarderBound = false;
let memoryMigrationDone = false;
let preventSleepBlockerId: number | null = null;
let appUpdateCoordinator: AppUpdateCoordinator | null = null;

const AUTH_USER_STORE_KEY = 'auth_user';

function setPreventSleepBlockerEnabled(enabled: boolean): void {
  if (enabled) {
    if (preventSleepBlockerId === null || !powerSaveBlocker.isStarted(preventSleepBlockerId)) {
      preventSleepBlockerId = powerSaveBlocker.start(PowerSaveBlockerType.PreventAppSuspension);
    }
    return;
  }

  if (preventSleepBlockerId !== null && powerSaveBlocker.isStarted(preventSleepBlockerId)) {
    powerSaveBlocker.stop(preventSleepBlockerId);
  }
  preventSleepBlockerId = null;
}

const initStore = async (): Promise<SqliteStore> => {
  if (!storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('Store accessed before app is ready.');
    }
    // better-sqlite3 opens the database synchronously, so Promise.resolve() resolves
    // immediately. The timeout acts as a safety net for unexpected OS-level
    // blocking during store initialization and recovery.
    storeInitPromise = Promise.race([
      SqliteStore.create(app.getPath('userData')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Store initialization timed out after 15s')), 15_000),
      ),
    ]);
  }
  return storeInitPromise;
};

const getStore = (): SqliteStore => {
  if (!store) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return store;
};

const getOpenClawEngineManager = (): OpenClawEngineManager => {
  if (!openClawEngineManager) {
    openClawEngineManager = new OpenClawEngineManager();
  }
  return openClawEngineManager;
};

const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!appUpdateCoordinator) {
    appUpdateCoordinator = new AppUpdateCoordinator(getStore());
  }
  return appUpdateCoordinator;
};

const forwardOpenClawStatus = (status: OpenClawEngineStatus): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send('openclaw:engine:onProgress', status);
    } catch (error) {
      console.error('Failed to forward OpenClaw engine status:', error);
    }
  });
};

const bindOpenClawStatusForwarder = (): void => {
  if (openClawStatusForwarderBound) return;
  const manager = getOpenClawEngineManager();
  manager.on('status', status => {
    forwardOpenClawStatus(status);
  });
  openClawStatusForwarderBound = true;
  forwardOpenClawStatus(manager.getStatus());
};

const getEngineNotReadyResponse = (status: OpenClawEngineStatus) => {
  const fallbackMessage = 'AI engine is initializing. Please try again in a moment.';
  return {
    success: false,
    code: ENGINE_NOT_READY_CODE,
    error: status.message || fallbackMessage,
    engineStatus: status,
  };
};

const bootstrapOpenClawEngine = async (
  options: { forceReinstall?: boolean; reason?: string } = {},
) => {
  if (openClawBootstrapPromise) {
    return openClawBootstrapPromise;
  }

  const manager = getOpenClawEngineManager();
  bindOpenClawStatusForwarder();

  const task = async (): Promise<OpenClawEngineStatus> => {
    const reason = options.reason || 'unknown';
    const t0 = Date.now();
    const elapsed = () => `${Date.now() - t0}ms`;
    try {
      console.log(`[OpenClaw] bootstrap starting (reason=${reason})`);

      // Start AskUser HTTP server before config sync
      await startAskUserServer().catch((err: unknown) => {
        console.error(`[OpenClaw] bootstrap: AskUser server startup failed (non-fatal):`, err);
      });
      console.log(
        `[OpenClaw] bootstrap: AskUser server setup done (${elapsed()}), askUserUrl=${getMcpRuntime().getAskUserCallbackUrl() || 'null'}`,
      );

      // Ensure IDENTITY.md has default content in the main agent workspace
      try {
        ensureDefaultIdentity(getMainAgentWorkspacePath(manager.getStateDir()));
      } catch (err) {
        console.warn('[OpenClaw] bootstrap: ensureDefaultIdentity failed (non-fatal):', err);
      }

      const syncResult = await syncOpenClawConfig({
        reason: `bootstrap:${reason}`,
        restartGatewayIfRunning: false,
      });
      console.log(
        `[OpenClaw] bootstrap: syncOpenClawConfig done (${elapsed()}), success=${syncResult.success}`,
      );
      if (!syncResult.success) {
        return syncResult.status || manager.getStatus();
      }
      if (options.forceReinstall) {
        console.log(
          `${gwDiagTs()} bootstrap: forceReinstall requested, stopping gateway before reinstall`,
        );
        await manager.stopGateway();
        console.log(`[OpenClaw] bootstrap: stopGateway done (${elapsed()})`);
      }
      const ensuredStatus = await manager.ensureReady();
      console.log(
        `[OpenClaw] bootstrap: ensureReady done (${elapsed()}), phase=${ensuredStatus.phase}`,
      );
      if (ensuredStatus.phase !== 'ready' && ensuredStatus.phase !== 'running') {
        return ensuredStatus;
      }
      const result = await manager.startGateway(`bootstrap:${reason}`);
      console.log(`[OpenClaw] bootstrap completed (${elapsed()}), phase=${result.phase}`);
      return result;
    } catch (error) {
      console.error(`[OpenClaw] bootstrap failed (${reason}, ${elapsed()}):`, error);
      return manager.getStatus();
    }
  };

  const promise = task().finally(() => {
    if (openClawBootstrapPromise === promise) {
      openClawBootstrapPromise = null;
    }
  });
  openClawBootstrapPromise = promise;
  return promise;
};

// Module-level handle so ensureOpenClawRunningForCowork can await any in-flight
// proactive token refresh before syncing config to the gateway.
let pendingTokenRefresh: Promise<string | null> | null = null;

const ensureOpenClawRunningForCowork = async () => {
  const configApplyStatus = await waitForOpenClawConfigApply('cowork engine startup');
  if (configApplyStatus) {
    return configApplyStatus;
  }

  const manager = getOpenClawEngineManager();
  const status = manager.getStatus();
  if (status.phase === 'running') {
    // Token proxy handles dynamic token injection — no need to restart
    // the gateway for token changes. Just wait for any in-flight refresh.
    if (pendingTokenRefresh) {
      console.log('[OpenClaw] ensureRunning: awaiting pending token refresh before proceeding');
      await pendingTokenRefresh.catch(() => {});
    }
    return manager.getStatus();
  }
  if (status.phase === 'starting') {
    return status;
  }

  // Wait for any in-flight token refresh so that the gateway starts with
  // a fresh token rather than the stale one that triggered the refresh.
  if (pendingTokenRefresh) {
    console.log('[OpenClaw] ensureRunning: awaiting pending token refresh before gateway start');
    await pendingTokenRefresh.catch(() => {});
  }

  // Ensure AskUser server is started and config is synced before launching the gateway,
  // so that mcp.servers config is available in openclaw.json when the gateway loads.
  await startAskUserServer().catch((err: unknown) => {
    console.error('[OpenClaw] ensureRunning: AskUser server startup failed (non-fatal):', err);
  });
  const syncResult = await syncOpenClawConfig({
    reason: 'ensureRunning:mcpConfig',
    restartGatewayIfRunning: false,
  });
  if (!syncResult.success) {
    console.error('[OpenClaw] ensureRunning: config sync failed:', syncResult.error);
  }

  console.log(`${gwDiagTs()} ensureRunning: gateway not running (phase=${status.phase}), starting`);
  return await manager.startGateway('ensure-running-for-cowork');
};

const getCoworkStore = () => {
  if (!coworkStore) {
    const sqliteStore = getStore();
    coworkStore = new CoworkStore(sqliteStore.getDatabase());
    const cleaned = coworkStore.autoDeleteNonPersonalMemories();
    if (cleaned > 0) {
      console.info(`[cowork-memory] Auto-deleted ${cleaned} non-personal/procedural memories`);
    }
  }
  return coworkStore;
};

let agentManager: AgentManager | null = null;
const getAgentManager = () => {
  if (!agentManager) {
    agentManager = new AgentManager(getCoworkStore());
  }
  return agentManager;
};

const resolveAgentDefaultWorkingDirectory = (agentId?: string): string => {
  const resolvedAgentId = agentId?.trim() || 'main';
  const agentWorkingDirectory = getAgentManager()
    .getAgent(resolvedAgentId)
    ?.workingDirectory?.trim();
  if (agentWorkingDirectory) return agentWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};

const resolveSessionWorkingDirectory = (options: { cwd?: string; agentId?: string }): string => {
  const explicitWorkingDirectory = options.cwd?.trim();
  if (explicitWorkingDirectory) return explicitWorkingDirectory;
  return resolveAgentDefaultWorkingDirectory(options.agentId);
};

const isLobsteraiServerModelRef = (modelRef: string): boolean => {
  const normalized = modelRef.trim();
  if (!normalized) return false;

  const parsed = parsePrimaryModelRef(normalized);
  if (parsed) {
    return parsed.providerId === ProviderName.LobsteraiServer;
  }

  return getAllServerModelMetadata().some(model => model.modelId === normalized);
};

const shouldRefreshServerQuotaForSession = (sessionId: string): boolean => {
  const session = getCoworkStore().getSession(sessionId);
  const sessionModelRef = session?.modelOverride?.trim();
  if (sessionModelRef) {
    return isLobsteraiServerModelRef(sessionModelRef);
  }

  const agentModelRef = session?.agentId
    ? getAgentManager().getAgent(session.agentId)?.model?.trim()
    : '';
  if (agentModelRef) {
    return isLobsteraiServerModelRef(agentModelRef);
  }

  const apiConfig = resolveCurrentApiConfig();
  return apiConfig.providerMetadata?.providerName === ProviderName.LobsteraiServer;
};

const resolveCoworkAgentEngine = (): CoworkAgentEngine => {
  return 'openclaw';
};

const getOpenClawConfigSync = (): OpenClawConfigSync => {
  if (!openClawConfigSync) {
    openClawConfigSync = new OpenClawConfigSync({
      engineManager: getOpenClawEngineManager(),
      getCoworkConfig: () => getCoworkStore().getConfig(),
      getBrowserWebAccessConfig: () => getStore().get<AppConfigSettings>('app_config')?.browserWebAccess,
      isEnterprise: () => !!getStore().get('enterprise_config'),
      getOpenClawSessionPolicy: () => loadOpenClawSessionPolicyConfig(getStore()),
      getSkillsList: () =>
        getSkillManager()
          .listSkills()
          .map(s => ({ id: s.id, enabled: s.enabled })),
      getTelegramInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getTelegramInstances();
        } catch {
          return [];
        }
      },
      getDingTalkInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getDingTalkInstances();
        } catch {
          return [];
        }
      },
      getFeishuInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getFeishuInstances();
        } catch {
          return [];
        }
      },
      getQQInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getQQInstances();
        } catch {
          return [];
        }
      },
      getWecomInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getWecomInstances();
        } catch {
          return [];
        }
      },
      getPopoInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getPopoInstances();
        } catch {
          return [];
        }
      },
      getEmailOpenClawConfig: () => {
        try {
          return getIMGatewayManager().getIMStore().getEmailConfig();
        } catch {
          return { instances: [] };
        }
      },
      getNimInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getNimInstances();
        } catch {
          return [];
        }
      },
      getNeteaseBeeChanConfig: () => {
        try {
          return getIMGatewayManager().getConfig()['netease-bee'];
        } catch {
          return null;
        }
      },
      getWeixinConfig: () => {
        try {
          return getIMGatewayManager().getConfig().weixin;
        } catch {
          return null;
        }
      },
      getIMSettings: () => {
        try {
          return getIMGatewayManager().getConfig().settings;
        } catch {
          return null;
        }
      },
      getDiscordInstances: () => {
        try {
          return getIMGatewayManager()?.getIMStore()?.getDiscordInstances() ?? [];
        } catch {
          return [];
        }
      },
      getResolvedMcpServers: () => {
        // Synchronous wrapper: returns last resolved servers from cache.
        // The async resolution happens during syncOpenClawConfig via McpRuntime.
        return getMcpRuntime().getResolvedServersCache();
      },
      getAskUserCallbackUrl: () => getMcpRuntime().getAskUserCallbackUrl(),
      getMediaCallbackUrl: () => getMcpRuntime().getMediaCallbackUrl(),
      getMcpBridgeSecret: () => getMcpRuntime().getBridgeSecret(),
      getAgents: () => getCoworkStore().listAgents(),
      getUserPlugins: () =>
        getCoworkStore()
          .listUserPlugins()
          .filter(p => !isHiddenUserPluginId(p.pluginId))
          .map(p => ({ pluginId: p.pluginId, enabled: p.enabled, config: p.config })),
      canUseMediaGeneration: () => cachedMediaGenerationEntitled,
    });
  }
  return openClawConfigSync;
};

// Deferred gateway restart: when a config change requires a gateway restart
// but active cowork sessions or cron jobs exist, we defer the restart until
// all workloads complete.  A polling interval checks periodically; a hard
// timeout ensures the restart eventually happens even if a session hangs.
let deferredRestartTimer: ReturnType<typeof setInterval> | null = null;
let deferredRestartTimeout: ReturnType<typeof setTimeout> | null = null;
const DEFERRED_RESTART_POLL_MS = 3_000;
const DEFERRED_RESTART_MAX_WAIT_MS = 5 * 60_000; // 5 minutes hard cap

const hasActiveGatewayWorkloads = (): boolean => {
  if (openClawRuntimeAdapter?.hasActiveSessions()) return true;
  try {
    if (getCronJobService()?.hasRunningJobs()) return true;
  } catch {
    // CronJobService may not be initialized yet.
  }
  return false;
};

const clearDeferredRestart = () => {
  if (deferredRestartTimer) {
    clearInterval(deferredRestartTimer);
    deferredRestartTimer = null;
  }
  if (deferredRestartTimeout) {
    clearTimeout(deferredRestartTimeout);
    deferredRestartTimeout = null;
  }
};

type SyncOpenClawConfigOptions = {
  reason: string;
  restartGatewayIfRunning?: boolean;
  expectedImpact?: OpenClawConfigImpact;
};

type SyncOpenClawConfigResult = {
  success: boolean;
  changed: boolean;
  status?: OpenClawEngineStatus;
  error?: string;
};

type GatewayConfigApplyState = {
  reason: string;
  startedAt: number;
  restartRequired: boolean;
  promise: Promise<void>;
};

let openClawConfigApplyQueue: Promise<void> = Promise.resolve();
let openClawConfigApplyState: GatewayConfigApplyState | null = null;
let openClawConfigApplyGeneration = 0;
let deferredRestartReason: string | null = null;

const buildConfigApplyPendingStatus = (message: string): OpenClawEngineStatus => {
  const current = getOpenClawEngineManager().getStatus();
  return {
    phase: 'starting',
    version: current.version,
    message,
    canRetry: false,
  };
};

const waitForOpenClawConfigApply = async (context: string): Promise<OpenClawEngineStatus | null> => {
  const pendingApply = openClawConfigApplyState;
  if (pendingApply) {
    console.log(
      '[OpenClawConfigApply] waiting for pending config sync before proceeding.',
      `Context ${context}.`,
      `Reason ${pendingApply.reason}.`,
      `Restart required ${pendingApply.restartRequired}.`,
    );
    try {
      await pendingApply.promise;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'OpenClaw config sync failed.';
      return buildConfigApplyPendingStatus(message);
    }
  }

  if (deferredRestartReason) {
    return buildConfigApplyPendingStatus(
      'OpenClaw is applying MCP configuration. Please try again shortly.',
    );
  }

  return null;
};

const executeDeferredGatewayRestart = async (reason: string) => {
  clearDeferredRestart();
  deferredRestartReason = null;
  console.log(
    `${gwDiagTs()} executeDeferredGatewayRestart: performing deferred restart (reason: ${reason})`,
  );
  await syncOpenClawConfig({
    reason: `deferred:${reason}`,
    restartGatewayIfRunning: true,
    expectedImpact: OpenClawConfigImpact.Restart,
  });
};

const scheduleDeferredGatewayRestart = (reason: string) => {
  // If already scheduled, the latest config is already on disk — just let
  // the existing timer handle the restart.
  if (deferredRestartTimer) {
    console.log(
      `${gwDiagTs()} scheduleDeferredGatewayRestart: already scheduled, skipping (reason: ${reason})`,
    );
    return;
  }

  console.log(
    `${gwDiagTs()} scheduleDeferredGatewayRestart: scheduling deferred restart, polling every ${DEFERRED_RESTART_POLL_MS}ms, max wait ${DEFERRED_RESTART_MAX_WAIT_MS}ms (reason: ${reason})`,
  );
  deferredRestartReason = reason;
  deferredRestartTimer = setInterval(() => {
    if (!hasActiveGatewayWorkloads()) {
      void executeDeferredGatewayRestart(reason);
    }
  }, DEFERRED_RESTART_POLL_MS);

  // Hard timeout: restart anyway after max wait to avoid config drift.
  deferredRestartTimeout = setTimeout(() => {
    console.warn(
      `${gwDiagTs()} scheduleDeferredGatewayRestart: max wait exceeded, forcing restart (reason: ${reason})`,
    );
    void executeDeferredGatewayRestart(reason);
  }, DEFERRED_RESTART_MAX_WAIT_MS);
};

const _syncOpenClawConfigImpl = async (
  options: SyncOpenClawConfigOptions = { reason: 'unknown' },
): Promise<SyncOpenClawConfigResult> => {
  const D = gwDiagTs;
  console.log(
    `${D()} ──── syncOpenClawConfig START reason=${options.reason} restartIfRunning=${!!options.restartGatewayIfRunning} expectedImpact=${options.expectedImpact ?? OpenClawConfigImpact.None}`,
  );

  // Resolve MCP servers before sync (async → cache for synchronous callback)
  try {
    await getMcpRuntime().refreshResolvedServersCache();
  } catch (err) {
    console.warn(`[OpenClaw] getResolvedMcpServers failed (non-fatal):`, err);
    getMcpRuntime().clearResolvedServersCache();
  }

  const syncResult = getOpenClawConfigSync().sync(options.reason);
  console.log(
    `${D()} sync() ok=${syncResult.ok} changed=${syncResult.changed} bindingsChanged=${!!syncResult.bindingsChanged} restartImpact=${syncResult.restartImpact ?? OpenClawConfigImpact.None}`,
  );
  if (!syncResult.ok) {
    console.log(`${D()} sync FAILED: ${syncResult.error}`);
    const status = getOpenClawEngineManager().setExternalError(
      `OpenClaw config sync failed: ${syncResult.error || 'unknown error'}`,
    );
    return {
      success: false,
      changed: false,
      status,
      error: syncResult.error,
    };
  }

  try {
    mergeEnterpriseOpenclawConfig(getOpenClawEngineManager().getConfigPath());
  } catch {
    /* non-critical */
  }

  const nextSecretEnvVars = getOpenClawConfigSync().collectSecretEnvVars();
  const prevSecretEnvVars = getOpenClawEngineManager().getSecretEnvVars();
  let referencedSecretEnvVarNames: Set<string> | null = null;
  try {
    const configText = fs.readFileSync(getOpenClawEngineManager().getConfigPath(), 'utf8');
    referencedSecretEnvVarNames = collectReferencedEnvVarNames(configText);
  } catch (error) {
    console.warn('[OpenClawConfigSync] failed to inspect referenced secret env vars, comparing all secrets:', error);
  }
  const effectiveNextSecretEnvVars = referencedSecretEnvVarNames
    ? pickReferencedSecretEnvVars(nextSecretEnvVars, referencedSecretEnvVarNames)
    : nextSecretEnvVars;
  const effectivePrevSecretEnvVars = referencedSecretEnvVarNames
    ? pickReferencedSecretEnvVars(prevSecretEnvVars, referencedSecretEnvVarNames)
    : prevSecretEnvVars;
  const secretEnvVarsChanged = JSON.stringify(effectiveNextSecretEnvVars) !== JSON.stringify(effectivePrevSecretEnvVars);
  getOpenClawEngineManager().setSecretEnvVars(nextSecretEnvVars);

  // Diagnostic: print which env vars changed
  if (secretEnvVarsChanged) {
    const allKeys = new Set([...Object.keys(effectivePrevSecretEnvVars), ...Object.keys(effectiveNextSecretEnvVars)]);
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    for (const k of allKeys) {
      const prev = effectivePrevSecretEnvVars[k];
      const next = effectiveNextSecretEnvVars[k];
      if (prev === next) continue;
      if (prev === undefined) {
        added.push(k);
      } else if (next === undefined) {
        removed.push(k);
      } else {
        modified.push(k);
      }
    }
    console.log(`${D()} SECRET ENV VARS CHANGED!`);
    if (added.length) console.log(`${D()}   added: ${added.join(', ')}`);
    if (removed.length) console.log(`${D()}   removed: ${removed.join(', ')}`);
    for (const k of modified) {
      const p = (effectivePrevSecretEnvVars[k] || '').slice(0, 12);
      const n = (effectiveNextSecretEnvVars[k] || '').slice(0, 12);
      console.log(`${D()}   modified: ${k} prev=${p}… next=${n}…`);
    }
  } else {
    console.log(`${D()} secretEnvVars unchanged (${Object.keys(effectiveNextSecretEnvVars).length}/${Object.keys(nextSecretEnvVars).length} referenced keys)`);
  }

  // Force a hard restart when env/bindings changed, or when the caller explicitly
  // requires a running gateway restart. Some IM account state changes are stored
  // outside openclaw.json, so the explicit flag must not depend on config diffing.
  const expectedRestartImpact =
    syncResult.changed
    && options.expectedImpact === OpenClawConfigImpact.Restart;
  const syncRestartImpact =
    syncResult.restartImpact === OpenClawConfigImpact.Restart;
  const needsHardRestart =
    secretEnvVarsChanged ||
    syncResult.bindingsChanged === true ||
    syncRestartImpact ||
    expectedRestartImpact ||
    options.restartGatewayIfRunning === true;

  console.log(
    `${D()} needsHardRestart=${needsHardRestart} (envChanged=${secretEnvVarsChanged} bindingsChanged=${!!syncResult.bindingsChanged} configChanged=${syncResult.changed} restartImpact=${syncResult.restartImpact ?? OpenClawConfigImpact.None} expectedRestart=${expectedRestartImpact} restartFlag=${!!options.restartGatewayIfRunning})`,
  );

  if (!needsHardRestart) {
    console.log(`${D()} ──── NO RESTART, hot-reload only. reason=${options.reason}`);
    return {
      success: true,
      changed: syncResult.changed,
    };
  }

  const manager = getOpenClawEngineManager();
  const status = manager.getStatus();
  if (status.phase !== 'running') {
    console.log(
      `${D()} ──── RESTART NEEDED but gateway not running (phase=${status.phase}), skipping. reason=${options.reason}`,
    );
    return {
      success: true,
      changed: true,
      status,
    };
  }

  if (hasActiveGatewayWorkloads()) {
    console.log(`${D()} ──── RESTART DEFERRED (active workloads). reason=${options.reason}`);
    scheduleDeferredGatewayRestart(options.reason);
    return {
      success: true,
      changed: true,
      status,
    };
  }

  console.log(
    `${D()} ──── HARD RESTART EXECUTING. reason=${options.reason}, phase=${status.phase}, port=${status.message?.match(/loopback:(\d+)/)?.[1] ?? 'unknown'}`,
  );
  if (openClawRuntimeAdapter) {
    openClawRuntimeAdapter.disconnectGatewayClient();
  }

  await manager.stopGateway();
  const restarted = await manager.startGateway(`config-sync:${options.reason}`);
  if (restarted.phase !== 'running') {
    return {
      success: false,
      changed: true,
      status: restarted,
      error: restarted.message || 'Failed to restart OpenClaw gateway after config sync.',
    };
  }
  return {
    success: true,
    changed: true,
    status: restarted,
  };
};

const syncOpenClawConfig = async (
  options: SyncOpenClawConfigOptions = { reason: 'unknown' },
): Promise<SyncOpenClawConfigResult> => {
  const generation = ++openClawConfigApplyGeneration;
  const startAfterPrevious = openClawConfigApplyQueue.catch(() => {});
  const restartRequired =
    options.restartGatewayIfRunning === true
    || options.expectedImpact === OpenClawConfigImpact.Restart;
  const resultPromise = startAfterPrevious.then(() => _syncOpenClawConfigImpl(options));
  const barrierPromise = resultPromise.then((result) => {
    if (!result.success) {
      throw new Error(result.error || 'OpenClaw config sync failed.');
    }
  });
  barrierPromise.catch(() => {
    // The awaiter will surface the error when a user action is blocked by this barrier.
  });

  openClawConfigApplyState = {
    reason: options.reason,
    startedAt: Date.now(),
    restartRequired,
    promise: barrierPromise,
  };

  openClawConfigApplyQueue = resultPromise.then(
    (): void => undefined,
    (): void => undefined,
  );

  try {
    return await resultPromise;
  } catch (error) {
    return {
      success: false,
      changed: false,
      error: error instanceof Error ? error.message : 'OpenClaw config sync failed.',
    };
  } finally {
    if (generation === openClawConfigApplyGeneration) {
      openClawConfigApplyState = null;
    }
  }
};

const bindCoworkRuntimeForwarder = (): void => {
  if (coworkRuntimeForwarderBound) return;
  const runtime = getCoworkEngineRouter();

  runtime.on('message', (sessionId: string, message: unknown, beforeMessageId?: string) => {
    const safeMessage = sanitizeCoworkMessageForIpc(message);
    const windows = BrowserWindow.getAllWindows();
    const messageType = typeof message === 'object' && message && 'type' in message
      ? (message as { type?: unknown }).type
      : undefined;
    if (beforeMessageId) {
      console.log('[ThinkingOrder] IPC forwarding with beforeMessageId=', beforeMessageId, 'type=', messageType);
    }
    console.log('[CoworkForwarder] forwarding message: sessionId=', sessionId, 'type=', messageType, 'windowCount=', windows.length);
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:message', { sessionId, message: safeMessage, beforeMessageId });
      } catch (error) {
        console.error('Failed to forward cowork message:', error);
      }
    });
  });

  runtime.on(
    'messageUpdate',
    (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => {
      const safeContent = truncateIpcString(content, IPC_UPDATE_CONTENT_MAX_CHARS);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win.isDestroyed()) return;
        try {
          win.webContents.send('cowork:stream:messageUpdate', {
            sessionId,
            messageId,
            content: safeContent,
            metadata,
          });
        } catch (error) {
          console.error('Failed to forward cowork message update:', error);
        }
      });
    },
  );

  runtime.on('sessionStatus', (sessionId: string, status: string) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:sessionStatus', { sessionId, status });
      } catch (error) {
        console.error('[CoworkRuntime] failed to forward session status:', error);
      }
    });
  });

  runtime.on('contextUsageUpdate', (sessionId: string, usage: unknown) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:contextUsage', { sessionId, usage });
      } catch (error) {
        console.error('[CoworkRuntime] failed to forward context usage:', error);
      }
    });
  });

  runtime.on('contextMaintenance', (sessionId: string, active: boolean) => {
    const windows = BrowserWindow.getAllWindows();
    console.log(
      `[CoworkRuntime] forwarding context maintenance ${active ? 'start' : 'end'} for session ${sessionId} to ${windows.length} windows.`,
    );
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:contextMaintenance', { sessionId, active });
      } catch (error) {
        console.error('[CoworkRuntime] failed to forward context maintenance status:', error);
      }
    });
  });

  runtime.on('permissionRequest', (sessionId: string, request: unknown) => {
    if (runtime.getSessionConfirmationMode(sessionId) === 'text') {
      return;
    }
    const safeRequest = sanitizePermissionRequestForIpc(request);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:permission', { sessionId, request: safeRequest });
      } catch (error) {
        console.error('Failed to forward cowork permission request:', error);
      }
    });
  });

  runtime.on('complete', (sessionId: string, claudeSessionId: string | null) => {
    mediaSelectionBySession.delete(sessionId);
    mediaReferencesBySession.delete(sessionId);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send('cowork:stream:complete', { sessionId, claudeSessionId });
    });
    // If this session used a server model, notify renderer to refresh quota.
    try {
      if (shouldRefreshServerQuotaForSession(sessionId)) {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
          if (win.isDestroyed()) return;
          win.webContents.send('auth:quotaChanged');
        });
      }
    } catch {
      // ignore
    }
  });

  runtime.on('error', (sessionId: string, error: string) => {
    mediaSelectionBySession.delete(sessionId);
    mediaReferencesBySession.delete(sessionId);
    // Mark session as error in store so the .catch() fallback can detect duplicates.
    try {
      getCoworkStore().updateSession(sessionId, { status: 'error' });
    } catch {
      /* ignore */
    }
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send('cowork:stream:error', { sessionId, error });
    });
  });

  coworkRuntimeForwarderBound = true;
};

const getCoworkEngineRouter = () => {
  if (!coworkEngineRouter) {
    if (!openClawRuntimeAdapter) {
      openClawRuntimeAdapter = new OpenClawRuntimeAdapter(
        getCoworkStore(),
        getOpenClawEngineManager(),
        {
          normalizeModelRef: normalizeOpenClawModelRef,
        },
        new SubagentRunStore(getStore().getDatabase()),
        new SubagentMessageStore(getStore().getDatabase()),
      );
      // Wire up channel session sync for IM conversations via OpenClaw
      try {
        const imManager = getIMGatewayManager();
        const imStore = imManager.getIMStore();
        if (imStore) {
          const channelSessionSync = new OpenClawChannelSessionSync({
            coworkStore: getCoworkStore(),
            imStore,
            getDefaultCwd: (agentId?: string) =>
              resolveAgentDefaultWorkingDirectory(agentId) || os.homedir(),
            resolveJobName: jobId => getCronJobService().getJobNameSync(jobId),
          });
          openClawRuntimeAdapter.setChannelSessionSync(channelSessionSync);
        }
      } catch (error) {
        console.warn('[Main] Failed to set up channel session sync:', error);
      }
    }
    coworkEngineRouter = new CoworkEngineRouter({
      getCurrentEngine: resolveCoworkAgentEngine,
      openclawRuntime: openClawRuntimeAdapter,
    });
  }
  return coworkEngineRouter;
};

const getSkillManager = () => {
  if (!skillManager) {
    skillManager = new SkillManager(getStore);
  }
  return skillManager;
};

const getMcpRuntime = (): McpRuntime => {
  if (!mcpRuntime) {
    mcpRuntime = new McpRuntime({
      getStore,
      syncOpenClawConfig,
    });
  }
  return mcpRuntime;
};

const startAskUserServer = async (): Promise<void> => {
  await getMcpRuntime().startAskUserServer();
};

const getIMGatewayManager = () => {
  if (!imGatewayManager) {
    const sqliteStore = getStore();

    // Get Cowork dependencies for IM Cowork mode
    const runtime = getCoworkEngineRouter();
    const store = getCoworkStore();

    imGatewayManager = new IMGatewayManager(sqliteStore.getDatabase(), {
      coworkRuntime: runtime,
      coworkStore: store,
      ensureCoworkReady: async () => {
        const status = await ensureOpenClawRunningForCowork();
        if (status.phase !== 'running') {
          throw new Error(
            status.message || 'AI engine is initializing. Please try again in a moment.',
          );
        }
      },
      syncOpenClawConfig: async (
        reason?: string,
        options?: { restartGatewayIfRunning?: boolean },
      ) => {
        await syncOpenClawConfig({
          reason: reason || 'im-gateway-sync',
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
        });
      },
      ensureOpenClawGatewayConnected: async () => {
        const configApplyStatus = await waitForOpenClawConfigApply('IM gateway client connection');
        if (configApplyStatus) {
          throw new Error(configApplyStatus.message || 'OpenClaw is applying configuration changes.');
        }
        if (openClawRuntimeAdapter) {
          await openClawRuntimeAdapter.connectGatewayIfNeeded();
        }
      },
      getOpenClawGatewayClient: () => openClawRuntimeAdapter?.getGatewayClient() ?? null,
      ensureOpenClawGatewayReady: async () => {
        if (!openClawRuntimeAdapter) {
          throw new Error('OpenClaw runtime adapter not initialized.');
        }
        const configApplyStatus = await waitForOpenClawConfigApply('IM gateway readiness check');
        if (configApplyStatus) {
          throw new Error(configApplyStatus.message || 'OpenClaw is applying configuration changes.');
        }
        await openClawRuntimeAdapter.ensureReady();
        await openClawRuntimeAdapter.connectGatewayIfNeeded();
      },
      getOpenClawSessionKeysForCoworkSession: (sessionId: string) => {
        return openClawRuntimeAdapter?.getSessionKeysForSession(sessionId) ?? [];
      },
      createScheduledTask: async ({ sessionId, message, request }) => {
        // if (message.platform === 'dingtalk') {
        //   await getIMGatewayManager().primeConversationReplyRoute(
        //     message.platform,
        //     message.conversationId,
        //     sessionId,
        //   );
        // }
        const channelName = PlatformRegistry.channelOf(message.platform);
        const hasChannel = !!(channelName && message.conversationId);
        // Strip IM subtype prefix (e.g. "direct:ou_xxx" -> "ou_xxx")
        let deliveryTo = message.conversationId;
        if (hasChannel && deliveryTo) {
          const colonIdx = deliveryTo.indexOf(':');
          if (colonIdx > 0) {
            deliveryTo = deliveryTo.slice(colonIdx + 1);
          }
        }
        const task = await getCronJobService().addJob({
          name: request.taskName,
          description: '',
          enabled: true,
          schedule: {
            kind: 'at',
            at: request.scheduleAt,
          },
          sessionTarget: hasChannel ? 'isolated' : 'main',
          wakeMode: 'now',
          payload: hasChannel
            ? { kind: 'agentTurn', message: request.payloadText }
            : { kind: 'systemEvent', text: request.payloadText },
          delivery: {
            mode: hasChannel ? 'announce' : 'none',
            ...(channelName ? { channel: channelName } : {}),
            ...(hasChannel
              ? { to: deliveryTo }
              : message.conversationId
                ? { to: message.conversationId }
                : {}),
          },
          agentId: DEFAULT_MANAGED_AGENT_ID,
          ...(hasChannel
            ? {}
            : { sessionKey: buildManagedSessionKey(sessionId, DEFAULT_MANAGED_AGENT_ID) }),
        });
        return {
          id: task.id,
          name: task.name,
          agentId: task.agentId,
          sessionKey: task.sessionKey,
          payloadText:
            task.payload.kind === 'systemEvent'
              ? task.payload.text
              : task.payload.kind === 'agentTurn'
                ? task.payload.message
                : '',
          scheduleAt: task.schedule.kind === 'at' ? task.schedule.at : request.scheduleAt,
        };
      },
    });

    // Initialize with LLM config provider
    imGatewayManager.initialize({
      getLLMConfig: async () => {
        type LlmProviderConfig = {
          enabled?: boolean;
          apiKey?: string;
          baseUrl?: string;
          models?: Array<{ id: string }>;
        };
        type LlmAppConfig = {
          providers?: Record<string, LlmProviderConfig>;
          api?: { key?: string; baseUrl?: string };
          model?: { defaultModel?: string };
        };
        const appConfig = sqliteStore.get<LlmAppConfig>('app_config');
        if (!appConfig) return null;

        // Find first enabled provider
        const providers = appConfig.providers || {};
        for (const [providerName, providerConfig] of Object.entries(providers)) {
          if (providerConfig.enabled && providerConfig.apiKey) {
            const model = providerConfig.models?.[0]?.id;
            return {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              model: model,
              provider: providerName,
            };
          }
        }

        // Fallback to legacy api config
        if (appConfig.api?.key) {
          return {
            apiKey: appConfig.api.key,
            baseUrl: appConfig.api.baseUrl,
            model: appConfig.model?.defaultModel,
          };
        }

        return null;
      },
      getSkillsPrompt: async () => {
        return getSkillManager().buildAutoRoutingPrompt();
      },
    });

    // Forward IM events to renderer
    imGatewayManager.on('statusChange', status => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:status:change', status);
        }
      });
    });

    imGatewayManager.on('message', message => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:message:received', message);
        }
      });
    });

    imGatewayManager.on('error', ({ platform, error }) => {
      console.error(`[IM Gateway] ${platform} error:`, error);
    });
  }
  return imGatewayManager;
};

const refreshImSessionWorkingDirectoriesForAgent = (agentId: string): number => {
  const normalizedAgentId = agentId.trim() || AgentId.Main;
  const resolvedCwd = resolveAgentDefaultWorkingDirectory(normalizedAgentId);
  if (!resolvedCwd) {
    return 0;
  }

  try {
    const imStore = getIMGatewayManager().getIMStore();
    const coworkStore = getCoworkStore();
    let updatedCount = 0;

    for (const mapping of imStore.listSessionMappings()) {
      if ((mapping.agentId || AgentId.Main) !== normalizedAgentId) {
        continue;
      }

      const session = coworkStore.getSession(mapping.coworkSessionId);
      if (!session || session.cwd === resolvedCwd) {
        continue;
      }

      coworkStore.updateSession(session.id, { cwd: resolvedCwd }, { touchUpdatedAt: false });
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      console.debug(
        `[ChannelSessionSync] refreshed ${updatedCount} IM session working directories for agent ${normalizedAgentId} to ${resolvedCwd}`,
      );
    }

    openClawRuntimeAdapter?.clearChannelSessionCache();
    return updatedCount;
  } catch (error) {
    console.warn('[ChannelSessionSync] failed to refresh IM session working directories:', error);
    return 0;
  }
};

function mergeCoworkSystemPrompt(systemPrompt?: string): string | undefined {
  const sections = [buildScheduledTaskEnginePrompt(), systemPrompt?.trim() || ''].filter(Boolean);
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

type CoworkImageAttachmentMain = {
  name: string;
  mimeType: string;
  base64Data: string;
  sizeBytes?: number;
  localPath?: string;
  previewMimeType?: string;
  previewBase64Data?: string;
};

function validateCoworkImageAttachmentsForRuntime(
  imageAttachments?: CoworkImageAttachmentMain[],
): { ok: true } | { ok: false; error: string } {
  for (const attachment of imageAttachments ?? []) {
    const validation = validateCoworkImageAttachmentSize(attachment);
    if (!validation.ok) {
      return {
        ok: false,
        error: `Image attachment ${attachment.name} exceeds the ${formatCoworkImageAttachmentLimit(validation.maxBytes)} limit.`,
      };
    }
  }
  return { ok: true };
}

function buildCoworkUserSelectionMetadata(options: {
  skillIds?: string[];
  kitIds?: string[];
  kitReferences?: KitReference[];
  resolvedKitCapabilities?: ResolvedKitCapabilities;
  selectedTextSnippets?: CoworkSelectedTextSnippet[];
  imageAttachmentPreviews?: CoworkImageAttachmentPreview[];
}): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  if (options.skillIds?.length) {
    metadata.skillIds = options.skillIds;
  }
  if (options.kitIds?.length) {
    metadata.kitIds = options.kitIds;
    if (options.kitReferences?.length) {
      metadata.kitReferences = options.kitReferences;
    }
    if (options.resolvedKitCapabilities) {
      metadata.resolvedKitCapabilities = options.resolvedKitCapabilities;
    }
  }
  if (options.imageAttachmentPreviews?.length) {
    metadata.imageAttachmentPreviews = options.imageAttachmentPreviews;
  }
  if (options.selectedTextSnippets?.length) {
    metadata.selectedTextSnippets = options.selectedTextSnippets;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeSelectedTextSnippetsForIpc(value: unknown): CoworkSelectedTextSnippet[] {
  const result = normalizeCoworkSelectedTextSnippets(value);
  if (result.success === false) {
    throw new Error(`Invalid selected text snippets: ${result.error}`);
  }
  return result.snippets;
}

// 获取正确的预加载脚本路径
const PRELOAD_PATH = app.isPackaged
  ? path.join(__dirname, 'preload.js')
  : path.join(__dirname, '../dist-electron/preload.js');

// 获取应用图标路径（Windows 使用 .ico，其他平台使用 .png）
const getAppIconPath = (): string | undefined => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', 'resources', 'tray');
  return process.platform === 'win32'
    ? path.join(basePath, 'tray-icon.ico')
    : path.join(basePath, 'tray-icon.png');
};

// 保存对主窗口的引用
let mainWindow: BrowserWindow | null = null;

let isQuitting = false;

// 存储活跃的流式请求控制器
const activeStreamControllers = new Map<string, AbortController>();

// Media generation selection per session (for turn-level tool gating)
const mediaSelectionBySession = new Map<string, MediaSelectionState>();

// Media attachment references per session (for @ mentions, FR-9)
const mediaReferencesBySession = new Map<string, MediaAttachmentRefMain[]>();
const persistedGeneratedImageAssetsByUrl = new Map<string, PersistedGeneratedImageAsset>();
const persistedGeneratedVideoAssetsByUrl = new Map<string, PersistedGeneratedImageAsset>();

// Async video task polling (FR-8)
interface MediaTaskTracker {
  taskId: string;
  sessionId: string;
  mediaType: 'image' | 'video';
  model: string;
  startedAt: number;
  pollCount: number;
  timeoutMs: number;
  lastPollAt?: number;
}
const pendingMediaTasks = new Map<string, MediaTaskTracker>();
const mediaStatusPollCounts = new Map<string, number>();
const mediaTasksHandledByStatusPolling = new Set<string>();
let mediaTaskPollTimer: ReturnType<typeof setInterval> | null = null;
const MEDIA_POLL_FAST_MS = 10_000;
const MEDIA_POLL_SLOW_MS = 30_000;
const MEDIA_POLL_MEDIUM_MS = 120_000;
const MEDIA_POLL_IDLE_MS = 600_000;
const MEDIA_POLL_FAST_COUNT = 6;
const MEDIA_POLL_SLOW_COUNT = 18;
const MEDIA_POLL_MEDIUM_COUNT = 10;
const MEDIA_TASK_DEFAULT_TIMEOUT_MS = 172_800_000;
const TERMINAL_MEDIA_TASK_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
type MediaStatusPollUpdate = {
  sessionId: string;
  toolCallId: string;
  details: Record<string, unknown>;
};
let lastReloadAt = 0;
const MIN_RELOAD_INTERVAL_MS = 5000;
type AppConfigSettings = {
  api?: unknown;
  app?: Record<string, unknown>;
  model?: unknown;
  providers?: Record<string, unknown>;
  shortcuts?: Record<string, unknown>;
  theme?: string;
  language?: string;
  useSystemProxy?: boolean;
  sqliteAutoBackupEnabled?: boolean;
  browserWebAccess?: Partial<BrowserWebAccessConfig>;
};

const getUseSystemProxyFromConfig = (config?: { useSystemProxy?: boolean }): boolean => {
  return config?.useSystemProxy === true;
};

const hasBrowserWebAccessConfigChanged = (
  previousConfig?: AppConfigSettings,
  nextConfig?: AppConfigSettings,
): boolean => {
  return JSON.stringify(normalizeBrowserWebAccessConfig(previousConfig?.browserWebAccess)) !==
    JSON.stringify(normalizeBrowserWebAccessConfig(nextConfig?.browserWebAccess));
};

const getSqliteAutoBackupEnabledFromConfig = (
  config?: { sqliteAutoBackupEnabled?: boolean },
): boolean => {
  return config?.sqliteAutoBackupEnabled === true;
};

const resolveThemeFromConfig = (config?: AppConfigSettings): 'light' | 'dark' => {
  if (config?.theme === 'dark') {
    return 'dark';
  }
  if (config?.theme === 'light') {
    return 'light';
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
};

const getInitialTheme = (): 'light' | 'dark' => {
  const config = getStore().get<AppConfigSettings>('app_config');
  return resolveThemeFromConfig(config);
};

const getMediaStatusPollKey = (sessionId: string | null, taskId: string): string =>
  `${sessionId ?? 'unknown'}:${taskId}`;

const incrementMediaStatusPollCount = (sessionId: string | null, taskId: string): number => {
  const key = getMediaStatusPollKey(sessionId, taskId);
  const nextCount = (mediaStatusPollCounts.get(key) ?? 0) + 1;
  mediaStatusPollCounts.set(key, nextCount);
  return nextCount;
};

const markMediaTaskHandledByStatusPolling = (sessionId: string, taskId: string): void => {
  mediaTasksHandledByStatusPolling.add(getMediaStatusPollKey(sessionId, taskId));
  pendingMediaTasks.delete(taskId);
};

const isMediaTaskHandledByStatusPolling = (sessionId: string, taskId: string): boolean =>
  mediaTasksHandledByStatusPolling.has(getMediaStatusPollKey(sessionId, taskId));

const clearMediaStatusPollCountsForSession = (sessionId: string): void => {
  for (const key of mediaStatusPollCounts.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      mediaStatusPollCounts.delete(key);
    }
  }
};

const emitMediaStatusPollUpdate = (update: MediaStatusPollUpdate): void => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.isDestroyed()) return;
    win.webContents.send(CoworkIpcChannel.MediaStatusPollUpdate, update);
  });
};

const getTitleBarOverlayOptions = () => {
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  return {
    color: TITLEBAR_COLORS[theme].color,
    symbolColor: TITLEBAR_COLORS[theme].symbolColor,
    height: TITLEBAR_HEIGHT,
  };
};

const updateTitleBarOverlay = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // Also update the window background color to match the theme
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

const applyProxyPreference = async (useSystemProxy: boolean): Promise<void> => {
  setSystemProxyEnabled(useSystemProxy);

  try {
    await session.defaultSession.setProxy({ mode: useSystemProxy ? 'system' : 'direct' });
  } catch (error) {
    console.error('[Main] Failed to apply session proxy mode:', error);
  }

  if (!useSystemProxy) {
    restoreOriginalProxyEnv();
    console.log('[Main] System proxy disabled (direct mode).');
    return;
  }

  const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets();
  applySystemProxyEnv(proxyUrl);

  if (proxyUrl) {
    console.log(`[Main] System proxy enabled for process env via ${targetUrl}:`, proxyUrl);
  } else {
    console.warn('[Main] System proxy mode enabled, but no proxy endpoint was resolved (DIRECT).');
  }
};

const windowStatePersist = createWindowStatePersistManager({
  getMainWindow: () => mainWindow,
  getStore,
});

const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isMaximized = mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: 'Restore', enabled: isMaximized, click: () => mainWindow.restore() },
    { role: 'minimize' },
    { label: 'Maximize', enabled: !isMaximized, click: () => mainWindow.maximize() },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

const scheduleReload = (reason: string, webContents?: WebContents) => {
  const target = webContents ?? mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(`Skipping reload (${reason}); last reload was ${now - lastReloadAt}ms ago.`);
    return;
  }
  lastReloadAt = now;
  console.warn(`Reloading window due to ${reason}`);
  target.reloadIgnoringCache();
};

// 确保应用程序只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // Register custom protocol for OAuth callback
  if (!app.isPackaged) {
    // In dev mode, setAsDefaultProtocolClient needs the electron exe path
    // and the app entry point as extra args so the OS can relaunch correctly
    app.setAsDefaultProtocolClient('lobsterai', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient('lobsterai');
  }

  const authCallbackRouter = new AuthCallbackRouter({
    getTarget: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      return mainWindow.webContents;
    },
    onParseError: error => {
      console.error('[Main] Failed to parse deep link:', error);
    },
  });

  /**
   * Parse a lobsterai:// deep link and send (or buffer) the auth code.
   */
  const handleDeepLink = (url: string) => {
    authCallbackRouter.handleDeepLink(url);
  };

  ipcMain.on('log:fromRenderer', (_event, level: string, tag: string, message: string) => {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[Renderer][${tag}] ${message}`);
  });

  // Allow renderer to retrieve a buffered auth code on init
  ipcMain.handle(AuthIpcChannel.GetPendingCallback, () =>
    authCallbackRouter.markListenerReadyAndConsumePending());

  // macOS: handle open-url event for deep links
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.debug('[Main] second-instance event', { commandLine, workingDirectory });

    // Check for deep link in command line args (Windows/Linux)
    const deepLink = commandLine.find(arg => arg.startsWith('lobsterai://'));
    if (deepLink) {
      handleDeepLink(deepLink);
    }

    // Focus main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
    }
  });

  // IPC 处理程序
  ipcMain.handle('store:get', (_event, key) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key, value) => {
    const previousAppConfig = key === 'app_config'
      ? getStore().get<AppConfigSettings>('app_config')
      : undefined;
    getStore().set(key, value);
    if (key === 'app_config') {
      const nextAppConfig = value as AppConfigSettings | undefined;
      const browserWebAccessChanged = hasBrowserWebAccessConfigChanged(previousAppConfig, nextAppConfig);
      const systemProxyChanged = getUseSystemProxyFromConfig(previousAppConfig) !==
        getUseSystemProxyFromConfig(nextAppConfig);
      refreshEndpointsTestMode(getStore());
      const impactDecision = classifyAppConfigChange(previousAppConfig, value);
      const proxyChanged = impactDecision.reasons.includes(OpenClawConfigImpactReason.AppUseSystemProxy);
      const actionDecision = removeImpactDecisionReasons(impactDecision, [
        OpenClawConfigImpactReason.AppUseSystemProxy,
      ]);

      if (proxyChanged && getOpenClawEngineManager().getStatus().phase === 'running') {
        console.log('[OpenClaw] Deferred app_config sync to the system proxy watcher.');
        return;
      }

      const shouldSyncOpenClawConfig = actionDecision.impact !== OpenClawConfigImpact.None || browserWebAccessChanged;
      let syncResult: Awaited<ReturnType<typeof syncOpenClawConfig>> | null = null;
      if (shouldSyncOpenClawConfig) {
        syncResult = await syncOpenClawConfig({
          reason: 'app-config-change',
          restartGatewayIfRunning: actionDecision.impact === OpenClawConfigImpact.Restart,
        });
        if (!syncResult.success) {
          console.error('[OpenClaw] Failed to sync config after app_config update:', syncResult.error);
        }
      }
      if (syncResult?.success && browserWebAccessChanged && !systemProxyChanged && actionDecision.impact !== OpenClawConfigImpact.Restart) {
        const engineStatus = getOpenClawEngineManager().getStatus();
        if (engineStatus.phase === 'running') {
          console.log(`${gwDiagTs()} browser access settings changed, restarting gateway`);
          void getOpenClawEngineManager().restartGateway('browser-access-settings-change');
        }
      }
    }
  });

  ipcMain.handle('store:remove', (_event, key) => {
    getStore().delete(key);
  });

  ipcMain.handle('enterprise:getConfig', async () => {
    try {
      return getStore().get('enterprise_config') ?? null;
    } catch {
      return null;
    }
  });

  // Network status change handler
  // Remove any existing listener first to avoid duplicate registrations
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[Main] Network status changed: ${status}`);

    if (status === 'online' && imGatewayManager) {
      console.log('[Main] Network restored, reconnecting IM gateways...');
      imGatewayManager.reconnectAllDisconnected();
    }
  });

  // Log IPC handlers
  ipcMain.handle('log:getPath', () => {
    return getLogFilePath();
  });

  ipcMain.handle('log:openFolder', () => {
    const logPath = getLogFilePath();
    if (logPath) {
      shell.showItemInFolder(logPath);
    }
  });

  ipcMain.handle('log:exportZip', async event => {
    try {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      if (!ownerWindow || ownerWindow.isDestroyed()) {
        return { success: false, error: 'Window is not available' };
      }

      const saveOptions = {
        title: 'Export Logs',
        defaultPath: path.join(app.getPath('downloads'), buildLogExportFileName()),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      };

      const saveResult = await dialog.showSaveDialog(ownerWindow, saveOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: true, canceled: true };
      }

      const outputPath = ensureZipFileName(saveResult.filePath);
      const manager = getOpenClawEngineManager();
      const archiveResult = await exportLogsZip({
        outputPath,
        entries: [
          ...getRecentMainLogEntries(),
          { archiveName: 'cowork.log', filePath: getCoworkLogPath() },
          ...manager.getRecentGatewayLogEntries(),
          ...getRecentOpenClawDailyLogEntries(manager.getOpenClawDailyLogDir()),
          ...(process.platform === 'win32'
            ? [
                {
                  archiveName: 'install-timing.log',
                  filePath: path.join(app.getPath('appData'), 'LobsterAI', 'install-timing.log'),
                },
              ]
            : []),
        ],
      });

      return {
        success: true,
        canceled: false,
        path: outputPath,
        missingEntries: archiveResult.missingEntries,
      };
    } catch (error) {
      console.error('[LogExport] export failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export logs',
      };
    }
  });

  // Auto-launch IPC handlers
  // Use SQLite store as the source of truth for UI state, because
  // app.getLoginItemSettings() returns unreliable values on macOS and
  // requires matching args on Windows.
  ipcMain.handle('app:getAutoLaunch', () => {
    const stored = getStore().get<boolean>('auto_launch_enabled');
    // Fall back to OS API if SQLite has no record yet (e.g. upgraded from older version)
    const enabled = stored ?? getAutoLaunchEnabled();
    return { enabled };
  });

  ipcMain.handle('app:setAutoLaunch', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setAutoLaunchEnabled(enabled);
      getStore().set('auto_launch_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set auto-launch',
      };
    }
  });

  ipcMain.handle('app:getPreventSleep', () => {
    const enabled = getStore().get<boolean>('prevent_sleep_enabled') ?? false;
    return { enabled };
  });

  ipcMain.handle('app:setPreventSleep', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setPreventSleepBlockerEnabled(enabled);
      getStore().set('prevent_sleep_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set prevent-sleep',
      };
    }
  });

  ipcMain.handle('app:relaunch', () => {
    console.log('[Main] app:relaunch requested, scheduling restart...');
    app.relaunch();
    app.quit();
  });

  // Window control IPC handlers
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.on(
    'window:showSystemMenu',
    (_event, position: { x?: number; y?: number } | undefined) => {
      showSystemMenu(position);
    },
  );

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getSystemLocale', () => app.getLocale());

  // ── Auth IPC handlers ──

  /**
   * Helper: Persist auth tokens into the kv store.
   */
  const saveAuthTokens = (accessToken: string, refreshToken: string) => {
    getStore().set('auth_tokens', { accessToken, refreshToken });
  };

  const getAuthTokens = (): { accessToken: string; refreshToken: string } | null => {
    return getStore().get<{ accessToken: string; refreshToken: string }>('auth_tokens') || null;
  };

  const clearAuthTokens = () => {
    getStore().delete('auth_tokens');
  };

  const saveAuthUser = (user: Record<string, unknown>) => {
    try {
      getStore().set(AUTH_USER_STORE_KEY, user);
    } catch (error) {
      console.warn('[Auth] failed to save auth user for attribution:', error);
    }
  };

  const getAuthUserId = (): string | null => {
    try {
      const user = getStore().get<Record<string, unknown>>(AUTH_USER_STORE_KEY);
      const yid = user?.yid;
      if (typeof yid === 'string' && yid.trim()) return yid;
      const userId = user?.userId;
      if (typeof userId === 'string' && userId.trim()) return userId;
    } catch (error) {
      console.warn('[Auth] failed to read auth user for attribution:', error);
    }
    return null;
  };

  const clearAuthUser = () => {
    try {
      getStore().delete(AUTH_USER_STORE_KEY);
    } catch (error) {
      console.warn('[Auth] failed to clear auth user for attribution:', error);
    }
  };

  const getOrCreateInstallationId = (): string | null => {
    try {
      const existing = getStore().get<string>(INSTALLATION_UUID_KEY);
      if (typeof existing === 'string' && existing.trim()) {
        return existing;
      }
      const nextId = crypto.randomUUID();
      getStore().set(INSTALLATION_UUID_KEY, nextId);
      return nextId;
    } catch (error) {
      console.warn('[Auth] failed to get installation uuid:', error);
      return null;
    }
  };

  const buildKeyfromPayload = (): {
    firstKeyfrom: string;
    latestKeyfrom: string;
    uuid?: string;
    userId?: string;
    version: string;
  } => {
    const { firstKeyfrom, latestKeyfrom } = getKeyfromAttribution(getStore());
    const uuid = getOrCreateInstallationId();
    const userId = getAuthUserId();
    return {
      firstKeyfrom,
      latestKeyfrom,
      ...(uuid ? { uuid } : {}),
      ...(userId ? { userId } : {}),
      version: app.getVersion(),
    };
  };

  const withKeyfromBody = <T extends Record<string, unknown>>(body: T) => ({
    ...body,
    ...buildKeyfromPayload(),
  });

  const appendKeyfromQuery = (url: string): string => {
    const parsed = new URL(url);
    const payload = buildKeyfromPayload();
    for (const [key, value] of Object.entries(payload)) {
      if (value) {
        parsed.searchParams.set(key, String(value));
      }
    }
    return parsed.toString();
  };

  // refreshOnce() is the single entry-point for all token refresh paths
  // (proactive, proxy 401/403 retry, and main-process authenticated API 401s).
  // It deduplicates concurrent calls via pendingTokenRefresh so that rolling
  // refresh tokens are never consumed twice.
  const refreshOnce = async (reason: string): Promise<string | null> => {
    if (pendingTokenRefresh) {
      return pendingTokenRefresh;
    }
    let resolvedToken: string | null = null;
    pendingTokenRefresh = (async () => {
      try {
        const tokens = getAuthTokens();
        if (!tokens?.refreshToken) return null;
        const serverBaseUrl = getServerApiBaseUrl();
        const refreshUrl = `${serverBaseUrl}/api/auth/refresh`;
        console.log(`[Auth] requesting token refresh (reason: ${reason}) at ${refreshUrl}`);
        const resp = await net.fetch(refreshUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withKeyfromBody({ refreshToken: tokens.refreshToken })),
        });
        if (resp.ok) {
          const body = await resp.json() as { code: number; data: { accessToken: string; refreshToken?: string } };
          if (body.code === 0 && body.data) {
            saveAuthTokens(body.data.accessToken, body.data.refreshToken || tokens.refreshToken);
            console.log(`[Auth] token refresh succeeded (reason: ${reason})`);
            resolvedToken = body.data.accessToken;
            // Token proxy handles fresh tokens dynamically — no need
            // to restart the gateway on token refresh.
            syncOpenClawConfig({ reason: `token-refresh:${reason}`, restartGatewayIfRunning: false }).catch((err) => {
              console.warn('[Auth] post-refresh OpenClaw config sync failed:', err);
            });
          }
        }
      } catch (err) {
        console.warn(`[Auth] token refresh failed (reason: ${reason}):`, err);
      } finally {
        pendingTokenRefresh = null;
      }
      return resolvedToken;
    })();
    return pendingTokenRefresh;
  };

  /**
   * Helper: Fetch with Bearer token, auto-refresh on 401 and retry once.
   */
  const fetchWithAuth = async (url: string, options?: RequestInit): Promise<Response> => {
    const tokens = getAuthTokens();
    if (!tokens) throw new Error('No auth tokens');

    const doFetch = (accessToken: string) =>
      net.fetch(url, {
        ...options,
        headers: {
          ...(options?.headers as Record<string, string>),
          Authorization: `Bearer ${accessToken}`,
        },
      });

    let resp = await doFetch(tokens.accessToken);

    if (resp.status === 401 && tokens.refreshToken) {
      const refreshedAccessToken = await refreshOnce('passive');
      if (refreshedAccessToken) {
        resp = await doFetch(refreshedAccessToken);
      }
    }

    return resp;
  };

  const extractSessionIdFromKey = (sessionKey: string): string | null =>
    parseManagedSessionKey(sessionKey)?.sessionId ?? null;

  /**
   * Handle media generation tool callbacks from the OpenClaw plugin.
   */
  const handleMediaGenerationCallback = async (request: {
    tool: string;
    args: Record<string, unknown>;
    context: { sessionKey: string; toolCallId: string };
  }): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean; details?: Record<string, unknown> }> => {
    const { tool, args } = request;
    const action = (args.action as string) || 'generate';
    const serverBaseUrl = getServerApiBaseUrl();
    const sessionId = extractSessionIdFromKey(request.context.sessionKey);
    const selection = sessionId ? mediaSelectionBySession.get(sessionId) : undefined;
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';
    const explicitModel = typeof args.model === 'string' ? args.model.trim() : '';
    const resolvedModelFromSelection = tool === MediaGenerationTool.Image
      ? (selection?.imageModelId || selection?.modelId || '')
      : (selection?.videoModelId || selection?.modelId || '');
    let selectedModel = explicitModel || resolvedModelFromSelection;
    let selectedModelSource = explicitModel ? 'tool' : resolvedModelFromSelection ? 'selection' : 'none';

    if (action === 'generate' && resolvedModelFromSelection && explicitModel && explicitModel !== resolvedModelFromSelection) {
      console.warn(`[MediaGeneration] overriding LLM model choice "${explicitModel}" with user selection "${resolvedModelFromSelection}"`);
      selectedModel = resolvedModelFromSelection;
      selectedModelSource = 'selection-override';
    }
    console.log('[MediaGeneration] received tool request:', serializeForLog({
      tool,
      action,
      sessionId: sessionId ?? '',
      toolCallId: request.context.toolCallId,
      selectionMode: selection?.mode ?? 'none',
      selectedModel,
      selectedModelSource,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 120),
    }));

    // Tool gating: for generate action, check if media selection allows this tool
    if (action === 'generate') {
      const gate = resolveMediaGenerationGate({ action, tool, selection });
      if (gate.allowed === false) {
        if (gate.reason === MediaGenerationGateReason.MediaNotEnabled) {
          console.warn('[MediaGeneration] blocked generate request because no media model was selected for this turn.');
        } else {
          console.warn('[MediaGeneration] blocked generate request because the selected turn model has a different media type.');
        }
        return {
          content: [{ type: 'text', text: gate.message }],
          isError: true,
          details: { status: 'failed', warnings: [gate.reason] },
        };
      }
    }

    try {
      if (action === 'list') {
        const mediaType = tool === MediaGenerationTool.Image ? 'image' : 'video';
        const endpoint = mediaType === 'image' ? '/api/media/images/models' : '/api/media/videos/models';
        console.log(`[MediaGeneration] listing ${mediaType} models from server.`);
        const resp = await fetchWithAuth(`${serverBaseUrl}${endpoint}`);
        console.log(`[MediaGeneration] server returned HTTP ${resp.status} for ${mediaType} model list.`);
        const body = await resp.json() as { code: number; data?: unknown[]; message?: string };
        if (body.code !== 0) {
          console.warn('[MediaGeneration] server rejected model list request:', serializeForLog({ mediaType, code: body.code, message: body.message }));
          return { content: [{ type: 'text', text: body.message || 'Failed to list models.' }], isError: true };
        }
        const models = body.data || [];
        console.log(`[MediaGeneration] server returned ${models.length} ${mediaType} models.`);
        let text = models.length > 0
          ? `Available ${mediaType} models:\n\n${(models as Array<{ modelId: string; displayName: string; capabilities?: string; parameterSpec?: Record<string, unknown> }>).map(m => {
              let line = `### ${m.displayName} (model: "${m.modelId}")`;
              if (m.capabilities) line += `\n${m.capabilities}`;
              if (m.parameterSpec) line += `\nSupported parameters:\n${JSON.stringify(m.parameterSpec, null, 2)}`;
              return line;
            }).join('\n\n')}`
          : `No ${mediaType} models available.`;
        if (resolvedModelFromSelection) {
          text += `\n\n---\n**Note:** The user has already selected model "${resolvedModelFromSelection}" for this session. You MUST use this model for the generate action. Do NOT choose a different model.`;
        }
        return { content: [{ type: 'text', text }], details: { status: 'succeeded', models } };
      }

      if (action === 'status') {
        const taskId = args.taskId as string;
        if (!taskId) {
          console.warn('[MediaGeneration] blocked status request because taskId was missing.');
          return { content: [{ type: 'text', text: 'taskId is required for status action.' }], isError: true };
        }
        const pollCount = incrementMediaStatusPollCount(sessionId, taskId);
        const mediaType = tool === MediaGenerationTool.Image ? 'images' : 'videos';
        const statusMediaType = tool === MediaGenerationTool.Image ? 'image' : 'video';
        if (sessionId && statusMediaType === 'video') {
          markMediaTaskHandledByStatusPolling(sessionId, taskId);
        }
        console.log(`[MediaGeneration] checking ${mediaType} task status for task ${taskId}.`);
        const resp = await fetchWithAuth(`${serverBaseUrl}/api/media/${mediaType}/tasks/${taskId}`);
        console.log(`[MediaGeneration] server returned HTTP ${resp.status} for ${mediaType} task status.`);
        const body = await resp.json() as { code: number; data?: Record<string, unknown>; message?: string };
        if (body.code !== 0) {
          console.warn('[MediaGeneration] server rejected task status request:', serializeForLog({ mediaType, taskId, code: body.code, message: body.message }));
          return { content: [{ type: 'text', text: body.message || 'Failed to get task status.' }], isError: true };
        }
        const task = body.data!;
        const status = task.status as string;
        const resultUrls = (task.resultUrls as string[]) || [];
        if (sessionId && TERMINAL_MEDIA_TASK_STATUSES.has(status)) {
          pendingMediaTasks.delete(taskId);
        }
        const assets = resultUrls.map(url => ({
          type: statusMediaType,
          url,
          mimeType: statusMediaType === 'image' ? 'image/png' : 'video/mp4',
        }));

        let resultLines: string[];
        let detailsAssets: unknown[] = assets;
        if (status === 'succeeded' && statusMediaType === 'image' && sessionId) {
          const persistResult = await persistGeneratedImages(sessionId, assets);
          if (persistResult && persistResult.saved.length > 0) {
            detailsAssets = persistResult.saved;
            resultLines = persistResult.saved.map(asset =>
              `  - [${asset.filename}](${pathToFileURL(asset.filePath).toString()})`
            );
          } else {
            resultLines = resultUrls.map((url, index) => `  - ![Generated image ${index + 1}](${url})`);
          }
        } else if (status === 'succeeded' && statusMediaType === 'video' && sessionId) {
          const persistResult = await persistGeneratedVideos(sessionId, assets);
          if (persistResult && persistResult.saved.length > 0) {
            detailsAssets = persistResult.saved;
            resultLines = persistResult.saved.map(asset =>
              `  - [${asset.filename}](${pathToFileURL(asset.filePath).toString()})`
            );
          } else {
            resultLines = resultUrls.map(url => `  - ${url}`);
          }
        } else {
          resultLines = statusMediaType === 'image'
            ? resultUrls.map((_url, index) => `  - Generated image ${index + 1}`)
            : resultUrls.map(url => `  - ${url}`);
        }

        const lines = [
          `Task ID: ${task.upstreamTaskId || task.taskId}`,
          `Status: ${status}`,
          ...(task.progress ? [`Progress: ${task.progress}%`] : []),
          ...(resultUrls.length > 0 ? [`Results:\n${resultLines.join('\n')}`] : []),
          ...(task.errorMessage ? [`Error: ${task.errorMessage}`] : []),
        ];
        const details = {
          taskId: String(task.taskId),
          ...(task.upstreamTaskId ? { upstreamTaskId: String(task.upstreamTaskId) } : {}),
          status,
          ...(pollCount > 1 ? { pollCount } : {}),
          model: task.model as string,
          mediaType: statusMediaType,
          ...(detailsAssets.length > 0 ? { assets: detailsAssets } : {}),
          ...(task.quotaRemaining != null ? { billing: { quotaRemaining: task.quotaRemaining } } : {}),
        };
        if (sessionId) {
          emitMediaStatusPollUpdate({
            sessionId,
            toolCallId: request.context.toolCallId,
            details,
          });
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details,
        };
      }

      if (action === 'cancel' && tool === MediaGenerationTool.Video) {
        const taskId = args.taskId as string;
        if (!taskId) {
          console.warn('[MediaGeneration] blocked cancel request because taskId was missing.');
          return { content: [{ type: 'text', text: 'taskId is required for cancel action.' }], isError: true };
        }
        console.log(`[MediaGeneration] cancelling video task ${taskId}.`);
        const resp = await fetchWithAuth(`${serverBaseUrl}/api/media/videos/tasks/${taskId}/cancel`, { method: 'POST' });
        console.log(`[MediaGeneration] server returned HTTP ${resp.status} for video task cancel.`);
        const body = await resp.json() as { code: number; message?: string };
        if (body.code !== 0) {
          console.warn('[MediaGeneration] server rejected task cancel request:', serializeForLog({ taskId, code: body.code, message: body.message }));
          return { content: [{ type: 'text', text: body.message || 'Failed to cancel task.' }], isError: true };
        }
        return {
          content: [{ type: 'text', text: `Task ${taskId} cancelled successfully.` }],
          details: { taskId, status: 'cancelled' },
        };
      }

      // action === 'generate'
      const mediaType = tool === MediaGenerationTool.Image ? 'image' : 'video';
      const endpoint = mediaType === 'image' ? '/api/media/images/generate' : '/api/media/videos/generate';

      // Video generation confirmation: inform user about cost and duration
      if (mediaType === 'video') {
        const durationSec = typeof args.durationSeconds === 'number' ? args.durationSeconds : null;
        const costPoints = durationSec ? durationSec * 100 : null;
        const portalTasksUrl = getPortalTasksUrl();
        const subtitle = costPoints
          ? `本次生成大约预计消耗 **${costPoints}** 积分`
          : '费用约为 **100** 积分/秒';
        const questionText = [
          '请确认当前描述无误，提交后将无法取消。',
          '视频生成任务耗时较长，请耐心等待。',
          '',
          `生成后请妥善保存视频，若误删可在[「个人主页-用量详情-生成任务」](${portalTasksUrl})中下载`,
          '~~（链接有时效性，请尽快下载）~~',
        ].join('\n');
        const confirmResponse = await getMcpRuntime().askUserInternal([{
          question: questionText,
          title: '确认生成视频？',
          subtitle,
          options: [
            { label: '确认生成', description: '开始视频生成任务' },
            { label: '取消', description: '暂不生成' },
          ],
        }]);

        const userCancelled = confirmResponse?.behavior === 'deny'
          || confirmResponse?.answers?.[questionText] === '取消';

        if (userCancelled) {
          console.log('[MediaGeneration] user cancelled video generation confirmation.');
          return {
            content: [{ type: 'text', text: 'Video generation cancelled by user.' }],
            isError: true,
            details: { status: 'cancelled', reason: 'USER_CANCELLED' },
          };
        }
      }

      let params: Record<string, unknown> = {};
      if (args.image) {
        const existing = (args.images as string[]) || [];
        params.images = [args.image as string, ...existing];
      } else if (args.images) {
        params.images = args.images;
      }
      if (args.imageRoles) params.imageRoles = args.imageRoles;
      if (args.firstFrame) params.firstFrame = args.firstFrame;
      if (args.lastFrame) params.lastFrame = args.lastFrame;
      if (args.referenceImages) params.referenceImages = args.referenceImages;
      if (args.media) params.media = args.media;
      if (args.video) {
        const existing = (args.videos as string[]) || [];
        params.videos = [args.video as string, ...existing];
      } else if (args.videos) {
        params.videos = args.videos;
      }
      if (args.videoRoles) params.videoRoles = args.videoRoles;
      if (args.aspectRatio) params.aspectRatio = args.aspectRatio;
      if (args.resolution) params.resolution = args.resolution;
      if (args.size) params.size = args.size;
      if (args.count) params.count = args.count;
      if (args.durationSeconds != null) params.durationSeconds = args.durationSeconds;
      if (args.audio != null) params.audio = args.audio;
      if (args.watermark != null) params.watermark = args.watermark;
      if (args.seed != null) params.seed = args.seed;
      if (args.returnLastFrame != null) params.returnLastFrame = args.returnLastFrame;
      if (args.cameraFixed != null) params.cameraFixed = args.cameraFixed;
      if (args.filename) params.filename = args.filename;
      if (args.providerOptions) {
        params.providerOptions = args.providerOptions;
        const providerOptions = args.providerOptions;
        if (providerOptions && typeof providerOptions === 'object' && !Array.isArray(providerOptions)) {
          const rawMedia = (providerOptions as Record<string, unknown>).media;
          if (!params.media && Array.isArray(rawMedia)) {
            params.media = rawMedia;
          }
        }
      }

      const refs = sessionId ? mediaReferencesBySession.get(sessionId) : undefined;
      params = applyMediaReferencesToGenerationParams({
        mediaType: mediaType === MediaGenerationRequestType.Video
          ? MediaGenerationRequestType.Video
          : MediaGenerationRequestType.Image,
        params,
        refs,
      });

      // Convert local file paths to data URLs
      const MEDIA_MIME: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
      };
      const resolveRef = async (ref: string): Promise<string> => {
        if (!ref || ref.startsWith('http') || ref.startsWith('oss://') || ref.startsWith('data:')) return ref;
        const filePath = ref.startsWith('file://') ? fileURLToPath(ref) : path.resolve(ref);
        const buf = await fs.promises.readFile(filePath);
        const mime = MEDIA_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        return `data:${mime};base64,${buf.toString('base64')}`;
      };
      const resolveStringParam = async (name: string) => {
        if (typeof params[name] === 'string') {
          params[name] = await resolveRef(params[name] as string);
        }
      };
      const resolveStringArrayParam = async (name: string) => {
        if (Array.isArray(params[name])) {
          params[name] = await Promise.all((params[name] as string[]).map(resolveRef));
        }
      };
      const resolveMediaItem = async (item: unknown): Promise<unknown> => {
        if (typeof item === 'string') {
          return resolveRef(item);
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return item;
        }
        const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
        if (typeof next.url === 'string') {
          next.url = await resolveRef(next.url);
        }
        for (const key of ['image_url', 'video_url', 'audio_url']) {
          const nested = next[key];
          if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            const nestedRecord = nested as Record<string, unknown>;
            if (typeof nestedRecord.url === 'string') {
              next[key] = { ...nestedRecord, url: await resolveRef(nestedRecord.url) };
            }
          }
        }
        return next;
      };
      if (Array.isArray(params.images)) {
        params.images = await Promise.all((params.images as string[]).map(resolveRef));
      }
      await resolveStringParam('firstFrame');
      await resolveStringParam('lastFrame');
      await resolveStringArrayParam('referenceImages');
      if (Array.isArray(params.videos)) {
        params.videos = await Promise.all((params.videos as string[]).map(resolveRef));
      }
      if (Array.isArray(params.media)) {
        params.media = await Promise.all((params.media as unknown[]).map(resolveMediaItem));
      }

      const inferVideoGenerationType = (): string => {
        const normalizedModel = selectedModel.toLowerCase();
        if (normalizedModel.includes('happyhorse-1.0-r2v')) return 'r2v';
        if (normalizedModel.includes('happyhorse-1.0-t2v')) return 't2v';
        if (normalizedModel.includes('happyhorse-1.0-i2v')) return 'i2v';

        const imageRoles = Array.isArray(params.imageRoles)
          ? (params.imageRoles as unknown[]).map(role => String(role).toLowerCase())
          : [];
        const mediaItems = Array.isArray(params.media) ? params.media as unknown[] : [];
        const mediaTypes = mediaItems
          .filter(item => item && typeof item === 'object' && !Array.isArray(item))
          .map(item => String((item as Record<string, unknown>).type || '').toLowerCase());
        const hasReferenceImage = (Array.isArray(params.referenceImages) && (params.referenceImages as unknown[]).length > 0)
          || imageRoles.some(role => role === 'reference_image' || role === 'reference')
          || mediaTypes.some(type => type === 'reference_image');
        if (hasReferenceImage) return 'r2v';

        const hasFirstFrame = typeof params.firstFrame === 'string'
          || imageRoles.some(role => role === 'first_frame' || role === 'firstframe')
          || mediaTypes.some(type => type === 'first_frame')
          || (Array.isArray(params.images) && (params.images as unknown[]).length > 0);
        return hasFirstFrame ? 'i2v' : 't2v';
      };

      const generateReq = {
        model: selectedModel,
        type: mediaType === 'video' ? inferVideoGenerationType() : mediaType,
        prompt,
        params,
      };

      console.log('[MediaGeneration] sending generate request to server:', serializeForLog({
        endpoint,
        mediaType,
        selectedModel,
        selectedModelSource,
        promptLength: prompt.length,
        promptPreview: prompt.slice(0, 120),
        params: summarizeMediaGenerationParamsForLog(params),
      }));
      const resp = await fetchWithAuth(`${serverBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generateReq),
      });
      console.log(`[MediaGeneration] server returned HTTP ${resp.status} for ${mediaType} generate request.`);
      const body = await resp.json() as { code: number; data?: Record<string, unknown>; message?: string };

      if (body.code === 40203) {
        console.warn('[MediaGeneration] server rejected generate request because subscription is required.');
        return {
          content: [{ type: 'text', text: 'Media generation requires an active subscription. Please subscribe to use this feature.' }],
          isError: true,
          details: { status: 'failed', warnings: ['MEDIA_SUBSCRIPTION_REQUIRED'] },
        };
      }
      if (body.code === 40204) {
        console.warn('[MediaGeneration] server rejected generate request because quota was exhausted.');
        return {
          content: [{ type: 'text', text: 'Media generation quota exhausted for this period. Please wait for quota reset or upgrade your plan.' }],
          isError: true,
          details: { status: 'failed', warnings: ['MEDIA_QUOTA_EXHAUSTED'] },
        };
      }
      if (body.code !== 0) {
        console.warn('[MediaGeneration] server rejected generate request:', serializeForLog({ mediaType, selectedModel, code: body.code, message: body.message }));
        return {
          content: [{ type: 'text', text: body.message || 'Media generation request failed.' }],
          isError: true,
          details: { status: 'failed', warnings: [body.message || 'Unknown error'] },
        };
      }

      const task = body.data!;
      const status = task.status as string;
      const resultUrls = (task.resultUrls as string[]) || [];
      console.log('[MediaGeneration] server accepted generate request:', serializeForLog({
        mediaType,
        taskId: task.taskId,
        status,
        model: task.model || selectedModel,
        resultCount: resultUrls.length,
        quotaRemaining: task.quotaRemaining,
      }));
      const assets = resultUrls.map(url => ({
        type: mediaType,
        url,
        mimeType: mediaType === 'image' ? 'image/png' : 'video/mp4',
        ...(args.filename ? { filename: args.filename as string } : {}),
      }));
      let detailsAssets: unknown[] = assets;

      const billing: Record<string, unknown> = {};
      if (task.quotaRemaining != null) billing.quotaRemaining = task.quotaRemaining;
      if (mediaType === 'image') {
        if (args.count) billing.frozenImages = args.count;
      } else {
        if (args.durationSeconds) billing.frozenVideoSeconds = args.durationSeconds;
      }

      const lines = [
        `${mediaType === 'image' ? 'Image' : 'Video'} generation task created.`,
        `Task ID: ${task.upstreamTaskId || task.taskId}`,
        `Model: ${task.model || selectedModel || 'default'}`,
        `Status: ${status}`,
        ...(task.quotaRemaining != null ? [`Quota remaining: ${task.quotaRemaining}`] : []),
      ];

      if (status === 'succeeded' && mediaType === 'image' && sessionId) {
        const persistResult = await persistGeneratedImages(sessionId, assets);
        if (persistResult && persistResult.saved.length > 0) {
          detailsAssets = persistResult.saved;
          const fileLines = persistResult.saved.map(asset =>
            `  - [${asset.filename}](${pathToFileURL(asset.filePath).toString()})`
          );
          lines.push(`Results:\n${fileLines.join('\n')}`);
        } else if (assets.length > 0) {
          const resultLines = resultUrls.map((url, index) => `  - ![Generated image ${index + 1}](${url})`);
          lines.push(`Results:\n${resultLines.join('\n')}`);
        }
      } else if (status === 'succeeded' && mediaType === 'video' && sessionId) {
        const persistResult = await persistGeneratedVideos(sessionId, assets);
        if (persistResult && persistResult.saved.length > 0) {
          detailsAssets = persistResult.saved;
          const fileLines = persistResult.saved.map(asset =>
            `  - [${asset.filename}](${pathToFileURL(asset.filePath).toString()})`
          );
          lines.push(`Results:\n${fileLines.join('\n')}`);
        } else if (assets.length > 0) {
          const resultLines = resultUrls.map(url => `  - ${url}`);
          lines.push(`Results:\n${resultLines.join('\n')}`);
        }
      } else if (status === 'succeeded' && assets.length > 0) {
        const resultLines = resultUrls.map(url => `  - ${url}`);
        lines.push(`Results:\n${resultLines.join('\n')}`);
      }

      // Register async media tasks for background polling if not already completed.
      if (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled') {
        if (sessionId) {
          const metadata = task.metadata as Record<string, unknown> | undefined;
          const expiresAfterSec = metadata?.execution_expires_after ?? task.execution_expires_after;
          const timeoutMs = typeof expiresAfterSec === 'number' && expiresAfterSec > 0
            ? expiresAfterSec * 1000
            : MEDIA_TASK_DEFAULT_TIMEOUT_MS;
          registerMediaTaskForPolling({
            taskId: String(task.taskId),
            sessionId,
            mediaType,
            model: (task.model as string) || selectedModel,
            startedAt: Date.now(),
            pollCount: 0,
            timeoutMs,
          });
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {
          taskId: String(task.taskId),
          ...(task.upstreamTaskId ? { upstreamTaskId: String(task.upstreamTaskId) } : {}),
          status,
          model: (task.model as string) || selectedModel,
          ...(detailsAssets.length > 0 ? { assets: detailsAssets } : {}),
          ...(Object.keys(billing).length > 0 ? { billing } : {}),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'No auth tokens') {
        console.warn('[MediaGeneration] blocked media generation because the user is not logged in.');
        return { content: [{ type: 'text', text: 'Not logged in. Please log in to use media generation.' }], isError: true };
      }
      console.error('[MediaGeneration] media generation request failed:', error);
      return { content: [{ type: 'text', text: `Media generation error: ${msg}` }], isError: true };
    }
  };

  getMcpRuntime().setMediaGenerationHandler(handleMediaGenerationCallback);

  const registerMediaTaskForPolling = (tracker: MediaTaskTracker) => {
    pendingMediaTasks.set(tracker.taskId, tracker);
    ensureMediaPollTimerRunning();
  };

  const ensureMediaPollTimerRunning = () => {
    if (mediaTaskPollTimer) return;
    mediaTaskPollTimer = setInterval(() => {
      void pollPendingMediaTasks();
    }, MEDIA_POLL_FAST_MS);
  };

  const stopMediaPollTimer = () => {
    if (mediaTaskPollTimer) {
      clearInterval(mediaTaskPollTimer);
      mediaTaskPollTimer = null;
    }
  };

  const pollPendingMediaTasks = async () => {
    if (pendingMediaTasks.size === 0) {
      stopMediaPollTimer();
      return;
    }

    const serverBaseUrl = getServerApiBaseUrl();
    const now = Date.now();
    const tasksToRemove: string[] = [];

    for (const [taskId, tracker] of pendingMediaTasks) {
      if (isMediaTaskHandledByStatusPolling(tracker.sessionId, taskId)) {
        tasksToRemove.push(taskId);
        continue;
      }

      if (now - tracker.startedAt > tracker.timeoutMs) {
        tasksToRemove.push(taskId);
        emitMediaTaskMessage(tracker.sessionId, `${tracker.mediaType === 'video' ? 'Video' : 'Image'} generation timed out.\nTask ID: ${taskId}\nStatus: timeout`);
        continue;
      }

      if (tracker.pollCount >= MEDIA_POLL_FAST_COUNT) {
        const lastPollTime = tracker.lastPollAt ?? tracker.startedAt;
        const sinceLast = now - lastPollTime;
        const totalSlowAndMedium = MEDIA_POLL_FAST_COUNT + MEDIA_POLL_SLOW_COUNT;
        const totalBeforeIdle = totalSlowAndMedium + MEDIA_POLL_MEDIUM_COUNT;
        if (tracker.pollCount >= totalBeforeIdle) {
          if (sinceLast < MEDIA_POLL_IDLE_MS) continue;
        } else if (tracker.pollCount >= totalSlowAndMedium) {
          if (sinceLast < MEDIA_POLL_MEDIUM_MS) continue;
        } else {
          if (sinceLast < MEDIA_POLL_SLOW_MS) continue;
        }
      }

      tracker.pollCount++;
      tracker.lastPollAt = now;

      try {
        const endpoint = tracker.mediaType === 'video' ? 'videos' : 'images';
        const resp = await fetchWithAuth(`${serverBaseUrl}/api/media/${endpoint}/tasks/${taskId}`);
        const body = await resp.json() as { code: number; data?: Record<string, unknown>; message?: string };

        if (body.code !== 0) continue;
        const task = body.data!;
        const status = task.status as string;
        if (isMediaTaskHandledByStatusPolling(tracker.sessionId, taskId)) {
          tasksToRemove.push(taskId);
          continue;
        }

        if (TERMINAL_MEDIA_TASK_STATUSES.has(status)) {
          tasksToRemove.push(taskId);
          const resultUrls = (task.resultUrls as string[]) || [];
          const assets = resultUrls.map(url => ({
            type: tracker.mediaType,
            url,
            mimeType: tracker.mediaType === 'image' ? 'image/png' : 'video/mp4',
          }));
          if (status === 'succeeded' && tracker.mediaType === 'image') {
            const persistResult = await persistGeneratedImages(tracker.sessionId, assets);
            if (persistResult && persistResult.saved.length > 0) {
              const fileLines = persistResult.saved.map(asset => `  - [${asset.filename}](${pathToFileURL(asset.filePath).toString()})`);
              emitMediaTaskMessage(
                tracker.sessionId,
                `Saved generated ${persistResult.saved.length === 1 ? 'image' : 'images'}:\n${fileLines.join('\n')}`,
                {
                  toolResultDetails: {
                    status: 'succeeded',
                    assets: persistResult.saved,
                  },
                },
              );
            } else {
              const resultLines = resultUrls.map((_url, index) => `  - Generated image ${index + 1}`);
              emitMediaTaskMessage(tracker.sessionId, [
                'Image generation succeeded.',
                `Task ID: ${taskId}`,
                `Model: ${tracker.model}`,
                ...(resultUrls.length > 0 ? [`Results:\n${resultLines.join('\n')}`] : []),
                ...(task.errorMessage ? [`Error: ${task.errorMessage}`] : []),
              ].join('\n'));
            }
          } else if (status === 'succeeded' && tracker.mediaType === 'video') {
            const persistResult = await persistGeneratedVideos(tracker.sessionId, assets);
            if (persistResult && persistResult.saved.length > 0) {
              const fileLines = persistResult.saved.map(asset => `  - [${asset.filename}](${pathToFileURL(asset.filePath).toString()})`);
              emitMediaTaskMessage(
                tracker.sessionId,
                `Saved generated ${persistResult.saved.length === 1 ? 'video' : 'videos'}:\n${fileLines.join('\n')}`,
                {
                  toolResultDetails: {
                    status: 'succeeded',
                    assets: persistResult.saved,
                  },
                },
              );
            } else {
              const resultLines = resultUrls.map(url => `  - ${url}`);
              emitMediaTaskMessage(tracker.sessionId, [
                'Video generation succeeded.',
                `Task ID: ${taskId}`,
                `Model: ${tracker.model}`,
                ...(resultUrls.length > 0 ? [`Results:\n${resultLines.join('\n')}`] : []),
                ...(task.errorMessage ? [`Error: ${task.errorMessage}`] : []),
              ].join('\n'));
            }
          } else {
            const resultLines = tracker.mediaType === 'image'
              ? resultUrls.map((_url, index) => `  - Generated image ${index + 1}`)
              : resultUrls.map(url => `  - ${url}`);
            const lines = [
              `${tracker.mediaType === 'video' ? 'Video' : 'Image'} generation ${status}.`,
              `Task ID: ${taskId}`,
              `Model: ${tracker.model}`,
              ...(resultUrls.length > 0 ? [`Results:\n${resultLines.join('\n')}`] : []),
              ...(task.errorMessage ? [`Error: ${task.errorMessage}`] : []),
            ];
            emitMediaTaskMessage(tracker.sessionId, lines.join('\n'));
          }
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) win.webContents.send('auth:quotaChanged');
          });
        }
      } catch {
        // Network error, retry on next poll
      }
    }

    for (const taskId of tasksToRemove) {
      pendingMediaTasks.delete(taskId);
    }

    if (pendingMediaTasks.size === 0) {
      stopMediaPollTimer();
    }
  };

  const emitMediaTaskMessage = (sessionId: string, content: string, metadata?: Record<string, unknown>) => {
    let message: CoworkMessage = {
      id: `media-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'system' as const,
      content,
      timestamp: Date.now(),
      ...(metadata ? { metadata } : {}),
    };
    try {
      message = getCoworkStore().addMessage(sessionId, {
        type: 'system',
        content,
        ...(metadata ? { metadata } : {}),
      });
    } catch {
      // Session may have been deleted
    }
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('cowork:stream:message', { sessionId, message });
      }
    });
  };

  const persistGeneratedImages = async (
    sessionId: string,
    assets: RemoteGeneratedMediaAsset[],
  ): Promise<PersistGeneratedImageAssetsResult | null> => {
    const imageAssets = assets.filter(asset => asset.type === 'image' && asset.url.trim());
    if (imageAssets.length === 0) return null;

    const sessionForAssets = getCoworkStore().getSession(sessionId);
    const cwd = sessionForAssets?.cwd?.trim();
    if (!cwd) {
      console.warn('[MediaGeneration] skipped image persistence because the session working directory was missing.');
      return null;
    }

    const cachedAssets: PersistedGeneratedImageAsset[] = [];
    const pendingAssets = imageAssets.filter(asset => {
      const key = `${sessionId}:${asset.url.trim()}`;
      const cached = persistedGeneratedImageAssetsByUrl.get(key);
      if (cached) {
        cachedAssets.push(cached);
        return false;
      }
      return true;
    });
    if (pendingAssets.length === 0) {
      return cachedAssets.length > 0 ? { saved: cachedAssets, failed: [] } : null;
    }

    try {
      const result = await persistGeneratedImageAssets({
        cwd,
        assets: pendingAssets,
        fetchAsset: url => session.defaultSession.fetch(url),
      });
      for (const saved of result.saved) {
        persistedGeneratedImageAssetsByUrl.set(`${sessionId}:${saved.originalUrl || saved.url}`, saved);
      }
      for (const failed of result.failed) {
        console.warn('[MediaGeneration] failed to persist generated image:', serializeForLog({ sessionId, error: failed.error }));
      }
      return {
        saved: [...cachedAssets, ...result.saved],
        failed: result.failed,
      };
    } catch (error) {
      console.warn('[MediaGeneration] failed to persist generated image assets:', error);
      return cachedAssets.length > 0 ? { saved: cachedAssets, failed: [] } : null;
    }
  };

  const persistGeneratedVideos = async (
    sessionId: string,
    assets: RemoteGeneratedMediaAsset[],
  ): Promise<PersistGeneratedImageAssetsResult | null> => {
    const videoAssets = assets.filter(asset => asset.type === 'video' && asset.url.trim());
    if (videoAssets.length === 0) return null;

    const sessionForAssets = getCoworkStore().getSession(sessionId);
    const cwd = sessionForAssets?.cwd?.trim();
    if (!cwd) {
      console.warn('[MediaGeneration] skipped video persistence because the session working directory was missing.');
      return null;
    }

    const cachedAssets: PersistedGeneratedImageAsset[] = [];
    const pendingAssets = videoAssets.filter(asset => {
      const key = `${sessionId}:${asset.url.trim()}`;
      const cached = persistedGeneratedVideoAssetsByUrl.get(key);
      if (cached) {
        cachedAssets.push(cached);
        return false;
      }
      return true;
    });
    if (pendingAssets.length === 0) {
      return cachedAssets.length > 0 ? { saved: cachedAssets, failed: [] } : null;
    }

    try {
      const result = await persistGeneratedVideoAssets({
        cwd,
        assets: pendingAssets,
        fetchAsset: url => session.defaultSession.fetch(url),
      });
      for (const saved of result.saved) {
        persistedGeneratedVideoAssetsByUrl.set(`${sessionId}:${saved.originalUrl || saved.url}`, saved);
      }
      for (const failed of result.failed) {
        console.warn('[MediaGeneration] failed to persist generated video:', serializeForLog({ sessionId, error: failed.error }));
      }
      return {
        saved: [...cachedAssets, ...result.saved],
        failed: result.failed,
      };
    } catch (error) {
      console.warn('[MediaGeneration] failed to persist generated video assets:', error);
      return cachedAssets.length > 0 ? { saved: cachedAssets, failed: [] } : null;
    }
  };

  const MEDIA_ENTITLEMENT_SYNC_REASON = 'media-entitlement-changed';

  const getAuthQuotaGateState = () => ({
    subscriptionStatus: cachedSubscriptionStatus,
    mediaGenerationEntitled: cachedMediaGenerationEntitled,
  });

  const hasAuthQuotaGateStateChanged = (previous: ReturnType<typeof getAuthQuotaGateState>) => (
    cachedSubscriptionStatus !== previous.subscriptionStatus
    || cachedMediaGenerationEntitled !== previous.mediaGenerationEntitled
  );

  const syncOpenClawConfigIfAuthQuotaGateChanged = (previous: ReturnType<typeof getAuthQuotaGateState>) => {
    if (hasAuthQuotaGateStateChanged(previous)) {
      syncOpenClawConfig({ reason: MEDIA_ENTITLEMENT_SYNC_REASON, restartGatewayIfRunning: true }).catch(() => {});
    }
  };

  const resetAuthQuotaGateState = () => {
    const defaultGateState = createDefaultAuthQuotaGateState();
    cachedSubscriptionStatus = defaultGateState.subscriptionStatus;
    cachedMediaGenerationEntitled = defaultGateState.mediaGenerationEntitled;
  };

  /**
   * Normalize quota data from various server response formats into a unified shape.
   */
  const normalizeQuota = (raw: Record<string, unknown>) => {
    const quota = normalizeAuthQuota(raw, {
      freePlanName: t('authPlanFree'),
      standardPlanName: t('authPlanStandard'),
      fallbackSubscriptionStatus: cachedSubscriptionStatus,
    });
    const quotaGateState = authQuotaGateStateFromQuota(quota);
    cachedSubscriptionStatus = quotaGateState.subscriptionStatus;
    cachedMediaGenerationEntitled = quotaGateState.mediaGenerationEntitled;
    return quota;
  };

  ipcMain.handle('auth:login', async (_event, { loginUrl }: { loginUrl?: string } = {}) => {
    try {
      const baseUrl = loginUrl || `${getServerApiBaseUrl()}/login`;
      const finalUrl = `${baseUrl}?source=electron`;
      await shell.openExternal(finalUrl);
      return { success: true };
    } catch (error) {
      console.error('[Auth] login failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open login',
      };
    }
  });

  ipcMain.handle('auth:exchange', async (_event, { code }: { code: string }) => {
    try {
      const serverBaseUrl = getServerApiBaseUrl();
      const exchangeUrl = `${serverBaseUrl}/api/auth/exchange`;
      console.log(`[Auth] requesting auth exchange at ${exchangeUrl}`);
      const resp = await net.fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withKeyfromBody({ authCode: code })),
      });
      if (!resp.ok) {
        return { success: false, error: `Exchange failed: ${resp.status}` };
      }
      const body = (await resp.json()) as {
        code: number;
        message?: string;
        data: {
          accessToken: string;
          refreshToken: string;
          user: Record<string, unknown>;
          quota: Record<string, unknown>;
        };
      };
      if (body.code !== 0 || !body.data) {
        return { success: false, error: body.message || 'Exchange failed' };
      }
      saveAuthTokens(body.data.accessToken, body.data.refreshToken);
      saveAuthUser(body.data.user);
      console.log('[Auth] exchange user data:', JSON.stringify(body.data.user));
      const previousQuotaGateState = getAuthQuotaGateState();
      const quota = normalizeQuota(body.data.quota);
      syncOpenClawConfigIfAuthQuotaGateChanged(previousQuotaGateState);
      return { success: true, user: body.data.user, quota };
    } catch (error) {
      console.error('[Auth] exchange failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Exchange failed' };
    }
  });

  ipcMain.handle('auth:getUser', async () => {
    try {
      const tokens = getAuthTokens();
      if (!tokens) return { success: false };
      const serverBaseUrl = getServerApiBaseUrl();
      // Fetch user profile
      const profileResp = await fetchWithAuth(`${serverBaseUrl}/api/user/profile`);
      if (!profileResp.ok) return { success: false };
      const profileBody = (await profileResp.json()) as {
        code: number;
        data: Record<string, unknown>;
      };
      if (profileBody.code !== 0 || !profileBody.data) return { success: false };
      saveAuthUser(profileBody.data);
      // Fetch quota separately
      const quotaResp = await fetchWithAuth(`${serverBaseUrl}/api/user/quota`);
      let quota = null;
      if (quotaResp.ok) {
        const quotaBody = (await quotaResp.json()) as {
          code: number;
          data: Record<string, unknown>;
        };
        if (quotaBody.code === 0 && quotaBody.data) {
          const previousQuotaGateState = getAuthQuotaGateState();
          quota = normalizeQuota(quotaBody.data);
          syncOpenClawConfigIfAuthQuotaGateChanged(previousQuotaGateState);
        }
      }
      console.log('[Auth] getUser profile data:', JSON.stringify(profileBody.data));
      return { success: true, user: profileBody.data, quota };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('auth:getQuota', async () => {
    try {
      const tokens = getAuthTokens();
      if (!tokens) return { success: false };
      const serverBaseUrl = getServerApiBaseUrl();
      const resp = await fetchWithAuth(`${serverBaseUrl}/api/user/quota`);
      if (!resp.ok) return { success: false };
      const body = (await resp.json()) as { code: number; data: Record<string, unknown> };
      if (body.code !== 0 || !body.data) return { success: false };
      const previousQuotaGateState = getAuthQuotaGateState();
      const quota = normalizeQuota(body.data);
      syncOpenClawConfigIfAuthQuotaGateChanged(previousQuotaGateState);
      return { success: true, quota };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('auth:getProfileSummary', async () => {
    try {
      const tokens = getAuthTokens();
      if (!tokens) return { success: false };
      const serverBaseUrl = getServerApiBaseUrl();
      const profileSummaryUrl = appendKeyfromQuery(`${serverBaseUrl}/api/user/profile-summary`);
      console.log(`[Auth] requesting profile summary at ${profileSummaryUrl}`);
      const resp = await fetchWithAuth(profileSummaryUrl);
      if (!resp.ok) return { success: false };
      const body = (await resp.json()) as { code: number; data: Record<string, unknown> };
      if (body.code !== 0 || !body.data) return { success: false };
      return { success: true, data: body.data };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      const tokens = getAuthTokens();
      if (tokens) {
        const serverBaseUrl = getServerApiBaseUrl();
        const logoutUrl = `${serverBaseUrl}/api/auth/logout`;
        console.log(`[Auth] requesting logout at ${logoutUrl}`);
        await net
          .fetch(logoutUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(withKeyfromBody({})),
          })
          .catch(() => {
            /* best-effort */
          });
      }
      clearAuthTokens();
      clearAuthUser();
      clearServerModelMetadata();
      const previousQuotaGateState = getAuthQuotaGateState();
      resetAuthQuotaGateState();
      syncOpenClawConfigIfAuthQuotaGateChanged(previousQuotaGateState);
      return { success: true };
    } catch {
      const previousQuotaGateState = getAuthQuotaGateState();
      clearAuthTokens();
      clearAuthUser();
      clearServerModelMetadata();
      resetAuthQuotaGateState();
      syncOpenClawConfigIfAuthQuotaGateChanged(previousQuotaGateState);
      return { success: true };
    }
  });

  ipcMain.handle('auth:refreshToken', async () => {
    try {
      const accessToken = await refreshOnce('manual');
      return accessToken ? { success: true, accessToken } : { success: false };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('auth:getAccessToken', async () => {
    const tokens = getAuthTokens();
    return tokens?.accessToken || null;
  });

  ipcMain.handle('auth:getModels', async () => {
    try {
      const tokens = getAuthTokens();
      if (!tokens) {
        console.log('[Auth:getModels] No auth tokens available');
        return { success: false };
      }
      const serverBaseUrl = getServerApiBaseUrl();
      const url = appendKeyfromQuery(`${serverBaseUrl}/api/models/available`);
      console.log(`[Auth:getModels] requesting available models at ${url}`);
      const resp = await fetchWithAuth(url);
      console.log('[Auth:getModels] Response status:', resp.status);
      if (!resp.ok) {
        console.log('[Auth:getModels] Response not ok:', resp.status, resp.statusText);
        return { success: false };
      }
      const data = (await resp.json()) as {
        code: number;
        data: Array<{
          modelId: string;
          modelName: string;
          provider: string;
          apiFormat: string;
          supportsImage?: boolean;
          supportsThinking?: boolean;
          contextWindow?: number;
          costMultiplier?: number;
          description?: string;
        }>;
      };
      console.log('[Auth:getModels] Response data:', JSON.stringify(data).slice(0, 500));
      if (data.code !== 0) return { success: false };
      // Cache server model metadata for use in OpenClaw config sync (supportsImage, etc.)
      const serverModelsChanged = updateServerModelMetadata(data.data);
      // Re-sync so the gateway picks up the correct supportsImage values for server models.
      // This IPC can run after normal chat completion when the renderer refreshes quota/model
      // state, so server model updates must not force a hard gateway restart.
      if (serverModelsChanged) {
        syncOpenClawConfig({
          reason: 'server-models-updated',
          restartGatewayIfRunning: false,
        }).catch(() => {});
      } else {
        console.debug('[Auth:getModels] server model metadata unchanged, skipping config sync');
      }
      return { success: true, models: data.data };
    } catch (e) {
      console.error('[Auth:getModels] Error:', e);
      return { success: false };
    }
  });

  ipcMain.handle(HtmlShareIpc.CreateFromHtmlFile, async (_event, input: unknown) => {
    let archivePath: string | undefined;
    try {
      const options = sanitizeCreateFromHtmlFileInput(input);
      console.debug(
        `[HtmlShare] received HTML file share request for session ${options.sessionId} and artifact ${options.artifactId}`,
      );
      console.debug(
        `[HtmlShare] HTML file share uses share-code access and source file ${options.filePath}`,
      );
      const clientSourceKey = buildHtmlShareClientSourceKey(options.filePath);
      const packaged = await packageHtmlFile(options.filePath);
      archivePath = packaged.archivePath;
      console.debug(
        `[HtmlShare] packaged HTML file share with ${packaged.totalFiles} files, ${packaged.totalBytes} bytes, entry ${packaged.entryFile}, and ${packaged.warnings.length} warnings`,
      );
      const result = await uploadHtmlShare(
        getServerApiBaseUrl(),
        getHtmlSharePublicBaseUrl(),
        fetchWithAuth,
        {
          archivePath: packaged.archivePath,
          sourceType: HtmlShareSourceType.HtmlFile,
          clientSourceKey,
          sessionId: options.sessionId,
          artifactId: options.artifactId,
          title: options.title,
          entryFile: packaged.entryFile,
          sourceSha256: packaged.sourceSha256,
        },
      );
      console.debug(
        `[HtmlShare] HTML file share finished with success ${result.success} and code ${result.code ?? 'none'}`,
      );
      return { ...result, warnings: packaged.warnings };
    } catch (error) {
      console.error('[HtmlShare] failed to create share from HTML file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create share',
      };
    } finally {
      if (archivePath) {
        const archiveDir = path.dirname(archivePath);
        fs.promises
          .rm(archiveDir, { recursive: true, force: true })
          .then(() => {
            console.debug(`[HtmlShare] cleaned temporary archive directory ${archiveDir}`);
          })
          .catch((cleanupError): undefined => {
            console.warn('[HtmlShare] temporary archive cleanup failed:', cleanupError);
            return undefined;
          });
      }
    }
  });

  ipcMain.handle(HtmlShareIpc.GetByHtmlFile, async (_event, input: unknown) => {
    try {
      const options = sanitizeGetByHtmlFileInput(input);
      const clientSourceKey = buildHtmlShareClientSourceKey(options.filePath);
      return await getHtmlShareBySource(
        getServerApiBaseUrl(),
        getHtmlSharePublicBaseUrl(),
        fetchWithAuth,
        HtmlShareSourceType.HtmlFile,
        clientSourceKey,
      );
    } catch (error) {
      console.error('[HtmlShare] failed to look up share from HTML file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load share',
      };
    }
  });

  ipcMain.handle(HtmlShareIpc.UpdateFromHtmlFile, async (_event, input: unknown) => {
    let archivePath: string | undefined;
    try {
      const options = sanitizeUpdateFromHtmlFileInput(input);
      if (options.currentStatus === HtmlShareStatus.Disabled) {
        return { success: false, code: HtmlShareErrorCode.DisabledCannotUpdate };
      }
      const clientSourceKey = buildHtmlShareClientSourceKey(options.filePath);
      const packaged = await packageHtmlFile(options.filePath);
      archivePath = packaged.archivePath;
      const result = await updateHtmlShare(
        getServerApiBaseUrl(),
        getHtmlSharePublicBaseUrl(),
        fetchWithAuth,
        options.shareId,
        {
          archivePath: packaged.archivePath,
          sourceType: HtmlShareSourceType.HtmlFile,
          clientSourceKey,
          sessionId: options.sessionId,
          artifactId: options.artifactId,
          title: options.title,
          entryFile: packaged.entryFile,
          sourceSha256: packaged.sourceSha256,
        },
      );
      return { ...result, warnings: packaged.warnings };
    } catch (error) {
      console.error('[HtmlShare] failed to update share from HTML file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update share',
      };
    } finally {
      if (archivePath) {
        const archiveDir = path.dirname(archivePath);
        fs.promises
          .rm(archiveDir, { recursive: true, force: true })
          .then(() => {
            console.debug(`[HtmlShare] cleaned temporary archive directory ${archiveDir}`);
          })
          .catch((cleanupError): undefined => {
            console.warn('[HtmlShare] temporary archive cleanup failed:', cleanupError);
            return undefined;
          });
      }
    }
  });

  ipcMain.handle(HtmlShareIpc.UpdateStatus, async (_event, input: unknown) => {
    try {
      const options = sanitizeUpdateHtmlShareStatusInput(input);
      return await updateHtmlShareStatus(
        getServerApiBaseUrl(),
        getHtmlSharePublicBaseUrl(),
        fetchWithAuth,
        options.shareId,
        options.status,
      );
    } catch (error) {
      console.error('[HtmlShare] failed to update share status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update share status',
      };
    }
  });

  ipcMain.handle(HtmlShareIpc.Get, async (_event, shareId: unknown) => {
    try {
      const id = sanitizeHtmlShareString(shareId, 'shareId', 64);
      const resp = await fetchWithAuth(
        `${getServerApiBaseUrl()}/api/html-shares/${encodeURIComponent(id)}`,
      );
      const body = (await resp.json().catch((): null => null)) as {
        code?: number;
        message?: string;
        data?: unknown;
      } | null;
      if (!resp.ok || body?.code !== 0) {
        return { success: false, error: body?.message || `Share lookup failed: ${resp.status}` };
      }
      return { success: true, share: body.data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load share',
      };
    }
  });

  ipcMain.handle(HtmlShareIpc.Disable, async (_event, shareId: unknown) => {
    try {
      const id = sanitizeHtmlShareString(shareId, 'shareId', 64);
      return await updateHtmlShareStatus(
        getServerApiBaseUrl(),
        getHtmlSharePublicBaseUrl(),
        fetchWithAuth,
        id,
        HtmlShareStatus.Disabled,
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable share',
      };
    }
  });

  // Media generation IPC handlers
  ipcMain.handle('media:getModels', async (_event, type: 'image' | 'video') => {
    try {
      const tokens = getAuthTokens();
      if (!tokens) {
        console.warn('[Media:getModels] No auth tokens, skipping');
        return { success: false, error: 'Not logged in' };
      }
      const serverBaseUrl = getServerApiBaseUrl();
      const endpoint = type === 'image' ? '/api/media/images/models' : '/api/media/videos/models';
      const resp = await fetchWithAuth(`${serverBaseUrl}${endpoint}`);
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
      const body = await resp.json() as { code: number; data?: unknown[]; message?: string };
      if (body.code !== 0) return { success: false, error: body.message };
      return { success: true, models: body.data || [] };
    } catch (e) {
      console.error('[Media:getModels] Error:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('media:getTaskStatus', async (_event, taskId: number, type: 'image' | 'video') => {
    try {
      const tokens = getAuthTokens();
      if (!tokens) return { success: false, error: 'Not logged in' };
      const serverBaseUrl = getServerApiBaseUrl();
      const mediaPath = type === 'image' ? 'images' : 'videos';
      const taskUrl = `${serverBaseUrl}/api/media/${mediaPath}/tasks/${taskId}`;
      console.log('[Media:getTaskStatus] Fetching:', taskUrl);
      const resp = await fetchWithAuth(taskUrl);
      console.log('[Media:getTaskStatus] Response status:', resp.status);
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
      const body = await resp.json() as { code: number; data?: unknown; message?: string };
      console.log('[Media:getTaskStatus] Response body:', JSON.stringify(body));
      if (body.code !== 0) return { success: false, error: body.message };
      return { success: true, task: body.data };
    } catch (e) {
      console.error('[Media:getTaskStatus] Error:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  // Skills IPC handlers
  registerSkillHandlers({
    getSkillManager,
    getSkillStoreUrl,
    getOpenClawRuntimeAdapter: () => openClawRuntimeAdapter,
  });

  // Kits IPC handlers
  registerKitHandlers({
    getStore,
    getKitStoreUrl,
    getSkillManager,
  });

  ipcMain.handle('openclaw:engine:getStatus', async () => {
    try {
      const manager = getOpenClawEngineManager();
      return {
        success: true,
        status: manager.getStatus(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw engine status',
      };
    }
  });

  ipcMain.handle('openclaw:engine:install', async () => {
    try {
      const status = await bootstrapOpenClawEngine({
        forceReinstall: false,
        reason: 'manual-install',
      });
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to install OpenClaw engine',
      };
    }
  });

  ipcMain.handle('openclaw:engine:retryInstall', async () => {
    try {
      const status = await bootstrapOpenClawEngine({
        forceReinstall: true,
        reason: 'manual-retry',
      });
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to retry OpenClaw engine install',
      };
    }
  });

  let restartGatewayPromise: Promise<OpenClawEngineStatus> | null = null;
  ipcMain.handle('openclaw:engine:restartGateway', async () => {
    console.log(
      `${gwDiagTs()} IPC openclaw:engine:restartGateway: manual restart requested from renderer`,
    );
    if (restartGatewayPromise) {
      console.log(
        `${gwDiagTs()} IPC openclaw:engine:restartGateway: restart already in progress, joining existing promise`,
      );
      const status = await restartGatewayPromise;
      return { success: status.phase === 'running' || status.phase === 'ready', status };
    }
    try {
      const manager = getOpenClawEngineManager();
      restartGatewayPromise = manager.restartGateway('ipc-manual');
      const status = await restartGatewayPromise;
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to restart OpenClaw gateway',
      };
    } finally {
      restartGatewayPromise = null;
    }
  });

  const getBrowserControlBaseUrl = (): string => {
    const info = getOpenClawEngineManager().getGatewayConnectionInfo();
    if (!info.port) {
      throw new Error('OpenClaw gateway port is unavailable.');
    }
    return `http://127.0.0.1:${info.port + 2}`;
  };

  const fetchBrowserControlJson = async <T,>(
    path: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> => {
    const { timeoutMs = 5000, ...requestOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${getBrowserControlBaseUrl()}${path}`, {
        ...requestOptions,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { error: text };
        }
      }
      if (!response.ok) {
        const errorMessage = payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : `HTTP ${response.status}`;
        throw new Error(errorMessage);
      }
      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  };

  const buildBrowserProfileQuery = (profile?: string): string => (
    profile ? `?profile=${encodeURIComponent(profile)}` : ''
  );

  ipcMain.handle(BrowserIpc.GetStatus, async (_event, options?: { profile?: BrowserRuntimeProfile }) => {
    try {
      const status = await fetchBrowserControlJson<Record<string, unknown>>(
        `/${buildBrowserProfileQuery(options?.profile)}`,
        { timeoutMs: 3000 },
      );
      return { success: true, status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get browser status',
      };
    }
  });

  ipcMain.handle(BrowserIpc.ListProfiles, async () => {
    try {
      const result = await fetchBrowserControlJson<{ profiles?: unknown[] }>(
        '/profiles',
        { timeoutMs: 5000 },
      );
      return { success: true, profiles: result.profiles ?? [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list browser profiles',
      };
    }
  });

  ipcMain.handle(BrowserIpc.ResetProfile, async (_event, options?: { profile?: BrowserRuntimeProfile }) => {
    try {
      const profile = options?.profile || BrowserRuntimeProfile.Managed;
      const result = await fetchBrowserControlJson<Record<string, unknown>>(
        `/reset-profile${buildBrowserProfileQuery(profile)}`,
        { method: 'POST', timeoutMs: 20000 },
      );
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset browser profile',
      };
    }
  });

  ipcMain.handle(BrowserIpc.Test, async (_event, options?: { profile?: BrowserRuntimeProfile }) => {
    const steps: BrowserDiagnosticResultStep[] = [];
    const addStep = (step: BrowserDiagnosticStep, status: BrowserDiagnosticStatus, message: string, details?: string) => {
      steps.push({
        step,
        status,
        message,
        ...(details ? { details } : {}),
      });
    };
    const profile = options?.profile;

    try {
      const engineStatus = getOpenClawEngineManager().getStatus();
      if (engineStatus.phase !== 'running') {
        addStep(BrowserDiagnosticStep.GatewayStatus, BrowserDiagnosticStatus.Error, 'browserDiagnosticGatewayNotRunning', engineStatus.message);
        return { success: false, steps, error: engineStatus.message || 'OpenClaw gateway is not running.' };
      }
      addStep(BrowserDiagnosticStep.GatewayStatus, BrowserDiagnosticStatus.Success, 'browserDiagnosticGatewayReady');

      try {
        const profiles = await fetchBrowserControlJson<{ profiles?: unknown[] }>(
          '/profiles',
          { timeoutMs: 5000 },
        );
        addStep(BrowserDiagnosticStep.Profiles, BrowserDiagnosticStatus.Success, 'browserDiagnosticProfilesReady', `${profiles.profiles?.length ?? 0}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addStep(BrowserDiagnosticStep.Profiles, BrowserDiagnosticStatus.Error, 'browserDiagnosticProfilesFailed', message);
        return { success: false, steps, error: message };
      }

      try {
        await fetchBrowserControlJson<Record<string, unknown>>(
          `/${buildBrowserProfileQuery(profile)}`,
          { timeoutMs: 5000 },
        );
        addStep(BrowserDiagnosticStep.BrowserStatus, BrowserDiagnosticStatus.Success, 'browserDiagnosticStatusReady');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addStep(BrowserDiagnosticStep.BrowserStatus, BrowserDiagnosticStatus.Warning, 'browserDiagnosticStatusWarning', message);
      }

      try {
        await fetchBrowserControlJson<Record<string, unknown>>(
          `/start${buildBrowserProfileQuery(profile)}`,
          { method: 'POST', timeoutMs: 20000 },
        );
        addStep(BrowserDiagnosticStep.BrowserStart, BrowserDiagnosticStatus.Success, 'browserDiagnosticStartReady');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addStep(BrowserDiagnosticStep.BrowserStart, BrowserDiagnosticStatus.Error, 'browserDiagnosticStartFailed', message);
        return { success: false, steps, error: message };
      }

      try {
        await fetchBrowserControlJson<Record<string, unknown>>(
          `/tabs/open${buildBrowserProfileQuery(profile)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com' }),
            timeoutMs: 20000,
          },
        );
        addStep(BrowserDiagnosticStep.OpenTestPage, BrowserDiagnosticStatus.Success, 'browserDiagnosticOpenPageReady');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addStep(BrowserDiagnosticStep.OpenTestPage, BrowserDiagnosticStatus.Error, 'browserDiagnosticOpenPageFailed', message);
        return { success: false, steps, error: message };
      }

      return { success: true, steps };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browser diagnostic failed';
      if (steps.length === 0) {
        addStep(BrowserDiagnosticStep.GatewayStatus, BrowserDiagnosticStatus.Error, 'browserDiagnosticGatewayFailed', message);
      }
      return { success: false, steps, error: message };
    }
  });

  registerMcpHandlers({ getMcpRuntime, syncOpenClawConfig });

  // Cowork IPC handlers
  ipcMain.handle(
    'cowork:session:start',
    async (
      _event,
      options: {
        prompt: string;
        cwd?: string;
        systemPrompt?: string;
        title?: string;
        activeSkillIds?: string[];
        runtimeSkillIds?: string[];
        kitIds?: string[];
        kitReferences?: KitReference[];
        resolvedKitCapabilities?: ResolvedKitCapabilities;
        imageAttachments?: CoworkImageAttachmentMain[];
        agentId?: string;
        modelOverride?: string;
        mediaSelection?: {
          mode: 'auto' | 'image' | 'video' | 'none';
          modelId?: string;
          modelName?: string;
          imageModelId?: string;
          videoModelId?: string;
        };
        mediaReferences?: MediaAttachmentRefMain[];
        selectedTextSnippets?: CoworkSelectedTextSnippet[];
      },
    ) => {
      try {
        const ipcStartedAtMs = Date.now();
        console.log(
          '[CoworkFirstResponseTiming] start IPC received.',
          `Prompt length ${options.prompt.length}.`,
          `Image attachments ${options.imageAttachments?.length ?? 0}.`,
          `Agent ${options.agentId || 'main'}.`,
        );
        const engineStatus = await ensureOpenClawRunningForCowork();
        if (engineStatus.phase !== 'running') {
          return getEngineNotReadyResponse(engineStatus);
        }

        const coworkStoreInstance = getCoworkStore();
        const config = coworkStoreInstance.getConfig();
        const systemPrompt = mergeCoworkSystemPrompt(options.systemPrompt ?? config.systemPrompt);
        const selectedTaskDirectory = resolveSessionWorkingDirectory({
          cwd: options.cwd,
          agentId: options.agentId,
        });

        if (!selectedTaskDirectory) {
          return {
            success: false,
            error: 'Please select a task folder before submitting.',
          };
        }
        const imageAttachmentValidation = validateCoworkImageAttachmentsForRuntime(options.imageAttachments);
        if (imageAttachmentValidation.ok === false) {
          return {
            success: false,
            error: imageAttachmentValidation.error,
          };
        }

        const fallbackTitle = buildSessionTitleFromInput(
          options.prompt,
          t('coworkDefaultSessionTitle'),
        );
        const title = options.title?.trim() || fallbackTitle;
        const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedTaskDirectory);
        const runtimeSkillIds = options.runtimeSkillIds ?? options.activeSkillIds;
        const selectedTextSnippets = normalizeSelectedTextSnippetsForIpc(options.selectedTextSnippets);
        if (selectedTextSnippets.length > 0) {
          console.log(
            `[CoworkSelectedText] accepted ${selectedTextSnippets.length} excerpts with `
            + `${selectedTextSnippets.reduce((total, snippet) => total + snippet.text.length, 0)} characters for a new session`,
          );
        }

        const session = coworkStoreInstance.createSession(
          title,
          taskWorkingDirectory,
          systemPrompt,
          config.executionMode || 'local',
          runtimeSkillIds || [],
          options.agentId || 'main',
          options.modelOverride || '',
        );

        if (options.modelOverride) {
          console.log(
            '[Cowork:StartSession] session created with modelOverride:',
            session.id,
            options.modelOverride,
          );
        }

        if (options.mediaSelection && options.mediaSelection.mode !== 'none') {
          mediaSelectionBySession.set(session.id, options.mediaSelection);
        } else {
          mediaSelectionBySession.delete(session.id);
        }

        if (options.mediaReferences?.length) {
          mediaReferencesBySession.set(session.id, options.mediaReferences);
        } else {
          mediaReferencesBySession.delete(session.id);
        }

        if (options.imageAttachments?.length) {
          console.log('[Cowork:StartSession] imageAttachments received via IPC:', {
            count: options.imageAttachments.length,
            details: options.imageAttachments.map(img => ({
              name: img.name,
              mimeType: img.mimeType,
              base64Length: img.base64Data?.length ?? 0,
            })),
          });
        }
        const imageAttachmentPreviews = buildCoworkImageAttachmentPreviews(options.imageAttachments);
        const messageMetadata = buildCoworkUserSelectionMetadata({
          skillIds: options.activeSkillIds,
          kitIds: options.kitIds,
          kitReferences: options.kitReferences,
          resolvedKitCapabilities: options.resolvedKitCapabilities,
          selectedTextSnippets,
          imageAttachmentPreviews,
        });
        coworkStoreInstance.addMessage(session.id, {
          type: 'user',
          content: options.prompt,
          metadata: messageMetadata,
        });

        coworkStoreInstance.updateSession(session.id, { status: 'running' });

        const runtime = getCoworkEngineRouter();
        console.log(
          '[CoworkFirstResponseTiming] start IPC dispatched to runtime.',
          `Session ${session.id}.`,
          `Elapsed ${Date.now() - ipcStartedAtMs}ms.`,
        );
        runtime
          .startSession(session.id, options.prompt, {
            skipInitialUserMessage: true,
            systemPrompt,
            skillIds: runtimeSkillIds,
            messageSkillIds: options.activeSkillIds,
            kitIds: options.kitIds,
            kitReferences: options.kitReferences,
            resolvedKitCapabilities: options.resolvedKitCapabilities,
            workspaceRoot: taskWorkingDirectory,
            confirmationMode: 'modal',
            imageAttachments: options.imageAttachments,
            agentId: options.agentId,
            mediaSelection: options.mediaSelection,
            mediaReferences: options.mediaReferences,
            selectedTextSnippets,
          })
          .catch(error => {
            console.error('[Cowork] session error:', error);
            try {
              const existing = coworkStoreInstance.getSession(session.id);
              if (existing?.status === 'error') return;
              const errorMessage = error instanceof Error ? error.message : String(error);
              const windows = BrowserWindow.getAllWindows();
              windows.forEach(win => {
                if (win.isDestroyed()) return;
                win.webContents.send('cowork:stream:error', {
                  sessionId: session.id,
                  error: errorMessage,
                });
              });
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
            }
          });

        const sessionWithMessages = coworkStoreInstance.getSession(session.id) || {
          ...session,
          status: 'running' as const,
        };
        return { success: true, session: sessionWithMessages };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start session',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:continue',
    async (
      _event,
      options: {
        sessionId: string;
        prompt: string;
        systemPrompt?: string;
        activeSkillIds?: string[];
        runtimeSkillIds?: string[];
        kitIds?: string[];
        kitReferences?: KitReference[];
        resolvedKitCapabilities?: ResolvedKitCapabilities;
        imageAttachments?: CoworkImageAttachmentMain[];
        mediaSelection?: {
          mode: 'auto' | 'image' | 'video' | 'none';
          modelId?: string;
          modelName?: string;
          imageModelId?: string;
          videoModelId?: string;
        };
        mediaReferences?: MediaAttachmentRefMain[];
        selectedTextSnippets?: CoworkSelectedTextSnippet[];
      },
    ) => {
      try {
        const ipcStartedAtMs = Date.now();
        console.log(
          '[CoworkFirstResponseTiming] continue IPC received.',
          `Session ${options.sessionId}.`,
          `Prompt length ${options.prompt.length}.`,
          `Image attachments ${options.imageAttachments?.length ?? 0}.`,
        );
        const engineStatus = await ensureOpenClawRunningForCowork();
        if (engineStatus.phase !== 'running') {
          return getEngineNotReadyResponse(engineStatus);
        }

        const runtime = getCoworkEngineRouter();
        const existingSession = getCoworkStore().getSession(options.sessionId);
        const selectedTextSnippets = normalizeSelectedTextSnippetsForIpc(options.selectedTextSnippets);
        if (selectedTextSnippets.length > 0) {
          console.log(
            `[CoworkSelectedText] accepted ${selectedTextSnippets.length} excerpts with `
            + `${selectedTextSnippets.reduce((total, snippet) => total + snippet.text.length, 0)} characters for session ${options.sessionId}`,
          );
        }
        const imageAttachmentValidation = validateCoworkImageAttachmentsForRuntime(options.imageAttachments);
        if (imageAttachmentValidation.ok === false) {
          return {
            success: false,
            error: imageAttachmentValidation.error,
          };
        }

        if (options.mediaSelection && options.mediaSelection.mode !== 'none') {
          mediaSelectionBySession.set(options.sessionId, options.mediaSelection);
        } else {
          mediaSelectionBySession.delete(options.sessionId);
        }

        if (options.mediaReferences?.length) {
          mediaReferencesBySession.set(options.sessionId, options.mediaReferences);
        } else {
          mediaReferencesBySession.delete(options.sessionId);
        }

        if (options.imageAttachments?.length) {
          console.log('[Cowork:ContinueSession] imageAttachments received via IPC:', {
            sessionId: options.sessionId,
            count: options.imageAttachments.length,
            details: options.imageAttachments.map(img => ({
              name: img.name,
              mimeType: img.mimeType,
              base64Length: img.base64Data?.length ?? 0,
            })),
          });
        }

        console.log(
          '[CoworkFirstResponseTiming] continue IPC dispatched to runtime.',
          `Session ${options.sessionId}.`,
          `Elapsed ${Date.now() - ipcStartedAtMs}ms.`,
        );
        runtime
          .continueSession(options.sessionId, options.prompt, {
            systemPrompt: mergeCoworkSystemPrompt(
              options.systemPrompt ?? existingSession?.systemPrompt,
            ),
            skillIds: options.runtimeSkillIds ?? options.activeSkillIds,
            messageSkillIds: options.activeSkillIds,
            kitIds: options.kitIds,
            kitReferences: options.kitReferences,
            resolvedKitCapabilities: options.resolvedKitCapabilities,
            imageAttachments: options.imageAttachments,
            mediaSelection: options.mediaSelection,
            mediaReferences: options.mediaReferences,
            selectedTextSnippets,
          })
          .catch(error => {
            console.error('[Cowork] continue error:', error);
            try {
              const existing = getCoworkStore().getSession(options.sessionId);
              if (existing?.status === 'error') return;
              const errorMessage = error instanceof Error ? error.message : String(error);
              const windows = BrowserWindow.getAllWindows();
              windows.forEach(win => {
                if (win.isDestroyed()) return;
                win.webContents.send('cowork:stream:error', {
                  sessionId: options.sessionId,
                  error: errorMessage,
                });
              });
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
            }
          });

        const session = getCoworkStore().getSession(options.sessionId);
        return { success: true, session };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to continue session',
        };
      }
    },
  );

  ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
    try {
      const runtime = getCoworkEngineRouter();
      runtime.stopSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop session',
      };
    }
  });

  ipcMain.handle('cowork:session:delete', async (_event, sessionId: string) => {
    try {
      getCoworkEngineRouter().stopSession(sessionId);
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSession(sessionId);
      mediaSelectionBySession.delete(sessionId);
      mediaReferencesBySession.delete(sessionId);
      // Remove any pending media tasks for this session
      for (const [taskId, tracker] of pendingMediaTasks) {
        if (tracker.sessionId === sessionId) pendingMediaTasks.delete(taskId);
      }
      for (const key of mediaTasksHandledByStatusPolling) {
        if (key.startsWith(`${sessionId}:`)) mediaTasksHandledByStatusPolling.delete(key);
      }
      clearMediaStatusPollCountsForSession(sessionId);
      // Clean up IM session mapping so that new channel messages
      // create a fresh session instead of referencing a deleted one.
      try {
        getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
      } catch {
        // IM store may not be initialised yet; safe to ignore.
      }
      // Notify runtime to purge in-memory caches for this session
      // so that channel messages can create a fresh session.
      try {
        getCoworkEngineRouter().onSessionDeleted(sessionId);
      } catch {
        // Router may not be initialised yet; safe to ignore.
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete session',
      };
    }
  });

  ipcMain.handle('cowork:session:deleteBatch', async (_event, sessionIds: string[]) => {
    try {
      const runtime = getCoworkEngineRouter();
      sessionIds.forEach(sessionId => {
        runtime.stopSession(sessionId);
      });
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSessions(sessionIds);
      const router = getCoworkEngineRouter();
      for (const sessionId of sessionIds) {
        try {
          getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
        } catch {
          // IM store may not be initialised yet; safe to ignore.
        }
        try {
          router.onSessionDeleted(sessionId);
        } catch {
          // Router may not be initialised yet; safe to ignore.
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to batch delete sessions',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:pin',
    async (_event, options: { sessionId: string; pinned: boolean }) => {
      try {
        const coworkStoreInstance = getCoworkStore();
        const pinOrder = coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
        return { success: true, pinOrder };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update session pin',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:rename',
    async (_event, options: { sessionId: string; title: string }) => {
      try {
        const title = options.title.trim();
        if (!title) {
          return { success: false, error: 'Title is required' };
        }
        const coworkStoreInstance = getCoworkStore();
        coworkStoreInstance.updateSession(options.sessionId, { title }, { touchUpdatedAt: false });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to rename session',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkIpcChannel.ForkSession,
    async (
      _event,
      options?: {
        sessionId: string;
        forkedFromMessageId?: string | null;
        title?: string;
      },
    ) => {
      try {
        const sessionId = options?.sessionId?.trim();
        if (!sessionId) {
          return { success: false, error: 'Session id is required' };
        }

        const runtime = getCoworkEngineRouter();
        const coworkStoreInstance = getCoworkStore();
        const sourceSession = coworkStoreInstance.getSession(sessionId);
        if (!sourceSession) {
          console.warn('[CoworkFork] fork request referenced a missing session');
          return { success: false, error: 'Session not found' };
        }
        if (sourceSession.status === 'running' || runtime.isSessionActive(sessionId)) {
          console.warn('[CoworkFork] fork request was rejected because the session is still running');
          return { success: false, error: 'Please stop the current task before forking it.' };
        }

        const forkedFromMessageId = options?.forkedFromMessageId?.trim() || null;
        const forkedFromTimestamp = forkedFromMessageId
          ? coworkStoreInstance.getMessageTimestamp(sessionId, forkedFromMessageId)
          : null;
        const forkContextMessages: CoworkForkContextMessage[] = [];
        const compactionSummary = await runtime.getForkCompactionSummary(
          sessionId,
          forkedFromTimestamp ?? undefined,
        );
        if (compactionSummary) {
          forkContextMessages.push({
            content: compactionSummary.summary,
            metadata: {
              kind: CoworkSystemMessageKind.ForkCompactionSummary,
              sourceSessionId: sessionId,
              sourceSessionKey: compactionSummary.sessionKey,
              checkpointId: compactionSummary.checkpointId ?? null,
              checkpointReason: compactionSummary.reason ?? null,
              checkpointCreatedAt: compactionSummary.createdAt ?? null,
              tokensBefore: compactionSummary.tokensBefore ?? null,
              tokensAfter: compactionSummary.tokensAfter ?? null,
              truncated: compactionSummary.truncated === true,
            },
          });
          console.log(`[CoworkFork] attached a compaction summary bridge from source session ${sessionId}`);
        }

        console.log(`[CoworkFork] creating a local conversation fork from session ${sessionId}`);
        const session = coworkStoreInstance.forkSession({
          sourceSessionId: sessionId,
          forkMode: CoworkForkMode.Conversation,
          forkedFromMessageId,
          title: options?.title,
          contextMessages: forkContextMessages,
        });
        console.log(`[CoworkFork] created local conversation fork ${session.id} successfully`);
        return { success: true, session };
      } catch (error) {
        console.error('[CoworkFork] failed to fork session:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fork session',
        };
      }
    },
  );

  ipcMain.handle('cowork:session:get', async (_event, sessionId: string) => {
    try {
      const session = getCoworkStore().getSession(sessionId);
      if (session) {
        console.log(
          `[CoworkIPC] loaded session ${sessionId}; returned ${session.messages.length} of ${session.totalMessages} messages from offset ${session.messagesOffset}.`,
        );
      } else {
        console.warn(`[CoworkIPC] session ${sessionId} was not found during load.`);
      }
      return { success: true, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get session',
      };
    }
  });

  ipcMain.handle('cowork:session:remoteManaged', async (_event, sessionId: string) => {
    try {
      const mapping = getIMGatewayManager()
        ?.getIMStore()
        ?.getSessionMappingByCoworkSessionId(sessionId);
      return { success: true, remoteManaged: !!mapping };
    } catch (error) {
      return {
        success: false,
        remoteManaged: false,
        error: error instanceof Error ? error.message : 'Failed to check remote managed session',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:list',
    async (_event, options?: { limit?: number; offset?: number; agentId?: string }) => {
      try {
        const limit = options?.limit ?? COWORK_SESSION_PAGE_SIZE;
        const offset = options?.offset ?? 0;
        const agentId = options?.agentId;
        const store = getCoworkStore();
        const sessions = store.listSessions(limit, offset, agentId);
        const total = store.countSessions(agentId);
        return { success: true, sessions, hasMore: offset + sessions.length < total };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:getMessages',
    async (_event, options: { sessionId: string; limit?: number; offset?: number }) => {
      try {
        const { sessionId, limit = COWORK_MESSAGE_PAGE_SIZE, offset = 0 } = options;
        const store = getCoworkStore();
        const total = store.countSessionMessages(sessionId);
        const messages = store.getPagedSessionMessages(sessionId, limit, offset);
        console.log(
          `[CoworkIPC] loaded message page for session ${sessionId}; returned ${messages.length} of ${total} messages from offset ${offset} with limit ${limit}.`,
        );
        return { success: true, messages, offset, total };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session messages',
        };
      }
    },
  );

  ipcMain.handle('cowork:session:contextUsage', async (_event, sessionId: string) => {
    try {
      const usage = await getCoworkEngineRouter().getContextUsage(sessionId);
      return {
        success: true,
        usage,
        source: usage ? CoworkContextUsageSource.Live : CoworkContextUsageSource.Unavailable,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get context usage',
        reason: CoworkContextUsageFailureReason.GatewayError,
      };
    }
  });

  ipcMain.handle('cowork:session:compactContext', async (_event, sessionId: string) => {
    try {
      const result = await getCoworkEngineRouter().compactContext(sessionId);
      return { success: true, ...result };
    } catch (error) {
      console.warn(`[CoworkIPC] manual context compaction failed for session ${sessionId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compact context',
      };
    }
  });

  // ========== Agent IPC Handlers ==========

  ipcMain.handle(AgentIpcChannel.List, async () => {
    try {
      const agents = getAgentManager().listAgents();
      return { success: true, agents };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.Get, async (_event, id: string) => {
    try {
      const agent = getAgentManager().getAgent(id);
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get agent',
      };
    }
  });

  ipcMain.handle(
    AgentIpcChannel.Create,
    async (_event, request: import('./coworkStore').CreateAgentRequest) => {
      try {
        const agent = getAgentManager().createAgent(request, resolveDefaultAgentModelRef());
        // Sync config so workspace files (SOUL.md, IDENTITY.md, USER.md) are written
        // before OpenClaw scaffolds default templates for the new agent.
        syncOpenClawConfig({ reason: 'agent-created' }).catch(err => {
          console.error('[OpenClaw] config sync after agent-created failed:', err);
        });
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create agent',
        };
      }
    },
  );

  ipcMain.handle(
    AgentIpcChannel.Update,
    async (_event, id: string, updates: import('./coworkStore').UpdateAgentRequest) => {
      try {
        const previousAgent = getAgentManager().getAgent(id);
        const previousWorkingDirectory = previousAgent?.workingDirectory?.trim() || '';
        const nextWorkingDirectory = updates.workingDirectory?.trim() || '';
        const workingDirectoryChanged =
          updates.workingDirectory !== undefined &&
          previousAgent !== null &&
          previousWorkingDirectory !== nextWorkingDirectory;
        const agent = getAgentManager().updateAgent(id, updates);
        if (workingDirectoryChanged && agent) {
          refreshImSessionWorkingDirectoriesForAgent(agent.id);
        }
        const shouldSyncOpenClawConfig = Object.keys(updates).some(key => key !== 'pinned');
        if (shouldSyncOpenClawConfig) {
          syncOpenClawConfig({
            reason: workingDirectoryChanged ? 'agent-working-directory-updated' : 'agent-updated',
            restartGatewayIfRunning: workingDirectoryChanged,
          }).catch(err => {
            console.error('[OpenClaw] config sync after agent update failed:', err);
          });
        }
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update agent',
        };
      }
    },
  );

  ipcMain.handle(AgentIpcChannel.Delete, async (_event, id: string) => {
    try {
      const agentExists = id !== AgentId.Main && getAgentManager().getAgent(id) !== null;
      const deletedSessionIds = agentExists ? getCoworkStore().listSessionIdsByAgent(id) : [];
      const router = getCoworkEngineRouter();
      for (const sessionId of deletedSessionIds) {
        router.stopSession(sessionId);
      }

      const result = getAgentManager().deleteAgent(id);

      // Clean up IM platform bindings that reference the deleted agent
      // so that channels fall back to the default 'main' agent.
      try {
        const imStore = getIMGatewayManager()?.getIMStore();
        if (imStore) {
          const imSettings = imStore.getIMSettings();
          const bindings = imSettings.platformAgentBindings;
          if (bindings) {
            let changed = false;
            for (const [platform, agentId] of Object.entries(bindings)) {
              if (agentId === id) {
                delete bindings[platform];
                changed = true;
              }
            }
            if (changed) {
              imStore.setIMSettings({ platformAgentBindings: bindings });
            }
          }
        }
      } catch {
        // IM store may not be initialised yet; safe to ignore.
      }

      if (result) {
        for (const sessionId of deletedSessionIds) {
          try {
            getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
          } catch {
            // IM store may not be initialised yet; safe to ignore.
          }
          try {
            router.onSessionDeleted(sessionId);
          } catch {
            // Router may not be initialised yet; safe to ignore.
          }
        }
      }

      syncOpenClawConfig({ reason: 'agent-deleted' }).catch(err => {
        console.error('[OpenClaw] config sync after agent-deleted failed:', err);
      });
      return { success: true, deleted: result, deletedSessionIds: result ? deletedSessionIds : [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.Presets, async () => {
    try {
      const presets = getAgentManager().getPresetAgents();
      return { success: true, presets };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get presets',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.PresetTemplates, async () => {
    try {
      const presets = getAgentManager().getAllPresetAgents();
      return { success: true, presets };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get preset templates',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.AddPreset, async (_event, presetId: string) => {
    try {
      const agent = getAgentManager().addPresetAgent(presetId, resolveDefaultAgentModelRef());
      syncOpenClawConfig({ reason: 'agent-preset-added' }).catch(err => {
        console.error('[OpenClaw] config sync after agent-preset-added failed:', err);
      });
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add preset agent',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:exportResultImage',
    async (
      event,
      options: {
        rect: { x: number; y: number; width: number; height: number };
        defaultFileName?: string;
      },
    ) => {
      try {
        const { rect, defaultFileName } = options || {};
        const captureRect = normalizeCaptureRect(rect);
        if (!captureRect) {
          return { success: false, error: 'Capture rect is required' };
        }

        const image = await event.sender.capturePage(captureRect);
        return savePngWithDialog(event.sender, image.toPNG(), defaultFileName);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export session image',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:captureImageChunk',
    async (
      event,
      options: {
        rect: { x: number; y: number; width: number; height: number };
      },
    ) => {
      try {
        const captureRect = normalizeCaptureRect(options?.rect);
        if (!captureRect) {
          return { success: false, error: 'Capture rect is required' };
        }

        const image = await event.sender.capturePage(captureRect);
        const pngBuffer = image.toPNG();

        return {
          success: true,
          width: captureRect.width,
          height: captureRect.height,
          pngBase64: pngBuffer.toString('base64'),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:saveResultImage',
    async (
      event,
      options: {
        pngBase64: string;
        defaultFileName?: string;
      },
    ) => {
      try {
        const base64 = typeof options?.pngBase64 === 'string' ? options.pngBase64.trim() : '';
        if (!base64) {
          return { success: false, error: 'Image data is required' };
        }

        const pngBuffer = Buffer.from(base64, 'base64');
        if (pngBuffer.length <= 0) {
          return { success: false, error: 'Invalid image data' };
        }

        return savePngWithDialog(event.sender, pngBuffer, options?.defaultFileName);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save session image',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:exportText',
    async (
      event,
      options: {
        content: string;
        defaultFileName?: string;
        fileExtension?: string;
      },
    ) => {
      try {
        const content = typeof options?.content === 'string' ? options.content : '';
        if (!content) {
          return { success: false, error: 'Export content is empty' };
        }

        const ext = options?.fileExtension || 'md';
        const filterName = ext === 'json' ? 'JSON' : 'Markdown';
        const defaultName = options?.defaultFileName || `session-export.${ext}`;
        const ownerWindow = BrowserWindow.fromWebContents(event.sender);
        const saveOptions = {
          title: 'Export Session',
          defaultPath: path.join(app.getPath('downloads'), defaultName),
          filters: [{ name: filterName, extensions: [ext] }],
        };
        const saveResult = ownerWindow
          ? await dialog.showSaveDialog(ownerWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, canceled: true };
        }

        await fs.promises.writeFile(saveResult.filePath, content, 'utf-8');
        return { success: true, canceled: false, path: saveResult.filePath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export session',
        };
      }
    },
  );

  // ── Subagent tracking IPC ──────────────────────────────────────────────

  registerCoworkSubagentHandlers({
    getOpenClawRuntimeAdapter: () => openClawRuntimeAdapter,
    getCoworkEngineRouter,
  });

  ipcMain.handle('cowork:media:cancel', async (_event, taskId: string) => {
    try {
      const serverBaseUrl = getServerApiBaseUrl();
      const resp = await fetchWithAuth(`${serverBaseUrl}/api/media/videos/tasks/${taskId}/cancel`, { method: 'POST' });
      const body = await resp.json() as { code: number; message?: string };
      if (body.code === 0) {
        return { success: true };
      }
      const msg = body.message || '';
      if (msg.includes('409') || msg.includes('running') || msg.includes('Conflict')) {
        return { success: false, message: 'Task is already running and cannot be cancelled.' };
      }
      return { success: false, message: msg || 'Cancel failed' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Cancel failed' };
    }
  });

  ipcMain.handle('cowork:permission:respond', async (_event, options: {
    requestId: string;
    result: PermissionResult;
  }) => {
    try {
      // Dual-dispatch pattern: permission responses arrive through one IPC channel
      // but may target either of two independent subsystems.
      //
      // - resolveAskUser() handles AskUserQuestion plugin requests routed through
      //   the McpBridgeServer HTTP callback. It is a no-op when the requestId does
      //   not match a pending bridge request (i.e. for normal SDK permission requests).
      //
      // - respondToPermission() handles standard Claude Agent SDK permission requests
      //   managed by the CoworkEngineRouter. It is a no-op when the requestId does
      //   not match a pending SDK permission (i.e. for bridge plugin requests).
      //
      // Both calls are safe to invoke unconditionally; exactly one will match.

        // AskUserQuestion plugin responses go to the bridge server, not the runtime
        if (options.requestId) {
          const result = options.result;
          const askUserResponse: AskUserResponse = {
            behavior: result.behavior === 'allow' ? 'allow' : 'deny',
            answers:
              result.behavior === 'allow' &&
              result.updatedInput &&
              typeof result.updatedInput === 'object'
                ? ((result.updatedInput as Record<string, unknown>).answers as
                    | Record<string, string>
                    | undefined)
                : undefined,
          };
          getMcpRuntime().resolveAskUser(options.requestId, askUserResponse);
        }

        const runtime = getCoworkEngineRouter();
        runtime.respondToPermission(options.requestId, options.result);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to respond to permission',
        };
      }
    },
  );

  ipcMain.handle('cowork:config:get', async () => {
    try {
      const config = getCoworkStore().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      };
    }
  });

  ipcMain.handle(OpenClawSessionPolicyIpc.Get, async () => {
    try {
      const config = loadOpenClawSessionPolicyConfig(getStore());
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw session policy',
      };
    }
  });

  ipcMain.handle(OpenClawSessionPolicyIpc.Set, async (_event, config: unknown) => {
    try {
      const saved = saveOpenClawSessionPolicyConfig(getStore(), config);
      // Persist first and let the caller decide when to perform a unified sync/restart.
      await syncOpenClawConfig({
        reason: 'session-policy-updated',
        restartGatewayIfRunning: false,
      });
      return { success: true, config: saved };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save OpenClaw session policy',
      };
    }
  });

  ipcMain.handle(OpenClawSessionIpc.Patch, async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid OpenClaw session patch input.');
      }

      const request = input as { sessionId?: unknown; patch?: unknown };
      const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : '';
      if (!sessionId) {
        throw new Error('Session ID is required.');
      }

      const patch = sanitizeOpenClawSessionPatch(request.patch);
      if (patch.model) {
        patch.model = normalizeOpenClawModelRef(patch.model);
      }
      const runtime = getCoworkEngineRouter();
      await runtime.patchSession(sessionId, patch);

      if (patch.model !== undefined) {
        getCoworkStore().updateSession(
          sessionId,
          {
            modelOverride: patch.model ?? '',
          },
          { touchUpdatedAt: false },
        );
      }

      const session = getCoworkStore().getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      return {
        success: true,
        session,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to patch OpenClaw session',
      };
    }
  });

  ipcMain.handle(
    'cowork:memory:listEntries',
    async (
      _event,
      input: {
        query?: string;
        status?: 'created' | 'stale' | 'deleted' | 'all';
        includeDeleted?: boolean;
        limit?: number;
        offset?: number;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );

        // Lazy migration: SQLite → MEMORY.md (one-time, cached in memory)
        if (!memoryMigrationDone) {
          migrateSqliteToMemoryMd(filePath, {
            isMigrationDone: () =>
              getStore().get<string>('openclawMemory.migration.v1.completed') === '1',
            markMigrationDone: () => {
              getStore().set('openclawMemory.migration.v1.completed', '1');
              memoryMigrationDone = true;
            },
            getActiveMemoryTexts: () => {
              return getCoworkStore()
                .listUserMemories({ status: 'all', includeDeleted: false, limit: 200 })
                .map(m => m.text);
            },
          });
          // Even if migration found nothing, skip future checks this session
          memoryMigrationDone = true;
        }

        const query = input?.query?.trim() || '';
        const entries = query ? searchMemoryEntries(filePath, query) : readMemoryEntries(filePath);
        return { success: true, entries };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list memory entries',
        };
      }
    },
  );
  ipcMain.handle(
    'cowork:memory:createEntry',
    async (
      _event,
      input: {
        text: string;
        confidence?: number;
        isExplicit?: boolean;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );
        const entry = addMemoryEntry(filePath, input.text);
        return { success: true, entry };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create memory entry',
        };
      }
    },
  );
  ipcMain.handle(
    'cowork:memory:updateEntry',
    async (
      _event,
      input: {
        id: string;
        text?: string;
        confidence?: number;
        status?: 'created' | 'stale' | 'deleted';
        isExplicit?: boolean;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );
        if (!input.text) {
          return { success: false, error: 'Memory text is required' };
        }
        const entry = updateMemoryEntry(filePath, input.id, input.text);
        if (!entry) {
          return { success: false, error: 'Memory entry not found' };
        }
        return { success: true, entry };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update memory entry',
        };
      }
    },
  );
  ipcMain.handle(
    'cowork:memory:deleteEntry',
    async (
      _event,
      input: {
        id: string;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );
        const success = deleteMemoryEntry(filePath, input.id);
        return success ? { success: true } : { success: false, error: 'Memory entry not found' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete memory entry',
        };
      }
    },
  );
  ipcMain.handle('cowork:memory:getStats', async () => {
    try {
      const filePath = resolveMemoryFilePath(
        getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
      );
      const entries = readMemoryEntries(filePath);
      return {
        success: true,
        stats: {
          total: entries.length,
          created: entries.length,
          stale: 0,
          deleted: 0,
          explicit: entries.length,
          implicit: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memory stats',
      };
    }
  });
  // ── Dreaming content display ──────────────────────────────────────────
  ipcMain.handle('cowork:dreaming:status', async () => {
    try {
      const gwClient = openClawRuntimeAdapter?.getGatewayClient();
      if (!gwClient) {
        return { success: false, error: 'Gateway client not available' };
      }
      const result = await gwClient.request<Record<string, unknown>>(
        'doctor.memory.status',
        {},
        { timeoutMs: 10_000 },
      );
      const dreaming = (result as any)?.dreaming;
      if (!dreaming) {
        return { success: true, data: null };
      }
      return { success: true, data: dreaming };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch dreaming status',
      };
    }
  });
  ipcMain.handle('cowork:dreaming:diary', async () => {
    try {
      const gwClient = openClawRuntimeAdapter?.getGatewayClient();
      if (!gwClient) {
        return { success: false, error: 'Gateway client not available' };
      }
      const result = await gwClient.request<Record<string, unknown>>(
        'doctor.memory.dreamDiary',
        {},
        { timeoutMs: 10_000 },
      );
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch dream diary',
      };
    }
  });

  ipcMain.handle('cowork:bootstrap:read', async (_event, filename: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir());
      const content = readBootstrapFile(mainWorkspace, filename);
      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Failed to read bootstrap file',
      };
    }
  });
  ipcMain.handle('cowork:bootstrap:write', async (_event, filename: string, content: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir());
      writeBootstrapFile(mainWorkspace, filename, content);
      syncOpenClawConfig({ reason: 'bootstrap-updated' }).catch(err => {
        console.error('[OpenClaw] config sync after bootstrap-updated failed:', err);
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write bootstrap file',
      };
    }
  });

  const VALID_EMBEDDING_PROVIDERS = [
    'local',
    'openai',
    'gemini',
    'voyage',
    'mistral',
    'ollama',
  ] as const;

  function normalizeEmbeddingConfig(config: {
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
  }) {
    return {
      embeddingEnabled:
        typeof config.embeddingEnabled === 'boolean' ? config.embeddingEnabled : undefined,
      embeddingProvider:
        typeof config.embeddingProvider === 'string' &&
        (VALID_EMBEDDING_PROVIDERS as readonly string[]).includes(config.embeddingProvider)
          ? config.embeddingProvider
          : undefined,
      embeddingModel:
        typeof config.embeddingModel === 'string' ? config.embeddingModel.trim() : undefined,
      embeddingLocalModelPath:
        typeof config.embeddingLocalModelPath === 'string'
          ? config.embeddingLocalModelPath.trim()
          : undefined,
      embeddingVectorWeight:
        typeof config.embeddingVectorWeight === 'number' &&
        Number.isFinite(config.embeddingVectorWeight)
          ? Math.max(0, Math.min(1, config.embeddingVectorWeight))
          : undefined,
      embeddingRemoteBaseUrl:
        typeof config.embeddingRemoteBaseUrl === 'string'
          ? config.embeddingRemoteBaseUrl.trim()
          : undefined,
      embeddingRemoteApiKey:
        typeof config.embeddingRemoteApiKey === 'string'
          ? config.embeddingRemoteApiKey.trim()
          : undefined,
    };
  }

  ipcMain.handle('cowork:config:set', async (_event, config: {
    workingDirectory?: string;
    executionMode?: 'auto' | 'local' | 'sandbox';
    agentEngine?: CoworkAgentEngine;
    memoryEnabled?: boolean;
    memoryImplicitUpdateEnabled?: boolean;
    memoryLlmJudgeEnabled?: boolean;
    memoryGuardLevel?: 'strict' | 'standard' | 'relaxed';
    memoryUserMemoriesMaxItems?: number;
    skipMissedJobs?: boolean;
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
  }) => {
    try {
      const normalizedExecutionMode =
        config.executionMode && String(config.executionMode) === 'container'
          ? 'local'
          : config.executionMode;
      const normalizedAgentEngine = config.agentEngine === 'openclaw'
        ? 'openclaw'
        : undefined;
      const normalizedMemoryEnabled = typeof config.memoryEnabled === 'boolean'
        ? config.memoryEnabled
        : undefined;
      const normalizedMemoryImplicitUpdateEnabled = typeof config.memoryImplicitUpdateEnabled === 'boolean'
        ? config.memoryImplicitUpdateEnabled
        : undefined;
      const normalizedMemoryLlmJudgeEnabled = typeof config.memoryLlmJudgeEnabled === 'boolean'
        ? config.memoryLlmJudgeEnabled
        : undefined;
      const normalizedMemoryGuardLevel = config.memoryGuardLevel === 'strict'
        || config.memoryGuardLevel === 'standard'
        || config.memoryGuardLevel === 'relaxed'
        ? config.memoryGuardLevel
        : undefined;
      const normalizedMemoryUserMemoriesMaxItems =
        typeof config.memoryUserMemoriesMaxItems === 'number' && Number.isFinite(config.memoryUserMemoriesMaxItems)
          ? Math.max(
            MIN_MEMORY_USER_MEMORIES_MAX_ITEMS,
            Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(config.memoryUserMemoriesMaxItems)),
          )
          : undefined;
      const normalizedSkipMissedJobs = typeof config.skipMissedJobs === 'boolean'
        ? config.skipMissedJobs
        : undefined;
      const normalizedEmbedding = normalizeEmbeddingConfig(config);
      const normalizedConfig: Parameters<CoworkStore['setConfig']>[0] = {
        ...config,
        executionMode: normalizedExecutionMode,
        agentEngine: normalizedAgentEngine,
        memoryEnabled: normalizedMemoryEnabled,
        memoryImplicitUpdateEnabled: normalizedMemoryImplicitUpdateEnabled,
        memoryLlmJudgeEnabled: normalizedMemoryLlmJudgeEnabled,
        memoryGuardLevel: normalizedMemoryGuardLevel,
        memoryUserMemoriesMaxItems: normalizedMemoryUserMemoriesMaxItems,
        skipMissedJobs: normalizedSkipMissedJobs,
        ...normalizedEmbedding,
      };
      const previousConfig = getCoworkStore().getConfig();
      const previousWorkingDir = previousConfig.workingDirectory;
      getCoworkStore().setConfig(normalizedConfig);
      if (normalizedConfig.workingDirectory !== undefined && normalizedConfig.workingDirectory !== previousWorkingDir) {
        getSkillManager().handleWorkingDirectoryChange();
        // Main agent workspace is decoupled from workingDirectory — no MEMORY.md
        // or IDENTITY.md sync needed here. The workspace is always at
        // {STATE_DIR}/workspace-main/ regardless of the user's working directory.
      }

      const nextConfig = getCoworkStore().getConfig();
      const impactDecision = classifyCoworkConfigChange(previousConfig, nextConfig);
      if (impactDecision.impact !== OpenClawConfigImpact.None) {
        const syncResult = await syncOpenClawConfig({
          reason: 'cowork-config-change',
          restartGatewayIfRunning: impactDecision.impact === OpenClawConfigImpact.Restart,
        });
        if (!syncResult.success && nextConfig.agentEngine === 'openclaw') {
          return {
            success: false,
            code: ENGINE_NOT_READY_CODE,
            error: syncResult.error || 'OpenClaw config sync failed.',
            engineStatus: syncResult.status || getOpenClawEngineManager().getStatus(),
          };
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set config',
      };
    }
  });

  // ==================== Plugin Management IPC Handlers ====================

  registerPluginHandlers({ getCoworkStore, syncOpenClawConfig });

  // ==================== Scheduled Task IPC Handlers (OpenClaw) ====================

  initCronJobServiceManager({
    getOpenClawRuntimeAdapter: () => openClawRuntimeAdapter,
  });
  initScheduledTaskHelpers({
    getIMGatewayManager: () => ({
      getConfig: () => getIMGatewayManager().getConfig() as unknown as Record<string, unknown>,
    }),
  });
  registerScheduledTaskHandlers({
    getCronJobService,
    getIMGatewayManager: () => ({
      getIMStore: () => ({
        getSessionMapping: (conversationId: string, platform: string) =>
          getIMGatewayManager()
            .getIMStore()
            .getSessionMapping(conversationId, platform as Platform),
        listSessionMappings: (platform: string, agentId?: string) =>
          getIMGatewayManager()
            .getIMStore()
            .listSessionMappings(platform as Platform, agentId)
            .map(mapping => ({
              ...mapping,
              lastActiveAt: String(mapping.lastActiveAt),
            })),
      }),
      primeConversationReplyRoute: (
        platform: string,
        conversationId: string,
        coworkSessionId: string,
      ) =>
        getIMGatewayManager().primeConversationReplyRoute(
          platform as Platform,
          conversationId,
          coworkSessionId,
        ),
    }),
    getOpenClawRuntimeAdapter: () => openClawRuntimeAdapter,
  });

  registerNimQrLoginHandlers({
    startNimQrLogin,
    pollNimQrLogin,
  });

  // ==================== Permissions IPC Handlers ====================

  ipcMain.handle('permissions:checkCalendar', async () => {
    try {
      const status = await checkCalendarPermission();

      // Development mode: Auto-request permission if not determined
      // This provides a better dev experience without affecting production
      if (isDev && status === 'not-determined' && process.platform === 'darwin') {
        console.log('[Permissions] Development mode: Auto-requesting calendar permission...');
        try {
          await requestCalendarPermission();
          const newStatus = await checkCalendarPermission();
          console.log(
            '[Permissions] Development mode: Permission status after request:',
            newStatus,
          );
          return { success: true, status: newStatus, autoRequested: true };
        } catch (requestError) {
          console.warn('[Permissions] Development mode: Auto-request failed:', requestError);
        }
      }

      return { success: true, status };
    } catch (error) {
      console.error('[Main] Error checking calendar permission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check permission',
      };
    }
  });

  ipcMain.handle('permissions:requestCalendar', async () => {
    try {
      // Request permission and check status
      const granted = await requestCalendarPermission();
      const status = await checkCalendarPermission();
      return { success: true, granted, status };
    } catch (error) {
      console.error('[Main] Error requesting calendar permission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to request permission',
      };
    }
  });

  // ==================== IM Gateway IPC Handlers ====================

  ipcMain.handle('im:config:get', async () => {
    try {
      const config = getIMGatewayManager().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM config',
      };
    }
  });

  // Debounce + serialization for IM config sync requests.
  // A single Settings Save can include many IM edits; they are coalesced into
  // one OpenClaw config sync and at most one gateway restart.
  // The running/pending flags prevent concurrent sync operations from racing:
  // if a sync is in progress when new changes arrive, they are queued and
  // a follow-up sync runs after the current one completes.
  let imConfigSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let imConfigSyncRunning = false;
  let imConfigSyncPending = false;
  let imConfigSyncRestartGatewayIfRunning = false;
  let lastSyncedImOpenClawConfigFingerprint: string | null = null;
  const IM_CONFIG_SYNC_DEBOUNCE_MS = 600;
  type IMConfigSyncOptions = {
    restartGatewayIfRunning?: boolean;
  };
  type IMConfigSetOptions = IMConfigSyncOptions & {
    syncGateway?: boolean;
    markRestartOnSave?: boolean;
  };
  type IMConfigSyncResult = {
    success: boolean;
    error?: string;
    pending?: boolean;
  };
  let imConfigRestartOnNextSettingsSave = false;

  const getCurrentImOpenClawConfigFingerprint = () => {
    return createStableConfigFingerprint(getIMGatewayManager().getConfig());
  };

  const ensureLastSyncedImOpenClawConfigFingerprint = (fallbackFingerprint?: string) => {
    if (lastSyncedImOpenClawConfigFingerprint === null) {
      lastSyncedImOpenClawConfigFingerprint = fallbackFingerprint ?? getCurrentImOpenClawConfigFingerprint();
    }
    return lastSyncedImOpenClawConfigFingerprint;
  };

  const doImConfigSync = async (): Promise<IMConfigSyncResult> => {
    imConfigSyncRunning = true;
    const restartGatewayIfRunning = imConfigSyncRestartGatewayIfRunning;
    imConfigSyncRestartGatewayIfRunning = false;
    try {
      const syncResult = await syncOpenClawConfig({
        reason: 'im-config-change',
        restartGatewayIfRunning,
      });
      if (!syncResult.success) {
        throw new Error(syncResult.error || 'OpenClaw config sync failed.');
      }
      lastSyncedImOpenClawConfigFingerprint = getCurrentImOpenClawConfigFingerprint();
      imConfigRestartOnNextSettingsSave = false;
      // After config sync, ensure the runtime adapter's WebSocket client
      // is connected so channel events are received.
      if (openClawRuntimeAdapter) {
        try {
          await openClawRuntimeAdapter.connectGatewayIfNeeded();
        } catch (connectError) {
          console.error('[IM] Failed to connect gateway client after config sync:', connectError);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('[IM] Config sync failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OpenClaw config sync failed.',
      };
    } finally {
      imConfigSyncRunning = false;
      if (imConfigSyncPending) {
        const restartPendingGatewayIfRunning = imConfigSyncRestartGatewayIfRunning;
        imConfigSyncPending = false;
        scheduleImConfigSync({
          restartGatewayIfRunning: restartPendingGatewayIfRunning,
        });
      }
    }
  };

  const scheduleImConfigSync = (options: IMConfigSyncOptions = {}) => {
    if (options.restartGatewayIfRunning) {
      imConfigSyncRestartGatewayIfRunning = true;
    }
    if (imConfigSyncRunning) {
      // A sync is already in progress; mark pending so it re-runs after completion.
      imConfigSyncPending = true;
      return;
    }
    if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
    imConfigSyncTimer = setTimeout(() => {
      imConfigSyncTimer = null;
      void doImConfigSync();
    }, IM_CONFIG_SYNC_DEBOUNCE_MS);
  };

  const runImConfigSyncNow = async (options: IMConfigSyncOptions = {}): Promise<IMConfigSyncResult> => {
    if (options.restartGatewayIfRunning) {
      imConfigSyncRestartGatewayIfRunning = true;
    }
    if (imConfigSyncTimer) {
      clearTimeout(imConfigSyncTimer);
      imConfigSyncTimer = null;
    }
    if (imConfigSyncRunning) {
      imConfigSyncPending = true;
      return { success: true, pending: true };
    }
    return await doImConfigSync();
  };

  const recordImOpenClawConfigMutation = (
    previousFingerprint: string,
    nextFingerprint: string,
    options: IMConfigSetOptions = {},
  ) => {
    ensureLastSyncedImOpenClawConfigFingerprint(previousFingerprint);
    if (options.markRestartOnSave) {
      imConfigRestartOnNextSettingsSave = true;
    }
    const impactDecision = classifyImOpenClawConfigChange(previousFingerprint, nextFingerprint, {
      forceRestart: options.restartGatewayIfRunning === true,
    });
    if (impactDecision.impact === OpenClawConfigImpact.None) {
      return;
    }

    if (options.syncGateway) {
      scheduleImConfigSync({
        restartGatewayIfRunning:
          options.restartGatewayIfRunning === true
          || impactDecision.impact === OpenClawConfigImpact.Restart,
      });
    }
  };

  const mutateImOpenClawConfig = (
    mutate: () => void,
    options: IMConfigSetOptions = {},
  ) => {
    const previousFingerprint = getCurrentImOpenClawConfigFingerprint();
    mutate();
    const nextFingerprint = getCurrentImOpenClawConfigFingerprint();
    recordImOpenClawConfigMutation(previousFingerprint, nextFingerprint, options);
  };

  ipcMain.handle('im:config:set', async (_event, config: Partial<IMGatewayConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(() => {
        getIMGatewayManager().setConfig(config, {
          syncGateway: false,
          restartGatewayIfRunning: false,
        });
      }, {
        syncGateway: options?.syncGateway,
        restartGatewayIfRunning: options?.restartGatewayIfRunning,
        markRestartOnSave: options?.markRestartOnSave,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set IM config',
      };
    }
  });

  // Explicitly apply IM settings to OpenClaw.
  // Called from the global Settings Save button after IM fields have been
  // persisted locally without gateway sync.
  ipcMain.handle('im:config:sync', async () => {
    try {
      const nextFingerprint = getCurrentImOpenClawConfigFingerprint();
      const previousFingerprint = ensureLastSyncedImOpenClawConfigFingerprint(nextFingerprint);
      const impactDecision = classifyImOpenClawConfigChange(previousFingerprint, nextFingerprint, {
        forceRestart: imConfigRestartOnNextSettingsSave,
      });
      if (impactDecision.impact === OpenClawConfigImpact.None) {
        lastSyncedImOpenClawConfigFingerprint = nextFingerprint;
        return { success: true, skipped: true };
      }
      const syncResult = await runImConfigSyncNow({
        restartGatewayIfRunning: impactDecision.impact === OpenClawConfigImpact.Restart,
      });
      if (!syncResult.success) {
        return { success: false, error: syncResult.error };
      }
      return { success: true, skipped: false };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync IM config',
      };
    }
  });

  ipcMain.handle('im:gateway:start', async (_event, platform: Platform) => {
    try {
      // Persist enabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: true } });
      await manager.startGateway(platform);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start gateway',
      };
    }
  });

  ipcMain.handle('im:gateway:stop', async (_event, platform: Platform) => {
    try {
      // Persist disabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: false } });
      await manager.stopGateway(platform);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop gateway',
      };
    }
  });

  ipcMain.handle(
    'im:gateway:test',
    async (_event, platform: Platform, configOverride?: Partial<IMGatewayConfig>) => {
      try {
        const result = await getIMGatewayManager().testGateway(platform, configOverride);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test gateway connectivity',
        };
      }
    },
  );

  // Weixin QR login
  ipcMain.handle('im:weixin:qr-login-start', async () => {
    try {
      const result = await getIMGatewayManager().weixinQrLoginStart();
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start Weixin QR login',
      };
    }
  });

  ipcMain.handle('im:weixin:qr-login-wait', async (_event, sessionKey?: string) => {
    try {
      const previousFingerprint = getCurrentImOpenClawConfigFingerprint();
      const result = await getIMGatewayManager().weixinQrLoginWait(sessionKey);
      const nextFingerprint = getCurrentImOpenClawConfigFingerprint();
      recordImOpenClawConfigMutation(previousFingerprint, nextFingerprint, {
        syncGateway: false,
        restartGatewayIfRunning: false,
        markRestartOnSave: result.connected === true || result.alreadyConnected === true,
      });
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        connected: false,
        message: error instanceof Error ? error.message : 'Weixin QR login failed',
      };
    }
  });

  // POPO QR login
  ipcMain.handle('im:popo:qr-login-start', async () => {
    try {
      const result = getIMGatewayManager().popoQrLoginStart();
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start POPO QR login',
      };
    }
  });

  ipcMain.handle('im:popo:qr-login-poll', async (_event, taskToken: string) => {
    try {
      const result = await getIMGatewayManager().popoQrLoginPoll(taskToken);
      return result;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'POPO QR login poll failed',
      };
    }
  });

  ipcMain.handle('im:popo:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_POPO_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'POPO Bot',
      };
      getIMGatewayManager().getIMStore().setPopoInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add POPO instance',
      };
    }
  });

  ipcMain.handle('im:popo:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deletePopoInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete POPO instance',
      };
    }
  });

  ipcMain.handle('im:popo:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setPopoInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set POPO instance config',
      };
    }
  });

  ipcMain.handle('im:status:get', async () => {
    try {
      const status = await getIMGatewayManager().getStatusWithOpenClawRuntime();
      return { success: true, status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM status',
      };
    }
  });

  ipcMain.handle('im:getLocalIp', () => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  });
  ipcMain.handle('im:openclaw:config-schema', async () => {
    try {
      const result = await getIMGatewayManager().getOpenClawConfigSchema();
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw config schema',
      };
    }
  });

  // Email: Test connection
  ipcMain.handle('email:testConnection', async (event, { instanceId }: { instanceId: string }) => {
    try {
      const imManager = getIMGatewayManager();
      const imStore = imManager.getIMStore();
      const emailConfig = imStore.getEmailConfig();
      const instance = emailConfig.instances.find(i => i.instanceId === instanceId);

      if (!instance) {
        throw new Error('Instance not found');
      }

      if (instance.transport === 'imap') {
        // Test IMAP connection using node-imap

        let Imap: new (config: Record<string, unknown>) => any;
        try {
          Imap = require('imap');
        } catch {
          throw new Error('IMAP module not installed. Please install the imap package.');
        }
        const deriveImapHost = (email: string) => {
          const domain = email.split('@')[1];
          return `imap.${domain}`;
        };

        const connection = new Imap({
          user: instance.email,
          password: instance.password,
          host: instance.imapHost || deriveImapHost(instance.email),
          port: instance.imapPort || 993,
          tls: true,
        });

        await new Promise<void>((resolve, reject) => {
          connection.once('ready', () => {
            connection.end();
            resolve();
          });
          connection.once('error', reject);
          connection.connect();
        });
      } else if (instance.transport === 'ws') {
        // Test WebSocket connection by fetching token
        let fetchIMToken: (
          apiKey: string,
          email: string,
          logger: typeof console,
        ) => Promise<unknown>;
        try {
          ({ fetchIMToken } = require('@clawemail/node-sdk'));
        } catch {
          throw new Error(
            'Email SDK not installed. Please install the @clawemail/node-sdk package.',
          );
        }
        await fetchIMToken(instance.apiKey!, instance.email, console);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ---- Pairing IPC handlers ----

  ipcMain.handle('im:pairing:list', async (_event, platform: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const requests = listPairingRequests(platform, stateDir);
      const allowFrom = readAllowFromStore(platform, stateDir);
      return { success: true, requests, allowFrom };
    } catch (error) {
      return {
        success: false,
        requests: [],
        allowFrom: [],
        error: error instanceof Error ? error.message : 'Failed to list pairing requests',
      };
    }
  });

  ipcMain.handle('im:pairing:approve', async (_event, platform: string, code: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const approved = approvePairingCode(platform, code, stateDir);
      if (!approved) {
        return { success: false, error: 'Pairing code not found or expired' };
      }
      await syncOpenClawConfig({
        reason: `im-pairing-approval:${platform}`,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to approve pairing code',
      };
    }
  });

  ipcMain.handle('im:pairing:reject', async (_event, platform: string, code: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const rejected = rejectPairingRequest(platform, code, stateDir);
      if (!rejected) {
        return { success: false, error: 'Pairing code not found or expired' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reject pairing request',
      };
    }
  });

  // DingTalk Multi-Instance handlers
  ipcMain.handle('im:dingtalk:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DINGTALK_OPENCLAW_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'DingTalk Bot',
      };
      getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add DingTalk instance',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteDingTalkInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete DingTalk instance',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:config:set', async (_event, instanceId: string, config: Partial<DingTalkInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set DingTalk instance config',
      };
    }
  });

  // NIM Multi-Instance handlers
  ipcMain.handle('im:nim:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_NIM_OPENCLAW_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'NIM Bot',
      };
      getIMGatewayManager().getIMStore().setNimInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add NIM instance',
      };
    }
  });

  ipcMain.handle('im:nim:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteNimInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete NIM instance',
      };
    }
  });

  ipcMain.handle('im:nim:instance:config:set', async (_event, instanceId: string, config: Partial<NimInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setNimInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set NIM instance config',
      };
    }
  });

  // QQ Multi-Instance handlers
  ipcMain.handle('im:qq:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_QQ_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'QQ Bot',
      };
      getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add QQ instance',
      };
    }
  });

  ipcMain.handle('im:qq:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteQQInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete QQ instance',
      };
    }
  });

  ipcMain.handle('im:qq:instance:config:set', async (_event, instanceId: string, config: Partial<QQInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set QQ instance config',
      };
    }
  });

  // Feishu Multi-Instance handlers
  ipcMain.handle('im:feishu:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_FEISHU_OPENCLAW_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Feishu Bot',
      };
      getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Feishu instance',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteFeishuInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Feishu instance',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:config:set', async (_event, instanceId: string, config: Partial<FeishuInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Feishu instance config',
      };
    }
  });

  // Email Multi-Instance handlers
  ipcMain.handle('im:email:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_EMAIL_INSTANCE_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Email',
        email: '',
        agentId: 'main',
      };
      getIMGatewayManager().getIMStore().setEmailInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add email instance',
      };
    }
  });

  // WeCom Multi-Instance handlers
  ipcMain.handle('im:wecom:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_WECOM_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'WeCom Bot',
      };
      getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add WeCom instance',
      };
    }
  });

  ipcMain.handle('im:email:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteEmailInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete email instance',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteWecomInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete WeCom instance',
      };
    }
  });

  ipcMain.handle('im:email:instance:config:set', async (_event, instanceId: string, config: Partial<EmailMultiInstanceConfig['instances'][number]>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setEmailInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set email instance config',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:config:set', async (_event, instanceId: string, config: Partial<WecomInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set WeCom instance config',
      };
    }
  });

  // Telegram Multi-Instance handlers
  ipcMain.handle('im:telegram:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_TELEGRAM_OPENCLAW_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Telegram Bot',
      };
      getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Telegram instance',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteTelegramInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Telegram instance',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:config:set', async (_event, instanceId: string, config: Partial<TelegramInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Telegram instance config',
      };
    }
  });

  // Discord Multi-Instance handlers
  ipcMain.handle('im:discord:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DISCORD_OPENCLAW_CONFIG: defaults } = await import('./im/types');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Discord Bot',
      };
      getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Discord instance',
      };
    }
  });

  ipcMain.handle('im:discord:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteDiscordInstance(instanceId),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Discord instance',
      };
    }
  });

  ipcMain.handle('im:discord:instance:config:set', async (_event, instanceId: string, config: Partial<DiscordInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Discord instance config',
      };
    }
  });

  // Feishu bot install helpers
  ipcMain.handle('feishu:install:qrcode', async (_event, { isLark }: { isLark: boolean }) => {
    try {
      return await getIMGatewayManager().startFeishuInstallQrcode(isLark);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取二维码失败');
    }
  });

  ipcMain.handle('feishu:install:poll', async (_event, { deviceCode }: { deviceCode: string }) => {
    try {
      return await getIMGatewayManager().pollFeishuInstall(deviceCode);
    } catch (error) {
      return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
    }
  });

  ipcMain.handle(
    'feishu:install:verify',
    async (_event, { appId, appSecret }: { appId: string; appSecret: string }) => {
      try {
        return await getIMGatewayManager().verifyFeishuCredentials(appId, appSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  );

  // DingTalk bot install helpers
  ipcMain.handle('dingtalk:install:qrcode', async () => {
    try {
      return await getIMGatewayManager().startDingTalkInstallQrcode();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取二维码失败');
    }
  });

  ipcMain.handle(
    'dingtalk:install:poll',
    async (_event, { deviceCode }: { deviceCode: string }) => {
      try {
        return await getIMGatewayManager().pollDingTalkInstall(deviceCode);
      } catch (error) {
        return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
      }
    },
  );

  ipcMain.handle(
    'dingtalk:install:verify',
    async (_event, { clientId, clientSecret }: { clientId: string; clientSecret: string }) => {
      try {
        return await getIMGatewayManager().verifyDingTalkCredentials(clientId, clientSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  );

  // GitHub Copilot device code authentication handlers
  ipcMain.handle('github-copilot:request-device-code', async () => {
    const { requestDeviceCode } = await import('./libs/githubCopilotAuth');
    try {
      const result = await requestDeviceCode();
      return {
        userCode: result.user_code,
        verificationUri: result.verification_uri,
        deviceCode: result.device_code,
        interval: result.interval,
        expiresIn: result.expires_in,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to request device code');
    }
  });

  ipcMain.handle(
    'github-copilot:poll-for-token',
    async (
      _event,
      {
        deviceCode,
        interval,
        expiresIn,
      }: { deviceCode: string; interval: number; expiresIn: number },
    ) => {
      const { pollForAccessToken, getCopilotToken, getGitHubUser } =
        await import('./libs/githubCopilotAuth');
      try {
        const githubAccessToken = await pollForAccessToken(deviceCode, interval, expiresIn);
        const githubUser = await getGitHubUser(githubAccessToken);
        const {
          token: copilotToken,
          expiresAt,
          baseUrl,
        } = await getCopilotToken(githubAccessToken);
        // Store the GitHub access token for later token refresh
        getStore().set('github_copilot_github_token', githubAccessToken);
        // Register with the token manager for automatic refresh
        setCopilotTokenState({ copilotToken, baseUrl, expiresAt, githubToken: githubAccessToken });
        return { success: true, token: copilotToken, githubUser, baseUrl };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Authentication failed',
        };
      }
    },
  );

  ipcMain.handle('github-copilot:cancel-polling', async () => {
    const { cancelPolling } = await import('./libs/githubCopilotAuth');
    cancelPolling();
  });

  ipcMain.handle('github-copilot:sign-out', async () => {
    getStore().delete('github_copilot_github_token');
    clearCopilotTokenState();
  });

  ipcMain.handle('github-copilot:refresh-token', async () => {
    try {
      const state = await refreshCopilotTokenNow();
      return { success: true, token: state.copilotToken, baseUrl: state.baseUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed',
      };
    }
  });

  // OpenAI ChatGPT (Codex) OAuth handlers — see src/main/libs/openaiCodexAuth.ts.
  // The login flow opens a browser to https://auth.openai.com/oauth/authorize
  // and listens on http://127.0.0.1:1455/auth/callback for the redirect, then
  // writes <CODEX_HOME>/auth.json so the OpenClaw runtime can pick it up.
  ipcMain.handle('openai-codex-oauth:start', async () => {
    const { startOpenAICodexLogin } = await import('./libs/openaiCodexAuth');
    try {
      const tokens = await startOpenAICodexLogin();
      return {
        success: true as const,
        email: tokens.email ?? null,
        accountId: tokens.accountId ?? null,
        expiresAt: tokens.expiresAt,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'ChatGPT login failed',
      };
    }
  });

  ipcMain.handle('openai-codex-oauth:cancel', async () => {
    const { cancelOpenAICodexLogin } = await import('./libs/openaiCodexAuth');
    cancelOpenAICodexLogin();
  });

  ipcMain.handle('openai-codex-oauth:logout', async () => {
    const { logoutOpenAICodex } = await import('./libs/openaiCodexAuth');
    logoutOpenAICodex();
  });

  ipcMain.handle('openai-codex-oauth:status', async () => {
    const { readOpenAICodexAuthFile } = await import('./libs/openaiCodexAuth');
    const tokens = readOpenAICodexAuthFile();
    if (!tokens) return { loggedIn: false as const };
    return {
      loggedIn: true as const,
      email: tokens.email ?? null,
      accountId: tokens.accountId ?? null,
      expiresAt: tokens.expiresAt,
    };
  });

  ipcMain.handle('generate-session-title', async (_event, userInput: string | null) => {
    return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
  });

  ipcMain.handle('get-recent-cwds', async (_event, limit?: number) => {
    const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
    return getCoworkStore().listRecentCwds(boundedLimit);
  });

  ipcMain.handle('get-api-config', async () => {
    return getCurrentApiConfig();
  });

  ipcMain.handle('check-api-config', async (_event, options?: { probeModel?: boolean }) => {
    const { config, error } = resolveCurrentApiConfig();
    if (config && options?.probeModel) {
      const probe = await probeCoworkModelReadiness();
      if (probe.ok === false) {
        return { hasConfig: false, config: null, error: probe.error };
      }
    }
    return { hasConfig: config !== null, config, error };
  });

  ipcMain.handle(
    'save-api-config',
    async (
      _event,
      config: {
        apiKey: string;
        baseURL: string;
        model: string;
        apiType?: 'anthropic' | 'openai';
      },
    ) => {
      try {
        saveCoworkApiConfig(config);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save API config',
        };
      }
    },
  );

  // Dialog handlers
  ipcMain.handle('dialog:selectDirectory', async event => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle(
    'dialog:selectFile',
    async (
      event,
      options?: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        title: options?.title,
        filters: options?.filters,
      };
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, path: null };
      }
      return { success: true, path: result.filePaths[0] };
    },
  );

  ipcMain.handle(
    'dialog:selectFiles',
    async (
      event,
      options?: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
        title: options?.title,
        filters: options?.filters,
      };
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, paths: [] };
      }
      return { success: true, paths: result.filePaths };
    },
  );

  ipcMain.handle(
    'dialog:showMessageBox',
    async (
      event,
      options: {
        message: string;
        type?: 'none' | 'info' | 'error' | 'question' | 'warning';
        title?: string;
      },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const { dialog } = await import('electron');
      return dialog.showMessageBox(ownerWindow!, {
        type: options.type || 'warning',
        title: options.title || '',
        message: options.message,
        buttons: ['OK'],
      });
    },
  );

  ipcMain.handle(
    'dialog:saveInlineFile',
    async (
      _event,
      options?: { dataBase64?: string; fileName?: string; mimeType?: string; cwd?: string },
    ) => {
      try {
        const dataBase64 = typeof options?.dataBase64 === 'string' ? options.dataBase64.trim() : '';
        if (!dataBase64) {
          return { success: false, path: null, error: 'Missing file data' };
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        if (!buffer.length) {
          return { success: false, path: null, error: 'Invalid file data' };
        }
        if (buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
          return {
            success: false,
            path: null,
            error: `File too large (max ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB)`,
          };
        }

        const dir = resolveInlineAttachmentDir(options?.cwd);
        await fs.promises.mkdir(dir, { recursive: true });

        const safeFileName = sanitizeAttachmentFileName(options?.fileName);
        const extension = inferAttachmentExtension(safeFileName, options?.mimeType);
        const baseName = extension ? safeFileName.slice(0, -extension.length) : safeFileName;
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalName = `${baseName || 'attachment'}-${uniqueSuffix}${extension}`;
        const outputPath = path.join(dir, finalName);

        await fs.promises.writeFile(outputPath, buffer);
        return { success: true, path: outputPath };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to save inline file',
        };
      }
    },
  );

  // Read a local file as a data URL (data:<mime>;base64,...)
  const MAX_READ_AS_DATA_URL_BYTES = 100 * 1024 * 1024;
  const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
  };
  ipcMain.handle(
    'dialog:readFileAsDataUrl',
    async (
      _event,
      filePath?: string,
    ): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (stat.size > MAX_READ_AS_DATA_URL_BYTES) {
          return {
            success: false,
            error: `File too large (max ${Math.floor(MAX_READ_AS_DATA_URL_BYTES / (1024 * 1024))}MB)`,
          };
        }
        const buffer = await fs.promises.readFile(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const base64 = buffer.toString('base64');
        return { success: true, dataUrl: `data:${mimeType};base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file',
        };
      }
    },
  );

  ipcMain.handle(
    DialogIpc.StatFile,
    async (_event, filePath?: string): Promise<{ success: boolean; isFile?: boolean; size?: number; mtimeMs?: number; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const stat = await fs.promises.stat(path.resolve(filePath.trim()));
        return {
          success: true,
          isFile: stat.isFile(),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to stat file',
        };
      }
    }
  );

  const MAX_READ_TEXT_FILE_BYTES = 2 * 1024 * 1024;
  ipcMain.handle(
    DialogIpc.ReadTextFile,
    async (_event, filePath?: string): Promise<{ success: boolean; content?: string; size?: number; readBytes?: number; truncated?: boolean; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }

        const truncated = stat.size > MAX_READ_TEXT_FILE_BYTES;
        const handle = await fs.promises.open(resolvedPath, 'r');
        try {
          const bytesToRead = Math.min(stat.size, MAX_READ_TEXT_FILE_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
          return {
            success: true,
            content: buffer.subarray(0, bytesRead).toString('utf8'),
            size: stat.size,
            readBytes: bytesRead,
            truncated,
          };
        } finally {
          await handle.close();
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file',
        };
      }
    }
  );

  ipcMain.handle(
    'dialog:generateThumbnail',
    async (
      _event,
      filePath?: string,
    ): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (process.platform !== 'darwin') {
          return { success: false, error: 'Thumbnail generation only supported on macOS' };
        }
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const tmpDir = path.join(app.getPath('temp'), 'lobsterai-thumbnails');
        await fs.promises.mkdir(tmpDir, { recursive: true });
        const baseName = path.basename(resolvedPath);
        const outputFile = path.join(tmpDir, `${baseName}.png`);
        try {
          await fs.promises.unlink(outputFile);
        } catch {
          /* ignore */
        }
        await execFileAsync('qlmanage', ['-t', '-s', '1200', '-o', tmpDir, resolvedPath]);
        const thumbBuffer = await fs.promises.readFile(outputFile);
        const base64 = thumbBuffer.toString('base64');
        try {
          await fs.promises.unlink(outputFile);
        } catch {
          /* ignore */
        }
        return { success: true, dataUrl: `data:image/png;base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate thumbnail',
        };
      }
    },
  );

  const getFileAccessFailureReason = (error: unknown): ShellOpenFailureReasonType => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return ShellOpenFailureReason.NotFound;
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return ShellOpenFailureReason.PermissionDenied;
    }
    return ShellOpenFailureReason.Unknown;
  };

  const getFailedShellPathStatus = async (
    operation: string,
    normalizedPath: string,
    fallbackError: string,
  ): Promise<{ success: false; error: string; reason: ShellOpenFailureReasonType }> => {
    try {
      await fs.promises.stat(normalizedPath);
      const status = {
        success: false,
        error: fallbackError,
        reason: ShellOpenFailureReason.OpenFailed,
      } as const;
      console.warn(`[Shell] failed to ${operation} because the system could not open the existing path:`, normalizedPath);
      return status;
    } catch (error) {
      const status = {
        success: false,
        error: fallbackError,
        reason: getFileAccessFailureReason(error),
      } as const;
      console.warn(`[Shell] failed to ${operation} because the path is not accessible:`, normalizedPath, error);
      return status;
    }
  };

  // Shell handlers - 打开文件/文件夹
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      const result = await shell.openPath(normalizedPath);
      if (result) {
        return await getFailedShellPathStatus('open local path', normalizedPath, result);
      }
      return { success: true };
    } catch (error) {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      return await getFailedShellPathStatus(
        'open local path',
        normalizedPath,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      try {
        await fs.promises.stat(normalizedPath);
      } catch (error) {
        console.warn('[Shell] failed to reveal local path because the path is not accessible:', normalizedPath, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          reason: getFileAccessFailureReason(error),
        };
      }
      shell.showItemInFolder(normalizedPath);
      return { success: true };
    } catch (error) {
      console.warn('[Shell] failed to reveal local path because the system request failed:', filePath, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        reason: ShellOpenFailureReason.Unknown,
      };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openHtmlInBrowser', async (_event, htmlContent: string) => {
    try {
      const tmpDir = path.join(os.tmpdir(), 'lobsterai-preview');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `preview-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, htmlContent, 'utf-8');
      await shell.openPath(tmpFile);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:getAppsForFile', async (_event, filePath: string) => {
    try {
      const { getAppsForFile } = await import('./shellApps');
      const apps = await getAppsForFile(filePath);
      return { success: true, apps };
    } catch (error) {
      return {
        success: false,
        apps: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('shell:openPathWithApp', async (_event, filePath: string, appPath: string) => {
    const normalizedPath = normalizeWindowsShellPath(filePath);
    try {
      const { openFileWithApp } = await import('./shellApps');
      await openFileWithApp(normalizedPath, appPath);
      return { success: true };
    } catch (error) {
      return await getFailedShellPathStatus(
        'open local path with selected app',
        normalizedPath,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  });

  ipcMain.handle(ClipboardIpc.WriteImageFromFile, async (_event, filePath: string) => {
    try {
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to read image file' };
      }
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ClipboardIpc.WriteImageFromDataUrl, async (_event, dataUrl: string) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to read image data' };
      }
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  registerAsrIpcHandlers({
    getAuthTokens,
    fetchWithAuth,
    getServerApiBaseUrl,
  });

  // ---- artifact file watching ----
  const fileWatchers = new Map<
    string,
    { watcher: fs.FSWatcher; debounceTimer: ReturnType<typeof setTimeout> | null }
  >();

  ipcMain.handle('artifact:watchFile', (_event, filePath: string) => {
    if (fileWatchers.has(filePath)) return;
    try {
      const watcher = fs.watch(filePath, eventType => {
        if (eventType !== 'change') return;
        const entry = fileWatchers.get(filePath);
        if (!entry) return;
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          const windows = BrowserWindow.getAllWindows();
          windows.forEach(win => {
            if (!win.isDestroyed()) {
              try {
                win.webContents.send('artifact:file:changed', { filePath });
              } catch {
                /* */
              }
            }
          });
        }, 300);
      });
      watcher.on('error', () => {
        fileWatchers.delete(filePath);
        watcher.close();
      });
      fileWatchers.set(filePath, { watcher, debounceTimer: null });
    } catch {
      /* file can't be watched */
    }
  });

  ipcMain.handle('artifact:unwatchFile', (_event, filePath: string) => {
    const entry = fileWatchers.get(filePath);
    if (entry) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.watcher.close();
      fileWatchers.delete(filePath);
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.CreateSession, async (_event, filePath: string) => {
    try {
      const result = await createPreviewSession(filePath);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.CreateOfficeSession, async (_event, filePath: string) => {
    try {
      const result = await createOfficePreviewSession(filePath);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.DestroySession, async (_event, sessionId: string) => {
    destroyPreviewSession(sessionId);
    return { success: true };
  });

  ipcMain.handle(ArtifactPreviewIpc.ClearBrowserCookies, async () => {
    try {
      await session.fromPartition(ArtifactBrowserPartition.Default).clearStorageData({
        storages: ['cookies'],
      });
      return { success: true };
    } catch (error) {
      console.error('[ArtifactBrowser] failed to clear browser cookies:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.ClearBrowserCache, async () => {
    try {
      await session.fromPartition(ArtifactBrowserPartition.Default).clearCache();
      return { success: true };
    } catch (error) {
      console.error('[ArtifactBrowser] failed to clear browser cache:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(
    LocalWebServicesIpc.List,
    async (_event, options?: ListLocalWebServicesOptions) => {
      const preferredPorts = sanitizeLocalWebServicePorts(options?.preferredPorts);
      const ports = Array.from(new Set([...preferredPorts, ...LOCAL_WEB_SERVICE_PORTS])).sort(
        (a, b) => a - b,
      );
      const results = await Promise.all(ports.map(port => probeLocalWebService(port)));
      return results.filter((service): service is LocalWebService => service !== null);
    },
  );

  ipcMain.handle(AppUpdateIpc.GetState, async () => {
    return getAppUpdateCoordinator().getState();
  });

  ipcMain.handle(AppUpdateIpc.CheckNow, async (_event, options?: { manual?: boolean }) => {
    return getAppUpdateCoordinator().checkNow(options);
  });

  ipcMain.handle(AppUpdateIpc.RetryDownload, async () => {
    const state = await getAppUpdateCoordinator().retryDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.CancelDownload, async () => {
    const state = getAppUpdateCoordinator().cancelDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.InstallReady, async () => {
    return getAppUpdateCoordinator().installReadyUpdate();
  });

  // Helper: detect if a URL belongs to GitHub Copilot and apply token refresh on 401.
  const isCopilotUrl = (url: string) => url.includes('githubcopilot.com');
  const retryCopilotWithRefreshedToken = async (opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ headers: Record<string, string>; retried: boolean }> => {
    try {
      const state = await refreshCopilotTokenNow();
      const refreshedHeaders = { ...opts.headers, Authorization: `Bearer ${state.copilotToken}` };
      console.log('[CopilotRetry] token refreshed, retrying request');
      return { headers: refreshedHeaders, retried: true };
    } catch (err) {
      console.warn('[CopilotRetry] token refresh failed, not retrying:', err);
      return { headers: opts.headers, retried: false };
    }
  };

  // API 代理处理程序 - 解决 CORS 问题
  ipcMain.handle(
    'api:fetch',
    async (
      _event,
      options: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
      },
    ) => {
      console.log(
        `[api:fetch] ${options.method} ${options.url}, headers: ${serializeForLog(options.headers)}, body: ${options.body}`,
      );

      const doFetch = async (headers: Record<string, string>) => {
        const response = await session.defaultSession.fetch(options.url, {
          method: options.method,
          headers,
          body: options.body,
        });

        const contentType = response.headers.get('content-type') || '';
        let data: string | object;

        if (contentType.includes('text/event-stream')) {
          data = await response.text();
        } else if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data,
        };
      };

      try {
        let result = await doFetch(options.headers);
        console.log(
          `[api:fetch] ${options.method} ${options.url} -> ${result.status} ${result.statusText}`,
          typeof result.data === 'object' ? JSON.stringify(result.data) : result.data,
        );

        // Auto-retry once for Copilot 401/403
        if (
          !result.ok &&
          (result.status === 401 || result.status === 403) &&
          isCopilotUrl(options.url)
        ) {
          console.log('[api:fetch] Copilot auth error, attempting token refresh and retry');
          const { headers: refreshedHeaders, retried } =
            await retryCopilotWithRefreshedToken(options);
          if (retried) {
            result = await doFetch(refreshedHeaders);
            console.log(`[api:fetch] retry -> ${result.status} ${result.statusText}`);
          }
        }

        return result;
      } catch (error) {
        console.error(
          `[api:fetch] ${options.method} ${options.url} -> ERROR:`,
          error instanceof Error ? error.message : error,
        );
        return {
          ok: false,
          status: 0,
          statusText: error instanceof Error ? error.message : 'Network error',
          headers: {},
          data: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // SSE 流式 API 代理
  ipcMain.handle(
    'api:stream',
    async (
      event,
      options: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
        requestId: string;
      },
    ) => {
      const controller = new AbortController();

      // 存储 controller 以便后续取消
      activeStreamControllers.set(options.requestId, controller);

      try {
        let response = await session.defaultSession.fetch(options.url, {
          method: options.method,
          headers: options.headers,
          body: options.body,
          signal: controller.signal,
        });

        // Auto-retry once for Copilot 401/403
        if (
          !response.ok &&
          (response.status === 401 || response.status === 403) &&
          isCopilotUrl(options.url)
        ) {
          console.log('[api:stream] Copilot auth error, attempting token refresh and retry');
          const { headers: refreshedHeaders, retried } =
            await retryCopilotWithRefreshedToken(options);
          if (retried) {
            response = await session.defaultSession.fetch(options.url, {
              method: options.method,
              headers: refreshedHeaders,
              body: options.body,
              signal: controller.signal,
            });
            console.log(`[api:stream] retry -> ${response.status} ${response.statusText}`);
          }
        }

        if (!response.ok) {
          const errorData = await response.text();
          activeStreamControllers.delete(options.requestId);
          return {
            ok: false,
            status: response.status,
            statusText: response.statusText,
            error: errorData,
          };
        }

        if (!response.body) {
          activeStreamControllers.delete(options.requestId);
          return {
            ok: false,
            status: response.status,
            statusText: 'No response body',
          };
        }

        // 读取流式响应并通过 IPC 发送
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const readStream = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                event.sender.send(`api:stream:${options.requestId}:done`);
                break;
              }
              const chunk = decoder.decode(value);
              event.sender.send(`api:stream:${options.requestId}:data`, chunk);
            }
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              event.sender.send(`api:stream:${options.requestId}:abort`);
            } else {
              event.sender.send(
                `api:stream:${options.requestId}:error`,
                error instanceof Error ? error.message : 'Stream error',
              );
            }
          } finally {
            activeStreamControllers.delete(options.requestId);
          }
        };

        // 异步读取流，立即返回成功状态
        readStream();

        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
        };
      } catch (error) {
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: 0,
          statusText: error instanceof Error ? error.message : 'Network error',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // 取消流式请求
  ipcMain.handle('api:stream:cancel', (_event, requestId: string) => {
    const controller = activeStreamControllers.get(requestId);
    if (controller) {
      controller.abort();
      activeStreamControllers.delete(requestId);
      return true;
    }
    return false;
  });

  // ─── end OAuth ───

  // 企微 SDK 授权弹窗白名单域名
  const WECOM_AUTH_HOSTNAMES = new Set([
    'work.weixin.qq.com',
    'open.work.weixin.qq.com',
    'wwcdn.weixin.qq.com',
  ]);

  const isWecomAuthUrl = (url: string): boolean => {
    try {
      const hostname = new URL(url).hostname;
      return WECOM_AUTH_HOSTNAMES.has(hostname);
    } catch {
      return false;
    }
  };

  const isArtifactSandboxUrl = (url: string): boolean => {
    try {
      const pathname = new URL(url).pathname;
      return (
        pathname.endsWith('/artifact-react-sandbox.html') ||
        pathname.includes('/vendor/react.production.min.js') ||
        pathname.includes('/vendor/react-dom.production.min.js') ||
        pathname.includes('/vendor/babel.min.js')
      );
    } catch {
      return false;
    }
  };

  // 设置 Content Security Policy
  const sanitizeResponseHeaders = (
    headers: Record<string, string[]> | undefined
  ): Record<string, string[]> => {
    if (!headers) return {};
    const result: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(headers)) {
      const safe = values.filter(v => {
        for (let i = 0; i < v.length; i++) {
          if (v.charCodeAt(i) > 255) return false;
        }
        return true;
      });
      if (safe.length > 0) {
        result[key] = safe;
      }
    }
    return result;
  };

  const setContentSecurityPolicy = () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // 跳过企微授权页面，让其使用自身的 CSP（否则外部脚本被阻止导致空白页）
      if (isWecomAuthUrl(details.url)) {
        callback({ responseHeaders: sanitizeResponseHeaders(details.responseHeaders) });
        return;
      }

      // 跳过 artifact 沙箱及其 vendor 脚本的 CSP（iframe sandbox="allow-scripts" 隔离）
      if (isArtifactSandboxUrl(details.url)) {
        callback({ responseHeaders: sanitizeResponseHeaders(details.responseHeaders) });
        return;
      }

      // 跳过 HTML 预览服务器的 CSP（本地 HTTP Server 提供文件类 HTML 预览）
      if (isPreviewServerUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      const devPort = process.env.ELECTRON_START_URL?.match(/:(\d+)/)?.[1] || '5175';
      const cspDirectives = [
        "default-src 'self'",
        isDev
          ? `script-src 'self' 'unsafe-inline' http://localhost:${devPort} ws://localhost:${devPort}`
          : "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https:",
        `img-src 'self' data: https: http: ${ArtifactPreviewProtocol.LocalFile}:`,
        // 允许连接到所有域名，不做限制
        'connect-src *',
        "font-src 'self' data: https:",
        `media-src 'self' data: blob: file: https: http: ${ArtifactPreviewProtocol.LocalFile}:`,
        "worker-src 'self' blob:",
        "frame-src 'self' file: http://127.0.0.1:*",
      ];

      callback({
        responseHeaders: {
          ...sanitizeResponseHeaders(details.responseHeaders),
          'Content-Security-Policy': cspDirectives.join('; '),
        },
      });
    });
  };

  // 创建主窗口
  const createWindow = () => {
    // 如果窗口已经存在，就不再创建新窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
      return;
    }

    const initialWindowState = resolveInitialAppWindowState(
      getStore().get(AppWindowStoreKey.State),
      windowStatePersist.getDisplayWorkAreas(),
    );
    const { isMaximized: shouldRestoreMaximized, ...initialWindowBounds } = initialWindowState;

    mainWindow = new BrowserWindow({
      ...initialWindowBounds,
      title: APP_NAME,
      icon: getAppIconPath(),
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 12, y: 20 },
          }
        : isWindows
          ? {
              frame: false,
              titleBarStyle: 'hidden' as const,
            }
          : {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: getTitleBarOverlayOptions(),
            }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: PRELOAD_PATH,
        backgroundThrottling: false,
        devTools: isDev,
        spellcheck: false,
        webviewTag: true,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false,
      },
      backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
      show: false,
      autoHideMenuBar: true,
      enableLargerThanScreen: false,
    });

    // 设置 macOS Dock 图标（开发模式下 Electron 默认图标不是应用 Logo）
    if (isMac && isDev) {
      const iconPath = path.join(__dirname, '../build/icons/png/512x512.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }

    // 禁用窗口菜单
    mainWindow.setMenu(null);

    // 处理 window.open 请求（企微 SDK 授权弹窗等）
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isWecomAuthUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 950,
            height: 640,
            title: '企业微信授权',
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.plugins = false;
      webPreferences.devTools = isDev;
      webPreferences.partition = ArtifactBrowserPartition.Default;
      delete webPreferences.preload;

      params.partition = ArtifactBrowserPartition.Default;
      params.allowpopups = 'false';

      const src = params.src ?? '';
      if (src.startsWith('javascript:')) {
        event.preventDefault();
      }
    });

    // 监听子窗口创建事件（企微授权弹窗安全限制）
    mainWindow.webContents.on('did-create-window', childWindow => {
      // 限制子窗口只能导航到企微域名，防止被劫持到其他站点
      childWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (!isWecomAuthUrl(navUrl)) {
          event.preventDefault();
        }
      });
    });

    // 设置窗口的最小尺寸
    mainWindow.setMinimumSize(MIN_APP_WINDOW_WIDTH, MIN_APP_WINDOW_HEIGHT);
    if (shouldRestoreMaximized) {
      mainWindow.maximize();
    }

    // 设置窗口加载超时
    const loadTimeout = setTimeout(() => {
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        console.log('Window load timed out, attempting to reload...');
        scheduleReload('load-timeout');
      }
    }, 30000);

    // 清除超时
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      windowStatePersist.emitState();
      if (openClawEngineManager && !mainWindow?.isDestroyed()) {
        mainWindow.webContents.send(
          'openclaw:engine:onProgress',
          openClawEngineManager.getStatus(),
        );
      }
    });

    // 处理窗口关闭
    mainWindow.on('close', (e) => {
      windowStatePersist.cleanup();
      windowStatePersist.persist();

      // In development, close should actually quit so `npm run electron:dev`
      // restarts from a clean process. In production we keep tray behavior.
      if (mainWindow && !isQuitting && !isDev) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    // 处理渲染进程崩溃或退出
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      authCallbackRouter.markRendererUnavailable();
      console.error('Window render process gone:', details);
      scheduleReload('webContents-crashed');
    });

    if (isDev) {
      // 开发环境
      const maxRetries = 3;
      let retryCount = 0;

      const tryLoadURL = () => {
        mainWindow?.loadURL(DEV_SERVER_URL).catch(err => {
          console.error('Failed to load URL:', err);
          retryCount++;

          if (retryCount < maxRetries) {
            console.log(`Retrying to load URL (${retryCount}/${maxRetries})...`);
            setTimeout(tryLoadURL, 3000);
          } else {
            console.error('Failed to load URL after maximum retries');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
            }
          }
        });
      };

      tryLoadURL();

      // 打开开发者工具
      mainWindow.webContents.openDevTools();
    } else {
      // 生产环境
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 添加错误处理
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error('Page failed to load:', errorCode, errorDescription);
        // 如果加载失败，尝试重新加载
        if (isDev) {
          setTimeout(() => {
            scheduleReload('did-fail-load');
          }, 3000);
        }
      },
    );
    mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      authCallbackRouter.handleNavigationStarted({ isMainFrame, isInPlace });
    });

    // 当窗口关闭时，清除引用
    mainWindow.on('closed', () => {
      windowStatePersist.cleanup();
      authCallbackRouter.markRendererUnavailable();
      mainWindow = null;
    });

    windowStatePersist.bindWindowEvents(initialWindowBounds, shouldRestoreMaximized);

    // 等待内容加载完成后再显示窗口
    mainWindow.once('ready-to-show', () => {
      // 开机自启时不显示窗口，仅显示托盘图标
      if (!isAutoLaunched()) {
        mainWindow?.show();
      }
      // Initialize main-process i18n from stored language before creating UI elements.
      const initLang = getStore().get<{ language?: string }>('app_config')?.language;
      setLanguage(initLang === 'en' ? 'en' : 'zh');
      // 窗口就绪后创建系统托盘
      createTray(() => mainWindow);

      // Start cron polling after the window is ready.
      (async () => {
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn(
            '[Main] CronJobService not available yet, will start polling when OpenClaw is ready:',
            err,
          );
        }

        // One-time migration: move tasks from legacy SQLite tables to OpenClaw gateway.
        migrateScheduledTasksToOpenclaw({
          db: getStore().getDatabase(),
          getKv: key => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          cronJobService: getCronJobService(),
        }).catch(err => {
          console.warn('[Main] Scheduled tasks migration failed:', err);
        });

        // One-time migration: copy legacy run history to OpenClaw cron/runs/ JSONL files.
        migrateScheduledTaskRunsToOpenclaw({
          db: getStore().getDatabase(),
          getKv: key => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          openclawStateDir: getOpenClawEngineManager().getStateDir(),
        }).catch(err => {
          console.warn('[Main] Scheduled task run history migration failed:', err);
        });
      })();
    });
  };

  let isCleanupFinished = false;
  let isCleanupInProgress = false;

  const runAppCleanup = async (): Promise<void> => {
    console.log('[Main] App is quitting, starting cleanup...');
    destroyTray();
    skillManager?.stopWatching();
    stopMediaPollTimer();
    pendingMediaTasks.clear();
    mediaTasksHandledByStatusPolling.clear();
    mediaStatusPollCounts.clear();

    // Stop Cowork sessions without blocking shutdown.
    if (coworkEngineRouter) {
      console.log('[Main] Stopping cowork sessions...');
      coworkEngineRouter.stopAllSessions();
    }

    await stopCoworkOpenAICompatProxy().catch(error => {
      console.error('Failed to stop OpenAI compatibility proxy:', error);
    });

    await stopHtmlPreviewServer().catch(error => {
      console.error('[HtmlPreviewServer] Failed to stop:', error);
    });

    stopOpenClawTokenProxy();

    // Stop skill services.
    const skillServices = getSkillServiceManager();
    await skillServices.stopAll();

    // Stop all IM gateways gracefully.
    if (imGatewayManager) {
      await imGatewayManager.stopAll().catch(err => {
        console.error('[IM Gateway] Error stopping gateways on quit:', err);
      });
    }

    if (openClawEngineManager) {
      await openClawEngineManager.stopGateway().catch(error => {
        console.error('[OpenClaw] Failed to stop gateway on quit:', error);
      });
    }

    // Stop the cron job polling
    try {
      getCronJobService().stopPolling();
    } catch {
      // CronJobService may not have been initialized — safe to ignore.
    }

    sqliteBackupManager?.stopPeriodicBackupLoop();

    // Close the SQLite database to flush the WAL and release the file lock.
    try {
      getStore().close();
    } catch {
      // Store may not have been initialized — safe to ignore.
    }
  };

  app.on('before-quit', e => {
    if (isCleanupFinished) return;

    e.preventDefault();
    if (isCleanupInProgress) {
      return;
    }

    isCleanupInProgress = true;
    isQuitting = true;

    void runAppCleanup()
      .catch(error => {
        console.error('[Main] Cleanup error:', error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  });

  const handleTerminationSignal = (signal: NodeJS.Signals) => {
    if (isCleanupFinished || isCleanupInProgress) {
      return;
    }
    console.log(`[Main] Received ${signal}, running cleanup before exit...`);
    isCleanupInProgress = true;
    isQuitting = true;
    void runAppCleanup()
      .catch(error => {
        console.error(`[Main] Cleanup error during ${signal}:`, error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  };

  process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));

  // 初始化应用
  const initApp = async () => {
    const profiler = new StartupProfiler();

    profiler.mark('app.whenReady');
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    profiler.measure('app.whenReady');
    console.log('[Main] initApp: app is ready');

    // Note: Calendar permission is checked on-demand when calendar operations are requested
    // We don't trigger permission dialogs at startup to avoid annoying users

    // Ensure default working directory exists
    const defaultProjectDir = path.join(os.homedir(), 'lobsterai', 'project');
    if (!fs.existsSync(defaultProjectDir)) {
      fs.mkdirSync(defaultProjectDir, { recursive: true });
      console.log('Created default project directory:', defaultProjectDir);
    }
    console.log('[Main] initApp: default project dir ensured');

    // 注册 localfile:// 自定义协议，用于安全加载本地媒体文件。
    protocol.handle(ArtifactPreviewProtocol.LocalFile, createLocalFileProtocolResponse);

    profiler.mark('initStore');
    console.log('[Main] initApp: starting initStore()');
    store = await initStore();
    profiler.measure('initStore');
    console.log('[Main] initApp: store initialized');
    initializeKeyfromAttribution(store);
    refreshEndpointsTestMode(store);
    sqliteBackupManager = new SqliteBackupManager(app.getPath('userData'));

    const startSqliteBackupLoop = async (): Promise<void> => {
      if (!sqliteBackupManager) return;
      await sqliteBackupManager.startPeriodicBackupLoop(() => getStore().getDatabase());
    };

    const stopSqliteBackupLoop = (): void => {
      sqliteBackupManager?.stopPeriodicBackupLoop();
    };

    if (getSqliteAutoBackupEnabledFromConfig(getStore().get<AppConfigSettings>('app_config'))) {
      await startSqliteBackupLoop().catch(error => {
        console.error('[SqliteBackup] Failed to start periodic backup loop:', error);
      });
    }

    // Defensive recovery: app may be force-closed during execution and leave
    // stale running flags in DB. Normalize them on startup.
    const resetCount = getCoworkStore().resetRunningSessions();
    console.log('[Main] initApp: resetRunningSessions done, count:', resetCount);
    if (resetCount > 0) {
      console.log(`[Main] Reset ${resetCount} stuck cowork session(s) from running -> idle`);
    }
    // Inject store getter into claudeSettings
    setStoreGetter(() => store);
    // Inject auth getters for lobsterai-server provider routing
    // The getter proactively triggers a background token refresh when the
    // accessToken is within 5 minutes of expiry, so that the SDK always
    // gets a fresh token without blocking.

    setAuthTokensGetter(() => {
      const tokens = getAuthTokens();
      if (!tokens) return null;
      // Check if accessToken is close to expiry and trigger background refresh
      try {
        const payload = JSON.parse(
          Buffer.from(tokens.accessToken.split('.')[1], 'base64').toString(),
        );
        const expiresAt = payload.exp * 1000;
        if (expiresAt - Date.now() < 5 * 60 * 1000) {
          void refreshOnce('proactive'); // fire-and-forget
        }
      } catch {
        /* unable to parse JWT, return token as-is */
      }
      return tokens;
    });
    setServerBaseUrlGetter(() => getServerApiBaseUrl());

    // Initialize Copilot token manager and restore token state if available
    initCopilotTokenManager(getStore);
    const storedGithubToken = getStore().get('github_copilot_github_token') as string | undefined;
    if (storedGithubToken) {
      import('./libs/githubCopilotAuth')
        .then(({ getCopilotToken }) =>
          getCopilotToken(storedGithubToken).then(({ token, expiresAt, baseUrl }) => {
            setCopilotTokenState({
              copilotToken: token,
              baseUrl,
              expiresAt,
              githubToken: storedGithubToken,
            });
            console.log('[Main] restored Copilot token state from stored GitHub token');
          }),
        )
        .catch(err => {
          console.warn('[Main] failed to restore Copilot token on startup:', err);
        });
    }

    registerProxyTokenRefresher('lobsterai-server', async () => {
      const tokens = getAuthTokens();
      if (!tokens?.refreshToken) return null;
      const serverBaseUrl = getServerApiBaseUrl();
      try {
        const refreshUrl = `${serverBaseUrl}/api/auth/refresh`;
        console.log(`[Auth] requesting proxy token refresh at ${refreshUrl}`);
        const resp = await net.fetch(refreshUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withKeyfromBody({ refreshToken: tokens.refreshToken })),
        });
        if (resp.ok) {
          const body = (await resp.json()) as {
            code: number;
            data: { accessToken: string; refreshToken?: string };
          };
          if (body.code === 0 && body.data) {
            saveAuthTokens(body.data.accessToken, body.data.refreshToken || tokens.refreshToken);
            console.log('[Auth] proxy token refresh succeeded');
            return body.data.accessToken;
          }
        }
      } catch (err) {
        console.warn('[Auth] proxy token refresh failed:', err);
      }
      return null;
    });

    registerProxyTokenRefresher('github-copilot', async () => {
      try {
        const { refreshCopilotTokenNow } = await import('./libs/copilotTokenManager');
        const refreshed = await refreshCopilotTokenNow();
        return refreshed.copilotToken;
      } catch (err) {
        console.warn('[Auth] Copilot proxy token refresh failed:', err);
        return null;
      }
    });

    // Start the lightweight token proxy before OpenClaw config sync so that
    // lobsterai-server provider can use the proxy URL in its config.
    profiler.mark('openClawTokenProxy');
    try {
      await startOpenClawTokenProxy({
        getAuthTokens,
        refreshToken: refreshOnce,
        getServerBaseUrl: getServerApiBaseUrl,
      });
      console.log('[Main] OpenClaw token proxy started');
    } catch (err) {
      console.warn('[Main] OpenClaw token proxy failed to start (non-fatal):', err);
    }
    profiler.measure('openClawTokenProxy');

    // Enterprise config sync — must run before openclawConfigSync
    profiler.mark('enterpriseConfigSync');
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = resolveEnterpriseConfigPath();
    if (enterpriseConfigPath) {
      try {
        const imStoreInstance = getIMGatewayManager().getIMStore();
        const mcpStoreInstance = getMcpRuntime().getStore();
        syncEnterpriseConfig(
          enterpriseConfigPath,
          store,
          imStoreInstance,
          server => {
            const existing = mcpStoreInstance.listServers().find(s => s.name === server.name);
            if (existing) {
              mcpStoreInstance.updateServer(existing.id, {
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            } else {
              mcpStoreInstance.createServer({
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            }
          },
          () => {
            // Clear all MCP servers (for overwrite mode)
            for (const s of mcpStoreInstance.listServers()) {
              mcpStoreInstance.deleteServer(s.id);
            }
          },
          config => {
            const cs = getCoworkStore();
            cs.setConfig(config);
          },
          () => {
            const cs = getCoworkStore();
            return cs.getConfig().workingDirectory;
          },
          agent => {
            const cs = getCoworkStore();
            const existing = cs.getAgent(agent.id);
            const updates = {
              name: agent.name,
              description: agent.description,
              systemPrompt: agent.systemPrompt,
              identity: agent.identity,
              model: agent.model,
              icon: agent.icon,
              skillIds: agent.skillIds,
              enabled: agent.enabled,
            };
            if (existing) {
              cs.updateAgent(agent.id, updates);
            } else {
              cs.createAgent({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                systemPrompt: agent.systemPrompt,
                identity: agent.identity,
                model: agent.model,
                icon: agent.icon,
                skillIds: agent.skillIds,
                source: 'custom',
              });
              cs.updateAgent(agent.id, { enabled: agent.enabled });
            }
          },
        );
      } catch (error) {
        console.error('[Enterprise] config sync failed:', error);
      }
    } else {
      // No enterprise config package found — clear any previously stored config
      // so the app exits enterprise mode after the package is removed.
      const hadEnterprise = store.get('enterprise_config');
      if (hadEnterprise) {
        store.delete('enterprise_config');
        // Reset executionMode to default so sandbox mode reverts to "off".
        const cs = getCoworkStore();
        cs.setConfig({ executionMode: 'local' });
        console.log(
          '[Enterprise] config package removed, cleared enterprise mode and reset executionMode',
        );
      }
    }
    profiler.measure('enterpriseConfigSync');

    bindCoworkRuntimeForwarder();
    bindOpenClawStatusForwarder();

    // Start proxy BEFORE config sync so proxy-dependent providers (e.g. copilot)
    // get the correct baseURL on the first write, avoiding a mid-startup config
    // overwrite that triggers unnecessary gateway hot-reload.
    profiler.mark('applyProxyPreference');
    const appConfig = getStore().get<AppConfigSettings>('app_config');
    await applyProxyPreference(getUseSystemProxyFromConfig(appConfig));
    profiler.measure('applyProxyPreference');

    profiler.mark('coworkOpenAICompatProxy');
    await startCoworkOpenAICompatProxy().catch(error => {
      console.error('Failed to start OpenAI compatibility proxy:', error);
    });
    profiler.measure('coworkOpenAICompatProxy');

    // ── Pre-warm quota & model caches so provider resolution and config sync
    // see real server data instead of empty defaults ──
    if (getAuthTokens()) {
      profiler.mark('startupCacheWarmup');
      const warmupResult = await runStartupCacheWarmup({
        serverBaseUrl: getServerApiBaseUrl(),
        fetchWithAuth,
        appendKeyfromQuery,
        cachedSubscriptionStatus,
        t,
      });
      cachedSubscriptionStatus = warmupResult.subscriptionStatus;
      cachedMediaGenerationEntitled = warmupResult.mediaGenerationEntitled;
      profiler.measure('startupCacheWarmup');
    }

    // Agent model migration — runs after cache warmup so resolveMatchedProvider
    // can match lobsterai-server models without falling back.
    const defaultAgentModelRef = resolveDefaultAgentModelRef();
    const backfilledAgentModels = getCoworkStore().backfillEmptyAgentModels(defaultAgentModelRef);
    const qualifiedAgentModels = migrateAgentModelRefs({
      defaultModelRef: defaultAgentModelRef,
      availableProviders: buildAvailableOpenClawProviders(),
      agents: getAgentManager().listAgents(),
      updateAgent: (id, patch) => getCoworkStore().updateAgent(id, patch),
    });
    if (backfilledAgentModels > 0 || qualifiedAgentModels > 0) {
      console.log(
        `[Main] migrated agent model bindings: backfilled=${backfilledAgentModels}, qualified=${qualifiedAgentModels}`,
      );
    }

    // One-time migration: move main agent workspace files from the user's
    // working directory to the fixed {STATE_DIR}/workspace-main/ path.
    try {
      const engineManager = getOpenClawEngineManager();
      migrateMainAgentWorkspace(
        engineManager.getStateDir(),
        getCoworkStore().getConfig().workingDirectory,
        getStore(),
      );
    } catch (err) {
      console.warn('[OpenClaw] main agent workspace migration failed (non-fatal):', err);
    }

    profiler.mark('syncOpenClawConfig');
    const startupSync = await syncOpenClawConfig({
      reason: 'startup',
      restartGatewayIfRunning: false,
    });
    if (!startupSync.success) {
      console.error('[OpenClaw] Startup config sync failed:', startupSync.error);
    }
    profiler.measure('syncOpenClawConfig');
    void ensureOpenClawRunningForCowork()
      .then(() => {
        // Start cron polling once the gateway is confirmed running.
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] CronJobService not available after OpenClaw startup:', err);
        }
      })
      .catch(error => {
        console.error('[OpenClaw] Failed to auto-start gateway on app startup:', error);
      });

    // ── Step 1: Show window ASAP ──────────────────────────────────────
    // CSP + createWindow moved before skill initialisation so the user
    // sees the loading UI within ~1-2 s instead of waiting for the full
    // skill bootstrap (~6-8 s previously).
    setContentSecurityPolicy();

    profiler.mark('createWindow');
    console.log('[Main] initApp: creating window');
    createWindow();
    profiler.measure('createWindow');
    console.log('[Main] initApp: window created');

    // ── Step 2-4: Skill bootstrap (non-blocking) ────────────────────
    console.log('[Main] initApp: starting skill bootstrap');
    profiler.mark('skillManager');
    const manager = getSkillManager();
    console.log('[Main] initApp: getSkillManager done');

    // When skills change (install/enable/disable/delete), re-sync AGENTS.md
    // so OpenClaw's IM channel agents pick up the latest skill list.
    manager.onSkillsChanged(() => {
      syncOpenClawConfig({ reason: 'skills-changed' }).catch(error => {
        console.warn('[Main] Failed to sync OpenClaw config after skills change:', error);
      });
    });

    // Parallelise independent skill sub-tasks (Step 4).
    await Promise.all([
      // Group A: file-system skill operations (sync, must run in order)
      (async () => {
        profiler.mark('syncBundledSkills');
        try {
          manager.syncBundledSkillsToUserData();
          console.log('[Main] initApp: syncBundledSkillsToUserData done');
        } catch (error) {
          console.error('[Main] initApp: syncBundledSkillsToUserData failed:', error);
        }
        profiler.measure('syncBundledSkills');

        try {
          manager.recoverInterruptedUpgrades();
          console.log('[Main] initApp: recoverInterruptedUpgrades done');
        } catch (error) {
          console.error('[Main] initApp: recoverInterruptedUpgrades failed:', error);
        }

        try {
          manager.startWatching();
          console.log('[Main] initApp: startWatching done');
        } catch (error) {
          console.error('[Main] initApp: startWatching failed:', error);
        }
      })(),

      // Group B: python runtime (independent, async)
      (async () => {
        profiler.mark('pythonRuntime');
        try {
          const runtimeResult = await ensurePythonRuntimeReady();
          if (!runtimeResult.success) {
            console.error('[Main] initApp: ensurePythonRuntimeReady failed:', runtimeResult.error);
          } else {
            console.log('[Main] initApp: ensurePythonRuntimeReady done');
          }
        } catch (error) {
          console.error('[Main] initApp: ensurePythonRuntimeReady threw:', error);
        }
        profiler.measure('pythonRuntime');
      })(),
    ]);

    // Skill services (web-search bridge) — fire-and-forget (Step 2).
    // No IPC handler or downstream init depends on this completing.
    try {
      const skillServices = getSkillServiceManager();
      console.log('[Main] initApp: getSkillServiceManager done');
      const t0 = performance.now();
      void skillServices
        .startAll()
        .then(() => {
          console.log(
            `[Main] initApp: skill services started (background, ${(performance.now() - t0).toFixed(0)}ms)`,
          );
        })
        .catch(error => {
          console.error('[Main] initApp: skill services failed:', error);
        });
    } catch (error) {
      console.error('[Main] initApp: skill services init failed:', error);
    }
    profiler.measure('skillManager');

    console.log(profiler.summary());

    // Windows/Linux cold start: parse deep link from process.argv.
    // The router buffers it because the renderer is not ready yet after createWindow().
    const coldStartDeepLink = process.argv.find(arg => arg.startsWith('lobsterai://'));
    if (coldStartDeepLink) {
      handleDeepLink(coldStartDeepLink);
    }

    // Auto-reconnect IM bots that were enabled before restart
    getIMGatewayManager()
      .startAllEnabled()
      .catch(error => {
        console.error('[IM] Failed to auto-start enabled gateways:', error);
      });

    // Reconnect OpenClaw gateway WS after system wake from sleep/suspend
    powerMonitor.on('resume', () => {
      if (openClawRuntimeAdapter) {
        openClawRuntimeAdapter.onSystemResume();
      }
    });

    // 首次启动时默认开启开机自启动（先写标记再设置，避免崩溃后重复设置）
    if (!getStore().get('auto_launch_initialized')) {
      getStore().set('auto_launch_initialized', true);
      getStore().set('auto_launch_enabled', true);
      setAutoLaunchEnabled(true);
    }

    // Restore prevent-sleep setting
    const preventSleepEnabled = getStore().get<boolean>('prevent_sleep_enabled');
    if (preventSleepEnabled) {
      try {
        setPreventSleepBlockerEnabled(true);
      } catch (err) {
        console.error('[Main] Failed to start prevent-sleep blocker:', err);
      }
    }

    let lastLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
    let lastUseSystemProxy = getUseSystemProxyFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    let lastSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    getStore().onDidChange<AppConfigSettings>('app_config', (newConfig, oldConfig) => {
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = newConfig?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        setLanguage(currentLanguage === 'en' ? 'en' : 'zh');
        updateTrayMenu(() => mainWindow);
      }

      const previousUseSystemProxy = oldConfig
        ? getUseSystemProxyFromConfig(oldConfig)
        : lastUseSystemProxy;
      const currentUseSystemProxy = getUseSystemProxyFromConfig(newConfig);
      if (currentUseSystemProxy !== previousUseSystemProxy) {
        console.log(
          `${gwDiagTs()} proxy setting changed: ${previousUseSystemProxy} -> ${currentUseSystemProxy}, will restart gateway if running`,
        );
        void applyProxyPreference(currentUseSystemProxy).then(() => {
          if (getOpenClawEngineManager().getStatus().phase === 'running') {
            void syncOpenClawConfig({
              reason: 'system-proxy-changed',
              restartGatewayIfRunning: true,
            }).then((result) => {
              if (!result.success) {
                console.error('[OpenClaw] Failed to sync config after system proxy change:', result.error);
              }
            });
          }
        });
      }
      lastUseSystemProxy = currentUseSystemProxy;

      const previousSqliteAutoBackupEnabled = oldConfig
        ? getSqliteAutoBackupEnabledFromConfig(oldConfig)
        : lastSqliteAutoBackupEnabled;
      const currentSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(newConfig);
      if (currentSqliteAutoBackupEnabled !== previousSqliteAutoBackupEnabled) {
        if (currentSqliteAutoBackupEnabled) {
          void startSqliteBackupLoop().catch(error => {
            console.error('[SqliteBackup] Failed to enable periodic backup loop:', error);
          });
        } else {
          stopSqliteBackupLoop();
        }
      }
      lastSqliteAutoBackupEnabled = currentSqliteAutoBackupEnabled;
    });

    // 在 macOS 上，当点击 dock 图标时显示已有窗口或重新创建
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (!mainWindow.isFocused()) mainWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  };

  // 启动应用
  initApp().catch(console.error);

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
