import React, { useCallback, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { formatMessageDateTime } from '../../utils/tokenFormat';
import MessageForkIcon from '../icons/MessageForkIcon';
import MarkdownContent from '../MarkdownContent';
import ImagePreviewModal, { type ImagePreviewSource } from './ImagePreviewModal';
import { MessageCopyButton } from './MessageActionButton';
import {
  getMessageModelLabel,
  MEDIA_TOKEN_DISPLAY_RE,
  messageMetaClassName,
} from './messageDisplayUtils';
import ProposedPlanBlock from './ProposedPlanBlock';
import { parseProposedPlanBlock } from './proposedPlanParser';

export { MessageCopyButton as CopyButton } from './MessageActionButton';

const ForkButton: React.FC<{
  visible: boolean;
  onFork: () => void;
}> = ({ visible, onFork }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onFork();
    }}
    className={`p-1.5 rounded-md hover:bg-surface-raised transition-all duration-200 ${
      visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
    }`}
    tabIndex={visible ? 0 : -1}
    title={i18nService.t('coworkForkFromMessage')}
    aria-label={i18nService.t('coworkForkFromMessage')}
  >
    <MessageForkIcon className="h-4 w-4 text-secondary" />
  </button>
);

// ── AssistantMessageItem ─────────────────────────────────────────────────────

const AssistantMessageItem: React.FC<{
  message: CoworkMessage;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showCopyButton?: boolean;
  onFork?: (messageId: string) => void;
  turnMetadata?: CoworkMessageMetadata | null;
}> = ({
  message,
  resolveLocalFilePath,
  mapDisplayText,
  showCopyButton = false,
  onFork,
  turnMetadata,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const rawContent = mapDisplayText ? mapDisplayText(message.content) : message.content;
  const proposedPlan = parseProposedPlanBlock(rawContent);
  const displayContent = proposedPlan.visibleText.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
  const copyContent = [
    displayContent,
    proposedPlan.planText,
  ].filter((part): part is string => Boolean(part)).join('\n\n');
  const modelLabel = getMessageModelLabel(turnMetadata);
  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsHovered(false);
  }, []);
  const handleMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setIsHovered(false);
  }, []);

  return (
    <div
      className="relative focus:outline-none"
      data-cowork-assistant-message-id={message.id}
      tabIndex={showCopyButton ? 0 : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setIsHovered(true)}
      onBlur={handleBlur}
    >
      <div className="text-foreground">
        {displayContent && (
          <div>
            <MarkdownContent
              content={displayContent}
              className="prose dark:prose-invert max-w-none"
              resolveLocalFilePath={resolveLocalFilePath}
              showRevealInFolderAction
              onImageClick={setExpandedImage}
            />
            {showCopyButton && (
              <div className={messageMetaClassName(isHovered)} aria-hidden={!isHovered}>
                <span>{formatMessageDateTime(message.timestamp)}</span>
                {modelLabel && <span>{modelLabel}</span>}
                {onFork && (
                  <ForkButton
                    visible={isHovered}
                    onFork={() => onFork(message.id)}
                  />
                )}
                <MessageCopyButton
                  content={copyContent}
                  visible={isHovered}
                />
              </div>
            )}
          </div>
        )}
        {proposedPlan.planText && (
          <div className={displayContent ? 'mt-4' : undefined}>
            <ProposedPlanBlock
              content={proposedPlan.planText}
              resolveLocalFilePath={resolveLocalFilePath}
              onImageClick={setExpandedImage}
            />
          </div>
        )}
      </div>
      {showCopyButton && !displayContent && (
        <div className={messageMetaClassName(isHovered)} aria-hidden={!isHovered}>
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span>{modelLabel}</span>}
          {onFork && (
            <ForkButton
              visible={isHovered}
              onFork={() => onFork(message.id)}
            />
          )}
          <MessageCopyButton
            content={copyContent}
            visible={isHovered}
          />
        </div>
      )}
      <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />
    </div>
  );
};

export default AssistantMessageItem;
