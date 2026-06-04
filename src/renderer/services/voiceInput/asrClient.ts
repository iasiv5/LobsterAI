import {
  AsrApiCode,
  AsrLangType,
  type AsrRecognizeData,
} from '../../../shared/asr/constants';
import { buildVoiceInputFileName } from './constants';
import { AsrClientError, getFallbackAsrErrorMessage } from './errors';

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const recognizeVoiceInput = async (wavBlob: Blob): Promise<AsrRecognizeData> => {
  const audioBase64 = await blobToBase64(wavBlob);
  const result = await window.electron.asr.recognize({
    audioBase64,
    fileName: buildVoiceInputFileName(),
    // TODO: The current product is China-first. Revisit langType selection for international releases.
    langType: AsrLangType.ZhChs,
  });
  if (!result.success) {
    throw new AsrClientError(getFallbackAsrErrorMessage(result.code), result.code);
  }
  if (!result.data.text.trim()) {
    throw new AsrClientError(getFallbackAsrErrorMessage(AsrApiCode.RecognitionFailed), AsrApiCode.RecognitionFailed);
  }
  return result.data;
};
