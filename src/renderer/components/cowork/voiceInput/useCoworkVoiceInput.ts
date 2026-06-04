import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import {
  getAsrErrorMessage,
  recognizeVoiceInput,
  startVoiceRecording,
  VOICE_INPUT_MAX_RECORDING_MS,
  type VoiceRecordingSession,
} from '../../../services/voiceInput';
import { setDraftPrompt } from '../../../store/slices/coworkSlice';

const VoiceInputState = {
  Idle: 'idle',
  Recording: 'recording',
  Recognizing: 'recognizing',
} as const;

type VoiceInputState = typeof VoiceInputState[keyof typeof VoiceInputState];

const VOICE_INPUT_TIMER_INTERVAL_MS = 250;

interface UseCoworkVoiceInputOptions {
  draftKey: string;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  minHeight: number;
  maxHeight: number;
  isLoggedIn: boolean;
  disabled: boolean;
  isStreaming: boolean;
}

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

export const useCoworkVoiceInput = ({
  draftKey,
  value,
  setValue,
  textareaRef,
  minHeight,
  maxHeight,
  isLoggedIn,
  disabled,
  isStreaming,
}: UseCoworkVoiceInputOptions) => {
  const dispatch = useDispatch();
  const [voiceInputState, setVoiceInputState] = useState<VoiceInputState>(VoiceInputState.Idle);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const voiceRecordingRef = useRef<VoiceRecordingSession | null>(null);
  const voiceAutoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const valueRef = useRef(value);

  const appendRecognizedVoiceText = useCallback((recognizedText: string) => {
    const text = recognizedText.trim();
    if (!text) return;
    const currentValue = valueRef.current;
    const separator = currentValue.trim() ? (currentValue.endsWith('\n') ? '' : '\n') : '';
    const nextValue = `${currentValue}${separator}${text}`;
    setValue(nextValue);
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: nextValue }));
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
      textarea.selectionStart = nextValue.length;
      textarea.selectionEnd = nextValue.length;
    });
  }, [dispatch, draftKey, maxHeight, minHeight, setValue, textareaRef]);

  const clearVoiceAutoStopTimer = useCallback(() => {
    if (voiceAutoStopTimerRef.current) {
      clearTimeout(voiceAutoStopTimerRef.current);
      voiceAutoStopTimerRef.current = null;
    }
  }, []);

  const stopVoiceRecordingAndRecognize = useCallback(async () => {
    const recording = voiceRecordingRef.current;
    if (!recording) return;
    voiceRecordingRef.current = null;
    voiceRecordingStartedAtRef.current = null;
    clearVoiceAutoStopTimer();
    setVoiceInputState(VoiceInputState.Recognizing);
    setRecordingElapsedSeconds(0);
    try {
      const wavBlob = await recording.stop();
      const result = await recognizeVoiceInput(wavBlob);
      appendRecognizedVoiceText(result.text);
    } catch (error) {
      showToast(getAsrErrorMessage(error));
    } finally {
      setVoiceInputState(VoiceInputState.Idle);
    }
  }, [appendRecognizedVoiceText, clearVoiceAutoStopTimer]);

  const handleVoiceInput = useCallback(async () => {
    if (!isLoggedIn || disabled || isStreaming) return;
    if (voiceInputState === VoiceInputState.Recording) {
      await stopVoiceRecordingAndRecognize();
      return;
    }
    if (voiceInputState === VoiceInputState.Recognizing) return;

    try {
      textareaRef.current?.focus();
      const recording = await startVoiceRecording();
      voiceRecordingRef.current = recording;
      voiceRecordingStartedAtRef.current = Date.now();
      setRecordingElapsedSeconds(0);
      setVoiceInputState(VoiceInputState.Recording);
      voiceAutoStopTimerRef.current = setTimeout(() => {
        void stopVoiceRecordingAndRecognize();
      }, VOICE_INPUT_MAX_RECORDING_MS);
    } catch (error) {
      voiceRecordingRef.current?.cancel();
      voiceRecordingRef.current = null;
      voiceRecordingStartedAtRef.current = null;
      clearVoiceAutoStopTimer();
      setVoiceInputState(VoiceInputState.Idle);
      setRecordingElapsedSeconds(0);
      showToast(getAsrErrorMessage(error));
    }
  }, [
    clearVoiceAutoStopTimer,
    disabled,
    isLoggedIn,
    isStreaming,
    stopVoiceRecordingAndRecognize,
    textareaRef,
    voiceInputState,
  ]);

  useEffect(() => {
    return () => {
      clearVoiceAutoStopTimer();
      voiceRecordingRef.current?.cancel();
      voiceRecordingRef.current = null;
      voiceRecordingStartedAtRef.current = null;
    };
  }, [clearVoiceAutoStopTimer]);

  useEffect(() => {
    if (voiceInputState !== VoiceInputState.Recording) {
      return;
    }

    const updateElapsedSeconds = () => {
      const startedAt = voiceRecordingStartedAtRef.current;
      if (!startedAt) return;
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setRecordingElapsedSeconds(Math.min(elapsedSeconds, VOICE_INPUT_MAX_RECORDING_MS / 1000));
    };

    updateElapsedSeconds();
    const interval = window.setInterval(updateElapsedSeconds, VOICE_INPUT_TIMER_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [voiceInputState]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  return {
    handleVoiceInput,
    isVoiceRecording: voiceInputState === VoiceInputState.Recording,
    isVoiceRecognizing: voiceInputState === VoiceInputState.Recognizing,
    recordingElapsedSeconds,
  };
};
