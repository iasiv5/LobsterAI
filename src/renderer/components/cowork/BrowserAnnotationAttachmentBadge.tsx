import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
import {
  BrowserAnnotationAnchorKind,
  BrowserAnnotationScreenshotStatus,
  type CoworkBrowserAnnotationBatch,
  getBrowserAnnotationElementChanges,
} from '@shared/cowork/browserAnnotations';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import XMarkIcon from '../icons/XMarkIcon';

interface BrowserAnnotationAttachmentBadgeProps {
  draftKey: string;
  batches: CoworkBrowserAnnotationBatch[];
  onClear?: () => void;
  readOnly?: boolean;
}

const AnnotationThumbnail: React.FC<{
  draftKey: string;
  batch: CoworkBrowserAnnotationBatch;
  annotationId: string;
  assetId?: string;
  index: number;
}> = ({ draftKey, batch, annotationId, assetId, index }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!assetId) return undefined;
    void window.electron?.artifact?.readBrowserAnnotationAsset({
      draftKey,
      batchId: batch.id,
      annotationId,
      assetId,
    }).then(result => {
      if (alive && result?.success && result.dataUrl) setSrc(result.dataUrl);
    });
    return () => { alive = false; };
  }, [annotationId, assetId, batch.id, draftKey]);
  return (
    <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-md bg-surface-raised">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null}
      <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
        {index}
      </span>
    </div>
  );
};

const formatElementChangeProperty = (property: string): string => (
  property.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)
);

const formatElementChangeValue = (value: string | number | undefined): string => (
  value === undefined || value === '' ? '—' : String(value)
);

const BrowserAnnotationAttachmentBadge: React.FC<BrowserAnnotationAttachmentBadgeProps> = ({
  draftKey,
  batches,
  onClear,
  readOnly = false,
}) => {
  const [open, setOpen] = useState(false);
  const annotations = useMemo(() => batches.flatMap(batch => (
    batch.annotations.map(annotation => ({ batch, annotation }))
  )), [batches]);
  if (annotations.length === 0) return null;
  return (
    <div className="relative inline-flex">
      <div className="inline-flex h-8 items-center rounded-full border border-border bg-surface-raised text-xs text-foreground transition-colors hover:bg-surface">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="inline-flex h-full items-center gap-1.5 rounded-l-full pl-3 pr-2"
          aria-expanded={open}
        >
          <ChatBubbleLeftIcon className="h-3.5 w-3.5" />
          <span>{i18nService.t('browserAnnotationsCount').replace('{count}', String(annotations.length))}</span>
        </button>
        {!readOnly && onClear ? (
          <button
            type="button"
            className="mr-1 rounded-full p-1 text-muted hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
            aria-label={i18nService.t('browserAnnotationsClear')}
            onClick={event => {
              event.stopPropagation();
              onClear();
            }}
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-foreground">
            {i18nService.t('browserAnnotationsTitle')}
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {annotations.map(({ batch, annotation }, index) => {
              const target = annotation.anchor.kind === BrowserAnnotationAnchorKind.Element
                ? annotation.anchor.tagName
                : i18nService.t(`browserAnnotationTarget_${annotation.anchor.kind}`);
              const elementChanges = getBrowserAnnotationElementChanges(annotation.elementEdit);
              return (
                <div key={annotation.id} className="flex gap-2 rounded-lg p-2 hover:bg-surface">
                  <AnnotationThumbnail
                    draftKey={draftKey}
                    batch={batch}
                    annotationId={annotation.id}
                    assetId={annotation.screenshot.status === BrowserAnnotationScreenshotStatus.Ready
                      ? annotation.screenshot.asset.assetId
                      : undefined}
                    index={index + 1}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                      <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-foreground">
                        {target}
                      </span>
                      <span className="truncate">{batch.pageTitle || batch.pageUrl}</span>
                    </div>
                    {annotation.comment ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-foreground">
                        {annotation.comment}
                      </div>
                    ) : null}
                    {elementChanges.length > 0 ? (
                      <div className="mt-1.5 space-y-0.5">
                        {elementChanges.map(change => (
                          <div
                            key={change.property}
                            className="break-words font-mono text-[11px] leading-4 text-muted"
                          >
                            <span className="text-secondary">
                              {formatElementChangeProperty(change.property)}:
                            </span>{' '}
                            {formatElementChangeValue(change.originalValue)}
                            <span className="px-1 text-secondary">→</span>
                            <span className="text-foreground">
                              {formatElementChangeValue(change.currentValue)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BrowserAnnotationAttachmentBadge;
