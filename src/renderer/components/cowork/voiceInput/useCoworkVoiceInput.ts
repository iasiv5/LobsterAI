import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import {
  getAsrErrorMessage,
  type RealtimeVoiceInputSession,
  startRealtimeVoiceInput,
  VOICE_INPUT_MAX_RECORDING_MS,
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
  const voiceRecordingRef = useRef<RealtimeVoiceInputSession | null>(null);
  const voiceAutoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceRecordingMaxMsRef = useRef(VOICE_INPUT_MAX_RECORDING_MS);
  const voiceInputStartingRef = useRef(false);
  const realtimeVoiceBaseValueRef = useRef<string | null>(null);
  const valueRef = useRef(value);

  const setPromptValue = useCallback((nextValue: string) => {
    setValue(nextValue);
    valueRef.current = nextValue;
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

  const replaceRealtimeRecognizedVoiceText = useCallback((recognizedText: string) => {
    const text = recognizedText.trim();
    if (!text) return;
    const baseValue = realtimeVoiceBaseValueRef.current ?? valueRef.current;
    const separator = baseValue.trim() ? (baseValue.endsWith('\n') ? '' : '\n') : '';
    setPromptValue(`${baseValue}${separator}${text}`);
  }, [setPromptValue]);

  const clearVoiceAutoStopTimer = useCallback(() => {
    if (voiceAutoStopTimerRef.current) {
      clearTimeout(voiceAutoStopTimerRef.current);
      voiceAutoStopTimerRef.current = null;
    }
  }, []);

  const stopVoiceRecordingAndRecognize = useCallback(async () => {
    const activeRecording = voiceRecordingRef.current;
    if (!activeRecording) return;
    voiceInputStartingRef.current = false;
    voiceRecordingRef.current = null;
    voiceRecordingStartedAtRef.current = null;
    voiceRecordingMaxMsRef.current = VOICE_INPUT_MAX_RECORDING_MS;
    clearVoiceAutoStopTimer();
    setVoiceInputState(VoiceInputState.Recognizing);
    setRecordingElapsedSeconds(0);
    try {
      const text = await activeRecording.stop();
      replaceRealtimeRecognizedVoiceText(text);
      realtimeVoiceBaseValueRef.current = null;
    } catch (error) {
      console.warn('[VoiceInput] voice input recognition failed:', error);
      showToast(getAsrErrorMessage(error));
    } finally {
      realtimeVoiceBaseValueRef.current = null;
      setVoiceInputState(VoiceInputState.Idle);
    }
  }, [
    clearVoiceAutoStopTimer,
    replaceRealtimeRecognizedVoiceText,
  ]);

  const handleVoiceInput = useCallback(async () => {
    if (!isLoggedIn || disabled || isStreaming) return;
    if (voiceInputStartingRef.current) return;
    if (voiceInputState === VoiceInputState.Recording) {
      await stopVoiceRecordingAndRecognize();
      return;
    }
    if (voiceInputState === VoiceInputState.Recognizing) return;

    try {
      voiceInputStartingRef.current = true;
      setVoiceInputState(VoiceInputState.Recognizing);
      textareaRef.current?.focus();
      realtimeVoiceBaseValueRef.current = valueRef.current;
      const realtimeSession = await startRealtimeVoiceInput({
        onText: replaceRealtimeRecognizedVoiceText,
        onError: (error) => {
          if (!voiceRecordingRef.current) return;
          console.warn('[VoiceInput] realtime voice input session reported an error:', error);
          voiceInputStartingRef.current = false;
          clearVoiceAutoStopTimer();
          voiceRecordingRef.current = null;
          voiceRecordingStartedAtRef.current = null;
          voiceRecordingMaxMsRef.current = VOICE_INPUT_MAX_RECORDING_MS;
          realtimeVoiceBaseValueRef.current = null;
          setVoiceInputState(VoiceInputState.Idle);
          setRecordingElapsedSeconds(0);
          showToast(getAsrErrorMessage(error));
        },
      });
      voiceRecordingRef.current = realtimeSession;
      voiceRecordingMaxMsRef.current = Math.max(1, realtimeSession.maxSessionSeconds) * 1000;
      voiceRecordingStartedAtRef.current = Date.now();
      voiceInputStartingRef.current = false;
      setRecordingElapsedSeconds(0);
      setVoiceInputState(VoiceInputState.Recording);
      voiceAutoStopTimerRef.current = setTimeout(() => {
        void stopVoiceRecordingAndRecognize();
      }, voiceRecordingMaxMsRef.current);
    } catch (error) {
      console.warn('[VoiceInput] failed to start voice input:', error);
      voiceInputStartingRef.current = false;
      voiceRecordingRef.current?.cancel();
      voiceRecordingRef.current = null;
      voiceRecordingStartedAtRef.current = null;
      voiceRecordingMaxMsRef.current = VOICE_INPUT_MAX_RECORDING_MS;
      realtimeVoiceBaseValueRef.current = null;
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
    replaceRealtimeRecognizedVoiceText,
    voiceInputState,
  ]);

  useEffect(() => {
    return () => {
      clearVoiceAutoStopTimer();
      voiceInputStartingRef.current = false;
      voiceRecordingRef.current?.cancel();
      voiceRecordingRef.current = null;
      voiceRecordingStartedAtRef.current = null;
      voiceRecordingMaxMsRef.current = VOICE_INPUT_MAX_RECORDING_MS;
      realtimeVoiceBaseValueRef.current = null;
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
      setRecordingElapsedSeconds(Math.min(elapsedSeconds, voiceRecordingMaxMsRef.current / 1000));
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
