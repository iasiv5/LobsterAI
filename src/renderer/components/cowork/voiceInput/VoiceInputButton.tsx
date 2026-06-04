import React from 'react';

import { i18nService } from '../../../services/i18n';
import MicrophoneIcon from '../../icons/MicrophoneIcon';

interface VoiceInputButtonProps {
  buttonClassName: string;
  iconClassName: string;
  isLoggedIn: boolean;
  disabled: boolean;
  isStreaming: boolean;
  isRecording: boolean;
  isRecognizing: boolean;
  onClick: () => void;
}

const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  buttonClassName,
  iconClassName,
  isLoggedIn,
  disabled,
  isStreaming,
  isRecording,
  isRecognizing,
  onClick,
}) => {
  const unavailable = !isLoggedIn || disabled || isStreaming;
  const title = !isLoggedIn
    ? i18nService.t('voiceInputLoginRequired')
    : isRecording
      ? i18nService.t('voiceInputStopRecording')
      : isRecognizing
        ? i18nService.t('voiceInputRecognizing')
        : i18nService.t('voiceInput');
  const stateClass = isRecording
    ? 'bg-red-500/10 text-red-500 hover:bg-red-500/15'
    : isRecognizing
      ? 'bg-primary/10 text-primary'
      : unavailable
        ? 'cursor-not-allowed text-secondary/40 opacity-60'
        : 'text-secondary hover:bg-surface-raised hover:text-foreground';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={unavailable || isRecognizing}
      aria-label={title}
      title={title}
      className={`${buttonClassName} ${stateClass} transition-colors`}
    >
      <MicrophoneIcon className={`${iconClassName} ${isRecognizing ? 'animate-pulse' : ''}`} />
    </button>
  );
};

export default VoiceInputButton;
