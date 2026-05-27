import fs from 'fs';

import {
  HtmlShareAccessMode,
  HtmlShareSourceType,
  type HtmlShareStatus,
} from '../../../shared/htmlShare/constants';

export interface CreateHtmlShareUploadInput {
  archivePath: string;
  sourceType: (typeof HtmlShareSourceType)[keyof typeof HtmlShareSourceType];
  accessMode: (typeof HtmlShareAccessMode)[keyof typeof HtmlShareAccessMode];
  clientSourceKey?: string;
  sessionId?: string;
  artifactId?: string;
  title: string;
  entryFile: string;
  sourceSha256: string;
}

export interface HtmlShareCreateResult {
  success: boolean;
  shareId?: string;
  url?: string;
  accessMode?: (typeof HtmlShareAccessMode)[keyof typeof HtmlShareAccessMode];
  shareCode?: string;
  shareCodeUnavailable?: boolean;
  status?: HtmlShareStatus;
  updatedAt?: string;
  contentUpdatedAt?: string;
  error?: string;
  code?: number;
}

export interface HtmlShareLookupResult {
  success: boolean;
  share?: HtmlShareCreateResult | null;
  error?: string;
  code?: number;
}

type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>;

interface HtmlShareApiResponse {
  code: number;
  message?: string;
  data?: {
    shareId?: string;
    url?: string;
    accessMode?: (typeof HtmlShareAccessMode)[keyof typeof HtmlShareAccessMode];
    shareCode?: string;
    shareCodeUnavailable?: boolean;
    status?: HtmlShareStatus;
    updatedAt?: string;
    contentUpdatedAt?: string;
  };
}

export function buildHtmlSharePublicUrl(publicBaseUrl: string, shareId: string): string {
  const normalizedBaseUrl = publicBaseUrl.trim().replace(/\/+$/, '');
  return `${normalizedBaseUrl}/${encodeURIComponent(shareId)}/`;
}

function appendHtmlShareFormData(form: FormData, input: CreateHtmlShareUploadInput, buffer: Buffer): void {
  const archiveBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  form.set('accessMode', input.accessMode);
  if (input.clientSourceKey) form.set('clientSourceKey', input.clientSourceKey);
  if (input.sessionId) form.set('sessionId', input.sessionId);
  if (input.artifactId) form.set('artifactId', input.artifactId);
  form.set('title', input.title);
  form.set('entryFile', input.entryFile);
  form.set('sourceSha256', input.sourceSha256);
  form.set('archive', new Blob([archiveBuffer], { type: 'application/zip' }), 'share.zip');
}

function buildHtmlShareResult(
  payload: HtmlShareApiResponse,
  publicBaseUrl: string,
): HtmlShareCreateResult | null {
  if (!payload.data) return null;
  const responseShareUrl = payload.data.url?.trim();
  const shareUrl =
    responseShareUrl ||
    (payload.data.shareId ? buildHtmlSharePublicUrl(publicBaseUrl, payload.data.shareId) : undefined);
  if (!shareUrl) return null;
  return {
    success: true,
    shareId: payload.data.shareId,
    url: shareUrl,
    accessMode: payload.data.accessMode,
    shareCode: payload.data.shareCode,
    shareCodeUnavailable: payload.data.shareCodeUnavailable,
    status: payload.data.status,
    updatedAt: payload.data.updatedAt,
    contentUpdatedAt: payload.data.contentUpdatedAt,
  };
}

export async function uploadHtmlShare(
  serverBaseUrl: string,
  publicBaseUrl: string,
  fetchWithAuth: FetchWithAuth,
  input: CreateHtmlShareUploadInput,
): Promise<HtmlShareCreateResult> {
  const buffer = await fs.promises.readFile(input.archivePath);
  console.debug(
    `[HtmlShare] prepared ${buffer.length} bytes for ${input.sourceType} upload to ${serverBaseUrl}`,
  );
  console.debug(
    `[HtmlShare] upload request uses ${input.accessMode} access, entry ${input.entryFile}, and hash ${input.sourceSha256}`,
  );
  const form = new FormData();
  form.set('sourceType', input.sourceType);
  appendHtmlShareFormData(form, input, buffer);

  const response = await fetchWithAuth(`${serverBaseUrl}/api/html-shares`, {
    method: 'POST',
    body: form,
  });
  console.debug(
    `[HtmlShare] upload response returned HTTP ${response.status} with content type ${response.headers.get('content-type') || 'unknown'}`,
  );

  let payload: HtmlShareApiResponse | null = null;
  try {
    payload = (await response.json()) as HtmlShareApiResponse;
  } catch {
    console.debug('[HtmlShare] upload response did not contain JSON');
    // Non-JSON errors are handled below.
  }
  console.debug(
    `[HtmlShare] upload response API code was ${payload?.code ?? 'missing'} and message was ${payload?.message || 'empty'}`,
  );

  const result = payload ? buildHtmlShareResult(payload, publicBaseUrl) : null;

  if (!response.ok || payload?.code !== 0 || !result) {
    console.debug(
      `[HtmlShare] upload failed with HTTP ${response.status}, API code ${payload?.code ?? 'missing'}, and share URL ${result?.url ? 'present' : 'missing'}`,
    );
    return {
      success: false,
      error: payload?.message || `Share upload failed: ${response.status}`,
      code: payload?.code,
    };
  }

  console.debug(
    `[HtmlShare] upload succeeded with share ${payload.data.shareId || 'missing'} and status ${payload.data.status || 'missing'}`,
  );
  return result;
}

export async function updateHtmlShare(
  serverBaseUrl: string,
  publicBaseUrl: string,
  fetchWithAuth: FetchWithAuth,
  shareId: string,
  input: CreateHtmlShareUploadInput,
): Promise<HtmlShareCreateResult> {
  const buffer = await fs.promises.readFile(input.archivePath);
  const form = new FormData();
  appendHtmlShareFormData(form, input, buffer);

  const response = await fetchWithAuth(`${serverBaseUrl}/api/html-shares/${encodeURIComponent(shareId)}`, {
    method: 'PUT',
    body: form,
  });
  const payload = (await response.json().catch((): null => null)) as HtmlShareApiResponse | null;
  const result = payload ? buildHtmlShareResult(payload, publicBaseUrl) : null;
  if (!response.ok || payload?.code !== 0 || !result) {
    return {
      success: false,
      error: payload?.message || `Share update failed: ${response.status}`,
      code: payload?.code,
    };
  }
  return result;
}

export async function getHtmlShareBySource(
  serverBaseUrl: string,
  publicBaseUrl: string,
  fetchWithAuth: FetchWithAuth,
  sourceType: (typeof HtmlShareSourceType)[keyof typeof HtmlShareSourceType],
  clientSourceKey: string,
): Promise<HtmlShareLookupResult> {
  const params = new URLSearchParams({
    sourceType,
    clientSourceKey,
  });
  const response = await fetchWithAuth(`${serverBaseUrl}/api/html-shares/source?${params.toString()}`);
  const payload = (await response.json().catch((): null => null)) as HtmlShareApiResponse | null;
  if (!response.ok || payload?.code !== 0) {
    return {
      success: false,
      error: payload?.message || `Share lookup failed: ${response.status}`,
      code: payload?.code,
    };
  }
  return {
    success: true,
    share: payload ? buildHtmlShareResult(payload, publicBaseUrl) : null,
  };
}
