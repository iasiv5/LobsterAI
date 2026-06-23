import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  HtmlShareAccessMode,
  HtmlShareSourceType,
} from '../../../shared/htmlShare/constants';
import {
  type ShareDeploymentCreateNodeInput,
  type ShareDeploymentProjectAnalysis,
  type ShareDeploymentRecord,
  type ShareDeploymentResult,
  ShareDeploymentStatus,
} from '../../../shared/shareDeployment/constants';
import { buildHtmlSharePublicUrl, getHtmlShareBySource } from '../htmlShare/htmlShareClient';

type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>;

interface ApiResponse<T> {
  code?: number;
  message?: string;
  data?: T;
}

interface ServerShareDeploymentResponse {
  deploymentId?: string;
  shareId?: string;
  url?: string;
  accessMode?: string;
  shareCode?: string;
  shareCodeUnavailable?: boolean;
  status?: string;
  deploymentStatus?: string;
  runtimeLanguage?: string;
  runtimeVersion?: string;
  packageManager?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  listenPort?: number;
  sourceSha256?: string;
  sourceArchiveBytes?: number;
  provider?: string;
  region?: string;
  providerResourceId?: string;
  runtimeUrlMasked?: string;
  expiresAt?: string;
  lastAccessedAt?: string;
  failureMessage?: string;
  createdAt?: string;
  updatedAt?: string;
  events?: ShareDeploymentRecord['events'];
}

export interface UploadNodeDeploymentInput extends ShareDeploymentCreateNodeInput {
  archivePath: string;
  sourceSha256: string;
  analysis: ShareDeploymentProjectAnalysis;
  archiveBytes: number;
  clientSourceKey: string;
}

export function buildNodeDeploymentClientSourceKey(input: {
  sessionId: string;
  localServiceUrl: string;
}): string {
  const normalizedUrl = (() => {
    try {
      const url = new URL(input.localServiceUrl.trim());
      url.hash = '';
      return url.toString().replace(/\/+$/, '/').toLowerCase();
    } catch {
      return input.localServiceUrl.trim().replace(/\/+$/, '/').toLowerCase();
    }
  })();
  return crypto
    .createHash('sha256')
    .update(`${HtmlShareSourceType.NodeServiceDeployment}:${input.sessionId}:${normalizedUrl}`)
    .digest('hex');
}

function normalizeDeploymentStatus(value?: string): ShareDeploymentStatus {
  switch (value) {
    case ShareDeploymentStatus.Deploying:
      return ShareDeploymentStatus.Deploying;
    case ShareDeploymentStatus.Live:
      return ShareDeploymentStatus.Live;
    case ShareDeploymentStatus.DeployFailed:
      return ShareDeploymentStatus.DeployFailed;
    case ShareDeploymentStatus.Expired:
      return ShareDeploymentStatus.Expired;
    case ShareDeploymentStatus.Stopped:
      return ShareDeploymentStatus.Stopped;
    case ShareDeploymentStatus.Queued:
    default:
      return ShareDeploymentStatus.Queued;
  }
}

function buildDeploymentRecord(
  data: ServerShareDeploymentResponse | undefined,
  publicBaseUrl: string,
): ShareDeploymentRecord | null {
  if (!data?.deploymentId) return null;
  const responseShareUrl = data.url?.trim();
  const url = responseShareUrl || (data.shareId ? buildHtmlSharePublicUrl(publicBaseUrl, data.shareId) : undefined);
  return {
    deploymentId: data.deploymentId,
    shareId: data.shareId,
    url,
    accessMode:
      data.accessMode === HtmlShareAccessMode.Public
        ? HtmlShareAccessMode.Public
        : HtmlShareAccessMode.Code,
    shareCode: data.shareCode,
    shareCodeUnavailable: data.shareCodeUnavailable,
    status: normalizeDeploymentStatus(data.deploymentStatus || data.status),
    runtimeLanguage: data.runtimeLanguage,
    runtimeVersion: data.runtimeVersion,
    packageManager: data.packageManager,
    installCommand: data.installCommand,
    startCommand: data.startCommand,
    targetPort: data.listenPort,
    sourceArchiveBytes: data.sourceArchiveBytes,
    sourceSha256: data.sourceSha256,
    provider: data.provider,
    providerRegion: data.region,
    providerFunctionId: data.providerResourceId,
    providerEndpoint: data.runtimeUrlMasked,
    expiresAt: data.expiresAt,
    lastAccessedAt: data.lastAccessedAt,
    errorMessage: data.failureMessage,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    events: data.events,
  };
}

function buildManifest(input: UploadNodeDeploymentInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runtimeLanguage: 'node',
    runtimeVersion: input.nodeVersion,
    packageManager: input.analysis.packageManager,
    installCommand: input.installCommand,
    startCommand: input.startCommand,
    listenPort: input.port,
    healthPath: '/',
    projectRootName: path.basename(input.analysis.projectDirectory),
    projectRootHash: crypto
      .createHash('sha256')
      .update(input.analysis.projectDirectory)
      .digest('hex')
      .slice(0, 16),
    includedFileCount: input.analysis.totalFiles,
    estimatedSourceArchiveBytes: input.archiveBytes,
    localServiceUrl: input.localServiceUrl,
    env: [],
  };
}

async function readArchiveBlob(archivePath: string): Promise<Blob> {
  const buffer = await fs.promises.readFile(archivePath);
  const archiveBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  return new Blob([archiveBuffer], { type: 'application/zip' });
}

export async function uploadNodeDeployment(
  serverBaseUrl: string,
  publicBaseUrl: string,
  fetchWithAuth: FetchWithAuth,
  input: UploadNodeDeploymentInput,
): Promise<ShareDeploymentResult> {
  const archiveBlob = await readArchiveBlob(input.archivePath);
  const form = new FormData();
  form.set('sessionId', input.sessionId);
  form.set('artifactId', input.artifactId);
  form.set('title', input.title);
  form.set('accessMode', input.accessMode ?? HtmlShareAccessMode.Code);
  form.set('clientSourceKey', input.clientSourceKey);
  form.set('sourceSha256', input.sourceSha256);
  form.set('manifest', JSON.stringify(buildManifest(input)));
  form.set('sourceArchive', archiveBlob, 'source.zip');

  const response = await fetchWithAuth(`${serverBaseUrl}/api/share-deployments/node`, {
    method: 'POST',
    body: form,
  });
  const payload = (await response.json().catch((): null => null)) as
    | ApiResponse<ServerShareDeploymentResponse>
    | null;
  const deployment = buildDeploymentRecord(payload?.data, publicBaseUrl);
  if (!response.ok || payload?.code !== 0 || !deployment) {
    return {
      success: false,
      error: payload?.message || `Deployment request failed: ${response.status}`,
      code: payload?.code,
      analysis: input.analysis,
    };
  }
  return {
    success: true,
    deployment,
    analysis: input.analysis,
    warnings: input.analysis.warnings,
  };
}

export async function getNodeDeployment(
  serverBaseUrl: string,
  publicBaseUrl: string,
  fetchWithAuth: FetchWithAuth,
  deploymentId: string,
): Promise<ShareDeploymentResult> {
  const response = await fetchWithAuth(
    `${serverBaseUrl}/api/share-deployments/${encodeURIComponent(deploymentId)}`,
  );
  const payload = (await response.json().catch((): null => null)) as
    | ApiResponse<ServerShareDeploymentResponse>
    | null;
  const deployment = buildDeploymentRecord(payload?.data, publicBaseUrl);
  if (!response.ok || payload?.code !== 0 || !deployment) {
    return {
      success: false,
      error: payload?.message || `Deployment lookup failed: ${response.status}`,
      code: payload?.code,
    };
  }
  return {
    success: true,
    deployment,
  };
}

export async function getNodeDeploymentByLocalService(
  serverBaseUrl: string,
  publicBaseUrl: string,
  fetchWithAuth: FetchWithAuth,
  input: { sessionId: string; localServiceUrl: string },
): Promise<ShareDeploymentResult> {
  const clientSourceKey = buildNodeDeploymentClientSourceKey(input);
  const lookup = await getHtmlShareBySource(
    serverBaseUrl,
    publicBaseUrl,
    fetchWithAuth,
    HtmlShareSourceType.NodeServiceDeployment,
    clientSourceKey,
  );
  if (!lookup.success) {
    return {
      success: false,
      error: lookup.error,
      code: lookup.code,
    };
  }
  if (!lookup.share?.shareId) {
    return {
      success: true,
      deployment: null,
    };
  }

  const response = await fetchWithAuth(
    `${serverBaseUrl}/api/html-shares/${encodeURIComponent(lookup.share.shareId)}/deployment`,
  );
  const payload = (await response.json().catch((): null => null)) as
    | ApiResponse<ServerShareDeploymentResponse>
    | null;
  const deployment = buildDeploymentRecord(payload?.data, publicBaseUrl);
  if (!response.ok || payload?.code !== 0 || !deployment) {
    return {
      success: false,
      error: payload?.message || `Deployment lookup failed: ${response.status}`,
      code: payload?.code,
    };
  }
  return {
    success: true,
    deployment: {
      ...deployment,
      url: deployment.url || lookup.share.url,
      accessMode: lookup.share.accessMode ?? deployment.accessMode,
      shareCode: lookup.share.shareCode ?? deployment.shareCode,
      shareCodeUnavailable:
        lookup.share.shareCodeUnavailable ?? deployment.shareCodeUnavailable,
    },
  };
}
