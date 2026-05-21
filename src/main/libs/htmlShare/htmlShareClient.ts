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
  status?: HtmlShareStatus;
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
    status?: HtmlShareStatus;
  };
}

export function buildHtmlSharePublicUrl(publicBaseUrl: string, shareId: string): string {
  const normalizedBaseUrl = publicBaseUrl.trim().replace(/\/+$/, '');
  return `${normalizedBaseUrl}/${encodeURIComponent(shareId)}/`;
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
  form.set('accessMode', input.accessMode);
  if (input.sessionId) form.set('sessionId', input.sessionId);
  if (input.artifactId) form.set('artifactId', input.artifactId);
  form.set('title', input.title);
  form.set('entryFile', input.entryFile);
  form.set('sourceSha256', input.sourceSha256);
  form.set('archive', new Blob([buffer], { type: 'application/zip' }), 'share.zip');

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

  const shareUrl = payload?.data?.shareId
    ? buildHtmlSharePublicUrl(publicBaseUrl, payload.data.shareId)
    : payload?.data?.url;

  if (!response.ok || payload?.code !== 0 || !shareUrl) {
    console.debug(
      `[HtmlShare] upload failed with HTTP ${response.status}, API code ${payload?.code ?? 'missing'}, and share URL ${shareUrl ? 'present' : 'missing'}`,
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
  return {
    success: true,
    shareId: payload.data.shareId,
    url: shareUrl,
    accessMode: payload.data.accessMode,
    shareCode: payload.data.shareCode,
    status: payload.data.status,
  };
}
