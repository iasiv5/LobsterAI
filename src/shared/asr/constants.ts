export const AsrIpcChannel = {
  Recognize: 'asr:recognize',
} as const;

export type AsrIpcChannel = typeof AsrIpcChannel[keyof typeof AsrIpcChannel];

export const AsrLangType = {
  ZhChs: 'zh-CHS',
} as const;

export type AsrLangType = typeof AsrLangType[keyof typeof AsrLangType];

export const AsrApiCode = {
  Unauthorized: 401,
  ConfigInvalid: 41400,
  AudioInvalid: 41401,
  AudioTooLarge: 41402,
  AudioTooLong: 41403,
  DailyLimitExceeded: 41404,
  UpstreamAuthFailed: 41405,
  UpstreamRateLimited: 41406,
  RecognitionFailed: 41407,
  UpstreamError: 50201,
  UpstreamBalanceInsufficient: 50203,
  UpstreamInvalidParams: 50204,
} as const;

export type AsrApiCode = typeof AsrApiCode[keyof typeof AsrApiCode];

export interface AsrRecognizeRequest {
  audioBase64: string;
  fileName?: string;
  langType?: AsrLangType;
}

export interface AsrRecognizeData {
  requestId: string;
  text: string;
  result: string[];
  durationSeconds: number;
  usedSecondsToday: number;
  remainingSecondsToday: number;
  limitSecondsToday: number;
}

export type AsrRecognizeResult =
  | { success: true; data: AsrRecognizeData }
  | { success: false; code?: number; error?: string; message?: string };
