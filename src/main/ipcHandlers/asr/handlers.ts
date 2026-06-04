import { ipcMain } from 'electron';

import {
  AsrApiCode,
  AsrIpcChannel,
  type AsrRecognizeData,
  type AsrRecognizeRequest,
  type AsrRecognizeResult,
} from '../../../shared/asr/constants';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export interface AsrHandlerDeps {
  getAuthTokens: () => AuthTokens | null;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  getServerApiBaseUrl: () => string;
}

export function registerAsrIpcHandlers({
  getAuthTokens,
  fetchWithAuth,
  getServerApiBaseUrl,
}: AsrHandlerDeps): void {
  ipcMain.handle(
    AsrIpcChannel.Recognize,
    async (_event, options?: AsrRecognizeRequest): Promise<AsrRecognizeResult> => {
      try {
        const tokens = getAuthTokens();
        if (!tokens) {
          return { success: false, code: AsrApiCode.Unauthorized, error: 'Unauthorized' };
        }
        const audioBase64 = typeof options?.audioBase64 === 'string' ? options.audioBase64.trim() : '';
        if (!audioBase64) {
          return { success: false, code: AsrApiCode.AudioInvalid, error: 'Missing audio data' };
        }

        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' }),
          options?.fileName || 'voice-input.wav',
        );
        if (options?.langType) {
          form.append('langType', options.langType);
        }

        const serverBaseUrl = getServerApiBaseUrl();
        const resp = await fetchWithAuth(`${serverBaseUrl}/api/asr/recognize`, {
          method: 'POST',
          body: form,
        });
        const body = await resp.json().catch((): null => null) as {
          code?: number;
          message?: string;
          data?: unknown;
        } | null;

        if (resp.ok && body?.code === 0 && body.data) {
          return { success: true, data: body.data as AsrRecognizeData };
        }

        return {
          success: false,
          code: body?.code ?? resp.status,
          error: body?.message || resp.statusText || 'ASR request failed',
          message: body?.message,
        };
      } catch (error) {
        console.warn('[ASR] recognition request failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'ASR request failed',
        };
      }
    },
  );
}
