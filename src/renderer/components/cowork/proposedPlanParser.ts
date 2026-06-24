const OPEN_TAG_PATTERN = /<proposed_plan\b[^>]*>/i;
const CLOSE_TAG_PATTERN = /<\/proposed_plan\s*>/i;
const OPEN_TAG_PREFIX = '<proposed_plan';
const FENCE_PATTERN = /^\s*(```|~~~)/;
const PLAN_SECTION_LABELS = 'Summary|Implementation Approach|Key Changes|Validation|Assumptions or Questions';
const PLAN_SECTION_LABEL_PATTERN = new RegExp(
  [
    `^(#{1,6})\\s*(${PLAN_SECTION_LABELS})\\s*$`,
    `^\\*\\*(${PLAN_SECTION_LABELS})\\*\\*\\s*$`,
    `^(#{1,6})\\s*(${PLAN_SECTION_LABELS})(?:\\*\\*)?(?:\\s*[:：])?\\s+(.+)$`,
    `^\\*\\*(${PLAN_SECTION_LABELS})\\*\\*(?:\\s*[:：])?\\s+(.+)$`,
    `^(?:\\*\\*)?(${PLAN_SECTION_LABELS})(?:\\*\\*)?\\s*[:：](?:\\*\\*)?\\s+(.+)$`,
    `^(?:\\*\\*)?(${PLAN_SECTION_LABELS})(?:\\*\\*)?\\s*(?=为)(.+)$`,
  ].join('|'),
  'i',
);
const INLINE_HEADING_SECTION_PATTERN = new RegExp(`\\s+(#{1,6}\\s*(?:${PLAN_SECTION_LABELS})(?=\\s*[:：]?\\s+))`, 'gi');
const INLINE_BOLD_SECTION_PATTERN = new RegExp(`\\s+(\\*\\*(?:${PLAN_SECTION_LABELS})\\*\\*(?=\\s*[:：]?\\s+))`, 'gi');
const INLINE_COLON_SECTION_PATTERN = new RegExp(`\\s+((?:${PLAN_SECTION_LABELS})\\s*[:：])`, 'gi');
const INLINE_CHINESE_CONNECTOR_SECTION_PATTERN = new RegExp(`\\s+((?:${PLAN_SECTION_LABELS})(?=为))`, 'gi');
const TRAILING_HEADING_MARKER_PATTERN = /(?:^|\n)\s*#{1,6}\s*$/;

export interface ProposedPlanParseResult {
  visibleText: string;
  planText: string | null;
  didNormalizePlanText?: boolean;
}

const findTrailingOpenTagPrefixIndex = (content: string): number => {
  const lowerContent = content.toLowerCase();
  const searchStart = Math.max(0, lowerContent.length - OPEN_TAG_PREFIX.length);
  for (let index = searchStart; index < lowerContent.length; index += 1) {
    const suffix = lowerContent.slice(index);
    if (suffix.length >= 2 && OPEN_TAG_PREFIX.startsWith(suffix)) return index;
  }
  return -1;
};

const splitInlinePlanSectionLabels = (line: string): string[] => line
  .replace(INLINE_HEADING_SECTION_PATTERN, '\n$1')
  .replace(INLINE_BOLD_SECTION_PATTERN, '\n$1')
  .replace(INLINE_COLON_SECTION_PATTERN, (match, section: string, offset: number, fullText: string) => {
    if (TRAILING_HEADING_MARKER_PATTERN.test(fullText.slice(0, offset))) return match;
    return `\n${section}`;
  })
  .replace(INLINE_CHINESE_CONNECTOR_SECTION_PATTERN, (match, section: string, offset: number, fullText: string) => {
    if (TRAILING_HEADING_MARKER_PATTERN.test(fullText.slice(0, offset))) return match;
    return `\n${section}`;
  })
  .split('\n');

const readPlanSectionMatch = (line: string): { headingMarker?: string; label: string; body?: string } | null => {
  const match = PLAN_SECTION_LABEL_PATTERN.exec(line);
  if (!match) return null;

  const [
    ,
    headingMarker,
    headingLabel,
    boldOnlyLabel,
    bodyHeadingMarker,
    bodyHeadingLabel,
    bodyHeadingBody,
    boldLabel,
    boldBody,
    colonLabel,
    colonBody,
    connectorLabel,
    connectorBody,
  ] = match;

  const label = headingLabel ?? boldOnlyLabel ?? bodyHeadingLabel ?? boldLabel ?? colonLabel ?? connectorLabel;
  const body = bodyHeadingBody ?? boldBody ?? colonBody ?? connectorBody;
  if (!label) return null;

  return { headingMarker: headingMarker ?? bodyHeadingMarker, label, body };
};

const normalizeProposedPlanMarkdownWithFlag = (content: string): { text: string; didNormalize: boolean } => {
  let isInFence = false;
  let didNormalize = false;

  const text = content
    .split('\n')
    .flatMap((line) => {
      if (FENCE_PATTERN.test(line)) {
        isInFence = !isInFence;
        return [line];
      }

      if (isInFence) return [line];

      return splitInlinePlanSectionLabels(line).flatMap((segment) => {
        const match = readPlanSectionMatch(segment);
        if (!match) return [segment];

        const { headingMarker, label, body } = match;
        didNormalize = true;
        if (!body) return [`${headingMarker ?? '##'} ${label}`];
        return [`${headingMarker ?? '##'} ${label}`, '', body];
      });
    })
    .join('\n');

  return { text, didNormalize };
};

export const normalizeProposedPlanMarkdown = (content: string): string =>
  normalizeProposedPlanMarkdownWithFlag(content).text;

export const parseProposedPlanBlock = (content: string): ProposedPlanParseResult => {
  const openMatch = OPEN_TAG_PATTERN.exec(content);
  if (!openMatch) {
    const partialOpenIndex = findTrailingOpenTagPrefixIndex(content);
    if (partialOpenIndex >= 0) {
      return {
        visibleText: content.slice(0, partialOpenIndex).trimEnd(),
        planText: null,
      };
    }
    return { visibleText: content, planText: null };
  }

  const openIndex = openMatch.index;
  const contentStart = openIndex + openMatch[0].length;
  const closeMatch = CLOSE_TAG_PATTERN.exec(content.slice(contentStart));
  if (!closeMatch) {
    const visibleText = content.slice(0, openIndex).replace(/[ \t]*\n?$/, '').trimEnd();
    const normalizedPlan = normalizeProposedPlanMarkdownWithFlag(content.slice(contentStart).trim());
    return {
      visibleText,
      planText: normalizedPlan.text || null,
      didNormalizePlanText: normalizedPlan.didNormalize || undefined,
    };
  }

  const closeIndex = contentStart + closeMatch.index;
  const before = content.slice(0, openIndex).replace(/[ \t]*\n?$/, '');
  const after = content.slice(closeIndex + closeMatch[0].length).replace(/^\n?/, '');
  const visibleText = [before, after].filter(Boolean).join(before && after ? '\n' : '').trimEnd();
  const normalizedPlan = normalizeProposedPlanMarkdownWithFlag(content.slice(contentStart, closeIndex).trim());

  return {
    visibleText,
    planText: normalizedPlan.text || null,
    didNormalizePlanText: normalizedPlan.didNormalize || undefined,
  };
};
