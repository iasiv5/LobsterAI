import { describe, expect, test } from 'vitest';

import { parseProposedPlanBlock } from './proposedPlanParser';

describe('parseProposedPlanBlock', () => {
  test('extracts a proposed plan and removes it from visible text', () => {
    expect(parseProposedPlanBlock('Intro\n<proposed_plan>\n- Step\n</proposed_plan>\nOutro')).toEqual({
      visibleText: 'Intro\nOutro',
      planText: '- Step',
    });
  });

  test('leaves text unchanged when no plan block exists', () => {
    expect(parseProposedPlanBlock('Intro')).toEqual({
      visibleText: 'Intro',
      planText: null,
    });
  });

  test('parses an incomplete streaming plan block without showing the tag', () => {
    expect(parseProposedPlanBlock('Intro\n<proposed_plan>\n- Step')).toEqual({
      visibleText: 'Intro',
      planText: '- Step',
    });
  });

  test('hides a partial opening tag while it is streaming', () => {
    expect(parseProposedPlanBlock('Intro\n<proposed_')).toEqual({
      visibleText: 'Intro',
      planText: null,
    });
  });

  test('accepts case-insensitive tags with attributes', () => {
    expect(parseProposedPlanBlock('<PROPOSED_PLAN data-source="model">\n- Step\n</PROPOSED_PLAN>')).toEqual({
      visibleText: '',
      planText: '- Step',
    });
  });
});
