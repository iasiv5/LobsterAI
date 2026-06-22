import {
  ArrowDownTrayIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { showToast } from '../../utils/localFileActions';
import MarkdownContent from '../MarkdownContent';
import type { ImagePreviewSource } from './ImagePreviewModal';
import { MessageActionButton, MessageCopyButton } from './MessageActionButton';

interface ProposedPlanBlockProps {
  content: string;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  onImageClick: (image: ImagePreviewSource) => void;
}

const ACTION_FEEDBACK_DURATION_MS = 1500;

const ProposedPlanBlock: React.FC<ProposedPlanBlockProps> = ({
  content,
  resolveLocalFilePath,
  onImageClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const downloadTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current);
  }, []);

  const handleDownload = useCallback(() => {
    let objectUrl: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      objectUrl = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `lobsterai-plan-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      setIsDownloaded(true);
      if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current);
      downloadTimerRef.current = window.setTimeout(
        () => setIsDownloaded(false),
        ACTION_FEEDBACK_DURATION_MS,
      );
      window.electron?.log?.fromRenderer?.(
        'debug',
        'ProposedPlanBlock',
        'Downloaded the proposed plan as a Markdown file.',
      );
    } catch (error) {
      console.warn('[ProposedPlanBlock] failed to download the proposed plan:', error);
      window.electron?.log?.fromRenderer?.(
        'warn',
        'ProposedPlanBlock',
        'Failed to download the proposed plan as a Markdown file.',
      );
      showToast(i18nService.t('coworkProposedPlanDownloadFailed'));
    } finally {
      anchor?.remove();
      if (objectUrl) {
        const objectUrlToRevoke = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(objectUrlToRevoke), 0);
      }
    }
  }, [content]);

  const toggleLabel = i18nService.t(
    isExpanded ? 'coworkProposedPlanCollapse' : 'coworkProposedPlanExpand',
  );

  return (
    <section
      className="overflow-hidden rounded-lg border border-primary/20 bg-primary/5"
      aria-label={i18nService.t('coworkProposedPlanTitle')}
    >
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-primary/10 px-4 py-2">
        <div className="min-w-0 text-sm font-medium text-primary">
          {i18nService.t('coworkProposedPlanTitle')}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <MessageActionButton
            label={i18nService.t('coworkProposedPlanDownload')}
            onClick={(event) => {
              event.stopPropagation();
              handleDownload();
            }}
          >
            {isDownloaded ? (
              <CheckIcon className="h-4 w-4 text-success" />
            ) : (
              <ArrowDownTrayIcon className="h-4 w-4" />
            )}
          </MessageActionButton>
          <MessageCopyButton content={content} />
          <MessageActionButton
            label={toggleLabel}
            onClick={(event) => {
              event.stopPropagation();
              setIsExpanded(value => !value);
            }}
            expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronUpIcon className="h-4 w-4" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" />
            )}
          </MessageActionButton>
        </div>
      </header>
      {isExpanded && (
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <MarkdownContent
            content={content}
            className="prose dark:prose-invert max-w-none"
            resolveLocalFilePath={resolveLocalFilePath}
            showRevealInFolderAction
            onImageClick={onImageClick}
          />
        </div>
      )}
    </section>
  );
};

export default ProposedPlanBlock;
