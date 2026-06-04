import { i18nService } from '../i18n';
import {
  VOICE_INPUT_MIN_RECORDING_MS,
  VOICE_INPUT_TARGET_SAMPLE_RATE,
} from './constants';
import { AsrClientError } from './errors';
import { encodePcm16Wav, mergeAudioChunks, resampleLinear } from './wavEncoder';

type AudioContextConstructor = typeof AudioContext;

export interface VoiceRecordingSession {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

const resolveAudioContext = (): AudioContextConstructor | null => {
  const windowWithWebkit = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? windowWithWebkit.webkitAudioContext ?? null;
};

export const startVoiceRecording = async (): Promise<VoiceRecordingSession> => {
  const AudioContextImpl = resolveAudioContext();
  if (!AudioContextImpl || !navigator.mediaDevices?.getUserMedia) {
    throw new AsrClientError(i18nService.t('voiceInputMicrophoneUnavailable'));
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioContext = new AudioContextImpl();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const mutedOutput = audioContext.createGain();
  mutedOutput.gain.value = 0;
  const chunks: Float32Array[] = [];
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(mutedOutput);
  mutedOutput.connect(audioContext.destination);

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    processor.disconnect();
    source.disconnect();
    mutedOutput.disconnect();
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    stop: async () => {
      const sourceSampleRate = audioContext.sampleRate;
      cleanup();
      await audioContext.close();
      const merged = mergeAudioChunks(chunks);
      if (merged.length === 0) {
        throw new AsrClientError(i18nService.t('voiceInputNoAudioCaptured'));
      }
      const resampled = resampleLinear(merged, sourceSampleRate, VOICE_INPUT_TARGET_SAMPLE_RATE);
      if (resampled.length < VOICE_INPUT_TARGET_SAMPLE_RATE * (VOICE_INPUT_MIN_RECORDING_MS / 1000)) {
        throw new AsrClientError(i18nService.t('voiceInputNoAudioCaptured'));
      }
      return encodePcm16Wav(resampled, VOICE_INPUT_TARGET_SAMPLE_RATE);
    },
    cancel: () => {
      cleanup();
      void audioContext.close();
    },
  };
};
