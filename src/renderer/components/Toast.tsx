import { InformationCircleIcon } from '@heroicons/react/20/solid';
import { XMarkIcon } from '@heroicons/react/24/outline';
import React from 'react';

interface ToastProps {
  message: string;
  closeLabel: string;
  onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, closeLabel, onClose }) => {
  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-[10000] w-max max-w-full -translate-x-1/2 -translate-y-1/2 px-4">
      <div
        className="pointer-events-auto w-fit max-w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 text-foreground shadow-elevated animate-scale-in"
        role="status"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="shrink-0 rounded-full bg-primary-muted p-1.5">
            <InformationCircleIcon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1 text-sm font-medium leading-snug [overflow-wrap:anywhere]">
            {message}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="shrink-0 text-secondary hover:text-foreground rounded-full p-1 hover:bg-surface-raised transition-colors"
              aria-label={closeLabel}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Toast;
