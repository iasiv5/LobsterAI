import React from 'react';

const formatElapsedSeconds = (elapsedSeconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

interface VoiceInputRecordingStatusProps {
  elapsedSeconds: number;
}

const VoiceInputRecordingStatus: React.FC<VoiceInputRecordingStatusProps> = ({
  elapsedSeconds,
}) => (
  <span className="pointer-events-none w-9 shrink-0 select-none text-right text-[13px] tabular-nums leading-none text-secondary">
    {formatElapsedSeconds(elapsedSeconds)}
  </span>
);

export default VoiceInputRecordingStatus;
