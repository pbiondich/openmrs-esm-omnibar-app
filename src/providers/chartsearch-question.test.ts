import { describe, expect, it } from 'vitest';
import { looksLikeChartSearchQuestion } from './chartsearch-question';

describe('looksLikeChartSearchQuestion', () => {
  it.each([
    ['what happened at the last visit', 3, true],
    ['her latest CD4 result', 3, true],
    ['show medications', 3, true],
    ['weight?', 3, true],
    ['viral load over time', 3, true],
    ['what', 3, true],
    ['why', 3, false],
    ['weight', 3, false],
    ['cd4', 3, false],
    ['Mary Achieng', 3, false],
    ['viral load trend', 4, false],
    ['100GEJ', 3, false],
    ['100GEJ?', 3, false],
    ['who 100GEJ', 3, false],
    ['MRN 100GEJ jane', 3, false],
    ['8673ee4f-e2ab-4077-ba55-4980f408773e', 3, false],
    ['', 3, false],
  ])('classifies %j with minWords %i as %s', (query, minWords, expected) => {
    expect(looksLikeChartSearchQuestion(query, minWords)).toBe(expected);
  });
});
