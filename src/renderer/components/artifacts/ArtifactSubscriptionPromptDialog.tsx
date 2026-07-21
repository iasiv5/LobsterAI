import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '@/services/i18n';

import {
  type ArtifactSubscriptionBlockReason,
  type ArtifactSubscriptionFeature,
  getArtifactSubscriptionPromptCopyKeys,
} from './artifactSubscriptionGate';

interface ArtifactSubscriptionPromptDialogProps {
  feature: ArtifactSubscriptionFeature;
  reason: ArtifactSubscriptionBlockReason;
  onCancel: () => void;
  onSubscribe: () => void;
}

const ArtifactSubscriptionPromptDialog = ({
  feature,
  reason,
  onCancel,
  onSubscribe,
}: ArtifactSubscriptionPromptDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const copyKeys = getArtifactSubscriptionPromptCopyKeys(feature, reason);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialogElement = dialogRef.current;
      if (!dialogElement) return;
      const focusableElements = Array.from(
        dialogElement.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (!dialogElement.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [onCancel]);

  const dialog = (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 px-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-[420px] rounded-lg border border-border bg-background p-4 shadow-2xl"
      >
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          {i18nService.t(copyKeys.titleKey)}
        </h2>
        <div
          id={descriptionId}
          className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-secondary"
        >
          {i18nService.t(copyKeys.messageKey)}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface hover:text-foreground"
          >
            {i18nService.t('cancel')}
          </button>
          <button
            type="button"
            onClick={onSubscribe}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {i18nService.t('subscriptionGateOpenAction')}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};

export default ArtifactSubscriptionPromptDialog;
