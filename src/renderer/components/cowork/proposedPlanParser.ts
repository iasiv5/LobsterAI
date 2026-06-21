const OPEN_TAG_PATTERN = /<proposed_plan\b[^>]*>/i;
const CLOSE_TAG_PATTERN = /<\/proposed_plan\s*>/i;
const OPEN_TAG_PREFIX = '<proposed_plan';

export interface ProposedPlanParseResult {
  visibleText: string;
  planText: string | null;
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
    const planText = content.slice(contentStart).trim();
    return { visibleText, planText: planText || null };
  }

  const closeIndex = contentStart + closeMatch.index;
  const before = content.slice(0, openIndex).replace(/[ \t]*\n?$/, '');
  const after = content.slice(closeIndex + closeMatch[0].length).replace(/^\n?/, '');
  const visibleText = [before, after].filter(Boolean).join(before && after ? '\n' : '').trimEnd();
  const planText = content.slice(contentStart, closeIndex).trim();

  return {
    visibleText,
    planText: planText || null,
  };
};
